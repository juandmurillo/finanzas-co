/**
 * Tipos de la API. Los DTO con response_model salen de types.gen.ts (openapi-typescript);
 * los reportes (dict libre en el backend) se describen aquí a mano.
 */
import type { components } from "./types.gen";

type S = components["schemas"];

export type Cuenta = S["CuentaOut"];
export type CuentaNueva = S["CuentaIn"];
export type CuentaCambios = S["CuentaCambios"];
export type Transaccion = S["TransaccionOut"];
export type TransaccionNueva = S["TransaccionIn"];
export type TransaccionCambios = S["TransaccionCambios"];
export type PaginaTransacciones = S["PaginaTransacciones"];
export type Transferencia = S["TransferenciaIn"];
export type CategoriaNodo = S["CategoriaNodo"];

export type Grupo =
  | "ingreso"
  | "gasto_vida"
  | "servicio_deuda"
  | "apuestas"
  | "ahorro_inversion"
  | "prestamos_personales"
  | "financiacion"
  | "transferencia"
  | "ajuste";

export interface MesFlujo {
  mes: string;
  ingresos: number;
  gasto_vida: number;
  servicio_deuda: number;
  apuestas_neto: number;
  flujo_operativo: number;
}

export interface Credito {
  id: number;
  nombre: string;
  entidad: string;
  numero: string | null;
  tasa_ea: number;
  cuota: number;
  seguro_mensual: number;
  dia_pago: number;
  saldo: number;
  fecha_saldo: string;
  cuotas_pendientes: number;
  prioridad_avalancha: number;
}

export interface Dashboard {
  mes: string;
  saldo_total: number;
  cuentas: Cuenta[];
  deuda_total: number;
  cuotas_mes: number;
  creditos: Credito[];
  flujo: MesFlujo[];
  mes_actual: MesFlujo | null;
  gasto_categorias: { categoria: string; total: number; n: number }[];
  proximos_pagos: (Transaccion & { dias: number })[];
  /** Pagos de deuda programados en los próximos 30 días (centavos, positivo). */
  cuotas_proximas: number;
}

export interface Sugerencia {
  descripcion: string;
  veces: number;
  monto: number;
  cuenta_id: number;
  cuenta: string;
  categoria_id: number | null;
  categoria_ruta: string[];
}

export interface CategoriaFrecuente {
  categoria_id: number;
  ruta: string[];
  veces: number;
}

/** Evento de dominio recibido por SSE (ADR-0003). */
export interface EventoCambio {
  entidades: string[];
  accion: string;
  ids: number[];
  version: number;
  fecha: string;
}

// ---------- Fase 3 ----------
/** Un presupuesto (grupo de categorías con un monto mensual). */
export interface FilaPresupuesto {
  id: number;
  nombre: string;
  icono: string | null;
  color: string | null;
  es_fijo: boolean;
  categorias: { id: number; ruta: string[] }[];
  asignado: number;
  tiene_asignacion: boolean;
  /** El monto viene de un mes anterior (rige hasta que se edite). */
  heredado: boolean;
  gastado: number;
  disponible: number;
  pct: number;
}

export interface GrupoPresupuestoIn {
  nombre: string;
  categoria_ids: number[];
  icono?: string | null;
  color?: string | null;
  es_fijo?: boolean;
}

export interface HistoricoPresupuesto {
  grupos: { id: number; nombre: string }[];
  meses: {
    mes: string;
    asignado: number;
    gastado: number;
    grupos: Record<string, { asignado: number; gastado: number }>;
  }[];
}

export interface AcumuladoPresupuesto {
  mes: string;
  anterior: string;
  limite: number;
  dias: number;
  serie: { dia: number; actual: number | null; anterior: number }[];
}

