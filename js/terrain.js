// One continuous world made of several Terrarium height files.
//
// World frame: Web Mercator global pixel coordinates at zoom 11 (256 px tiles), 10 px per world unit,
// origin = center of the base file. A file at zoom z maps file pixel (px,py) to z11 global px
// gx = (x0*256 + px) * 2^(11-z), gy = (y0*256 + py) * 2^(11-z).
// File format: uint32 LE header length + JSON header {z,x0,x1,y0,y1,w,h} + Int16 heights (meters), row-major.
//
// Seams: the base mesh (coarse) discards its fragments inside every patch rectangle (see ink-shader.js),
// and each patch blends its outer ring of vertices toward the base mesh height so the edges meet exactly.
import * as THREE from 'three';
import { makeInkMaterial } from './ink-shader.js';

export const PX_PER_UNIT = 10;
export const METERS_PER_UNIT = 764;
export const EXAGGERATION = 2.0;
const Z_WORLD = 11;

const BASE_HDR = { z: 9, x0: 448, x1: 455, y0: 201, y1: 203, w: 2048, h: 768 };
let ORIGIN = originOf(BASE_HDR);          // z11 global px of world (0,0)
const files = [];                          // loaded files, base first

function originOf(h) {
  const s = Math.pow(2, Z_WORLD - h.z);
  return { x: (h.x0 * 256 + h.w / 2) * s, y: (h.y0 * 256 + h.h / 2) * s };
}

// ---------- coordinate helpers (work globally, no file needed) ----------
export function lonLatToWorld(lon, lat, out = new THREE.Vector3()) {
  const n = Math.pow(2, Z_WORLD) * 256;
  const gx = (lon + 180) / 360 * n;
  const r = lat * Math.PI / 180;
  const gy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return out.set((gx - ORIGIN.x) / PX_PER_UNIT, 0, (gy - ORIGIN.y) / PX_PER_UNIT);
}
export function worldToLonLat(x, z) {
  const n = Math.pow(2, Z_WORLD) * 256;
  const gx = x * PX_PER_UNIT + ORIGIN.x, gy = z * PX_PER_UNIT + ORIGIN.y;
  const lon = gx / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / n))) * 180 / Math.PI;
  return { lon, lat };
}
export const metersToUnits = (m) => m / METERS_PER_UNIT * EXAGGERATION;

// ---------- file loading ----------
export async function loadFile(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const len = new DataView(buf).getUint32(0, true);
    const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
    const data = new Int16Array(buf.slice(4 + len));
    if (data.length < hdr.w * hdr.h) return null;
    cleanSea(data, hdr.w, hdr.h, hdr.z);
    return makeFile(url, hdr, data);
  } catch (e) { console.warn('[terrain] skipped', url, e.message); return null; }
}

// The elevation data is noisy at sea level: reclaimed land and river beds read as 0 or below, so the
// coast turns into a swarm of ink fragments. Fill small "sea" pockets surrounded by land and drop tiny islets
// surrounded by sea. Components that touch the file edge are always kept (they may continue outside the file).
function cleanSea(data, W, H, z) {
  const scale = Math.pow(4, 11 - z);                  // z11 pixel counts, scaled to this file's pixel area
  const minWater = Math.max(4, Math.round(900 / scale)), minLand = Math.max(3, Math.round(250 / scale));
  const N = W * H, lab = new Uint8Array(N), q = new Int32Array(N);
  openWater(data, W, H, z >= 11 ? 2 : 1);
  for (const pass of [0, 1]) {                         // pass 0: water pockets -> land, pass 1: islets -> sea
    lab.fill(0);
    for (let s = 0; s < N; s++) {
      if (lab[s]) continue;
      const water = data[s] <= 0;
      let head = 0, tail = 0, edge = false; q[tail++] = s; lab[s] = 1;
      while (head < tail) {
        const p = q[head++], x = p % W, y = (p - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        if (x > 0)     { const n = p - 1; if (!lab[n] && (data[n] <= 0) === water) { lab[n] = 1; q[tail++] = n; } }
        if (x < W - 1) { const n = p + 1; if (!lab[n] && (data[n] <= 0) === water) { lab[n] = 1; q[tail++] = n; } }
        if (y > 0)     { const n = p - W; if (!lab[n] && (data[n] <= 0) === water) { lab[n] = 1; q[tail++] = n; } }
        if (y < H - 1) { const n = p + W; if (!lab[n] && (data[n] <= 0) === water) { lab[n] = 1; q[tail++] = n; } }
      }
      if (edge) continue;
      if (pass === 0 && water && tail < minWater) for (let i = 0; i < tail; i++) data[q[i]] = 1;
      if (pass === 1 && !water && tail < minLand) for (let i = 0; i < tail; i++) data[q[i]] = 0;
    }
  }
}

// morphological opening of the water mask: rivers and canals narrower than 2r+1 px turn into land
function openWater(data, W, H, r) {
  const wm = new Uint8Array(W * H), tmp = new Uint8Array(W * H), core = new Uint8Array(W * H);
  for (let i = 0; i < wm.length; i++) wm[i] = data[i] <= 0 ? 1 : 0;
  const pass = (src, dst, horizontal, wantAll) => {      // box min (erode) or box max (dilate) with window 2r+1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = wantAll ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const xx = horizontal ? Math.min(W - 1, Math.max(0, x + k)) : x, yy = horizontal ? y : Math.min(H - 1, Math.max(0, y + k));
        const a = src[yy * W + xx];
        if (wantAll) { if (!a) { v = 0; break; } } else if (a) { v = 1; break; }
      }
      dst[y * W + x] = v;
    }
  };
  pass(wm, tmp, true, true); pass(tmp, core, false, true);        // erode
  pass(core, tmp, true, false); pass(tmp, core, false, false);    // dilate
  for (let i = 0; i < wm.length; i++) if (wm[i] && !core[i]) data[i] = 1;
}

