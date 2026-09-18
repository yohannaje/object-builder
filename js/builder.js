/* Menú de secciones (arrastrable), medidas generales y constructor apilado. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && el.append(c));
    return el;
  };
  App.h = h;

  /**
   * Hace que `a` (en pantalla) se vea como `b` (recién construido) tocando solo
   * lo que cambió: los campos conservan foco y cursor y nada se re-dibuja de golpe.
   * Si cambia la estructura de una tarjeta (data-sig) se reemplaza entera.
   */
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName ||
        (a.nodeType === 1 && a.getAttribute('data-sig') !== b.getAttribute('data-sig'))) {
      a.replaceWith(b);
      return;
    }
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
    for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
    const ac = [...a.childNodes], bc = [...b.childNodes];
    for (let i = 0; i < Math.max(ac.length, bc.length); i++) {
      if (!ac[i]) a.append(bc[i]);
      else if (!bc[i]) ac[i].remove();
      else morph(ac[i], bc[i]);
    }
    const focused = a === document.activeElement;
    if (a.tagName === 'INPUT') {
      if (!focused && a.value !== b.value) a.value = b.value;
      if (a.checked !== b.checked) a.checked = b.checked;
    } else if (a.tagName === 'SELECT' && !focused && a.value !== b.value) a.value = b.value;
  }
  App.morph = morph;

  const TYPE = Geo.TYPE_NAMES;
  const SHAPES = [['out', 'abre'], ['straight', 'recto'], ['in', 'cierra']];
  const DND = 'application/x-conos';

  /* ------------------------------ paleta ------------------------------ */

  const ICONS = {
    foot: '<path d="M6 16H40" stroke-dasharray="2 2"/><rect x="13" y="18" width="20" height="12" fill="var(--c-foot)"/>',
    base: '<ellipse cx="23" cy="22" rx="18" ry="6" fill="var(--c-base)"/>',
    out: '<path d="M15 30H31L40 4H6Z"/>',
    straight: '<path d="M10 30H36V4H10Z"/>',
    in: '<path d="M6 30H40L31 4H15Z"/>',
    handle: '<path d="M14 6V30" stroke-width="2.5"/><path d="M14 9C30 9 30 27 14 27" fill="none" stroke="var(--ink)" stroke-width="5"/><path d="M14 9C30 9 30 27 14 27" fill="none" stroke="var(--c-handle)" stroke-width="3"/>',
  };
  const SHAPE_TITLES = { out: 'Abre hacia arriba', straight: 'Recto', in: 'Cierra hacia arriba' };
  const shapeIcon = (k) => `<svg viewBox="4 2 38 30" width="19" height="15" aria-hidden="true"><path d="${ICONS[k].match(/d="([^"]+)"/)[1]}" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
  const ph = (name) => h('i', { class: `ph ph-${name}`, 'aria-hidden': 'true' });
  App.ph = ph;
  const icon = (k, type) => `<svg viewBox="0 0 46 34" fill="var(--c-${type})" stroke="var(--ink)" stroke-width="1.1" stroke-linejoin="round">${ICONS[k]}</svg>`;

  const TILES = [
    { key: 'foot', label: 'Pie', sub: 'anillo de apoyo', ic: icon('foot', 'foot') },
    { key: 'base', label: 'Base', sub: 'disco', ic: icon('base', 'base') },
    ...SHAPES.map(([s, n]) => ({ key: `body-${s}`, label: 'Cuerpo', aria: `Cuerpo ${n}`, ic: icon(s, 'body') })),
    ...SHAPES.map(([s, n]) => ({ key: `neck-${s}`, label: 'Cuello', aria: `Cuello ${n}`, ic: icon(s, 'neck') })),
    { key: 'handle', label: 'Asa', sub: 'tira', ic: icon('handle', 'handle') },
  ];

  App.renderPalette = () => {
    const box = $('#palette');
    box.innerHTML = '';
    TILES.forEach((t, i) => {
      const el = h('div', {
        class: 'tile', draggable: 'true', role: 'button', tabindex: '0', 'data-key': t.key,
        title: 'Arrastrá al constructor o hacé clic', 'aria-label': t.aria || `${t.label} ${t.sub}`,
        ondragstart: (e) => {
          if (el.getAttribute('aria-disabled') === 'true') return e.preventDefault();
          e.dataTransfer.setData(DND, JSON.stringify({ add: t.key }));
          e.dataTransfer.setData('text/plain', t.label);
          e.dataTransfer.effectAllowed = 'copy';
        },
        onclick: () => el.getAttribute('aria-disabled') !== 'true' && App.addSection(t.key),
        onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), el.click()),
        html: `${t.ic}<span>${t.label}</span>${t.sub ? `<small>${t.sub}</small>` : ''}`,
      });
      box.append(el);
    });
  };

  App.updatePalette = () => {
    const hasBase = App.state.sections.some((s) => s.type === 'base');
    const tile = $('#palette [data-key="base"]');
    if (tile) tile.setAttribute('aria-disabled', hasBase ? 'true' : 'false');
  };

  /* --------------------------- campos numéricos --------------------------- */

  /**
   * Campo numérico. `fkey` identifica el campo para conservar foco y texto
   * mientras se re-dibuja la interfaz.
   */
  function numField(label, value, unit, onValue, o = {}) {
    const input = h('input', {
      type: 'text', inputmode: 'decimal', value: o.format ? o.format(value) : value,
      'data-fkey': o.fkey, readonly: o.readonly, 'aria-label': typeof label === 'string' ? label : o.aria,
      oninput: (e) => {
        const v = App.parseNum(e.target.value);
        if (Number.isFinite(v) && (o.min == null || v >= o.min)) onValue(v, o.fkey);
      },
      onfocus: (e) => { if (!App.restoring && !o.readonly) e.target.select(); },
    });
    return h('label', { class: 'field' },
      h('span', {}, label),
      h('span', { class: `num${o.readonly ? ' readonly' : ''}` }, input, h('i', {}, unit)));
  }
  App.numField = numField;
  const cmFmt = (mm) => App.cm(mm);

  /* --------------------------- medidas generales -------------------------- */

  App.renderSettings = () => {
    const st = App.state;
    const live = $('#settings');
    const form = live.cloneNode(false);
    const set = (k, mul = 1) => (v, key) => App.commit((s) => { s[k] = v * mul; }, key);
    const pct = (n) => String(+n.toFixed(1)).replace('.', ',');
    const select = (label, value, options, onchange) => h('label', { class: 'field' }, h('span', {}, label),
      h('select', { onchange: (e) => onchange(e.target.value) },
        ...options.map(([v, n]) => h('option', { value: v, selected: value === v }, n))));
    const S = App.shrink();

    form.append(
      numField('⌀ de la base', st.baseDiameter, 'cm', set('baseDiameter', 10), { fkey: 'g:base', format: cmFmt, min: 0.1 }),
      numField('Espesor de la plancha', st.thickness, 'mm', set('thickness'), { fkey: 'g:t', min: 0 }),
      select('Los ⌀ se miden por', st.diameterMode,
        [['outer', 'fuera (exterior)'], ['mid', 'el centro de la plancha'], ['inner', 'dentro (interior)']],
        (v) => App.commit((s) => { s.diameterMode = v; })),
      numField('Solape en la unión', st.seamOverlap, 'mm', set('seamOverlap'), { fkey: 'g:ov', min: 0 }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.baseDisc !== false, onchange: (e) => App.commit((s) => { s.baseDisc = e.target.checked; }) }), 'cortar disco de base'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!st.topDisc, onchange: (e) => App.commit((s) => { s.topDisc = e.target.checked; }) }), 'cortar tapa superior'),
      h('h3', { class: 'sub' }, 'Contracción'),
      numField('Secado + horno (lineal total)', st.shrinkage, '%', set('shrinkage'), { fkey: 'g:shr', min: 0 }),
      select('Las medidas que escribo son', st.sizeMode,
        [['raw', 'en crudo (recién armada)'], ['final', 'finales (ya horneada)']],
        (v) => App.commit((s) => { s.sizeMode = v; })),
    );
    morph(live, form);
  };

  /* ------------------------------ constructor ------------------------------ */

  App.renderStack = () => {
    const live = $('#stack');
    const list = live.cloneNode(false);
    const secs = App.resolved();
    const raw = Geo.resolveSections(App.rawDesign());
    list.classList.toggle('empty', !secs.length);
    if (!secs.length) {
      list.append(h('li', { class: 'hint' }, 'Arrastrá una Base y un Cuerpo aquí'));
    } else {
      const counters = {};
      const labels = secs.map((s) => `${TYPE[s.type]}${s.type === 'base' ? '' : ' ' + (counters[s.type] = (counters[s.type] || 0) + 1)}`);
      for (let i = secs.length - 1; i >= 0; i--) list.append(card(secs[i], i, labels[i], secs, raw[i]));
    }
    clearDrop();
    morph(live, list);
  };

  function card(s, i, label, secs, rawS) {
    const st = App.state;
    const raw = st.sections[i];
    const isWall = s.type !== 'base';
    const prev = secs[i - 1];
    const upd = (fn) => (v, key) => App.commit((x) => fn(x.sections[App.findIndex(s.id)], v, x), key);
    const el = h('li', {
      class: `card${App.selected === s.id ? ' sel' : ''}`, 'data-id': s.id, 'data-index': i,
      // lo que cambia la estructura o lo que usan los botones: si difiere, la tarjeta se rehace
      'data-sig': [s.id, i, secs.length, s.type, s.shape, !!prev].join('|'),
      style: `--c: var(--c-${s.type})`,
      onfocusin: () => { if (App.selected !== s.id) { App.selected = s.id; App.renderSelection(); } },
      onclick: (e) => { if (App.selected !== s.id && !e.target.closest('button')) { App.selected = s.id; App.renderSelection(); } },
      ondragstart: (e) => {
        e.dataTransfer.setData(DND, JSON.stringify({ move: s.id }));
        e.dataTransfer.setData('text/plain', label);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => el.classList.add('dragging'));
      },
      ondragend: () => { el.classList.remove('dragging'); el.draggable = false; clearDrop(); },
    });

    const grip = h('span', { class: 'grip', title: 'Arrastrar para reordenar', 'aria-hidden': 'true',
      onpointerdown: () => { el.draggable = true; }, onpointerup: () => { el.draggable = false; } }, ph('dots-six-vertical'));

    const head = h('div', { class: 'card-head' },
      h('span', { class: 'card-title' }, grip,
        isWall
          ? h('input', { value: raw.name || '', placeholder: label, 'data-fkey': `${s.id}:name`, 'aria-label': 'Nombre',
              oninput: (e) => App.commit((x) => { x.sections[App.findIndex(s.id)].name = e.target.value; }, `${s.id}:name`) })
          : label),
      s.type === 'body' || s.type === 'neck'
        ? h('span', { class: 'seg', role: 'group', 'aria-label': 'Forma' }, ...SHAPES.map(([k]) =>
            h('button', { class: s.shape === k ? 'on' : '', 'aria-pressed': s.shape === k ? 'true' : 'false',
              title: SHAPE_TITLES[k], 'aria-label': SHAPE_TITLES[k], html: shapeIcon(k),
              onclick: () => App.commit((x) => { const r = x.sections[App.findIndex(s.id)]; r.shape = k; if (k !== 'straight' && !r.delta) r.delta = 20; }) })))
        : null,
      h('span', { class: 'icon-btns' },
        isWall ? h('button', { class: 'ib', title: 'Duplicar', 'aria-label': 'Duplicar', onclick: () => App.duplicateSection(s.id) }, ph('copy')) : null,
        h('button', { class: 'ib danger', title: 'Eliminar', 'aria-label': 'Eliminar', onclick: () => App.removeSection(s.id) }, ph('trash'))),
    );

    el.append(head);
    const fields = h('div', { class: 'card-fields' });
    const warns = [];

    if (s.type === 'base') {
      fields.append(numField('⌀ base', st.baseDiameter, 'cm', (v, key) => App.commit((x) => { x.baseDiameter = v * 10; }, key), { fkey: 'g:base2', format: cmFmt, min: 0.1 }));
    } else if (s.type === 'foot') {
      fields.append(
        numField('⌀ pie', s.bottomD, 'cm', upd((r, v) => { r.bottomD = v * 10; }), { fkey: `${s.id}:bd`, format: cmFmt, min: 0.1 }),
        numField('altura', s.height, 'cm', upd((r, v) => { r.height = v * 10; }), { fkey: `${s.id}:h`, format: cmFmt, min: 0 }),
      );
      const next = secs[i + 1];
      if (next && next.type === 'base' && s.topD >= st.baseDiameter) warns.push('El pie debería ser más angosto que la base.');
    } else {
      fields.append(
        numField('altura', s.height, 'cm', upd((r, v) => { r.height = v * 10; }), { fkey: `${s.id}:h`, format: cmFmt, min: 0 }),
        numField('⌀ abajo', s.bottomD, 'cm', upd((r, v) => { r.bottomD = v * 10; }),
          { fkey: `${s.id}:bd`, format: cmFmt, min: 0, readonly: !!prev }),
        numField('⌀ arriba', s.topD, 'cm', upd((r, v, x) => {
          const bottom = App.resolved()[App.findIndex(s.id)].bottomD;
          const top = v * 10;
          r.delta = Math.abs(top - bottom);
          r.shape = r.delta < 0.05 ? 'straight' : top > bottom ? 'out' : 'in';
        }), { fkey: `${s.id}:td`, format: cmFmt, min: 0 }),
      );
      if (s.height > 0) {
        // geometría de la plantilla (en crudo), que es lo que se corta
        const mid = (d) => Geo.midDiameter(d, st.diameterMode, st.thickness);
        const g = Geo.frustum(mid(rawS.bottomD), mid(rawS.topD), rawS.height);
        if (g.kind === 'sector' && g.wallDeg > 60) warns.push('Pared muy inclinada (> 60°): va a costar que se sostenga.');
      } else warns.push('Poné una altura mayor a 0.');
      if (s.shape === 'in' && s.topD <= 0.05) warns.push('El cono se cierra en punta (⌀ arriba = 0).');
      if (prev && prev.type !== 'base' && Math.abs(prev.topD - s.bottomD) > 0.05) warns.push(`Escalón de ⌀ ${App.cm(prev.topD)} a ${App.cm(s.bottomD)} cm: se agrega un anillo.`);
      if (!prev && st.sections.some((x) => x.type === 'base')) warns.push('Está debajo de la base.');
    }

    el.append(fields);
    warns.forEach((w) => el.append(h('div', { class: 'card-warn' }, '⚠ ' + w)));

    return el;
  }

  /* ---------------------------- arrastrar/soltar --------------------------- */

  let dropLine = null;
  function clearDrop() { dropLine?.remove(); dropLine = null; }

  /** Índice en el arreglo (0 = apoyo) según la posición del mouse en la lista invertida. */
  function dropIndex(list, y) {
    const cards = [...list.querySelectorAll('.card:not(.dragging)')];
    let before = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = c; break; }
    }
    if (!before) return { index: cards.length ? +cards[cards.length - 1].dataset.index : App.state.sections.length, before: null };
    return { index: +before.dataset.index + 1, before };
  }

  App.initStackDnD = () => {
    const list = $('#stack');
    const zone = $('.builder-col');
    zone.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes(DND)) return;
      e.preventDefault();
      const { before } = dropIndex(list, e.clientY);
      if (!dropLine) dropLine = h('li', { class: 'drop-line' });
      if (before) list.insertBefore(dropLine, before); else list.append(dropLine);
    });
    zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) clearDrop(); });
    zone.addEventListener('drop', (e) => {
      const raw = e.dataTransfer.getData(DND);
      if (!raw) return;
      e.preventDefault();
      const { index } = dropIndex(list, e.clientY);
      clearDrop();
      const data = JSON.parse(raw);
      if (data.add) App.addSection(data.add, data.add === 'handle' ? null : index);
      else if (data.move) App.moveSection(data.move, index);
    });
  };

  /* --------------------------------- asas --------------------------------- */

  App.renderHandles = () => {
    const live = $('#handles');
    const box = live.cloneNode(false);
    const st = App.state;
    box.hidden = !st.handles.length;
    st.handles.forEach((hd, i) => {
      const upd = (k, mul = 10) => (v, key) => App.commit((x) => { x.handles[i][k] = v * mul; }, key);
      box.append(h('div', { class: 'card', style: '--c: var(--c-handle)', 'data-sig': `${hd.id}|${i}` },
        h('div', { class: 'card-head' },
          h('span', { class: 'card-title' }, `Asa ${i + 1}`),
          h('span', { class: 'icon-btns' }, h('button', { class: 'ib danger', title: 'Eliminar asa', 'aria-label': 'Eliminar asa', onclick: () => App.commit((x) => { x.handles.splice(i, 1); }) }, ph('trash')))),
        h('div', { class: 'card-fields', style: 'grid-template-columns: repeat(4, 1fr)' },
          numField('largo', hd.length, 'cm', upd('length'), { fkey: `${hd.id}:l`, format: cmFmt, min: 0.1 }),
          numField('ancho', hd.width, 'cm', upd('width'), { fkey: `${hd.id}:w`, format: cmFmt, min: 0.1 }),
          numField('altura', hd.attach, 'cm', upd('attach'), { fkey: `${hd.id}:a`, format: cmFmt, min: 0 }),
          numField('cant.', hd.count, 'u', upd('count', 1), { fkey: `${hd.id}:c`, min: 1 }))));
    });
    morph(live, box);
  };
})();
