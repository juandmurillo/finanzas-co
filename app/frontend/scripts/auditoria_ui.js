/**
 * Auditoría de accesibilidad y temas de Caudal, para pegar en la consola del navegador (o ejecutar desde las
 * herramientas de prueba) con la app abierta. Sin dependencias.
 *
 *   window.auditarCaudal()                    → hallazgos de la página actual con el tema actual
 *   window.auditarTemas(["verde", ...])       → contraste de la página en cada tema, claro y oscuro
 *
 * Revisa: contraste WCAG del texto contra su fondo real (con transparencias), nombre accesible de botones,
 * enlaces y campos, imágenes sin alt, ids repetidos, orden de encabezados, un solo <h1>, objetivos táctiles
 * (≥ 24 px, WCAG 2.5.8) y que la barra superior y la lateral usen los colores del tema.
 */
(() => {
  const lienzo = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  /** Cualquier color CSS → [r, g, b, a] (0–255, 0–1), dejando que el navegador lo resuelva. */
  function rgba(css) {
    if (!css || css === "transparent") return [0, 0, 0, 0];
    lienzo.clearRect(0, 0, 1, 1);
    lienzo.fillStyle = "#000";
    lienzo.fillStyle = css;
    lienzo.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = lienzo.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }
  const mezclar = (arriba, abajo) => {
    const a = arriba[3];
    return [0, 1, 2].map((i) => arriba[i] * a + abajo[i] * (1 - a)).concat(1);
  };
  const lum = ([r, g, b]) => {
    const c = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  /** Fondo efectivo: compone las capas hasta encontrar una opaca. Si hay imagen o degradado, no se mide. */
  function fondo(el) {
    const capas = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none" && !n.matches("body, .cd-main, .cd-app")) {
        return { complejo: true, nodo: n };
      }
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) capas.push(c);
      if (c[3] >= 0.99) break;
    }
    let base = rgba(getComputedStyle(document.body).backgroundColor);
    if (base[3] < 1) base = [255, 255, 255, 1];
    return { color: capas.reverse().reduce((b, c) => mezclar(c, b), base) };
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05;
  };
  const describir = (el) => {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const clase = typeof el.className === "string" ? el.className.split(" ").slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${clase ? "." + clase : ""}${t ? ` «${t}»` : ""}`;
  };
  const nombre = (el) =>
    (
      el.getAttribute("aria-label") ||
      (el.getAttribute("aria-labelledby") || "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ") ||
      el.textContent ||
      el.getAttribute("title") ||
      el.querySelector?.("img[alt]")?.getAttribute("alt") ||
      ""
    ).trim();

  function contrasteTexto(raiz = document.body) {
    const malos = [];
    let medidos = 0;
    let sinMedir = 0;
    const vistos = new Set();
    const caminante = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    while (caminante.nextNode()) {
      const texto = caminante.currentNode;
      const el = texto.parentElement;
      if (!el || vistos.has(el) || !texto.textContent.trim() || !visible(el)) continue;
      if (el.closest("svg, [aria-hidden='true'], .sr-only, option, script, style, kbd")) continue;
      vistos.add(el);
      const cs = getComputedStyle(el);
      const f = fondo(el);
      if (f.complejo) {
        sinMedir++;
        continue;
      }
      // La opacidad de los ancestros atenúa el texto contra su fondo.
      let opacidad = 1;
      for (let n = el; n && n !== document.body; n = n.parentElement) opacidad *= +getComputedStyle(n).opacity;
      const c = rgba(cs.color);
      const tinta = mezclar([c[0], c[1], c[2], c[3] * opacidad], f.color);
      const r = contraste(tinta, f.color);
      const tam = parseFloat(cs.fontSize);
      const grande = tam >= 24 || (tam >= 18.66 && +cs.fontWeight >= 700);
      const deshabilitado = el.closest(":disabled, [aria-disabled='true']");
      const minimo = grande ? 3 : 4.5;
      medidos++;
      if (r < minimo && !deshabilitado) malos.push({ elemento: describir(el), contraste: +r.toFixed(2), minimo });
    }
    return { medidos, sinMedir, malos };
  }

  function estructura() {
    const hallazgos = [];
    const agregar = (tipo, el, detalle = "") => hallazgos.push({ tipo, elemento: el ? describir(el) : "", detalle });
    document
      .querySelectorAll("button, a[href], [role='button'], [role='tab'], [role='radio'], [role='link']")
      .forEach((el) => {
        if (!visible(el)) return;
        if (!nombre(el)) agregar("sin nombre accesible", el);
        const r = el.getBoundingClientRect();
        const enLinea = el.matches("a") && getComputedStyle(el).display === "inline";
        if (!enLinea && (r.width < 24 || r.height < 24))
          agregar("objetivo táctil < 24 px", el, `${Math.round(r.width)}×${Math.round(r.height)}`);
      });
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      if (!visible(el) || el.type === "hidden") return;
      const conEtiqueta =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest("label") ||
        el.getAttribute("title");
      if (!conEtiqueta) agregar("campo sin etiqueta", el, el.getAttribute("placeholder") || "");
    });
    document.querySelectorAll("img").forEach((el) => {
      if (!el.hasAttribute("alt")) agregar("imagen sin alt", el);
    });
    const ids = {};
    document.querySelectorAll("[id]").forEach((el) => (ids[el.id] = (ids[el.id] || 0) + 1));
    Object.entries(ids).forEach(([id, n]) => n > 1 && agregar("id repetido", null, `${id} ×${n}`));
    const h1 = [...document.querySelectorAll("main h1")].filter(visible);
    if (h1.length !== 1) agregar("h1 de la página", null, `${h1.length} visibles`);
    let previo = 1;
    [...document.querySelectorAll("main h1, main h2, main h3, main h4")].filter(visible).forEach((h) => {
      const nivel = +h.tagName[1];
      if (nivel > previo + 1) agregar("salto de encabezado", h, `h${previo} → h${nivel}`);
      previo = nivel;
    });
    if (!document.querySelector("main")) agregar("sin <main>", null);
    if (!document.documentElement.lang) agregar("html sin lang", null);
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      agregar("desborde horizontal", null, `${document.documentElement.scrollWidth}px`);
    return hallazgos;
  }

  /** Las barras deben pintarse con tokens del tema: su fondo cambia al cambiar de tema. */
  function barrasConTema() {
    return [".cd-topbar", ".cd-sidebar", ".app-movil-nav"].map((sel) => {
      const el = document.querySelector(sel);
      if (!el || !visible(el)) return { barra: sel, visible: false };
      const f = fondo(el);
      return { barra: sel, fondo: f.complejo ? "imagen/degradado" : `rgb(${f.color.slice(0, 3).map(Math.round)})` };
    });
  }

  window.auditarCaudal = () => ({
    ruta: location.pathname + location.search,
    tema: document.documentElement.dataset.acento,
    modo: document.documentElement.dataset.theme,
    estilo: document.documentElement.dataset.estilo,
    estructura: estructura(),
    contraste: contrasteTexto(),
    barras: barrasConTema(),
  });

  /** Recorre temas y modos en la página actual (sin guardar) y devuelve los fallos de contraste por tema. */
  window.auditarTemas = async (temas, estilos = [document.documentElement.dataset.estilo || "clasico"]) => {
    const html = document.documentElement;
    const antes = { ...html.dataset };
    const salida = [];
    for (const estilo of estilos)
      for (const acento of temas)
        for (const modo of ["light", "dark"]) {
          Object.assign(html.dataset, { acento, theme: modo, estilo });
          await new Promise((r) => setTimeout(r, 40));
          const c = contrasteTexto();
          const barras = barrasConTema();
          salida.push({
            estilo,
            acento,
            modo,
            medidos: c.medidos,
            fallos: c.malos.length,
            ejemplos: c.malos.slice(0, 15),
            barras,
          });
        }
    Object.assign(html.dataset, antes);
    return salida;
  };
  return "auditoría lista";
})();