function makeFile(name, hdr, data) {
  const s = Math.pow(2, Z_WORLD - hdr.z);
  const wx = (px) => ((hdr.x0 * 256 + px) * s - ORIGIN.x) / PX_PER_UNIT;   // continuous file px -> world x
  const wz = (py) => ((hdr.y0 * 256 + py) * s - ORIGIN.y) / PX_PER_UNIT;
  return { name, hdr, data, s, W: hdr.w, H: hdr.h, wx, wz,
           rect: { x0: wx(0), z0: wz(0), x1: wx(hdr.w), z1: wz(hdr.h) }, mesh: null };
}

// bilinear sample of raw heights (meters, sea clamped to 0) at world x,z
function sampleFile(f, x, z) {
  const px = (x * PX_PER_UNIT + ORIGIN.x) / f.s - f.hdr.x0 * 256 - 0.5;
  const py = (z * PX_PER_UNIT + ORIGIN.y) / f.s - f.hdr.y0 * 256 - 0.5;
  const fx = Math.min(f.W - 1, Math.max(0, px)), fy = Math.min(f.H - 1, Math.max(0, py));
  const ix = Math.min(f.W - 2, Math.floor(fx)), iy = Math.min(f.H - 2, Math.floor(fy));
  const tx = fx - ix, ty = fy - iy, d = f.data, W = f.W;
  const a = Math.max(0, d[iy * W + ix]), b = Math.max(0, d[iy * W + ix + 1]);
  const c = Math.max(0, d[(iy + 1) * W + ix]), e = Math.max(0, d[(iy + 1) * W + ix + 1]);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}
const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function heightMetersAtWorld(x, z) {
  for (let i = files.length - 1; i >= 1; i--) if (inRect(files[i].rect, x, z)) return sampleFile(files[i], x, z);
  const b = files[0];
  return b && inRect(b.rect, x, z) ? sampleFile(b, x, z) : 0;
}
// world-unit height (what the mesh uses) of the best file at x,z
export function heightAtWorld(x, z) { return metersToUnits(heightMetersAtWorld(x, z)); }

// ---------- meshes ----------
function gridFor(f, isBase) {
  if (isBase) return [512, 192];
  return f.W >= f.H ? [256, Math.max(2, Math.round(256 * f.H / f.W))] : [Math.max(2, Math.round(256 * f.W / f.H)), 256];
}

