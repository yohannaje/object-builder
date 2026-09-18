/* Estado del diseño, historial y ejemplos. Unidades internas: mm. */
(function () {
  const App = (window.App = {});
  const STORE = 'conos.design.v1';

  App.uid = () => Math.random().toString(36).slice(2, 9);
  /** "8,5" | "8.5" (cm) → 85 (mm); NaN si no es número */
  App.parseCm = (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 1000) / 100;
  App.parseNum = (v) => parseFloat(String(v).replace(',', '.'));
  /** mm → texto cm sin ceros sobrantes */
  App.cm = (mm) => String(+(mm / 10).toFixed(2)).replace('.', ',');

  const S = (type, o = {}) => ({ id: App.uid(), type, name: '', height: 0, shape: 'straight', delta: 0, bottomD: 80, ...o });
  const H = (o = {}) => ({ id: App.uid(), length: 95, width: 18, count: 1, attach: 45, ...o });
  App.S = S; App.H = H;

  const base = { thickness: 5, diameterMode: 'outer', seamOverlap: 0, baseDisc: true, topDisc: false, shrinkage: 12, sizeMode: 'raw' };
  App.EXAMPLES = {
    vasija: () => ({ ...base, title: 'Vasija con hombro', baseDiameter: 70, handles: [], sections: [
      S('foot', { bottomD: 55, height: 10 }), S('base'),
      S('body', { shape: 'out', delta: 60, height: 45 }), S('body', { shape: 'in', delta: 70, height: 30 }),
      S('neck', { shape: 'straight', height: 10 }), S('neck', { shape: 'out', delta: 30, height: 9 }),
    ] }),
    taza: () => ({ ...base, title: 'Taza recta', baseDiameter: 80, handles: [H({ attach: 50 })], sections: [
      S('base'), S('body', { shape: 'straight', height: 90 }),
    ] }),
    conica: () => ({ ...base, title: 'Taza cónica', baseDiameter: 65, handles: [H({ length: 90, width: 16, attach: 48 })], sections: [
      S('base'), S('body', { shape: 'out', delta: 25, height: 85 }),
    ] }),
    espresso: () => ({ ...base, title: 'Pocillo con pie', baseDiameter: 60, handles: [], sections: [
      S('foot', { bottomD: 45, height: 8 }), S('base'), S('body', { shape: 'out', delta: 15, height: 55 }),
    ] }),
    botella: () => ({ ...base, title: 'Botella', baseDiameter: 75, handles: [], sections: [
      S('base'), S('body', { shape: 'straight', height: 90 }), S('body', { shape: 'in', delta: 45, height: 40 }),
      S('neck', { shape: 'straight', height: 45 }),
    ] }),
  };
  App.EXAMPLE_NAMES = { vasija: 'Vasija con hombro', taza: 'Taza recta', conica: 'Taza cónica', espresso: 'Pocillo con pie', botella: 'Botella' };

  /** Completa campos faltantes (p. ej. al abrir un .json viejo o editado a mano). */
  App.normalize = (d) => {
    const out = { ...base, title: 'Sin nombre', baseDiameter: 80, handles: [], sections: [], ...d };
    out.sections = (out.sections || []).map((s) => S(s.type || 'body', { ...s, id: s.id || App.uid() }));
    out.handles = (out.handles || []).map((h) => H({ ...h, id: h.id || App.uid() }));
    return out;
  };

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) return App.normalize(JSON.parse(raw));
    } catch (e) { /* almacenamiento no disponible */ }
    return App.EXAMPLES.vasija();
  }

  App.state = loadStored();
  App.selected = null;
  const history = [];
  let lastKey = null, lastTime = 0;

  /**
   * Aplica un cambio. `key` agrupa ediciones seguidas del mismo campo
   * (tipear "12,5" no deja cuatro pasos de deshacer).
   */
  App.commit = (fn, key) => {
    const now = Date.now();
    if (!key || key !== lastKey || now - lastTime > 1200) {
      history.push(JSON.stringify(App.state));
      if (history.length > 100) history.shift();
    }
    lastKey = key; lastTime = now;
    fn(App.state);
    App.persist();
    // al tipear (key) se espera a que termine; los clics se ven al instante
    if (key) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(App.flush, App.RENDER_DELAY);
    } else App.flush();
  };

  let renderTimer = null;
  App.RENDER_DELAY = 400;
  App.flush = () => { clearTimeout(renderTimer); renderTimer = null; App.render(); };
  App.hasPending = () => renderTimer != null;

  App.undo = () => {
    if (!history.length) return;
    App.state = JSON.parse(history.pop());
    lastKey = null;
    // soltar el foco para que el campo muestre el valor recuperado
    if (document.activeElement && document.activeElement.matches('input')) document.activeElement.blur();
    App.persist();
    App.flush();
  };

  App.load = (design) => App.commit((st) => {
    const d = App.normalize(design);
    Object.keys(st).forEach((k) => delete st[k]);
    Object.assign(st, d);
    App.selected = null;
  });

  /** Deja solo la base; espesor, forma de medir y contracción se conservan. */
  App.reset = () => {
    const keep = ['thickness', 'diameterMode', 'seamOverlap', 'shrinkage', 'sizeMode'];
    const d = { title: '', sections: [S('base')], handles: [] };
    keep.forEach((k) => { d[k] = App.state[k]; });
    App.load(d);
  };

  App.persist = () => {
    try { localStorage.setItem(STORE, JSON.stringify(App.state)); } catch (e) { /* ignorar */ }
  };

  App.resolved = () => Geo.resolveSections(App.state);
  /** Contracción lineal total (0–0,4). */
  App.shrink = () => Math.min(0.4, Math.max(0, (App.state.shrinkage || 0) / 100));

  /**
   * Diseño en medidas de la plancha cruda (lo que se corta). Si se diseña con
   * medidas finales, se agranda por 1/(1 − contracción).
   */
  App.rawDesign = () => {
    const st = App.state, S = App.shrink();
    return st.sizeMode === 'final' && S > 0 ? Geo.scaleDesign(st, 1 / (1 - S)) : st;
  };

  App.findIndex = (id) => App.state.sections.findIndex((s) => s.id === id);

  /* ------------------------------ acciones ------------------------------ */

  App.makeSection = (key) => {
    const st = App.state;
    const [type, shape] = key.split('-');
    if (type === 'foot') return S('foot', { bottomD: Math.round(st.baseDiameter * 0.75), height: 10 });
    if (type === 'base') return S('base');
    const delta = shape === 'straight' ? 0 : type === 'neck' ? 15 : 20;
    const resolved = App.resolved();
    const top = resolved.length ? resolved[resolved.length - 1].topD : st.baseDiameter;
    return S(type, { shape, delta, height: type === 'neck' ? 20 : 50, bottomD: top });
  };

  /** Inserta una sección nueva; index = posición en el arreglo (0 = apoyo). */
  App.addSection = (key, index) => {
    if (key === 'handle') {
      return App.commit((st) => { st.handles.push(H({ attach: Math.round(totalHeight() / 2) })); });
    }
    const st = App.state;
    if (key === 'base' && st.sections.some((s) => s.type === 'base')) return;
    const sec = App.makeSection(key);
    if (index == null) {
      if (sec.type === 'foot') index = 0;
      else if (sec.type === 'base') index = st.sections.filter((s) => s.type === 'foot').length;
      else index = st.sections.length;
    }
    App.commit((s) => { s.sections.splice(index, 0, sec); App.selected = sec.id; });
  };

  App.moveSection = (id, index) => App.commit((st) => {
    const i = App.findIndex(id);
    if (i < 0) return;
    const [sec] = st.sections.splice(i, 1);
    if (i < index) index--;
    st.sections.splice(Math.max(0, Math.min(index, st.sections.length)), 0, sec);
  });

  App.removeSection = (id) => App.commit((st) => {
    st.sections = st.sections.filter((s) => s.id !== id);
    if (App.selected === id) App.selected = null;
  });

  App.duplicateSection = (id) => App.commit((st) => {
    const i = App.findIndex(id);
    if (i < 0 || st.sections[i].type === 'base') return;
    const copy = { ...st.sections[i], id: App.uid(), name: '' };
    st.sections.splice(i + 1, 0, copy);
    App.selected = copy.id;
  });

  function totalHeight() {
    return App.resolved().reduce((a, s) => a + (s.height || 0), 0);
  }
  App.totalHeight = totalHeight;
})();
