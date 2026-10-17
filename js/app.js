import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadWorld, lonLatToWorld, heightAtWorld } from './terrain.js';
import { Pins, FADE, loadSealFonts, overlaps } from './pins.js';
import { initUI, Store, REGION_INFO, DOCK_MQ } from './ui.js';
import { initRoute } from './route.js';
import { initTrip } from './trip.js';
import { initTips } from './tips.js';
import { initFlatMap } from './flatmap.js';
import { initInset } from './inset.js';
import { initMarker } from './marker.js';
import { initArt } from './art.js';
import { initLegend } from './legend.js';
import { initList } from './list.js';
import { tripSet } from './itinerary.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#map'), scrollEl = $('#scroll');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 4000);
const FOV_TAN = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.035;
controls.rotateSpeed = 0.45; controls.zoomSpeed = 0.5; controls.panSpeed = 0.5;
controls.minDistance = 8; controls.maxDistance = 900;
controls.minPolarAngle = THREE.MathUtils.degToRad(20);   // 20° from straight down
controls.maxPolarAngle = THREE.MathUtils.degToRad(70);   // 70° from straight down
controls.screenSpacePanning = false;

const prefersStill = matchMedia('(prefers-reduced-motion: reduce)').matches;
let route = null, trip = null, flat = null, inset = null, marker = null, art = null;
const state = { route: true, cameraMoves: !prefersStill, flying: false, region: 'japan', ready: false };