function buildGeometry(f, gx, gy, blendFn) {
  const { W, H, data } = f;
  const n = gx * gy;
  const pos = new Float32Array(n * 3), hts = new Float32Array(n);
  const step = W / (gx - 1), r = Math.max(1, Math.floor(step / 2));
  for (let j = 0; j < gy; j++) {
    const cy = j / (gy - 1) * H, py = Math.min(H - 1, Math.max(0, Math.round(cy - 0.5)));
    for (let i = 0; i < gx; i++) {
      const cx = i / (gx - 1) * W, px = Math.min(W - 1, Math.max(0, Math.round(cx - 0.5)));
      let s = 0, c = 0;                                   // box filter keeps slopes calm
      for (let dy = -r; dy <= r; dy++) {
        const y = py + dy; if (y < 0 || y >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = px + dx; if (x < 0 || x >= W) continue;
          const v = data[y * W + x]; s += v > 0 ? v : 0; c++;
        }
      }
      let h = s / c;
      const x = f.wx(cx), z = f.wz(cy);
      if (blendFn) h = blendFn(h, x, z);
      const k = j * gx + i;
      hts[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = metersToUnits(h); pos[k * 3 + 2] = z;
    }
  }
  // same triangulation as THREE.PlaneGeometry (faces point up)
  const idx = new Uint32Array((gx - 1) * (gy - 1) * 6);
  let q = 0;
  for (let j = 0; j < gy - 1; j++) for (let i = 0; i < gx - 1; i++) {
    const a = j * gx + i, b = (j + 1) * gx + i, c = (j + 1) * gx + i + 1, d = j * gx + i + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('height', new THREE.BufferAttribute(hts, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, hts, gx, gy };
}

// exact height (meters) of the base MESH at x,z (triangle interpolation), used to blend patch borders
function baseMeshHeight(base, x, z) {
  const { rect } = base, { hts, gx, gy } = base.grid;
  const u = (x - rect.x0) / (rect.x1 - rect.x0) * (gx - 1), v = (z - rect.z0) / (rect.z1 - rect.z0) * (gy - 1);
  const fu = Math.min(gx - 1.0001, Math.max(0, u)), fv = Math.min(gy - 1.0001, Math.max(0, v));
  const i = Math.floor(fu), j = Math.floor(fv), fx = fu - i, fy = fv - j;
  const ha = hts[j * gx + i], hb = hts[(j + 1) * gx + i], hc = hts[(j + 1) * gx + i + 1], hd = hts[j * gx + i + 1];
  return fx + fy <= 1 ? ha + fx * (hd - ha) + fy * (hb - ha) : hc + (1 - fx) * (hb - hc) + (1 - fy) * (hd - hc);
}

// 8-bit raster of the land mask (1 = land), box-blurred so its 0.5 level is a smooth shoreline.
// The fragment shader draws the coast from it: crisp and round at any zoom, independent of the mesh resolution.
function coastTexture(f) {
  const { W, H } = f, r = f.hdr.z >= 11 ? 2 : 1;
  const a = new Float32Array(W * H), c = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = f.data[i] > 0 ? 1 : 0;
  const blur = (src, dst, horizontal) => {
    const len = horizontal ? W : H, lines = horizontal ? H : W, win = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const at = (k) => { k = k < 0 ? 0 : k >= len ? len - 1 : k; return src[horizontal ? l * W + k : k * W + l]; };
      let sum = 0; for (let k = -r; k <= r; k++) sum += at(k);
      for (let k = 0; k < len; k++) { dst[horizontal ? l * W + k : k * W + l] = sum / win; sum += at(k + r + 1) - at(k - r); }
    }
  };
  blur(a, c, true); blur(c, a, false);
  const d = new Uint8Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = Math.round(a[i] * 255);
  const t = new THREE.DataTexture(d, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

const smooth = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Loads base + patches and returns the world.
 * Missing patch files are skipped. Returns { group, files, rects, bounds, materials, worldSize }.
 */
export async function loadWorld({ baseUrl, patchUrls = [], washiTex }) {
  const base = await loadFile(baseUrl);
  if (!base) throw new Error('base terrain missing: ' + baseUrl);
  ORIGIN = originOf(base.hdr);
  Object.assign(base, makeFile(baseUrl, base.hdr, base.data));   // recompute rects with the real origin
  files.length = 0; files.push(base);
  const patches = (await Promise.all(patchUrls.map(loadFile))).filter(Boolean);
  for (const p of patches) { Object.assign(p, makeFile(p.name, p.hdr, p.data)); files.push(p); }

  const group = new THREE.Group();
  const rects = patches.map(p => p.rect);

  // base
  const [bgx, bgy] = gridFor(base, true);
  base.grid = buildGeometry(base, bgx, bgy, null);
  const bounds = base.rect;
  const baseMat = makeInkMaterial(washiTex, { base: true, bounds, rects, coastTex: coastTexture(base), coastRect: base.rect });
  const baseMesh = new THREE.Mesh(base.grid.geo, baseMat);
  baseMesh.renderOrder = 0; baseMesh.frustumCulled = false; baseMesh.name = 'base';
  group.add(baseMesh); base.mesh = baseMesh;

  // patches: no edge fade (they never fade at their own edges); one material each because each has its own coast raster
  const patchMats = [];
  for (const p of patches) {
    const [gx, gy] = gridFor(p, false);
    const ring = 0.08 * Math.min(p.rect.x1 - p.rect.x0, p.rect.z1 - p.rect.z0);
    const blend = (h, x, z) => {
      const d = Math.min(x - p.rect.x0, p.rect.x1 - x, z - p.rect.z0, p.rect.z1 - z);
      const w = 1 - smooth(0, ring, d);
      return w > 0 ? h + (baseMeshHeight(base, x, z) - h) * w : h;
    };
    p.grid = buildGeometry(p, gx, gy, blend);
    const pm = makeInkMaterial(washiTex, { base: false, coastTex: coastTexture(p), coastRect: p.rect }); patchMats.push(pm);
    const m = new THREE.Mesh(p.grid.geo, pm);
    m.renderOrder = 1; m.frustumCulled = false; m.name = 'patch:' + p.name;
    group.add(m); p.mesh = m;
  }
  const materials = [baseMat, ...patchMats];
  console.log('[terrain] base', bgx + 'x' + bgy, 'patches', patches.map(p => p.name.split('/').pop()).join(', ') || '(none)',
    'world', (bounds.x1 - bounds.x0).toFixed(0) + 'x' + (bounds.z1 - bounds.z0).toFixed(0));
  return { group, files, rects, bounds, materials };
}
