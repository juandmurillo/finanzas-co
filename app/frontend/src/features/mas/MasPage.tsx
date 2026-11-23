/**
 * Pantalla «Más» (vista móvil): lista vertical al estilo de los ajustes del teléfono, con las secciones que no
 * están en la barra inferior, la personalización de esa barra, Configuración y «Acerca de» (versión e
 * información legal). También funciona en escritorio.
 */
import { Link } from "@tanstack/react-router";

import { GRUPOS_MAS, SECCIONES, type IdSeccion } from "@/shared/lib/secciones";
import { useMenuMovil } from "@/shared/lib/menuMovil";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";

import { ContenidoLegal, VERSION_APP } from "./Legal";
import "./mas.css";

function Fila({ a, icono, etiqueta, detalle }: { a: string; icono: NombreIcono; etiqueta: string; detalle?: string }) {
  return (
    <li>
      <Link to={a} className="ajuste-fila">
        <span className="ajuste-ico" aria-hidden>
          <Icono nombre={icono} pequeno />
        </span>
        <span className="ajuste-texto">{etiqueta}</span>
        {detalle && <span className="ajuste-detalle">{detalle}</span>}
        <span className="ajuste-flecha" aria-hidden>
          ›
        </span>
      </Link>
    </li>
  );
}

export function MasPage() {
  const menu = useMenuMovil();
  const enBarra = new Set<string>(menu);
  const grupos = GRUPOS_MAS.map((g) => ({ ...g, ids: g.ids.filter((id) => !enBarra.has(id)) })).filter(
    (g) => g.ids.length > 0,
  );
  return (
    <div className="ajustes">
      <div className="cd-pagehead">
        <h1>Más</h1>
      </div>
      {grupos.map((g) => (
        <section key={g.etiqueta} className="ajustes-grupo" aria-labelledby={`grupo-${g.etiqueta}`}>
          <h2 id={`grupo-${g.etiqueta}`}>{g.etiqueta}</h2>
          <ul>
            {g.ids.map((id: IdSeccion) => (
              <Fila key={id} a={SECCIONES[id].a} icono={SECCIONES[id].icono} etiqueta={SECCIONES[id].etiqueta} />
            ))}
          </ul>
        </section>
      ))}
      <section className="ajustes-grupo" aria-labelledby="grupo-ajustes">
        <h2 id="grupo-ajustes">Ajustes</h2>
        <ul>
          <Fila a="/mas/menu" icono="menu" etiqueta="Personalizar menú" />
          {!enBarra.has("configuracion") && <Fila a="/configuracion" icono="ajustes" etiqueta="Configuración" />}
        </ul>
      </section>
      <section className="ajustes-grupo" aria-labelledby="grupo-acerca">
        <h2 id="grupo-acerca">Acerca de</h2>
        <ul>
          <li>
            <div className="ajuste-fila ajuste-fila--dato">
              <span className="ajuste-ico" aria-hidden>
                <Icono nombre="info" pequeno />
              </span>
              <span className="ajuste-texto">Versión</span>
              <span className="ajuste-detalle cd-num">{VERSION_APP}</span>
            </div>
          </li>
          <Fila a="/mas/legal" icono="documento" etiqueta="Información legal" />
        </ul>
      </section>
    </div>
  );
}

/** Cabecera de las subpantallas de «Más»: volver a la lista y el título. */
export function CabeceraMas({ titulo }: { titulo: string }) {
  return (
    <div className="cd-pagehead ajustes-cabeza">
      <Link to="/mas" className="cd-icon-btn" aria-label="Volver a Más">
        ‹
      </Link>
      <h1>{titulo}</h1>
    </div>
  );
}

/** Información legal en el celular: el mismo contenido que Configuración › Acerca de y legal en escritorio. */
export function LegalPage() {
  return (
    <div className="ajustes">
      <CabeceraMas titulo="Información legal" />
      <ContenidoLegal />
    </div>
  );
}
