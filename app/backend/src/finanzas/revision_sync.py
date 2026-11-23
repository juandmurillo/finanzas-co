"""Bandeja «Por revisar» del libro sincronizado.

Un lote remoto que parte de una versión distinta a la local no se aplica: se retiene completo
(las dos patas de una transferencia viajan juntas) y el resto del libro sigue sincronizando.
Al resolver, la historia remota se adopta como canónica, se descartan las operaciones locales
aún no enviadas de las entidades en choque y se emite una operación de fusión con el resultado
elegido, que parte de la última versión remota y por eso el receptor la admite.

Las altas independientes que coinciden en cuenta, importe y fecha cercana quedan como posible
duplicado sin bloquear nada.
"""

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from finanzas.sincronizacion import Cambio, Lote

REFERENCIAS = {
    "cuenta_id": "cuenta",
    "categoria_id": "categoria",
    "padre_id": "categoria",
    "transferencia_id": "transaccion",
}
# Cambian en cada guardado; no cuentan como diferencia que el usuario deba revisar.
SIN_COMPARAR = {"creado_en", "actualizado_en"}
CAMPOS_DUPLICADO = ("fecha", "descripcion", "nota", "categoria_id")
CAMPOS_CLAVE = {"nombre", "fecha", "monto", "descripcion", "cuenta_id", "categoria_id"}

Valor = str | int | float | None
Estado = dict[str, Valor] | None
Detalle = tuple[str, Valor, Valor, Valor, Valor]
Eleccion = Literal["local", "remoto", "campos"]


class RevisionNoEncontrada(LookupError):
    pass


@dataclass
class Choque:
    entidad: str
    entidad_id: str
    local: Estado
    base: Estado
    remoto: Estado


def _ahora() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _columnas(db: sqlite3.Connection, tabla: str) -> set[str]:
    return {r[1] for r in db.execute(f"PRAGMA table_info({tabla})")} - {"id", "id_global"}


def cabeza(db: sqlite3.Connection, libro: str, entidad: str, entidad_id: str) -> tuple[str, str] | None:
    """Última operación conocida de la entidad en este equipo: (operación, acción)."""
    fila = db.execute(
        """SELECT operacion, accion FROM cambio_pendiente WHERE libro_id=? AND entidad=? AND entidad_id=?
        ORDER BY secuencia DESC LIMIT 1""",
        (libro, entidad, entidad_id),
    ).fetchone()
    return (fila[0], fila[1]) if fila else None


def admite(previa: tuple[str, str] | None, c: Cambio) -> bool:
    """El cambio parte de la versión que este equipo tiene de la entidad."""
    if c.accion == "crear":
        return (previa is None and c.version_base is None) or (
            previa is not None and previa[1] == "eliminar" and c.version_base == previa[0]
        )
    if previa is None:
        return c.version_base == c.entidad_id
    return previa[1] != "eliminar" and c.version_base == previa[0]


def choques_del_lote(db: sqlite3.Connection, libro: str, lote: Lote) -> set[str]:
    cabezas: dict[str, tuple[str, str] | None] = {}
    choques = set()
    for c in lote.cambios:
        previa = cabezas[c.entidad_id] if c.entidad_id in cabezas else cabeza(db, libro, c.entidad, c.entidad_id)
        if not admite(previa, c):
            choques.add(c.entidad_id)
        cabezas[c.entidad_id] = (c.operacion, c.accion)
    return choques


def _a_global(db: sqlite3.Connection, campo: str, valor: Valor) -> Valor:
    if valor is None or campo not in REFERENCIAS:
        return valor
    fila = db.execute(f"SELECT id_global FROM {REFERENCIAS[campo]} WHERE id=?", (valor,)).fetchone()
    return str(fila[0]) if fila else None


def _a_local(db: sqlite3.Connection, campo: str, valor: Valor, estricto: bool = True) -> Valor:
    if valor is None or campo not in REFERENCIAS:
        return valor
    fila = db.execute(f"SELECT id FROM {REFERENCIAS[campo]} WHERE id_global=?", (valor,)).fetchone()
    if fila:
        return int(fila[0])
    if estricto:
        raise ValueError("La referencia aún no está disponible")
    return None


