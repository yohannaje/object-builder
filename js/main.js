/* Arranque, render general y acciones de la barra superior. */
(function () {
  const $ = (s) => document.querySelector(s);
  const slug = () => (App.state.title || 'plantilla').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plantilla';
  App.printFill = false;

  App.pageMeta = () => ({ title: App.state.title });

  App.render = () => {
    // si un campo con foco se reemplaza, conservar su texto y cursor
    const ae = document.activeElement;
    const fkey = ae && ae.dataset ? ae.dataset.fkey : null;
    const snap = fkey ? { value: ae.value, ss: ae.selectionStart, se: ae.selectionEnd } : null;

    const title = $('#title');
    if (document.activeElement !== title) title.value = App.state.title || '';

    App.renderSettings();
    App.renderStack();
    App.renderHandles();
    App.updatePalette();
    App.renderProfile();
    App.pieces = Geo.buildPieces(App.rawDesign());
    App.pages = Sheet.layout(App.pieces);
    // las hojas y piezas solo se dibujan con la ventana de descarga abierta
    if ($('#export').open) renderExport();

    if (snap) {
      const el = document.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`);
      if (el && el !== ae) {
        App.restoring = true;
        el.value = snap.value;
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(snap.ss, snap.se); } catch (e) { /* no aplica */ }
        App.restoring = false;
      }
    }
  };

  /** Solo actualiza el resaltado, sin reconstruir campos (no roba el foco). */
  App.renderSelection = () => {
    document.querySelectorAll('#stack .card').forEach((c) => c.classList.toggle('sel', c.dataset.id === App.selected));
    document.querySelectorAll('#pieces .piece').forEach((c) => c.classList.toggle('sel', c.dataset.id === App.selected));
    App.renderProfile();
  };

  App.downloadPage = (i) => {
    const svg = Sheet.pageSVG(App.pages[i], i, App.pages.length, App.pageMeta(), { fill: App.printFill });
    Sheet.download(`${slug()}-hoja-${i + 1}.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, 'image/svg+xml');
  };

  function exportPDF() {
    if (App.hasPending()) App.flush();
    if (!App.pages.length) return;
    Sheet.download(`${slug()}.pdf`, Sheet.buildPDF(App.pages, App.pageMeta(), { fill: App.printFill }), 'application/pdf');
  }

  function renderExport() {
    App.renderPages();
    App.renderPieces();
    $('[data-tab="pages"]').textContent = `Hojas A4 (${App.pages.length})`;
  }

  function openExport() {
    if (App.hasPending()) App.flush();
    closeMenus();
    renderExport();
    $('#export').showModal();
  }

  /* ------------------------------ menús de arriba ------------------------------ */

  function closeMenus(except) {
    document.querySelectorAll('[data-menu]').forEach((btn) => {
      const panel = document.getElementById(btn.dataset.menu);
      if (panel === except) return;
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function initMenus() {
    document.querySelectorAll('[data-menu]').forEach((btn) => {
      const panel = document.getElementById(btn.dataset.menu);
      btn.addEventListener('click', () => {
        const open = panel.hidden;
        closeMenus(panel);
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      });
    });
    // clic afuera o Escape cierran; lo que pasa adentro del panel no
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu')) closeMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  }

  function init() {
    App.renderPalette();
    App.initStackDnD();
    initMenus();

    const list = $('#example-list');
    Object.entries(App.EXAMPLE_NAMES).forEach(([k, n]) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = n;
      b.addEventListener('click', () => {
        closeMenus();
        App.load({ ...App.EXAMPLES[k](), shrinkage: App.state.shrinkage, sizeMode: App.state.sizeMode });
      });
      list.append(b);
    });

    $('#title').addEventListener('input', (e) => App.commit((s) => { s.title = e.target.value; }, 'title'));
    $('#btn-undo').addEventListener('click', App.undo);
    $('#btn-reset').addEventListener('click', App.reset);
    $('#btn-pdf').addEventListener('click', openExport);
    $('#btn-pdf-go').addEventListener('click', exportPDF);
    $('#btn-close').addEventListener('click', () => $('#export').close());
    // clic en el fondo oscuro cierra la ventana
    $('#export').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    $('#btn-svgs').addEventListener('click', () => App.pages.forEach((_, i) => setTimeout(() => App.downloadPage(i), i * 400)));
    $('#opt-fill').addEventListener('change', (e) => { App.printFill = e.target.checked; App.renderPages(); });

    $('#btn-save').addEventListener('click', () => Sheet.download(`${slug()}.json`, JSON.stringify(App.state, null, 2), 'application/json'));
    $('#btn-open-file').addEventListener('click', () => { closeMenus(); $('#file-open').click(); });
    $('#file-open').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        try { App.load(JSON.parse(txt)); } catch (err) { alert('No se pudo leer el archivo: ' + err.message); }
      });
      e.target.value = '';
    });

    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#pieces').hidden = tab.dataset.tab !== 'pieces';
      $('#pages').hidden = tab.dataset.tab !== 'pages';
    }));

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); App.undo(); }
      // Enter confirma el campo y dibuja ya
      if (e.key === 'Enter' && e.target.matches('input') && App.hasPending()) App.flush();
    });
    // al salir de un campo, dibujar sin esperar
    document.addEventListener('focusout', (e) => {
      if (e.target.matches('input') && App.hasPending()) setTimeout(() => App.hasPending() && App.flush(), 0);
    });

    // la vista lateral se dibuja en píxeles: al cambiar el ancho de la ventana se vuelve a calcular
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(App.renderProfile, 120); });

    App.render();
  }

  init();
})();