export interface PresupuestoMes {
  mes: string;
  /** Parte del mes transcurrida (0–1): la línea base para comparar lo gastado. */
  ritmo: number;
  ingreso_referencia: number;
  asignado: number;
  asignado_fijo: number;
  gastado: number;
  por_asignar: number;
  filas: FilaPresupuesto[];
  sin_presupuesto: { categoria_id: number; ruta: string[]; gastado: number }[];
}

export interface CreditoDetalle extends Credito {
  plazo_meses: number;
  capital_inicial: number;
  monto_recibido: number;
  costo_real_ea: number;
  intereses_por_pagar: number;
  fecha_fin: string;
  /** Cuotas ya pagadas (los abonos extra no cuentan). */
  cuotas_pagadas: number;
  /** 0–1: capital ya pagado sobre el capital inicial. */
  avance: number;
  proximo_pago: {
    transaccion_id: number | null;
    fecha: string | null;
    total: number;
    capital: number;
    interes: number;
    seguro: number;
  } | null;
  fecha_desembolso: string;
  cuenta_pago_id: number | null;
  estado: string;
  categoria_id: number | null;
  categoria_abono_id: number | null;
  cuenta_desembolso_id: number | null;
}

export interface CreditoCerrado {
  id: number;
  nombre: string;
  entidad: string;
  estado: string;
  monto_recibido: number;
  capital_inicial: number;
  total_pagado: number;
  costo: number;
  fecha_desembolso: string;
  ultimo_pago: string | null;
}

export interface CreditoNuevo {
  nombre: string;
  entidad: string;
  fecha_desembolso: string;
  capital_inicial: number;
  monto_recibido: number;
  tasa_ea: number;
  plazo_meses: number;
  cuota: number;
  dia_pago: number;
  seguro_mensual: number;
  cuenta_pago_id: number | null;
  numero: string | null;
  cuenta_desembolso_id: number | null;
}

export interface Amortizacion extends CreditoDetalle {
  tabla: { numero: number; fecha: string; interes: number; seguro: number; capital: number; saldo: number }[];
  extractos: {
    fecha_corte: string;
    saldo: number;
    intereses: number;
    abono_capital: number;
    seguros: number;
    cuotas_pendientes: number;
  }[];
  pagos: {
    transaccion_id: number;
    fecha: string;
    monto: number;
    tipo: "cuota" | "abono";
    capital: number;
    interes: number;
    seguro: number;
    saldo_despues: number;
  }[];
}

export interface Simulacion {
  abono_extra: number;
  estrategia: "avalancha" | "bola_de_nieve";
  meses_base: number;
  meses_con_abono: number;
  meses_ahorrados: number;
  costo_base: number;
  costo_con_abono: number;
  ahorro: number;
  fecha_fin_base: string;
  fecha_fin_con_abono: string;
  orden: string[];
  saldos_base: number[];
  saldos_con_abono: number[];
}

export type DireccionPrestamo = "presto_yo" | "me_prestaron";

export interface CuotaPrestamo {
  numero: number;
  fecha: string;
  capital: number;
  interes: number;
}

export interface Prestamo {
  id: number;
  persona: string;
  direccion: DireccionPrestamo;
  origen: "amigo" | "familia" | "companero" | "otra_fuente";
  monto: number;
  fecha: string;
  tipo_interes: "ninguno" | "fijo" | "simple_mensual";
  tasa_mensual: number | null;
  interes_total: number;
  plan: "fecha_unica" | "cuotas" | "libre";
  frecuencia: string | null;
  estado: "activo" | "pagado" | "condonado";
  nota: string;
  capital_pendiente: number;
  interes_pendiente: number;
  pendiente: number;
  abonado: number;
  pagado_pct: number;
  tasa_ea: number;
  proxima_cuota: { numero: number; fecha: string; monto: number } | null;
  dias_vencido: number;
  cuotas: CuotaPrestamo[];
  movimientos?: { id: number; fecha: string; monto: number; descripcion: string; cuenta: string }[];
}

export interface ResumenPrestamos {
  me_deben: number;
  debo: number;
  vencidos: number;
  proximos_7_dias: number;
  activos: number;
}

