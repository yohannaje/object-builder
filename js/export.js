/*
 * Maquetado en hojas A4 a escala 1:1 (1 unidad = 1 mm) y exportación a PDF y SVG.
 *
 * Todo se dibuja primero en una lista neutra (trazos, textos, grupos) que después
 * se escribe como SVG o como PDF. El PDF se genera acá mismo con tamaño A4 exacto:
 * no pasa por el diálogo de impresión del navegador, que agrega márgenes y
 * encabezados y termina partiendo cada hoja en dos o cambiando la escala.
 */
(function (global) {
  const PAGE = { w: 210, h: 297 };
  // hoja con lo mínimo: una línea de encabezado arriba y la regla abajo; el resto es para las piezas
  const M = 6;                                    // la mayoría de impresoras imprime hasta ~5 mm del borde
  const HEAD_Y = 6.8;
  const AREA = { x: M, y: 9.5, w: PAGE.w - 2 * M, h: 275.5 };
  const RULER_Y = 287.5;
  const GAP = 4;
  const TILE_OVERLAP = 12;
  const COLORS = { foot: '#d8c3ab', base: '#e9dcc5', body: '#e4bdee', neck: '#f6b39c', step: '#cddbb9', handle: '#bcd5e6' };
  const INK = '#111111';
  const GREY = '#555555';

  // rótulos: Courier es monoespaciada (cada carácter mide 0,6 em), así el tamaño es exacto
  const CHAR = 0.6;
  const NAME = 3.2, INFO = 2.4, LEAD = 1.1, LABEL_GAP = 2.5;
  const MARG = 1.8;   // distancia mínima entre texto y líneas de corte
  const NOTCH = 3;    // largo de las muescas de encastre

  const f = (n) => +n.toFixed(4);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* --------------------------- lista de dibujo --------------------------- */

  const P = (d, o = {}) => ({ t: 'path', d, stroke: o.stroke || INK, sw: o.sw || 0.3, fill: o.fill || null, dash: o.dash || null, evenodd: !!o.evenodd });
  const T = (x, y, str, o = {}) => ({ t: 'text', x, y, str: String(str), size: o.size || INFO, anchor: o.anchor || 'middle', bold: !!o.bold, color: o.color || INK });
  const G = (children, o = {}) => ({ t: 'group', m: o.m || null, clip: o.clip || null, children });
  const translate = (x, y) => [1, 0, 0, 1, x, y];
  const rotation = (deg, x, y) => {
    const a = (deg * Math.PI) / 180;
    const c = deg === 90 ? 0 : Math.cos(a), s = deg === 90 ? 1 : Math.sin(a);
    return [c, s, -s, c, x, y];
  };

  // caracteres que las fuentes base del PDF no tienen
  const PDF_SUBST = { '⌀': 'Ø', '→': '->', '←': '<-', '−': '-', '≈': '~', '▲': '^', '…': '...', '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'" };
  const textWidth = (str, size) => [...str].reduce((a, ch) => a + (PDF_SUBST[ch] || ch).length, 0) * size * CHAR;

  /* -------------------------------- rótulos -------------------------------- */

  function labelLines(p) {
    return [{ str: p.name, size: NAME, bold: true }].concat(p.info.map((str) => ({ str, size: INFO })));
  }

  function blockSize(lines) {
    return {
      w: Math.max(...lines.map((l) => textWidth(l.str, l.size))),
      h: lines.reduce((a, l, i) => a + l.size + (i ? LEAD : 0), 0),
    };
  }

  /** Textos de un bloque centrado en (cx, cy). */
  function blockOps(lines, cx, cy) {
    let top = cy - blockSize(lines).h / 2;
    return lines.map((l, i) => {
      top += (i ? LEAD : 0) + l.size;
      return T(cx, top - l.size * 0.2, l.str, { size: l.size, bold: l.bold });
    });
  }

  /**
   * Busca dónde entra un bloque de wb × hb mm sin tocar ningún trazo.
   * Devuelve el centro en coordenadas de la caja de la pieza (0,0 arriba a la izquierda) o null.
   */
  function fitInside(p, wb, hb) {
    const bb = p.bbox, hw = wb / 2, hh = hb / 2;
    const local = (x, y) => ({ x: x - bb.x, y: y - bb.y });
    const inBox = (x, y) => x - hw >= bb.x && x + hw <= bb.x + bb.w && y - hh >= bb.y && y + hh <= bb.y + bb.h;
    const inHole = (r) => r > 0 && hw * hw + hh * hh <= (r - MARG) ** 2 && inBox(0, 0);

    if (p.circle && !p.circle.rIn) {
      return hw * hw + hh * hh <= (p.circle.r - MARG) ** 2 ? local(0, 0) : null;
    }
    if (p.circle) {
      const { r, rIn } = p.circle, cy = (r + rIn) / 2;
      if (cy - hh >= rIn + MARG && hw * hw + (cy + hh) ** 2 <= (r - MARG) ** 2) return local(0, -cy);
      return inHole(rIn) ? local(0, 0) : null;
    }
    if (p.rect) {
      const w = p.rect.seamX || p.rect.w, h = p.rect.h;
      const nl = Math.min(NOTCH, h / 4);
      if (wb <= w - 2 * MARG && hb <= h - 2 * (nl + MARG)) return local(w / 2, h / 2);
      // tira baja: el texto va en la mitad izquierda, lejos de la muesca central
      if (wb <= w / 2 - 2 * MARG && hb <= h - 2 * MARG) return local(w / 4, h / 2);
      return null;
    }
    if (p.sector) {
      const { R1, R2, theta, baseTheta } = p.sector;
      const half = baseTheta / 2 - (theta - baseTheta) / 2; // ángulo libre a cada lado del eje (sin el solape)
      const lo = R1 + (R1 > 5 ? NOTCH : 0) + MARG + hh, hi = R2 - NOTCH - MARG - hh;
      const mid = (lo + hi) / 2;
      const cands = [];
      for (let i = 0; lo <= hi && i <= 30; i++) cands.push(lo + ((hi - lo) * i) / 30);
      cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const c of cands) {
        const near = c - hh, far = c + hh;
        if (hw * hw + far * far > (R2 - MARG) ** 2) continue;
        // la esquina más próxima a los bordes rectos es la de radio menor
        const phi = Math.atan2(hw, near);
        const gap = half - phi;
        if (gap <= 0) continue;
        if (gap < Math.PI / 2 && Math.hypot(hw, near) * Math.sin(gap) < MARG) continue;
        return local(0, -c);
      }
      if (theta > Math.PI && inHole(R1)) return local(0, 0);
    }
    return null;
  }

  /* ---------------------------- piezas giradas ---------------------------- */

  /** Puntos del contorno (en coordenadas del trazado) para medir la caja al girar la pieza. */
  function outline(p) {
    if (p._outline) return p._outline;
    let pts;
    if (p.sector) {
      const { R1, R2, theta } = p.sector;
      pts = [];
      for (let i = 0; i <= 180; i++) {
        const a = -theta / 2 + (theta * i) / 180;
        pts.push([R2 * Math.sin(a), -R2 * Math.cos(a)], [R1 * Math.sin(a), -R1 * Math.cos(a)]);
      }
    } else {
      const b = p.bbox;
      pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    }
    return (p._outline = pts);
  }

  /** Giro del texto para que nunca quede cabeza abajo (entre −90° y 90°). */
  const readable = (deg) => { const r = ((deg % 180) + 180) % 180; return r > 90 ? r - 180 : r; };

  /**
   * Prepara una pieza girada `deg` grados: caja que ocupa y lugar del rótulo.
   * A 0° y 90° el texto queda derecho; en otros ángulos acompaña a la pieza.
   */
  function prepare(p, deg) {
    const [cos, sin] = rotation(deg, 0, 0);
    const b = p.bbox;
    let minX, maxX, minY, maxY;
    if (deg === 0) { minX = b.x; maxX = b.x + b.w; minY = b.y; maxY = b.y + b.h; }
    else if (deg === 90) { minX = -(b.y + b.h); maxX = -b.y; minY = b.x; maxY = b.x + b.w; }
    else {
      minX = minY = Infinity; maxX = maxY = -Infinity;
      for (const [x, y] of outline(p)) {
        const X = x * cos - y * sin, Y = x * sin + y * cos;
        if (X < minX) minX = X; if (X > maxX) maxX = X;
        if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      }
      minX -= 0.3; minY -= 0.3; maxX += 0.3; maxY += 0.3; // contorno muestreado: pequeño resguardo
    }
    const gw = maxX - minX, gh = maxY - minY;
    const base = { p, deg, minX, minY };

    const block = labelLines(p);
    const line = [{ str: [p.name, ...p.info].join(' · '), size: INFO, bold: true }];
    // 1) bloque adentro, 2) una sola línea adentro, 3) debajo de la pieza
    // texto derecho si entra; si no, a lo largo de la pieza (a 90° se lee de abajo hacia arriba)
    const tries = deg === 0 ? [[false, 0]] : deg === 90 ? [[true, 0], [false, -90]] : [[false, readable(deg)]];
    for (const lines of [block, line]) {
      const { w: lw, h: lh } = blockSize(lines);
      for (const [swap, lrot] of tries) {
        const c = swap ? fitInside(p, lh, lw) : fitInside(p, lw, lh);
        if (!c) continue;
        const x = c.x + b.x, y = c.y + b.y;
        return { ...base, w: gw, h: gh, gx: 0, lines, lrot, lx: x * cos - y * sin - minX, ly: x * sin + y * cos - minY };
      }
    }
    const lines = blockSize(line).w <= Math.max(gw, 120) ? line : block;
    const { w: lw, h: lh } = blockSize(lines);
    const w = Math.max(gw, lw);
    return { ...base, w, h: gh + LABEL_GAP + lh, gx: (w - gw) / 2, lines, lx: w / 2, ly: gh + LABEL_GAP + lh / 2, lrot: 0 };
  }

  /* ---------------------------- dibujo de pieza ---------------------------- */

  function geomOps(p, o) {
    const ops = [P(p.path, { fill: o.fill ? COLORS[p.color] : null, evenodd: p.evenodd, sw: o.sw || 0.3 })];
    const at = (R, a) => `${f(R * Math.sin(a))} ${f(-R * Math.cos(a))}`;
    if (p.sector) {
      const { R1, R2, theta, baseTheta } = p.sector;
      const a0 = (theta - baseTheta) / 2; // centro del arco sin contar el solape
      // muescas de encastre en el centro de cada arco
      let d = `M${at(R2, a0)} L${at(R2 - NOTCH, a0)}`;
      if (R1 > 5) d += ` M${at(R1, a0)} L${at(R1 + NOTCH, a0)}`;
      ops.push(P(d));
      if (theta - baseTheta > 1e-6) {
        const a = -theta / 2 + (theta - baseTheta);
        ops.push(P(`M${at(R1, a)} L${at(R2, a)}`, { sw: 0.2, dash: [1.5, 1] }));
      }
    } else if (p.rect) {
      const { w, h, seamX } = p.rect;
      if (seamX) ops.push(P(`M${f(seamX)} 0 V${f(h)}`, { sw: 0.2, dash: [1.5, 1] }));
      const mx = (seamX || w) / 2, nl = Math.min(NOTCH, h / 4);
      if (w > 12 && p.color !== 'handle') ops.push(P(`M${f(mx)} 0 V${f(nl)} M${f(mx)} ${f(h)} V${f(h - nl)}`));
    }
    return ops;
  }

  function itemOps(it, o = {}) {
    const geom = G(geomOps(it.p, o), { m: rotation(it.deg, it.gx - it.minX, -it.minY) });
    const label = G(blockOps(it.lines, 0, 0), { m: rotation(it.lrot, it.lx, it.ly) });
    return [geom, label];
  }

  /* ------------------------------ maquetado ------------------------------ */

  /**
   * Formas en que la pieza entra en un área de W × H: derecha o a 90°, y si
   * ninguna entra, el giro libre que ocupe menos (un arco largo suele entrar en diagonal).
   */
  function options(p, W, H) {
    const fits = (it) => it.w <= W + 1e-6 && it.h <= H + 1e-6;
    const out = [0, 90].map((d) => prepare(p, d)).filter(fits);
    if (out.length || p.circle) return out;
    let best = null;
    for (let d = 1; d < (p.rect ? 90 : 180); d++) {
      if (d === 90) continue;
      const it = prepare(p, d);
      if (fits(it) && (!best || it.w * it.h < best.w * best.h)) best = it;
    }
    return best ? [best] : [];
  }

  function layout(pieces) {
    const pages = [];
    const normal = [], big = [];
    pieces.forEach((p) => {
      const opts = options(p, AREA.w, AREA.h);
      if (opts.length) normal.push(opts); else big.push(p);
    });
    normal.sort((a, b) => b[0].h - a[0].h);

    const place = (pg, it) => {
      for (const sh of pg.shelves) {
        if (it.h <= sh.h + 1e-6 && sh.x + it.w <= AREA.w + 1e-6) {
          pg.items.push({ ...it, x: sh.x, y: sh.y }); sh.x += it.w + GAP; return true;
        }
      }
      if (pg.usedH + it.h <= AREA.h + 1e-6) {
        pg.shelves.push({ y: pg.usedH, h: it.h, x: it.w + GAP });
        pg.items.push({ ...it, x: 0, y: pg.usedH }); pg.usedH += it.h + GAP; return true;
      }
      return false;
    };
    normal.forEach((opts) => {
      // antes de abrir otra hoja, probar cada orientación en las hojas que ya hay
      for (const pg of pages) if (opts.some((it) => place(pg, it))) return;
      const pg = { items: [], shelves: [], usedH: 0 };
      pages.push(pg);
      place(pg, opts[0]);
    });

    // solo si no entra de ninguna forma: dividir en varias hojas con solape
    big.forEach((p) => {
      const o = [prepare(p, 0), prepare(p, 90)].map((it) => ({
        it,
        cols: Math.max(1, Math.ceil((it.w - TILE_OVERLAP) / (AREA.w - TILE_OVERLAP))),
        rows: Math.max(1, Math.ceil((it.h - TILE_OVERLAP) / (AREA.h - TILE_OVERLAP))),
      })).sort((a, b) => a.cols * a.rows - b.cols * b.rows)[0];
      for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
        pages.push({
          items: [],
          tile: { item: o.it, piece: p, r, c, rows: o.rows, cols: o.cols, ox: c * (AREA.w - TILE_OVERLAP), oy: r * (AREA.h - TILE_OVERLAP) },
        });
      }
    });
    return pages;
  }

  /* ------------------------------ hoja completa ------------------------------ */

  function pageOps(pg, idx, total, meta, o = {}) {
    const ops = [];

    if (pg.tile) {
      const t = pg.tile;
      const tag = `${t.piece.name} ${String.fromCharCode(65 + t.r)}${t.c + 1} · superponer ${TILE_OVERLAP} mm`;
      ops.push(T(M, HEAD_Y, tag, { size: 2.4, anchor: 'start', bold: true }));
      ops.push(G([G(itemOps(t.item, o), { m: translate(AREA.x - t.ox, AREA.y - t.oy) })], { clip: AREA }));
      const dash = { stroke: '#888888', sw: 0.2, dash: [2, 1.5] };
      if (t.c > 0) ops.push(P(`M${AREA.x + TILE_OVERLAP} ${AREA.y} V${AREA.y + AREA.h}`, dash));
      if (t.r > 0) ops.push(P(`M${AREA.x} ${AREA.y + TILE_OVERLAP} H${AREA.x + AREA.w}`, dash));
      [[AREA.x, AREA.y], [AREA.x + AREA.w, AREA.y], [AREA.x, AREA.y + AREA.h], [AREA.x + AREA.w, AREA.y + AREA.h]].forEach(([x, y]) => {
        ops.push(P(`${Geo.circlePath(1.2, x, y)} M${x - 2} ${y} H${x + 2} M${x} ${y - 2} V${y + 2}`, { sw: 0.2 }));
      });
    } else {
      pg.items.forEach((it) => ops.push(G(itemOps(it, o), { m: translate(AREA.x + it.x, AREA.y + it.y) })));
    }
    if (total > 1) ops.push(T(PAGE.w - M, HEAD_Y, `${idx + 1}/${total}`, { size: 2.4, anchor: 'end', color: GREY }));
    ops.push(...rulerOps());
    return ops;
  }

  /** Regla de control de 10 cm en el margen inferior: impresa debe medir eso. */
  function rulerOps() {
    const y = RULER_Y, x0 = M;
    let major = `M${x0} ${y} H${x0 + 100}`, minor = '';
    for (let i = 0; i <= 100; i++) {
      if (i % 5 === 0) major += ` M${x0 + i} ${y} V${y + (i % 10 === 0 ? 2.5 : 1.7)}`;
      else minor += ` M${x0 + i} ${y} V${y + 1}`;
    }
    return [P(major, { sw: 0.2 }), P(minor.trim(), { sw: 0.1 })];
  }

  /* ---------------------------------- SVG ---------------------------------- */

  function toSVG(ops, ids = { n: 0 }) {
    return ops.map((op) => {
      if (op.t === 'path') {
        return `<path d="${op.d}" fill="${op.fill || 'none'}"${op.evenodd ? ' fill-rule="evenodd"' : ''} stroke="${op.stroke}" stroke-width="${op.sw}"` +
          `${op.dash ? ` stroke-dasharray="${op.dash.join(' ')}"` : ''} stroke-linejoin="round"/>`;
      }
      if (op.t === 'text') {
        return `<text x="${f(op.x)}" y="${f(op.y)}" font-size="${op.size}" text-anchor="${op.anchor}" font-family="'Courier Prime','Courier New',Courier,monospace"` +
          `${op.bold ? ' font-weight="700"' : ''} fill="${op.color}">${esc(op.str)}</text>`;
      }
      let pre = '', attrs = '';
      if (op.m) attrs += ` transform="matrix(${op.m.map(f).join(' ')})"`;
      if (op.clip) {
        const id = `clip${++ids.n}`, c = op.clip;
        pre = `<clipPath id="${id}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}"/></clipPath>`;
        attrs += ` clip-path="url(#${id})"`;
      }
      return `${pre}<g${attrs}>${toSVG(op.children, ids)}</g>`;
    }).join('');
  }

  function pageSVG(pg, idx, total, meta, o) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}">` +
      `<rect width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>${toSVG(pageOps(pg, idx, total, meta, o))}</svg>`;
  }

  /** Vista previa de una pieza sola con su rótulo, para la pantalla. */
  function previewSVG(p, o = {}) {
    const it = prepare(p, 0);
    return { w: it.w, h: it.h, inner: toSVG(itemOps(it, o)) };
  }

  /* ---------------------------------- PDF ---------------------------------- */

  const PT = 72 / 25.4;
  const n = (v) => String(+v.toFixed(4));
  const rgb = (hex) => [1, 3, 5].map((i) => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

  /** Texto a string PDF (WinAnsi). Todo queda en ASCII con escapes octales. */
  function pdfString(str) {
    let out = '';
    for (const ch of str) {
      for (const c of PDF_SUBST[ch] || ch) {
        const code = c.charCodeAt(0);
        if (c === '(' || c === ')' || c === '\\') out += '\\' + c;
        else if (code >= 32 && code < 127) out += c;
        else if (code >= 160 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
        else out += '?';
      }
    }
    return `(${out})`;
  }

  /** Arco circular SVG (desde x1,y1) → curvas Bézier cúbicas. */
  function arcToCurves(x1, y1, r, large, sweep, x2, y2) {
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) return [];
    r = Math.max(r, Math.sqrt(d2));
    let k = Math.sqrt(Math.max(0, r * r - d2) / d2);
    if (large === sweep) k = -k;
    const cx = (x1 + x2) / 2 + k * dy, cy = (y1 + y2) / 2 - k * dx;
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    let da = Math.atan2(y2 - cy, x2 - cx) - a1;
    if (sweep && da < 0) da += 2 * Math.PI;
    if (!sweep && da > 0) da -= 2 * Math.PI;
    const segs = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2) - 1e-9));
    const step = da / segs, t = (4 / 3) * Math.tan(step / 4);
    const out = [];
    for (let i = 0; i < segs; i++) {
      const a = a1 + i * step, b = a + step;
      const p0 = [cx + r * Math.cos(a), cy + r * Math.sin(a)], p3 = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
      out.push([p0[0] - t * r * Math.sin(a), p0[1] + t * r * Math.cos(a), p3[0] + t * r * Math.sin(b), p3[1] - t * r * Math.cos(b), p3[0], p3[1]]);
    }
    return out;
  }

  /** Datos de trazado (M L H V A Z absolutos, como los genera la app) → operadores PDF. */
  function pathToPDF(d) {
    const tk = d.match(/[MLHVAZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
    const out = [];
    let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0;
    const num = () => parseFloat(tk[i++]);
    while (i < tk.length) {
      if (/^[A-Za-z]$/.test(tk[i])) cmd = tk[i++].toUpperCase();
      if (cmd === 'M') { x = sx = num(); y = sy = num(); out.push(`${n(x)} ${n(y)} m`); cmd = 'L'; }
      else if (cmd === 'L') { x = num(); y = num(); out.push(`${n(x)} ${n(y)} l`); }
      else if (cmd === 'H') { x = num(); out.push(`${n(x)} ${n(y)} l`); }
      else if (cmd === 'V') { y = num(); out.push(`${n(x)} ${n(y)} l`); }
      else if (cmd === 'A') {
        const r = num(); num(); num(); const large = num(), sweep = num(), x2 = num(), y2 = num();
        arcToCurves(x, y, r, large, sweep, x2, y2).forEach((c) => out.push(`${c.map(n).join(' ')} c`));
        x = x2; y = y2;
      } else if (cmd === 'Z') { out.push('h'); x = sx; y = sy; cmd = null; }
      else i++;
    }
    return out.join('\n');
  }

  function toPDFContent(ops) {
    return ops.map((op) => {
      if (op.t === 'path') {
        return [
          `${n(op.sw)} w`, op.dash ? `[${op.dash.map(n).join(' ')}] 0 d` : '[] 0 d', `${rgb(op.stroke)} RG`,
          op.fill ? `${rgb(op.fill)} rg` : '', pathToPDF(op.d), op.fill ? (op.evenodd ? 'B*' : 'B') : 'S',
        ].filter(Boolean).join('\n');
      }
      if (op.t === 'text') {
        const w = textWidth(op.str, op.size);
        const x = op.anchor === 'middle' ? op.x - w / 2 : op.anchor === 'end' ? op.x - w : op.x;
        // la hoja está invertida en Y (como SVG); la matriz de texto la vuelve a enderezar
        return `BT /${op.bold ? 'F2' : 'F1'} ${n(op.size)} Tf ${rgb(op.color)} rg 1 0 0 -1 ${n(x)} ${n(op.y)} Tm ${pdfString(op.str)} Tj ET`;
      }
      return ['q', op.m ? `${op.m.map(n).join(' ')} cm` : '', op.clip ? `${n(op.clip.x)} ${n(op.clip.y)} ${n(op.clip.w)} ${n(op.clip.h)} re W n` : '',
        toPDFContent(op.children), 'Q'].filter(Boolean).join('\n');
    }).join('\n');
  }

  /** PDF completo: una página A4 (595,28 × 841,89 pt) por hoja, en milímetros reales. */
  function buildPDF(pages, meta, o = {}) {
    const objs = [];
    const add = (s) => objs.push(s);
    add(null); add(null); // 1 catálogo, 2 árbol de páginas
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');       // 3
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');  // 4
    add(`<< /Title ${pdfString(meta.title || 'Plantilla')} /Creator (Object Builder) >>`);                  // 5
    const kids = [];
    pages.forEach((pg, i) => {
      const body = `q 1 j ${n(PT)} 0 0 ${n(-PT)} 0 ${n(PAGE.h * PT)} cm\n${toPDFContent(pageOps(pg, i, pages.length, meta, o))}\nQ`;
      add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
      const contentId = objs.length;
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE.w * PT)} ${n(PAGE.h * PT)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
      kids.push(objs.length);
    });
    // PrintScaling /None: pide al visor que imprima sin ajustar a la página
    objs[0] = '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None >> >>';
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets = objs.map((obj, i) => { const at = out.length; out += `${i + 1} 0 obj\n${obj}\nendobj\n`; return at; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }

  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  global.Sheet = { PAGE, AREA, layout, pageOps, pageSVG, previewSVG, buildPDF, download };
})(typeof window !== 'undefined' ? window : globalThis);