def _detalle_portable(db: sqlite3.Connection, campo: str, antes: Valor, despues: Valor) -> Detalle:
    """Fila de detalle_cambio a partir de valores en identidades globales."""
    es_ref = campo in REFERENCIAS
    return (
        campo,
        _a_local(db, campo, antes, estricto=False),
        _a_local(db, campo, despues, estricto=False),
        antes if es_ref else None,
        despues if es_ref else None,
    )


def registrar(
    db: sqlite3.Connection,
    libro: str,
    lote: str,
    operacion: str | None,
    entidad: str,
    entidad_id: str,
    accion: str,
    version_base: str | None,
    detalles: list[Detalle],
    remoto: bool,
) -> None:
    cur = db.execute(
        """INSERT INTO cambio_pendiente
        (libro_id,lote,operacion,entidad,entidad_id,accion,version_base,formato,remoto) VALUES (?,?,?,?,?,?,?,2,?)""",
        (libro, lote, operacion or uuid4().hex, entidad, entidad_id, accion, version_base, int(remoto)),
    )
    db.executemany(
        "INSERT INTO detalle_cambio (secuencia,campo,antes,despues,antes_global,despues_global) VALUES (?,?,?,?,?,?)",
        [(cur.lastrowid, *d) for d in detalles],
    )


def aplicar(db: sqlite3.Connection, libro: str, lote: str, c: Cambio) -> None:
    """Aplica un cambio remoto admitido. Requiere los disparadores apagados (sin fila en libro)."""
    tabla = c.entidad
    if not c.campos.keys() <= _columnas(db, tabla):
        raise ValueError("El cambio requiere otra versión de Caudal")
    existente = db.execute(f"SELECT id FROM {tabla} WHERE id_global=?", (c.entidad_id,)).fetchone()
    if not admite(cabeza(db, libro, tabla, c.entidad_id), c) or (c.accion == "crear") == bool(existente):
        raise ValueError("Conflicto de versiones: se conserva el cambio local")
    valores = {}
    detalles = []
    for campo, (antes, despues) in c.campos.items():
        if campo.endswith("_id") and campo not in REFERENCIAS and (antes is not None or despues is not None):
            raise ValueError("Referencia aún no compatible")
        # El valor anterior puede apuntar a algo ya borrado en el mismo lote (la otra pata).
        valores[campo] = _a_local(db, campo, despues)
        detalles.append(_detalle_portable(db, campo, antes, despues))
    if c.accion == "crear":
        valores["id_global"] = c.entidad_id
        db.execute(
            f"INSERT INTO {tabla} ({','.join(valores)}) VALUES ({','.join('?' for _ in valores)})",
            tuple(valores.values()),
        )
    elif c.accion == "editar":
        asignar = ",".join(f"{k}=?" for k in valores)
        db.execute(f"UPDATE {tabla} SET {asignar} WHERE id_global=?", (*valores.values(), c.entidad_id))
    else:
        db.execute(f"DELETE FROM {tabla} WHERE id_global=?", (c.entidad_id,))
    registrar(db, libro, lote, c.operacion, tabla, c.entidad_id, c.accion, c.version_base, detalles, remoto=True)


# ── Retención ────────────────────────────────────────────────────────────────


def entidades_retenidas(db: sqlite3.Connection, libro: str) -> dict[str, int]:
    """Entidad global → revisión abierta que la retiene."""
    filas = db.execute(
        """SELECT e.entidad_id, e.revision_id FROM revision_entidad e JOIN revision_sync r ON r.id=e.revision_id
        WHERE r.libro=? AND r.estado='abierta' AND r.tipo='version'""",
        (libro,),
    )
    return dict(filas.fetchall())


