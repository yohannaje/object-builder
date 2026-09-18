/*
 * Geometría de desarrollo de superficies (todas las unidades internas en mm).
 *
 * Tronco de cono con radio inferior r1, radio superior r2 y altura vertical h:
 *   generatriz        s  = √((r2 − r1)² + h²)
 *   radio interior    R1 = s · min(r1,r2) / |r2 − r1|
 *   radio exterior    R2 = s · max(r1,r2) / |r2 − r1|
 *   ángulo del sector θ  = 2π · |r2 − r1| / s          (siempre ≤ 2π)
 * Comprobación: θ·R1 = 2π·min(r) y θ·R2 = 2π·max(r) → los arcos
 * miden exactamente la circunferencia de cada borde, así encastran.
 *
 * Cilindro (r1 = r2): rectángulo de 2πr × h.
 */
(function (global) {
  const TAU = Math.PI * 2;
  const EPS = 1e-6;

  /** Diámetro de la superficie media de la plancha según cómo se midió. */
  function midDiameter(d, mode, t) {
    if (mode === 'outer') return d - t;
    if (mode === 'inner') return d + t;
    return d;
  }

  function frustum(dBottom, dTop, h) {
    const r1 = dBottom / 2, r2 = dTop / 2;
    const dr = r2 - r1;
    if (Math.abs(dr) < EPS) {
      return { kind: 'rect', width: TAU * r1, height: h, slant: h, angleDeg: 0, taper: 'straight' };
    }
    const s = Math.hypot(dr, h);
    const rMin = Math.min(r1, r2), rMax = Math.max(r1, r2);
    const R1 = (s * rMin) / Math.abs(dr);
    const R2 = (s * rMax) / Math.abs(dr);
    const theta = (TAU * Math.abs(dr)) / s;
    return {
      kind: 'sector', R1, R2, theta, slant: s,
      angleDeg: (theta * 180) / Math.PI,
      // inclinación de la pared respecto a la vertical
      wallDeg: (Math.atan2(Math.abs(dr), h) * 180) / Math.PI,
      taper: dr > 0 ? 'out' : 'in',
      arcInner: theta * R1, arcOuter: theta * R2,
    };
  }

  /* ---------- contornos en coordenadas SVG (y hacia abajo) ---------- */

  function pt(R, a) { return [R * Math.sin(a), -R * Math.cos(a)]; }
  const f = (n) => +n.toFixed(4);

  /** Sector anular con vértice en el origen, simétrico respecto al eje vertical. */
  function sectorPath(R1, R2, theta) {
    const a0 = -theta / 2, a1 = theta / 2;
    const large = theta > Math.PI ? 1 : 0;
    const p1 = pt(R1, a0), p2 = pt(R1, a1), p3 = pt(R2, a1), p4 = pt(R2, a0);
    if (theta >= TAU - 1e-4) {
      // anillo completo (altura ≈ 0): dos círculos
      return circlePath(R2) + ' ' + circlePath(R1);
    }
    if (R1 < EPS) {
      return `M0 0 L${f(p3[0])} ${f(p3[1])} A${f(R2)} ${f(R2)} 0 ${large} 0 ${f(p4[0])} ${f(p4[1])} Z`;
    }
    return `M${f(p1[0])} ${f(p1[1])} A${f(R1)} ${f(R1)} 0 ${large} 1 ${f(p2[0])} ${f(p2[1])} ` +
      `L${f(p3[0])} ${f(p3[1])} A${f(R2)} ${f(R2)} 0 ${large} 0 ${f(p4[0])} ${f(p4[1])} Z`;
  }

  function sectorBBox(R1, R2, theta) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const N = 720;
    for (let i = 0; i <= N; i++) {
      const a = -theta / 2 + (theta * i) / N;
      for (const R of [R1, R2]) {
        const [x, y] = pt(R, a);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function circlePath(r, cx = 0, cy = 0) {
    return `M${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)} Z`;
  }

  /**
   * La pila va de abajo hacia arriba. Tipos:
   *   foot  – pie: anillo bajo la base, diámetro propio (normalmente menor)
   *   base  – disco de la base (única), ⌀ = design.baseDiameter, sin altura
   *   body  – cuerpo: tronco de cono o cilindro
   *   neck  – cuello: igual que body, otro rol
   * Continuidad: cada pared arranca con el ⌀ superior de la de abajo
   * (o con el ⌀ de la base si está justo encima de ella).
   */
  function resolveSections(design) {
    let prevTop = null;
    return design.sections.map((s) => {
      if (s.type === 'base') {
        prevTop = design.baseDiameter;
        return { ...s, bottomD: design.baseDiameter, topD: design.baseDiameter, height: 0 };
      }
      // cada pared arranca donde termina la de abajo; el pie (o la primera pared) tiene su propio ⌀
      const bottomD = s.type !== 'foot' && prevTop != null ? prevTop : s.bottomD;
      const delta = Math.abs(s.delta || 0);
      const shape = s.type === 'foot' ? 'straight' : s.shape;
      const topD = shape === 'out' ? bottomD + delta : shape === 'in' ? Math.max(0, bottomD - delta) : bottomD;
      prevTop = topD;
      return { ...s, shape, bottomD, topD };
    });
  }

  /**
   * Convierte el diseño en piezas planas listas para cortar (mm).
   * Cada pieza: { id, name, info[], path, bbox, ... }, bbox en coords del path.
   */
  function buildPieces(design) {
    const t = design.thickness;
    const mode = design.diameterMode;
    const ov = design.seamOverlap || 0;
    const secs = resolveSections(design);
    const pieces = [];
    const mid = (d) => Math.max(0, midDiameter(d, mode, t));
    const disc = (id, name, color, d, extra) => {
      const r = d / 2;
      pieces.push({
        id, name, color, info: [`⌀ ${fmt(d)} cm`],
        path: circlePath(r), bbox: { x: -r, y: -r, w: d, h: d }, circle: { r },
      });
    };

    const counters = {};
    secs.forEach((s, i) => {
      if (s.type === 'base') {
        if (design.baseDisc !== false) disc(s.id, 'Base', 'base', s.bottomD);
        return;
      }
      counters[s.type] = (counters[s.type] || 0) + 1;
      const d1 = mid(s.bottomD), d2 = mid(s.topD);
      const g = frustum(d1, d2, s.height);
      const label = s.name || `${TYPE_NAMES[s.type]} ${counters[s.type]}`;
      if (g.kind === 'rect') {
        const w = g.width + ov, h = g.height;
        pieces.push({
          id: s.id, name: label, color: s.type, geom: g,
          info: [`${fmt(g.width)} × ${fmt(h)} cm`, ov ? `+ ${fmt(ov)} solape` : null].filter(Boolean),
          path: `M0 0 H${f(w)} V${f(h)} H0 Z`, bbox: { x: 0, y: 0, w, h },
          rect: { w, h, seamX: ov ? g.width : null },
        });
      } else {
        let theta = g.theta;
        if (ov) theta = Math.min(TAU - 1e-3, theta + ov / g.R2); // solape medido sobre el arco mayor
        pieces.push({
          id: s.id, name: label, color: s.type, geom: g,
          info: [
            `⌀ ${fmt(d1)} → ${fmt(d2)} cm`,
          ],
          path: sectorPath(g.R1, g.R2, theta), bbox: sectorBBox(g.R1, g.R2, theta),
          sector: { R1: g.R1, R2: g.R2, theta, baseTheta: g.theta },
        });
      }

      // escalón con la pared siguiente → arandela que cubre el salto de diámetro
      const next = secs[i + 1];
      if (next && next.type !== 'base' && Math.abs(s.topD - next.bottomD) > 0.05) {
        const a = mid(s.topD), b = mid(next.bottomD);
        const rIn = Math.min(a, b) / 2, rOut = Math.max(a, b) / 2;
        if (rOut > 0) {
          pieces.push({
            id: `step-${s.id}`, name: `Anillo escalón`, color: 'step',
            info: [`⌀ ${fmt(rOut * 2)} / ${fmt(rIn * 2)} cm`],
            path: circlePath(rOut) + (rIn > 0 ? ' ' + circlePath(rIn) : ''),
            bbox: { x: -rOut, y: -rOut, w: rOut * 2, h: rOut * 2 }, evenodd: true, circle: { r: rOut, rIn },
          });
        }
      }
    });

    const walls = secs.filter((s) => s.type !== 'base');
    const last = secs[secs.length - 1];
    if (last && last.type !== 'base' && design.topDisc && walls.length) disc('top', 'Tapa', 'base', mid(last.topD));

    (design.handles || []).forEach((hd, i) => {
      for (let k = 0; k < (hd.count || 1); k++) {
        const w = hd.width, h = hd.length;
        pieces.push({
          id: `${hd.id}-${k}`, name: `Asa ${i + 1}${hd.count > 1 ? '.' + (k + 1) : ''}`, color: 'handle',
          info: [`${fmt(w)} × ${fmt(h)} cm`],
          path: `M0 0 H${f(w)} V${f(h)} H0 Z`, bbox: { x: 0, y: 0, w, h }, rect: { w, h },
        });
      }
    });

    return pieces;
  }

  /**
   * Escala todas las longitudes del diseño por k (contracción uniforme).
   * El espesor de la plancha y el solape no se escalan: se miden en crudo.
   */
  function scaleDesign(d, k) {
    return {
      ...d,
      baseDiameter: d.baseDiameter * k,
      sections: d.sections.map((s) => ({ ...s, bottomD: (s.bottomD || 0) * k, delta: (s.delta || 0) * k, height: (s.height || 0) * k })),
      handles: (d.handles || []).map((h) => ({ ...h, length: h.length * k, width: h.width * k, attach: (h.attach || 0) * k })),
    };
  }

  const TYPE_NAMES = { foot: 'Pie', base: 'Base', body: 'Cuerpo', neck: 'Cuello' };

  /** mm → "12,34" (cm, coma decimal) */
  function fmt(mm, dec = 2) {
    return (mm / 10).toFixed(dec).replace('.', ',');
  }

  global.Geo = { frustum, scaleDesign, buildPieces, resolveSections, sectorPath, sectorBBox, circlePath, midDiameter, fmt, TAU, TYPE_NAMES };
})(window);
