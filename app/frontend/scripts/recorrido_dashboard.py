"""Recorrido del dashboard (base demo en :5180) a 360, 390 y 1280 px, con Playwright y el Edge del sistema.

Preparar la base demo (fuera de tus datos) y arrancar los servidores `api-demo` y `web-demo` de .claude/launch.json:
    cd app/backend && set FINANZAS_DB_RUTA=../../data/demo/finanzas.db && uv run --system-certs finanzas migrar
    uv run --system-certs finanzas demo
Uso: python app/frontend/scripts/recorrido_dashboard.py <carpeta-de-capturas>

Comprueba: selección rápida en la barra de reparto (termina en la última), importe legible al instante,
teclado, movimiento reducido, sin desplazamiento horizontal, último contenido libre de la barra inferior y
etiquetas de KPI sin recortar. Guarda capturas comparables en <salida>.
"""
import json
import sys

from playwright.sync_api import sync_playwright

SALIDA = sys.argv[1]
URL = "http://localhost:5180/"
fallos: list[str] = []


def comprobar(cond: bool, texto: str) -> None:
    if not cond:
        fallos.append(texto)


ESTADO = r"""() => {
  const fig = document.querySelector('.categorias-lado .distribucion');
  const barra = fig.querySelector('.distribucion-barra');
  const partes = [...barra.querySelectorAll('.distribucion-parte')];
  const i = partes.findIndex(p => p.getAttribute('aria-selected') === 'true');
  const marc = fig.querySelector('.distribucion-marcador');
  const det = fig.querySelector('.distribucion-detalle');
  const globo = fig.querySelector('.grafico-globo');
  const r = barra.getBoundingClientRect();
  const p = partes[i]?.getBoundingClientRect();
  const m = marc?.getBoundingClientRect();
  return {
    activa: i,
    nombre: partes[i]?.getAttribute('aria-label') ?? null,
    detalle: det && !det.hidden ? det.textContent : null,
    globo: globo ? globo.textContent : null,
    centroParte: p ? Math.round(p.left + p.width / 2 - r.left) : null,
    centroMarcador: m ? Math.round(m.left + m.width / 2 - r.left) : null,
    transicionMarcador: marc ? getComputedStyle(marc).transitionDuration : null,
    transformActiva: partes[i] ? getComputedStyle(partes[i]).transform : null,
  };
}"""

MEDIR = r"""() => {
  const d = document.documentElement;
  const recortes = [...document.querySelectorAll('main .kpi-c-etiqueta, main .cd-card-title, main .kpi-c-valor')]
    .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 30));
  const titulos = [...document.querySelectorAll('main .cd-card-title')].map(t => ({t: t.textContent, w: Math.round(t.getBoundingClientRect().width)}))
    .filter(x => x.w < 110 && x.t.length > 12);
  const kpiFuera = [...document.querySelectorAll('main .kpi-c')].filter(k => {
    const v = k.querySelector('.kpi-c-valor'); if (!v) return false;
    return v.getBoundingClientRect().right > k.getBoundingClientRect().right - 4;
  }).map(k => k.getAttribute('aria-label'));
  return { scroll: [d.scrollWidth, d.clientWidth], recortes, titulos, kpiFuera };
}"""

FINAL = r"""() => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  const nav = document.querySelector('.app-movil-nav');
  const visible = nav && getComputedStyle(nav).display !== 'none';
  const hijos = [...document.querySelectorAll('main#contenido > *')].filter(e => e.getBoundingClientRect().height > 0);
  const ultimo = hijos.at(-1);
  const navTop = visible ? Math.min(nav.getBoundingClientRect().top, ...[...nav.children].map(c => c.getBoundingClientRect().top)) : innerHeight;
  return { navVisible: !!visible, ultimoAbajo: Math.round(ultimo.getBoundingClientRect().bottom), navArriba: Math.round(navTop), ultimo: ultimo.className };
}"""

