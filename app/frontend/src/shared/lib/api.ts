/** Cliente HTTP de la API local (mismo origen gracias al proxy de Vite). */
import type {
  ActivoNuevo,
  ReporteActivos,
  SeriePatrimonio,
  TipoMovimientoActivo,
  Sistema,
  AcumuladoPresupuesto,
  Amortizacion,
  CategoriaFrecuente,
  CreditoCerrado,
  CreditoDetalle,
  CreditoNuevo,
  Prestamo,
  PrestamoNuevo,
  PresupuestoMes,
  ResumenPrestamos,
  Simulacion,
  VistaPreviaPrestamo,
  CategoriaNodo,
  Cuenta,
  CuentaCambios,
  CuentaNueva,
  Dashboard,
  MesFlujo,
  PaginaTransacciones,
  Sugerencia,
  Transaccion,
  TransaccionCambios,
  TransaccionNueva,
  Transferencia,
  DescripcionReporte,
  Grupo,
  ReporteCategorias,
  ReporteMensual,
  ResumenApuestas,
  RevisionMensual,
  Sankey,
  Alerta,
  Calendario,
  CondicionRegla,
  Detectado,
  ListaRecurrentes,
  Meta,
  MetaNueva,
  Precision,
  RecurrenteNuevo,
  Regla,
  ReglaNueva,
  Respaldo,
  ResultadoImportacion,
  VistaPreviaDatos,
  SugerenciaCategoria,
  AbonoUnico,
  CompraCartera,
  CompraCarteraIn,
  EstadoAsistente,
  ParametroCO,
  RespuestaAsistente,
  Termometro,
  Trm,
  GrupoPresupuestoIn,
  HistoricoPresupuesto,
} from "@/shared/api/tipos";

const BASE = "/api/v1";

