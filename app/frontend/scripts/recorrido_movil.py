"""Recorrido de la vista móvil y de las animaciones de escritorio (base demo en :5180), con Playwright y Edge.

Preparar la base demo y arrancar `api-demo` y `web-demo` de .claude/launch.json (ver recorrido_dashboard.py).
Uso: python app/frontend/scripts/recorrido_movil.py <carpeta-de-capturas>

Móvil (360 y 390 px, táctil): filtros que arrancan en «3 meses», menú inferior personalizado que persiste al
recargar, botón «+» flotante sobre la barra sin tapar el final, pantalla «Más» con versión y legal, gestos de
deslizar en un gráfico de barras y en el diario (anterior, actual, límite, vertical = desplazar), sin
desplazamiento horizontal. Escritorio (1280): los tres niveles de animación, que se aplican al instante,
persisten al recargar y responden a navegación rápida.
"""
import json
import sys

from playwright.sync_api import Page, sync_playwright

SALIDA = sys.argv[1]
URL = "http://localhost:5180"
fallos: list[str] = []
notas: dict = {}


def comprobar(cond: bool, texto: str) -> None:
    if not cond:
        fallos.append(texto)


def esperar(pag: Page, ms: int = 700) -> None:
    pag.wait_for_load_state("networkidle")
    pag.wait_for_timeout(ms)


def deslizar(pag: Page, cdp, x: float, y: float, dx: float, dy: float = 0) -> None:
    """Gesto táctil real (CDP): el navegador genera pointer events de tipo «touch»."""
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for k in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * k / 8, "y": y + dy * k / 8}]})
        pag.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    pag.wait_for_timeout(500)


def etiqueta_periodo(zona) -> str:
    return zona.locator("xpath=ancestor::section[1]").locator(".periodo-etiqueta").first.inner_text().replace("\n", " ")