resultado = {}
with sync_playwright() as p:
    nav = p.chromium.launch(channel="msedge", headless=True)
    for ancho in (360, 390, 1280):
        movil = ancho < 768
        for reducido in (False, True):
            ctx = nav.new_context(viewport={"width": ancho, "height": 800}, device_scale_factor=2,
                                  is_mobile=movil, has_touch=movil,
                                  reduced_motion="reduce" if reducido else "no-preference")
            pag = ctx.new_page()
            errores: list[str] = []
            pag.on("pageerror", lambda e: errores.append(str(e)))
            pag.goto(URL)
            pag.wait_for_load_state("networkidle")
            pag.wait_for_timeout(600)
            clave = f"{ancho}{'-reducido' if reducido else ''}"
            r: dict = {"errores": errores}
            r["medidas"] = pag.evaluate(MEDIR)
            comprobar(r["medidas"]["scroll"][0] == r["medidas"]["scroll"][1], f"{clave}: desplazamiento horizontal")
            comprobar(not r["medidas"]["recortes"], f"{clave}: textos recortados {r['medidas']['recortes']}")
            comprobar(not r["medidas"]["titulos"], f"{clave}: títulos aplastados {r['medidas']['titulos']}")
            comprobar(not r["medidas"]["kpiFuera"], f"{clave}: cifras al borde {r['medidas']['kpiFuera']}")

            tarjeta = pag.locator(".categorias-mes")
            tarjeta.scroll_into_view_if_needed()
            partes = pag.locator(".categorias-lado").first.locator(".distribucion-parte")
            n = partes.count()
            objetivos = [n - 1, n - 2, 0] if n >= 3 else [0]
            if movil:
                # Tres toques seguidos (sin esperar): debe quedar la última parte, con su importe al instante.
                for k in objetivos:
                    partes.nth(k).tap()
                inmediato = pag.evaluate(ESTADO)
                comprobar(inmediato["activa"] == objetivos[-1], f"{clave}: el toque rápido no terminó en la última")
                comprobar(bool(inmediato["detalle"]) and "$" in inmediato["detalle"], f"{clave}: sin importe al instante")
                comprobar(pag.url == URL, f"{clave}: el toque navegó en vez de mostrar el detalle")
            else:
                # Mouse que cruza la barra rápido: el globo y el marcador terminan en la última parte.
                caja = partes.nth(objetivos[0]).bounding_box()
                for k in objetivos:
                    b = partes.nth(k).bounding_box()
                    pag.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=2)
                inmediato = pag.evaluate(ESTADO)
                comprobar(inmediato["activa"] == objetivos[-1], f"{clave}: el hover rápido no terminó en la última")
                comprobar(bool(inmediato["globo"]) and "$" in inmediato["globo"], f"{clave}: globo sin importe")
            pag.wait_for_timeout(350)
            asentado = pag.evaluate(ESTADO)
            comprobar(abs((asentado["centroMarcador"] or 0) - (asentado["centroParte"] or 0)) <= 3,
                      f"{clave}: el marcador no quedó bajo la parte elegida {asentado}")
            if reducido:
                comprobar(asentado["transicionMarcador"] in ("0s", None), f"{clave}: el marcador se mueve con movimiento reducido")
                comprobar(asentado["transformActiva"] in ("none", None), f"{clave}: la parte crece con movimiento reducido")
            else:
                comprobar(asentado["transicionMarcador"] == "0.18s", f"{clave}: transición del marcador {asentado['transicionMarcador']}")
            r["seleccion"] = {"inmediato": inmediato, "asentado": asentado}
            if not reducido:
                tarjeta.screenshot(path=f"{SALIDA}/categorias-{ancho}.png")
                if movil:
                    pag.evaluate("window.scrollTo(0, 0)")
                    pag.wait_for_timeout(200)
                    pag.screenshot(path=f"{SALIDA}/inicio-{ancho}.png")
                else:
                    pag.screenshot(path=f"{SALIDA}/inicio-{ancho}.png", full_page=True)

            # Teclado: Tab hasta la barra y flechas seguidas.
            barra = pag.locator(".categorias-lado").first.locator(".distribucion-barra")
            pag.keyboard.press("Escape")
            pag.mouse.click(5, 5)
            barra.focus()
            pag.keyboard.press("Home")
            for tecla in ("ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft"):
                pag.keyboard.press(tecla)
            teclado = pag.evaluate(ESTADO)
            comprobar(teclado["activa"] == 2, f"{clave}: Home y 3 → 1 ← debía dejar la parte 2, quedó {teclado['activa']}")
            pag.wait_for_timeout(350)
            teclado = pag.evaluate(ESTADO)
            comprobar(abs((teclado["centroMarcador"] or 0) - (teclado["centroParte"] or 0)) <= 3,
                      f"{clave}: marcador tras el teclado {teclado}")
            comprobar(bool(teclado["detalle"]), f"{clave}: el teclado no muestra el detalle")
            pag.keyboard.press("Escape")
            r["teclado"] = teclado

            r["final"] = pag.evaluate(FINAL)
            pag.wait_for_timeout(300)
            r["final"] = pag.evaluate(FINAL)
            if r["final"]["navVisible"]:
                comprobar(r["final"]["ultimoAbajo"] <= r["final"]["navArriba"],
                          f"{clave}: la barra inferior tapa el final {r['final']}")
            comprobar(not errores, f"{clave}: errores {errores}")
            resultado[clave] = r
            ctx.close()
    nav.close()

print(json.dumps({"fallos": fallos, "resultado": resultado}, ensure_ascii=False, indent=1)[:9000])