def retener(db: sqlite3.Connection, libro: str, lote: Lote, cursor: int, revisiones: set[int]) -> int:
    """Guarda el lote remoto sin aplicarlo; une las revisiones que comparten entidades."""
    if revisiones:
        rid, *otras = sorted(revisiones)
        for otra in otras:
            db.execute("UPDATE lote_retenido SET revision_id=? WHERE revision_id=?", (rid, otra))
            db.execute(
                """INSERT OR IGNORE INTO revision_entidad SELECT ?, entidad, entidad_id FROM revision_entidad
                WHERE revision_id=?""",
                (rid, otra),
            )
            db.execute("DELETE FROM revision_sync WHERE id=?", (otra,))
    else:
        nuevo = db.execute(
            "INSERT INTO revision_sync (libro,tipo,creada_en) VALUES (?,'version',?)", (libro, _ahora())
        ).lastrowid
        assert nuevo is not None
        rid = nuevo
    db.execute(
        "INSERT INTO lote_retenido VALUES (?,?,?,?,?)",
        (libro, lote.lote, cursor, lote.model_dump_json(), rid),
    )
    db.executemany(
        "INSERT OR IGNORE INTO revision_entidad VALUES (?,?,?)",
        [(rid, c.entidad, c.entidad_id) for c in lote.cambios],
    )
    return rid


def _lotes_retenidos(db: sqlite3.Connection, libro: str, rid: int) -> list[Lote]:
    filas = db.execute(
        "SELECT contenido FROM lote_retenido WHERE libro=? AND revision_id=? ORDER BY cursor", (libro, rid)
    )
    return [Lote.model_validate_json(contenido) for (contenido,) in filas]


# ── Estados para comparar ────────────────────────────────────────────────────


def _estado_local(db: sqlite3.Connection, entidad: str, entidad_id: str) -> Estado:
    cur = db.execute(f"SELECT * FROM {entidad} WHERE id_global=?", (entidad_id,))
    fila = cur.fetchone()
    if not fila:
        return None
    nombres = [d[0] for d in cur.description]
    return {k: _a_global(db, k, v) for k, v in zip(nombres, fila, strict=True) if k not in ("id", "id_global")}


def _pendientes(db: sqlite3.Connection, libro: str, entidad_id: str) -> list[tuple[int, str]]:
    """Operaciones registradas aquí que el receptor aún no confirmó."""
    return db.execute(
        """SELECT secuencia, accion FROM cambio_pendiente c WHERE libro_id=? AND entidad_id=? AND remoto=0
        AND NOT EXISTS (SELECT 1 FROM acuse_lote a WHERE a.libro=c.libro_id AND a.lote=c.lote)
        ORDER BY secuencia""",
        (libro, entidad_id),
    ).fetchall()


def _detalle(db: sqlite3.Connection, secuencia: int) -> dict[str, tuple[Valor, Valor]]:
    salida = {}
    for campo, antes, despues, ant_global, post_global in db.execute(
        "SELECT campo, antes, despues, antes_global, despues_global FROM detalle_cambio WHERE secuencia=?",
        (secuencia,),
    ):
        if campo in REFERENCIAS:
            antes = ant_global if ant_global is not None or antes is None else _a_global(db, campo, antes)
            despues = post_global if post_global is not None or despues is None else _a_global(db, campo, despues)
        salida[campo] = (antes, despues)
    return salida


def _base(db: sqlite3.Connection, libro: str, entidad_id: str, local: Estado) -> Estado:
    """Versión de partida: el estado local sin las operaciones locales aún no confirmadas."""
    pendientes = _pendientes(db, libro, entidad_id)
    if not pendientes:
        return local
    if pendientes[0][1] == "crear":
        return None
    base = dict(local or {})
    vistos: set[str] = set()
    for secuencia, _ in pendientes:
        for campo, (antes, _despues) in _detalle(db, secuencia).items():
            if campo not in vistos:
                vistos.add(campo)
                base[campo] = antes
    return base