const tl = new THREE.TextureLoader();
const tex = (p) => new Promise((res, rej) => tl.load(p, res, undefined, rej));
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (a, b, t) => { t = clamp01((t - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const rad = THREE.MathUtils.degToRad;

// ---------- view: one camera, two projections ----------
// 2D is the same scene seen straight down through an orthographic projection. The camera stays a PerspectiveCamera (OrbitControls keeps working
// as is) and its projection matrix is blended toward the orthographic one. blend: 0 = pure 3D, 1 = pure 2D, in between = the mode flight.
const view = {
  mode: new URLSearchParams(location.search).get('mode') === '3d' ? '3d' : '2d', EPS: 0.0015, blend: 1,
  is2d() { return this.mode === '2d'; },
  dist() { return camera.position.distanceTo(controls.target); },
  wpp(dist) { return 2 * FOV_TAN * dist / canvas.clientHeight; },     // world units per CSS px (in 2D the same at every depth)
  sph: null,                                                          // set below, next to the plain spherical formula
  setMode: (mode, opts) => setViewMode(mode, opts),
  frameJapan: () => frameJapan(),
};
view.blend = view.mode === '2d' ? 1 : 0;
const _protoProj = THREE.PerspectiveCamera.prototype.updateProjectionMatrix, _pm = new THREE.Matrix4(), _om = new THREE.Matrix4();
camera.updateProjectionMatrix = function () {
  _protoProj.call(this);
  const k = view.blend, D = this.position.distanceTo(controls.target);
  if (!(k > 0) || !(D > 1e-3)) return;                                // pure 3D (or no pose yet): the stock perspective matrix
  _pm.copy(this.projectionMatrix);
  const hh = FOV_TAN * D, hw = hh * this.aspect;                      // the orthographic view shows the world height the perspective one shows at distance D
  _om.makeOrthographic(-hw, hw, hh, -hh, this.near, this.far);
  const a = _pm.elements, b = _om.elements, e = this.projectionMatrix.elements;
  for (let i = 0; i < 16; i++) e[i] = a[i] + (b[i] - a[i]) * k;
  this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
};
let japanDist = 0;                                                    // distance that frames the whole country (set in resize)
const maxDist3d = () => Math.max(900, overviewDist() * 1.1), maxDist2d = () => Math.max(900, japanDist * 1.15);
function applyModeLimits() {                                          // OrbitControls limits for the current mode
  const flat = view.is2d();
  controls.enableRotate = !flat;
  controls.minPolarAngle = flat ? view.EPS : rad(20); controls.maxPolarAngle = flat ? view.EPS : rad(70);
  controls.mouseButtons.LEFT = flat ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;   // with rotation off, one finger / the left button must pan
  controls.touches.ONE = flat ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.maxDistance = flat ? maxDist2d() : maxDist3d();
}
if (view.is2d()) applyModeLimits();

// ---------- regions ----------
const VIEW = { polar: 52, az: 22 };
const REGIONS = {
  tokyo:  { lon: 139.745, lat: 35.680, dist: 44, side: 'top' },
  hakone: { lon: 139.030, lat: 35.230, dist: 42, side: 'bottom' },
  fuji:   { lon: 138.760, lat: 35.420, dist: 64, side: 'top' },
  kyoto:  { lon: 135.765, lat: 35.000, dist: 50, side: 'top' },
  nara:   { lon: 135.835, lat: 34.685, dist: 30, side: 'right' },
  osaka:  { lon: 135.510, lat: 34.690, dist: 62, side: 'bottom' },
};
const OVERVIEW = { lon: 137.57, lat: 35.20, polar: 54, az: 0, span: 770 };
// Portrait screens: turn the world a quarter so the long Tokyo-Osaka axis runs up the screen like a hanging scroll (Tokyo on top)
const OVERVIEW_PORTRAIT = { lon: 137.85, polar: 44, az: 270, span: 350 };   // target a little toward Tokyo: the far end is foreshortened
const isPortrait = () => canvas.clientWidth / canvas.clientHeight < 0.85;

function overviewDist() {
  const w = canvas.clientWidth, h = canvas.clientHeight, aspect = w / h;
  const usable = Math.max(0.3, (w - 2 * (isPortrait() ? 0 : 56)) / w);   // landscape: keep clear of the seal columns
  const hTan = FOV_TAN * aspect;
  if (isPortrait()) {                                       // fit the short axis across and the long axis (foreshortened by the tilt) down
    const dW = OVERVIEW_PORTRAIT.span / (2 * hTan * usable);
    const dH = 1.4 * (OVERVIEW.span * Math.cos(rad(OVERVIEW_PORTRAIT.polar)) / 2) / (FOV_TAN * Math.max(0.4, (h - 190) / h));
    return Math.min(2300, Math.max(380, dW, dH));
  }
  return Math.min(2300, Math.max(380, OVERVIEW.span / (2 * hTan * usable)));
}
const rawSph = (dist, polarDeg, azDeg) => new THREE.Vector3(
  dist * Math.sin(rad(polarDeg)) * Math.sin(rad(azDeg)), dist * Math.cos(rad(polarDeg)), dist * Math.sin(rad(polarDeg)) * Math.cos(rad(azDeg)));
// mode-aware: in 2D the camera sits straight above the target (the tiny z keeps lookAt safe); in 3D it is the plain spherical formula
const sph = (dist, polarDeg, azDeg) => view.is2d() ? new THREE.Vector3(0, dist, dist * Math.sin(view.EPS)) : rawSph(dist, polarDeg, azDeg);
view.sph = sph;
function groundTarget(lon, lat) { const p = lonLatToWorld(lon, lat); p.y = heightAtWorld(p.x, p.z); return p; }

// ---------- the free map area ----------
// Fixed UI (seal column, filter row, crests, masthead, the open card) covers parts of the canvas. When the camera flies somewhere,
// the destination is aimed at the centre of what is left, so a region or a place never lands under a button or a card.
function uiEl(sel) { const el = document.querySelector(sel); return el && !el.hidden ? el : null; }
function freeRect(withCard = false) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const R = { x0: 0, y0: 0, x1: w, y1: h };
  const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  const PAD = 12;
  const cut = (b, force) => {                                     // b = { l, t, r, b } of a UI element: trim the free rect on the side that loses least
    const opts = { left: { ...R, x0: Math.max(R.x0, b.r + PAD) }, right: { ...R, x1: Math.min(R.x1, b.l - PAD) },
                   top: { ...R, y0: Math.max(R.y0, b.b + PAD) }, bottom: { ...R, y1: Math.min(R.y1, b.t - PAD) } };
    if (b.r + PAD <= R.x0 || b.l - PAD >= R.x1 || b.b + PAD <= R.y0 || b.t - PAD >= R.y1) return;   // already clear
    let best = force || null;
    if (!best) { let ba = -1; for (const k in opts) { const a = area(opts[k]); if (a > ba) { ba = a; best = k; } } }
    Object.assign(R, opts[best]);
  };
  const docked = matchMedia(DOCK_MQ).matches;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  for (const sel of ['#title', '#who', '#seals', '#filters', '#player', '#drawer', '#bar', '#inset']) { const el = uiEl(sel); if (el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width) cut(rectOf(el)); }
  const cr = uiEl('#crests'); if (cr && !(withCard && docked)) cut(rectOf(cr));
  if (withCard) {
    const card = document.getElementById('card');
    if (docked) { const right = parseFloat(getComputedStyle(card).right) || 0; cut({ l: w - right - card.offsetWidth, t: card.offsetTop, r: w, b: card.offsetTop + card.offsetHeight }, 'right'); }
    else cut({ l: 0, t: h - card.offsetHeight, r: w, b: h }, 'bottom');
  }
  if (R.x1 - R.x0 < 90 || R.y1 - R.y0 < 90) return { x0: 0, y0: 0, x1: w, y1: h };
  return R;
}
// Shift the look-at point (camera orientation and distance unchanged) so ground point P lands on screen point C.
const aimCam = new THREE.PerspectiveCamera();
function aimPose(P, offset, C) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (view.is2d()) {                                           // top-down, orthographic: P lands on C by a plain shift (screen down = world +z, north up)
    const wpp = view.wpp(offset.length());
    return { target: new THREE.Vector3(P.x - (C.x - w / 2) * wpp, 0, P.z - (C.y - h / 2) * wpp), offset };
  }
  aimCam.fov = camera.fov; aimCam.aspect = w / h; aimCam.near = 0.3; aimCam.far = 4000; aimCam.updateProjectionMatrix();
  const T = P.clone(), v = new THREE.Vector3(), o = new THREE.Vector3();
  const proj = (t) => { aimCam.position.copy(t).add(offset); aimCam.lookAt(t); aimCam.updateMatrixWorld(true); v.copy(P).project(aimCam); return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h]; };
  for (let i = 0; i < 6; i++) {
    const [px, py] = proj(T), ex = C.x - px, ey = C.y - py;
    if (Math.hypot(ex, ey) < 0.4) break;
    const d = Math.max(0.5, offset.length() * 0.01);
    const [ax, ay] = proj(o.copy(T).add(new THREE.Vector3(d, 0, 0))), [bx, by] = proj(o.copy(T).add(new THREE.Vector3(0, 0, d)));
    const a = (ax - px) / d, c = (ay - py) / d, b = (bx - px) / d, e = (by - py) / d, det = a * e - b * c;
    if (Math.abs(det) < 1e-9) break;
    T.x += (ex * e - b * ey) / det; T.z += (a * ey - c * ex) / det;
  }
  return { target: T, offset };
}
const rectCentre = (r, dy = 0) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 + dy });
// The ground point (x, z) that screen point C shows right now: exact in 2D, a ray to the target's height plane in 3D.
const _ray = new THREE.Vector3();
function groundAt(C) {
  const w = canvas.clientWidth, h = canvas.clientHeight, T = controls.target;
  if (view.is2d()) { const k = view.wpp(view.dist()); return new THREE.Vector3(T.x + (C.x - w / 2) * k, 0, T.z + (C.y - h / 2) * k); }
  camera.updateMatrixWorld();
  _ray.set(C.x / w * 2 - 1, 1 - C.y / h * 2, 0.5).unproject(camera).sub(camera.position);
  if (_ray.y > -1e-4) return new THREE.Vector3(T.x, 0, T.z);                    // the ray never meets the plane (looking at the horizon)
  const s = (T.y - camera.position.y) / _ray.y;
  return new THREE.Vector3(camera.position.x + _ray.x * s, 0, camera.position.z + _ray.z * s);
}