export type PrestamoNuevo = S["PrestamoIn"];

export interface VistaPreviaPrestamo {
  interes_total: number;
  total: number;
  tasa_ea: number;
  cuotas: (CuotaPrestamo & { total: number })[];
  alerta: string | null;
}

// ---------- Fase 4: análisis ----------
export interface MesReporte extends MesFlujo {
  ahorro: number;
  prestamos_neto: number;
  financiacion: number;
  flujo_neto: number;
}

export interface ReporteMensual {
  meses: MesReporte[];
  totales: Omit<MesReporte, "mes">;
  promedios: Omit<MesReporte, "mes">;
}

export interface Sankey {
  nodos: string[];
  enlaces: { origen: string; destino: string; valor: number }[];
  entradas: number;
  salidas: number;
}

export interface SubcategoriaReporte {
  subcategoria: string;
  total: number;
  n: number;
  ticket: number;
  promedio_mensual: number;
  pct_categoria: number;
  pct_grupo: number;
}

export interface CategoriaReporte {
  categoria: string;
  total: number;
  n: number;
  promedio_mensual: number;
  pct: number;
  tendencia: number[];
  subcategorias: SubcategoriaReporte[];
}

export interface ReporteCategorias {
  grupo: Grupo;
  meses: string[];
  total: number;
  n: number;
  promedio_mensual: number;
  categorias: CategoriaReporte[];
  ranking_subcategorias: {
    subcategoria: string;
    categoria: string;
    total: number;
    n: number;
    ticket: number;
    promedio_mensual: number;
    pct: number;
  }[];
}

export interface DescripcionReporte {
  descripcion: string;
  grupo: Grupo;
  categoria: string;
  n: number;
  total: number;
  ticket: number;
}

export interface ResumenApuestas {
  n: number;
  apostado: number;
  ganado: number;
  neto: number;
  dias_con_apuesta: number;
  ultima: string | null;
  racha_actual: number | null;
  racha_mayor: number;
  por_mes: { mes: string; n: number; apostado: number; ganado: number; neto: number }[];
  por_casa: { casa: string; n: number; apostado: number; ganado: number; neto: number }[];
}

export interface CambioCategoria {
  categoria: string;
  actual: number;
  promedio: number;
  diferencia: number;
}

export interface RevisionMensual {
  mes: string;
  comparado_con: string[];
  indicadores: {
    clave: "ingresos" | "gasto_vida" | "servicio_deuda" | "apuestas_neto" | "flujo_operativo";
    actual: number;
    anterior: number;
    promedio: number;
  }[];
  subidas: CambioCategoria[];
  bajadas: CambioCategoria[];
  mayor_gasto: { descripcion: string; categoria: string; monto: number; fecha: string } | null;
  dias_con_gasto: number;
  hallazgos: string[];
  kpis: KpisRevision;
}

export interface KpiRevision {
  clave: string;
  nombre: string;
  valor: number | null;
  formato: "pct" | "veces" | "meses" | "cop" | "dias";
  tendencia: (number | null)[] | null;
  /** Solo los principales: semáforo frente a la meta. */
  estado?: "bien" | "atencion" | "alerta" | "sin_datos";
  meta?: number;
  texto_meta?: string;
  detalle?: string;
}

export interface KpisRevision {
  meses: string[];
  principales: KpiRevision[];
  secundarios: KpiRevision[];
}

// ---------- Fase 5: automatización ----------
export interface SugerenciaCategoria {
  categoria_id: number;
  via: "regla" | "historial" | "palabras" | "diccionario" | "frecuencia";
  confianza: number;
  ruta: string[];
  grupo: Grupo;
}

export interface Precision {
  retrospectiva: {
    casos: number;
    acierto: number;
    acierto_top3: number;
    con_descripcion: number;
    acierto_con_descripcion: number;
    acierto_top3_con_descripcion: number;
  };
  uso_real: { desde: string; movimientos: number; aceptadas: number; por_regla: number; tasa: number | null };
  meta: number;
}