def _remoto(base: Estado, cambios: list[Cambio]) -> Estado:
    estado = None if base is None else dict(base)
    for c in cambios:
        if c.accion == "eliminar":
            estado = None
        elif c.accion == "crear":
            estado = {k: d for k, (_a, d) in c.campos.items()}
        else:
            estado = {**(estado or {}), **{k: d for k, (_a, d) in c.campos.items()}}
    return estado


def _iguales(a: Estado, b: Estado) -> bool:
    if a is None or b is None:
        return a is b
    return all(a.get(k) == b.get(k) for k in (a.keys() | b.keys()) - SIN_COMPARAR)


def choques(db: sqlite3.Connection, libro: str, lotes: list[Lote]) -> dict[str, Choque]:
    """Entidades cuya primera versión remota retenida no parte de la versión local."""
    por_entidad: dict[str, tuple[str, list[Cambio]]] = {}
    for lote in lotes:
        for c in lote.cambios:
            por_entidad.setdefault(c.entidad_id, (c.entidad, []))[1].append(c)
    salida = {}
    for eid, (entidad, cambios) in por_entidad.items():
        if admite(cabeza(db, libro, entidad, eid), cambios[0]):
            continue
        local = _estado_local(db, entidad, eid)
        base = _base(db, libro, eid, local)
        salida[eid] = Choque(entidad, eid, local, base, _remoto(base, cambios))
    return salida


def _objetivo(ch: Choque, eleccion: Eleccion, campos: Mapping[str, str]) -> Estado:
    if eleccion == "local":
        objetivo = ch.local
    elif eleccion == "remoto":
        objetivo = ch.remoto
    else:
        if ch.local is None or ch.remoto is None:
            raise ValueError("Uno de los equipos lo eliminó: elige una de las dos versiones completas")
        base = ch.base or {}
        objetivo = {}
        for k in ch.local.keys() | ch.remoto.keys():
            mio, otro = ch.local.get(k), ch.remoto.get(k)
            if mio == otro:
                objetivo[k] = mio
            elif k in SIN_COMPARAR:
                objetivo[k] = max((v for v in (mio, otro) if v is not None), key=str)
            elif k in campos:
                objetivo[k] = mio if campos[k] == "local" else otro
            elif mio == base.get(k):
                objetivo[k] = otro
            elif otro == base.get(k):
                objetivo[k] = mio
            else:
                raise ValueError("Elige qué valor conservar en cada campo que cambió en los dos equipos")
    # Sin diferencias reales frente a la versión remota no hace falta emitir una fusión.
    return ch.remoto if _iguales(objetivo, ch.remoto) else objetivo


def es_trivial(db: sqlite3.Connection, libro: str, rid: int) -> bool:
    """Los dos equipos llegaron al mismo resultado (o ya no hay choque): se resuelve solo."""
    return all(_iguales(ch.local, ch.remoto) for ch in choques(db, libro, _lotes_retenidos(db, libro, rid)).values())


# ── Resolución ───────────────────────────────────────────────────────────────


def _escribir(db: sqlite3.Connection, choques_: dict[str, Choque], objetivos: dict[str, Estado]) -> None:
    diferidas = []
    borrados = []
    for eid, ch in choques_.items():
        objetivo, actual = objetivos[eid], ch.local
        if objetivo is None:
            if actual is not None:
                borrados.append((ch.entidad, eid))
            continue
        valores = {}
        for k, v in objetivo.items():
            if actual is not None and actual.get(k) == v:
                continue
            try:
                valores[k] = _a_local(db, k, v)
            except ValueError:
                # La otra pata de una transferencia puede escribirse después.
                valores[k] = None
                diferidas.append((ch.entidad, eid, k, v))
        if actual is None:
            valores["id_global"] = eid
            db.execute(
                f"INSERT INTO {ch.entidad} ({','.join(valores)}) VALUES ({','.join('?' for _ in valores)})",
                tuple(valores.values()),
            )
        elif valores:
            asignar = ",".join(f"{k}=?" for k in valores)
            db.execute(f"UPDATE {ch.entidad} SET {asignar} WHERE id_global=?", (*valores.values(), eid))
    for tabla, eid, k, v in diferidas:
        db.execute(f"UPDATE {tabla} SET {k}=? WHERE id_global=?", (_a_local(db, k, v), eid))
    for tabla, eid in borrados:
        db.execute(f"DELETE FROM {tabla} WHERE id_global=?", (eid,))