// Landscape overview: tilt up toward top-down until the land strip fills most of the free height (never past 24 deg, so it still reads as a painted relief)
const STRIP_DEPTH = 290;                                      // world units the land spans north-south
function overviewPolar() {
  if (isPortrait()) return OVERVIEW_PORTRAIT.polar;
  const w = canvas.clientWidth, usable = Math.max(0.3, (w - 2 * 56) / w);
  const ppu = usable * w / OVERVIEW.span, fr = freeRect(false);
  const c = (0.8 * (fr.y1 - fr.y0)) / (STRIP_DEPTH * ppu);
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.acos(Math.min(1, c))), 24, OVERVIEW.polar);
}
function regionPose(id) {
  if (view.is2d()) {                                           // flat map: always top-down, north up
    if (id === 'overview') {                                   // the six region centres and Mount Fuji, 10 percent padding, inside the free map area
      const pts = Object.values(REGIONS).map(r => lonLatToWorld(r.lon, r.lat)); pts.push(lonLatToWorld(138.7274, 35.3606));
      return framePoints(pts, 0.10);
    }
    const r = REGIONS[id];
    return aimPose(lonLatToWorld(r.lon, r.lat), sph(r.dist * 1.25), rectCentre(freeRect(false)));
  }
  if (id === 'overview') {
    const portrait = isPortrait(), o = portrait ? { ...OVERVIEW, ...OVERVIEW_PORTRAIT } : { ...OVERVIEW, polar: overviewPolar() };
    const t = groundTarget(o.lon, o.lat); t.y = 0;
    const offset = sph(overviewDist(), o.polar, o.az);
    return portrait ? { target: t, offset } : aimPose(t, offset, rectCentre(freeRect(false)));
  }
  const r = REGIONS[id], offset = sph(r.dist, VIEW.polar, VIEW.az);
  return aimPose(groundTarget(r.lon, r.lat), offset, rectCentre(freeRect(false)));
}

