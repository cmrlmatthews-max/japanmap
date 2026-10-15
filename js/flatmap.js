// Flat map layers that sit under the terrain: sea wash, land sheet, coast ink and lakes.
//
// World frame: see terrain.js. The terrain meshes are at y >= 0 (base renderOrder 0, patches 1).
// The sea, land and coast are below y = 0 and draw BEFORE the terrain, so they never cover it.
// The lakes sit 0.08 above the terrain and draw after it.
//
//   mesh        y              renderOrder
//   sea         -1.0           -3
//   land        -0.5           -1
//   coast       -0.45          -0.5   (the terrain base writes depth in its whole rect, so the coast must draw before it)
//   lake fill   terrain + 0.08  1.5   (after the patches, before the rail network at 2)
//   lake shore  terrain + 0.1   1.6
//
// The land and the coast are discarded inside `uCut` (the base terrain rect, inset 30 units): the terrain draws there.
// The coast also fades out over the last 24 units before the cut, so it does not double the terrain's own coast line.
//
// Use: const flat = await initFlatMap(ctx, { washiTex, waveTex });  then each frame: flat.update(dt, dist).
// update() also sets uTime, uCamPos, uFogNear and uFogFar on every material (same values as the terrain materials).
import * as THREE from 'three';
import { metersToUnits } from './terrain.js';

// ---------- constants ----------
const PAL = { paper: new THREE.Color('#F5EFE0'), greyL: new THREE.Color('#B9B6AC'), greyM: new THREE.Color('#8E8B82') };
const Y = { sea: -1.0, land: -0.5, coast: -0.45, lakeLift: 0.08, shoreLift: 0.1 };
const ORDER = { sea: -3, land: -1, coast: -0.5, lake: 1.5, shore: 1.6 };
const SEA_SIZE = 40000, SEA_CELLS = 16;
const CUT_INSET = 30;                       // world units
const CUT_FADE = 24;                        // the coast stroke fades out over the last 24 units before the cut
const WAVE_TILE = 60, WAVE_AMT = 0.10, WATER_MIX = 0.13, WAVE_DRIFT = 0.0006;   // units per tile, tile strength, paper -> grey-l, tiles per second
const ST = { COAST: 0, SHORE: 1 };
const SIMPLIFY_TOL = 0.01, MAX_SEG = 0.4;   // world units
const LADDER = Math.SQRT2, HYST = 0.2;      // stroke noise scale ladder (as in route.js)