def _fusion(db: sqlite3.Connection, libro: str, lote: str, ch: Choque, objetivo: Estado) -> bool:
    remoto = ch.remoto
    if objetivo is remoto:
        return False
    previa = cabeza(db, libro, ch.entidad, ch.entidad_id)
    base = previa[0] if previa else ch.entidad_id
    pares: dict[str, tuple[Valor, Valor]]
    if objetivo is None:
        assert remoto is not None
        accion, pares = "eliminar", {k: (v, None) for k, v in remoto.items()}
    elif remoto is None:
        accion, pares = "crear", {k: (None, v) for k, v in objetivo.items()}
    else:
        accion = "editar"
        pares = {k: (remoto.get(k), v) for k, v in objetivo.items() if remoto.get(k) != v}
    detalles = [_detalle_portable(db, k, a, d) for k, (a, d) in pares.items()]
    registrar(db, libro, lote, None, ch.entidad, ch.entidad_id, accion, base, detalles, remoto=False)
    return True


def resolver_version(
    db: sqlite3.Connection,
    libro: str,
    rid: int,
    eleccion: Eleccion,
    campos: Mapping[str, Mapping[str, str]] | None = None,
) -> None:
    db.execute("PRAGMA foreign_keys=ON")
    with db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT id_global FROM libro").fetchone() != (libro,):
            raise ValueError("El libro cambió")
        fila = db.execute("SELECT tipo, estado FROM revision_sync WHERE id=? AND libro=?", (rid, libro)).fetchone()
        if fila != ("version", "abierta"):
            raise RevisionNoEncontrada
        lotes = _lotes_retenidos(db, libro, rid)
        choques_ = choques(db, libro, lotes)
        objetivos = {eid: _objetivo(ch, eleccion, (campos or {}).get(eid, {})) for eid, ch in choques_.items()}
        # Sin la fila del libro los disparadores no registran estas escrituras como cambios nuevos.
        db.execute("DELETE FROM libro")
        for lote in lotes:
            for c in lote.cambios:
                if c.entidad_id in choques_:
                    registrar(db, libro, lote.lote, c.operacion, c.entidad, c.entidad_id, c.accion,
                              c.version_base, [], remoto=True)  # fmt: skip
                else:
                    aplicar(db, libro, lote.lote, c)
        for eid in choques_:
            for secuencia, _ in _pendientes(db, libro, eid):
                db.execute("DELETE FROM detalle_cambio WHERE secuencia=?", (secuencia,))
                db.execute("DELETE FROM cambio_pendiente WHERE secuencia=?", (secuencia,))
        _escribir(db, choques_, objetivos)
        nuevo = uuid4().hex
        for eid, ch in choques_.items():
            _fusion(db, libro, nuevo, ch, objetivos[eid])
        db.execute("DELETE FROM lote_retenido WHERE revision_id=?", (rid,))
        db.execute(
            "UPDATE revision_sync SET estado='resuelta', decision=?, resuelta_en=? WHERE id=?",
            (eleccion, _ahora(), rid),
        )
        db.execute("INSERT INTO libro(unico,id_global) VALUES(1,?)", (libro,))
        for lote in lotes:
            detectar_duplicados(db, libro, lote)


# ── Posibles duplicados ──────────────────────────────────────────────────────


def _simple(alias: str) -> str:
    """Solo movimientos sueltos: transferencias, créditos y préstamos tienen sus propias reglas."""
    return " AND ".join(f"{alias}.{c} IS NULL" for c in ("transferencia_id", "credito_id", "prestamo_id"))