// ---------- framing ground points on the flat map ----------
const JAPAN = { lon0: 129.3, lon1: 145.9, lat0: 30.9, lat1: 45.6 };      // the main islands
const japanPts = () => [[JAPAN.lon0, JAPAN.lat0], [JAPAN.lon1, JAPAN.lat0], [JAPAN.lon0, JAPAN.lat1], [JAPAN.lon1, JAPAN.lat1]].map(([lo, la]) => lonLatToWorld(lo, la));
let japanB = null;
function japanBounds() {                                       // world rect of the coast file's bbox (fallback: the whole-country frame)
  if (!japanB) {
    const bb = (coast && coast.bbox) || [JAPAN.lon0, JAPAN.lat0, JAPAN.lon1, JAPAN.lat1], a = lonLatToWorld(bb[0], bb[3]), c = lonLatToWorld(bb[2], bb[1]);
    japanB = { x0: a.x, z0: a.z, x1: c.x, z1: c.z };
  }
  return japanB;
}
// Distance that fits the bounding box of the points into the free map area with `pad` on every side. The orthographic view shows
// 2 * FOV_TAN * D world units over the canvas height (and that times the aspect across).
function fitBox(points, pad) {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return { cx: 0, cz: 0, D: 900 };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const R = freeRect(false), fw = (R.x1 - R.x0) / w, fh = (R.y1 - R.y0) / h;
  const D = Math.max((x1 - x0) / 2 / (FOV_TAN * (w / h) * fw), (z1 - z0) / 2 / (FOV_TAN * fh)) / (1 - 2 * pad);
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, D };
}
function framePoints(points, pad) {
  const f = fitBox(points, pad), D = THREE.MathUtils.clamp(f.D, 8, controls.maxDistance);
  return aimPose(new THREE.Vector3(f.cx, 0, f.cz), sph(D, VIEW.polar, VIEW.az), rectCentre(freeRect(false)));
}

