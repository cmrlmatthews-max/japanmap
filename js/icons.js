// Brush-and-ink pictograms for "Journey Through Japan".
// Every icon is a set of FILLED shapes that imitate sumi brush work (tapered ends, a little width
// variation, a few dry-brush breaks). They share one brush: same weight classes, same taper.
// viewBox 0 0 32 32, fill = currentColor, so one icon works as paper-white on a vermilion stamp
// and as ink on paper. No text, no emoji.
//
// HOW IT IS BUILT
//   Each icon below is a list of brush ops (S stroke, D dot, F filled mass, H hole). At load they are
//   turned into one SVG path string per icon (ICON_PATHS). iconSVG(), stampSVG() and drawIcon() all use
//   that same path data, so the SVG and the canvas always match.
//
// API
//   ICON_NAMES                          all keys
//   iconSVG(name, {size, title})        inline <svg> markup (aria-hidden unless title is given)
//   stampSVG(name, {size, solid, seed}) a whole hanko stamp as inline SVG (solid vermilion, or outline)
//   drawIcon(ctx, name, cx, cy, size, color)   paint on a 2D canvas, centered at (cx, cy)
//   ICON_ART, setIconArt(name, url)     optional painted PNG art (see below)
//
// SWITCHING AN ICON TO A PAINTED PNG (Gemini brush art)
//   1. Put a transparent PNG (square, ideally 256 x 256 or larger) at assets/web/icons/<name>.png
//   2. Register it, once, before the UI is built:
//        import { setIconArt } from './icons.js';
//        setIconArt('temple', 'assets/web/icons/temple.png');
//      or fill the object directly:  ICON_ART.temple = 'assets/web/icons/temple.png';
//   3. From then on iconSVG('temple') returns <img src=...> at the same size, and drawIcon() paints the
//      image once it has loaded (until then it falls back to the vector, so nothing flashes empty).
//   The PNG is used as is, in its own colors. If it is a one-color silhouette that should take the
//   caller's color (paper-white on a stamp), register it with setIconArt(name, url, true): the image is
//   then used as a mask and tinted with currentColor / the drawIcon color.
//   Remove the entry (delete ICON_ART.temple) to go back to the vector brush icon.

