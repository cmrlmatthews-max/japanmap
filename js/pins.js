// Seal pins: hanko-style sprites on the map, their HTML labels, and tap picking.
import * as THREE from 'three';
import { drawIcon } from './icons.js';

// en = singular word for the card and the itinerary; label = plural word on the category filter; kanji is kept as data only (no longer rendered)
export const CATS = {
  temple:       { kanji: '寺', en: 'Temple',       label: 'Temples' },
  shrine:       { kanji: '社', en: 'Shrine',       label: 'Shrines' },
  ryokan:       { kanji: '宿', en: 'Inn',          label: 'Inns' },
  garden:       { kanji: '庭', en: 'Garden',       label: 'Gardens' },
  architecture: { kanji: '建', en: 'Architecture', label: 'Buildings' },
  onsen:        { kanji: '湯', en: 'Hot spring',   label: 'Hot springs' },
  technology:   { kanji: '技', en: 'Technology',   label: 'Tech' },
  art:          { kanji: '芸', en: 'Art',          label: 'Art' },
};
export const CAT_ORDER = ['temple', 'shrine', 'ryokan', 'garden', 'architecture', 'onsen', 'technology', 'art'];

const VERM = '#C8341E', PAPER = '#F5EFE0';
export const PIN_PX = 30;                // on-screen seal size, CSS px
const STEM_PX = 12;                      // ink stem length, CSS px
const PICK_PX = 24;

// distance (camera to target) thresholds, world units
export const FADE = { pinsFull: 190, pinsGone: 290, labelsFull: 125, labelsGone: 170, regionsFrom: 240, regionsFull: 330 };

const smooth = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- seal textures (drawn live) ----------
// the seals hold drawn icons now; only the label font needs to be ready before the labels are measured
export async function loadSealFonts() {
  const timeout = new Promise(res => setTimeout(res, 3000));
  try {
    await Promise.race([Promise.all([
      document.fonts.load("500 12px 'Shippori Mincho'", 'Senso-ji Kiyomizu'),
    ]), timeout]);
  } catch (e) { /* fall back to serif */ }
}