export type CampoRegla = "descripcion" | "monto" | "cuenta_id" | "tipo";
export type OperadorRegla = "contiene" | "empieza" | "igual" | "mayor" | "menor" | "entre";

export interface CondicionRegla {
  campo: CampoRegla;
  op: OperadorRegla;
  valor: string | number;
  valor2?: number | null;
}

export interface Regla {
  id: number;
  nombre: string;
  prioridad: number;
  activa: boolean;
  condiciones: CondicionRegla[];
  categoria_id: number | null;
  categoria_ruta: string[] | null;
  etiquetas: string[];
}

export interface ReglaNueva {
  nombre: string;
  prioridad?: number;
  condiciones: CondicionRegla[];
  categoria_id: number | null;
  etiquetas?: string[];
  activa?: boolean;
}

export type FrecuenciaRecurrente = "semanal" | "quincenal" | "mensual" | "anual";

export interface Recurrente {
  id: number;
  nombre: string;
  cuenta_id: number;
  cuenta: string;
  categoria_id: number | null;
  categoria_ruta: string[] | null;
  monto: number;
  frecuencia: FrecuenciaRecurrente;
  dia: number;
  inicio: string;
  fin: string | null;
  es_suscripcion: boolean;
  activo: boolean;
  estado: "activo" | "pausado" | "cancelado";
  ancla: "calendario" | "pago";
  credito_id: number | null;
  nota: string;
  costo_mensual: number;
  proxima: string | null;
  ultimo_pago: string | null;
}

export interface ListaRecurrentes {
  items: Recurrente[];
  gasto_mensual: number;
  suscripciones_mensual: number;
  suscripciones_anual: number;
  num_suscripciones: number;
}

export interface RecurrenteNuevo {
  nombre: string;
  cuenta_id: number;
  monto: number;
  frecuencia: FrecuenciaRecurrente;
  dia: number;
  inicio: string;
  categoria_id: number | null;
  fin?: string | null;
  es_suscripcion: boolean;
  nota?: string;
  activo?: boolean;
  ancla?: "calendario" | "pago";
}

export interface Detectado {
  descripcion: string;
  frecuencia: FrecuenciaRecurrente;
  monto: number;
  dia: number;
  cuenta_id: number;
  categoria_id: number | null;
  categoria_ruta: string[] | null;
  grupo: Grupo | null;
  veces: number;
  ultima: string;
  proxima: string;
  costo_mensual: number;
}

export interface EventoCalendario {
  tipo: "programada" | "prestamo";
  id: number;
  fecha: string;
  descripcion: string;
  monto: number;
  cuenta_id: number | null;
  cuenta: string | null;
  categoria_ruta: string[] | null;
  grupo: Grupo | null;
  recurrente_id: number | null;
  /** Días que faltan (negativo si está vencido). */
  dias: number;
  saldo_total?: number;
  saldo_cuenta?: number | null;
}

export interface Calendario {
  desde: string;
  hasta: string;
  saldo_inicial: number;
  saldo_final: number;
  minimo: { saldo: number; fecha: string };
  /** Primer día en que el saldo total proyectado queda bajo cero (null si no pasa). */
  primer_negativo: { saldo: number; fecha: string } | null;
  eventos: EventoCalendario[];
  vencidos: EventoCalendario[];
  por_cuenta: { id: number; nombre: string; inicial: number; final: number }[];
}

export type TipoMeta = "ahorro" | "deuda" | "tope_gasto" | "habito";

