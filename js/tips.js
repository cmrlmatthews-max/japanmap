// Symbol tooltips: plain-English help for a stamp, crest or mark (one bold line, one optional detail line).
// Mouse: hover 250 ms. Touch / pen: long press 450 ms (the click that follows is swallowed). Keyboard: :focus-visible.
// One #tip element, positioned beside the target. Works for elements added at any time (event delegation + MutationObserver).

const SEL = [
  '#seals .seal[data-layer]', '#filters .seal[data-cat]', '#crests .crest[data-region]',
  '#who', '#card .cseal', '#card .status', '#title img', '[data-tip]',
].join(',');

const HOVER_MS = 250, SWITCH_MS = 90, LONG_MS = 450, SLOP = 8, LINGER_MS = 1400, SUPPRESS_MS = 700;
const GAP = 10, MARGIN = 8, FADE_MS = 140;

// ---- text table: a bold line and one optional detail line, plain English ----
const LAYERS = {
  route:  ['Route',  'Show the trip by day'],
  mist:   ['Mist',   'Soft clouds over the mountains'],
  camera: ['Motion', 'Camera flights on or off (off = still camera)'],
  sound:  ['Sound',  'Coming soon'],
};
const CATS = {
  temple:       'Temples',
  shrine:       'Shrines',
  ryokan:       'Inns',
  garden:       'Gardens',
  architecture: 'Buildings',
  onsen:        'Hot springs',
  technology:   'Tech',
  art:          'Art',
};
// the card's category seal: what the word means
const CAT_HELP = {
  temple:       ['Temple', 'A Buddhist temple'],
  shrine:       ['Shrine', 'A Shinto shrine'],
  ryokan:       ['Inn', 'A traditional Japanese inn'],
  garden:       ['Garden', 'A garden to stroll through'],
  architecture: ['Architecture', 'A building worth studying'],
  onsen:        ['Hot spring', 'A natural hot-spring bath'],
  technology:   ['Technology', 'Design, tech and science'],
  art:          ['Art', 'A museum or art space'],
};
const REGIONS = {
  overview: { k: 'All', l: 'Show all of central Japan' },
  tokyo:    { k: 'Fly to Tokyo' },
  kyoto:    { k: 'Fly to Kyoto' },
  nara:     { k: 'Fly to Nara' },
  osaka:    { k: 'Fly to Osaka' },
  hakone:   { k: 'Fly to Hakone' },
  fuji:     { k: 'Fly to Mount Fuji' },
};
const STATUS = {
  core: { k: 'Must-see',   l: 'A classic sight' },
  sug:  { k: 'Suggestion', l: 'Worth a look if there is time' },
};
// the one place a tooltip may show Japanese: it explains the brush artwork
const TITLE = { k: '日本の旅 (Nihon no tabi)', l: '\u2018Journey Through Japan\u2019 in brush calligraphy' };

function describe(el) {
  const dt = el.getAttribute('data-tip');
  if (dt) {
    const parts = dt.split(' · ').map((s) => s.trim());
    return { k: parts[0], l: parts.slice(1).join(' · ') };
  }
  if (el.matches('#seals .seal[data-layer]')) { const t = LAYERS[el.dataset.layer]; return t && { k: t[0], l: t[1] }; }
  if (el.matches('#filters .seal[data-cat]')) {
    const n = CATS[el.dataset.cat]; if (!n) return null;
    return { k: n, l: el.classList.contains('on') ? 'Tap to hide' : 'Tap to show' };
  }
  if (el.matches('#crests .crest[data-region]')) { const t = REGIONS[el.dataset.region]; return t && { k: t.k, l: t.l || '' }; }
  if (el.matches('#card .cseal')) { const t = CAT_HELP[el.dataset.cat]; return t && { k: t[0], l: t[1] }; }
  if (el.matches('#card .status')) { const t = STATUS[el.dataset.status]; return t && { k: t.k, l: t.l }; }
  if (el.matches('#title img')) return { ...TITLE };
  return null;
}

let started = false;