// a slightly irregular rounded square (squircle with wobble), like a stamp pressed by hand
function roughPath(ctx, cx, cy, half, rand, wobble) {
  const N = 140, ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  ctx.beginPath();
  for (let k = 0; k <= N; k++) {
    const t = k / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const e = 2 / 5.5;                                           // squircle exponent
    let x = Math.sign(c) * Math.pow(Math.abs(c), e), y = Math.sign(s) * Math.pow(Math.abs(s), e);
    const w = 1 + wobble * (0.55 * Math.sin(t * 3 + ph[0]) + 0.3 * Math.sin(t * 7 + ph[1]) + 0.25 * Math.sin(t * 13 + ph[2]) + (rand() - 0.5) * 0.5);
    x = cx + x * half * w; y = cy + y * half * w;
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

export function drawSeal(cat, solid, seed, size = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), rand = rng(seed), c = size / 2, half = size * 0.43;
  const wob = 0.022;
  // the category pictogram, pressed into the stamp with a tiny hand-set offset
  const placeIcon = (color, px) => {
    ctx.save();
    ctx.translate((rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2);
    drawIcon(ctx, cat, c, c, px, color);
    ctx.restore();
  };
  if (solid) {
    ctx.fillStyle = VERM; roughPath(ctx, c, c, half, rand, wob); ctx.fill();
    // inner hairline border, as on many hanko
    ctx.strokeStyle = PAPER; ctx.globalAlpha = 0.55; ctx.lineWidth = 2.2;
    roughPath(ctx, c, c, half * 0.86, rand, wob * 0.8); ctx.stroke(); ctx.globalAlpha = 1;
    placeIcon(PAPER, size * 0.56);
  } else {
    ctx.fillStyle = 'rgba(245,239,224,0.38)'; roughPath(ctx, c, c, half, rand, wob); ctx.fill();   // thin wash so the icon reads over dark ground
    ctx.strokeStyle = VERM; ctx.lineWidth = size * 0.055; ctx.lineJoin = 'round';
    roughPath(ctx, c, c, half - size * 0.03, rand, wob); ctx.stroke();
    placeIcon(VERM, size * 0.56);
  }
  // worn-ink texture: tiny flecks, a few nicks on the edge, slight mottling
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 150; i++) {
    const a = rand() * 6.283, r = Math.sqrt(rand()) * half * 1.02;
    ctx.globalAlpha = 0.25 + rand() * 0.6; ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 0.35 + rand() * rand() * 1.9, 0, 6.283); ctx.fill();
  }
  for (let i = 0; i < 14; i++) {
    const a = rand() * 6.283, r = half * (0.93 + rand() * 0.1);
    ctx.globalAlpha = 0.5 + rand() * 0.5; ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 1 + rand() * 2.6, 0.8 + rand() * 1.8, rand() * 3, 0, 6.283); ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.06; ctx.beginPath();
    ctx.arc(c + (rand() - 0.5) * half * 1.6, c + (rand() - 0.5) * half * 1.6, 6 + rand() * 12, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return cv;
}

// ---------- screen-space label helpers ----------
export const overlaps = (a, b, pad = 3) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

// ---------- the pin layer ----------
export class Pins {
  /**
   * opts: { scene, camera, canvas, labelHost, places, lonLatToWorld, heightAtWorld, view }
   * view (optional): the app's view object { blend, wpp(dist) }. blend 0 = perspective, 1 = flat orthographic map, between = the 2D/3D flight.
   */
  constructor(opts) {
    Object.assign(this, { scene: opts.scene, camera: opts.camera, canvas: opts.canvas, host: opts.labelHost, heightAt: opts.heightAtWorld, view: opts.view || null });
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.textures = {};
    this.choices = {};
    this.enabled = new Set(CAT_ORDER);
    this.selectedId = null;
    this.tripSet = null;
    this.pins = [];
    this.byId = new Map();
    this.labelRatio = 0;
    const ink = new THREE.Color('#2C2C2A');
    for (const cat of CAT_ORDER) for (const solid of [true, false]) {
      const t = new THREE.CanvasTexture(drawSeal(cat, solid, hashStr(cat) + (solid ? 1 : 7)));
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      this.textures[cat + (solid ? ':s' : ':o')] = t;
    }
    for (const p of opts.places) {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !CATS[p.category]) continue;
      const w = opts.lonLatToWorld(p.lng, p.lat);
      const ground = this.heightAt(w.x, w.z);
      const mat = new THREE.SpriteMaterial({ map: this.textures[p.category + ':o'], transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, opacity: 0 });
      const rr = rng(hashStr(p.id)); mat.rotation = (rr() - 0.5) * 0.07;
      const sprite = new THREE.Sprite(mat); sprite.renderOrder = 20; sprite.visible = false; sprite.userData.placeId = p.id;
      const lgeo = new THREE.BufferGeometry(); lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(lgeo, new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      line.renderOrder = 19; line.visible = false; line.frustumCulled = false;
      this.group.add(line, sprite);
      const el = document.createElement('div'); el.className = 'plabel';
      el.innerHTML = `<span class="n"></span>`;
      el.firstChild.textContent = p.short || p.name || p.id;      // English only, one line
      this.host.appendChild(el);
      const pin = { place: p, id: p.id, ground: new THREE.Vector3(w.x, ground, w.z), sprite, mat, line, el,
                    alpha: 0, pickable: false, sx: 0, sy: 0, lw: 0, lh: 0, pulse: -1, labelOn: false, scaleK: 1, state: 'o' };
      this.pins.push(pin); this.byId.set(p.id, pin);
    }
    this.setChoices({});
    const remeasure = () => this.pins.forEach(p => { p.lw = 0; });
    if (document.fonts) { document.fonts.ready.then(remeasure); document.fonts.addEventListener?.('loadingdone', remeasure); }
    this._v = new THREE.Vector3(); this._top = new THREE.Vector3(); this._fwd = new THREE.Vector3();
  }

  stateOf(pin) {
    const c = this.choices[pin.id]?.c;
    if (c === 'pass') return 'pass';
    if (c === 'add' || pin.place.status === 'core') return 's';
    return 'o';
  }
  setChoices(map) {
    this.choices = map || {};
    for (const pin of this.pins) {
      pin.state = this.stateOf(pin);
      pin.mat.map = this.textures[pin.place.category + (pin.state === 's' ? ':s' : ':o')];
      pin.mat.needsUpdate = true;
    }
  }
  setFilter(set) { this.enabled = new Set(set); }
  // the trip set: ids of the accepted places (plan stops after swaps, plus "Add to trip"). Only these show, and the open card's place. null = show all.
  setTripSet(set) { this.tripSet = set ? new Set(set) : null; }
  select(id) { this.selectedId = id; }
  pulse(id) { const p = this.byId.get(id); if (p) p.pulse = 0; }
  worldPos(id) { return this.byId.get(id)?.ground.clone(); }

  // Is the straight view line from the camera to this point blocked by terrain?
  _occluded(pt, heightAt) {
    const cam = this.camera.position, N = 14;
    for (let i = 1; i < N; i++) {
      const t = i / N, x = pt.x + (cam.x - pt.x) * t, z = pt.z + (cam.z - pt.z) * t;
      if (heightAt(x, z) > pt.y + (cam.y - pt.y) * t + 0.12) return true;
    }
    return false;
  }

  /** nearest pickable pin to (x,y) in CSS px, within PICK_PX */
  pick(x, y) {
    let best = null, bd = PICK_PX;
    for (const p of this.pins) {
      if (!p.pickable) continue;
      const d = Math.hypot(p.sx - x, p.sy - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.place : null;
  }

  /**
   * Per-frame update.
   * ctx: { dt, dist (camera to target), w, h (canvas CSS px), obstacles (rects to avoid) }
   */
  update(ctx) {
    const { dt, dist, w, h } = ctx, cam = this.camera;
    const distFade = 1 - smooth(FADE.pinsFull, FADE.pinsGone, dist);
    const labelFade = 1 - smooth(FADE.labelsFull, FADE.labelsGone, dist);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // Pure perspective: sizeAttenuation=false makes the scale a fraction of the view height. Once the projection is blended toward the flat map
    // (blend > 0) three's sprite shader stops multiplying by depth, so the scale is in world units: PIN_PX * (world units per CSS px at the pin).
    const view = this.view, bl = view ? view.blend : 0, flat = bl >= 1, blended = bl > 0;
    const spriteScale = PIN_PX * 2 * tanHalf / h;
    const wpp2d = flat ? view.wpp(dist) : 0;                           // 2D: the same everywhere
    const fwd = blended && !flat ? cam.getWorldDirection(this._fwd) : null;
    const anyOn = distFade > 0.002;
    const vis = [];
    for (const p of this.pins) {
      const on = this.enabled.has(p.place.category) && anyOn && (!this.tripSet || this.tripSet.has(p.id) || p.id === this.selectedId);
      let target = 0;
      if (on) {
        const dp = cam.position.distanceTo(p.ground);
        // world units per CSS px at this pin. Blend: the blended matrix's own scale at the pin's view depth ((1-k)*depth + k against (1-k)*dist + k),
        // equal to the perspective value at k = 0 and to the 2D value at k = 1, so a seal reads PIN_PX at every depth all the way through the flight.
        let wpp;
        if (flat) wpp = wpp2d;
        else if (blended) {
          const depth = Math.max(0.05, (p.ground.x - cam.position.x) * fwd.x + (p.ground.y - cam.position.y) * fwd.y + (p.ground.z - cam.position.z) * fwd.z);
          wpp = 2 * tanHalf * dist / h * ((1 - bl) * depth + bl) / ((1 - bl) * dist + bl);
        } else wpp = 2 * tanHalf * dp / h;
        const lift = (STEM_PX + PIN_PX / 2) * wpp;
        this._top.set(p.ground.x, p.ground.y + lift, p.ground.z);
        const occ = distFade > 0.05 && !flat ? this._occluded(this._top, this.heightAt) : false;   // nothing hides a pin on the flat map
        p.pickable = !occ && distFade > 0.4;
        target = (p.state === 'pass' ? 0.2 : 1) * distFade * (occ ? 0.12 : 1);
        p.top = p.top || new THREE.Vector3(); p.top.copy(this._top); p.wpp = wpp;
        // a pin under a fixed button, the masthead, a roller or the open card fades out (and cannot be picked through it)
        if (ctx.blockers && ctx.blockers.length) {
          this._v.copy(this._top).project(cam);
          const sx = (this._v.x * 0.5 + 0.5) * w, sy = (-this._v.y * 0.5 + 0.5) * h, half = PIN_PX / 2 - 2;
          const r = { x: sx - half, y: sy - half, w: half * 2, h: half * 2 };
          if (ctx.blockers.some(o => overlaps(r, o, 0))) { target = 0; p.pickable = false; }
        }
      } else p.pickable = false;
      const k = 1 - Math.exp(-dt * 7);
      p.alpha += (target - p.alpha) * k;
      if (Math.abs(target - p.alpha) < 0.004) p.alpha = target;
      const show = p.alpha > 0.01;
      p.sprite.visible = p.line.visible = show;
      if (!show) { p.pickable = false; this._label(p, false); continue; }
      p.mat.opacity = p.alpha; p.line.material.opacity = p.alpha * 0.8;
      // pulse / selected scale
      let sc = p.id === this.selectedId ? 1.18 : 1;
      if (p.pulse >= 0) { p.pulse += dt / 0.8; if (p.pulse >= 1) p.pulse = -1; else sc *= 1 + 0.5 * Math.sin(p.pulse * Math.PI); }
      const sz = (blended ? PIN_PX * p.wpp : spriteScale) * sc;
      p.sprite.scale.set(sz, sz, 1);
      p.sprite.position.copy(p.top);
      const a = p.line.geometry.attributes.position;
      a.setXYZ(0, p.ground.x, p.ground.y, p.ground.z); a.setXYZ(1, p.ground.x, p.ground.y + STEM_PX * p.wpp, p.ground.z); a.needsUpdate = true;
      // screen position of the seal centre
      this._v.copy(p.top).project(cam);
      p.sx = (this._v.x * 0.5 + 0.5) * w; p.sy = (-this._v.y * 0.5 + 0.5) * h; p.behind = this._v.z > 1;
      if (p.behind) { p.pickable = false; p.sprite.visible = p.line.visible = false; this._label(p, false); continue; }
      vis.push(p);
    }
    this._labels(vis, labelFade, ctx);
  }

  _label(p, on) {
    if (p.labelOn === on) return;
    p.labelOn = on; p.el.classList.toggle('show', on);
  }

  _labels(vis, labelFade, ctx) {
    const { w, h } = ctx;
    if (labelFade <= 0.02) { for (const p of vis) this._label(p, false); return; }
    const placed = [...(ctx.obstacles || [])];
    for (const p of vis) placed.push({ x: p.sx - PIN_PX / 2, y: p.sy - PIN_PX / 2, w: PIN_PX, h: PIN_PX, own: p });
    // priority: selected, then core, then the rest
    const order = vis.slice().sort((a, b) => (b.id === this.selectedId) - (a.id === this.selectedId) || (b.place.status === 'core') - (a.place.status === 'core') || (b.alpha - a.alpha));
    for (const p of order) {
      if (p.alpha < 0.5 || p.pickable === false && p.id !== this.selectedId) { this._label(p, false); continue; }
      if (!p.lw) { p.lw = p.el.offsetWidth; p.lh = p.el.offsetHeight; if (!p.lw) { continue; } }
      let x = p.sx + PIN_PX / 2 + 2, y = p.sy - p.lh / 2;
      if (x + p.lw > w - 6) x = p.sx - PIN_PX / 2 - 2 - p.lw;                // flip to the left side
      const r = { x, y, w: p.lw, h: p.lh };
      const inside = r.x > 4 && r.x + r.w < w - 4 && r.y > 4 && r.y + r.h < h - 4;
      let clash = !inside;
      if (!clash) for (const o of placed) { if (o.own === p) continue; if (overlaps(r, o)) { clash = true; break; } }
      if (clash && p.id !== this.selectedId) { this._label(p, false); continue; }
      placed.push(r);
      this._label(p, true);
      p.el.style.transform = `translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)`;
      p.el.style.setProperty('--o', String(Math.min(1, labelFade * p.alpha).toFixed(2)));
    }
  }
}