// ---------- slow, deliberate camera moves ----------
let fly = null;
const fadeEl = $('#fade');
function paperFade() {                                       // instant cut + 0.6 s paper cross-fade
  fadeEl.style.transition = 'none'; fadeEl.style.opacity = '0.95'; void fadeEl.offsetWidth;
  fadeEl.style.transition = 'opacity .6s ease-in-out'; fadeEl.style.opacity = '0';
}
function settleControls() {                                  // flush any drag momentum so it cannot nudge the new pose
  controls.enableDamping = false; controls.update(); controls.enableDamping = true;
}
function cutToPose(pose) {
  fly = null; state.flying = false; controls.enabled = true;
  view.blend = view.is2d() ? 1 : 0;                              // a cut also ends a mode flight
  controls.target.copy(pose.target); camera.position.copy(pose.target).add(pose.offset); camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
  settleControls(); paperFade();
}
// opts.blendTo: a mode flight (2D <-> 3D). The projection blend runs from its current value to blendTo with the eased flight time.
function flyToPose(pose, secs, { arc = 0.3, from = null, blendTo } = {}) {
  if (!state.cameraMoves) { cutToPose(pose); return; }
  settleControls();
  const modeBlend = view.is2d() ? 1 : 0;
  if (blendTo === undefined && view.blend !== modeBlend) blendTo = modeBlend;      // a flight that cuts in on a mode flight finishes the blend
  const t0 = controls.target.clone();
  let s0 = new THREE.Spherical().setFromVector3(from || camera.position.clone().sub(t0));
  let s1 = new THREE.Spherical().setFromVector3(pose.offset);
  if (view.is2d() && blendTo === undefined) {                                      // flat map: both ends top-down, so the camera never tilts
    s0 = new THREE.Spherical().setFromVector3(view.sph(s0.radius)); s1 = new THREE.Spherical().setFromVector3(view.sph(s1.radius));
  }
  let dth = s1.theta - s0.theta; dth = ((dth + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const travel = Math.hypot(pose.target.x - t0.x, pose.target.z - t0.z);
  fly = { start: performance.now(), dur: secs * 1000, t0, t1: pose.target.clone(), s0, s1, dth, lift: travel * arc + 0.1 * Math.abs(s1.radius - s0.radius), blendFrom: view.blend, blendTo };
  state.flying = true; controls.enabled = false;
}
const _off = new THREE.Vector3(), _s = new THREE.Spherical();
function stepFlight(now) {
  const f = fly, k = easeInOut(clamp01((now - f.start) / f.dur));
  controls.target.lerpVectors(f.t0, f.t1, k);
  if (f.blendTo !== undefined) { const b = THREE.MathUtils.lerp(f.blendFrom, f.blendTo, k); view.blend = k >= 1 ? f.blendTo : b < 1e-4 ? 0 : b; }   // below 1e-4: pure perspective (float32 would round the matrix to it anyway)
  const r = Math.exp(THREE.MathUtils.lerp(Math.log(f.s0.radius), Math.log(f.s1.radius), k)) + f.lift * Math.sin(Math.PI * k);  // calm lift and descent
  _s.set(r, THREE.MathUtils.lerp(f.s0.phi, f.s1.phi, k), f.s0.theta + f.dth * k);
  _off.setFromSpherical(_s);
  camera.position.copy(controls.target).add(_off); camera.lookAt(controls.target);
  if (k >= 1) { fly = null; state.flying = false; controls.enabled = true; settleControls(); }
}

function flyToRegion(id) {
  if (!regionExists(id)) return;
  if (id === 'japan') { frameJapan(); return; }                 // "All": the whole country (in 3D: the central Japan overview)
  ui.closeCard(); state.region = id; ui.setActiveRegion(id);
  flyToPose(regionPose(id), 3.5, { arc: 0.3 });
}
const regionExists = (id) => id === 'overview' || id === 'japan' || !!REGIONS[id];

// ---------- 2D <-> 3D ----------
function syncModeUi() {                                        // the 3D stamp follows the mode
  document.querySelector('#seals [data-layer="3d"]')?.classList.toggle('on', !view.is2d());
}
// Tilt up into 3D over the same spot, or flatten back. The spot is the ground point under the centre of the free map area, so a round trip
// does not drift (it is the camera target when that centre is the canvas centre). Ignored: not ready, same mode, or a mode flight is running.
function setViewMode(mode, { secs = 1.5 } = {}) {
  if (!state.ready || (mode !== '2d' && mode !== '3d') || mode === view.mode || (fly && fly.blendTo !== undefined)) return;
  const C = rectCentre(freeRect(false)), A = groundAt(C), D = view.dist();     // A is read before the mode changes
  view.mode = mode;
  let pose;
  if (mode === '3d') {
    pose = aimPose(A, rawSph(THREE.MathUtils.clamp(D, controls.minDistance, maxDist3d()), 52, 22), C);   // plain formula: sph() would answer top-down
    const b = world.bounds, m = 12;                            // end inside the 3D pan bounds, so the loop does not snap the camera when the flight ends
    pose.target.x = THREE.MathUtils.clamp(pose.target.x, b.x0 + m, b.x1 - m); pose.target.z = THREE.MathUtils.clamp(pose.target.z, b.z0 + m, b.z1 - m);
  } else pose = aimPose(A, sph(THREE.MathUtils.clamp(D, controls.minDistance, maxDist2d())), C);
  if (state.cameraMoves) { flyToPose(pose, secs, { arc: 0, blendTo: mode === '2d' ? 1 : 0 }); applyModeLimits(); }   // limits after flyToPose: its settleControls() must still see the old ones
  else { applyModeLimits(); cutToPose(pose); }                                                                         // limits first, so the cut's settleControls() keeps the new pose
  syncModeUi();
}
// whole country, flat map (in 3D: the central Japan overview)
const japanPose = () => framePoints(japanPts(), 0.06);
function frameJapan() {
  if (!view.is2d()) { flyToRegion('overview'); return; }
  ui.closeCard(); state.region = 'japan'; ui.setActiveRegion('japan');   // the caption reads "Japan"
  flyToPose(japanPose(), 3.5, { arc: 0 });
}

// ---------- projected labels: landmarks and region names ----------
const marks = [];                                           // { el, pos, kind, key }
function addMark(kind, text, pos, key, side = 'top') {
  const el = document.createElement('div');
  el.className = (kind === 'region' ? 'rlabel' : 'landmark') + ' side-' + side;
  el.innerHTML = '<span class="t"></span>' + (kind === 'region' ? '<b class="dot"></b>' : '');
  el.firstChild.textContent = text;                          // English lettering only
  el.dataset.key = key;                                      // route.js puts the day stamps inside the region names
  if (kind === 'region') el.firstChild.addEventListener('click', (e) => {   // tap a city name: its day stamps show beside it (tap again to hide)
    e.stopPropagation();
    if (route && route.toggleStamps && route.hasStamps(key)) route.toggleStamps(key);
  });
  scrollEl.appendChild(el);
  marks.push({ el, pos, kind, key, side, w: 0, h: 0, on: false });
}
if (document.fonts) { const remeasure = () => marks.forEach(m => { m.w = 0; }); document.fonts.ready.then(remeasure); document.fonts.addEventListener?.('loadingdone', remeasure); }
// screen rects of fixed UI (title, seals, crests, key...) that map labels should keep clear of
let uiRects = [], pinBlockers = [], uiRectsAt = -1e9;
function refreshUiRects(force) {
  const now = performance.now();
  if (!force && now - uiRectsAt < 100) return uiRects; uiRectsAt = now;
  const out = [], blk = [];
  for (const sel of ['#title img', '#title .sub', '#region', '#who', '#seals', '#crests', '#filters', '#player', '#drawer', '#bar', '#inset', '#legend']) {
    const el = document.querySelector(sel); if (!el || el.hidden) continue;
    if (getComputedStyle(el).opacity === '0') continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const q = { x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4 };
    out.push(q); if (sel !== '#region') blk.push(q);               // pins may sit under the region caption (it is a faint wash), not under buttons
  }
  const c = document.getElementById('card'); if (ui?.cardOpen) { const r = c.getBoundingClientRect(); const q = { x: r.left, y: r.top, w: r.width, h: r.height }; out.push(q); blk.push(q); }
  pinBlockers = blk;
  return (uiRects = out);
}
const _p = new THREE.Vector3();
const EDGE = 12;                                             // px: lettering stays this far inside the page (clear of the phone's ink rule)
function updateMarks(dist, w, h) {
  const landFade = 1 - smooth(FADE.pinsFull, FADE.pinsGone, dist);
  const regFade = smooth(FADE.regionsFrom, FADE.regionsFull, dist);
  const placed = [], obstacles = [], ui_ = refreshUiRects();
  const order = marks.slice().sort((a, b) => (a.kind === 'region') - (b.kind === 'region'));
  for (const m of order) {
    let a = m.kind === 'region' ? regFade : landFade;
    if (m.key === 'fuji-peak') a *= 1 - regFade;           // the region label already says "Mount Fuji": the peak label fades out as it fades in
    let show = a > 0.02;
    let x = 0, y = 0;
    if (show) {
      _p.copy(m.pos).project(camera);
      show = _p.z < 1 && _p.x > -1.1 && _p.x < 1.1 && _p.y > -1.1 && _p.y < 1.1;
      x = (_p.x * 0.5 + 0.5) * w; y = (-_p.y * 0.5 + 0.5) * h;
    }
    if (show) {
      if (!m.w) { m.w = m.el.offsetWidth; m.h = m.el.offsetHeight; }
      let rx = x - m.w / 2, ry = y - m.h - 6;
      if (m.side === 'right') { rx = x + 9; ry = y - m.h / 2; } else if (m.side === 'left') { rx = x - 9 - m.w; ry = y - m.h / 2; } else if (m.side === 'bottom') ry = y + 8;
      if (m.kind === 'region') rx = Math.min(Math.max(rx, EDGE), w - EDGE - m.w);   // a region name at the edge of the page slides inside it (its dot stays on the point)
      const r = { x: rx, y: ry, w: m.w, h: m.h };
      if (placed.some(o => overlaps(r, o, 4)) || ui_.some(o => overlaps(r, o, 0))) show = false;
      else { placed.push(r); if (m.kind === 'landmark') obstacles.push(r); m.el.style.transform = `translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)`; m.el.style.setProperty('--dx', (x - r.x).toFixed(1) + 'px'); m.el.style.setProperty('--dy', (y - r.y).toFixed(1) + 'px'); }
    }
    if (show !== m.on) { m.on = show; m.el.classList.toggle('show', show); }
    if (show) m.el.style.setProperty('--o', a.toFixed(2));
  }
  return obstacles;
}

// ---------- state shared with the UI ----------
let pins = null, world = null, places = [], coast = null;         // coast: data/japan-coast.json (loaded in init)
const placeById = new Map();
let list = null;                                          // the Your Trip list (js/list.js)
// pins: the choices, and the trip set (the plan's stops after swaps plus "Add to trip"); only the trip set shows
const refreshPins = () => { if (!pins) return; pins.setChoices(Store.mine()); pins.setTripSet(tripSet(route && route.itinerary, Store.mine())); };
// reload the plan everywhere after a swap or a person switch: route, drawer and player, pins, list
async function reloadTrip() {
  if (route && route.reload) { await route.reload(Store.who); if (trip && trip.refresh) await trip.refresh(); }
  refreshPins(); if (list) list.render();
}

const ui = initUI({
  onRegion: (id) => flyToRegion(id),
  onFilter: (set) => pins && pins.setFilter(set),         // never touches the camera
  onChoice: () => refreshPins(),
  onWho: () => { refreshPins(); reloadTrip().catch(e => console.error(e)); },
  onCardClose: () => pins && pins.select(null),
});

// aim the picked place into the free map area beside / above the open card (and clear of the seals, crests and filter row)
function placePose(pin) {
  if (view.is2d()) return aimPose(pin, sph(40), rectCentre(freeRect(true), 14));   // +14 as in 3D (a top-down seal sits on its ground point, so it only shifts the pin a little low)
  const dist = 34, azDeg = THREE.MathUtils.radToDeg(Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z));
  return aimPose(pin, sph(dist, 45, azDeg), rectCentre(freeRect(true), 14));   // +14: the seal sits ~27 px above the ground point
}

function openPlace(id) {
  const p = placeById.get(id); if (!p || !pins) return;
  const g = pins.worldPos(id);
  ui.openCard(p); pins.select(id); ui.setActiveRegion(p.region);
  if (state.cameraMoves) flyToPose(placePose(g), 2.0, { arc: 0.25 }); else pins.pulse(id);
}

// ---------- tap vs drag ----------
const down = new Map(); let tap = null;
canvas.addEventListener('pointerdown', (e) => {
  down.set(e.pointerId, true);
  tap = down.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), ok: true } : (tap && (tap.ok = false), tap);
});
canvas.addEventListener('pointermove', (e) => { if (tap && tap.ok && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 8) tap.ok = false; });
const endPointer = (e) => {
  down.delete(e.pointerId);
  if (!tap) return;
  const t = tap; if (!down.size) tap = null;
  if (e.type !== 'pointerup' || !t.ok || performance.now() - t.t > 350 || !pins) return;
  const r = canvas.getBoundingClientRect();
  const hit = pins.pick(e.clientX - r.left, e.clientY - r.top);
  if (route && route.closeStamps) route.closeStamps();
  if (hit) openPlace(hit.id); else if (ui.cardOpen) ui.closeCard();
};
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);