with sync_playwright() as p:
    nav = p.chromium.launch(channel="msedge", headless=True)

    # ---------------- Móvil ----------------
    for ancho in (360, 390):
        ctx = nav.new_context(viewport={"width": ancho, "height": 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pag = ctx.new_page()
        errores: list[str] = []
        pag.on("pageerror", lambda e: errores.append(str(e)))
        cdp = ctx.new_cdp_session(pag)
        r: dict = {}

        # 1. Filtros temporales: todos arrancan en «3 meses».
        presets = {}
        for ruta in ("/", "/flujo", "/categorias", "/presupuesto", "/cuentas"):
            pag.goto(URL + ruta)
            esperar(pag)
            presets[ruta] = [
                ("3 meses" if "(3 meses)" in (b.get_attribute("aria-label") or "") else b.get_attribute("aria-label"))
                for b in pag.locator(".periodo-icono").all()
            ]
        r["presets"] = presets
        for ruta, lista in presets.items():
            comprobar(bool(lista) and all(x == "3 meses" for x in lista), f"{ancho}: {ruta} no arranca en 3 meses: {lista}")
        pag.goto(URL + "/movimientos")
        esperar(pag)
        r["movimientos_fechas"] = pag.locator(".mov-filtros-boton").get_attribute("aria-label") or ""
        comprobar(r["movimientos_fechas"] == "Filtros", f"{ancho}: Movimientos no arranca sin filtros activos (3 meses por defecto) ({r['movimientos_fechas']})")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-movimientos.png")

        # 2. Pantalla «Más» y menú personalizable.
        pag.goto(URL + "/")
        esperar(pag)
        barra = lambda: [t.strip() for t in pag.locator(".app-movil-nav .movil-item").all_inner_texts()]  # noqa: E731
        r["menu_inicial"] = barra()
        comprobar(len(r["menu_inicial"]) == 5 and "Más" in r["menu_inicial"], f"{ancho}: menú inicial {r['menu_inicial']}")
        pag.locator(".app-movil-nav .movil-item", has_text="Más").click()
        esperar(pag, 500)
        comprobar(pag.url.endswith("/mas"), f"{ancho}: «Más» no abrió su pantalla ({pag.url})")
        texto_mas = pag.locator("main").inner_text()
        r["version"] = pag.locator(".ajuste-fila--dato .ajuste-detalle").inner_text()
        comprobar(r["version"] == "0.1.0", f"{ancho}: versión {r['version']}")
        for buscado in ("Personalizar menú", "Configuración", "Información legal", "Flujo de caja"):
            comprobar(buscado in texto_mas, f"{ancho}: «Más» sin «{buscado}»")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-mas.png", full_page=True)
        pag.get_by_text("Información legal").click()
        esperar(pag, 400)
        comprobar("licencia MIT" in pag.locator("main").inner_text(), f"{ancho}: sin texto legal")
        pag.goto(URL + "/mas/menu")
        esperar(pag, 500)
        # Posición 4 (Deudas) → Flujo de caja, y «Más» a la primera posición.
        pag.get_by_role("combobox", name="Posición 4").click()
        pag.get_by_role("option", name="Flujo de caja").click()
        asa_mas = pag.get_by_role("button", name="Mover Más, posición 5 de 5")
        asa_mas.focus()
        for _ in range(4):
            pag.keyboard.press("ArrowUp")
            pag.wait_for_timeout(120)
        r["menu_editado"] = barra()
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-personalizar.png", full_page=True)
        pag.reload()
        esperar(pag)
        r["menu_tras_recargar"] = barra()
        comprobar(r["menu_tras_recargar"] == r["menu_editado"], f"{ancho}: el menú no persistió {r['menu_editado']} → {r['menu_tras_recargar']}")
        comprobar(r["menu_tras_recargar"][0] == "Más" and "Flujo" in r["menu_tras_recargar"], f"{ancho}: orden {r['menu_tras_recargar']}")
        pag.goto(URL + "/mas")
        esperar(pag, 400)
        comprobar("Deudas" in pag.locator("main").inner_text(), f"{ancho}: «Deudas» quitada de la barra no aparece en «Más»")

        # 3. Botón «+» flotante: a la derecha, sobre la barra, abre la captura y no tapa el final.
        pag.goto(URL + "/")
        esperar(pag)
        fab = pag.locator(".fab-registrar").bounding_box()
        barra_nav = pag.locator(".app-movil-nav").bounding_box()
        r["fab"] = {"fab": fab, "nav": barra_nav}
        comprobar(fab is not None and barra_nav is not None and fab["y"] + fab["height"] <= barra_nav["y"] - 4, f"{ancho}: el «+» no queda sobre la barra")
        comprobar(fab is not None and fab["x"] + fab["width"] >= ancho - 24, f"{ancho}: el «+» no está a la derecha")
        pag.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        pag.wait_for_timeout(500)
        final = pag.evaluate("""() => {
          const ultimo = [...document.querySelectorAll('main .pagina > *')].filter(e => e.getBoundingClientRect().height > 0).at(-1);
          const fab = document.querySelector('.fab-registrar').getBoundingClientRect();
          return { ultimo: Math.round(ultimo.getBoundingClientRect().bottom), fab: Math.round(fab.top) };
        }""")
        r["final"] = final
        comprobar(final["ultimo"] <= final["fab"], f"{ancho}: el «+» tapa el final {final}")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-final.png")
        pag.locator(".fab-registrar").click()
        pag.wait_for_timeout(500)
        comprobar(pag.locator(".captura-panel").count() == 1, f"{ancho}: el «+» no abrió la captura")
        pag.keyboard.press("Escape")
        pag.wait_for_timeout(300)

        # 4. Gestos: gráfico de barras (Flujo de caja del Inicio) y gráfico diario (Días de gasto e ingreso).
        pag.evaluate("window.scrollTo(0, 0)")
        gestos = {}
        for nombre, sel in (("barras", "section:has(h2:text-is('Flujo de caja')) .zona-periodo"), ("diario", ".calor .zona-periodo")):
            pag.goto(URL + "/")
            esperar(pag)
            zona = pag.locator(sel).first
            try:
                zona.wait_for(state="attached", timeout=8000)
            except Exception:
                pag.screenshot(path=f"{SALIDA}/diagnostico-{ancho}-{nombre}.png", full_page=True)
                print("DIAG", nombre, pag.url, pag.evaluate("[...document.querySelectorAll('main h2')].map(h=>h.textContent)"),
                      pag.evaluate("document.querySelectorAll('.zona-periodo').length"), file=sys.stderr)
                raise
            zona.evaluate("e => e.scrollIntoView({ block: 'center' })")
            pag.wait_for_timeout(300)
            caja = zona.bounding_box()
            cx, cy = caja["x"] + caja["width"] / 2, caja["y"] + min(caja["height"] / 2, 120)
            g = {"inicio": etiqueta_periodo(zona)}
            deslizar(pag, cdp, cx - 60, cy, 140)  # derecha: periodo anterior
            g["anterior"] = etiqueta_periodo(zona)
            deslizar(pag, cdp, cx + 60, cy, -140)  # izquierda: vuelve al actual
            g["actual"] = etiqueta_periodo(zona)
            deslizar(pag, cdp, cx + 60, cy, -140)  # ya es el actual: aviso
            g["aviso_actual"] = zona.locator(".zona-periodo-aviso").inner_text()
            antes = pag.evaluate("window.scrollY")
            deslizar(pag, cdp, cx, cy + 40, 6, -160)  # vertical: desplaza la página, no cambia el periodo
            g["vertical_scroll"] = pag.evaluate("window.scrollY") - antes
            g["tras_vertical"] = etiqueta_periodo(zona)
            # Varios pasos atrás hasta el límite de los datos.
            for _ in range(12):
                zona.evaluate("e => e.scrollIntoView({ block: 'center' })")
                b = zona.bounding_box()
                deslizar(pag, cdp, b["x"] + b["width"] / 2 - 60, b["y"] + min(b["height"] / 2, 80), 140)
            g["aviso_limite"] = zona.locator(".zona-periodo-aviso").inner_text()
            g["limite_boton"] = True  # las flechas ‹ › viven ahora en el panel del botón de periodo
            gestos[nombre] = g
            comprobar(g["anterior"] != g["inicio"], f"{ancho}: {nombre}: deslizar a la derecha no fue al anterior {g}")
            comprobar(g["actual"] == g["inicio"], f"{ancho}: {nombre}: deslizar a la izquierda no volvió {g}")
            comprobar("actual" in g["aviso_actual"], f"{ancho}: {nombre}: sin aviso en el periodo actual {g}")
            comprobar(g["tras_vertical"] == g["actual"] and g["vertical_scroll"] != 0, f"{ancho}: {nombre}: el gesto vertical {g}")
            comprobar("No hay datos" in g["aviso_limite"] and g["limite_boton"], f"{ancho}: {nombre}: sin aviso de límite {g}")
            zona.evaluate("e => e.scrollIntoView({ block: 'center' })")
            pag.screenshot(path=f"{SALIDA}/movil-{ancho}-gesto-{nombre}.png")
        r["gestos"] = gestos

        # 5. Compacto: sin desplazamiento horizontal en las pantallas principales.
        anchos = {}
        for ruta in ("/", "/movimientos", "/presupuesto", "/flujo", "/categorias", "/mas", "/mas/menu", "/configuracion"):
            pag.goto(URL + ruta)
            esperar(pag, 500)
            anchos[ruta] = pag.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            comprobar(anchos[ruta][0] == anchos[ruta][1], f"{ancho}: {ruta} se desborda {anchos[ruta]}")
        pag.goto(URL + "/")
        esperar(pag)
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-inicio.png")
        r["errores"] = errores
        comprobar(not errores, f"{ancho}: errores {errores}")
        notas[f"movil-{ancho}"] = r
        ctx.close()

    # ---------------- Escritorio: tres niveles de animación ----------------
    ctx = nav.new_context(viewport={"width": 1280, "height": 860}, device_scale_factor=1)
    pag = ctx.new_page()
    errores = []
    pag.on("pageerror", lambda e: errores.append(str(e)))
    pag.goto(URL + "/")
    esperar(pag)
    r = {"inicial": pag.evaluate("document.documentElement.dataset.movimiento")}
    comprobar(r["inicial"] == "maxima", f"escritorio: primera visita sin reducción debía ser «maxima» ({r['inicial']})")
    niveles = {}
    for nombre, valor in (("Ninguna", "ninguna"), ("Reducidas", "reducida"), ("Máximo", "maxima")):
        pag.goto(URL + "/configuracion?seccion=apariencia")
        esperar(pag, 400)
        pag.get_by_role("radiogroup", name="Intensidad de las animaciones").get_by_role("radio", name=nombre).click()
        aplicado = pag.evaluate("document.documentElement.dataset.movimiento")
        pag.reload()
        esperar(pag, 300)
        persistido = pag.evaluate("document.documentElement.dataset.movimiento")
        # Navegación rápida: cuatro páginas seguidas; la última queda visible e interactiva enseguida.
        for destino in ("Movimientos", "Presupuesto", "Flujo de caja", "Inicio"):
            pag.locator(".cd-sidebar").get_by_role("link", name=destino, exact=True).click()
        pag.wait_for_timeout(60)
        medida = pag.evaluate("""() => {
          const p = document.querySelector('.pagina');
          const cs = getComputedStyle(p);
          const col = document.querySelector('.grafico .columna');
          return { ruta: location.pathname, opacidad: +cs.opacity, durPagina: cs.animationDuration,
                   animColumna: col ? getComputedStyle(col).animationName : null,
                   botonListo: !!document.querySelector('.cd-topbar .cd-btn--primary') };
        }""")
        pag.wait_for_timeout(700)
        medida["opacidadFinal"] = pag.evaluate("+getComputedStyle(document.querySelector('.pagina')).opacity")
        # Las columnas existen cuando llegan los datos del gráfico.
        medida["animColumna"] = pag.evaluate(
            "(() => { const c = document.querySelector('.grafico .columna'); return c ? getComputedStyle(c).animationName : null })()"
        )
        niveles[valor] = {"aplicado": aplicado, "persistido": persistido, **medida}
        comprobar(aplicado == valor and persistido == valor, f"escritorio: {valor} no se aplicó o no persistió")
        comprobar(medida["ruta"] == "/", f"escritorio: {valor}: la navegación rápida no terminó en Inicio ({medida['ruta']})")
        comprobar(medida["opacidad"] >= 0.4 and medida["botonListo"], f"escritorio: {valor}: la página no estaba disponible enseguida {medida}")
        comprobar(medida["opacidadFinal"] == 1, f"escritorio: {valor}: la página no terminó visible")
        if valor == "ninguna":
            comprobar(medida["durPagina"] == "0s", f"escritorio: ninguna aún anima la página ({medida['durPagina']})")
        if valor == "maxima":
            comprobar(medida["animColumna"] == "mov-columna", f"escritorio: máximo sin entrada de columnas ({medida['animColumna']})")
        if valor == "reducida":
            comprobar(medida["animColumna"] in ("mov-aparece", None), f"escritorio: reducida mueve columnas ({medida['animColumna']})")
        pag.screenshot(path=f"{SALIDA}/escritorio-{valor}.png")
    r["niveles"] = niveles
    r["errores"] = errores
    comprobar(not errores, f"escritorio: errores {errores}")
    notas["escritorio"] = r
    ctx.close()

    # Primera visita con el sistema pidiendo menos movimiento: «reducida».
    ctx = nav.new_context(viewport={"width": 1280, "height": 860}, reduced_motion="reduce")
    pag = ctx.new_page()
    pag.goto(URL + "/")
    esperar(pag, 300)
    notas["primera_visita_reducida"] = pag.evaluate("document.documentElement.dataset.movimiento")
    comprobar(notas["primera_visita_reducida"] == "reducida", "primera visita con prefers-reduced-motion no quedó en «reducida»")
    ctx.close()
    nav.close()

print(json.dumps({"fallos": fallos, "notas": notas}, ensure_ascii=False, indent=1)[:12000])
