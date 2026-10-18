// DOM UI: saved choices, region crests, category filter, info card, "who is this?".
import { CATS, CAT_ORDER } from './pins.js';
import { iconSVG } from './icons.js';

export const REGION_INFO = {
  japan:    { kanji: '日本', yomi: 'にほん', en: 'Japan' },
  overview: { kanji: '中部・関西', yomi: 'ちゅうぶ・かんさい', en: 'Central Japan' },
  tokyo:    { kanji: '東京', yomi: 'とうきょう', en: 'Tokyo' },
  hakone:   { kanji: '箱根', yomi: 'はこね',     en: 'Hakone' },
  fuji:     { kanji: '富士', yomi: 'ふじ',       en: 'Mount Fuji' },
  kyoto:    { kanji: '京都', yomi: 'きょうと',   en: 'Kyoto' },
  nara:     { kanji: '奈良', yomi: 'なら',       en: 'Nara' },
  osaka:    { kanji: '大阪', yomi: 'おおさか',   en: 'Osaka' },
};
// REGION_INFO keeps the Japanese (kanji, yomi) as data only. The UI renders the English name (en) and nothing else.
// the card docks on the right on iPad/desktop and on iPhone landscape; otherwise it is a bottom sheet
export const DOCK_MQ = '(min-width: 900px), (max-height: 520px) and (orientation: landscape)';
const WHO = { cade: { name: 'Cade' }, casey: { name: 'Casey' } };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- saved state: localStorage "jmap.v1" ----------
const KEY = 'jmap.v1';
export const Store = {
  data: { who: null, choices: { cade: {}, casey: {} } },
  load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && typeof j === 'object') {
        if (j.who === 'cade' || j.who === 'casey') this.data.who = j.who;
        for (const w of ['cade', 'casey']) if (j.choices && typeof j.choices[w] === 'object' && j.choices[w]) this.data.choices[w] = j.choices[w];
      }
    } catch (e) { /* private mode or bad JSON: start empty */ }
    return this;
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } },
  get who() { return this.data.who; },
  setWho(w) { this.data.who = w; this.save(); },
  mine() { return (this.data.who && this.data.choices[this.data.who]) || {}; },
  choice(id) { return this.mine()[id]?.c || null; },
  setChoice(id, c) {
    if (!this.data.who) return;
    const m = this.data.choices[this.data.who];
    if (c) m[id] = { c, t: new Date().toISOString() }; else delete m[id];
    this.save();
  },
};

const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase());
function fmtVal(v) {
  if (v == null || v === '' || v === false) return '';
  if (Array.isArray(v)) return v.map(fmtVal).filter(Boolean).join(' · ');
  if (typeof v === 'object') return fmtVal(v.name || v.text || v.value || '');
  return String(v);
}
function normSources(src) {
  const arr = Array.isArray(src) ? src : (src ? [src] : []);
  const out = [];
  for (const s of arr) {
    let url = '', label = '';
    if (typeof s === 'string') { url = /^https?:/i.test(s) ? s : ''; label = url ? '' : s; }
    else if (s && typeof s === 'object') { url = s.url || s.href || ''; label = s.title || s.name || s.label || ''; }
    if (url) { try { label = label || new URL(url).hostname.replace(/^www\./, ''); } catch (e) { url = ''; } }
    if (label || url) out.push({ url, label: label || url });
  }
  return out;
}

// pictograms: every [data-icon] gets its drawn icon. A seal button gets a vermilion stamp box that holds the icon, with the word under it.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone) return;
    el.dataset.iconDone = '1';
    const svg = iconSVG(el.dataset.icon, { size: 24 });
    if (el.matches('button.seal')) { const st = document.createElement('span'); st.className = 'stamp'; st.setAttribute('aria-hidden', 'true'); st.innerHTML = svg; el.prepend(st); }
    else el.innerHTML = svg;
  });
}

