// Phase 3: itinerary drawer (a washi page) and the fly-through player.
// The drawer lists the days, stops and legs. The player plays the whole trip as a slow flight: a hop along each leg, then a pause at each stop.
// Layout (see css/trip.css): bottom sheet on iPhone portrait and iPad portrait; docked on the right on iPad landscape and iPhone landscape.
import { DOCK_MQ } from './ui.js';
import { CATS } from './pins.js';
import { iconSVG } from './icons.js';
import { loadItinerary } from './itinerary.js';
import { linesKey } from './legend.js';

const PLAY_SPEED = 1.5;                             // playback speed (1 = the original pace; 1.5 = 50% faster)
const PAUSE_S = 3 / PLAY_SPEED;                     // seconds held at each stop
const STOP_DIST = 34, STOP_DIST_2D = 40, STOP_POLAR = 45;      // the stop pose: same distance as a place fly-to (the flat map sits a little farther)
const VIEW = { polar: 52, az: 22 };                 // the region view angle (day framing)
const LS_KEY = 'jmap.trip.v1';

// mode words: the English word and a short help line for the tooltip (the mark itself is a drawn icon)
const MODES = {
  shinkansen: { en: 'Bullet train', tip: 'Shinkansen, the fast long-distance train' },
  local:      { en: 'Train',        tip: 'A local or regional train' },
  walk:       { en: 'Walk',         tip: 'On foot' },
  bus:        { en: 'Bus',          tip: 'By bus' },
  boat:       { en: 'Boat',         tip: 'By boat' },
  ropeway:    { en: 'Ropeway',      tip: 'A mountain gondola' },
  funicular:  { en: 'Cable car',    tip: 'A cable car on a steep track' },
};
const stripJa = (t) => String(t || '').replace(/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s·•:—–-]+|[\s·•:—–-]+$/g, '').trim();
const TIP_PLAY = 'Play the trip', TIP_PAUSE = 'Pause';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // same curve as the app's flights
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };

function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const SVG = {
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2L14 12.2H2z" fill="currentColor"/></svg>',
  right: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5L12 8 5 13.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function initTrip(ctx, route) {
  const { THREE, camera, controls, canvas, scrollEl, state, ui, Store, placeById, REGION_INFO } = ctx;
  const drawer = document.getElementById('drawer'), player = document.getElementById('player');
  if (!drawer || !player) return { update() {}, refresh() {}, play() {}, pause() {}, seek() {}, setDay() {}, progress() { return null; }, progressPoint() { return null; }, get cursor() { return false; }, get playing() { return false; }, get time() { return 0; }, get duration() { return 0; } };
  const bodyEl = document.body;
  const dockMQ = matchMedia(DOCK_MQ), landPhoneMQ = matchMedia('(max-height: 520px) and (orientation: landscape)');
  const docked = () => dockMQ.matches;
  const regionEn = (r) => REGION_INFO?.[r]?.en || cap(r);

  // ---------- state ----------
  let itin = null, days = [], segs = [], dayStart = [], duration = 0;
  let activeDay = 0, time = 0, playing = false, dragging = null, entered = -1, hopCtx = null, lastNow = 0;
  let maxStep = 0.25, cursorOn = false, nowStop = null, routeDay = null, open = false, lastCard = false, loadToken = 0, capText = '';
  const stopCache = new Map(), pathCache = new Map();

  // ---------- saved: active day per person ----------
  const loadSaved = () => safe(() => { const j = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return j && typeof j === 'object' ? j : {}; }, {});
  const saveDay = (i) => safe(() => { const j = loadSaved(); const w = Store.who || 'cade'; j[w] = { ...(j[w] || {}), day: i }; localStorage.setItem(LS_KEY, JSON.stringify(j)); });

  // ---------- world helpers ----------
  const placeOf = (id) => placeById.get(id) || null;
  function stopWorld(id) {
    if (stopCache.has(id)) return stopCache.get(id).clone();
    let v = safe(() => route && route.stopWorld && route.stopWorld(id), null);
    if (!(v && Number.isFinite(v.x) && Number.isFinite(v.z))) {
      const p = placeOf(id);
      v = p ? ctx.groundTarget(p.lng, p.lat) : new THREE.Vector3();
    }
    stopCache.set(id, v.clone());
    return v;
  }
  const rectNow = () => safe(() => ctx.freeRect(false), null) || { x0: 0, y0: 0, x1: canvas.clientWidth, y1: canvas.clientHeight };
  const azNow = () => deg(Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z));
  const is2d = () => !!(ctx.view && ctx.view.is2d()), modeNow = () => ctx.view ? ctx.view.mode : '3d';
  const stopDist = () => is2d() ? STOP_DIST_2D : STOP_DIST;
  const stopPose = (id, az) => ctx.aimPose(stopWorld(id), ctx.sph(stopDist(), STOP_POLAR, az), ctx.rectCentre(rectNow()));

  // ---------- timeline ----------
  function legIndex(d, k) { return d === 0 ? k - 1 : k; }                // the leg that arrives at stop k of day d
  function hopSeconds(d, li, leg) {
    const L = safe(() => route.legLength(d, li), NaN);
    if (Number.isFinite(L)) return (6 + 2 * clamp((L - 2) / 60, 0, 1)) / PLAY_SPEED;
    const m = leg && Number.isFinite(leg.minutes) ? leg.minutes : 30;
    return (m <= 20 ? 6 : m >= 90 ? 8 : 6 + 2 * (m - 20) / 70) / PLAY_SPEED;
  }
  function buildTimeline() {
    segs = []; dayStart = []; let t = 0, prevId = null;
    days.forEach((day, d) => {
      dayStart[d] = t;
      (day.stops || []).forEach((id, k) => {
        const li = legIndex(d, k), leg = (day.legs || [])[li] || null;
        if (prevId) { const dur = hopSeconds(d, li, leg); segs.push({ type: 'hop', d, k, li, id, from: prevId, leg, t0: t, t1: t + dur }); t += dur; }
        segs.push({ type: 'pause', d, k, li: prevId ? li : -1, id, t0: t, t1: t + PAUSE_S }); t += PAUSE_S;
        prevId = id;
      });
    });
    duration = t;
  }
  function segAt(t) {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].t0 <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  const pauseSeg = (d, k) => segs.find((s) => s.type === 'pause' && s.d === d && s.k === k);

  // ---------- route layer calls (defensive: the layer may be a stub) ----------
  const R = {
    day(i) { if (routeDay === i) return; routeDay = i; safe(() => route.setActiveDay(i)); },
    prog(d, li, t) { if (li == null || li < 0) safe(() => route.setProgress(d, 0, 0)); else safe(() => route.setProgress(d, li, t)); },   // no hop yet (first stop): nothing drawn
    clear() { safe(() => route.setProgress(null)); },
  };
  function legPath(d, li, seg) {
    const key = d + ':' + li + ':' + seg.id;
    if (pathCache.has(key)) return pathCache.get(key);
    let pts = safe(() => route.legPath(d, li), null);
    if (!Array.isArray(pts) || pts.length < 2) pts = [stopWorld(seg.from), stopWorld(seg.id)];       // straight fallback
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const out = { pts, cum, len: cum[cum.length - 1] || 1e-6 };
    pathCache.set(key, out); return out;
  }
  function sample(p, f, out) {
    const s = clamp(f, 0, 1) * p.len; let lo = 0, hi = p.cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (p.cum[m] <= s) lo = m; else hi = m; }
    const span = p.cum[hi] - p.cum[lo] || 1e-6;
    return out.copy(p.pts[lo]).lerp(p.pts[hi], clamp((s - p.cum[lo]) / span, 0, 1));
  }

  // ---------- the hop: the camera glides along the leg ----------
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function captureHop(seg, k0) {
    controls.enableDamping = false; controls.update(); controls.enableDamping = true;      // flush drag momentum
    const T = controls.target.clone(), off = camera.position.clone().sub(T), sp = new THREE.Spherical().setFromVector3(off);
    const az = deg(Math.atan2(off.x, off.z));
    const path = legPath(seg.d, seg.li, seg), endPose = stopPose(seg.id, az);
    const e0 = ease(k0), P0 = sample(path, e0, new THREE.Vector3()), P1 = sample(path, 1, new THREE.Vector3());
    const lift = clamp(0.35 * path.len, 3, 80);               // a calm rise: longer legs lift higher
    return { segIdx: entered, mode: modeNow(), path, az, endPose, e0, k0, lift, r_c: sp.radius, phi_c: deg(sp.phi), d_c: T.clone().sub(P0), d1: endPose.target.clone().sub(P1), cut: false };
  }
  function applyHop(c, k) {
    const e = ease(k), u = (1 - c.e0) < 1e-6 ? 1 : clamp((e - c.e0) / (1 - c.e0), 0, 1);
    sample(c.path, e, _a);
    const target = _a.add(_b.copy(c.d_c).lerp(c.d1, u));
    if (is2d()) target.y = 0;                                                  // the flat map keeps its look-at point on the ground plane
    const r = lerp(c.r_c - c.lift * Math.sin(Math.PI * c.k0), stopDist(), u) + c.lift * Math.sin(Math.PI * k);   // (2D: the lift is a zoom out and in)
    const phi = lerp(c.phi_c, STOP_POLAR, u);
    controls.target.copy(target);
    camera.position.copy(target).add(ctx.sph(r, phi, c.az));
    camera.lookAt(target);
  }
  function snapTo(pose) { controls.target.copy(pose.target); camera.position.copy(pose.target).add(pose.offset); camera.lookAt(pose.target); }
  function drive(seg, k) {
    if (!state.cameraMoves) {                                                    // Still camera: one cut per hop, no motion
      if (!hopCtx || hopCtx.segIdx !== entered || !hopCtx.cut) {                  // (also when Still camera is switched on in the middle of a hop)
        hopCtx = { segIdx: entered, cut: true, endPose: stopPose(seg.id, azNow()) };
        ctx.cutToPose(hopCtx.endPose); R.prog(seg.d, seg.li, 1);
      }
      return;
    }
    if (ctx.isFlying()) return;                                                  // an app flight (place fly-to, day framing) owns the camera
    if (!hopCtx || hopCtx.segIdx !== entered || hopCtx.cut || hopCtx.mode !== modeNow()) hopCtx = captureHop(seg, k);      // (also after a 2D/3D switch: the old capture is for the other projection)
    controls.enabled = false;
    applyHop(hopCtx, k);
    R.prog(seg.d, seg.li, ease(k));
  }

  // ---------- entering a segment ----------
  function enter(idx, fresh) {
    const prevIdx = entered, seg = segs[idx];
    entered = idx; cursorOn = true;
    R.day(seg.d); showDay(seg.d);
    if (seg.type === 'hop') { hopCtx = null; setNow(null); return; }
    // a pause at a stop
    const c = hopCtx && !hopCtx.cut && hopCtx.mode !== modeNow() ? null : hopCtx;               // a capture made in the other mode (2D / 3D) is stale
    if (c && c.segIdx === prevIdx && !c.cut) { if (state.cameraMoves) snapTo(c.endPose); else ctx.cutToPose(c.endPose); }   // the hop ends exactly on the stop pose
    else if (!c && time - seg.t0 < 0.5) ensurePose(seg);                                      // arrived by a jump or by the first play: fly to the stop
    hopCtx = null;
    if (!ctx.isFlying()) controls.enabled = true;
    R.prog(seg.d, seg.li, seg.li < 0 ? 0 : 1);
    setNow(seg);
    regionFollow(seg);
    safe(() => window.__map.pins.pulse(seg.id));
  }
  function regionFollow(seg) { const r = placeOf(seg.id)?.region || days[seg.d].region; safe(() => { ui.setActiveRegion(r); state.region = r; }); }
  function ensurePose(seg) {
    const pose = stopPose(seg.id, azNow());
    const far = controls.target.distanceTo(pose.target) > 0.6 || Math.abs(camera.position.distanceTo(controls.target) - stopDist()) > 0.6;
    if (far) ctx.flyToPose(pose, 2.0, { arc: 0.2 });
  }

  // ---------- play, pause, seek ----------
  const playBtn = h('button', 'pl-play'); playBtn.type = 'button'; playBtn.innerHTML = iconSVG('play', { size: 22 }) + iconSVG('pause', { size: 22 });
  function setPlayUi() {
    playBtn.classList.toggle('playing', playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playBtn.dataset.tip = playing ? TIP_PAUSE : TIP_PLAY;
    bodyEl.classList.toggle('trip-playing', playing);
  }
  function play() {
    if (!segs.length || playing) return;
    if (time >= duration - 0.05) { time = 0; entered = -1; }
    playing = true; lastNow = 0; hopCtx = null; cursorOn = true;
    const idx = segAt(time);
    if (idx !== entered) enter(idx, false);
    setPlayUi(); paint(true);
  }
  function pause() {
    if (!playing) return;
    playing = false; lastNow = 0; hopCtx = null;
    if (!ctx.isFlying()) controls.enabled = true;
    setPlayUi(); paint(true);
  }
  function finish() {
    playing = false; lastNow = 0; hopCtx = null; time = duration; entered = -1; cursorOn = false; setNow(null);
    R.clear(); routeDay = null; safe(() => route.setActiveDay(null));
    if (!ctx.isFlying()) controls.enabled = true;
    safe(() => { ui.setActiveRegion('overview'); state.region = 'overview'; });
    ctx.flyToPose(ctx.regionPose('overview'), 3.5, { arc: 0.3 });                // show the whole trip
    setPlayUi(); paint(true);
  }
  // move the cursor to the stop at or after time t, put the camera there, make its day active
  function commitSeek(t, camera_ = true) {
    if (!segs.length) return;
    t = clamp(t, 0, duration);
    let idx = segAt(t); if (segs[idx].type === 'hop') idx++;
    const seg = segs[idx]; if (!seg) return;
    time = seg.t0; entered = idx; cursorOn = true; hopCtx = null; lastNow = 0;
    R.day(seg.d); showDay(seg.d); R.prog(seg.d, seg.li, seg.li < 0 ? 0 : 1);
    setNow(seg);
    regionFollow(seg);
    if (camera_) ctx.flyToPose(stopPose(seg.id, azNow()), 2.0, { arc: 0.2 });          // cuts by itself when the camera is still
    paint(true);
  }
  // while dragging the thumb: update the ink and the caption only; the camera stays put
  function scrubTo(t) {
    time = clamp(t, 0, duration);
    const seg = segs[segAt(time)]; if (!seg) return;
    R.day(seg.d); showDay(seg.d);
    if (seg.type === 'hop') R.prog(seg.d, seg.li, ease(clamp((time - seg.t0) / (seg.t1 - seg.t0), 0, 1)));
    else R.prog(seg.d, seg.li, seg.li < 0 ? 0 : 1);
    cursorOn = true; paint(true);
  }

  // ---------- drawer: build ----------
  drawer.innerHTML = '';
  const sheet = h('div', 'd-sheet'), full = h('div', 'd-full');
  const top = h('div', 'd-top'), titleEl = h('div', 'd-title');
  const tk = h('span', 'dt-k'), tt = h('span', 'dt-t', 'Itinerary'), tp = h('span', 'dt-p'), tn = h('span', 'dt-n');
  tk.innerHTML = iconSVG('route', { size: 16 });
  titleEl.append(tk, tt, tp, tn);
  const foldBtn = h('button', 'd-fold'); foldBtn.type = 'button'; foldBtn.innerHTML = SVG.right; foldBtn.setAttribute('aria-label', 'Fold away the itinerary'); foldBtn.dataset.tip = 'Fold away · Hide the itinerary';
  top.append(titleEl, foldBtn);
  const tabsEl = h('div', 'd-tabs'); tabsEl.setAttribute('role', 'tablist');
  const bodyBox = h('div', 'd-body');
  const dayBox = h('div', 'd-day'), list = h('ol', 'd-stops');
  bodyBox.append(dayBox, list);
  full.append(top, tabsEl, linesKey(), bodyBox);
  const spine = h('button', 'd-spine'); spine.type = 'button'; spine.setAttribute('aria-label', 'Open the itinerary');
  const spN = h('span', 'sp-n'), spK = h('span', 'sp-k'), spC = h('span', 'sp-c'); spC.innerHTML = SVG.right;
  spine.append(spC, spN, spK);
  sheet.append(full, spine); drawer.append(sheet);

  // ---------- player: build (flat children: play, caption, scrub) ----------
  player.innerHTML = '';
  const capEl = h('div', 'pl-cap'), chev = h('span', 'pl-chev'); chev.innerHTML = SVG.up;
  const capTxt = h('span', 'pl-txt'); capEl.append(chev, capTxt);
  const scrub = h('div', 'pl-scrub'); scrub.setAttribute('role', 'slider'); scrub.setAttribute('aria-label', 'Trip position'); scrub.tabIndex = 0;
  const track = h('div', 'pl-track'), line = h('i', 'pl-line'), fill = h('i', 'pl-fill'), ticks = h('div', 'pl-ticks'), thumb = h('b', 'pl-thumb');
  track.append(line, fill, ticks, thumb); scrub.append(track);
  const row = h('div', 'pl-row'); row.append(playBtn, capEl, scrub); player.append(row);
  setPlayUi();

  // ---------- drawer: render ----------
  const dayTip = (n) => { const t = dayName(days[n - 1] || {}).en; return t ? `Day ${n} · ${t}` : `Day ${n}`; };
  function tabsBuild() {
    tabsEl.innerHTML = '';
    days.forEach((day, i) => {
      const b = h('button', 'dtab'); b.type = 'button'; b.dataset.day = i; b.setAttribute('role', 'tab');
      b.dataset.tip = dayTip(i + 1); b.setAttribute('aria-label', `Day ${i + 1}`);
      b.append(h('span', null, String(i + 1)));
      b.addEventListener('click', () => setDay(i));
      tabsEl.append(b);
    });
  }
  function ticksBuild() {
    ticks.innerHTML = '';
    if (!duration) return;
    days.forEach((day, i) => {
      const a = dayStart[i] / duration, b = (i + 1 < days.length ? dayStart[i + 1] : duration) / duration;
      const t = h('i', 'pl-tick'); t.style.left = (a * 100) + '%';
      const l = h('span', 'pl-dn', String(i + 1)); l.style.left = ((a + b) / 2 * 100) + '%';
      ticks.append(t, l);
    });
  }
  // the day name: the English title only (any Japanese in the data is dropped)
  function dayName(day) { return { en: stripJa(day.title || '') }; }
  const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
  const lineName = (p) => {
    if (p.mode === 'shinkansen') return 'Shinkansen';
    if (p.line) return p.line.split('-').map((w) => /^jr$/i.test(w) ? 'JR' : cap(w)).join(' ');
    return MODES[p.mode]?.en || cap(p.mode);
  };
  function modeMark(mode) {
    const m = MODES[mode] || { en: cap(mode), tip: '' };
    const s = h('span', 'mark m-' + mode); s.innerHTML = iconSVG(mode, { size: 18 }); s.dataset.tip = m.tip ? `${m.en} · ${m.tip}` : m.en; return s;
  }
  function legRow(day, li, fromName) {
    const leg = (day.legs || [])[li]; if (!leg) return null;
    const m = MODES[leg.mode] || { en: cap(leg.mode) };
    const row = h('li', 'leg'); row.dataset.leg = li;
    const body = h('div', 'lbody');
    if (fromName) body.append(h('div', 'lfrom', 'from ' + fromName));
    const main = h('div', 'lmain'); main.append(modeMark(leg.mode), h('span', 'lm', `${m.en} · ${fmtMin(leg.minutes || 0)}`));
    body.append(main);
    const parts = (leg.parts || []).filter((p) => !(p.mode === 'walk' && p.minutes <= 5));
    if (parts.length > 1 || (parts.length === 1 && parts[0].mode !== leg.mode)) body.append(h('div', 'lparts', parts.map((p) => `${lineName(p)} ${p.minutes}`).join(' · ')));
    else if (leg.note) body.append(h('div', 'lparts', leg.note));
    row.append(body); return row;
  }
  function showDay(i) {
    if (!days[i]) return;
    if (dayBox.dataset.built !== String(i)) {
      activeDay = i; dayBox.dataset.built = String(i);
      const day = days[i];
      [...tabsEl.children].forEach((b, j) => { const on = j === i; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      const tb = tabsEl.children[i];
      if (tb) { const want = tb.offsetLeft - (tabsEl.clientWidth - tb.offsetWidth) / 2; tabsEl.scrollTo({ left: Math.max(0, want), behavior: state.cameraMoves ? 'smooth' : 'auto' }); }
      dayBox.innerHTML = '';
      const nm = dayName(day);
      dayBox.append(h('div', 'dd-day', `Day ${i + 1}`), h('div', 'dd-title', nm.en));
      dayBox.append(h('div', 'dd-meta', daySummary(i)));
      const stay = day.stay && placeOf(day.stay);
      if (stay) { const s = h('div', 'dd-stay'), sl = h('span', 'stay-seal'); sl.innerHTML = iconSVG('stay', { size: 14 }); s.append(sl, h('span', 'stay-t', `Stay · ${stay.short || stay.name}`)); dayBox.append(s); }
      list.innerHTML = '';
      (day.stops || []).forEach((id, k) => {
        const li = legIndex(i, k);
        const prevId = k > 0 ? day.stops[k - 1] : (i > 0 ? days[i - 1].stops[days[i - 1].stops.length - 1] : null);
        if (li >= 0) { const r = legRow(day, li, k === 0 && i > 0 ? placeOf(prevId)?.name || '' : ''); if (r) list.append(r); }
        const p = placeOf(id) || { name: id };
        const row = h('li', 'stop'); row.dataset.k = k;
        const b = h('button', 'stop-btn'); b.type = 'button'; b.setAttribute('aria-label', 'Fly to ' + p.name);
        const st = h('span', 'st'); st.append(h('span', 'sk', p.name), h('span', 'sy', CATS[p.category]?.en || ''));
        b.append(h('span', 'sn', String(k + 1)), st);
        b.addEventListener('click', () => onStopTap(i, k));
        row.append(b); list.append(row);
      });
      spN.textContent = String(i + 1); spK.textContent = 'Itinerary';
      bodyBox.scrollTop = 0;
      saveDay(i);
      applyNow();
      paintCaption(true);
    }
  }
  const daySummary = (i) => { const d = days[i]; const n = (d.stops || []).length; return `${regionEn(d.region)} · ${n} stop${n === 1 ? '' : 's'}`; };
  function setNow(seg) { nowStop = seg ? { d: seg.d, k: seg.k } : null; applyNow(true); }
  function applyNow(reveal) {
    let hit = null;
    [...list.children].forEach((li) => {
      const on = nowStop && nowStop.d === activeDay && li.classList.contains('stop') && +li.dataset.k === nowStop.k;
      li.classList.toggle('now', !!on); if (on) hit = li;
    });
    if (hit && reveal) revealIn(hit);
    paintCaption(true);
  }
  function revealIn(el) {
    const er = el.getBoundingClientRect(), br = bodyBox.getBoundingClientRect(); if (!br.height) return;
    let dy = 0;
    if (er.top < br.top + 40) dy = er.top - br.top - 40; else if (er.bottom > br.bottom - 14) dy = er.bottom - br.bottom + 14;
    if (dy) bodyBox.scrollTo({ top: Math.max(0, bodyBox.scrollTop + dy), behavior: state.cameraMoves ? 'smooth' : 'auto' });
  }

  // ---------- caption and thumb ----------
  function captionNow() {
    if (!days.length) return '';
    if (!cursorOn && !playing && !dragging) return `Day ${activeDay + 1} · ${daySummary(activeDay)}`;
    const seg = segs[segAt(time)];
    if (!seg) return `Day ${activeDay + 1} · ${daySummary(activeDay)}`;
    const p = placeOf(seg.id);
    return `Day ${seg.d + 1} · ${regionEn(p?.region || days[seg.d].region)} · ${p?.short || p?.name || ''}`;   // the stop's own region, not the day's
  }
  function paintCaption(force) {
    const t = captionNow();
    if (t !== capText || force) { capText = t; capTxt.textContent = t; }
  }
  let lastPct = -1;
  function paint(force) {
    const pct = duration ? clamp(time / duration, 0, 1) * 100 : 0;
    if (force || Math.abs(pct - lastPct) > 0.02) {
      lastPct = pct; thumb.style.left = pct + '%'; fill.style.width = pct + '%';
      scrub.setAttribute('aria-valuenow', Math.round(pct)); scrub.setAttribute('aria-valuemin', 0); scrub.setAttribute('aria-valuemax', 100);
    }
    paintCaption(false);
  }

  // ---------- user actions ----------
  function frameDay(i) {
    const day = days[i]; if (!day) return;
    const pts = (day.stops || []).map(stopWorld); if (!pts.length) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, ys = 0;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); ys += p.y; });
    const c = new THREE.Vector3((x0 + x1) / 2, ys / pts.length, (z0 + z1) / 2), Rr = Math.hypot(x1 - x0, z1 - z0) / 2;
    const w = canvas.clientWidth, hh = canvas.clientHeight, fr = rectNow();
    const fw = Math.max(0.2, (fr.x1 - fr.x0) / w), fh = Math.max(0.2, (fr.y1 - fr.y0) / hh);
    const vTan = Math.tan(rad(camera.fov / 2)), hTan = vTan * (w / hh);
    const fore = is2d() ? 1 : Math.cos(rad(VIEW.polar));                   // the flat map has no foreshortening
    const dist = clamp(Math.max(Rr / (0.7 * fw * hTan), Rr * fore / (0.7 * fh * vTan)), stopDist(), is2d() ? Math.max(600, controls.maxDistance) : 600);   // (the flat map may zoom out farther, so a long day like Hakone to Kyoto fits)
    const pose = ctx.aimPose(c, ctx.sph(dist, VIEW.polar, VIEW.az), ctx.rectCentre(fr));
    safe(() => ui.setActiveRegion(day.region)); state.region = day.region;
    ctx.flyToPose(pose, 3.5, { arc: 0.3 });
  }
  function setDay(i) {
    i = clamp(Math.round(i), 0, days.length - 1); if (!days.length) return;
    pause();
    time = dayStart[i]; entered = -1; cursorOn = false; hopCtx = null; setNow(null);
    showDay(i);
    routeDay = i; safe(() => route.setActiveDay(i)); R.clear();
    frameDay(i);
    paint(true);
  }
  function onStopTap(d, k) {
    pause();
    const seg = pauseSeg(d, k);
    if (seg) { time = seg.t0; entered = segs.indexOf(seg); cursorOn = true; setNow(seg); paint(true); }
    const id = days[d].stops[k];
    if (!docked() && open) { setOpen(false); setTimeout(() => ctx.openPlace(id), 330); }        // the sheet slides down first, then the card rises
    else ctx.openPlace(id);
  }

  // ---------- drawer open / collapse ----------
  function setOpen(b) {
    open = !!b;
    drawer.classList.toggle('open', open); bodyEl.classList.toggle('trip-open', open);
    drawer.setAttribute('aria-expanded', open); full.inert = !open;
    chev.classList.toggle('flip', open); capEl.setAttribute('aria-expanded', open);
  }
  foldBtn.addEventListener('click', () => setOpen(false));
  spine.addEventListener('click', () => setOpen(true));

  // phone layout: swipe the handle (the player row). Tap toggles.
  let sw = null;
  row.addEventListener('pointerdown', (e) => {
    if (docked() || e.target.closest('.pl-scrub, .pl-play')) return;
    sw = { id: e.pointerId, y0: e.clientY, dy: 0, t0: performance.now(), base: open ? 0 : drawer.offsetHeight - handleH() };
    try { row.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  });
  row.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    sw.dy = e.clientY - sw.y0;
    if (Math.abs(sw.dy) > 6) { drawer.classList.add('dragging'); drawer.style.transform = `translateY(${clamp(sw.base + sw.dy, 0, drawer.offsetHeight - handleH())}px)`; }
  });
  const swEnd = (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw; sw = null; drawer.classList.remove('dragging'); drawer.style.transform = '';
    const v = s.dy / Math.max(1, performance.now() - s.t0);
    if (Math.abs(s.dy) < 8) setOpen(!open);
    else if (s.dy < -30 || v < -0.4) setOpen(true);
    else if (s.dy > 30 || v > 0.4) setOpen(false);
  };
  row.addEventListener('pointerup', swEnd); row.addEventListener('pointercancel', swEnd);
  const probe = h('div', 'd-probe'); drawer.append(probe);                    // measures --hh (the collapsed handle height, safe area included)
  const handleH = () => probe.offsetHeight || 66;
  // swipe down on the page body at the top to fold the sheet
  let bd = null;
  bodyBox.addEventListener('touchstart', (e) => { if (docked() || e.touches.length !== 1) return; bd = { y0: e.touches[0].clientY, ok: bodyBox.scrollTop <= 0, dy: 0 }; }, { passive: true });
  bodyBox.addEventListener('touchmove', (e) => { if (bd && bd.ok) bd.dy = e.touches[0].clientY - bd.y0; }, { passive: true });
  bodyBox.addEventListener('touchend', () => { if (bd && bd.ok && bd.dy > 90) setOpen(false); bd = null; });

  // ---------- scrub ----------
  const frac = (x) => { const r = track.getBoundingClientRect(); return clamp((x - r.left) / Math.max(1, r.width), 0, 1); };
  scrub.addEventListener('pointerdown', (e) => {
    if (!segs.length) return;
    e.preventDefault(); e.stopPropagation();
    try { scrub.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    dragging = { id: e.pointerId, was: playing };
    pause(); scrubTo(frac(e.clientX) * duration);
    scrub.classList.add('drag');
  });
  scrub.addEventListener('pointermove', (e) => { if (dragging && e.pointerId === dragging.id) scrubTo(frac(e.clientX) * duration); });
  const scrubEnd = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const was = dragging.was; dragging = null; scrub.classList.remove('drag');
    if (e.type === 'pointercancel') { paint(true); if (was) play(); return; }
    commitSeek(frac(e.clientX) * duration);
    if (was) play();
  };
  scrub.addEventListener('pointerup', scrubEnd); scrub.addEventListener('pointercancel', scrubEnd);
  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const was = playing; pause(); commitSeek(time + (e.key === 'ArrowRight' ? 1 : -1) * (PAUSE_S + 6 / PLAY_SPEED)); if (was) play(); }
  });

  playBtn.addEventListener('click', () => { playing ? pause() : play(); });

  // ---------- pause triggers ----------
  canvas.addEventListener('pointerdown', () => { if (playing) pause(); }, { capture: true });      // the user takes over (capture: controls must be enabled before OrbitControls sees the touch)
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
    if (!segs.length) return;
    e.preventDefault(); playing ? pause() : play();
  });
  new MutationObserver(() => pollCard()).observe(bodyEl, { attributes: true, attributeFilter: ['class'] });     // react at once, not on the next frame
  function pollCard() {
    const o = !!ui.cardOpen;
    if (o === lastCard) return;
    lastCard = o;
    if (o) { pause(); if (!docked()) setOpen(false); }
  }

  // ---------- layout: the player lives in the drawer handle on phones, in the free map area when docked ----------
  function placeLayout() {
    if (docked()) { if (player.parentNode !== scrollEl) scrollEl.insertBefore(player, drawer); }
    else if (player.parentNode !== sheet) sheet.insertBefore(player, full);
    setOpen(docked() && !landPhoneMQ.matches ? open : false);               // the page opens with the sheet closed (spine tab only); a reload keeps it as the user left it
  }
  dockMQ.addEventListener?.('change', placeLayout); landPhoneMQ.addEventListener?.('change', placeLayout);

  // ---------- load ----------
  async function load() {
    const token = ++loadToken;
    let data = safe(() => route && route.itinerary, null);
    if (!(data && Array.isArray(data.days) && data.days.length)) {
      const who = safe(() => route.who, null) || Store.who || 'cade';
      data = await loadItinerary(who, placeById).then((r) => r.it).catch(() => null);      // the shared loader (swaps applied)
    }
    if (token !== loadToken) return;
    itin = data && Array.isArray(data.days) && data.days.length ? data : null;
    days = itin ? itin.days : [];
    stopCache.clear(); pathCache.clear();
    playing = false; hopCtx = null; entered = -1; cursorOn = false; nowStop = null; routeDay = null; time = 0;
    setPlayUi();
    const on = days.length > 0;
    drawer.hidden = !on; player.hidden = !on; bodyEl.classList.toggle('has-trip', on);
    if (!on) return;
    buildTimeline(); tabsBuild(); ticksBuild();
    const who = Store.who || 'cade';
    tp.textContent = stripJa(itin.title) || `${cap(who)}’s plan`; tn.textContent = `${days.length} days`;
    const saved = loadSaved()[who]?.day;
    const di = clamp(Number.isInteger(saved) ? saved : 0, 0, days.length - 1);
    dayBox.dataset.built = ''; activeDay = di;
    showDay(di);
    time = dayStart[di] || 0;
    routeDay = di; safe(() => route.setActiveDay(di));
    placeLayout(); paint(true);
  }

  const api = {
    update(now, dt) {
      pollCard();
      if (!playing) return;
      // the cap keeps a hitch (or a slow frame) from skipping a stop
      const ds = lastNow ? Math.min(maxStep, (now - lastNow) / 1000) : 0; lastNow = now;
      time += ds;
      if (time >= duration) { finish(); return; }
      const idx = segAt(time);
      if (idx !== entered) enter(idx, true);
      const seg = segs[idx];
      if (seg.type === 'hop') drive(seg, clamp((time - seg.t0) / (seg.t1 - seg.t0), 0, 1));
      paint(false);
    },
    refresh() { pause(); return load(); },
    play, pause, seek(s) { commitSeek(s); }, setDay,
    // where the trip cursor is: { day, leg, t } on a hop (t eased 0..1, like the ink), { day, leg, t: 1 } at a stop (leg = the arriving leg, -1 at the very first stop), null when off
    progress() {
      if (!cursorOn || !segs.length) return null;
      const seg = segs[segAt(time)]; if (!seg) return null;
      if (seg.type !== 'hop') return { day: seg.d, leg: seg.li, t: seg.li < 0 ? 0 : 1 };
      return { day: seg.d, leg: seg.li, t: state.cameraMoves || dragging ? ease(clamp((time - seg.t0) / (seg.t1 - seg.t0), 0, 1)) : 1 };   // still camera: the cut already shows the whole hop (not while scrubbing)
    },
    // the cursor's world point (into `out`, or null when off) and, when given, its heading in `tangent` (unit; zero when there is none, as at the first stop)
    progressPoint(out = new THREE.Vector3(), tangent = null) {
      const p = api.progress(), seg = p && segs[segAt(time)]; if (!seg) return null;
      if (tangent) tangent.set(0, 0, 0);
      if (p.leg >= 0 && safe(() => route.pointOnLeg(p.day, p.leg, p.t, out, tangent), null)) return out;
      if (seg.type === 'hop') {                                                           // no path from the route layer: the straight line between the stops
        const path = legPath(seg.d, seg.li, seg); sample(path, p.t, out);
        if (tangent) { tangent.subVectors(path.pts[path.pts.length - 1], path.pts[0]); if (tangent.lengthSq() > 1e-12) tangent.normalize(); }
        return out;
      }
      out.copy(stopWorld(seg.id));
      const nx = segs[segAt(time) + 1];                                                   // the very first stop: face the way the first hop leaves
      if (tangent && nx && nx.type === 'hop') safe(() => route.pointOnLeg(nx.d, nx.li, 0, _a, tangent));
      return out;
    },
    get cursor() { return cursorOn; },
    get playing() { return playing; }, get time() { return time; }, get duration() { return duration; },
    get segments() { return segs; }, get day() { return activeDay; }, get dayStarts() { return dayStart; }, get open() { return open; },
    setOpen, get maxStep() { return maxStep; }, set maxStep(v) { maxStep = +v || 0.25; },     // test hook: software GL renders ~1 frame per second
  };
  load();
  return api;
}