export function initTips() {
  if (started) return; started = true;
  const tip = document.getElementById('tip');
  if (!tip) return;
  const host = tip.parentElement;
  const kEl = document.createElement('div'); kEl.className = 'tk';
  const lEl = document.createElement('div'); lEl.className = 'tl';
  tip.append(kEl, lEl);
  // reads the safe-area insets (env() is only available through CSS)
  const probe = document.createElement('div'); probe.className = 'tip-probe'; probe.setAttribute('aria-hidden', 'true');
  host.appendChild(probe);

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- titles: native tooltips would double up ----------
  function stripTitle(el) {
    if (!el.hasAttribute('title')) return;
    const t = el.getAttribute('title');
    if (t) {
      el.dataset.tipTitle = t;
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', t);
    }
    el.removeAttribute('title');
  }
  function sweep(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(SEL)) stripTitle(root);
    root.querySelectorAll(SEL).forEach(stripTitle);
  }
  sweep(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') { if (m.target.matches?.(SEL)) stripTitle(m.target); }
      else m.addedNodes.forEach(sweep);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  // ---------- target lookup ----------
  const titleImg = document.querySelector('#title img');
  const mapCanvas = document.getElementById('map');
  const targetAt = (e) => {
    const n = e.target instanceof Element ? e.target : null;
    if (!n) return null;
    const t = n.closest(SEL);
    if (t) return t;
    // #title has pointer-events:none, so its image is found by position (only over the bare map)
    if (titleImg && (n === mapCanvas || n === host)) {
      const r = titleImg.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return titleImg;
    }
    return null;
  };

  // ---------- show / hide ----------
  let shownEl = null, prevDescribedBy = null, hideTimer = 0, watch = 0;

  function unlink() {
    if (!shownEl) return;
    if (prevDescribedBy == null) shownEl.removeAttribute('aria-describedby');
    else shownEl.setAttribute('aria-describedby', prevDescribedBy);
    shownEl = null; prevDescribedBy = null;
  }

  function hideTip() {
    clearInterval(watch); watch = 0;
    unlink();
    tip.classList.remove('on');
    clearTimeout(hideTimer);
    if (reduced()) { tip.hidden = true; return; }
    hideTimer = setTimeout(() => { if (!shownEl) tip.hidden = true; }, FADE_MS);
  }

  function showTip(el, touchPt) {
    const d = describe(el);
    if (!d || !el.isConnected) { if (shownEl) hideTip(); return; }
    clearTimeout(hideTimer);
    const wasOn = !tip.hidden && tip.classList.contains('on');
    if (shownEl !== el) {
      unlink();
      shownEl = el; prevDescribedBy = el.getAttribute('aria-describedby');
      el.setAttribute('aria-describedby', 'tip');
    }
    kEl.textContent = d.k; lEl.textContent = d.l;
    lEl.hidden = !d.l;
    tip.hidden = false;
    place(el, touchPt);
    if (!wasOn) { void tip.offsetWidth; tip.classList.add('on'); }
    clearInterval(watch);
    watch = setInterval(() => {                     // target removed or hidden meanwhile (drawer closed, card closed, person switched)
      if (!shownEl || !shownEl.isConnected || !shownEl.getClientRects().length) hideTip();
    }, 400);
  }

  // ---------- placement ----------
  function place(el, touchPt) {
    const H = host.getBoundingClientRect();
    const vw = H.width, vh = H.height;
    const tr = el.getBoundingClientRect();
    const r = { left: tr.left - H.left, right: tr.right - H.left, top: tr.top - H.top, bottom: tr.bottom - H.top };
    const cs = getComputedStyle(probe);
    const B = {
      l: MARGIN + (parseFloat(cs.paddingLeft) || 0), r: vw - MARGIN - (parseFloat(cs.paddingRight) || 0),
      t: MARGIN + (parseFloat(cs.paddingTop) || 0), b: vh - MARGIN - (parseFloat(cs.paddingBottom) || 0),
    };
    tip.style.left = '0px'; tip.style.top = '0px';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;

    let pref;
    if (el.closest('#card')) pref = ['above', 'below', 'left', 'right'];
    else if (el.closest('nav')) {                          // a seal column goes sideways, a seal row goes above or below
      const g = el.closest('nav').getBoundingClientRect();
      if (g.height > g.width) pref = cx < vw / 2 ? ['right', 'left'] : ['left', 'right'];
      else pref = cy > vh / 2 ? ['above', 'below'] : ['below', 'above'];
    }
    else if (cy > vh * 0.78) pref = ['above'];
    else if (cx < vw * 0.32) pref = ['right'];
    else if (cx > vw * 0.68) pref = cy < vh * 0.2 ? ['below'] : ['left'];
    else if (cy < vh * 0.3) pref = ['below'];
    else pref = ['above'];
    const order = [...new Set([...pref, 'above', 'below', 'right', 'left'])];

    // the finger covers the touch point and the area under it; keep the slip clear of it, with a little more air than for a mouse
    const gap = touchPt ? GAP + 4 : GAP;
    const finger = touchPt ? { l: touchPt.x - H.left - 26, r: touchPt.x - H.left + 26, t: touchPt.y - H.top - 20, b: touchPt.y - H.top + 30 } : null;
    const hit = (x, y, a) => x < a.r && x + w > a.l && y < a.b && y + h > a.t;

    let best = null;
    for (const side of order) {
      let x, y, over;
      if (side === 'right')      { x = r.right + gap; y = cy - h / 2; over = Math.max(0, x + w - B.r); }
      else if (side === 'left')  { x = r.left - gap - w; y = cy - h / 2; over = Math.max(0, B.l - x); }
      else {
        x = cx - w / 2;
        if (cx > vw * 0.66) x = Math.min(x, r.right - w);       // near the right edge: hang to the left of the target
        else if (cx < vw * 0.34) x = Math.max(x, r.left);       // near the left edge: start at the target
        if (side === 'above') { y = r.top - gap - h; over = Math.max(0, B.t - y); }
        else                  { y = r.bottom + gap; over = Math.max(0, y + h - B.b); }
      }
      x = clamp(x, B.l, Math.max(B.l, B.r - w)); y = clamp(y, B.t, Math.max(B.t, B.b - h));
      let score = over;
      if (hit(x, y, { l: r.left, r: r.right, t: r.top, b: r.bottom })) score += 500;   // never cover the symbol itself
      if (finger && hit(x, y, finger)) score += 1000;
      if (!best || score < best.score) best = { side, x, y, score };
      if (score === 0) break;
    }
    const x = best.x, y = best.y;
    tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
    tip.dataset.side = best.side;
  }

  // ---------- mouse: hover ----------
  let hoverEl = null, hoverTimer = 0;
  const cancelHover = () => { clearTimeout(hoverTimer); hoverTimer = 0; hoverEl = null; };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') {
      // touch / pen movement: only matters for a press in progress
      if (press && e.pointerId === press.id && !press.fired && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
      return;
    }
    const t = targetAt(e);
    if (t === hoverEl) return;
    clearTimeout(hoverTimer); hoverEl = t;
    if (!t) { if (shownEl || !tip.hidden) hideTip(); return; }
    if (t === shownEl) return;
    const delay = shownEl ? SWITCH_MS : HOVER_MS;
    hoverTimer = setTimeout(() => { if (hoverEl === t) showTip(t); }, delay);
  }, true);
  document.documentElement.addEventListener('mouseleave', () => { cancelHover(); hideTip(); });
  addEventListener('blur', () => { cancelHover(); cancelPress(); hideTip(); });

  // ---------- touch / pen: long press ----------
  let press = null, lingerTimer = 0, suppress = null, suppressTimer = 0, lastType = 'mouse';

  function endSuppress() {
    clearTimeout(suppressTimer);
    if (suppress) { document.removeEventListener('click', suppress, true); suppress = null; }
  }
  function startSuppress() {
    endSuppress();
    suppress = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); endSuppress(); };
    document.addEventListener('click', suppress, true);
  }
  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer); press = null;
  }

  document.addEventListener('pointerdown', (e) => {
    lastType = e.pointerType;
    if (e.pointerType === 'mouse') { clearTimeout(hoverTimer); return; }
    clearTimeout(lingerTimer); endSuppress();
    if (shownEl || !tip.hidden) hideTip();
    if (press) { cancelPress(); return; }                // a second finger: not a long press
    const t = targetAt(e);
    if (!t || !describe(t)) return;
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, el: t, fired: false, timer: 0 };
    p.timer = setTimeout(() => {
      p.fired = true;
      if (!t.isConnected) return;
      showTip(t, { x: p.x, y: p.y });
      startSuppress();
    }, LONG_MS);
    press = p;
  }, true);

  const release = (e) => {
    if (e.pointerType === 'mouse' || !press || e.pointerId !== press.id) return;
    const fired = press.fired;
    cancelPress();
    if (fired) {
      clearTimeout(lingerTimer); lingerTimer = setTimeout(hideTip, LINGER_MS);
      clearTimeout(suppressTimer); suppressTimer = setTimeout(endSuppress, SUPPRESS_MS);   // a click that never comes
    }
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  // no context menu / callout after a long press on a symbol
  document.addEventListener('contextmenu', (e) => {
    if ((press || lastType !== 'mouse') && targetAt(e)) e.preventDefault();
  }, true);

  // ---------- keyboard ----------
  document.addEventListener('focusin', (e) => {
    const n = e.target instanceof Element ? e.target : null;
    const t = n && n.closest(SEL);
    if (!t || !t.matches('button, a, [role="button"], [tabindex]')) return;
    let fv = false; try { fv = t.matches(':focus-visible'); } catch (err) { fv = false; }
    if (fv) { cancelHover(); showTip(t); }
  });
  document.addEventListener('focusout', (e) => {
    const n = e.target instanceof Element ? e.target : null;
    if (n && shownEl && n.closest(SEL) === shownEl) hideTip();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && shownEl) hideTip(); });

  // a click may change the state the tip describes (filter on/off, person): refresh in place
  document.addEventListener('click', () => {
    if (!shownEl) return;
    const el = shownEl;
    setTimeout(() => { if (shownEl === el) showTip(el); }, 30);
  });

  addEventListener('resize', () => { cancelHover(); hideTip(); });
  addEventListener('orientationchange', () => { cancelHover(); hideTip(); });
}