def detectar_duplicados(db: sqlite3.Connection, libro: str, lote: Lote) -> None:
    """Un alta remota parecida a un alta hecha en este equipo queda como posible duplicado."""
    for c in lote.cambios:
        if c.entidad != "transaccion" or c.accion != "crear":
            continue
        fila = db.execute(
            f"SELECT cuenta_id, monto, fecha FROM transaccion t WHERE id_global=? AND {_simple('t')}",
            (c.entidad_id,),
        ).fetchone()
        if not fila:
            continue
        candidatos = db.execute(
            f"""SELECT t.id_global FROM transaccion t WHERE t.cuenta_id=? AND t.monto=? AND t.id_global<>?
            AND {_simple("t")}
            AND abs(julianday(substr(t.fecha,1,10)) - julianday(substr(?,1,10))) <= 3
            AND EXISTS (SELECT 1 FROM cambio_pendiente p WHERE p.entidad='transaccion'
                AND p.entidad_id=t.id_global AND p.accion='crear' AND p.remoto=0)""",
            (fila[0], fila[1], c.entidad_id, fila[2]),
        ).fetchall()
        for (otro,) in candidatos:
            a, b = sorted((otro, c.entidad_id))
            db.execute(
                "INSERT OR IGNORE INTO revision_sync (libro,tipo,creada_en,a_id,b_id) VALUES (?,'duplicado',?,?,?)",
                (libro, _ahora(), a, b),
            )


def resolver_duplicado(
    db: sqlite3.Connection, libro: str, rid: int, decision: Literal["dos", "mismo"], campos: dict[str, str]
) -> None:
    """«Es el mismo gasto» conserva el de identidad menor (igual en ambos equipos) con los datos elegidos."""
    db.execute("PRAGMA foreign_keys=ON")
    with db:
        db.execute("BEGIN IMMEDIATE")
        fila = db.execute(
            "SELECT a_id, b_id FROM revision_sync WHERE id=? AND libro=? AND tipo='duplicado' AND estado='abierta'",
            (rid, libro),
        ).fetchone()
        if not fila:
            raise RevisionNoEncontrada
        a, b = fila
        if decision == "mismo":
            if not campos.keys() <= set(CAMPOS_DUPLICADO) or not set(campos.values()) <= {a, b}:
                raise ValueError("Elige los datos de uno de los dos movimientos")
            ids = dict(db.execute("SELECT id_global, id FROM transaccion WHERE id_global IN (?,?)", (a, b)))
            if len(ids) != 2:
                raise ValueError("Uno de los movimientos ya no existe")
            lote = uuid4().hex
            db.execute("UPDATE libro SET lote_activo=?", (lote,))
            copiar = [k for k, origen in campos.items() if origen == b]
            if copiar:
                asignar = ",".join(f"{k}=(SELECT {k} FROM transaccion WHERE id=?)" for k in copiar)
                db.execute(f"UPDATE transaccion SET {asignar} WHERE id=?", (*[ids[b]] * len(copiar), ids[a]))
            db.execute("DELETE FROM transaccion_etiqueta WHERE transaccion_id=?", (ids[b],))
            db.execute("DELETE FROM transaccion WHERE id=?", (ids[b],))
            db.execute("UPDATE libro SET lote_activo=NULL")
        db.execute(
            "UPDATE revision_sync SET estado='resuelta', decision=?, resuelta_en=? WHERE id=?",
            (decision, _ahora(), rid),
        )


# ── Consulta para la interfaz ────────────────────────────────────────────────


def _texto(db: sqlite3.Connection, campo: str, valor: Valor) -> Valor:
    """Las referencias se muestran por nombre, nunca por identidad."""
    if valor is None or campo not in REFERENCIAS:
        return valor
    columna = "descripcion" if REFERENCIAS[campo] == "transaccion" else "nombre"
    fila = db.execute(f"SELECT {columna} FROM {REFERENCIAS[campo]} WHERE id_global=?", (valor,)).fetchone()
    return fila[0] if fila else "—"


