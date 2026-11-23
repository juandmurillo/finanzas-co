/**
 * Muestrario del sistema compacto (/muestrario, fuera del menú): todas las primitivas con datos de ejemplo,
 * para revisar tamaños, temas y estados sin depender de los datos de nadie.
 */
import { useState } from "react";

import {
  AreaComparada,
  Anillo,
  BarrasActivas,
  BarrasAgrupadas,
  BarrasApiladas,
  BarrasFinas,
  BarrasHorizontales,
  Gauge,
} from "@/shared/charts";
import { BarraLimite, EstadoPunto, ListaDensa, MiniTarjeta, TablaDensa, type TonoEstado } from "@/shared/ui/Datos";
import { Icono } from "@/shared/ui/Icono";
import { CabeceraTarjeta, FilaMetricas, KpiCompacto, TarjetaInsight } from "@/shared/ui/Kpi";

const MOVS: {
  id: number;
  fecha: string;
  concepto: string;
  categoria: string;
  monto: number;
  estado: [TonoEstado, string];
}[] = [
  {
    id: 1,
    fecha: "21 nov",
    concepto: "Mercado",
    categoria: "Comida",
    monto: -86_500_00,
    estado: ["positivo", "Pagado"],
  },
  {
    id: 2,
    fecha: "20 nov",
    concepto: "Proyecto web",
    categoria: "Freelance",
    monto: 920_000_00,
    estado: ["positivo", "Recibido"],
  },
  {
    id: 3,
    fecha: "19 nov",
    concepto: "Arriendo",
    categoria: "Vivienda",
    monto: -1_200_000_00,
    estado: ["aviso", "Por pagar"],
  },
  {
    id: 4,
    fecha: "15 nov",
    concepto: "Cuota crédito",
    categoria: "Deuda",
    monto: -245_000_00,
    estado: ["negativo", "Vencido"],
  },
  {
    id: 5,
    fecha: "12 nov",
    concepto: "Recarga transporte",
    categoria: "Transporte",
    monto: -35_000_00,
    estado: ["positivo", "Pagado"],
  },
];

