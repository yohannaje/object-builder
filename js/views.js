/* Vista lateral (perfil) con medidas en crudo y finales, piezas desarrolladas y hojas A4. */
(function () {
  const $ = (s) => document.querySelector(s);
  const f = (n) => +n.toFixed(3);
  /** mm → cm con 1 decimal fijo (el ancho del número no cambia al editar) */
  const c1 = (mm) => (mm / 10).toFixed(1).replace('.', ',');
  const pct = (n) => String(+n.toFixed(1)).replace('.', ',');
  const ml = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2).replace('.', ',')} l` : `${Math.round(v)} ml`);
  // el marco del dibujo crece de a 2 cm: pequeños cambios no re-escalan todo
  const STEP = 20;

  function radii(mode, t) {
    const rOut = (d) => (mode === 'outer' ? d / 2 : mode === 'mid' ? d / 2 + t / 2 : d / 2 + t);
    return { rOut, rIn: (d) => Math.max(0, rOut(d) - t) };
  }

  /** Alto, diámetros (tal como se escriben) y capacidad interior sobre la base, en mm y ml. */
  function measure(d) {
    const { rIn } = radii(d.diameterMode, d.thickness);
    const secs = Geo.resolveSections(d);
    const baseIdx = secs.findIndex((s) => s.type === 'base');
    const walls = secs.map((s, i) => ({ s, i })).filter((w) => w.s.type !== 'base');
    const H = walls.reduce((a, w) => a + (w.s.height || 0), 0);
    const vol = walls.filter((w) => w.i > baseIdx && w.s.height > 0).reduce((a, { s }) => {
      const r1 = rIn(s.bottomD), r2 = rIn(s.topD);
      return a + (Math.PI * s.height * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
    }, 0);
    const last = walls[walls.length - 1];
    return {
      H,
      dTop: last ? last.s.topD : 0,
      dMax: Math.max(0, ...secs.flatMap((s) => [s.bottomD, s.topD])),
      dBase: baseIdx >= 0 ? d.baseDiameter : secs[0] ? secs[0].bottomD : 0,
      ml: vol / 1000,
    };
  }

  /* --------------------------- tabla crudo / final --------------------------- */

  function renderStats() {
    const st = App.state, S = App.shrink(), finalMode = st.sizeMode === 'final';
    const raw = measure(App.rawDesign());
    const k = 1 - S;
    const fin = { H: raw.H * k, dTop: raw.dTop * k, dMax: raw.dMax * k, dBase: raw.dBase * k, ml: raw.ml * k * k * k };
    const side = { outer: 'ext.', mid: 'eje', inner: 'int.' }[st.diameterMode];
    const cm = (v) => `${c1(v)} cm`;
    const rows = [
      ['alto', 'H', cm], [`⌀ boca ${side}`, 'dTop', cm], [`⌀ máximo ${side}`, 'dMax', cm],
      [`⌀ base ${side}`, 'dBase', cm], ['capacidad', 'ml', ml],
    ];
    const cls = (mine) => (mine ? ' class="mine"' : '');
    $('#stats').innerHTML =
      `<table class="stats"><colgroup><col class="c-name"><col><col></colgroup><thead><tr><th></th>` +
      `<th${cls(!finalMode)}>en crudo</th><th${cls(finalMode)}>final</th></tr></thead><tbody>` +
      rows.map(([n, key, fmt]) => `<tr><th>${n}</th><td${cls(!finalMode)}>${fmt(raw[key])}</td><td${cls(finalMode)}>${fmt(fin[key])}</td></tr>`).join('') +
      `</tbody></table>`;

    const other = finalMode ? 'crudo' : 'final';
    $('#summary').innerHTML = S > 0
      ? `<span class="legend"><span><i></i>${finalMode ? 'final' : 'crudo'}</span><span><i class="dash"></i>${other}</span></span>`
      : '';
  }

  /* ------------------------------ perfil 2D ------------------------------ */

  App.renderProfile = () => {
    const st = App.state;
    const S = App.shrink();
    const finalMode = st.sizeMode === 'final';
    const secs = App.resolved();
    const box = $('#profile');
    // se dibuja en la escala de lo que se escribió; el espesor escrito es en crudo
    const t = finalMode ? st.thickness * (1 - S) : st.thickness;
    const kRef = finalMode ? 1 / (1 - S) : 1 - S; // silueta punteada: la otra etapa
    const { rOut, rIn } = radii(st.diameterMode, t);

    renderStats();
    if (!secs.length) {
      box.innerHTML = '<p class="empty-note">Sin secciones todavía.</p>';
      return;
    }

    let y = 0;
    const walls = [], joints = [];
    let baseY = null, baseIdx = -1;
    secs.forEach((s, i) => {
      if (s.type === 'base') { baseY = y; baseIdx = i; joints.push({ y, d: st.baseDiameter }); return; }
      walls.push({ s, i, y0: y, y1: y + s.height });
      joints.push({ y, d: s.bottomD }, { y: y + s.height, d: s.topD });
      y += s.height;
    });
    const H = Math.max(y, t, 1);
    const maxR = Math.max(...secs.map((s) => Math.max(rOut(s.bottomD), rOut(s.topD))), baseIdx >= 0 ? rOut(st.baseDiameter) : 0, 5);

    const radiusAt = (yy) => {
      const w = walls.find((w) => yy >= w.y0 - 1e-6 && yy <= w.y1 + 1e-6 && w.s.height > 0) || walls[walls.length - 1];
      if (!w) return rOut(st.baseDiameter);
      const k = w.s.height > 0 ? (yy - w.y0) / w.s.height : 0;
      return rOut(w.s.bottomD + (w.s.topD - w.s.bottomD) * Math.max(0, Math.min(1, k)));
    };

    // asas: tira de largo L doblada en semicírculo → radio L/π
    let handleExt = 0;
    const handleShapes = st.handles.flatMap((hd, n) => Array.from({ length: hd.count || 1 }, (_, k) => {
      const r = hd.length / Math.PI;
      const a = Math.min(Math.max(hd.attach, r), Math.max(H - r, r));
      // cada extremo se apoya sobre la pared a su altura (en paredes inclinadas no están alineados)
      const xTop = radiusAt(a + r), xBot = radiusAt(a - r);
      handleExt = Math.max(handleExt, Math.max(xTop, xBot) + r + t);
      return { r, a, xTop, xBot, side: (n + k) % 2 ? -1 : 1 };
    }));

    const grow = S > 0 && kRef > 1 ? kRef : 1;
    const Hq = Math.max(STEP, Math.ceil((H * grow) / (STEP / 2)) * (STEP / 2));
    const Rq = Math.max(STEP, Math.ceil(Math.max(maxR * grow, handleExt) / STEP) * STEP);
    // escala en píxeles reales: el texto y los márgenes miden siempre lo mismo en pantalla,
    // aunque el objeto sea alto, bajo, angosto o ancho
    const W = box.clientWidth || 600;
    const maxH = Math.max(240, Math.min(560, window.innerHeight - 380));
    const PX = { u: 3.4, padL: 76, padR: 144, padT: 20, padB: 18 };
    const scale = Math.max(0.05, Math.min((W - PX.padL - PX.padR) / (2 * Rq), (maxH - PX.padT - PX.padB) / Hq));
    const u = PX.u / scale;
    const fs = 3.2 * u; // ≈ 11 px
    const padL = PX.padL / scale, padR = PX.padR / scale, padT = PX.padT / scale, padB = PX.padB / scale;
    const Y = (yy) => f(Hq - yy);
    const vb = [-(Rq + padL), -padT, 2 * Rq + padL + padR, Hq + padT + padB];
    const svgH = Math.round((Hq + padT + padB) * scale);
    const nss = 'vector-effect="non-scaling-stroke"';
    const text = (x, yy, str, anchor = 'start', extra = '') =>
      `<text x="${f(x)}" y="${f(yy)}" font-size="${f(fs)}" text-anchor="${anchor}" font-family="var(--font)" fill="var(--ink-2)" ${extra}>${str}</text>`;
    const ref = (mm) => (S > 0 ? `<tspan fill="var(--ink-3)"> (${c1(mm * kRef)})</tspan>` : '');

    let svg = `<svg viewBox="${vb.map(f).join(' ')}" style="height:${svgH}px" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vista lateral">`;
    svg += `<path d="M${f(-Rq - padL * 0.4)} ${Y(0)} H${f(Rq + padR * 0.2)}" stroke="var(--line)" stroke-width="1" ${nss}/>`;
    svg += `<path d="M0 ${Y(H * grow + 4 * u)} V${Y(0)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="6 4" ${nss}/>`;

    const inner = walls.filter((w) => w.i > baseIdx && w.s.height > 0);
    if (inner.length) {
      const right = inner.flatMap((w) => [[rIn(w.s.bottomD), w.y0], [rIn(w.s.topD), w.y1]]);
      const pts = [...right, ...right.slice().reverse().map(([x, yy]) => [-x, yy])];
      svg += `<path d="M${pts.map(([x, yy]) => `${f(x)} ${Y(yy)}`).join(' L')} Z" fill="var(--accent-soft)" opacity=".35"/>`;
    }

    walls.forEach((w) => {
      if (w.s.height <= 0) return;
      const sel = App.selected === w.s.id;
      const ob = rOut(w.s.bottomD), ot = rOut(w.s.topD), ib = rIn(w.s.bottomD), it = rIn(w.s.topD);
      const style = `fill="var(--c-${w.s.type})" stroke="${sel ? 'var(--accent)' : 'var(--ink)'}" stroke-width="${sel ? 2.2 : 1}" stroke-linejoin="round" ${nss}`;
      [1, -1].forEach((sd) => {
        svg += `<path class="wall" data-id="${w.s.id}" d="M${f(sd * ib)} ${Y(w.y0)} L${f(sd * ob)} ${Y(w.y0)} L${f(sd * ot)} ${Y(w.y1)} L${f(sd * it)} ${Y(w.y1)} Z" ${style}><title>${Geo.TYPE_NAMES[w.s.type]}</title></path>`;
      });
    });

    if (baseY != null) {
      const sel = App.selected === secs[baseIdx].id;
      const r = rOut(st.baseDiameter);
      svg += `<rect class="wall" data-id="${secs[baseIdx].id}" x="${f(-r)}" y="${Y(baseY + t)}" width="${f(2 * r)}" height="${f(t)}" fill="var(--c-base)" stroke="${sel ? 'var(--accent)' : 'var(--ink)'}" stroke-width="${sel ? 2.2 : 1}" ${nss}><title>Base</title></rect>`;
    }

    handleShapes.forEach((hs) => {
      const d = `M${f(hs.side * hs.xTop)} ${Y(hs.a + hs.r)} A${f(hs.r)} ${f(hs.r)} 0 0 ${hs.side > 0 ? 1 : 0} ${f(hs.side * hs.xBot)} ${Y(hs.a - hs.r)}`;
      svg += `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="${f(t + 1.2)}" stroke-linecap="round"/>`;
      svg += `<path d="${d}" fill="none" stroke="var(--c-handle)" stroke-width="${f(t)}" stroke-linecap="round"/>`;
    });

    // silueta exterior de la otra etapa (final si se diseña en crudo, o al revés)
    const outline = walls.filter((w) => w.s.height > 0).flatMap((w) => [[rOut(w.s.bottomD), w.y0], [rOut(w.s.topD), w.y1]]);
    if (S > 0 && outline.length) {
      const side = (sd) => outline.map(([x, yy]) => `${f(sd * x * kRef)} ${Y(yy * kRef)}`).join(' L');
      svg += `<path d="M${side(1)} M${side(-1)}" fill="none" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="5 4" opacity=".6" ${nss}/>`;
    }

    // cotas de altura (izquierda)
    const xH = -Rq - padL * 0.3;
    walls.forEach((w) => {
      if (w.s.height <= 0) return;
      svg += `<path d="M${f(xH - u)} ${Y(w.y0)} H${f(xH + u)} M${f(xH)} ${Y(w.y0)} V${Y(w.y1)} M${f(xH - u)} ${Y(w.y1)} H${f(xH + u)}" stroke="var(--ink-3)" stroke-width="1" ${nss}/>`;
      if (w.s.height > fs * 1.1) svg += text(xH - 1.6 * u, (Y(w.y0) + Y(w.y1)) / 2 + fs * 0.35, c1(w.s.height), 'end');
    });
    const xT = -Rq - padL * 0.82;
    svg += `<path d="M${f(xT)} ${Y(0)} V${Y(H)} M${f(xT - u)} ${Y(0)} H${f(xT + u)} M${f(xT - u)} ${Y(H)} H${f(xT + u)}" stroke="var(--ink)" stroke-width="1" ${nss}/>`;
    const midY = (Y(0) + Y(H)) / 2;
    svg += text(xT - 1.2 * u, midY, `${c1(H)} cm${ref(H)}`, 'middle', `transform="rotate(-90 ${f(xT - 1.2 * u)} ${f(midY)})" fill="var(--ink)"`);

    // diámetros en cada unión (derecha), sin superponer rótulos
    const seen = [];
    joints.sort((a, b) => a.y - b.y).forEach((j) => {
      if (!seen.some((s) => Math.abs(s.y - j.y) < 0.01 && Math.abs(s.d - j.d) < 0.05)) seen.push(j);
    });
    let lastLabelY = -Infinity;
    const xl = Rq + padR * 0.06;
    seen.forEach((j) => {
      const ly = Math.max(j.y, lastLabelY + fs * 1.25);
      lastLabelY = ly;
      svg += `<path d="M${f(rOut(j.d) + u * 0.6)} ${Y(j.y)} L${f(xl)} ${Y(ly)} H${f(xl + u * 1.5)}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 2" fill="none" ${nss}/>`;
      svg += text(xl + u * 2, Y(ly) + fs * 0.35, `⌀ ${c1(j.d)}${ref(j.d)}`);
    });

    svg += '</svg>';
    box.innerHTML = svg;
    box.querySelectorAll('.wall').forEach((el) => el.addEventListener('click', () => {
      App.selected = el.dataset.id;
      App.renderSelection();
      document.querySelector(`#stack .card[data-id="${el.dataset.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }));
  };

  /* --------------------------- piezas desarrolladas --------------------------- */

  let piecesKey = null;
  App.renderPieces = () => {
    const box = $('#pieces');
    const pieces = App.pieces;
    const key = JSON.stringify(pieces.map((p) => [p.id, p.name, p.path, p.info]));
    if (key === piecesKey) {
      box.querySelectorAll('.piece').forEach((el) => el.classList.toggle('sel', el.dataset.id === App.selected));
      return;
    }
    piecesKey = key;
    box.innerHTML = '';
    if (!pieces.length) { box.innerHTML = '<p class="empty-note">No hay piezas.</p>'; return; }
    const maxDim = Math.max(...pieces.map((p) => Math.max(p.bbox.w, p.bbox.h)));
    const s = Math.max(0.35, Math.min(1.1, 300 / maxDim)); // misma escala para todas: se comparan tamaños
    pieces.forEach((p) => {
      const pv = Sheet.previewSVG(p, { fill: true, sw: 0.5 });
      const fig = document.createElement('figure');
      fig.className = `piece${App.selected === p.id ? ' sel' : ''}`;
      fig.dataset.id = p.id;
      fig.style.margin = '0';
      fig.innerHTML = `<svg width="${f(pv.w * s)}" height="${f(pv.h * s)}" viewBox="-1 -1 ${f(pv.w + 2)} ${f(pv.h + 2)}">${pv.inner}</svg>` +
        `<figcaption>${App.cm(p.bbox.w)} × ${App.cm(p.bbox.h)} cm</figcaption>`;
      fig.addEventListener('click', () => {
        if (!App.state.sections.some((x) => x.id === p.id)) return;
        App.selected = p.id;
        App.renderSelection();
      });
      box.append(fig);
    });
  };

  /* -------------------------------- hojas A4 -------------------------------- */

  let pagesKey = null;
  App.renderPages = () => {
    const box = $('#pages');
    const pages = App.pages;
    const meta = App.pageMeta();
    const key = `${piecesKey}|${JSON.stringify(meta)}|${App.printFill}`;
    if (key === pagesKey) return;
    pagesKey = key;
    box.innerHTML = '';
    if (!pages.length) { box.innerHTML = '<p class="empty-note">No hay hojas.</p>'; return; }
    pages.forEach((pg, i) => {
      const div = document.createElement('div');
      div.className = 'page-thumb';
      const what = pg.tile ? `${pg.tile.piece.name} (${String.fromCharCode(65 + pg.tile.r)}${pg.tile.c + 1})` : pg.items.map((it) => it.p.name).join(', ');
      div.innerHTML = Sheet.pageSVG(pg, i, pages.length, meta, { fill: App.printFill }) +
        `<div class="page-cap"><span>${i + 1} · ${what}</span>` +
        `<button class="ib" title="Descargar esta hoja en SVG" aria-label="Descargar hoja ${i + 1} en SVG"><i class="ph ph-file-svg"></i></button></div>`;
      div.querySelector('button').addEventListener('click', () => App.downloadPage(i));
      box.append(div);
    });
  };
})();
