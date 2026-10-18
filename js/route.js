// Phase 3 route layer: ink-brush strokes for the trip, a faint rail network under it, station ticks.
//
// Everything is drawn as screen-space ribbons (width in CSS px, extruded in clip space) with a ShaderMaterial:
// one draw call for the trip (all modes, all days, all legs) and one for the rail network.
// Dimming by day, progressive reveal and the fade are uniforms, so none of them rebuilds geometry.
//
// World frame: see terrain.js. Paths are draped on the terrain MESH (not the raw heights), so they never sink into it.
import * as THREE from 'three';
import { metersToUnits } from './terrain.js';
import { loadItinerary } from './itinerary.js';

// ---------- constants ----------
const ST = { shinkansen: 0, local: 1, funicular: 1, walk: 2, bus: 3, boat: 4, ropeway: 5, CTX: 6, CTX_SHIN: 7, TICK: 8 };
const MAX_SEG = 0.4;                // world units: longest segment after resampling
const SNAP = 0.08;                  // ~50 m: a part start/end this close to its line needs no connector
const FAR_JOIN = 0.6;               // ~375 m: a connector longer than this becomes a brush curve instead of a straight line
const LADDER = Math.SQRT2, HYST = 0.2;   // dash scale ladder (see update)
const TICK_HALF_PX = 5;
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (a, b, t) => { t = clamp01((t - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- shaders ----------
const vert = /* glsl */`
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide, aEnd, aS, aF, aLeg, aDay, aStyle, aSeed, aOff;
uniform vec2 uRes;       // canvas size in CSS px
uniform float uNear;     // near clip distance (view space, positive)
uniform float uK;        // px per world unit at the camera target (for tick length)
varying vec2 vXY;        // x: signed overshoot past the stroke end (px), y: cross-stroke offset (px)
varying float vS, vF, vLeg, vDay, vStyle, vSeed;

float halfExtent(float st) {
  if (st < 0.5) return 5.2;                        // trip strokes: half width plus room for the paper halo (HALO px)
  if (st < 1.5) return 4.4;
  if (st < 2.5) return 4.2;
  if (st < 3.5) return 4.2;
  if (st < 4.5) return 4.2;
  if (st < 5.5) return 5.4;
  if (st < 6.5) return 1.3;
  if (st < 7.5) return 1.5;
  return 1.9;
}
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
  float R = halfExtent(st);
  float e = aEnd;
  vec3 P = position, Pp = aPrev, Pn = aNext;
  if (st > 7.5) {                                   // tick: aPrev holds the unit direction across the line
    vec3 d = aPrev * (${TICK_HALF_PX.toFixed(1)} / max(uK, 1e-3));
    P = position + d * e;
    vec3 other = position - d * e;
    if (e < 0.0) { Pp = P; Pn = other; } else { Pp = other; Pn = P; }
  }
  vec4 c = toClip(P);
  vec2 tIn = scrDir(Pp, P), tOut = scrDir(P, Pn);
  if (dot(tIn, tIn) < 0.5) tIn = tOut;
  if (dot(tOut, tOut) < 0.5) tOut = tIn;
  if (dot(tIn, tIn) < 0.5) { tIn = vec2(1.0, 0.0); tOut = tIn; }
  vec2 nIn = vec2(-tIn.y, tIn.x), nOut = vec2(-tOut.y, tOut.x);
  vec2 m = nIn + nOut; float ml = length(m);
  m = ml > 1e-3 ? m / ml : nOut;
  float sc = 1.0 / max(dot(m, nOut), 0.5);          // miter, clamped: sharp corners get a blunt join
  vec2 off = m * (aSide * R + aOff) * sc;            // aOff: lane offset in px where several legs share one track (subway-map style)
  float over = 0.0;
  if (abs(e) > 1.5) { off += tOut * sign(e) * R; over = sign(e) * R; }   // cap rows: pushed past the end, round in the fragment shader
  gl_Position = c;
  gl_Position.xy += off * 2.0 / uRes * c.w;          // constant px offset after the divide, valid for any w
  vXY = vec2(over, aSide * R);
  vS = aS; vF = aF; vLeg = aLeg; vDay = aDay; vStyle = aStyle; vSeed = aSeed;
}`;

const frag = /* glsl */`
precision highp float;
uniform float uOpacity, uWalkFade, uTickFade, uCtxOpacity, uPx;
uniform float uDay, uDayPrev, uDayMix, uPLeg, uPT;
uniform float uTrail, uPLegF;   // trail: only the last legs behind the traveler show (uPLegF eases after uPLeg)
varying vec2 vXY;
varying float vS, vF, vLeg, vDay, vStyle, vSeed;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) {
  p = vec2(mod(p.x, 4096.0), p.y);
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
const vec3 VERM = vec3(200.0, 52.0, 30.0) / 255.0;
const vec3 INK  = vec3(44.0, 44.0, 42.0) / 255.0;
const vec3 GD   = vec3(91.0, 89.0, 82.0) / 255.0;
const vec3 GM   = vec3(142.0, 139.0, 130.0) / 255.0;
const vec3 PAPER = vec3(245.0, 239.0, 224.0) / 255.0;
const vec3 INDIGO = vec3(46.0, 74.0, 122.0) / 255.0;     // local train  #2E4A7A
const vec3 OCHRE  = vec3(176.0, 122.0, 42.0) / 255.0;    // bus          #B07A2A
const vec3 TEAL   = vec3(62.0, 124.0, 122.0) / 255.0;    // boat         #3E7C7A
const vec3 PLUM   = vec3(122.0, 62.0, 90.0) / 255.0;     // ropeway      #7A3E5A
// a rounded dash: pc = position in the period, centred on the dash; hl = half length; w = half width
float dash(float pc, float cd, float hl, float w) { return w - length(vec2(max(abs(pc) - (hl - w), 0.0), cd)); }

void main() {
  float st = floor(vStyle + 0.5), leg = floor(vLeg + 0.5), day = floor(vDay + 0.5);
  float cd = vXY.y, capd = abs(vXY.x);
  float sp = vS * uPx + vXY.x;                         // path distance in nominal px (cap rows reach back / forward past the ends)
  float seed = vSeed;
  float n1 = vn(vec2(sp * 0.07 + seed * 17.0, seed * 3.1));        // slow width variation along the stroke
  float n2 = vn(vec2(sp * 0.8 + seed * 5.0, cd * 1.1 + 11.0));    // dry-brush grain
  float n3 = vn(vec2(sp * 0.045 + seed * 9.0, 7.7));               // slow ink density
  float wob = 0.9 + 0.2 * n1;                                      // a little width variation (crisp enough to read the dash code)
  if (st < 5.5) cd += (vn(vec2(sp * 0.03 + seed * 11.0, 3.3)) - 0.5) * 0.6;   // the hand wanders a little off the line (kept small: lanes sit side by side)
  float pool = exp(-max(sp, 0.0) / 24.0);                          // ink pools at the start of a stroke
  vec3 col = INK; float base = 0.9, e = -1.0;                      // e: px inside the stroke edge

  // trip modes: each has its own colour, dash and weight (see the legend, js/legend.js). Full widths: 5, 3.75, 3.3, 3.3, 2.9, 3.5 px.
  if (st < 0.5) {                                                  // bullet train: vermilion, long dashes 22 on / 8 off
    float w = 2.5 * wob, pc = mod(sp + 11.0, 30.0) - 15.0;
    e = dash(pc, cd, 11.0, w); col = VERM; base = 0.95;
  } else if (st < 1.5) {                                           // local train, funicular: indigo, medium dashes 12 on / 6 off
    float w = 1.88 * wob, pc = mod(sp + 6.0, 18.0) - 9.0;
    e = dash(pc, cd, 6.0, w); col = INDIGO; base = 0.93;
  } else if (st < 2.5) {                                           // walk: ink dots, 3.5 px, every 9 px
    float cell = floor((sp + 4.5) / 9.0);
    float pc = mod(sp + 4.5, 9.0) - 4.5 + (hash12(vec2(cell, seed * 31.0)) - 0.5) * 0.6;
    float w = 1.75 * (0.9 + 0.2 * hash12(vec2(cell, seed * 7.0 + 3.0)));
    e = w - length(vec2(pc, cd)); col = INK; base = 0.9;
    if (capd > 0.0) e = -1.0;
  } else if (st < 3.5) {                                           // bus: ochre, short dashes 6 on / 5 off
    float w = 1.65 * wob, pc = mod(sp + 3.0, 11.0) - 5.5;
    e = dash(pc, cd, 3.0, w); col = OCHRE; base = 0.93;
  } else if (st < 4.5) {                                           // boat: teal dash-dot (10 dash, gap, dot, gap: period 20)
    float w = 1.65 * wob, ph = mod(sp, 20.0);
    float dd = dash(ph - 5.0, cd, 5.0, w);
    float dt = w - length(vec2(ph - 15.0, cd));
    e = max(dd, dt); col = TEAL; base = 0.93;
  } else if (st < 5.5) {                                           // ropeway, cable car: plum dashes 10 on / 4 off with a cable tick in each gap
    float w = 1.45 * wob, ph = mod(sp, 14.0);
    float core = dash(ph - 5.0, cd, 5.0, w);
    float tk = (capd > 0.0) ? -1.0 : min(0.7 - abs(ph - 12.0), 3.6 - abs(cd));
    e = max(core, tk); col = PLUM; base = 0.93;
  } else if (st < 7.5) {                                           // rail network: faint hairline
    float w = (st < 6.5 ? 0.5 : 0.68); e = w - length(vec2(capd, cd));
    col = GM; base = st < 6.5 ? 0.35 : 0.52;
  } else {                                                         // station tick
    e = 0.85 - abs(cd); base = 0.92;
  }

  float cov = smoothstep(-0.5, 0.5, e);
  cov *= 1.0 - 0.35 * (1.0 - smoothstep(0.15, 1.5, e)) * smoothstep(0.5, 0.78, n2) * (st < 5.5 || st > 7.5 ? 1.0 : 0.0);   // dry-brush break-up near the edges
  float a = clamp(base * (0.9 + 0.1 * n3 + 0.2 * pool * (st < 5.5 ? 1.0 : 0.0)), 0.0, 1.0) * cov;
  col *= 1.0 - 0.12 * pool * (st < 5.5 ? 1.0 : 0.0);               // ... and darkens a little there
  // a soft paper halo around each trip dash and dot, so the colours read on the dark mountains too
  if (st < 5.5) {
    float halo = (1.0 - smoothstep(0.4, 1.8, -e)) * 0.62;
    float A = a + halo * (1.0 - a);
    col = A > 0.0 ? (col * a + PAPER * halo * (1.0 - a)) / A : col; a = A;
  }

  float k = uOpacity;
  if (st > 5.5 && st < 7.5) k *= uCtxOpacity;
  else {
    float fa = (uDay < -0.5 || abs(day - uDay) < 0.5) ? 1.0 : 0.75;
    float fb = (uDayPrev < -0.5 || abs(day - uDayPrev) < 0.5) ? 1.0 : 0.75;
    k *= mix(fb, fa, uDayMix);
    float rv = 1.0;                                                // progressive reveal: earlier legs whole, the current leg up to uPT
    if (leg > uPLeg + 0.5) rv = 0.0;
    else if (leg > uPLeg - 0.5) rv = 1.0 - smoothstep(uPT - 0.004, uPT, vF);
    k *= rv;
    if (uTrail > 0.5 && leg < uPLeg - 0.5) {                       // the trail: the leg before the current one in half ink, the one before that fades out, older legs gone
      float age = max(0.0, uPLegF - leg);
      k *= age <= 1.0 ? mix(1.0, 0.4, smoothstep(0.0, 1.0, age)) : 0.4 * (1.0 - smoothstep(1.0, 2.0, age));
    }
    if (st > 7.5) k *= uTickFade;
    if (st > 1.5 && st < 2.5) k *= uWalkFade;
  }
  a *= k;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
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
// gentle quadratic brush curve, bow ~8% of its length, side chosen by the hash
function curve(a, b, hash) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
  if (l < 1e-6) return [a, b];
  const side = (hash & 1) ? 1 : -1, bow = 0.08 * l * (0.85 + ((hash >>> 1) % 100) / 330);
  const c = [(a[0] + b[0]) / 2 - dz / l * bow * side, (a[1] + b[1]) / 2 + dx / l * bow * side];
  const n = Math.max(6, Math.ceil(l / 0.3)), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

// ---------- lanes: legs that share a track sit side by side, like a subway map ----------
// For every vertex of every stroke, find the other legs that run along the same track there (a segment closer than NEAR, roughly parallel).
// The legs on that stretch are ranked by their order in the trip; each one takes a lane, centred on the track. The offset is in screen px,
// signed against one shared direction (the first leg's), so a leg that runs the other way still lands on its own lane. Then it is smoothed
// along the stroke, so a leg glides into its lane where the tracks meet instead of stepping.
const LANE_PX = 6.5, NEAR = 0.14, PARALLEL = 0.82, SMOOTH = 4;
function laneOffsets(list) {
  const CELL = 0.5, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  list.forEach((q, si) => { for (let k = 1; k < q.pts.length; k++) {
    const a = q.pts[k - 1], b = q.pts[k];
    const i0 = Math.floor(Math.min(a[0], b[0]) / CELL), i1 = Math.floor(Math.max(a[0], b[0]) / CELL), j0 = Math.floor(Math.min(a[2], b[2]) / CELL), j1 = Math.floor(Math.max(a[2], b[2]) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = key(i, j); let c = grid.get(kk); if (!c) grid.set(kk, c = []); c.push([si, k]); }
  } });
  return list.map((q, si) => {
    const n = q.pts.length, raw = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const p = q.pts[k], a = q.pts[Math.max(0, k - 1)], b = q.pts[Math.min(n - 1, k + 1)];
      let dx = b[0] - a[0], dz = b[2] - a[2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const best = new Map();                               // leg order -> { d, dir }
      const gi = Math.floor(p[0] / CELL), gj = Math.floor(p[2] / CELL);
      for (let i = gi - 1; i <= gi + 1; i++) for (let j = gj - 1; j <= gj + 1; j++) for (const [oi, ok] of grid.get(key(i, j)) || []) {
        const o = list[oi]; if (o.order === q.order) continue;
        const s0 = o.pts[ok - 1], s1 = o.pts[ok]; let ex = s1[0] - s0[0], ez = s1[2] - s0[2]; const el = Math.hypot(ex, ez); if (el < 1e-6) continue; ex /= el; ez /= el;
        if (Math.abs(ex * dx + ez * dz) < PARALLEL) continue;
        const d = segDist([p[0], p[2]], [s0[0], s0[2]], [s1[0], s1[2]]); if (d > NEAR) continue;
        const cur = best.get(o.order); if (!cur || d < cur.d) best.set(o.order, { d, dir: [ex, ez] });
      }
      if (!best.size) continue;
      const orders = [q.order, ...best.keys()].sort((x, y) => x - y), rank = orders.indexOf(q.order);
      const ref = orders[0] === q.order ? [dx, dz] : best.get(orders[0]).dir;
      const sgn = (dx * ref[0] + dz * ref[1]) >= 0 ? 1 : -1;
      raw[k] = (rank - (orders.length - 1) / 2) * LANE_PX * sgn;
    }
    const out = new Array(n);
    for (let k = 0; k < n; k++) { let t = 0, c = 0; for (let m = Math.max(0, k - SMOOTH); m <= Math.min(n - 1, k + SMOOTH); m++) { t += raw[m]; c++; } out[k] = t / c; }
    return out;
  });
}

class RailLine {
  constructor(feature, toWorld) {
    this.id = feature.properties.id; this.type = feature.properties.type; this.name = feature.properties.name;
    const raw = feature.geometry.coordinates, pts = [];
    for (const c of raw) { const w = toWorld(c[0], c[1]); if (!pts.length || Math.hypot(w[0] - pts[pts.length - 1][0], w[1] - pts[pts.length - 1][1]) > 1e-6) pts.push(w); }
    this.pts = pts; this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  project(x, z) {                                // closest point on the polyline
    const p = this.pts; let best = { d: Infinity, s: 0, i: 0, x: 0, z: 0 };
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; t = Math.min(1, Math.max(0, t));
      const qx = a[0] + t * dx, qz = a[1] + t * dz, d = Math.hypot(x - qx, z - qz);
      if (d < best.d) best = { d, s: this.cum[i - 1] + t * Math.sqrt(l2), i: i - 1, x: qx, z: qz };
    }
    return best;
  }
  sub(s0, s1) {                                  // [x,z] points from arclength s0 to s1 (reversed when s1 < s0)
    const rev = s1 < s0, lo = Math.min(s0, s1), hi = Math.max(s0, s1), p = this.pts, out = [];
    const at = (s) => { let i = 1; while (i < p.length - 1 && this.cum[i] < s) i++; const l = this.cum[i] - this.cum[i - 1] || 1, t = clamp01((s - this.cum[i - 1]) / l); return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t]; };
    out.push(at(lo));
    for (let i = 0; i < p.length; i++) if (this.cum[i] > lo + 1e-9 && this.cum[i] < hi - 1e-9) out.push(p[i]);
    out.push(at(hi));
    return rev ? out.reverse() : out;
  }
  tangentAt(x, z) { const q = this.project(x, z), a = this.pts[q.i], b = this.pts[q.i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
}

// ---------- ribbon geometry builder ----------
class Builder {
  constructor() { this.pos = []; this.prev = []; this.next = []; this.side = []; this.end = []; this.s = []; this.f = []; this.leg = []; this.day = []; this.style = []; this.seed = []; this.off = []; this.idx = []; this.rows = 0; }
  row(p, pv, nx, end, s, f, leg, day, style, seed, off = 0) {
    for (const side of [-1, 1]) {
      this.pos.push(p[0], p[1], p[2]); this.prev.push(pv[0], pv[1], pv[2]); this.next.push(nx[0], nx[1], nx[2]);
      this.side.push(side); this.end.push(end); this.s.push(s); this.f.push(f); this.leg.push(leg); this.day.push(day); this.style.push(style); this.seed.push(seed); this.off.push(off);
    }
    this.rows++;
  }
  strip(first, count) {                          // two triangles per pair of consecutive rows
    for (let r = first; r < first + count - 1; r++) { const a = 2 * r, b = 2 * r + 2; this.idx.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  // pts: [[x,y,z]...], fr: fraction along the leg for each point
  stroke(pts, fr, style, leg, day, seed, offs = null) {
    const P = [], F = [], O = [];
    for (let i = 0; i < pts.length; i++) { const q = P[P.length - 1]; if (q && Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1], pts[i][2] - q[2]) < 1e-6) continue; P.push(pts[i]); F.push(fr[i]); O.push(offs ? offs[i] : 0); }
    const n = P.length; if (n < 2) return;
    const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
    const first = this.rows;
    this.row(P[0], P[0], P[1], -2, 0, F[0], leg, day, style, seed, O[0]);
    for (let i = 0; i < n; i++) this.row(P[i], P[Math.max(0, i - 1)], P[Math.min(n - 1, i + 1)], i === 0 ? -1 : i === n - 1 ? 1 : 0, s[i], F[i], leg, day, style, seed, O[i]);
    this.row(P[n - 1], P[n - 2], P[n - 1], 2, s[n - 1], F[n - 1], leg, day, style, seed, O[n - 1]);
    this.strip(first, this.rows - first);
  }
  tick(center, dir, f, leg, day, seed) {         // dir: unit [x,y,z] across the line
    const first = this.rows;
    this.row(center, dir, dir, -1, 0, f, leg, day, ST.TICK, seed);
    this.row(center, dir, dir, 1, 0, f, leg, day, ST.TICK, seed);
    this.strip(first, 2);
  }
  geometry() {
    if (!this.rows) return null;
    const g = new THREE.BufferGeometry(), A = (n, arr, k) => g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(arr), k));
    A('position', this.pos, 3); A('aPrev', this.prev, 3); A('aNext', this.next, 3);
    A('aSide', this.side, 1); A('aEnd', this.end, 1); A('aS', this.s, 1); A('aF', this.f, 1); A('aLeg', this.leg, 1);
    A('aDay', this.day, 1); A('aStyle', this.style, 1); A('aSeed', this.seed, 1); A('aOff', this.off, 1);
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    return g;
  }
}

// ---------- the layer ----------
export async function initRoute(ctx) {
  const { scene, camera, canvas, scrollEl, Store, placeById, lonLatToWorld, heightAtWorld } = ctx;
  const toWorld = (lng, lat) => { const w = lonLatToWorld(lng, lat); return [w.x, w.z]; };

  // --- terrain mesh height: the exact triangle surface the player sees (patches first, then the base) ---
  const mapRef = (typeof window !== 'undefined' && window.__map) || null;
  const wfiles = mapRef && mapRef.world && mapRef.world.files;
  const gridH = (f, x, z) => {
    const { rect } = f, { hts, gx, gy } = f.grid;
    const u = (x - rect.x0) / (rect.x1 - rect.x0) * (gx - 1), v = (z - rect.z0) / (rect.z1 - rect.z0) * (gy - 1);
    const fu = Math.min(gx - 1.0001, Math.max(0, u)), fv = Math.min(gy - 1.0001, Math.max(0, v));
    const i = Math.floor(fu), j = Math.floor(fv), fx = fu - i, fy = fv - j;
    const ha = hts[j * gx + i], hb = hts[(j + 1) * gx + i], hc = hts[(j + 1) * gx + i + 1], hd = hts[j * gx + i + 1];
    return metersToUnits(fx + fy <= 1 ? ha + fx * (hd - ha) + fy * (hb - ha) : hc + (1 - fx) * (hb - hc) + (1 - fy) * (hd - hc));
  };
  const inR = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const surfaceY = (x, z) => {
    if (wfiles && wfiles.length && wfiles[0].grid) {
      for (let i = wfiles.length - 1; i >= 1; i--) { const f = wfiles[i]; if (f.grid && inR(f.rect, x, z)) return gridH(f, x, z); }
      const b = wfiles[0]; if (inR(b.rect, x, z)) return gridH(b, x, z);
    }
    return heightAtWorld(x, z);
  };
  // [x,z] points -> [x,y,z] points lying on the terrain: a small lift plus a slope term (steep ground rises between samples)
  function drape(xz) {
    const h = xz.map(p => surfaceY(p[0], p[1])), out = [];
    for (let i = 0; i < xz.length; i++) {
      const a = Math.max(0, i - 1), b = Math.min(xz.length - 1, i + 1);
      const ds = Math.hypot(xz[b][0] - xz[a][0], xz[b][1] - xz[a][1]) || 1, grad = Math.abs(h[b] - h[a]) / ds;
      out.push([xz[i][0], h[i] + 0.03 + 0.1 * Math.min(grad, 1.5), xz[i][1]]);
    }
    return out;
  }
  const placeXZ = (id) => { const p = placeById.get(id); return p && typeof p.lat === 'number' ? toWorld(p.lng, p.lat) : null; };

  // --- shared uniforms and materials ---
  const U = {
    uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.2 }, uK: { value: 10 },
    uOpacity: { value: 1 }, uWalkFade: { value: 1 }, uTickFade: { value: 0 }, uCtxOpacity: { value: 1 }, uPx: { value: 4 },
    uDay: { value: -1 }, uDayPrev: { value: -1 }, uDayMix: { value: 1 }, uPLeg: { value: 1e9 }, uPT: { value: 1 },
    uTrail: { value: 0 }, uPLegF: { value: 0 },
  };
  const makeMat = () => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms: U, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const ctxMat = makeMat(), tripMat = makeMat();
  const group = new THREE.Group(); group.name = 'route'; scene.add(group);

  // --- rail network (context) ---
  const lines = new Map(), stations = new Map();
  try {
    const gj = await fetch('data/rail.geojson').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    for (const f of gj.features || []) {
      const pr = f.properties || {};
      if (pr.kind === 'line' && f.geometry && f.geometry.type === 'LineString') lines.set(pr.id, new RailLine(f, toWorld));
      else if (pr.kind === 'station' && f.geometry && f.geometry.type === 'Point') {
        const [x, z] = toWorld(f.geometry.coordinates[0], f.geometry.coordinates[1]);
        stations.set(pr.id, { id: pr.id, x, z, kanji: pr.kanji || '', name: pr.name || '', lines: pr.lines || [] });
      }
    }
  } catch (e) { console.warn('[route] rail.geojson not loaded:', e.message); }
  {
    const b = new Builder();
    for (const L of lines.values()) {
      const xz = densify(simplify(L.pts, 0.02), MAX_SEG), pts = drape(xz);
      b.stroke(pts, pts.map(() => 0), L.type === 'shinkansen' ? ST.CTX_SHIN : ST.CTX, 0, 0, (hashStr(L.id) % 1000) / 1000);
    }
    const g = b.geometry();
    if (g) { const m = new THREE.Mesh(g, ctxMat); m.frustumCulled = false; m.renderOrder = 2; m.name = 'route-network'; group.add(m); }
  }

  // --- the trip ---
  const api = { itinerary: null, who: null };
  let legs = [];                 // legs[day][i] = { order, from, to, mode, minutes, pts:[Vector3], cum:Float32Array, len }
  let tripMesh = null, labels = [], stamps = [], stopPos = new Map(), stationPos = new Map(), buildToken = 0;
  let wanted = 1, shown = 1, activeDay = null, dayMix = 1, openRegion = null;     // openRegion: the city whose name was tapped (its day stamps show)

  function disposeTrip() {
    if (tripMesh) { group.remove(tripMesh); tripMesh.geometry.dispose(); tripMesh = null; }
    for (const l of labels) l.el.remove();
    for (const s of stamps) s.el.remove();
    labels = []; stamps = []; legs = [];
  }

  const warned = new Set();
  function legStrokes(leg, from, to) {            // -> [{ style, xz:[[x,z]...] }], plus station hits
    const hash = hashStr(leg.from + '>' + leg.to + leg.mode), hits = [];
    const mode = ST[leg.mode] !== undefined ? ST[leg.mode] : ST.local;
    if (!leg.parts || !leg.parts.length) return { strokes: [{ style: mode, xz: curve(from, to, hash), mode: leg.mode }], hits };
    const strokes = [];
    let cur = from;
    leg.parts.forEach((part, pi) => {
      const style = ST[part.mode] !== undefined ? ST[part.mode] : mode;
      const st = stations.get(part.to), tgt = st ? [st.x, st.z] : (placeXZ(part.to) || (pi === leg.parts.length - 1 ? to : null));
      if (!tgt) { if (!warned.has(part.to)) { warned.add(part.to); console.warn('[route] part skipped, unknown target', part.to); } return; }
      const h2 = hashStr(leg.from + leg.to + pi);
      const L = part.line ? lines.get(part.line) : null;
      let xz;
      if (L) {
        const a = L.project(cur[0], cur[1]), b = L.project(tgt[0], tgt[1]);
        xz = [];
        if (a.d > SNAP) xz.push(...(a.d > FAR_JOIN ? curve(cur, [a.x, a.z], h2) : [cur]));
        xz.push(...L.sub(a.s, b.s));
        if (b.d > SNAP) xz.push(...(b.d > FAR_JOIN ? curve([b.x, b.z], tgt, h2) : [tgt]));
        xz = densify(simplify(xz, 0.012), MAX_SEG);
        if (st) hits.push({ station: st, line: L, stroke: strokes.length });
      } else {
        xz = curve(cur, tgt, h2);
        if (st) hits.push({ station: st, line: null, stroke: strokes.length });
      }
      strokes.push({ style, xz, mode: part.mode });
      cur = tgt;
    });
    if (!strokes.length) return { strokes: [{ style: mode, xz: curve(from, to, hash), mode: leg.mode }], hits };   // every part was unusable: one brush curve
    // the leg ends exactly on its destination
    const last = strokes[strokes.length - 1];
    if (last && Math.hypot(last.xz[last.xz.length - 1][0] - to[0], last.xz[last.xz.length - 1][1] - to[1]) > 1e-6) last.xz.push(to);
    return { strokes, hits };
  }

  function build(it) {
    disposeTrip();
    const B = new Builder(), stationDays = new Map();   // station id -> Map(day -> { f, order })
    const uniq = new Set();
    let order = 0;
    stopPos = new Map(); stationPos = new Map();
    for (const [id, st] of stations) stationPos.set(id, new THREE.Vector3(st.x, surfaceY(st.x, st.z) + 0.03, st.z));
    const tickList = [], pending = [];
    (it.days || []).forEach((day, di) => {
      legs[di] = [];
      for (const sid of day.stops || []) { const xz = placeXZ(sid); if (xz && !stopPos.has(sid)) stopPos.set(sid, new THREE.Vector3(xz[0], surfaceY(xz[0], xz[1]) + 0.03, xz[1])); }
      (day.legs || []).forEach((leg, li) => {
        const myOrder = order++, A = placeXZ(leg.from), Z = placeXZ(leg.to);
        if (!A || !Z) { console.warn('[route] leg skipped (unknown place)', di, li, leg.from, leg.to); legs[di][li] = null; return; }
        const { strokes, hits } = legStrokes(leg, A, Z);
        const dr = strokes.map(s => drape(s.xz));
        let total = 0; const cums = dr.map(pts => { const c = [total]; for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); c.push(total); } return c; });
        total = Math.max(total, 1e-6);
        const seed = (hashStr(leg.from + '|' + leg.to) % 997) / 997;
        const all = [], allCum = [];
        dr.forEach((pts, si) => {
          pending.push({ pts, fr: cums[si].map(c => c / total), style: strokes[si].style, order: myOrder, day: di, seed: (seed + si * 0.137) % 1 });
          pts.forEach((p, i) => { if (all.length && Math.hypot(p[0] - all[all.length - 1].x, p[1] - all[all.length - 1].y, p[2] - all[all.length - 1].z) < 1e-6) return; all.push(new THREE.Vector3(p[0], p[1], p[2])); allCum.push(cums[si][i]); });
        });
        legs[di][li] = { order: myOrder, from: leg.from, to: leg.to, mode: leg.mode, minutes: leg.minutes, pts: all, cum: Float32Array.from(allCum), len: total };
        for (const h of hits) {                         // station ticks: where the part ends, across the line
          const key = di + ':' + h.station.id; if (uniq.has(key)) continue; uniq.add(key);
          const pts = dr[h.stroke], last = pts.length - 1, c = pts[last], p0 = pts[Math.max(0, last - 1)];
          let tx, tz;
          const tl = h.line || h.station.lines.map(id => lines.get(id)).find(Boolean);
          if (tl) [tx, tz] = tl.tangentAt(h.station.x, h.station.z); else { const l = Math.hypot(c[0] - p0[0], c[2] - p0[2]) || 1; tx = (c[0] - p0[0]) / l; tz = (c[2] - p0[2]) / l; }
          tickList.push({ station: h.station, day: di, f: cums[h.stroke][last] / total, order: myOrder, c: [h.station.x, surfaceY(h.station.x, h.station.z) + 0.06, h.station.z], dir: [-tz, 0, tx], seed });
        }
      });
    });
    const offs = laneOffsets(pending);
    pending.forEach((q, i) => B.stroke(q.pts, q.fr, q.style, q.order, q.day, q.seed, offs[i]));
    for (const t of tickList) B.tick(t.c, t.dir, t.f, t.order, t.day, t.seed);
    const g = B.geometry();
    if (g) { tripMesh = new THREE.Mesh(g, tripMat); tripMesh.frustumCulled = false; tripMesh.renderOrder = 3; tripMesh.name = 'route-trip'; group.add(tripMesh); }
    // DOM labels for the stations the trip uses
    const seen = new Set();
    for (const t of tickList) {
      if (seen.has(t.station.id)) { labels.find(l => l.id === t.station.id).days.push(t.day); continue; }
      seen.add(t.station.id);
      const el = document.createElement('div'); el.className = 'rstn'; el.textContent = t.station.name || t.station.id; scrollEl.appendChild(el);      // English station name
      labels.push({ id: t.station.id, el, pos: new THREE.Vector3(t.c[0], t.c[1], t.c[2]), days: [t.day], on: false, w: 0, h: 0 });
    }
    api.stationCount = labels.length;
    buildStamps(it);
    applyDay();
  }

  // --- day stamps: one seal per run of nights spent in the same place ---
  // A day's place is its `stay` when it has one. A day without a stay is spent where it ends (the region of its last stop) and joins the previous
  // group when that group is in the same region. Consecutive days with the same place share one stamp ("1–3", "4", "5", "6–8", "9–10").
  const setStampOn = (s, on) => { s.on = on; s.el.classList.toggle('show', on); s.el.tabIndex = on ? 0 : -1; s.el.setAttribute('aria-hidden', on ? 'false' : 'true'); };
  function buildStamps(it) {
    const days = it.days || [], n = days.length;
    const lastStop = (d) => (d.stops || [])[(d.stops || []).length - 1];
    const groups = [];
    days.forEach((d, i) => {
      const stayP = d.stay ? placeById.get(d.stay) : null, stay = stayP ? d.stay : null;
      const region = (stayP && stayP.region) || (placeById.get(lastStop(d)) || {}).region || d.region || '', g = groups[groups.length - 1];
      if (g && (stay ? g.stay === stay : g.region === region)) g.last = i; else groups.push({ stay, region, first: i, last: i });
    });
    for (const g of groups) {
      const stayP = g.stay ? placeById.get(g.stay) : null;
      const endsTrip = g.last === n - 1, nights = g.last - g.first + 1 - (endsTrip ? 1 : 0);        // the last day of the trip has no night
      const anchorId = g.stay || lastStop(days[Math.max(g.first, g.last - (endsTrip ? 1 : 0))]);     // where the last night of the run is spent
      const xz = placeXZ(anchorId); if (!xz) continue;
      const a = g.first + 1, b = g.last + 1;
      const name = stayP ? (stayP.short || stayP.name) : ((ctx.REGION_INFO && ctx.REGION_INFO[g.region]) || {}).en || '';
      const tip = [a === b ? `Day ${a}` : `Day ${a}–${b}`, nights > 0 ? `${nights} night${nights === 1 ? '' : 's'}` : '', name].filter(Boolean).join(' · ');
      const el = document.createElement('span'), t = document.createElement('b');
      el.className = 'dstamp'; t.textContent = a === b ? String(a) : `${a}–${b}`; el.appendChild(t);
      el.dataset.tip = tip; el.setAttribute('role', 'button'); el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); el.setAttribute('aria-label', tip.replace(/ · /g, ', '));
      const go = () => { const tr = mapRef && mapRef.trip; if (tr && typeof tr.setDay === 'function') tr.setDay(g.first); };
      el.addEventListener('click', (e) => { e.stopPropagation(); go(); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(); } });   // stopPropagation: Space must not also play the trip
      stamps.push({ el, host: null, own: anchorId, region: g.region, first: g.first, pos: new THREE.Vector3(xz[0], surfaceY(xz[0], xz[1]) + 0.03, xz[1]), on: false, w: 0, h: 0, o: '' });
    }
    api.stampCount = stamps.length;
  }
  api.toggleStamps = (region) => { openRegion = openRegion === region ? null : region; return openRegion; };
  api.closeStamps = () => { openRegion = null; };
  api.hasStamps = (region) => stamps.some(s => s.region === region);
  if (typeof document !== 'undefined' && document.fonts) {                  // the stamp width depends on the label font
    const remeasure = () => { for (const s of stamps) s.w = 0; };
    document.fonts.ready.then(remeasure); document.fonts.addEventListener?.('loadingdone', remeasure);
  }

  // --- state setters ---
  // The trail (on while the traveler is on the map): uPLegF follows uPLeg at one leg per TRAIL_S, so the older legs fade, they do not blink.
  // A jump back snaps it. A jump ahead of more than one leg keeps one fade step, so no long run of legs fades at once.
  const TRAIL_S = 1;
  function applyProgress(day, leg, t) {
    const off = () => { U.uPLeg.value = 1e9; U.uPT.value = 1; U.uTrail.value = 0; };
    if (day === null || day === undefined) { off(); return; }
    const L = legs[day] && legs[day][leg];
    if (!L) { off(); return; }
    const d = L.order - U.uPLegF.value;
    if (U.uTrail.value < 0.5 || d < -0.001) U.uPLegF.value = L.order;
    else if (d > 1.5) U.uPLegF.value = L.order - 1;                 // short legs or a jump ahead: keep at most one fade running
    U.uTrail.value = 1;
    U.uPLeg.value = L.order; U.uPT.value = t >= 1 ? 1.02 : Math.max(0, +t || 0);
  }
  function applyDay() {
    const d = activeDay === null || activeDay === undefined || !legs[activeDay] ? -1 : activeDay;
    U.uDayPrev.value = U.uDay.value; U.uDay.value = d; dayMix = 0; U.uDayMix.value = 0;
  }

  // --- data loading ---
  // the shared loader: the plan file of this person with this device's swaps applied (js/itinerary.js)
  async function loadItin(who) { const r = await loadItinerary(who, placeById); return { it: r.it, who: r.who }; }
  async function reload(who) {
    const token = ++buildToken;
    const { it, who: w } = await loadItin(who || Store.who || 'cade');
    if (token !== buildToken) return api;               // a newer reload is already running
    api.who = w; api.itinerary = it;
    if (it) { try { build(it); } catch (e) { console.error('[route] build failed', e); } } else { disposeTrip(); console.warn('[route] no itinerary file found'); }
    return api;
  }
  await reload(Store.who || 'cade');

  // --- per-frame ---
  let ladder = null, time = 0;
  const _v = new THREE.Vector3(), _blockers = [];
  function update(dt, dist) {
    time += dt;
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    // near clip only for a pure perspective projection; blended or orthographic (w = 1) must not clip against it
    U.uRes.value.set(w, h); U.uNear.value = camera.projectionMatrix.elements[11] < -0.999 ? camera.near * 1.02 : 0;
    const k = h / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(dist, 1));
    U.uK.value = k;
    const L = Math.log(k) / Math.log(LADDER);
    if (ladder === null || Math.abs(L - ladder) > 0.5 + HYST) ladder = Math.round(L);
    U.uPx.value = Math.pow(LADDER, ladder);
    U.uWalkFade.value = 1 - smooth(200, 300, dist);
    U.uTickFade.value = 1 - smooth(100, 150, dist);
    const step = dt / 0.4;
    shown += Math.sign(wanted - shown) * Math.min(Math.abs(wanted - shown), step);
    U.uOpacity.value = shown;
    if (U.uTrail.value > 0.5 && U.uPLegF.value < U.uPLeg.value) U.uPLegF.value = Math.min(U.uPLeg.value, U.uPLegF.value + dt / TRAIL_S);
    if (dayMix < 1) { dayMix = Math.min(1, dayMix + dt / 0.35); U.uDayMix.value = dayMix * dayMix * (3 - 2 * dayMix); }
    group.visible = shown > 0.004;
    updateLabels(dist, w, h);
  }

  // screen rects of fixed UI (rollers, seals, crests, masthead, the open card) that station labels keep clear of
  let uiAt = -1e9, uiList = [];
  function uiRects(w, h) {
    const now = performance.now();
    if (now - uiAt < 150) return uiList.slice();
    uiAt = now; uiList = [];
    const probe = document.getElementById('capProbe'), ci = probe ? probe.getBoundingClientRect().left : 0;
    uiList.push({ x: 0, y: 0, w: ci, h }, { x: w - ci, y: 0, w: ci, h });
    const title = document.getElementById('title');                       // the whole masthead band: a stamp or label beside the title reads as part of it
    if (title && !title.hidden) { const r = title.getBoundingClientRect(); if (r.height > 0) uiList.push({ x: 0, y: 0, w, h: r.bottom + 4 }); }
    for (const sel of ['#title img', '#title .sub', '#who', '#seals', '#crests', '#filters', '#player', '#drawer', '#bar', '#inset', '#card.open', '#card[aria-hidden="false"]']) {
      const el = document.querySelector(sel); if (!el || el.hidden) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.opacity === '0' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) uiList.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return uiList.slice();
  }


  function updateLabels(dist, w, h) {
    const lf = (1 - smooth(95, 125, dist)) * shown;
    const stampsOn = shown > 0.02 && stamps.length > 0, labelsOn = lf >= 0.03 && labels.length > 0;
    if (!stampsOn) for (const s of stamps) if (s.on) setStampOn(s, false);
    if (!labelsOn) for (const l of labels) if (l.on) { l.on = false; l.el.classList.remove('show'); }
    if (!stampsOn && !labelsOn) return;
    camera.updateMatrixWorld();
    const pins = mapRef && mapRef.pins && mapRef.pins.pins;
    const blockers = uiRects(w, h), seals = [];
    if (pins) for (const p of pins) if (p.sprite.visible && p.alpha > 0.2) {          // seals and their stems
      seals.push({ x: p.sx - 16, y: p.sy - 16, w: 32, h: 32 + 14, id: p.id });
    }
    const placed = [];
    // day stamps: each lives inside its city's name label (app.js moves the label), so it never jitters. It shows only after a tap on that name.
    if (stampsOn) {
      for (const s of stamps) {
        if (!s.host || !s.host.isConnected) {
          const host = s.region && document.querySelector(`.rlabel[data-key="${s.region}"]`);
          if (host) { let box = host.querySelector('.dstamps'); if (!box) { box = document.createElement('span'); box.className = 'dstamps'; host.appendChild(box); } box.appendChild(s.el); s.host = host; }
        }
        const show = !!s.host && openRegion === s.region;
        if (show !== s.on) setStampOn(s, show);
      }
      // near the right edge of the page the stamps move to the left of the name (with some slack, so they do not flip back and forth)
      const host = openRegion && document.querySelector(`.rlabel[data-key="${openRegion}"]`), box = host && host.querySelector('.dstamps');
      if (box) {
        const t = host.querySelector('.t').getBoundingClientRect(), bw = box.offsetWidth + 6, flip = box.classList.contains('flip');
        if (!flip && t.right + bw > w - 12) box.classList.add('flip');
        else if (flip && t.right + bw < w - 40) box.classList.remove('flip');
      }
    }
    if (!labelsOn) return;
    for (const o of seals) blockers.push(o);
    const order = labels.slice().sort((a, b) => (activeDay === null ? 0 : (b.days.includes(activeDay) ? 1 : 0) - (a.days.includes(activeDay) ? 1 : 0)));
    for (const l of order) {
      _v.copy(l.pos).applyMatrix4(camera.matrixWorldInverse);
      let show = _v.z < -camera.near * 1.5;                       // in front of the camera
      if (show) { _v.applyMatrix4(camera.projectionMatrix); show = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05; }
      if (show) {
        if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
        const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
        const r = { x: sx + 7, y: sy - l.h - 3, w: l.w, h: l.h };
        if (blockers.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) ||
            placed.some(o => r.x < o.x + o.w + 3 && r.x + r.w + 3 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y)) show = false;
        else { placed.push(r); l.el.style.transform = `translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)`; }
      }
      if (show) l.el.style.setProperty('--o', (lf * (activeDay === null || l.days.includes(activeDay) ? 1 : 0.35)).toFixed(2));
      if (show !== l.on) { l.on = show; l.el.classList.toggle('show', show); }
    }
  }

  // --- public API ---
  const _pt = new THREE.Vector3();
  Object.assign(api, {
    reload,
    update,
    setVisible(on) { wanted = on ? 1 : 0; },                              // fades over 0.4 s; never touches the camera
    setActiveDay(i) { activeDay = (i === null || i === undefined || !legs[i]) ? null : i; applyDay(); },
    setProgress(day, leg, t) { applyProgress(day, leg, t); },
    legPath(day, leg) { const L = legs[day] && legs[day][leg]; return L ? L.pts : []; },     // shared array: do not modify
    legLength(day, leg) { const L = legs[day] && legs[day][leg]; return L ? L.len : 0; },
    stopWorld(placeId) { const p = stopPos.get(placeId); if (p) return p.clone(); const xz = placeXZ(placeId); return xz ? new THREE.Vector3(xz[0], surfaceY(xz[0], xz[1]) + 0.03, xz[1]) : null; },
    dayStops(day) { const d = api.itinerary && api.itinerary.days && api.itinerary.days[day]; return d ? (d.stops || []).slice() : []; },
    // extras for the player
    dayCount() { return legs.length; },
    legCount(day) { return legs[day] ? legs[day].length : 0; },
    legInfo(day, leg) { const L = legs[day] && legs[day][leg]; return L ? { from: L.from, to: L.to, mode: L.mode, minutes: L.minutes, length: L.len, order: L.order } : null; },
    stationWorld(id) { const p = stationPos.get(id); return p ? p.clone() : null; },
    pointOnLeg(day, leg, t, out = new THREE.Vector3(), tangent = null) {    // t = 0..1 by path length
      const L = legs[day] && legs[day][leg]; if (!L || !L.pts.length) return null;
      const target = clamp01(t) * L.len; let i = 1; const n = L.pts.length;
      while (i < n - 1 && L.cum[i] < target) i++;
      if (n === 1) return out.copy(L.pts[0]);
      const a = L.pts[i - 1], b = L.pts[i], seg = (L.cum[i] - L.cum[i - 1]) || 1, u = clamp01((target - L.cum[i - 1]) / seg);
      out.lerpVectors(a, b, u);
      if (tangent) tangent.subVectors(b, a).normalize();
      return out;
    },
  });
  Object.defineProperties(api, {
    visible: { get: () => wanted > 0 },
    stats: { get: () => { let v = 0; group.traverse(o => { if (o.geometry && o.geometry.attributes.position) v += o.geometry.attributes.position.count; }); return { vertices: v, lines: lines.size, stations: stations.size, labels: labels.length, stamps: stamps.length }; } },
    uniforms: { get: () => U },
  });
  return api;
}
