// Map key: a small inset of Japan with the current view drawn on it as a vermilion frame.
// Same Mercator world as the map. Tap: all of Japan (2D) or the overview (3D).

const W = 88, H = 104, PAD = 6;                         // CSS px
const BOX = { lon0: 129.3, lon1: 145.9, lat0: 30.9, lat1: 45.6 };   // the main islands, fitted into the canvas
const PAPER = '#F5EFE0', WASH = 'rgba(245,239,224,.80)', RULE = '#B9B6AC', INK = '#5B5952', VERM = '#C8341E';
const RADII = [3, 2, 4, 2];                             // same as the CSS border-radius
const TOL = 0.05, TICK = 100, RECT_POLL = 500;          // camera tolerance, ms between redraws, ms between free-rect checks
const FAR_MIN = 900;                                    // world units: how far a sky ray is followed (more when the camera is far out)
const MIN_FRAME = 7;                                    // px: the smallest the frame is drawn

export function initInset(ctx) {
  const { THREE, camera, controls, canvas, scrollEl, view } = ctx;

  let el = document.getElementById('inset');
  if (!el) { el = document.createElement('canvas'); el.id = 'inset'; (scrollEl || document.body).appendChild(el); }
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Map key');
  el.setAttribute('data-tip', 'Map key · Tap to see all of Japan');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  const g = el.getContext('2d');

  // ---- projection: Mercator through lonLatToWorld, north up, fitted with PAD ----
  const nw = ctx.lonLatToWorld(BOX.lon0, BOX.lat1), se = ctx.lonLatToWorld(BOX.lon1, BOX.lat0);
  const k = Math.min((W - 2 * PAD) / (se.x - nw.x), (H - 2 * PAD) / (se.z - nw.z));
  const cx = (nw.x + se.x) / 2, cz = (nw.z + se.z) / 2;
  const px = (x) => W / 2 + (x - cx) * k, py = (z) => H / 2 + (z - cz) * k;

  const tmp = new THREE.Vector3();
  const rings = ((ctx.coast && ctx.coast.inset) || []).map((ring) => ring.map(([lo, la]) => {
    ctx.lonLatToWorld(lo, la, tmp);
    return [px(tmp.x), py(tmp.z)];
  }));

  // ---- canvas size follows the device pixel ratio (capped at 2) ----
  let dpr = 0;
  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(W * dpr); el.height = Math.round(H * dpr);
  }

  // ---- paint ----
  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r[0], y); g.lineTo(x + w - r[1], y); g.arcTo(x + w, y, x + w, y + r[1], r[1]);
    g.lineTo(x + w, y + h - r[2]); g.arcTo(x + w, y + h, x + w - r[2], y + h, r[2]);
    g.lineTo(x + r[3], y + h); g.arcTo(x, y + h, x, y + h - r[3], r[3]);
    g.lineTo(x, y + r[0]); g.arcTo(x, y, x + r[0], y, r[0]); g.closePath();
  }
  function paintBase() {
    g.fillStyle = WASH; g.fillRect(0, 0, W, H);
    g.strokeStyle = RULE; g.lineWidth = 1;
    roundRect(0.5, 0.5, W - 1, H - 1, RADII.map((r) => Math.max(0, r - 0.5))); g.stroke();
    g.beginPath();
    for (const ring of rings) {
      ring.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    }
    g.globalAlpha = 0.9; g.fillStyle = PAPER; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = INK; g.lineWidth = 1; g.lineJoin = 'round'; g.stroke();
  }

  // ---- screen corner -> ground point (x, z) on y = 0 ----
  // A ray through two depths (NDC z -1 and +1) works for the orthographic 2D matrix, the perspective 3D one, and the blend between.
  // A ray that misses the ground (3D sky) is followed `far` units instead. Hits farther than that are cut at `far` too, so there is no jump at the horizon.
  const ra = new THREE.Vector3(), rb = new THREE.Vector3();
  function ground(nx, ny, far, out) {
    ra.set(nx, ny, -1).unproject(camera);
    rb.set(nx, ny, 1).unproject(camera).sub(ra);
    const len = rb.length() || 1;
    rb.multiplyScalar(1 / len);
    let t = far;
    if (rb.y < -1e-6) { const hit = -ra.y / rb.y; if (hit > 0 && hit < far) t = hit; }
    out[0] = ra.x + rb.x * t; out[1] = ra.z + rb.z * t;
  }

  const pts = [[0, 0], [0, 0], [0, 0], [0, 0]];
  let lastRect = null;
  function readFrame() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    let r = ctx.freeRect(false);
    if (!r || ![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) r = { x0: 0, y0: 0, x1: w, y1: h };
    lastRect = r;
    camera.updateMatrixWorld();
    const far = Math.max(FAR_MIN, 3 * camera.position.distanceTo(controls.target));
    [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].forEach(([sx, sy], i) => ground(sx / w * 2 - 1, 1 - sy / h * 2, far, pts[i]));
    return pts.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
  }

  // The frame in canvas px. A close zoom shrinks it to a dot, so each side is stretched about the centre up to MIN_FRAME px.
  const quad = [[0, 0], [0, 0], [0, 0], [0, 0]];
  function frameInCanvas() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(([x, z], i) => {
      const qx = px(x), qy = py(z);
      quad[i][0] = qx; quad[i][1] = qy;
      x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
    });
    const sx = Math.max(1, MIN_FRAME / Math.max(x1 - x0, 1e-3)), sy = Math.max(1, MIN_FRAME / Math.max(y1 - y0, 1e-3));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    for (const q of quad) { q[0] = mx + (q[0] - mx) * sx; q[1] = my + (q[1] - my) * sy; }
    return quad;
  }

  function draw(withFrame) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    paintBase();
    if (!withFrame) return;
    g.beginPath();
    frameInCanvas().forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = 'rgba(200,52,30,.12)'; g.fill();
    g.strokeStyle = VERM; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
  }

  // ---- redraw when the camera (or the map area) moved; at most 10 times a second ----
  const last = { px: NaN, py: NaN, pz: NaN, tx: NaN, ty: NaN, tz: NaN, blend: NaN, w: 0, h: 0 };
  let lastTick = -1e9, lastPoll = -1e9, dirty = true;
  const differs = (a, b, tol) => !(Math.abs(a - b) <= tol);   // also true when either is NaN

  function paint() {
    const p = camera.position, t = controls.target;
    Object.assign(last, { px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z, blend: view.blend || 0, w: canvas.clientWidth, h: canvas.clientHeight });
    dirty = false;
    draw(readFrame());
  }

  function update(now = performance.now()) {
    if (now - lastTick < TICK) return;
    lastTick = now;
    if (Math.min(window.devicePixelRatio || 1, 2) !== dpr) { fit(); dirty = true; }
    const p = camera.position, t = controls.target;
    let changed = dirty
      || differs(p.x, last.px, TOL) || differs(p.y, last.py, TOL) || differs(p.z, last.pz, TOL)
      || differs(t.x, last.tx, TOL) || differs(t.y, last.ty, TOL) || differs(t.z, last.tz, TOL)
      || differs(view.blend || 0, last.blend, 0.002)
      || canvas.clientWidth !== last.w || canvas.clientHeight !== last.h;
    if (!changed && now - lastPoll >= RECT_POLL) {          // fixed UI (a strip, the card) can change the free area without a camera move
      lastPoll = now;
      const r = ctx.freeRect(false);
      changed = !lastRect || !r || ['x0', 'y0', 'x1', 'y1'].some((key) => Math.abs(r[key] - lastRect[key]) > 0.5);
    }
    if (changed) paint();
  }

  // forced redraw (after the integrator changes the layout)
  function redraw() { dirty = true; lastTick = -1e9; update(performance.now()); }

  // ---- tap: 2D shows all of Japan, 3D flies to the overview ----
  const go = () => { if (view.is2d()) view.frameJapan(); else ctx.flyToRegion('overview'); };
  el.addEventListener('click', go);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });

  fit();
  draw(false);          // the frame waits for the first update(), when the camera has its real pose
  return { update, redraw, el };
}
