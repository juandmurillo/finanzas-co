/** Apariencia: modo, tema de color y estilo se aplican y se guardan en el momento de elegirlos (sin «Guardar»). */
import { ACENTOS, ESTILOS, guardarApariencia, useApariencia, type Tema } from "@/shared/lib/tema";
import { guardarIntensidad, INTENSIDADES, useIntensidad } from "@/shared/lib/movimiento";
import { Icono } from "@/shared/ui/Icono";

const MODOS: { id: Tema; nombre: string }[] = [
  { id: "light", nombre: "Claro" },
  { id: "dark", nombre: "Oscuro" },
];

export function Apariencia() {
  // Una sola fuente: lo guardado. Cada clic escribe en el almacenamiento y pinta al instante, así que cambios
  // rápidos terminan en el último y nada se pierde al cambiar de página, recargar o cerrar la app.
  const { tema, acento, estilo } = useApariencia();
  const intensidad = useIntensidad();

  return (
    <section className="cd-card cd-stack apariencia" style={{ gap: 18 }}>
      <p className="cd-delta-note" style={{ margin: 0 }}>
        Los cambios se aplican y se guardan al elegirlos, en este dispositivo.
      </p>
      <fieldset>
        <legend className="cd-kpi-label">Modo</legend>
        <div className="cd-seg" role="radiogroup" aria-label="Modo">
          {MODOS.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={tema === m.id}
              aria-selected={tema === m.id}
              onClick={() => guardarApariencia({ tema: m.id })}
            >
              <Icono nombre={m.id === "dark" ? "luna" : "sol"} />
              {m.nombre}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="cd-kpi-label">Tema de color</legend>
        <div className="acentos" role="radiogroup" aria-label="Tema de color">
          {ACENTOS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={acento === a.id}
              className="acento"
              onClick={() => guardarApariencia({ acento: a.id })}
            >
              <span
                className="acento-muestra"
                style={{ background: `linear-gradient(135deg, ${a.muestra} 50%, ${a.realce} 50%)` }}
                aria-hidden="true"
              >
                {acento === a.id && <Icono nombre="check" />}
              </span>
              <span>{a.nombre}</span>
            </button>
          ))}
        </div>
        <p className="cd-delta-note" style={{ margin: "8px 0 0" }}>
          Cambia el fondo, la barra lateral, los botones, la tarjeta principal y los gráficos. El logotipo de Caudal
          conserva sus colores, y los de ingreso, vencido y alerta no cambian de significado.
        </p>
      </fieldset>

      <fieldset>
        <legend className="cd-kpi-label">Estilo</legend>
        <div className="estilos" role="radiogroup" aria-label="Estilo">
          {ESTILOS.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={estilo === e.id}
              className="estilo-opcion"
              onClick={() => guardarApariencia({ estilo: e.id })}
            >
              <span className={`estilo-muestra estilo-muestra--${e.id}`} aria-hidden="true">
                <i />
                <i />
              </span>
              <b>{e.nombre}</b>
              <small>{e.detalle}</small>
            </button>
          ))}
        </div>
        <p className="cd-delta-note" style={{ margin: "8px 0 0" }}>
          El estilo cambia formas y fondos; se combina con cualquier tema de color.
        </p>
      </fieldset>

      <fieldset>
        <legend className="cd-kpi-label">Animaciones</legend>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Intensidad de las animaciones">
          {INTENSIDADES.map((i) => (
            <button
              key={i.id}
              type="button"
              role="radio"
              aria-checked={intensidad === i.id}
              aria-selected={intensidad === i.id}
              onClick={() => {
                guardarIntensidad(i.id);
              }}
            >
              {i.nombre}
            </button>
          ))}
        </div>
        <p className="cd-delta-note" style={{ margin: "8px 0 0" }}>
          {INTENSIDADES.find((i) => i.id === intensidad)?.detalle}.
        </p>
      </fieldset>

      <div className="apariencia-muestra" aria-label="Vista previa">
        <div className="cd-balance">
          <div className="cd-balance-top">
            <span className="cd-balance-label">Saldo disponible</span>
          </div>
          <div className="cd-balance-value">$ 4.860.000</div>
        </div>
        <ul className="apariencia-filas">
          <li>
            <span>Ingreso por proyecto</span>
            <b className="cd-num" style={{ color: "var(--positive)" }}>
              + $ 920.000
            </b>
          </li>
          <li>
            <span>Mercado</span>
            <b className="cd-num">− $ 86.500</b>
          </li>
          <li>
            <span className="cd-badge cd-badge--warning">
              <Icono nombre="calendario" /> Vence en 3 días
            </span>
            <span className="cd-badge cd-badge--negative">
              <Icono nombre="alerta" /> Vencido
            </span>
          </li>
          <li>
            <input className="cd-input" defaultValue="Texto seleccionable" aria-label="Campo de ejemplo" />
            <button className="cd-btn cd-btn--primary" type="button">
              Principal
            </button>
          </li>
        </ul>
      </div>
    </section>
  );
}
