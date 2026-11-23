-- Receptor de sincronización de Caudal dentro de Supabase.
--
-- Mismas reglas que «finanzas.sincronizacion» (el receptor local de pruebas): cada lote parte de la
-- última versión aceptada de cada entidad, los reintentos son idempotentes, cada cuenta tiene un libro
-- principal y cada libro guarda su última instantánea. Las tablas no admiten acceso directo (RLS sin
-- políticas): todo pasa por funciones SECURITY DEFINER que solo ven las filas de «auth.uid()».
-- Errores con SQLSTATE PTxyz: PostgREST responde con el estado HTTP xyz.
--
-- Se puede volver a ejecutar sin perder datos.

create table if not exists public.caudal_lote (
  cursor bigserial primary key,
  usuario uuid not null,
  libro text not null,
  clave text not null,
  contenido jsonb not null,
  unique (usuario, libro, clave)
);
create index if not exists caudal_lote_descarga on public.caudal_lote (usuario, libro, cursor);

create table if not exists public.caudal_operacion (
  usuario uuid not null,
  libro text not null,
  clave text not null,
  primary key (usuario, libro, clave)
);

create table if not exists public.caudal_cabeza (
  usuario uuid not null,
  libro text not null,
  entidad_id text not null,
  operacion text not null,
  accion text not null,
  primary key (usuario, libro, entidad_id)
);

