/**
 * Información legal y versión de Caudal: una sola fuente para la pantalla «Más › Información legal» del celular
 * y para Configuración › Acerca de y legal en escritorio. Los textos son los del README público (aviso,
 * privacidad y licencia MIT).
 */
import "./mas.css";

/** Versión de la app: la de package.json, inyectada por Vite. */
export const VERSION_APP = __VERSION_APP__;

export function ContenidoLegal() {
  return (
    <>
      <section className="ajustes-grupo legal">
        <h2>Aviso</h2>
        <p>
          Caudal no es asesoría financiera, tributaria ni legal. Verifica los valores vigentes (UVT, usura, TRM) antes
          de usarlos.
        </p>
      </section>
      <section className="ajustes-grupo legal">
        <h2>Privacidad</h2>
        <ul className="legal-lista">
          <li>
            El asistente está apagado hasta que aceptas, y cambiar de proveedor pide aceptar de nuevo. Con Ollama, nada
            sale de tu computador.
          </li>
          <li>
            Un archivo cargado se valida en una base temporal antes de tocar tus datos, y antes de reemplazarlos se hace
            un respaldo.
          </li>
          <li>Sin PIN por ahora: si la abres en tu red local, hazlo solo en una Wi-Fi de confianza.</li>
        </ul>
      </section>
      <section className="ajustes-grupo legal">
        <h2>Licencia</h2>
        <p>Caudal se distribuye con licencia MIT.</p>
        <p className="cd-delta-note">Versión {VERSION_APP}</p>
      </section>
    </>
  );
}
