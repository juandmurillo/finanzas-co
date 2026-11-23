"""Recorrido de la revisión de móvil y escritorio (base demo en :5180), con Playwright y Edge.

Preparar la base demo y arrancar `api-demo` y `web-demo` de .claude/launch.json (ver recorrido_dashboard.py).
Uso: python app/frontend/scripts/recorrido_revision.py <carpeta-de-capturas>
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


def tactil(pag: Page, cdp, x: float, y: float, dx: float, dy: float = 0, soltar: bool = True, pasos: int = 10) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for k in range(1, pasos + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * k / pasos, "y": y + dy * k / pasos}]})
        pag.wait_for_timeout(16)
    if soltar:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        pag.wait_for_timeout(600)


ESPACIADO = r"""() => {
  // Secciones hermanas que se tocan o se montan (sin el aire del sistema) dentro de cada página.
  const malas = [];
  const revisar = (padre) => {
    const hijos = [...padre.children].filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0
      && getComputedStyle(e).position !== 'fixed' && getComputedStyle(e).position !== 'absolute');
    for (let i = 1; i < hijos.length; i++) {
      const a = hijos[i - 1].getBoundingClientRect(), b = hijos[i].getBoundingClientRect();
      const mismaFila = Math.abs(a.top - b.top) < 4;
      const gap = mismaFila ? b.left - a.right : b.top - a.bottom;
      if (gap < 6 && !(mismaFila && b.left >= a.right + 6)) malas.push(`${hijos[i-1].className.toString().slice(0,30)} | ${hijos[i].className.toString().slice(0,30)} (${Math.round(gap)})`);
    }
  };
  const pagina = document.querySelector('.pagina');
  if (pagina) revisar(pagina);
  document.querySelectorAll('.pagina .cd-bento').forEach(revisar);
  return malas.slice(0, 8);
}"""

with sync_playwright() as p:
    nav = p.chromium.launch(channel="msedge", headless=True)

    # ---------------- Escritorio ----------------
    ctx = nav.new_context(viewport={"width": 1280, "height": 900})
    pag = ctx.new_page()
    errores: list[str] = []
    pag.on("pageerror", lambda e: errores.append(str(e)))
    r: dict = {}
    esp = {}
    for ruta in ("/", "/movimientos", "/presupuesto", "/recurrentes", "/categorias", "/revision", "/cuentas", "/prestamos", "/flujo"):
        pag.goto(URL + ruta)
        esperar(pag)
        esp[ruta] = pag.evaluate(ESPACIADO)
        comprobar(not esp[ruta], f"escritorio {ruta}: secciones pegadas {esp[ruta]}")
    r["espaciado"] = esp
    # Carrusel: rota cada 5 s, misma altura, pausa accesible.
    pag.goto(URL + "/")
    esperar(pag)
    car = pag.locator(".cinsight")
    activo = lambda: pag.locator(".cinsight-diapositiva.activa").inner_text()  # noqa: E731
    alto0 = car.bounding_box()["height"]
    t0 = activo()
    pag.mouse.move(5, 5)
    pag.wait_for_timeout(5600)
    t1 = activo()
    pag.wait_for_timeout(5200)
    t2 = activo()
    alto2 = car.bounding_box()["height"]
    r["carrusel"] = {"textos": [t0[:30], t1[:30], t2[:30]], "alto": [alto0, alto2]}
    comprobar(t0 != t1 and t1 != t2, f"escritorio: el carrusel no rotó dos veces {r['carrusel']}")
    comprobar(abs(alto0 - alto2) < 1, f"escritorio: el carrusel cambió de altura {alto0} → {alto2}")
    pag.get_by_role("button", name="Pausar la rotación").click()
    pag.mouse.move(5, 5)
    t3 = activo()
    pag.wait_for_timeout(5600)
    comprobar(activo() == t3, "escritorio: la pausa no detuvo la rotación")
    car.screenshot(path=f"{SALIDA}/escritorio-carrusel.png")
    # Legal en Configuración.
    pag.goto(URL + "/configuracion")
    esperar(pag)
    pag.get_by_role("link", name="Acerca de y legal").first.click()
    esperar(pag, 400)
    texto = pag.locator("main").inner_text()
    comprobar("licencia MIT" in texto and "asesoría financiera" in texto, "escritorio: Configuración sin información legal")
    pag.screenshot(path=f"{SALIDA}/escritorio-legal.png")
    pag.goto(URL + "/")
    esperar(pag)
    pag.screenshot(path=f"{SALIDA}/escritorio-inicio.png")
    r["errores"] = errores
    comprobar(not errores, f"escritorio: errores {errores}")
    notas["escritorio"] = r
    ctx.close()

    # ---------------- Móvil ----------------
    for ancho in (360, 390):
        ctx = nav.new_context(viewport={"width": ancho, "height": 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pag = ctx.new_page()
        errores = []
        pag.on("pageerror", lambda e: errores.append(str(e)))
        cdp = ctx.new_cdp_session(pag)
        r = {}
        esp = {}
        desbordes = {}
        for ruta in ("/", "/movimientos", "/presupuesto", "/recurrentes", "/categorias", "/revision", "/cuentas", "/prestamos", "/mas/menu"):
            pag.goto(URL + ruta)
            esperar(pag)
            esp[ruta] = pag.evaluate(ESPACIADO)
            desbordes[ruta] = pag.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            comprobar(not esp[ruta], f"{ancho} {ruta}: secciones pegadas {esp[ruta]}")
            comprobar(desbordes[ruta][0] == desbordes[ruta][1], f"{ancho} {ruta}: desborde horizontal {desbordes[ruta]}")
        r["espaciado"] = esp

        # Inicio: KPIs en dos filas con desplazamiento propio; carrusel con gesto.
        pag.goto(URL + "/")
        esperar(pag)
        filas = pag.evaluate("""[...document.querySelectorAll('.inicio-kpis-fila')].map(f => ({n: f.children.length, desborda: f.scrollWidth > f.clientWidth + 2, top: Math.round(f.getBoundingClientRect().top)}))""")
        r["kpis"] = filas
        comprobar(len(filas) == 2 and all(f["n"] == 3 and f["desborda"] for f in filas), f"{ancho}: filas de KPIs {filas}")
        pag.locator(".inicio-kpis-fila").first.evaluate("e => e.scrollBy(400, 0)")
        pag.wait_for_timeout(400)
        desp = pag.evaluate("[...document.querySelectorAll('.inicio-kpis-fila')].map(f => f.scrollLeft)")
        comprobar(desp[0] > 0 and desp[1] == 0, f"{ancho}: las filas de KPIs no se desplazan por separado {desp}")
        cortes = pag.evaluate("[...document.querySelectorAll('.inicio-kpis .kpi-c-valor')].filter(v => v.scrollWidth > v.clientWidth + 1).length")
        comprobar(cortes == 0, f"{ancho}: importes de KPI cortados ({cortes})")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-inicio.png")
        car = pag.locator(".cinsight")
        car.evaluate("e => e.scrollIntoView({block: 'center'})")
        pag.wait_for_timeout(300)
        b = car.bounding_box()
        t0 = pag.locator(".cinsight-diapositiva.activa").inner_text()
        tactil(pag, cdp, b["x"] + b["width"] * 0.75, b["y"] + b["height"] / 2, -150)
        t1 = pag.locator(".cinsight-diapositiva.activa").inner_text()
        comprobar(t0 != t1, f"{ancho}: deslizar el carrusel no cambió de hallazgo")
        comprobar(abs(car.bounding_box()["height"] - b["height"]) < 1, f"{ancho}: el carrusel cambió de altura")
        car.screenshot(path=f"{SALIDA}/movil-{ancho}-carrusel.png")

        # Filtro de periodo con botón de ícono; serie que sigue al dedo.
        tarjeta = pag.locator("section:has(h2:text-is('Flujo de caja'))").first
        tarjeta.evaluate("e => e.scrollIntoView({block: 'center'})")
        pag.wait_for_timeout(300)
        boton = tarjeta.locator(".periodo-icono")
        comprobar(boton.count() == 1 and "Periodo" in (boton.get_attribute("aria-label") or ""), f"{ancho}: sin botón de periodo con nombre")
        etiqueta0 = tarjeta.locator(".periodo-etiqueta").inner_text()
        boton.click()
        pag.wait_for_timeout(300)
        activa = pag.locator(".periodo-pop [role=radio][aria-checked=true]").inner_text()
        comprobar(activa.strip() == "3 m", f"{ancho}: el panel no marca la opción activa ({activa})")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-panel-periodo.png")
        pag.keyboard.press("Escape")
        pag.wait_for_timeout(200)
        zona = tarjeta.locator(".zona-periodo")
        zb = zona.bounding_box()
        y0 = tarjeta.locator(".grafico-cuadricula text").first.bounding_box()["x"]
        tactil(pag, cdp, zb["x"] + zb["width"] / 2 - 40, zb["y"] + 90, 90, soltar=False)
        durante = pag.evaluate("""() => { const c = document.querySelector("section .zona-periodo .capa-desliza"); return c ? c.style.transform : null }""")
        y1 = tarjeta.locator(".grafico-cuadricula text").first.bounding_box()["x"]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        pag.wait_for_timeout(900)
        etiqueta1 = tarjeta.locator(".periodo-etiqueta").inner_text()
        r["grafica"] = {"durante": durante, "ejeY": [y0, y1], "etiquetas": [etiqueta0, etiqueta1]}
        comprobar(bool(durante) and "translateX(9" in durante, f"{ancho}: la serie no sigue al dedo ({durante})")
        comprobar(abs(y0 - y1) < 1, f"{ancho}: el eje Y se movió con el dedo")
        comprobar(etiqueta1 != etiqueta0, f"{ancho}: soltar no cambió el periodo {etiqueta0} → {etiqueta1}")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-grafica.png")
        # Volver y probar el límite del periodo actual.
        tactil(pag, cdp, zb["x"] + zb["width"] / 2 + 40, zb["y"] + 90, -110)
        tactil(pag, cdp, zb["x"] + zb["width"] / 2 + 40, zb["y"] + 90, -110)
        aviso = zona.locator(".zona-periodo-aviso").inner_text()
        comprobar("actual" in aviso, f"{ancho}: sin aviso en el periodo actual ({aviso})")

        # Movimientos: sin botones en la fila, acciones al tocar, panel de filtros.
        pag.goto(URL + "/movimientos")
        esperar(pag)
        botones = pag.evaluate("[...document.querySelectorAll('.acciones-fila')].filter(e => e.getBoundingClientRect().height > 0).length")
        comprobar(botones == 0, f"{ancho}: Movimientos aún muestra botones por fila ({botones})")
        pag.locator(".tabla-densa tbody tr:not(.tabla-grupo)").first.click()
        pag.wait_for_timeout(400)
        hoja = pag.locator(".hoja-panel")
        comprobar(hoja.count() == 1 and all(t in hoja.inner_text() for t in ("Editar", "Duplicar", "Eliminar")), f"{ancho}: tocar un movimiento no muestra sus acciones")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-mov-acciones.png")
        pag.keyboard.press("Escape")
        pag.wait_for_timeout(300)
        pag.locator(".mov-filtros-boton").click()
        pag.wait_for_timeout(500)
        panel = pag.locator(".panel-lateral")
        pb = panel.bounding_box()
        comprobar(pb is not None and abs(pb["x"] + pb["width"] - ancho) < 2, f"{ancho}: el panel no está a la derecha {pb}")
        panel.get_by_role("combobox", name="Cuenta").click()
        pag.get_by_role("option").nth(2).click()
        panel.get_by_role("button", name="Ingresos").click()
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-panel-filtros.png")
        panel.get_by_role("button", name="Aplicar").click()
        pag.wait_for_timeout(600)
        activos = pag.locator(".filtros-activos li").all_inner_texts()
        comprobar(len(activos) >= 2 and "Ingresos" in activos, f"{ancho}: filtros activos {activos}")
        comprobar("cuenta=" in pag.url and "grupo=ingreso" in pag.url, f"{ancho}: los filtros no se aplicaron ({pag.url})")
        pag.locator(".mov-filtros-boton").click()
        pag.wait_for_timeout(400)
        pag.locator(".panel-lateral").get_by_role("button", name="Limpiar").click()
        pag.locator(".panel-lateral").get_by_role("button", name="Aplicar").click()
        pag.wait_for_timeout(500)
        comprobar(pag.locator(".filtros-activos li").count() == 0, f"{ancho}: Limpiar no quitó los filtros")

        # Presupuesto: tocar la fila edita; eliminar con confirmación (solo en 360, sobre datos demo).
        pag.goto(URL + "/presupuesto")
        esperar(pag)
        comprobar(pag.locator(".fila-presupuesto .acciones-fila").count() == 0, f"{ancho}: Presupuesto aún muestra botones por fila")
        filas_antes = pag.locator(".fila-presupuesto").count()
        pag.locator(".fila-presupuesto").first.click()
        pag.wait_for_timeout(400)
        comprobar("Eliminar presupuesto" in pag.locator(".hoja-panel").inner_text(), f"{ancho}: la edición no ofrece «Eliminar presupuesto»")
        pag.get_by_role("button", name="Eliminar presupuesto").click()
        comprobar(pag.get_by_role("button", name="Sí, eliminar").count() == 1, f"{ancho}: eliminar no pide confirmación")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-presupuesto-eliminar.png")
        if ancho == 360:
            pag.get_by_role("button", name="Sí, eliminar").click()
            pag.wait_for_timeout(900)
            comprobar(pag.locator(".fila-presupuesto").count() == filas_antes - 1, f"{ancho}: el presupuesto no se eliminó")
        else:
            pag.get_by_role("button", name="No", exact=True).click()
        kpi = pag.evaluate("Math.max(...[...document.querySelectorAll('.presupuesto-kpis .kpi-c')].map(k => k.getBoundingClientRect().height))")
        r["presupuesto_kpi_alto"] = kpi
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-presupuesto.png")

        # Personalizar menú: arrastrar con el dedo y con el teclado; persiste al recargar.
        pag.goto(URL + "/mas/menu")
        esperar(pag)
        antes = [t.strip() for t in pag.locator(".app-movil-nav .movil-item").all_inner_texts()]
        asa = pag.locator(".menu-asa").first.bounding_box()
        alto_fila = pag.locator(".menu-posicion").first.bounding_box()["height"]
        tactil(pag, cdp, asa["x"] + asa["width"] / 2, asa["y"] + asa["height"] / 2, 0, alto_fila * 2.1, pasos=14)
        tras_arrastre = [t.strip() for t in pag.locator(".app-movil-nav .movil-item").all_inner_texts()]
        comprobar(tras_arrastre[2] == antes[0], f"{ancho}: arrastrar no movió la primera posición a la tercera {antes} → {tras_arrastre}")
        pag.locator(".menu-asa").nth(2).focus()
        pag.keyboard.press("ArrowUp")
        pag.wait_for_timeout(200)
        tras_teclado = [t.strip() for t in pag.locator(".app-movil-nav .movil-item").all_inner_texts()]
        comprobar(tras_teclado[1] == antes[0], f"{ancho}: ↑ con el teclado no movió la fila {tras_teclado}")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-personalizar.png")
        pag.reload()
        esperar(pag)
        comprobar([t.strip() for t in pag.locator(".app-movil-nav .movil-item").all_inner_texts()] == tras_teclado, f"{ancho}: el orden no persistió")

        # Recurrentes: KPIs y gráfica arriba, lista compacta sin botones, detalle al tocar.
        pag.goto(URL + "/recurrentes")
        esperar(pag)
        orden = pag.evaluate("""() => {
          const y = s => document.querySelector(s)?.getBoundingClientRect().top ?? -1;
          return { kpis: y('.recurrentes-kpis'), grafica: y('.rec-saldo'), lista: y('.tabla-rec-compacta') };
        }""")
        r["recurrentes"] = orden
        comprobar(0 <= orden["kpis"] < orden["grafica"] < orden["lista"], f"{ancho}: orden de Recurrentes {orden}")
        comprobar(orden["lista"] < 780, f"{ancho}: los pagos no se ven al abrir Recurrentes ({orden['lista']})")
        comprobar(pag.evaluate("[...document.querySelectorAll('.tabla-rec-compacta button')].filter(b => b.getBoundingClientRect().height > 0).length") == 0, f"{ancho}: botones en la lista de Recurrentes")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-recurrentes.png")
        pag.locator(".tabla-rec-compacta tbody tr").first.click()
        pag.wait_for_timeout(400)
        detalle = pag.locator(".hoja-panel").inner_text()
        comprobar(any(x in detalle for x in ("Pagar", "Recibir", "Pagado", "Recibido")) and "Editar" in detalle, f"{ancho}: el detalle de Recurrentes no trae las acciones")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-recurrente-detalle.png")
        pag.keyboard.press("Escape")

        # Cuentas: dos por fila, saldos completos.
        pag.goto(URL + "/cuentas")
        esperar(pag)
        cuentas = pag.evaluate("""() => { const t = [...document.querySelectorAll('.tarjeta-cuenta')].map(e => e.getBoundingClientRect());
          return { filas: [...new Set(t.map(r => Math.round(r.top)))].length, n: t.length,
                   cortes: [...document.querySelectorAll('.tarjeta-cuenta-saldo')].filter(s => s.scrollWidth > s.clientWidth + 1).length,
                   anchos: [...new Set(t.map(r => Math.round(r.width)))] } }""")
        r["cuentas"] = cuentas
        comprobar(cuentas["filas"] == (cuentas["n"] + 1) // 2 and cuentas["cortes"] == 0 and len(cuentas["anchos"]) == 1, f"{ancho}: cuentas {cuentas}")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-cuentas.png")

        # Préstamos: saldo pendiente y acción juntos.
        pag.goto(URL + "/prestamos")
        esperar(pag)
        pag.locator(".fila-persona").first.click()
        pag.wait_for_timeout(500)
        saldo = pag.locator(".prestamo-saldo").first
        if saldo.count():
            sb = saldo.bounding_box()
            comprobar(sb["height"] < 70 and saldo.locator("button").count() == 1, f"{ancho}: saldo y acción de Préstamos no van juntos")
        else:
            comprobar(False, f"{ancho}: sin bloque de saldo en Préstamos")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-prestamos.png")

        # Categorías: KPIs de dos en dos; barra vertical fija al recorrer.
        pag.goto(URL + "/categorias")
        esperar(pag)
        kpis = pag.evaluate("[...new Set([...document.querySelectorAll('.categorias-kpis > *')].map(e => Math.round(e.getBoundingClientRect().top)))].length")
        comprobar(kpis == 2, f"{ancho}: KPIs de Categorías no van de dos en dos ({kpis} filas)")
        barra = pag.locator(".reparto-vertical")
        comprobar(barra.count() == 1 and barra.is_visible(), f"{ancho}: sin barra vertical de reparto")
        pag.evaluate("window.scrollTo(0, document.querySelector('.lista-con-reparto').offsetTop + 260)")
        pag.wait_for_timeout(300)
        bb = barra.bounding_box()
        r["reparto"] = bb
        comprobar(bb["y"] >= 40 and bb["y"] + bb["height"] <= 780 - 60, f"{ancho}: la barra de reparto no queda entre la cabecera y el menú {bb}")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-categorias.png")

        # Revisión mensual: dos tarjetas en la misma fila.
        pag.goto(URL + "/revision")
        esperar(pag)
        tops = pag.evaluate("[...document.querySelectorAll('.revision-mes-datos > .kpi-c')].map(e => Math.round(e.getBoundingClientRect().top))")
        cortes = pag.evaluate("[...document.querySelectorAll('.revision-mes-datos .kpi-c-valor')].filter(v => v.scrollWidth > v.clientWidth + 1).length")
        comprobar(len(tops) == 2 and tops[0] == tops[1] and cortes == 0, f"{ancho}: Revisión {tops} cortes {cortes}")
        pag.locator(".revision-mes-datos").evaluate("e => e.scrollIntoView({block: 'center'})")
        pag.screenshot(path=f"{SALIDA}/movil-{ancho}-revision.png")

        r["errores"] = errores
        comprobar(not errores, f"{ancho}: errores {errores}")
        notas[f"movil-{ancho}"] = r
        ctx.close()
    nav.close()

print(json.dumps({"fallos": fallos, "notas": notas}, ensure_ascii=False, indent=1)[:9000])