create table if not exists public.caudal_cuenta_libro (
  usuario uuid primary key,
  libro text not null,
  generacion integer not null,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.caudal_instantanea (
  usuario uuid not null,
  libro text not null,
  cursor bigint not null,
  creada_en timestamptz not null default now(),
  resumen jsonb not null,
  contenido bytea not null,
  primary key (usuario, libro)
);

alter table public.caudal_lote enable row level security;
alter table public.caudal_operacion enable row level security;
alter table public.caudal_cabeza enable row level security;
alter table public.caudal_cuenta_libro enable row level security;
alter table public.caudal_instantanea enable row level security;
revoke all on public.caudal_lote, public.caudal_operacion, public.caudal_cabeza,
  public.caudal_cuenta_libro, public.caudal_instantanea from anon, authenticated;

create or replace function public.caudal_usuario() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  u uuid := auth.uid();
begin
  if u is null then
    raise exception 'Sesión inválida' using errcode = 'PT401';
  end if;
  return u;
end $$;

create or replace function public.caudal_identidad(valor text) returns boolean
language sql immutable as $$ select coalesce(valor ~ '^[0-9a-f]{32}$', false) $$;

create or replace function public.caudal_libro_principal(u uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  principal text;
  libros text[];
begin
  select libro into principal from caudal_cuenta_libro where usuario = u;
  if principal is not null then
    return principal;
  end if;
  -- Cuentas anteriores a la instantánea: si solo hay un libro con lotes, es el principal.
  select array_agg(distinct libro) into libros from caudal_lote where usuario = u;
  return case when coalesce(array_length(libros, 1), 0) = 1 then libros[1] end;
end $$;

create or replace function public.caudal_sesion() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('titular', public.caudal_usuario())
$$;

create or replace function public.caudal_cuenta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u uuid := public.caudal_usuario();
  principal text := public.caudal_libro_principal(u);
  maximo bigint;
  foto record;
begin
  if principal is null then
    return jsonb_build_object('libro', null, 'cursor', 0, 'instantanea', null);
  end if;
  select coalesce(max(cursor), 0) into maximo from caudal_lote where usuario = u and libro = principal;
  select cursor, creada_en, resumen, octet_length(contenido) as bytes into foto
    from caudal_instantanea where usuario = u and libro = principal;
  return jsonb_build_object(
    'libro', principal,
    'cursor', maximo,
    'instantanea', case when foto.cursor is null then null else jsonb_build_object(
      'cursor', foto.cursor, 'creada_en', to_char(foto.creada_en at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      'resumen', foto.resumen, 'bytes', foto.bytes) end
  );
end $$;

create or replace function public.caudal_recibir_lote(p_lote jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := public.caudal_usuario();
  l text := p_lote ->> 'libro';
  k text := p_lote ->> 'lote';
  n integer := coalesce(jsonb_array_length(p_lote -> 'cambios'), 0);
  c jsonb;
  previo record;
  principal text;
  choques text[] := '{}';
  cabezas jsonb := '{}';
  previa jsonb;
  valido boolean;
  nuevo bigint;
begin
  if not public.caudal_identidad(l) or not public.caudal_identidad(k) or n < 1 or n > 500 then
    raise exception 'Lote no válido' using errcode = 'PT422';
  end if;
  if octet_length(p_lote::text) > 2000000 then
    raise exception 'Lote demasiado grande' using errcode = 'PT413';
  end if;
  for c in select value from jsonb_array_elements(p_lote -> 'cambios') loop
    if not public.caudal_identidad(c ->> 'operacion') or not public.caudal_identidad(c ->> 'entidad_id')
       or coalesce(c ->> 'entidad', '') not in ('cuenta', 'categoria', 'transaccion')
       or coalesce(c ->> 'accion', '') not in ('crear', 'editar', 'eliminar')
       or (coalesce(c -> 'version_base', 'null'::jsonb) <> 'null'::jsonb
           and not public.caudal_identidad(c ->> 'version_base'))
       or jsonb_typeof(c -> 'campos') is distinct from 'object' then
      raise exception 'Cambio no válido' using errcode = 'PT422';
    end if;
  end loop;
  if (select count(distinct value ->> 'operacion') from jsonb_array_elements(p_lote -> 'cambios')) <> n then
    raise exception 'El lote repite una operación' using errcode = 'PT422';
  end if;

  -- Un lote a la vez por libro: los choques se evalúan contra la versión vigente.
  perform pg_advisory_xact_lock(hashtextextended(u::text || l, 0));
  select libro into principal from caudal_cuenta_libro where usuario = u;
  if principal is not null and principal <> l then
    raise exception '%', jsonb_build_object('libro_reemplazado', principal)::text using errcode = 'PT409';
  end if;
  select cursor, contenido into previo from caudal_lote where usuario = u and libro = l and clave = k;
  if found then
    if previo.contenido <> p_lote then
      raise exception 'La clave del lote ya corresponde a otros cambios' using errcode = 'PT409';
    end if;
    return jsonb_build_object('cursor', previo.cursor);
  end if;

  for c in select value from jsonb_array_elements(p_lote -> 'cambios') loop
    if cabezas ? (c ->> 'entidad_id') then
      previa := cabezas -> (c ->> 'entidad_id');
    else
      select jsonb_build_object('operacion', operacion, 'accion', accion) into previa
        from caudal_cabeza where usuario = u and libro = l and entidad_id = c ->> 'entidad_id';
    end if;
    if c ->> 'accion' = 'crear' then
      valido := (previa is null and coalesce(c -> 'version_base', 'null'::jsonb) = 'null'::jsonb)
        or (previa is not null and previa ->> 'accion' = 'eliminar' and c ->> 'version_base' = previa ->> 'operacion');
    else
      -- Sin versión registrada (entidades de la instantánea inicial) se acepta la primera edición.
      valido := previa is null
        or (previa ->> 'accion' <> 'eliminar' and c ->> 'version_base' = previa ->> 'operacion');
    end if;
    if not valido and not (c ->> 'entidad_id' = any (choques)) then
      choques := choques || (c ->> 'entidad_id');
    end if;
    cabezas := cabezas || jsonb_build_object(
      c ->> 'entidad_id', jsonb_build_object('operacion', c ->> 'operacion', 'accion', c ->> 'accion'));
    previa := null;
  end loop;
  if array_length(choques, 1) > 0 then
    raise exception '%', jsonb_build_object('conflicto', to_jsonb(choques))::text using errcode = 'PT409';
  end if;

  begin
    insert into caudal_operacion
      select u, l, value ->> 'operacion' from jsonb_array_elements(p_lote -> 'cambios');
  exception when unique_violation then
    raise exception 'Una operación ya pertenece a otro lote' using errcode = 'PT409';
  end;
  insert into caudal_lote (usuario, libro, clave, contenido) values (u, l, k, p_lote) returning cursor into nuevo;
  for c in select value from jsonb_array_elements(p_lote -> 'cambios') loop
    insert into caudal_cabeza values (u, l, c ->> 'entidad_id', c ->> 'operacion', c ->> 'accion')
      on conflict (usuario, libro, entidad_id) do update set operacion = excluded.operacion, accion = excluded.accion;
  end loop;
  return jsonb_build_object('cursor', nuevo);
end $$;

create or replace function public.caudal_lotes(p_libro text, p_desde bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cursor', t.cursor, 'contenido', t.contenido) order by t.cursor), '[]')
  from (
    select l.cursor, l.contenido from caudal_lote l
    where l.usuario = public.caudal_usuario() and l.libro = p_libro and l.cursor > p_desde
    order by l.cursor limit 20
  ) t
$$;

create or replace function public.caudal_guardar_instantanea(
  p_libro text, p_cursor bigint, p_principal boolean, p_resumen jsonb, p_contenido text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u uuid := public.caudal_usuario();
  actual text;
  maximo bigint;
  datos bytea;
begin
  if not public.caudal_identidad(p_libro) or p_cursor < 0 or jsonb_typeof(p_resumen) is distinct from 'object' then
    raise exception 'Instantánea no válida' using errcode = 'PT422';
  end if;
  datos := decode(p_contenido, 'base64');
  if octet_length(datos) = 0 or octet_length(datos) > 50000000 then
    raise exception 'La instantánea no tiene un tamaño válido' using errcode = 'PT413';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || 'cuenta', 0));
  actual := public.caudal_libro_principal(u);
  if actual is not null and actual <> p_libro and not p_principal then
    raise exception '%', jsonb_build_object('libro_reemplazado', actual)::text using errcode = 'PT409';
  end if;
  select coalesce(max(l.cursor), 0) into maximo from caudal_lote l
    where l.usuario = u and l.libro = p_libro;
  if p_cursor > maximo then
    raise exception 'La instantánea dice incluir cambios que el receptor no tiene' using errcode = 'PT422';
  end if;
  if actual is distinct from p_libro then
    insert into caudal_cuenta_libro values (u, p_libro, 1, now())
      on conflict (usuario) do update
      set libro = excluded.libro, generacion = caudal_cuenta_libro.generacion + 1, actualizado_en = now();
  end if;
  insert into caudal_instantanea values (u, p_libro, p_cursor, now(), p_resumen, datos)
    on conflict (usuario, libro) do update
    set cursor = excluded.cursor, creada_en = now(), resumen = excluded.resumen, contenido = excluded.contenido;
  return jsonb_build_object('guardada', true);
end $$;

create or replace function public.caudal_leer_instantanea(p_libro text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cursor', i.cursor, 'contenido', encode(i.contenido, 'base64'))
  from caudal_instantanea i
  where i.usuario = public.caudal_usuario() and i.libro = p_libro
$$;

-- Solo personas con sesión; nunca anónimos.
revoke execute on function public.caudal_usuario(), public.caudal_libro_principal(uuid), public.caudal_sesion(),
  public.caudal_cuenta(), public.caudal_recibir_lote(jsonb), public.caudal_lotes(text, bigint),
  public.caudal_guardar_instantanea(text, bigint, boolean, jsonb, text), public.caudal_leer_instantanea(text)
  from public, anon;
grant execute on function public.caudal_sesion(), public.caudal_cuenta(), public.caudal_recibir_lote(jsonb),
  public.caudal_lotes(text, bigint), public.caudal_guardar_instantanea(text, bigint, boolean, jsonb, text),
  public.caudal_leer_instantanea(text) to authenticated;