def _titulo(estado: Estado, entidad: str) -> str:
    estado = estado or {}
    if entidad == "transaccion":
        return str(estado.get("descripcion") or "Movimiento sin descripción")
    return str(estado.get("nombre") or entidad.capitalize())


def _resumen(db: sqlite3.Connection, id_global: str) -> dict[str, object] | None:
    fila = db.execute(
        """SELECT t.fecha, t.monto, c.nombre, t.descripcion, t.nota, k.nombre,
        EXISTS (SELECT 1 FROM cambio_pendiente p WHERE p.entidad='transaccion' AND p.entidad_id=t.id_global
            AND p.accion='crear' AND p.remoto=1)
        FROM transaccion t JOIN cuenta c ON c.id=t.cuenta_id LEFT JOIN categoria k ON k.id=t.categoria_id
        WHERE t.id_global=?""",
        (id_global,),
    ).fetchone()
    if not fila:
        return None
    fecha, monto, cuenta, descripcion, nota, categoria, remoto = fila
    return {
        "id": id_global,
        "origen": "otro_equipo" if remoto else "este_equipo",
        "fecha": fecha,
        "monto": monto,
        "cuenta": cuenta,
        "descripcion": descripcion,
        "nota": nota,
        "categoria": categoria,
    }


def cerrar_obsoletas(db: sqlite3.Connection, libro: str) -> None:
    """Un posible duplicado del que ya falta un movimiento (lo resolvió el otro equipo) se cierra solo."""
    with db:
        db.execute(
            """UPDATE revision_sync SET estado='resuelta', decision='ya_no_existe', resuelta_en=?
            WHERE libro=? AND tipo='duplicado' AND estado='abierta' AND (
                NOT EXISTS (SELECT 1 FROM transaccion WHERE id_global=a_id)
                OR NOT EXISTS (SELECT 1 FROM transaccion WHERE id_global=b_id))""",
            (_ahora(), libro),
        )


def listar(db: sqlite3.Connection, libro: str) -> list[dict[str, object]]:
    cerrar_obsoletas(db, libro)
    salida: list[dict[str, object]] = []
    filas = db.execute(
        """SELECT id, tipo, creada_en, a_id, b_id FROM revision_sync WHERE libro=? AND estado='abierta'
        ORDER BY id""",
        (libro,),
    ).fetchall()
    for rid, tipo, creada_en, a, b in filas:
        if tipo == "duplicado":
            movimientos = [_resumen(db, a), _resumen(db, b)]
            salida.append({"id": rid, "tipo": tipo, "creada_en": creada_en, "movimientos": movimientos})
            continue
        entidades = []
        for ch in choques(db, libro, _lotes_retenidos(db, libro, rid)).values():
            base = ch.base or {}
            # Si un equipo lo eliminó se muestran los datos clave de la versión que sigue viva.
            vivos = ch.local is not None and ch.remoto is not None
            campos = []
            for k in sorted((ch.local or {}).keys() | (ch.remoto or {}).keys()):
                mio, otro = (ch.local or {}).get(k), (ch.remoto or {}).get(k)
                if k in SIN_COMPARAR or (vivos and mio == otro) or (not vivos and k not in CAMPOS_CLAVE):
                    continue
                campos.append(
                    {
                        "campo": k,
                        "base": _texto(db, k, base.get(k)),
                        "local": _texto(db, k, mio),
                        "remoto": _texto(db, k, otro),
                        "ambos": vivos and mio != base.get(k) and otro != base.get(k),
                    }
                )
            entidades.append(
                {
                    "entidad": ch.entidad,
                    "entidad_id": ch.entidad_id,
                    "titulo": _titulo(ch.local or ch.remoto or ch.base, ch.entidad),
                    "local_existe": ch.local is not None,
                    "remoto_existe": ch.remoto is not None,
                    "campos": campos,
                }
            )
        salida.append({"id": rid, "tipo": tipo, "creada_en": creada_en, "entidades": entidades})
    return salida