// ---------- layer seals ----------
document.querySelectorAll('#seals .seal').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.layer;
  b.classList.toggle('on');
  const on = b.classList.contains('on');
  if (k === 'route') { state.route = on; route && route.setVisible(on); marker && marker.setVisible(on); }   // never moves the camera
  if (k === 'camera') state.cameraMoves = on;
  if (k === '3d') { view.setMode(on ? '3d' : '2d'); syncModeUi(); }   // syncModeUi puts the stamp back if the switch was ignored (a mode flight is running)
}));

function resize() {
  refreshUiRects(true);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  japanDist = fitBox(japanPts(), 0.06).D;                      // flat map: the distance that frames the whole country caps the zoom-out
  applyModeLimits();
}
addEventListener('resize', resize);

// ---------- main ----------
async function init() {
  const q = new URLSearchParams(location.search);
  const [washi, placesJson, coastJson, waveTex] = await Promise.all([
    tex('assets/web/washi.jpg'),
    fetch('data/places.json').then(r => r.json()).catch(() => []),
    fetch('data/japan-coast.json').then(r => r.json()).catch(() => null),
    tex('assets/web/wave.png').catch(() => null),              // the sea's sparse wave pattern (flatmap.js): a plain wash without it
    loadSealFonts(),
  ]);
  coast = coastJson && Array.isArray(coastJson.land) ? coastJson : null;
  places = Array.isArray(placesJson) ? placesJson : [];
  places.forEach(p => placeById.set(p.id, p));

  world = await loadWorld({
    baseUrl: 'data/central-japan-z9.bin',
    patchUrls: ['data/hakone-fuji-z11.bin', 'data/tokyo-z11.bin', 'data/kansai-z11.bin'],
    washiTex: washi,
  });
  if (q.has('simple')) world.group.traverse(o => { if (o.isMesh) o.material = new THREE.MeshNormalMaterial(); });
  scene.add(world.group);
  if (q.has('seam')) world.materials.slice(1).forEach(m => m.uniforms.uTint.value.set(1, 0.15, 0.15));   // debug: tint the patches

  // pins and labels
  pins = new Pins({ scene, camera, canvas, labelHost: scrollEl, places, lonLatToWorld, heightAtWorld, view });
  refreshPins();


  // Phase 3: route layer, itinerary drawer, fly-through player, symbol tooltips
  const ctx = { THREE, scene, camera, controls, canvas, scrollEl, state, ui, Store, places, placeById,
    lonLatToWorld, heightAtWorld, groundTarget, sph, aimPose, freeRect, rectCentre, flyToPose, cutToPose, placePose, regionPose,
    isFlying: () => !!fly, openPlace, REGION_INFO, world, view, coast, framePoints, flyToRegion };
  try { route = await initRoute(ctx); route.setVisible(state.route); } catch (e) { console.error('route', e); }
  try { trip = initTrip(ctx, route); } catch (e) { console.error('trip', e); }
  try { list = initList(ctx, { route, trip, reload: reloadTrip }); } catch (e) { console.error('list', e); }
  refreshPins();                                          // the route has loaded: the trip set is known
  try { initTips(); } catch (e) { console.error('tips', e); }
  // flat map layers under the terrain (sea, land, coast, lakes), the map key, the koi marker and the sea paintings
  try { flat = await initFlatMap(ctx, { washiTex: washi, waveTex }); } catch (e) { console.error('flatmap', e); }
  try { inset = initInset(ctx); } catch (e) { console.error('inset', e); }
  try { marker = initMarker(ctx, route, trip); marker.setVisible(state.route); } catch (e) { console.error('marker', e); }
  try { art = await initArt(ctx); } catch (e) { console.error('art', e); }
  try { initLegend(); } catch (e) { console.error('legend', e); }

  const landmark = (lon, lat) => { const p = lonLatToWorld(lon, lat); p.y = heightAtWorld(p.x, p.z) + 0.6; return p; };
  const fuji = landmark(138.7274, 35.3606), ashi = landmark(139.005, 35.205), owak = landmark(139.0265, 35.2423);
  addMark('landmark', 'Mount Fuji', fuji, 'fuji-peak');
  addMark('landmark', 'Lake Ashi', ashi, 'lake-ashi');
  addMark('landmark', 'Owakudani', owak, 'owakudani');
  for (const id of ['tokyo', 'kyoto', 'osaka', 'fuji', 'hakone', 'nara']) {
    const r = REGIONS[id], p = groundTarget(r.lon, r.lat); p.y += 1.2;
    addMark('region', REGION_INFO[id].en, p, id, REGIONS[id].side);
  }

  resize();
  syncModeUi();
  // intro: slow flight down to the open view. Flat map: all of Japan, straight down from 1.25 times the distance. 3D: the central Japan overview.
  const flat2d = view.is2d();
  state.region = flat2d ? 'japan' : 'overview'; ui.setActiveRegion(state.region);
  const end = flat2d ? japanPose() : regionPose('overview');
  if (state.cameraMoves) {
    const startOff = flat2d ? sph(end.offset.length() * 1.25) : sph(end.offset.length() * 1.5, 22, 16);
    controls.target.copy(end.target); camera.position.copy(end.target).add(startOff); camera.lookAt(end.target);
    flyToPose(end, 4, { arc: 0, from: startOff });
  } else { controls.target.copy(end.target); camera.position.copy(end.target).add(end.offset); camera.lookAt(end.target); }
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  $('#loading').classList.add('done');
  state.ready = true;
  if (!Store.who) setTimeout(() => ui.showWho(), 600);
  loop();
}