const MESES12 = ["Dic", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov"];
const MESES6 = MESES12.slice(6);
const GASTO_12M = [31, 29.5, 33, 30.2, 34.1, 32.6, 27.4, 35, 38.7, 35.6, 36.6, 37.5].map((v, i) => ({
  etiqueta: MESES12[i] ?? "",
  valor: v * 100_000_00,
  proyectado: i === 11,
}));
// Gasto acumulado por día: noviembre (21 días) frente a octubre
const RITMO = Array.from({ length: 21 }, (_, i) => ({
  etiqueta: String(i + 1),
  detalle: `${i + 1} nov`,
  valor: Math.round((i + 1) * 165_000 + Math.sin(i / 2) * 120_000) * 100,
  anterior: Math.round((i + 1) * 150_000 + Math.cos(i / 3) * 90_000) * 100,
}));
const DIARIO = Array.from({ length: 30 }, (_, i) => ({
  etiqueta: String(i + 1),
  detalle: `día ${i + 1}`,
  valor: Math.round(60_000 + 90_000 * Math.abs(Math.sin(i * 1.7)) + (i % 7 === 5 ? 120_000 : 0)) * 100,
}));

const HALLAZGOS = [
  { frase: "Gastaste {cifra} más en domicilios los viernes que el resto de la semana.", cifra: "32 %" },
  { frase: "Si mantienes este ritmo, cierras noviembre con {cifra} disponibles.", cifra: "$ 412.000" },
  { frase: "Tu tasa de ahorro subió a {cifra} frente a octubre.", cifra: "18 %" },
];

export function Muestrario() {
  const [hallazgo, setHallazgo] = useState(0);
  const [elegida, setElegida] = useState<number | null>(3);
  const h = HALLAZGOS[hallazgo] ?? { frase: "", cifra: "" };
  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Muestrario</h1>
          <p>Primitivas del sistema compacto con datos de ejemplo. Cambia el tema en Configuración › Apariencia.</p>
        </div>
      </div>

      <div className="cd-bento">
        <div className="span-3">
          <KpiCompacto
            etiqueta="Saldo disponible"
            icono="cuentas"
            valor={4_860_000_00}
            delta={{ valor: 0.042, sentido: "mejora" }}
            nota="vs oct"
            pie={{ texto: "Ver cuentas", a: "/cuentas" }}
            inversa
          />
        </div>
        <div className="span-3">
          <KpiCompacto
            etiqueta="Ingresos"
            icono="entra"
            valor={5_000_000_00}
            delta={{ valor: 0.091, sentido: "mejora" }}
            nota="vs oct"
            pie={{ texto: "Ver detalle", a: "/flujo" }}
          />
        </div>
        <div className="span-3">
          <KpiCompacto
            etiqueta="Gastos"
            icono="sale"
            valor={3_750_000_00}
            delta={{ valor: 0.06 }}
            nota="vs oct"
            abrir="/flujo"
          />
        </div>
        <div className="span-3">
          <KpiCompacto
            etiqueta="Vencido"
            icono="alerta"
            valor={245_000_00}
            delta={{ valor: 1, sentido: "alerta", texto: "1 pago" }}
            nota="hace 6 días"
          />
        </div>
        <div className="span-3">
          <KpiCompacto etiqueta="Cargando" icono="flujo" valor={0} cargando />
        </div>

        <section className="cd-card span-9">
          <CabeceraTarjeta
            titulo="Resumen del mes"
            rango="1–21 nov 2026"
            accion={<button className="cd-btn cd-btn--ghost cd-btn--sm">Ver todo</button>}
          />
          <FilaMetricas
            metricas={[
              { etiqueta: "Ingresos", valor: 5_000_000_00, tono: "ingreso", nota: "+9,1 % vs oct" },
              { etiqueta: "Gastos", valor: 3_750_000_00, nota: "+6,0 % vs oct" },
              { etiqueta: "Ahorro", valor: "25 %", nota: "meta 20 %" },
              { etiqueta: "Por pagar", valor: 1_445_000_00, nota: "3 pagos" },
            ]}
          />
        </section>

        <div className="span-4">
          <TarjetaInsight
            frase={h.frase}
            cifra={h.cifra}
            actual={hallazgo}
            total={HALLAZGOS.length}
            alCambiar={setHallazgo}
          />
        </div>

        <section className="cd-card span-4">
          <CabeceraTarjeta titulo="Presupuesto por grupo" rango="noviembre 2026" />
          <div className="cd-stack" style={{ gap: 14 }}>
            <BarraLimite etiqueta="Comida" gastado={420_000_00} limite={700_000_00} ritmo={0.7} />
            <BarraLimite etiqueta="Transporte" gastado={255_000_00} limite={300_000_00} ritmo={0.7} />
            <BarraLimite etiqueta="Ocio" gastado={310_000_00} limite={250_000_00} ritmo={0.7} />
            <BarraLimite etiqueta="Límite mensual" gastado={1_400_000_00} limite={5_500_000_00} segmentos={6} />
          </div>
        </section>

        <section className="cd-card span-4">
          <CabeceraTarjeta titulo="Movimientos recientes" accion={<a className="cd-link">Ver todos →</a>} />
          <ListaDensa
            filas={MOVS.map((m) => ({
              clave: m.id,
              titulo: m.concepto,
              detalle: `${m.fecha} · ${m.categoria}`,
              monto: m.monto,
              inicio: (
                <span className="cd-kpi-ico" style={{ width: 28, height: 28 }}>
                  <Icono nombre={m.monto > 0 ? "entra" : "bolsa"} pequeno />
                </span>
              ),
            }))}
            max={4}
            verTodas={{ a: "/movimientos" }}
          />
        </section>

        <section className="cd-card span-8">
          <CabeceraTarjeta titulo="Tabla densa" rango="Toca una fila para elegirla" />
          <TablaDensa
            titulo="Movimientos de ejemplo"
            filas={MOVS}
            claveFila={(m) => m.id}
            seleccionada={elegida}
            alElegir={(m) => setElegida(m.id)}
            columnas={[
              { clave: "c", titulo: "Concepto", render: (m) => <b>{m.concepto}</b> },
              { clave: "f", titulo: "Fecha", secundaria: true, render: (m) => m.fecha },
              { clave: "k", titulo: "Categoría", secundaria: true, render: (m) => m.categoria },
              { clave: "e", titulo: "Estado", render: (m) => <EstadoPunto tono={m.estado[0]} texto={m.estado[1]} /> },
              {
                clave: "m",
                titulo: "Monto",
                alinear: "fin",
                render: (m) => (
                  <span className={m.monto > 0 ? "tono-ingreso" : undefined}>
                    {m.monto > 0 ? "+ " : "− "}$ {Math.abs(m.monto / 100).toLocaleString("es-CO")}
                  </span>
                ),
              },
            ]}
          />
        </section>

        <section className="cd-card span-4">
          <CabeceraTarjeta titulo="Metas" rango="4 activas" />
          <div className="rejilla-mini">
            <MiniTarjeta
              titulo="Fondo de emergencia"
              icono="escudo"
              color="chart-1"
              valor={3_200_000_00}
              meta={6_000_000_00}
            />
            <MiniTarjeta titulo="Moto" icono="ruta" color="chart-4" valor={1_256_700_00} meta={2_500_000_00} />
            <MiniTarjeta titulo="Portátil" icono="telefono" color="chart-3" valor={420_000_00} meta={3_800_000_00} />
            <MiniTarjeta
              titulo="Nequi"
              icono="cuentas"
              color="chart-5"
              valor={634_100_00}
              estado={{ tono: "positivo", texto: "Suma al total" }}
            />
          </div>
        </section>

        <section className="cd-card span-8">
          <CabeceraTarjeta titulo="Gasto mes a mes" rango="Dic 2025 – Nov 2026 · noviembre proyectado" />
          <BarrasActivas titulo="Gasto mes a mes" datos={GASTO_12M} />
        </section>
        <section className="cd-card span-4">
          <CabeceraTarjeta titulo="Fondo de emergencia" rango="Meta a jun 2027" />
          <div style={{ display: "grid", placeItems: "center", paddingTop: 8 }}>
            <Gauge titulo="Fondo de emergencia" valor={3_200_000_00} meta={6_000_000_00} />
          </div>
        </section>

        <section className="cd-card span-6">
          <CabeceraTarjeta titulo="Ingresos y gastos" rango="Jun – Nov 2026" />
          <BarrasAgrupadas
            titulo="Ingresos y gastos"
            etiquetas={MESES6}
            series={[
              {
                nombre: "Ingresos",
                color: "var(--chart-1)",
                valores: [38, 40.5, 36, 42.5, 39.5, 46].map((v) => v * 100_000_00),
              },
              {
                nombre: "Gastos",
                color: "color-mix(in srgb, var(--chart-1) 40%, var(--card))",
                valores: [27.4, 35, 38.7, 35.6, 36.6, 37.5].map((v) => v * 100_000_00),
              },
            ]}
          />
        </section>
        <section className="cd-card span-6">
          <CabeceraTarjeta titulo="Ritmo del mes" rango="Gasto acumulado · nov frente a oct" />
          <AreaComparada titulo="Ritmo del mes" nombre="Noviembre" nombreAnterior="Octubre" datos={RITMO} />
        </section>

        <section className="cd-card span-4">
          <CabeceraTarjeta titulo="Gasto diario" rango="Últimos 30 días" />
          <BarrasFinas
            titulo="Gasto diario"
            datos={DIARIO}
            pieValor={
              <p className="kpi-c-cifra" style={{ marginTop: 8 }}>
                <span className="kpi-c-valor">$ 3.750.000</span>
                <span className="kpi-c-nota">de $ 4.200.000 presupuestados</span>
              </p>
            }
          />
        </section>
        <section className="cd-card span-5">
          <CabeceraTarjeta titulo="Gasto por categoría" rango="Última semana" />
          <BarrasApiladas
            titulo="Gasto por categoría"
            etiquetas={["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]}
            series={[
              {
                nombre: "Comida",
                color: "var(--cat-1)",
                valores: [42, 18, 55, 30, 61, 80, 35].map((v) => v * 1_000_00),
              },
              {
                nombre: "Transporte",
                color: "var(--cat-2)",
                valores: [12, 12, 12, 12, 15, 0, 0].map((v) => v * 1_000_00),
              },
              { nombre: "Hogar", color: "var(--cat-3)", valores: [0, 45, 0, 0, 22, 10, 0].map((v) => v * 1_000_00) },
              { nombre: "Ocio", color: "var(--cat-4)", valores: [0, 0, 18, 0, 40, 65, 30].map((v) => v * 1_000_00) },
            ]}
          />
        </section>
        <section className="cd-card span-3">
          <CabeceraTarjeta titulo="Presupuesto usado" rango="noviembre 2026" />
          <div style={{ display: "grid", placeItems: "center", gap: 12 }}>
            <Anillo titulo="Presupuesto usado" fraccion={0.68} subtitulo="$ 2,8 M de $ 4,2 M" severidad />
          </div>
        </section>

        <section className="cd-card span-6">
          <CabeceraTarjeta titulo="Gasto por grupo" rango="noviembre 2026" />
          <BarrasHorizontales
            titulo="Gasto por grupo"
            resaltar={0}
            datos={[
              { etiqueta: "Vivienda", valor: 1_200_000_00 },
              { etiqueta: "Comida", valor: 680_000_00 },
              { etiqueta: "Servicio de deuda", valor: 642_000_00 },
              { etiqueta: "Transporte", valor: 255_000_00 },
              { etiqueta: "Ocio", valor: 40_000_00 },
            ]}
          />
        </section>
      </div>
    </>
  );
}