export interface Meta {
  id: number;
  nombre: string;
  tipo: TipoMeta;
  objetivo: number | null;
  estado: "activa" | "cumplida" | "archivada";
  fecha_objetivo: string | null;
  categoria_id: number | null;
  categoria_ruta: string[] | null;
  cuenta_id: number | null;
  cuenta: string | null;
  actual: number;
  progreso: number;
  cuenta_ids: number[];
  categoria_ids: number[];
  rastrea: string[];
  base?: number;
  aporte_mensual?: number;
  mes?: string;
  excedido?: boolean;
  racha_dias?: number | null;
  ultima?: string | null;
  creado_en: string;
  cumplida_en: string | null;
  /** Días hasta la fecha objetivo (negativo si ya pasó). */
  dias_restantes: number | null;
  /** Fecha estimada de cumplimiento al ritmo de los últimos 3 meses. */
  fecha_prevista: string | null;
  ritmo_mensual?: number;
}

export interface MetaNueva {
  nombre: string;
  tipo: TipoMeta;
  objetivo?: number | null;
  categoria_id?: number | null;
  cuenta_id?: number | null;
  fecha_objetivo?: string | null;
  cuenta_ids?: number[];
  categoria_ids?: number[];
}

export interface Alerta {
  nivel: "critica" | "aviso" | "info";
  tipo: "vencido" | "saldo" | "pago_proximo" | "presupuesto" | "meta";
  titulo: string;
  monto: number;
  enlace: string;
}

export interface Respaldo {
  archivo: string;
  fecha: string;
  bytes: number;
}

// ---------- Fase 6: extras ----------
export interface OpcionAbono {
  modo: "ninguno" | "plazo" | "cuota";
  cuota: number;
  meses: number;
  intereses_y_seguros: number;
  ahorro: number;
}

export interface AbonoUnico {
  credito: string;
  saldo: number;
  abono: number;
  sin_abono: OpcionAbono;
  reducir_plazo: OpcionAbono;
  reducir_cuota: OpcionAbono;
}

export interface CompraCarteraIn {
  tasa_ea: number;
  plazo_meses: number;
  costos_iniciales?: number;
  seguro_mensual?: number;
  financiar_costos?: boolean;
  credito_ids?: number[] | null;
}

export interface CompraCartera {
  monto_nuevo: number;
  cuota_actual: number;
  cuota_nueva: number;
  meses_actual: number;
  meses_nuevo: number;
  pagos_restantes_actual: number;
  pagos_total_nuevo: number;
  diferencia: number;
  costo_real_ea_nuevo: number;
  conviene: boolean;
  creditos: string[];
  tasa_ea: number;
  usura_consumo: number | null;
  supera_usura: boolean;
}

export interface ParametroCO {
  clave: string;
  vigencia_desde: string;
  valor: number;
  fuente: string;
}

export interface Trm {
  fecha: string;
  valor: number;
  fuente: string;
  aproximada: boolean;
}

export interface FilaTermometro {
  clave: string;
  nombre: string;
  valor: number;
  proyectado: number;
  tope_uvt: number;
  tope: number | null;
  pct: number | null;
  pct_proyectado: number | null;
}

export interface MesAportes {
  mes: string;
  ingreso: number;
  obligado: boolean;
  ibc: number;
  salud: number;
  pension: number;
  arl: number;
  total: number;
}

export interface Termometro {
  anio: number;
  uvt: number | null;
  meses_transcurridos: number;
  declara_probable: boolean;
  filas: FilaTermometro[];
  seguridad_social: {
    smmlv: number | null;
    porcentajes: { ibc: number; salud: number; pension: number; arl: number };
    meses: MesAportes[];
    total_anio: number;
    nota: string;
  };
  aviso: string;
}

export interface EstadoAsistente {
  consentimiento: { desde: string; detalle: string } | null;
  credenciales: boolean;
  modelo: string;
}

export interface RespuestaAsistente {
  respuesta: string;
  herramientas: string[];
  modelo: string;
  fin: string;
}

export interface Sistema {
  primer_uso: boolean;
  nombre: string;
  perfil: string;
  es_demo: boolean;
  modulo_apuestas: "auto" | "si" | "no";
  modulos: { apuestas: boolean };
}