// ---------- shaders ----------
// Fill meshes (sea, land, lakes): world position only.
const fillVert = /* glsl */`
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Same grain and fog as ink-shader.js, so the sheets match the terrain where they meet it.
const grainFog = /* glsl */`
  vec3 grain = texture2D(uWashi, vW.xz * 0.07).rgb;
  col *= mix(vec3(1.0), grain / 0.96, 0.35);
  float dCam = distance(vW, uCamPos);
  col = mix(col, uPaper, smoothstep(uFogNear, uFogFar, dCam) * 0.85);`;

const waterFrag = /* glsl */`
precision highp float;
uniform vec3 uPaper, uGreyL, uGreyM, uCamPos;
uniform sampler2D uWashi, uWave;
uniform float uTime, uFogNear, uFogFar, uMix, uWaveTile, uWaveAmt;
varying vec3 vW;
void main() {
  vec3 col = mix(uPaper, uGreyL, uMix);
  vec2 wuv = vW.xz / uWaveTile + vec2(0.6, 0.3) * uTime * ${WAVE_DRIFT.toFixed(5)};
  float ink = 1.0 - dot(texture2D(uWave, wuv).rgb, vec3(0.2126, 0.7152, 0.0722));   // the tile is dark ink on white
  col = mix(col, uGreyM, clamp(ink, 0.0, 1.0) * uWaveAmt);
  ${grainFog}
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const landFrag = /* glsl */`
precision highp float;
uniform vec3 uPaper, uCamPos;
uniform sampler2D uWashi;
uniform float uFogNear, uFogFar;
uniform vec4 uCut;                     // xmin, zmin, xmax, zmax: the terrain draws inside
varying vec3 vW;
void main() {
  if (vW.x > uCut.x && vW.x < uCut.z && vW.z > uCut.y && vW.z < uCut.w) discard;
  vec3 col = uPaper;
  ${grainFog}
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Screen-space ribbon (copy of the route.js ribbon): width in CSS px, extruded in clip space.
const ribbonVert = /* glsl */`
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide, aEnd, aS, aF, aLeg, aDay, aStyle, aSeed;
uniform vec2 uRes;       // canvas size in CSS px
uniform float uNear;     // near clip distance (view space, positive). 0 in 2D and in a mode flight (w is 1 there)
uniform float uK;        // px per world unit at the camera target
uniform float uWidth;    // ink width scale (1 = 1.3 px coast, 1.0 px shore)
varying vec2 vXY;        // x: signed overshoot past the stroke end (px), y: cross-stroke offset (px)
varying float vS, vStyle, vSeed;
varying vec3 vW;

float halfExtent(float st) { return st < 0.5 ? 1.6 : 1.3; }
vec4 toClip(vec3 p) { return projectionMatrix * viewMatrix * vec4(p, 1.0); }
// direction a->b in screen px, with both ends clipped to the near plane. zero when the whole segment is behind it
vec2 scrDir(vec3 a, vec3 b) {
  vec4 ca = toClip(a), cb = toClip(b);
  float wa = ca.w - uNear, wb = cb.w - uNear;
  if (wa < 0.0 && wb < 0.0) return vec2(0.0);
  if (wa < 0.0) ca = mix(ca, cb, wa / (wa - wb));
  else if (wb < 0.0) cb = mix(cb, ca, wb / (wb - wa));
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes * 0.5;
  float l = length(d);
  return l > 1e-4 ? d / l : vec2(0.0);
}
void main() {
  float st = floor(aStyle + 0.5);
  float R = halfExtent(st) * uWidth;
  float e = aEnd;
  vec3 P = position;
  vec4 c = toClip(P);
  vec2 tIn = scrDir(aPrev, P), tOut = scrDir(P, aNext);
  if (dot(tIn, tIn) < 0.5) tIn = tOut;
  if (dot(tOut, tOut) < 0.5) tOut = tIn;
  if (dot(tIn, tIn) < 0.5) { tIn = vec2(1.0, 0.0); tOut = tIn; }
  vec2 nIn = vec2(-tIn.y, tIn.x), nOut = vec2(-tOut.y, tOut.x);
  vec2 m = nIn + nOut; float ml = length(m);
  m = ml > 1e-3 ? m / ml : nOut;
  float sc = 1.0 / max(dot(m, nOut), 0.5);          // miter, clamped: sharp corners get a blunt join
  vec2 off = m * aSide * R * sc;
  float over = 0.0;
  if (abs(e) > 1.5) { off += tOut * sign(e) * R; over = sign(e) * R; }   // cap rows: pushed past the end, round in the fragment shader
  gl_Position = c;
  gl_Position.xy += off * 2.0 / uRes * c.w;          // constant px offset after the divide, valid for any w
  vXY = vec2(over, aSide * R);
  vS = aS; vStyle = aStyle; vSeed = aSeed;
  vW = P;
}`;

const ribbonFrag = /* glsl */`
precision highp float;
uniform float uOpacity, uPx, uFogNear, uFogFar, uWidth, uCutFade;
uniform vec3 uPaper, uCamPos;
uniform vec4 uCut;                     // coast: the terrain rect (inset). shore: unused (uCutFade is 0)
varying vec2 vXY;
varying float vS, vStyle, vSeed;
varying vec3 vW;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) {
  p = vec2(mod(p.x, 4096.0), p.y);
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
const vec3 INK = vec3(0.0256, 0.0256, 0.0232);       // #2C2C2A in linear light (the output is encoded to sRGB at the end)

void main() {
  float fade = 1.0;
  if (uCutFade > 0.0) {
    float dc = min(min(vW.x - uCut.x, uCut.z - vW.x), min(vW.z - uCut.y, uCut.w - vW.z));   // units inside the cut rect (negative outside it)
    if (dc > 0.0) discard;                                                                  // the terrain draws here
    fade = 1.0 - smoothstep(-uCutFade, 0.0, dc);                                            // crossfade with the terrain coast line
  }
  float st = floor(vStyle + 0.5);
  float cd = vXY.y, capd = abs(vXY.x);
  float sp = vS * uPx + vXY.x;                                     // path distance in nominal px (cap rows reach past the ends)
  float seed = vSeed;
  float n1 = vn(vec2(sp * 0.07 + seed * 17.0, seed * 3.1));        // slow width variation along the stroke
  float n2 = vn(vec2(sp * 0.8 + seed * 5.0, cd * 1.1 + 11.0));     // dry-brush grain
  float n3 = vn(vec2(sp * 0.045 + seed * 9.0, 7.7));               // slow ink density
  float wob = 0.8 + 0.45 * n1;
  cd += (vn(vec2(sp * 0.03 + seed * 11.0, 3.3)) - 0.5) * 0.7;     // the hand wanders a little off the line
  float pool = exp(-max(sp, 0.0) / 24.0);                          // ink pools at the start of a stroke
  float w = (st < 0.5 ? 0.65 : 0.5) * wob * uWidth;                // half width in px: coast 1.3 px, shore 1.0 px
  float e = w - length(vec2(capd, cd));                            // px inside the stroke edge
  float base = st < 0.5 ? 0.92 : 0.84;
  float cov = smoothstep(-0.5, 0.5, e);
  cov *= 1.0 - 0.5 * (1.0 - smoothstep(0.15, 1.5, e)) * smoothstep(0.45, 0.75, n2);   // dry-brush break-up near the edges
  float a = clamp(base * (0.88 + 0.12 * n3 + 0.3 * pool), 0.0, 1.0) * cov;
  vec3 col = INK * (1.0 - 0.16 * pool);                            // ... and darkens a little there
  col = mix(col, uPaper, smoothstep(uFogNear, uFogFar, distance(vW, uCamPos)) * 0.85);
  a *= uOpacity * fade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

// ---------- geometry helpers ----------
function segDist(p, a, b) {                      // distance from p to segment a-b ([x,z] arrays)
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0; t = Math.min(1, Math.max(0, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function simplify(pts, tol) {                    // Douglas-Peucker on [x,z] points
  const n = pts.length; if (n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } }
    if (mi > 0 && md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function densify(pts, maxSeg) {                  // no segment longer than maxSeg
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / maxSeg));
    for (let k = 1; k <= n; k++) out.push(k === n ? b : [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

// ---------- ribbon geometry builder (copy of the route.js Builder, without ticks) ----------
class Builder {
  constructor() { this.pos = []; this.prev = []; this.next = []; this.side = []; this.end = []; this.s = []; this.f = []; this.leg = []; this.day = []; this.style = []; this.seed = []; this.idx = []; this.rows = 0; }
  row(p, pv, nx, end, s, f, leg, day, style, seed) {
    for (const side of [-1, 1]) {
      this.pos.push(p[0], p[1], p[2]); this.prev.push(pv[0], pv[1], pv[2]); this.next.push(nx[0], nx[1], nx[2]);
      this.side.push(side); this.end.push(end); this.s.push(s); this.f.push(f); this.leg.push(leg); this.day.push(day); this.style.push(style); this.seed.push(seed);
    }
    this.rows++;
  }
  strip(first, count) {                          // two triangles per pair of consecutive rows
    for (let r = first; r < first + count - 1; r++) { const a = 2 * r, b = 2 * r + 2; this.idx.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  // pts: [[x,y,z]...]
  stroke(pts, style, seed) {
    const P = [];
    for (let i = 0; i < pts.length; i++) { const q = P[P.length - 1]; if (q && Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1], pts[i][2] - q[2]) < 1e-6) continue; P.push(pts[i]); }
    const n = P.length; if (n < 2) return;
    const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
    const first = this.rows;
    this.row(P[0], P[0], P[1], -2, 0, 0, 0, 0, style, seed);
    for (let i = 0; i < n; i++) this.row(P[i], P[Math.max(0, i - 1)], P[Math.min(n - 1, i + 1)], i === 0 ? -1 : i === n - 1 ? 1 : 0, s[i], 0, 0, 0, style, seed);
    this.row(P[n - 1], P[n - 2], P[n - 1], 2, s[n - 1], 0, 0, 0, style, seed);
    this.strip(first, this.rows - first);
  }
  geometry() {
    if (!this.rows) return null;
    const g = new THREE.BufferGeometry(), A = (n, arr, k) => g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(arr), k));
    A('position', this.pos, 3); A('aPrev', this.prev, 3); A('aNext', this.next, 3);
    A('aSide', this.side, 1); A('aEnd', this.end, 1); A('aS', this.s, 1); A('aF', this.f, 1); A('aLeg', this.leg, 1);
    A('aDay', this.day, 1); A('aStyle', this.style, 1); A('aSeed', this.seed, 1);
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    return g;
  }
}

// The wave tile is grey ink on a transparent ground (its transparent texels hold black). Flatten it on white once,
// so the shader can read "1 - luminance" as the ink amount, and mip filtering does not mix in the black.
function inkTile(src) {
  const img = src && src.image;
  let t;
  if (img && img.width > 0 && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
    t = new THREE.CanvasTexture(c);
  } else {
    t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);        // no tile: plain wash
    t.needsUpdate = true;
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------- the layer ----------
export async function initFlatMap(ctx, { washiTex, waveTex } = {}) {
  const { scene, camera, canvas, lonLatToWorld, heightAtWorld, coast, world } = ctx;
  const group = new THREE.Group(); group.name = 'flatmap';
  const materials = [];
  const api = { group, materials, bounds: null, cut: null, stats: {}, update() {}, setVisible(v) { group.visible = !!v; }, setInkWidth() {} };
  if (!coast || !Array.isArray(coast.land) || !coast.land.length) { console.warn('[flatmap] no coast data, layer skipped'); return api; }

  // --- bounds: the Japan rect from the bbox (same rect as japanBounds() in app.js) ---
  const bb = Array.isArray(coast.bbox) && coast.bbox.length === 4 ? coast.bbox : (() => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of coast.land) for (const p of r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
  })();
  const nw = lonLatToWorld(bb[0], bb[3], new THREE.Vector3()), se = lonLatToWorld(bb[2], bb[1], new THREE.Vector3());
  const bounds = { x0: nw.x, z0: nw.z, x1: se.x, z1: se.z };
  api.bounds = bounds;

  // --- the terrain rect (inset) that the land and the coast leave to the terrain ---
  const tb = world && world.bounds;
  const cut = tb ? new THREE.Vector4(tb.x0 + CUT_INSET, tb.z0 + CUT_INSET, tb.x1 - CUT_INSET, tb.z1 - CUT_INSET) : new THREE.Vector4(1, 1, 0, 0);   // empty rect: never discards
  const noCut = new THREE.Vector4(1, 1, 0, 0);
  api.cut = tb ? { x0: cut.x, z0: cut.y, x1: cut.z, z1: cut.w } : null;

  // --- textures ---
  if (washiTex) { washiTex.wrapS = washiTex.wrapT = THREE.RepeatWrapping; washiTex.colorSpace = THREE.SRGBColorSpace; }
  const waveTile = inkTile(waveTex);

  // --- uniforms shared by every material (the app updates these each frame, see update) ---
  const U = {
    uPaper: { value: PAL.paper }, uWashi: { value: washiTex || null },
    uCamPos: { value: new THREE.Vector3() }, uFogNear: { value: 1e6 }, uFogFar: { value: 2e6 }, uTime: { value: 0 },   // no fog until the first update
  };
  const R = { uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.2 }, uK: { value: 10 }, uPx: { value: 4 }, uOpacity: { value: 1 }, uWidth: { value: 1 } };
  api.setInkWidth = (f) => { R.uWidth.value = f; };                          // scale of the coast and shore ink width (1 = as drawn)
  const add = (m) => { materials.push(m); return m; };

  const waterMat = () => add(new THREE.ShaderMaterial({
    vertexShader: fillVert, fragmentShader: waterFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...U, uGreyL: { value: PAL.greyL }, uGreyM: { value: PAL.greyM }, uWave: { value: waveTile },
      uWaveTile: { value: WAVE_TILE }, uWaveAmt: { value: WAVE_AMT }, uMix: { value: WATER_MIX } },
  }));
  const ribbonMat = (cutRect, cutFade) => add(new THREE.ShaderMaterial({
    vertexShader: ribbonVert, fragmentShader: ribbonFrag, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    uniforms: { ...U, ...R, uCut: { value: cutRect }, uCutFade: { value: cutFade } },
  }));
  const mesh = (geo, mat, order, name) => {
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; m.name = name; group.add(m); return m;
  };

  // --- 1. sea plane (a coarse grid keeps every triangle small) ---
  {
    const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2, n = SEA_CELLS, pos = [], idx = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(cx + (i / n - 0.5) * SEA_SIZE, Y.sea, cz + (j / n - 0.5) * SEA_SIZE);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    mesh(g, waterMat(), ORDER.sea, 'flat-sea');
  }

  // --- helpers: rings -> world xz, triangles ---
  const _v = new THREE.Vector3();
  const ringXZ = (ring) => ring.map(p => { lonLatToWorld(p[0], p[1], _v); return [_v.x, _v.z]; });
  const open = (xz) => { const n = xz.length; return n > 1 && xz[0][0] === xz[n - 1][0] && xz[0][1] === xz[n - 1][1] ? xz.slice(0, n - 1) : xz; };
  const triangulate = (xz, name) => {
    const pts = open(xz).map(p => new THREE.Vector2(p[0], p[1]));
    if (pts.length < 3) return null;
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    if (!tris.length) { console.warn('[flatmap] ring not triangulated, skipped:', name); return null; }
    return { pts, tris };
  };
  const fillGeometry = (parts) => {                                       // parts: { pts, tris, yOf(x, z) }
    const pos = [], idx = [];
    for (const { pts, tris, yOf } of parts) {
      const base = pos.length / 3;
      for (const p of pts) pos.push(p.x, yOf(p.x, p.y), p.y);                // Vector2.y holds the world z
      for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    return g;
  };

  // --- 2. land sheet ---
  const landRings = coast.land.map(ringXZ);
  {
    const parts = [];
    landRings.forEach((xz, i) => { const t = triangulate(xz, 'land ' + i); if (t) parts.push(t); });
    const g = fillGeometry(parts.map(t => ({ ...t, yOf: () => Y.land })));
    if (g) {
      const mat = add(new THREE.ShaderMaterial({
        vertexShader: fillVert, fragmentShader: landFrag, transparent: true, depthWrite: true, side: THREE.DoubleSide,
        uniforms: { ...U, uCut: { value: cut } },
      }));
      mesh(g, mat, ORDER.land, 'flat-land');
    }
    api.stats.landRings = parts.length; api.stats.landTris = parts.reduce((s, p) => s + p.tris.length, 0);
  }

  // --- 3. coast stroke: one stroke per land ring ---
  {
    const B = new Builder();
    landRings.forEach((xz, i) => {
      const line = densify(simplify(xz, SIMPLIFY_TOL), MAX_SEG);
      if (line.length < 2) return;
      B.stroke(line.map(p => [p[0], Y.coast, p[1]]), ST.COAST, ((i * 0.618034) % 1));
    });
    const g = B.geometry();
    if (g) mesh(g, ribbonMat(cut, tb ? CUT_FADE : 0), ORDER.coast, 'flat-coast');
    api.stats.coastRows = B.rows;
  }

  // --- 4. lakes: a flat fill and a draped shore stroke ---
  // Height of the terrain MESH at x,z (what the player sees), so the lake never sinks into it. Falls back to the raw height.
  const files = world && world.files;
  const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const gridH = (f, x, z) => {
    const { rect } = f, { hts, gx, gy } = f.grid;
    const u = (x - rect.x0) / (rect.x1 - rect.x0) * (gx - 1), v = (z - rect.z0) / (rect.z1 - rect.z0) * (gy - 1);
    const fu = Math.min(gx - 1.0001, Math.max(0, u)), fv = Math.min(gy - 1.0001, Math.max(0, v));
    const i = Math.floor(fu), j = Math.floor(fv), fx = fu - i, fy = fv - j;
    const ha = hts[j * gx + i], hb = hts[(j + 1) * gx + i], hc = hts[(j + 1) * gx + i + 1], hd = hts[j * gx + i + 1];
    return metersToUnits(fx + fy <= 1 ? ha + fx * (hd - ha) + fy * (hb - ha) : hc + (1 - fx) * (hb - hc) + (1 - fy) * (hd - hc));
  };
  const surfaceY = (x, z) => {
    if (files && files.length && files[0].grid) {
      for (let i = files.length - 1; i >= 1; i--) { const f = files[i]; if (f.grid && inRect(f.rect, x, z)) return gridH(f, x, z); }
      if (inRect(files[0].rect, x, z)) return gridH(files[0], x, z);
    }
    return heightAtWorld(x, z);
  };
  {
    const lakes = Array.isArray(coast.lakes) ? coast.lakes : [];
    const parts = [], levels = [], B = new Builder();
    lakes.forEach((lake, i) => {
      if (!lake || !Array.isArray(lake.ring)) return;
      const xz = ringXZ(lake.ring), t = triangulate(xz, 'lake ' + (lake.name || i));
      if (t) {
        const hs = open(xz).map(p => surfaceY(p[0], p[1])).sort((a, b) => a - b);
        t.level = hs[hs.length >> 1];                                      // a lake is flat: its level is the median shore height
        parts.push(t); levels.push(t.level);
      }
      const line = densify(simplify(xz, SIMPLIFY_TOL), MAX_SEG), h = line.map(p => surfaceY(p[0], p[1])), pts = [];
      for (let k = 0; k < line.length; k++) {                              // shore: on the mesh, lifted a little more on slopes
        const a = Math.max(0, k - 1), b = Math.min(line.length - 1, k + 1);
        const ds = Math.hypot(line[b][0] - line[a][0], line[b][1] - line[a][1]) || 1, grad = Math.abs(h[b] - h[a]) / ds;
        pts.push([line[k][0], h[k] + Y.shoreLift + 0.1 * Math.min(grad, 1.5), line[k][1]]);
      }
      if (pts.length >= 2) B.stroke(pts, ST.SHORE, ((i * 0.381966 + 0.2) % 1));
    });
    // fill vertices: the lake level, raised where the ground is higher (so the fill is never hidden at its edge)
    const g = fillGeometry(parts.map(t => ({ ...t, yOf: (x, z) => Math.max(t.level, surfaceY(x, z)) + Y.lakeLift })));
    if (g) mesh(g, waterMat(), ORDER.lake, 'flat-lakes');
    const sg = B.geometry();
    if (sg) mesh(sg, ribbonMat(noCut, 0), ORDER.shore, 'flat-shores');
    api.stats.lakes = parts.length; api.stats.lakeLevels = levels.map(v => +v.toFixed(3));
  }

  scene.add(group);

  // --- per frame: ribbon uniforms (width in px) and the shared time, camera and fog uniforms ---
  let time = 0, ladder = null;
  api.update = function update(dt, dist) {
    time += dt;
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, d = Math.max(dist, 1);
    const k = h / (2 * Math.tan(camera.fov * Math.PI / 360) * d);           // px per world unit at the camera target
    R.uRes.value.set(w, h); R.uK.value = k;
    R.uNear.value = camera.projectionMatrix.elements[11] < -0.999 ? camera.near * 1.02 : 0;   // 2D and the mode flight blend in an orthographic part (w = 1): no near test then
    const L = Math.log(k) / Math.log(LADDER);
    if (ladder === null || Math.abs(L - ladder) > 0.5 + HYST) ladder = Math.round(L);
    R.uPx.value = Math.pow(LADDER, ladder);
    U.uTime.value = time; U.uCamPos.value.copy(camera.position);
    U.uFogNear.value = dist * 1.0; U.uFogFar.value = dist * 2.8;            // same as the terrain materials
  };
  return api;
}