// ----------------------------------------------------------------------------------------------
// small helpers
// ----------------------------------------------------------------------------------------------
const VERM = '#C8341E', PAPER = '#F5EFE0';
const TAU = Math.PI * 2;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const num = (n) => { const s = n.toFixed(2); return s.indexOf('.') < 0 ? s : s.replace(/0+$/, '').replace(/\.$/, ''); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let R = rng(1);                       // per-icon random stream (set while an icon is built)

// Catmull-Rom through points -> dense polyline
function catmull(pts, per = 8, closed = false) {
  const n = pts.length, out = [];
  if (n < 3 && !closed) { for (let k = 0; k <= per * 2; k++) { const t = k / (per * 2); out.push([pts[0][0] + (pts[n - 1][0] - pts[0][0]) * t, pts[0][1] + (pts[n - 1][1] - pts[0][1]) * t]); } return out; }
  const g = (i) => closed ? pts[(i + n) % n] : pts[Math.min(n - 1, Math.max(0, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

// resample a polyline to even spacing (about `step` units)
function resample(dense, step = 0.95) {
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const L = cum[cum.length - 1], N = Math.max(5, Math.round(L / step) + 1), out = [];
  let j = 1;
  for (let k = 0; k < N; k++) {
    const d = L * k / (N - 1);
    while (j < dense.length - 1 && cum[j] < d) j++;
    const seg = cum[j] - cum[j - 1] || 1, t = (d - cum[j - 1]) / seg;
    out.push([dense[j - 1][0] + (dense[j][0] - dense[j - 1][0]) * t, dense[j - 1][1] + (dense[j][1] - dense[j - 1][1]) * t]);
  }
  return out;
}

const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; a += P[i][0] * q[1] - q[0] * P[i][1]; } return a / 2; };
const orient = (P, sign) => ((area(P) < 0) === (sign < 0)) ? P : P.slice().reverse();

// closed control polygon -> smooth path (quadratic through midpoints)
function polyPath(P) {
  const n = P.length, mid = (i) => { const a = P[i % n], b = P[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const m0 = mid(0);
  let d = 'M' + num(m0[0]) + ' ' + num(m0[1]);
  for (let i = 1; i <= n; i++) { const c = P[i % n], m = mid(i); d += 'Q' + num(c[0]) + ' ' + num(c[1]) + ' ' + num(m[0]) + ' ' + num(m[1]); }
  return d + 'Z';
}

// ----------------------------------------------------------------------------------------------
// the brush
// ----------------------------------------------------------------------------------------------
// Brush weights (viewBox units). Every stroke uses one of these so the set looks drawn with one brush.
const W = 2.5, HV = 3.7, TH = 1.7;

// ribbon around a sampled centerline P with widths Wd[i]; round caps
function ribbon(P, Wd) {
  const n = P.length, Lp = [], Rp = [], tan = [], nor = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    tan.push([tx, ty]); nor.push([-ty, tx]);
  }
  for (let i = 0; i < n; i++) { const h = Wd[i] / 2; Lp.push([P[i][0] + nor[i][0] * h, P[i][1] + nor[i][1] * h]); Rp.push([P[i][0] - nor[i][0] * h, P[i][1] - nor[i][1] * h]); }
  const poly = Lp.slice();
  const e = n - 1, re = Wd[e] / 2, rs = Wd[0] / 2;
  for (let k = 1; k <= 3; k++) { const th = k * Math.PI / 4; poly.push([P[e][0] + (nor[e][0] * Math.cos(th) + tan[e][0] * Math.sin(th)) * re, P[e][1] + (nor[e][1] * Math.cos(th) + tan[e][1] * Math.sin(th)) * re]); }
  for (let i = n - 1; i >= 0; i--) poly.push(Rp[i]);
  for (let k = 1; k <= 3; k++) { const th = k * Math.PI / 4; poly.push([P[0][0] - (nor[0][0] * Math.cos(th) + tan[0][0] * Math.sin(th)) * rs, P[0][1] - (nor[0][1] * Math.cos(th) + tan[0][1] * Math.sin(th)) * rs]); }
  return polyPath(orient(poly, 1));
}

// stroke: a brush line through pts. o: a (entry ramp), b (exit taper), s0/s1 (width at the ends, 0..1),
// gap [t0,t1] (dry-brush break), wob (hand wobble)
function S(pts, w = W, o = {}) {
  const { a = 0.12, b = 0.5, s0 = 0.6, s1 = 0.12, gap = null, wob = 1 } = o;
  const P = resample(catmull(pts, 10), 0.95), n = P.length;
  const ph = R() * TAU, ph2 = R() * TAU, ph3 = R() * TAU;
  const wd = [], C = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const f0 = a > 0 ? s0 + (1 - s0) * smooth(t / a) : 1, f1 = b > 0 ? s1 + (1 - s1) * smooth((1 - t) / b) : 1;
    wd.push(w * f0 * f1 * (1 + 0.1 * wob * Math.sin(TAU * (t * 1.5) + ph)));
    const p = P[i], q = P[Math.min(n - 1, i + 1)], r = P[Math.max(0, i - 1)];
    let tx = q[0] - r[0], ty = q[1] - r[1]; const l = Math.hypot(tx, ty) || 1;
    const off = 0.1 * wob * Math.sin(TAU * (t * 2.3) + ph2) * Math.sin(Math.PI * t + 0.1);
    C.push([p[0] - ty / l * off, p[1] + tx / l * off]);
  }
  if (!gap) return ribbon(C, wd);
  const g0 = Math.round(gap[0] * (n - 1)), g1 = Math.round(gap[1] * (n - 1)), k = Math.max(2, Math.round(n * 0.1));
  const w1 = wd.slice(0, g0 + 1).map((v, i, arr) => v * (0.3 + 0.7 * smooth((arr.length - 1 - i) / k)));
  const w2 = wd.slice(g1).map((v, i) => v * (0.3 + 0.7 * smooth(i / k)));
  return ribbon(C.slice(0, g0 + 1), w1) + ribbon(C.slice(g1), w2);
}

// dashed brush line (short tapered dabs along a curve)
function dashed(pts, on, off, w = W, o = {}) {
  const P = resample(catmull(pts, 10), 0.6), ds = 0.6, out = [];
  let i = 0;
  while (i < P.length - 3) {
    const j = Math.min(P.length - 1, i + Math.round(on / ds));
    if (j - i >= 3) {
      const seg = P.slice(i, j + 1), m = seg.length, wd = seg.map((_, q) => { const t = q / (m - 1); return w * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1))) * (o.fall ? (1 - 0.25 * t) : 1); });
      out.push(ribbon(seg, wd));
    }
    i = j + Math.round(off / ds);
  }
  return out.join('');
}

// dot: a slightly irregular ink blob
function D(x, y, r = 1.7) {
  const ph = R() * TAU, sq = 0.92 + R() * 0.16, rot = R() * TAU, P = [];
  for (let k = 0; k < 12; k++) {
    const t = k / 12 * TAU, rr = r * (1 + 0.07 * Math.sin(t * 2 + ph) + 0.04 * Math.sin(t * 3 + ph * 2));
    const px = Math.cos(t) * rr, py = Math.sin(t) * rr * sq;
    P.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)]);
  }
  return polyPath(orient(P, 1));
}

// filled mass through control points (closed, smooth). o: j (edge unevenness), tight (no smoothing, points are a dense outline)
function blob(pts, sign, o = {}) {
  const { j = 0.18, tight = false } = o;
  let P = tight ? pts : resample(catmull(pts, 8, true).concat([pts[0]]), 0.9);
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
  const ph = R() * TAU, ph2 = R() * TAU;
  if (j > 0) P = P.map((p, i) => { const t = i / P.length, dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1, e = j * (Math.sin(TAU * t * 3 + ph) * 0.6 + Math.sin(TAU * t * 7 + ph2) * 0.4); return [p[0] + dx / l * e, p[1] + dy / l * e]; });
  return polyPath(orient(P, sign));
}
const F = (pts, o) => blob(pts, 1, o);
const Hh = (pts, o) => blob(pts, -1, Object.assign({ j: 0.06 }, o));      // hole (paper shows through)

// rounded rectangle outline points (clockwise from top-left), dense
function rr(x, y, w, h, r) {
  const P = [];
  const arc = (cx, cy, a0) => { for (let k = 0; k <= 3; k++) { const a = (a0 + k * 30) * Math.PI / 180; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(x + r, y + r, 180); arc(x + w - r, y + r, 270); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, 90);
  return P;
}
// arc points (degrees, 0 = right, clockwise on screen, -90 = up)
function A(cx, cy, r, a0, a1, n = 6) { const P = []; for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return P; }
// rotate points about (cx, cy)
function rot(P, deg, cx, cy) { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return P.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); }