const clock = new THREE.Clock();
let lastNearFar = 0, lastBlend = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
  if (fly) stepFlight(now);
  if (!fly) {
    controls.update();
    const flat = view.is2d(), b = flat ? japanBounds() : world.bounds, m = flat ? 20 : 12;   // keep the pan inside the painted world (2D: inside Japan)
    const cx = THREE.MathUtils.clamp(controls.target.x, b.x0 + m, b.x1 - m), cz = THREE.MathUtils.clamp(controls.target.z, b.z0 + m, b.z1 - m);
    if (cx !== controls.target.x || cz !== controls.target.z) { const dx = cx - controls.target.x, dz = cz - controls.target.z; controls.target.x = cx; controls.target.z = cz; camera.position.x += dx; camera.position.z += dz; }
  }
  const dist = camera.position.distanceTo(controls.target);
  const near = Math.max(0.12, dist * 0.02);                // tight depth range keeps patch and base from z-fighting
  const far = view.blend > 0 ? Math.max(4000, dist * 2 + 500) : 4000;
  // pure 3D: refresh only when near drifts (as before). Any blend: every frame, because the orthographic half depends on the distance (and once more when it ends)
  if (view.blend > 0 || lastBlend > 0 || far !== camera.far || Math.abs(near - lastNearFar) > near * 0.05) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); lastNearFar = near; }
  lastBlend = view.blend;

  for (const mat of world.materials) {
    mat.uniforms.uTime.value = t; mat.uniforms.uCamPos.value.copy(camera.position);
    mat.uniforms.uFogNear.value = dist * 1.0; mat.uniforms.uFogFar.value = dist * 2.8;
    if (mat.uniforms.uFlat) mat.uniforms.uFlat.value = view.blend;    // the relief lightens with the flat map and follows a mode flight
  }
  if (flat) flat.update(dt, dist);                           // sets its own time, camera and fog uniforms (same values as the terrain)
  if (art) art.update(dt, dist);
  if (route) route.update(dt, dist);
  if (trip) trip.update(now, dt);
  if (marker) marker.update(dt, dist);                       // after trip.update: it reads the trip cursor
  renderer.render(scene, camera);
  if (inset) inset.update(now);

  const w = canvas.clientWidth, h = canvas.clientHeight;
  const obstacles = updateMarks(dist, w, h);
  pins.update({ dt, dist, w, h, obstacles: obstacles.concat(refreshUiRects()), blockers: pinBlockers });
}

window.__map = {
  flyToRegion, openPlace, state, ui, THREE, camera, controls, scene, view, framePoints, get coast() { return coast; },
  get pins() { return pins; }, get world() { return world; }, get places() { return places; },
  lonLatToWorld, heightAtWorld, freeRect, flyToPose, cutToPose, placePose, regionPose, aimPose, sph, groundTarget,
  get route() { return route; }, get trip() { return trip; }, get list() { return list; }, reloadTrip, get flat() { return flat; }, get inset() { return inset; }, get marker() { return marker; }, get art() { return art; },
  setWho(w) { Store.setWho(w); ui.setActiveRegion(state.region); refreshPins(); },
};
init().catch(err => { console.error(err); $('#loading .txt').innerHTML = 'Could not load the map<br><span></span>'; $('#loading .txt span').textContent = err.message; });