export function initUI(cb) {
  Store.load();
  hydrateIcons();
  const ui = { Store, cardPlace: null, cardOpen: false };
  const body = document.body;

  // ----- phone bottom bar: four tabs -----
  // body[data-tab] names the open tab. regions, filters and layers show a strip above the bar (CSS does it); trip opens the itinerary sheet.
  // While the sheet is open data-tab is "trip", and it clears when the sheet closes. A touch on the map closes any strip.
  const phone = matchMedia('(max-width: 600px)');
  const tabBtns = $$('#bar .tab');
  ui.setTab = (t) => { if (t) body.dataset.tab = t; else delete body.dataset.tab; };
  tabBtns.forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tab;
    if (t !== 'trip') { ui.setTab(body.dataset.tab === t ? null : t); return; }
    const trip = window.__map?.trip;                       // may not exist yet, or has no itinerary
    if (!trip?.setOpen || !body.classList.contains('has-trip')) return;
    ui.setTab('trip'); trip.setOpen(true);
  }));
  new MutationObserver(() => {
    if (phone.matches) {
      const open = body.classList.contains('trip-open'), t = body.dataset.tab;
      if (open && t !== 'trip') ui.setTab('trip');         // the sheet opened (the tab or its handle): a strip gives way
      else if (!open && t === 'trip') ui.setTab(null);     // the sheet closed
    }
    tabBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === body.dataset.tab)));
  }).observe(body, { attributes: true, attributeFilter: ['class', 'data-tab'] });
  phone.addEventListener?.('change', () => ui.setTab(null));
  $('#map').addEventListener('pointerdown', () => { if (body.dataset.tab && body.dataset.tab !== 'trip') ui.setTab(null); });
  // the 3D stamp's tip follows its state (app.js flips the "on" class)
  const b3d = $('#seals [data-layer="3d"]');
  if (b3d) new MutationObserver(() => { b3d.dataset.tip = b3d.classList.contains('on') ? '3D · Flatten the map' : '3D · Tilt the map up'; }).observe(b3d, { attributes: true, attributeFilter: ['class'] });

  // ----- region crests -----
  const crests = $$('#crests .crest');
  ui.setActiveRegion = (id) => {
    crests.forEach(b => b.classList.toggle('active', b.dataset.region === id));
    const r = REGION_INFO[id]; if (!r) return;
    $('#region .en').textContent = r.en;
  };
  crests.forEach(b => b.addEventListener('click', () => {
    if (phone.matches && body.dataset.tab === 'regions') ui.setTab(null);   // the strip closes first, so the fly-to aims at the whole free area
    cb.onRegion(b.dataset.region);
  }));

  // ----- category filter -----
  const catBtns = $$('#filters .seal');
  catBtns.forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    cb.onFilter(new Set(catBtns.filter(x => x.classList.contains('on')).map(x => x.dataset.cat)));
  }));

  // ----- who is this -----
  const whoBtn = $('#who'), whoPick = $('#whoPick');
  const refreshWho = () => {
    const w = Store.who;
    whoBtn.hidden = !w;
    if (w) { $('.who-name', whoBtn).textContent = WHO[w].name; whoBtn.dataset.tip = `${WHO[w].name} · Tap to switch person`; whoBtn.setAttribute('aria-label', `${WHO[w].name}. Tap to switch person`); }
    $$('.who-btn', whoPick).forEach(b => b.classList.toggle('cur', b.dataset.who === w));
  };
  ui.showWho = () => { refreshWho(); whoPick.hidden = false; requestAnimationFrame(() => whoPick.classList.add('open')); };
  const hideWho = () => { whoPick.classList.remove('open'); setTimeout(() => { whoPick.hidden = true; }, 350); };
  $$('.who-btn', whoPick).forEach(b => b.addEventListener('click', () => {
    Store.setWho(b.dataset.who); refreshWho(); hideWho(); cb.onWho(Store.who);
    if (ui.cardPlace) fillCard(ui.cardPlace);            // buttons reflect the new person
  }));
  whoPick.addEventListener('click', (e) => { if (e.target === whoPick && Store.who) hideWho(); });
  whoBtn.addEventListener('click', () => ui.showWho());
  refreshWho();

  // ----- info card -----
  const card = $('#card'), box = $('.scrollbox', card);
  const fillCard = (p) => {
    const cat = CATS[p.category] || { en: cap(p.category || '') };
    const cs = $('.cseal', card); cs.innerHTML = iconSVG(p.category, { size: 22 }); cs.dataset.cat = p.category || '';
    $('.cname', card).textContent = cat.en;
    const st = $('.status', card), core = p.status === 'core';
    st.textContent = core ? 'Must-see' : 'Suggestion'; st.dataset.status = core ? 'core' : 'sug';
    st.className = 'status ' + (core ? 'core' : 'sug');
    $('.title', card).textContent = p.name || '';
    const jp = $('.jp', card); jp.textContent = p.kanji || ''; jp.hidden = !p.kanji;   // the only Japanese in the UI
    $('.reg', card).textContent = REGION_INFO[p.region]?.en || cap(p.region || '');
    $('.why', card).textContent = p.why || '';
    const rows = $('.rows', card); rows.textContent = '';
    const add = (label, v) => { v = fmtVal(v); if (!v) return; const d = document.createElement('div'); d.className = 'row';
      d.innerHTML = '<dt></dt><dd></dd>';
      d.querySelector('dt').textContent = label; d.querySelector('dd').textContent = v; rows.appendChild(d); };
    add('Architect', p.architect);
    add('Best time', p.best);
    add('Booking', p.booking);
    if ((p.category === 'ryokan' || p.category === 'onsen') && p.tier) add('Price tier', cap(p.tier));
    rows.hidden = !rows.children.length;
    // Google Maps: the place listing, found by the English and the Japanese name (hours, photos, directions to the entrance).
    // On iPhone the link opens the Google Maps app when it is installed, otherwise Google Maps in Safari.
    const gm = $('.gmap', card), q = [p.name, p.kanji].filter(Boolean).join(' ') || (Number.isFinite(p.lat) && Number.isFinite(p.lng) ? `${p.lat},${p.lng}` : '');
    gm.hidden = !q;
    if (q) { gm.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); gm.setAttribute('aria-label', `Open ${p.name || 'this place'} in Google Maps`); }
    const c = Store.choice(p.id);
    const addB = $('.btn.add', card), passB = $('.btn.pass', card);
    addB.textContent = c === 'add' ? 'In trip — undo' : 'Add to trip';
    passB.textContent = c === 'pass' ? 'Passed — undo' : 'Pass';
    addB.classList.toggle('on', c === 'add'); passB.classList.toggle('on', c === 'pass');
    const src = $('.src', card); src.textContent = '';
    const list = normSources(p.sources);
    src.hidden = !list.length;
    if (list.length) {
      src.append('Sources: ');
      list.forEach((s, i) => {
        if (i) src.append(' · ');
        if (s.url) { const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = s.label; src.append(a); }
        else src.append(s.label);
      });
    }
  };
  const choose = (c) => {
    const p = ui.cardPlace; if (!p) return;
    if (!Store.who) { ui.showWho(); return; }
    Store.setChoice(p.id, Store.choice(p.id) === c ? null : c);
    fillCard(p); cb.onChoice(p.id);
  };
  $('.btn.add', card).addEventListener('click', () => choose('add'));
  $('.btn.pass', card).addEventListener('click', () => choose('pass'));

  ui.openCard = (p) => {
    ui.cardPlace = p; fillCard(p); box.scrollTop = 0;
    card.style.transform = '';
    card.classList.add('open'); card.setAttribute('aria-hidden', 'false'); body.classList.add('card-open');
    ui.cardOpen = true;
  };
  ui.closeCard = () => {
    if (!ui.cardOpen) return;
    ui.cardOpen = false; card.style.transform = ''; card.classList.remove('open', 'dragging');
    card.setAttribute('aria-hidden', 'true'); body.classList.remove('card-open');
    const id = ui.cardPlace?.id; ui.cardPlace = null; cb.onCardClose(id);
  };
  $('.x', card).addEventListener('click', () => ui.closeCard());
  addEventListener('keydown', (e) => { if (e.key === 'Escape') ui.closeCard(); });

  // swipe down to close (bottom-sheet layouts only)
  let drag = null;
  const docked = () => matchMedia(DOCK_MQ).matches;
  card.addEventListener('touchstart', (e) => {
    if (docked() || e.touches.length !== 1) return;
    drag = { y0: e.touches[0].clientY, dy: 0, t0: performance.now(), ok: box.scrollTop <= 0 };
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (!drag || !drag.ok) return;
    const dy = e.touches[0].clientY - drag.y0;
    if (dy <= 0) { drag.dy = 0; card.style.transform = ''; return; }
    drag.dy = dy; card.classList.add('dragging'); card.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null; card.classList.remove('dragging');
    const v = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > 90 || (d.dy > 30 && v > 0.5)) ui.closeCard(); else card.style.transform = '';
  };
  card.addEventListener('touchend', endDrag); card.addEventListener('touchcancel', endDrag);

  return ui;
}