// ----------------------------------------------------------------------------------------------
// the icons
// ----------------------------------------------------------------------------------------------
const DEFS = {
  // ----- categories -----
  temple() {   // pagoda: three tiers of upturned eaves on slim bodies, a spire
    const o = [S([[16, 7.4], [16, 1.4]], TH, { a: 0.2, b: 0.45, s0: 0.5, s1: 0.1 })];
    [[9.4, 5.6], [16.6, 8.2], [23.8, 11.4]].forEach(([y, h], k) => {
      o.push(S([[16 - h, y - 2.4], [16 - h * 0.6, y + 0.5], [16, y + 1], [16 + h * 0.6, y + 0.5], [16 + h, y - 2.4]], W + 0.2, { a: 0.35, b: 0.35, s0: 0.12, s1: 0.12 }));
      const bw = [2.6, 5.4, 8.2][k];
      o.push(S([[16 - bw, y + 2.4], [16 - bw, y + 4.4]], W - 0.5, { a: 0.1, b: 0.1, s0: 0.8, s1: 0.8, wob: 0.2 }));
      o.push(S([[16 + bw, y + 2.4], [16 + bw, y + 4.4]], W - 0.5, { a: 0.1, b: 0.1, s0: 0.8, s1: 0.8, wob: 0.2 }));
      if (k === 0) o.push(S([[16, y + 2.2], [16, y + 4.4]], W - 0.5, { a: 0.1, b: 0.1, s0: 0.8, s1: 0.8, wob: 0.2 }));
    });
    o.push(S([[3.2, 29.2], [16, 29.5], [28.8, 29.2]], W - 0.3, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.2 }));
    return o;
  },
  shrine() {   // torii gate
    return [
      S([[1.6, 6.4], [7, 8.9], [16, 9.7], [25, 8.9], [30.4, 6.4]], HV, { a: 0.25, b: 0.3, s0: 0.15, s1: 0.15 }),
      S([[4.5, 12.6], [16, 12.9], [27.5, 12.6]], TH, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.25 }),
      S([[8.7, 10.4], [8.1, 20], [7.6, 28.6]], W + 0.3, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      S([[23.3, 10.4], [23.9, 20], [24.4, 28.6]], W + 0.3, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      S([[5.6, 17.2], [16, 17.6], [26.4, 17.2]], W, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.3, gap: [0.46, 0.5] }),
      S([[16, 13.4], [16, 17]], TH, { a: 0.1, b: 0.1, s0: 0.8, s1: 0.8, wob: 0.3 }),
    ];
  },
  ryokan() {   // inn: gabled roof with upturned eaves, hanging lantern, noren curtain
    return [
      S([[1.6, 14.8], [8, 11.4], [16, 6.2], [24, 11.4], [30.4, 14.8]], HV, { a: 0.25, b: 0.25, s0: 0.15, s1: 0.15 }),
      S([[5, 16.6], [5, 22], [5.2, 28.4]], W - 0.2, { a: 0.1, b: 0.35, s0: 0.8, s1: 0.4 }),
      S([[27, 16.6], [27, 22], [26.8, 28.4]], W - 0.2, { a: 0.1, b: 0.35, s0: 0.8, s1: 0.4 }),
      S([[11, 15.6], [11, 17.8]], TH - 0.4, { a: 0.1, b: 0.1, s0: 0.8, s1: 0.8, wob: 0.2 }),
      F([[11, 17.6], [13.8, 19.4], [14, 22.6], [11.2, 25.4], [8.2, 22.6], [8.2, 19.4]], { j: 0.1 }),
      F([[17.4, 16.4], [24.4, 16.4], [24.4, 24.6], [17.4, 24.6]], { j: 0.1 }),
      Hh([[20.2, 20.2], [21.6, 20.2], [21.6, 25], [20.2, 25]], { j: 0.02, tight: true }),
      S([[2.8, 29.2], [16, 29.5], [29.2, 29.2]], W - 0.3, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.2, gap: [0.2, 0.24] }),
    ];
  },
  garden() {   // pine over a stone and a water line
    return [
      S([[13.4, 27.6], [14.6, 21], [12.6, 15], [15.4, 9.4]], W + 0.7, { a: 0.1, b: 0.3, s0: 0.9, s1: 0.4 }),
      S([[7.6, 7.2], [13, 4.6], [20, 4.6], [26, 7.4]], HV, { a: 0.25, b: 0.25, s0: 0.2, s1: 0.15 }),
      S([[2.4, 15.4], [7, 12.8], [12.8, 13.2]], HV - 0.2, { a: 0.25, b: 0.3, s0: 0.2, s1: 0.2 }),
      S([[15.8, 18.4], [20.4, 15.2], [26.4, 15.6], [29.8, 18]], HV - 0.2, { a: 0.25, b: 0.25, s0: 0.2, s1: 0.2 }),
      S([[3, 28.6], [8, 27.8], [13, 29]], W - 0.4, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.2 }),
      S([[18, 29.6], [24, 28.8], [29.4, 29.6]], W - 0.6, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.2 }),
      F([[19.6, 27.4], [22.2, 25.8], [25.6, 26.2], [26.4, 28], [23.6, 28.8], [20.2, 28.6]], { j: 0.2 }),
    ];
  },
  architecture() {   // modern massing: a slender slit-windowed tower, a cantilevered slab, low blocks
    const slit = (x, y0, y1) => Hh(rr(x, y0, 1.4, y1 - y0, 0.5), { tight: true, j: 0.02 });
    const box = (x, y, w, h) => F(rr(x, y, w, h, 0.7), { tight: true, j: 0.1 });
    return [
      box(9.6, 6.6, 9.6, 22.2),
      S([[5.6, 5.4], [14, 5.2], [23.6, 4.8]], W - 0.1, { a: 0.1, b: 0.3, s0: 0.5, s1: 0.15 }),
      slit(11.6, 10.4, 25.6), slit(14.6, 10.4, 25.6),
      box(20.6, 14.4, 8.8, 14.4),
      slit(22.6, 18, 25.6), slit(25.8, 18, 25.6),
      box(2.6, 19.8, 5.4, 9),
      S([[1.6, 30.2], [16, 30.4], [30.4, 30.1]], W - 0.8, { a: 0.2, b: 0.3, s0: 0.3, s1: 0.2 }),
    ];
  },
  onsen() {    // hot spring: three steam wisps over a bowl of water
    return [
      S([[9, 17], [6.9, 13.4], [10.8, 9.8], [8.4, 5.2]], W - 0.2, { a: 0.1, b: 0.5, s0: 0.7, s1: 0.1 }),
      S([[16, 17], [13.6, 12.6], [18.4, 8.4], [15.8, 2.6]], W - 0.2, { a: 0.1, b: 0.5, s0: 0.7, s1: 0.1 }),
      S([[23, 17], [20.9, 13.4], [24.8, 9.8], [22.4, 5.2]], W - 0.2, { a: 0.1, b: 0.5, s0: 0.7, s1: 0.1 }),
      S([[2.8, 21.4], [10, 22.4], [18, 21.2], [29.2, 21.8]], W, { a: 0.1, b: 0.3, s0: 0.5, s1: 0.2 }),
      S([[5, 25], [9, 28.4], [16, 29.4], [23, 28.4], [27, 25]], HV - 0.4, { a: 0.2, b: 0.2, s0: 0.2, s1: 0.2 }),
    ];
  },
  technology() {   // robot head
    const head = rr(6.4, 10.6, 19.2, 15.6, 3.6).concat([[11, 10.8]]);
    return [
      S(head, W, { a: 0.04, b: 0.06, s0: 0.9, s1: 0.5, wob: 0.5 }),
      S([[16, 10.4], [16, 5.6]], TH, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      D(16, 4.1, 1.9),
      S([[3.4, 15], [3.3, 20.4]], W, { a: 0.1, b: 0.2, s0: 0.8, s1: 0.5, wob: 0.2 }),
      S([[28.6, 15], [28.7, 20.4]], W, { a: 0.1, b: 0.2, s0: 0.8, s1: 0.5, wob: 0.2 }),
      D(12, 16.6, 2.1), D(20, 16.6, 2.1),
      S([[11.4, 21.8], [16, 22.4], [20.6, 21.8]], TH, { a: 0.2, b: 0.2, s0: 0.5, s1: 0.5, wob: 0.3 }),
    ];
  },
  art() {      // brush over an ink stone
    return [
      S([[27, 2.6], [19, 12], [14, 17.4]], W + 0.2, { a: 0.08, b: 0.25, s0: 0.55, s1: 0.8 }),
      F([[13.4, 15.8], [16.4, 18.2], [14.4, 22.4], [10, 24.8], [8.6, 24], [10.4, 19.4]], { j: 0.12 }),
      S([[3.4, 27.4], [11, 28.8], [20, 28.4], [29, 26.4]], W, { a: 0.1, b: 0.35, s0: 0.2, s1: 0.1, gap: [0.5, 0.55] }),
      S([[17, 22.4], [20.6, 24.4], [25.6, 22.8]], W - 0.2, { a: 0.2, b: 0.25, s0: 0.3, s1: 0.3 }),
    ];
  },

  // ----- layers and controls -----
  route() {    // dashed winding path between two dots
    return [
      D(6, 25.6, 2.9), D(26, 6.4, 2.9),
      dashed([[9.2, 25.4], [14, 27.4], [21, 24.4], [22.4, 19], [14, 15.6], [11, 11], [17, 7.2], [22.6, 6.8]], 2.6, 2.1, W - 0.1),
    ];
  },
  mist() {     // three drifting cloud wisps
    return [
      S([[4, 10.6], [9, 8.6], [15, 10.2], [21.4, 8.8], [26, 10.6], [27.4, 13]], W, { a: 0.1, b: 0.35, s0: 0.3, s1: 0.2, gap: [0.42, 0.47] }),
      S([[6, 17], [12, 15.4], [18, 17.2], [25, 15.8], [29.2, 17.4]], W, { a: 0.15, b: 0.4, s0: 0.3, s1: 0.1 }),
      S([[3, 24], [8, 22.4], [14, 24.2], [21, 22.8], [24.6, 24.4], [23.8, 26.6]], W, { a: 0.12, b: 0.35, s0: 0.3, s1: 0.2, gap: [0.6, 0.65] }),
    ];
  },
  camera() {   // film camera: two reels, body, lens
    return [
      S(A(10.6, 7.4, 3.6, 120, 470, 9), W - 0.5, { a: 0.05, b: 0.05, s0: 0.5, s1: 0.4, wob: 0.3 }),
      S(A(19.4, 7.4, 3.6, 40, 390, 9), W - 0.5, { a: 0.05, b: 0.05, s0: 0.5, s1: 0.4, wob: 0.3 }),
      F(rr(3, 12.4, 18, 14, 2.6), { tight: true, j: 0.14 }),
      Hh(A(12, 19.4, 3.6, 0, 360, 10)),
      F([[22, 17.2], [29.4, 13.6], [29.4, 24.8], [22, 21.2]], { j: 0.12 }),
    ];
  },
  sound() {    // speaker with sound waves
    return [
      F([[3.4, 12.6], [8.4, 12.2], [14.6, 6.6], [15.6, 7.2], [15.6, 25], [14.6, 25.6], [8.4, 20], [3.4, 19.6]], { j: 0.12 }),
      S(A(15.6, 16, 5.8, -48, 48, 5), W, { a: 0.2, b: 0.3, s0: 0.25, s1: 0.25 }),
      S(A(15.6, 16, 10.6, -52, 52, 6), W, { a: 0.2, b: 0.3, s0: 0.25, s1: 0.25, gap: [0.46, 0.52] }),
    ];
  },
  overview() { // open folding fan
    const o = [];
    const cx = 16, cy = 27.4;
    o.push(S(A(cx, cy, 19, -142, -38, 10), W + 0.4, { a: 0.1, b: 0.1, s0: 0.35, s1: 0.35 }));
    o.push(S(A(cx, cy, 7.6, -134, -46, 8), W - 0.7, { a: 0.1, b: 0.1, s0: 0.35, s1: 0.35 }));
    [-52, -26, 0, 26, 52].forEach((d) => {
      const a = (-90 + d) * Math.PI / 180;
      o.push(S([[cx + Math.cos(a) * 6.5, cy + Math.sin(a) * 6.5], [cx + Math.cos(a) * 18.4, cy + Math.sin(a) * 18.4]], TH - 0.2, { a: 0.05, b: 0.3, s0: 0.9, s1: 0.4, wob: 0.3 }));
    });
    o.push(S([[cx, cy + 1.8], [cx, cy - 6]], W, { a: 0.1, b: 0.2, s0: 0.7, s1: 0.5 }));
    return o;
  },
  play() {
    return [F([[8.6, 4.6], [26.4, 15.6], [26.4, 16.6], [8.6, 27.6], [7.6, 26.8], [7.6, 5.4]], { j: 0.14 })];
  },
  pause() {
    return [
      S([[10.6, 5.6], [10.9, 16], [10.6, 26.4]], 4.6, { a: 0.08, b: 0.12, s0: 0.6, s1: 0.5, wob: 0.4 }),
      S([[21.4, 5.6], [21.1, 16], [21.4, 26.4]], 4.6, { a: 0.08, b: 0.12, s0: 0.6, s1: 0.5, wob: 0.4 }),
    ];
  },
  person() {   // head and shoulders
    return [
      F(A(16, 9.4, 5, 0, 360, 10), { j: 0.12 }),
      F([[4.6, 28.2], [5.2, 22.6], [9.6, 18.4], [16, 17.2], [22.4, 18.4], [26.8, 22.6], [27.4, 28.2], [16, 28.8]], { j: 0.14 }),
    ];
  },

  // ----- travel modes -----
  shinkansen() {   // bullet train, side view, long nose to the left
    return [
      F([[1.8, 21.8], [5.6, 17.6], [11.4, 13.2], [18, 11.4], [29.4, 11.2], [30.2, 12.4], [30.2, 22.6], [29.4, 23.8], [4, 23.8], [2.2, 23]], { j: 0.1 }),
      Hh([[9.6, 18.8], [13, 15.2], [16.6, 14.4], [16.6, 18.8]], { j: 0.04 }),
      ...[19.4, 23.4, 27.4].map((x) => Hh(rr(x - 1.4, 14.4, 2.8, 4.4, 0.9), { tight: true, j: 0.03 })),
      S([[6, 21.2], [18, 21], [28.4, 21.2]], 1.2, { a: 0.1, b: 0.1, s0: 0.6, s1: 0.6, wob: 0 }),
      S([[2.6, 28.2], [16, 28.5], [29.6, 28.2]], W - 0.4, { a: 0.1, b: 0.25, s0: 0.3, s1: 0.2, gap: [0.3, 0.34] }),
    ];
  },
  local() {    // tram / local train, front view
    return [
      S([[4.4, 3.6], [16, 3.2], [27.6, 3.6]], TH - 0.3, { a: 0.1, b: 0.2, s0: 0.4, s1: 0.3 }),
      S([[11.6, 8.2], [16, 4], [20.4, 8.2]], TH - 0.2, { a: 0.2, b: 0.2, s0: 0.5, s1: 0.5, wob: 0.3 }),
      F(rr(6.6, 8, 18.8, 17.6, 3.6), { tight: true, j: 0.12 }),
      Hh(rr(9.6, 10.8, 12.8, 7, 1.6), { tight: true }),
      Hh(A(11.6, 21.8, 1.5, 0, 360, 8)), Hh(A(20.4, 21.8, 1.5, 0, 360, 8)),
      S([[7.4, 28.8], [9.4, 26.8]], W - 0.5, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4, wob: 0.2 }),
      S([[24.6, 28.8], [22.6, 26.8]], W - 0.5, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4, wob: 0.2 }),
    ];
  },
  walk() {     // walking figure with a staff
    return [
      D(16.8, 5.6, 2.8),
      S([[16.6, 10.2], [15.4, 14.6], [14.4, 18.4]], HV - 0.4, { a: 0.1, b: 0.2, s0: 0.8, s1: 0.7 }),
      S([[14.4, 18.4], [18.6, 22.4], [19.4, 28.6]], W, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      S([[14.4, 18.4], [10.6, 23], [6.6, 27.4]], W, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      S([[16.2, 11.6], [20.6, 14.6], [23.6, 17.6]], W - 0.3, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      S([[15.8, 11.8], [11.8, 14], [9.8, 18]], W - 0.3, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4 }),
      S([[25.2, 12.6], [26.6, 20], [27.6, 28.6]], TH - 0.3, { a: 0.1, b: 0.4, s0: 0.7, s1: 0.3, wob: 0.3 }),
    ];
  },
  bus() {      // bus, side view
    return [
      F(rr(2.4, 6.6, 27.2, 17.6, 3.4), { tight: true, j: 0.12 }),
      ...[5.6, 11.4, 17.2].map((x) => Hh(rr(x, 9.6, 4.6, 5.2, 1), { tight: true, j: 0.03 })),
      Hh(rr(23.4, 9.6, 3.6, 10.4, 1), { tight: true, j: 0.03 }),
      D(9.2, 25, 3.2), D(22.6, 25, 3.2),
      Hh(A(9.2, 25, 1, 0, 360, 6)), Hh(A(22.6, 25, 1, 0, 360, 6)),
    ];
  },
  boat() {     // sailing ship, pennant on the mast (the Lake Ashi boat is a pirate ship)
    return [
      S([[16.6, 20.6], [16.6, 11], [16.6, 2.8]], TH - 0.3, { a: 0.1, b: 0.3, s0: 0.8, s1: 0.4, wob: 0.2 }),
      F([[17.6, 2.4], [24.4, 3.6], [17.6, 5.2]], { j: 0.04 }),
      F([[9.8, 7], [16, 6.2], [22.6, 7], [22.2, 13.4], [16.2, 14.4], [10.4, 13.4]], { j: 0.12 }),
      F([[8.2, 15.6], [15.4, 14.8], [15.2, 19.6], [4.4, 19.6]], { j: 0.1 }),
      F([[2.8, 21.2], [29.4, 21.2], [30.2, 18.6], [30.2, 21.4], [25.6, 27], [8, 27]], { j: 0.12 }),
      S([[3, 30], [8, 29.2], [13, 30.2], [18, 29.2], [23, 30.2], [28.6, 29.4]], TH - 0.1, { a: 0.1, b: 0.3, s0: 0.3, s1: 0.2 }),
    ];
  },
  ropeway() {  // gondola cabin hanging from a cable
    return [
      S([[1.6, 4.2], [16, 8.4], [30.4, 12.8]], TH, { a: 0.05, b: 0.1, s0: 0.5, s1: 0.4, wob: 0.4 }),
      D(16, 8.6, 2),
      S([[16, 9.6], [16, 13.8]], TH - 0.1, { a: 0.1, b: 0.1, s0: 0.8, s1: 0.8, wob: 0.2 }),
      F(rr(7.4, 13.6, 17.2, 13, 3.2), { tight: true, j: 0.12 }),
      Hh(rr(10, 16.4, 5, 4.4, 1), { tight: true, j: 0.03 }), Hh(rr(17, 16.4, 5, 4.4, 1), { tight: true, j: 0.03 }),
    ];
  },
  funicular() {  // cable car on a slope
    const ang = -32;
    const body = rot(rr(7, 8.8, 18, 11, 2.8), ang, 16, 16);
    const w1 = rot(rr(9.6, 11.2, 5.4, 4.4, 0.9), ang, 16, 16), w2 = rot(rr(17.2, 11.2, 5.4, 4.4, 0.9), ang, 16, 16);
    return [
      S([[1.6, 29], [16, 21.4], [30.4, 13.2]], W, { a: 0.05, b: 0.1, s0: 0.5, s1: 0.4, wob: 0.4 }),
      F(body, { tight: true, j: 0.12 }), Hh(w1, { tight: true, j: 0.03 }), Hh(w2, { tight: true, j: 0.03 }),
      S([[24.6, 5.8], [30.2, 2.6]], TH - 0.3, { a: 0.1, b: 0.3, s0: 0.7, s1: 0.3 }),
    ];
  },
  stay() {     // pillow under a crescent moon: the night's rest
    return [
      S(A(19, 9.4, 5.6, 35, 325, 12), 4.6, { a: 0.45, b: 0.45, s0: 0.12, s1: 0.12, wob: 0.5 }),
      D(7.6, 9.4, 1.2),
      F([[3.4, 19.8], [10, 18.6], [16, 18.9], [22, 18.6], [28.6, 19.8], [27.2, 23.2], [28.4, 27.2], [22, 28.2], [16, 28.5], [10, 28.2], [3.6, 27.2], [4.8, 23.2]], { j: 0.12 }),
      Hh([[9.6, 23.2], [16, 22.6], [22.4, 23.2], [16, 24.2]], { j: 0.02 }),
    ];
  },

  // ----- bottom bar and the 3D stamp -----
  cube() {     // isometric cube: six outer edges and the three that meet at the near corner
    const e = (p, q, w = W) => S([p, q], w, { a: 0.12, b: 0.2, s0: 0.8, s1: 0.6, wob: 0.3 });
    return [
      e([16, 2.9], [27.4, 9.4]), e([27.4, 9.4], [27.4, 22.6]), e([27.4, 22.6], [16, 29.1]),
      e([16, 29.1], [4.6, 22.6]), e([4.6, 22.6], [4.6, 9.4]), e([4.6, 9.4], [16, 2.9]),
      e([4.8, 9.5], [16, 16], W - 0.4), e([27.2, 9.5], [16, 16], W - 0.4), e([16, 16], [16, 28.7], W - 0.4),
    ];
  },
  regions() {  // a round crest: brush ring with a break, a mountain, a small sun
    return [
      S(A(16, 16, 12.8, -108, 238, 18), W, { a: 0.06, b: 0.12, s0: 0.9, s1: 0.25, wob: 0.5 }),
      S([[7.8, 22.6], [12.6, 18.4], [14.8, 12.2], [17.2, 12.2], [19.4, 18.4], [24.2, 22.6]], W - 0.1, { a: 0.1, b: 0.15, s0: 0.5, s1: 0.3 }),
      D(22.6, 9.6, 1.3),
    ];
  },
  layers() {   // three stacked sheets: a rounded diamond on two chevrons
    const v = (y, w = W) => S([[3.6, y], [16, y + 6.2], [28.4, y]], w, { a: 0.12, b: 0.12, s0: 0.5, s1: 0.5 });
    return [
      S([[3.6, 9.6], [16, 3.4], [28.4, 9.6]], W, { a: 0.12, b: 0.12, s0: 0.5, s1: 0.5 }),
      v(9.6), v(15.6, W - 0.2), v(21.4, W - 0.2),
    ];
  },
  list() {     // three rows: a dot and a brush line each (the trip list)
    const row = (y, x1) => [D(6.6, y, 1.7), S([[11.4, y], [x1, y]], W, { a: 0.15, b: 0.2, s0: 0.5, s1: 0.4 })];
    return [...row(8.4, 26.4), ...row(16, 24), ...row(23.6, 21.2)];
  },
  filters() {  // a stamp square with three narrowing marks
    return [
      S(rr(4.4, 4.4, 23.2, 23.2, 3.4).concat([[10, 4.6]]), W - 0.2, { a: 0.04, b: 0.06, s0: 0.9, s1: 0.4, wob: 0.4 }),
      S([[9.4, 11.4], [22.6, 11.4]], W, { a: 0.15, b: 0.2, s0: 0.5, s1: 0.4 }),
      S([[11.8, 16.2], [20.2, 16.2]], W, { a: 0.15, b: 0.2, s0: 0.5, s1: 0.4 }),
      S([[14.2, 21], [17.8, 21]], W, { a: 0.15, b: 0.2, s0: 0.5, s1: 0.4 }),
    ];
  },
};

export const ICON_NAMES = Object.keys(DEFS);

// build once: name -> path data string
export const ICON_PATHS = {};
for (const name of ICON_NAMES) {
  R = rng(hashStr(name) ^ 0x9e3779b9);
  ICON_PATHS[name] = DEFS[name]().join('');
}

// ----------------------------------------------------------------------------------------------
// optional painted art (transparent PNGs)
// ----------------------------------------------------------------------------------------------
export const ICON_ART = {};
const ART_TINT = new Set();
const artImgs = new Map();           // url -> { img, ok }
const artWatchers = [];
function artFor(name) {
  const url = ICON_ART[name];
  if (!url) return null;
  let e = artImgs.get(url);
  if (!e && typeof Image !== 'undefined') {
    const img = new Image(); e = { img, ok: false }; artImgs.set(url, e);
    img.onload = () => { e.ok = true; artWatchers.forEach((f) => { try { f(name); } catch (err) { /* ignore */ } }); };
    img.src = url;
  }
  return e || null;
}
export function setIconArt(name, url, tint = false) {
  if (url) { ICON_ART[name] = url; tint ? ART_TINT.add(name) : ART_TINT.delete(name); artFor(name); }
  else { delete ICON_ART[name]; ART_TINT.delete(name); }
}
// call cb(name) whenever a painted icon finishes loading (so a canvas can repaint)
export function onIconArtLoad(cb) { artWatchers.push(cb); }

// ----------------------------------------------------------------------------------------------
// output: SVG markup
// ----------------------------------------------------------------------------------------------
export function iconSVG(name, { size = 24, title = '' } = {}) {
  const lab = title ? ` role="img" aria-label="${esc(title)}"` : ' aria-hidden="true" focusable="false"';
  const ttl = title ? `<title>${esc(title)}</title>` : '';
  if (ICON_ART[name]) {
    const url = ICON_ART[name]; artFor(name);
    if (ART_TINT.has(name)) return `<span class="icon-art" style="display:inline-block;width:${size}px;height:${size}px;background:currentColor;-webkit-mask:url(${esc(url)}) center/contain no-repeat;mask:url(${esc(url)}) center/contain no-repeat"${title ? ` role="img" aria-label="${esc(title)}"` : ' aria-hidden="true"'}></span>`;
    return `<img class="icon-art" src="${esc(url)}" width="${size}" height="${size}" alt="${esc(title)}"${title ? '' : ' aria-hidden="true"'} draggable="false">`;
  }
  const d = ICON_PATHS[name];
  const inner = d ? `<path d="${d}"/>` : '<circle cx="16" cy="16" r="3"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" fill="currentColor"${lab}>${ttl}${inner}</svg>`;
}

// ----------------------------------------------------------------------------------------------
// output: canvas
// ----------------------------------------------------------------------------------------------
const path2d = {};
export function drawIcon(ctx, name, cx, cy, size, color) {
  const e = ICON_ART[name] ? artFor(name) : null;
  if (e && e.ok) {
    if (ART_TINT.has(name)) {
      const t = document.createElement('canvas'); t.width = t.height = Math.max(2, Math.round(size * (ctx.getTransform ? Math.max(1, ctx.getTransform().a) : 1)));
      const c = t.getContext('2d'); c.drawImage(e.img, 0, 0, t.width, t.height); c.globalCompositeOperation = 'source-in'; c.fillStyle = color; c.fillRect(0, 0, t.width, t.height);
      ctx.drawImage(t, cx - size / 2, cy - size / 2, size, size);
    } else ctx.drawImage(e.img, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  const d = ICON_PATHS[name];
  ctx.save();
  ctx.fillStyle = color;
  if (!d || typeof Path2D === 'undefined') { ctx.beginPath(); ctx.arc(cx, cy, size * 0.09, 0, TAU); ctx.fill(); ctx.restore(); return; }
  const p = path2d[name] || (path2d[name] = new Path2D(d));
  ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 32, size / 32);
  ctx.fill(p, 'nonzero');
  ctx.restore();
}

// ----------------------------------------------------------------------------------------------
// output: a whole hanko stamp (inline SVG)
// ----------------------------------------------------------------------------------------------
// same squircle-with-wobble as roughPath() in js/pins.js, as SVG path data in a 32 x 32 box
function roughStamp(rand, half, wobble) {
  const N = 90, ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28], P = [];
  for (let k = 0; k < N; k++) {
    const t = k / N * TAU, c = Math.cos(t), s = Math.sin(t), e = 2 / 5.5;
    let x = Math.sign(c) * Math.pow(Math.abs(c), e), y = Math.sign(s) * Math.pow(Math.abs(s), e);
    const w = 1 + wobble * (0.55 * Math.sin(t * 3 + ph[0]) + 0.3 * Math.sin(t * 7 + ph[1]) + 0.25 * Math.sin(t * 13 + ph[2]) + (rand() - 0.5) * 0.5);
    P.push([16 + x * half * w, 16 + y * half * w]);
  }
  return polyPath(P);
}

let stampN = 0;
export function stampSVG(name, { size = 36, solid = true, seed = 1 } = {}) {
  const rand = rng(hashStr(name) + seed * 7919 + (solid ? 1 : 7));
  const id = `jst${seed}x${++stampN}`;
  const half = 14.6, wob = 0.022;
  const body = roughStamp(rand, half, wob);
  const inner = roughStamp(rand, half * 0.86, wob * 0.8);
  // worn-ink flecks and edge nicks, cut out with a mask so the stamp works on any background
  let cuts = '';
  for (let i = 0; i < 34; i++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * half * 1.02, rad = 0.12 + rand() * rand() * 0.75;
    cuts += `<circle cx="${num(16 + Math.cos(a) * r)}" cy="${num(16 + Math.sin(a) * r)}" r="${num(rad)}" fill-opacity="${num(0.3 + rand() * 0.6)}"/>`;
  }
  for (let i = 0; i < 9; i++) {
    const a = rand() * TAU, r = half * (0.93 + rand() * 0.1);
    cuts += `<ellipse cx="${num(16 + Math.cos(a) * r)}" cy="${num(16 + Math.sin(a) * r)}" rx="${num(0.3 + rand() * 0.7)}" ry="${num(0.25 + rand() * 0.5)}" transform="rotate(${num(rand() * 170)} ${num(16 + Math.cos(a) * r)} ${num(16 + Math.sin(a) * r)})" fill-opacity="${num(0.5 + rand() * 0.5)}"/>`;
  }
  const tilt = (rand() - 0.5) * 3, scale = 0.66;
  const d = ICON_PATHS[name];
  const glyph = d ? `<path d="${d}"/>` : '<circle cx="16" cy="16" r="3"/>';
  const g = `<g transform="translate(16 16) rotate(${num(tilt)}) scale(${scale}) translate(-16 -16)">${glyph}</g>`;
  const art = ICON_ART[name];
  const face = art
    ? `<image href="${esc(art)}" x="${num(16 - 16 * scale)}" y="${num(16 - 16 * scale)}" width="${num(32 * scale)}" height="${num(32 * scale)}"/>`
    : g;
  const mask = `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><g fill="#000">${cuts}</g></mask>`;
  const lab = ' aria-hidden="true" focusable="false"';
  if (solid) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"${lab}><defs>${mask}</defs><g mask="url(#${id})"><path d="${body}" fill="${VERM}"/><path d="${inner}" fill="none" stroke="${PAPER}" stroke-opacity="0.5" stroke-width="0.55"/><g fill="${PAPER}">${face}</g></g></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"${lab}><defs>${mask}</defs><g mask="url(#${id})"><path d="${body}" fill="${PAPER}" fill-opacity="0.38" stroke="${VERM}" stroke-width="1.5" stroke-linejoin="round"/><g fill="${VERM}">${face}</g></g></svg>`;
}