/** Error con el detalle de application/problem+json (RFC 9457). */
export class ErrorApi extends Error {
  constructor(
    public estado: number,
    public titulo: string,
    detalle: string,
  ) {
    super(detalle || titulo);
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!respuesta.ok) {
    let titulo = respuesta.statusText;
    let detalle = "";
    try {
      const cuerpo = (await respuesta.json()) as { title?: string; detail?: unknown };
      titulo = cuerpo.title ?? titulo;
      detalle = typeof cuerpo.detail === "string" ? cuerpo.detail : JSON.stringify(cuerpo.detail ?? "");
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    throw new ErrorApi(respuesta.status, titulo, detalle);
  }
  return respuesta.status === 204 ? (undefined as T) : ((await respuesta.json()) as T);
}

function conArchivo(archivo: File): FormData {
  const cuerpo = new FormData();
  cuerpo.append("archivo", archivo);
  return cuerpo;
}

export interface FiltroTransacciones {
  desde?: string;
  hasta?: string;
  cuenta_id?: number;
  grupo?: string;
  categoria_id?: number;
  texto?: string;
  estado?: string;
  cursor?: string;
  limite?: number;
}

/** Rango de meses AAAA-MM (ambos incluidos); sin valor = desde el inicio / hasta hoy. */
export interface Periodo {
  desde?: string;
  hasta?: string;
}

const query = (params: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  const texto = p.toString();
  return texto ? `?${texto}` : "";
};

export const api = {
  activos: () => pedir<ReporteActivos>("/activos"),
  crearActivo: (d: ActivoNuevo) => pedir<{ id: number }>("/activos", { method: "POST", body: JSON.stringify(d) }),
  editarActivo: (id: number, d: Partial<ActivoNuevo>) =>
    pedir<undefined>(`/activos/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  eliminarActivo: (id: number) => pedir<undefined>(`/activos/${id}`, { method: "DELETE" }),
  valorarActivo: (id: number, fecha: string, valor: number) =>
    pedir<undefined>(`/activos/${id}/valoraciones`, { method: "POST", body: JSON.stringify({ fecha, valor }) }),
  moverActivo: (
    id: number,
    d: { tipo: TipoMovimientoActivo; monto: number; fecha: string; cuenta_id: number | null },
  ) => pedir<{ id: number }>(`/activos/${id}/movimientos`, { method: "POST", body: JSON.stringify(d) }),
  deshacerMovimientoActivo: (id: number, movimiento: number) =>
    pedir<undefined>(`/activos/${id}/movimientos/${movimiento}`, { method: "DELETE" }),
  patrimonio: (p: Periodo = {}, escala: "mes" | "movimiento" = "mes") =>
    pedir<SeriePatrimonio>(`/reportes/patrimonio${query({ ...p, escala })}`),
  sistema: () => pedir<Sistema>("/sistema"),
  primerUso: (nombre: string, modo: "vacio" | "demo") =>
    pedir<undefined>("/sistema/primer-uso", { method: "POST", body: JSON.stringify({ nombre, modo }) }),
  ajustarSistema: (cambios: Partial<Pick<Sistema, "nombre" | "perfil" | "modulo_apuestas">>) =>
    pedir<undefined>("/sistema", { method: "PATCH", body: JSON.stringify(cambios) }),
  cuentas: () => pedir<Cuenta[]>("/cuentas"),
  crearCuenta: (datos: CuentaNueva) => pedir<Cuenta>("/cuentas", { method: "POST", body: JSON.stringify(datos) }),
  editarCuenta: (id: number, datos: CuentaCambios) =>
    pedir<undefined>(`/cuentas/${id}`, { method: "PATCH", body: JSON.stringify(datos) }),
  transacciones: (f: FiltroTransacciones) => pedir<PaginaTransacciones>(`/transacciones${query(f)}`),
  crearTransaccion: (datos: TransaccionNueva) =>
    pedir<Transaccion>("/transacciones", { method: "POST", body: JSON.stringify(datos) }),
  editarTransaccion: (id: number, cambios: TransaccionCambios) =>
    pedir<Transaccion>(`/transacciones/${id}`, { method: "PATCH", body: JSON.stringify(cambios) }),
  transaccion: (id: number) => pedir<Transaccion>(`/transacciones/${id}`),
  eliminarTransaccion: (id: number) => pedir<undefined>(`/transacciones/${id}`, { method: "DELETE" }),
  transferir: (datos: Transferencia) =>
    pedir<Transaccion[]>("/transferencias", { method: "POST", body: JSON.stringify(datos) }),
  categorias: () => pedir<CategoriaNodo[]>("/categorias"),
  sugerencias: (texto: string) => pedir<Sugerencia[]>(`/sugerencias${query({ texto })}`),
  categoriasFrecuentes: (tipo: "gasto" | "ingreso") =>
    pedir<CategoriaFrecuente[]>(`/sugerencias/categorias?tipo=${tipo}`),
  dashboard: () => pedir<Dashboard>("/reportes/dashboard"),
  flujo: (meses = 12) => pedir<MesFlujo[]>(`/reportes/flujo?meses=${meses}`),
  creditos: () => pedir<CreditoDetalle[]>("/creditos"),
  crearCredito: (datos: CreditoNuevo) =>
    pedir<{ id: number }>("/creditos", { method: "POST", body: JSON.stringify(datos) }),
  editarCredito: (id: number, datos: CreditoNuevo) =>
    pedir<undefined>(`/creditos/${id}`, { method: "PUT", body: JSON.stringify(datos) }),
  eliminarCredito: (id: number) => pedir<{ movimientos: number }>(`/creditos/${id}`, { method: "DELETE" }),
  marcarCreditoPagado: (id: number) =>
    pedir<{ programadas_quitadas: number }>(`/creditos/${id}/pagado`, { method: "POST" }),
  creditosCerrados: () => pedir<CreditoCerrado[]>("/creditos/cerrados"),
  amortizacion: (id: number) => pedir<Amortizacion>(`/creditos/${id}/amortizacion`),
  simulacion: (abonoExtra: number, estrategia: string) =>
    pedir<Simulacion>(`/creditos/simulacion${query({ abono_extra: abonoExtra, estrategia })}`),
  cargarExtracto: (id: number, datos: object) =>
    pedir<unknown>(`/creditos/${id}/extractos`, { method: "POST", body: JSON.stringify(datos) }),
  usura: () => pedir<{ consumo: number | null; consumo_bajo_monto: number | null }>("/parametros/usura"),
  presupuesto: (mes: string) => pedir<PresupuestoMes>(`/presupuestos/${mes}`),
  asignar: (mes: string, grupoId: number, asignado: number) =>
    pedir<undefined>(`/presupuestos/${mes}/grupos/${grupoId}`, { method: "PUT", body: JSON.stringify({ asignado }) }),
  quitarAsignacion: (mes: string, grupoId: number) =>
    pedir<undefined>(`/presupuestos/${mes}/grupos/${grupoId}`, { method: "DELETE" }),
  crearGrupo: (datos: GrupoPresupuestoIn) =>
    pedir<{ id: number }>("/presupuestos-grupos", { method: "POST", body: JSON.stringify(datos) }),
  editarGrupo: (id: number, datos: GrupoPresupuestoIn) =>
    pedir<undefined>(`/presupuestos-grupos/${id}`, { method: "PUT", body: JSON.stringify(datos) }),
  eliminarGrupo: (id: number) => pedir<undefined>(`/presupuestos-grupos/${id}`, { method: "DELETE" }),
  acumuladoPresupuesto: (mes: string, grupo?: number) =>
    pedir<AcumuladoPresupuesto>(`/presupuestos/${mes}/acumulado${query({ grupo })}`),
  historicoPresupuesto: (desde: string, hasta: string, grupo?: number) =>
    pedir<HistoricoPresupuesto>(`/presupuestos-historico${query({ desde, hasta, grupo })}`),
  crearCategoria: (datos: { padre_id: number; nombre: string; icono?: string | null; color?: string | null }) =>
    pedir<{ id: number }>("/categorias", { method: "POST", body: JSON.stringify(datos) }),
  editarCategoria: (
    id: number,
    cambios: { nombre?: string; icono?: string | null; color?: string | null; padre_id?: number },
  ) => pedir<undefined>(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify(cambios) }),
  eliminarCategoria: (id: number, destino: number) =>
    pedir<{ movidos: number }>(`/categorias/${id}${query({ destino })}`, { method: "DELETE" }),
  copiarPresupuesto: (mes: string, desde: string) =>
    pedir<{ copiadas: number }>(`/presupuestos/${mes}/copiar${query({ desde })}`, { method: "POST" }),
  marcarFijo: (categoriaId: number, esFijo: boolean) =>
    pedir<undefined>(`/categorias/${categoriaId}`, { method: "PATCH", body: JSON.stringify({ es_fijo: esFijo }) }),
  prestamos: (estado?: string) => pedir<Prestamo[]>(`/prestamos${query({ estado })}`),
  prestamo: (id: number) => pedir<Prestamo>(`/prestamos/${id}`),
  resumenPrestamos: () => pedir<ResumenPrestamos>("/prestamos/resumen"),
  simularPrestamo: (datos: PrestamoNuevo) =>
    pedir<VistaPreviaPrestamo>("/prestamos/simular", { method: "POST", body: JSON.stringify(datos) }),
  crearPrestamo: (datos: PrestamoNuevo) =>
    pedir<{ id: number }>("/prestamos", { method: "POST", body: JSON.stringify(datos) }),
  abonar: (id: number, datos: { monto: number; cuenta_id: number; fecha?: string }) =>
    pedir<unknown>(`/prestamos/${id}/abonos`, { method: "POST", body: JSON.stringify(datos) }),
  condonar: (id: number) => pedir<undefined>(`/prestamos/${id}/condonar`, { method: "POST" }),
  valorNeto: (p: Periodo, escala: "mes" | "dia" | "movimiento") =>
    pedir<{ escala: string; puntos: { fecha: string; saldo: number }[]; cuentas: string[] }>(
      `/reportes/valor-neto${query({ ...p, escala })}`,
    ),
  calor: (p: Periodo) =>
    pedir<{
      dias: { fecha: string; gasto: number; ingreso: number; n: number }[];
      max_gasto: number;
      max_ingreso: number;
    }>(`/reportes/calor${query(p)}`),
  reporteMensual: (p: Periodo) => pedir<ReporteMensual>(`/reportes/mensual${query(p)}`),
  sankey: (p: Periodo) => pedir<Sankey>(`/reportes/sankey${query(p)}`),
  reporteCategorias: (p: Periodo, grupo: Grupo) =>
    pedir<ReporteCategorias>(`/reportes/categorias${query({ ...p, grupo })}`),
  /** Todos los gastos o todos los ingresos, por categoría. */
  reporteConjunto: (p: Periodo, conjunto: "gastos" | "ingresos") =>
    pedir<ReporteCategorias>(`/reportes/categorias${query({ ...p, conjunto })}`),
  descripciones: (p: Periodo, grupo?: Grupo, conjunto?: "gastos" | "ingresos") =>
    pedir<DescripcionReporte[]>(`/reportes/descripciones${query({ ...p, grupo, conjunto, limite: 15 })}`),
  apuestas: (p: Periodo) => pedir<ResumenApuestas>(`/reportes/apuestas${query(p)}`),
  revision: (mes: string) => pedir<RevisionMensual>(`/reportes/revision/${mes}`),
  clasificar: (descripcion: string, monto: number, cuentaId?: number | null) =>
    pedir<SugerenciaCategoria[]>(
      `/sugerencias/clasificar${query({ descripcion, monto, cuenta_id: cuentaId ?? undefined })}`,
    ),
  precision: () => pedir<Precision>("/sugerencias/precision"),
  reglas: () => pedir<Regla[]>("/reglas"),
  crearRegla: (datos: ReglaNueva) => pedir<{ id: number }>("/reglas", { method: "POST", body: JSON.stringify(datos) }),
  editarRegla: (id: number, datos: ReglaNueva) =>
    pedir<undefined>(`/reglas/${id}`, { method: "PUT", body: JSON.stringify(datos) }),
  eliminarRegla: (id: number) => pedir<undefined>(`/reglas/${id}`, { method: "DELETE" }),
  probarRegla: (condiciones: CondicionRegla[]) =>
    pedir<{ total: number; muestra: { id: number; fecha: string; descripcion: string; monto: number }[] }>(
      "/reglas/probar",
      { method: "POST", body: JSON.stringify(condiciones) },
    ),
  recurrentes: () => pedir<ListaRecurrentes>("/recurrentes"),
  detectarRecurrentes: () => pedir<Detectado[]>("/recurrentes/detectar"),
  crearRecurrente: (datos: RecurrenteNuevo) =>
    pedir<{ id: number }>("/recurrentes", { method: "POST", body: JSON.stringify(datos) }),
  editarRecurrente: (id: number, datos: RecurrenteNuevo) =>
    pedir<undefined>(`/recurrentes/${id}`, { method: "PUT", body: JSON.stringify(datos) }),
  eliminarRecurrente: (id: number) => pedir<undefined>(`/recurrentes/${id}`, { method: "DELETE" }),
  estadoRecurrente: (id: number, estado: "activo" | "pausado" | "cancelado") =>
    pedir<undefined>(`/recurrentes/${id}/estado`, { method: "POST", body: JSON.stringify({ estado }) }),
  omitirProgramada: (id: number) => pedir<undefined>(`/programadas/${id}/omitir`, { method: "POST" }),
  pagarProgramada: (id: number, datos: { fecha?: string; monto?: number; fecha_modo?: "hoy" | "programada" } = {}) =>
    pedir<undefined>(`/programadas/${id}/pagar`, { method: "POST", body: JSON.stringify(datos) }),
  calendario: (dias = 45) => pedir<Calendario>(`/calendario${query({ dias })}`),
  metas: () => pedir<Meta[]>("/metas"),
  crearMeta: (datos: MetaNueva) => pedir<{ id: number }>("/metas", { method: "POST", body: JSON.stringify(datos) }),
  editarMeta: (id: number, datos: MetaNueva) =>
    pedir<undefined>(`/metas/${id}`, { method: "PUT", body: JSON.stringify(datos) }),
  eliminarMeta: (id: number) => pedir<undefined>(`/metas/${id}`, { method: "DELETE" }),
  estadoMeta: (id: number, estado: Meta["estado"]) =>
    pedir<undefined>(`/metas/${id}`, { method: "PATCH", body: JSON.stringify({ estado }) }),
  alertas: () => pedir<Alerta[]>("/alertas"),
  respaldos: () => pedir<Respaldo[]>("/respaldos"),
  respaldar: () => pedir<{ archivo: string | null }>("/respaldos", { method: "POST" }),
  restaurarRespaldo: (archivo: string) =>
    pedir<{ respaldo: string | null }>(`/respaldos/${encodeURIComponent(archivo)}/restaurar`, { method: "POST" }),
  vistaPreviaDatos: (archivo: File) =>
    pedir<VistaPreviaDatos>("/datos/vista-previa", { method: "POST", body: conArchivo(archivo) }),
  cargarDatos: (archivo: File) =>
    pedir<{ respaldo: string | null }>("/datos/cargar", { method: "POST", body: conArchivo(archivo) }),
  importarCashew: (archivo: File) =>
    pedir<ResultadoImportacion>("/importar/cashew", { method: "POST", body: conArchivo(archivo) }),
  borrarTodo: (confirmacion: string) =>
    pedir<{ respaldo: string | null }>("/datos/borrar-todo", {
      method: "POST",
      body: JSON.stringify({ confirmacion }),
    }),
  abonoUnico: (id: number, abono: number) => pedir<AbonoUnico>(`/creditos/${id}/abono-unico${query({ abono })}`),
  compraCartera: (datos: CompraCarteraIn) =>
    pedir<CompraCartera>("/creditos/compra-cartera", { method: "POST", body: JSON.stringify(datos) }),
  parametros: () => pedir<ParametroCO[]>("/parametros"),
  guardarParametro: (datos: ParametroCO) =>
    pedir<undefined>("/parametros", { method: "PUT", body: JSON.stringify(datos) }),
  trm: (fecha?: string) => pedir<Trm>(`/parametros/trm${query({ fecha })}`),
  termometro: (anio?: number) => pedir<Termometro>(`/impuestos/termometro${query({ anio })}`),
  estadoAsistente: () => pedir<EstadoAsistente>("/asistente/estado"),
  consentimientoAsistente: (activo: boolean) =>
    pedir<undefined>("/asistente/consentimiento", { method: "PUT", body: JSON.stringify({ activo }) }),
  configurarAsistente: (d: { proveedor: string; modelo?: string; clave?: string }) =>
    pedir<undefined>("/asistente/config", { method: "PUT", body: JSON.stringify(d) }),
  preguntar: (pregunta: string, historial: { rol: "yo" | "asistente"; texto: string }[] = []) =>
    pedir<RespuestaAsistente>("/asistente/preguntar", {
      method: "POST",
      body: JSON.stringify({ pregunta, historial }),
    }),
  /** URL de descarga directa (el navegador guarda el .xlsx). */
  urlExcel: (p: Periodo) => `${BASE}/exportar/excel${query(p)}`,
};
