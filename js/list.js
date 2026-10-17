// "Your Trip" list: the accepted plan day by day, with other options under each day and a swap.
// A washi panel in the style of the itinerary drawer. Swaps are saved on this device (js/itinerary.js, localStorage "jmap.swaps.v1").
// Only one of this list, the itinerary sheet and the info card is open at a time.
import { CATS } from './pins.js';
import { iconSVG } from './icons.js';
import { DOCK_MQ } from './ui.js';
import { Swaps } from './itinerary.js';

const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.6L8 10.6 13 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * ctx: { placeById, places, Store, ui, REGION_INFO, openPlace }
 * hooks: { route, trip, reload: async () => reloads the plan everywhere (route, drawer, pins) }
 */
export function initList(ctx, hooks) {
  const { placeById, places, Store, ui, REGION_INFO } = ctx;
  const root = document.getElementById('list'), body = document.body, stamp = document.querySelector('#seals [data-open="list"]');
  const tab = document.querySelector('#bar [data-tab="list"]');
  if (!root) return { setOpen() {}, toggle() {}, render() {}, get open() { return false; } };
  const phone = matchMedia('(max-width: 600px)'), dock = matchMedia(DOCK_MQ);
  const regionEn = (r) => (REGION_INFO && REGION_INFO[r] && REGION_INFO[r].en) || cap(r);
  const who = () => Store.who || 'cade';

  let open = false, busy = false, confirmReset = false, pick = null;     // pick: { day, alt } while the "which stop?" choice shows
  const expanded = new Set();                                             // day numbers whose "Other options" is open

  // ---------- shell ----------
  root.textContent = '';
  const sheet = h('div', 'ls-sheet'), top = h('div', 'ls-top'), scroller = h('div', 'ls-body'), foot = h('div', 'ls-foot');
  const head = h('div', 'ls-head'); head.append(h('h2', 'ls-title', 'Your Trip'), h('p', 'ls-sub', 'Saved on this device'));
  const x = h('button', 'ls-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close the list');
  top.append(head, x); sheet.append(top, scroller, foot); root.append(sheet);
  x.addEventListener('click', () => setOpen(false));

  // ---------- data ----------
  const plan = () => (hooks.route && hooks.route.itinerary) || null;
  const nameOf = (p) => (p && (p.name || p.short)) || '';
  const stopsOf = (it) => { const s = new Set(); (it.days || []).forEach((d) => (d.stops || []).forEach((id) => s.add(id))); return s; };
  const centre = (ids) => { const ps = ids.map((id) => placeById.get(id)).filter(Boolean); if (!ps.length) return null; return { lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lng: ps.reduce((a, p) => a + p.lng, 0) / ps.length }; };
  const regionsOf = (d) => { const r = []; (d.stops || []).forEach((id) => { const p = placeById.get(id); if (p && p.region && !r.includes(p.region)) r.push(p.region); }); if (!r.length && d.region) r.push(d.region); return r; };
  function alternates(it, d, inTrip) {
    const regs = new Set(regionsOf(d)), c = centre(d.stops || []), mine = Store.mine ? Store.mine() : {};
    const out = places.filter((p) => regs.has(p.region) && !inTrip.has(p.id) && !(mine[p.id] && mine[p.id].c === 'pass'));
    const dist = (p) => (c ? Math.hypot((p.lat - c.lat) * 111, (p.lng - c.lng) * 91) : 0);
    // suggestions first, then the must-sees; the nearest first inside each group
    out.sort((a, b) => ((a.status === 'core') - (b.status === 'core')) || (dist(a) - dist(b)));
    return out;
  }

  // ---------- render ----------
  function seal(cat) { const s = h('span', 'ls-seal'); s.innerHTML = iconSVG(cat, { size: 18 }); return s; }
  function nameBtn(p, line) {
    const b = h('button', 'ls-name'); b.type = 'button'; b.dataset.id = p.id;
    const t = h('span', 'ls-t'); t.append(h('b', 'ls-n', nameOf(p)));
    if (line) t.append(line);
    if (p.why) t.append(h('i', 'ls-why', p.why));
    b.append(seal(p.category), t);
    b.addEventListener('click', () => go(p.id));
    return b;
  }
  function render() {
    const keep = scroller.scrollTop;
    scroller.textContent = '';
    const it = plan();
    if (!it || !(it.days || []).length) { scroller.append(h('p', 'ls-empty', 'No trip plan has loaded yet.')); renderFoot(); return; }
    const inTrip = stopsOf(it), mine = Store.mine ? Store.mine() : {};
    for (const d of it.days) {
      const sec = h('section', 'ls-day');
      const hd = h('header', 'ls-dh'), dn = h('div', 'ls-dn'); dn.append(h('small', null, 'Day'), h('b', null, String(d.day)));
      const dt = h('div', 'ls-dt'); dt.append(h('h3', 'ls-dtitle', String(d.title || '').replace(/^[^A-Za-z0-9]+/, '')), h('div', 'ls-reg', regionsOf(d).map(regionEn).join(' · ')));
      hd.append(dn, dt); sec.append(hd);

      const ul = h('ul', 'ls-stops');
      for (const id of d.stops || []) {
        const p = placeById.get(id); if (!p) continue;
        const li = h('li', 'ls-stop'); li.append(nameBtn(p));
        const from = d.swapped && d.swapped[id];
        if (from) {
          li.classList.add('swapped');
          const sw = h('div', 'ls-sw'); sw.append(h('span', null, 'Swapped'), h('span', 'ls-dot', '·'));
          const u = h('button', 'ls-undo', 'Undo'); u.type = 'button'; u.disabled = busy;
          u.addEventListener('click', () => undo(d, from));
          sw.append(u); li.append(sw);
        }
        ul.append(li);
      }
      sec.append(ul);

      const alts = alternates(it, d, inTrip), isOpen = expanded.has(d.day) && alts.length > 0;
      const more = h('button', 'ls-more'); more.type = 'button'; more.setAttribute('aria-expanded', String(isOpen)); more.disabled = !alts.length;
      more.append(h('span', null, `Other options (${alts.length})`)); const ch = h('span', 'ls-chev'); ch.innerHTML = CHEV; more.append(ch);
      more.addEventListener('click', () => { if (expanded.has(d.day)) expanded.delete(d.day); else expanded.add(d.day); if (pick && pick.day === d.day) pick = null; render(); });
      sec.append(more);
      if (isOpen) {
        const al = h('ul', 'ls-alts');
        for (const p of alts) {
          const li = h('li', 'ls-alt');
          const meta = h('span', 'ls-meta'); meta.append(h('span', null, (CATS[p.category] || {}).en || cap(p.category)));
          meta.append(h('em', p.status === 'core' ? 'tag core' : 'tag sug', p.status === 'core' ? 'Must-see' : 'Suggestion'));
          if (mine[p.id] && mine[p.id].c === 'add') meta.append(h('em', 'tag add', 'On your map'));
          const row = h('div', 'ls-arow'); row.append(nameBtn(p, meta));
          const sb = h('button', 'ls-swap', 'Swap in'); sb.type = 'button'; sb.disabled = busy;
          sb.addEventListener('click', () => { pick = pick && pick.alt === p.id && pick.day === d.day ? null : { day: d.day, alt: p.id }; render(); });
          row.append(sb); li.append(row);
          if (pick && pick.day === d.day && pick.alt === p.id) {
            const pk = h('div', 'ls-pick'); pk.append(h('p', null, 'Replace which stop?'));
            for (const sid of d.stops || []) {
              const sp = placeById.get(sid); if (!sp) continue;
              const b = h('button', 'ls-opt', nameOf(sp)); b.type = 'button'; b.disabled = busy;
              b.addEventListener('click', () => swap(d, sid, p.id));
              pk.append(b);
            }
            const c = h('button', 'ls-cancel', 'Cancel'); c.type = 'button'; c.addEventListener('click', () => { pick = null; render(); });
            pk.append(c); li.append(pk);
          }
          al.append(li);
        }
        sec.append(al);
      }
      scroller.append(sec);
    }
    scroller.scrollTop = keep;
    renderFoot();
  }
  function renderFoot() {
    foot.textContent = '';
    const n = Swaps.count(who());
    if (confirmReset) {
      const box = h('div', 'ls-confirm'); box.append(h('p', null, 'Put the starter plan back? Your swaps on this device will be removed.'));
      const row = h('div', 'ls-crow'), yes = h('button', 'ls-yes', 'Reset'), no = h('button', 'ls-no', 'Keep my plan');
      yes.type = no.type = 'button';
      yes.addEventListener('click', async () => { confirmReset = false; pick = null; Swaps.reset(who()); await apply(); });
      no.addEventListener('click', () => { confirmReset = false; renderFoot(); });
      row.append(yes, no); box.append(row); foot.append(box); return;
    }
    const r = h('button', 'ls-reset', 'Reset to starter plan'); r.type = 'button';
    r.disabled = busy || n === 0; r.title = n === 0 ? 'No swaps yet' : '';
    r.addEventListener('click', () => { confirmReset = true; renderFoot(); });
    foot.append(r);
  }

  // ---------- actions ----------
  async function apply() {
    busy = true; render();
    try { await hooks.reload(); } catch (e) { console.error('[list] reload failed', e); }
    busy = false; render();
  }
  async function swap(d, stopId, altId) {
    if (!Store.who) { ui.showWho(); return; }
    const from = (d.swapped && d.swapped[stopId]) || stopId;       // the key names the stop of the starter plan
    Swaps.set(Store.who, d.day, from, altId);
    pick = null; await apply();
  }
  async function undo(d, from) {
    const cur = Object.entries(d.swapped || {}).find(([, o]) => o === from);
    if (!cur) return;
    Swaps.undo(who(), d.day, from); pick = null; await apply();
  }
  function go(id) { setOpen(false); requestAnimationFrame(() => ctx.openPlace && ctx.openPlace(id)); }

  // ---------- open and close ----------
  function setOpen(b) {
    b = !!b; if (b === open) return;
    open = b;
    if (b) {
      if (ui.cardOpen && ui.closeCard) ui.closeCard();
      if (!dock.matches) { const t = hooks.trip; if (t && t.setOpen) { try { t.setOpen(false); } catch (e) { /* ignore */ } } }   // docked: CSS slides the page away instead
      confirmReset = false; pick = null; render(); scroller.scrollTop = 0;
    }
    body.classList.toggle('list-open', b);
    root.classList.toggle('open', b); root.setAttribute('aria-hidden', String(!b));
    if (stamp) { stamp.classList.toggle('on', b); stamp.setAttribute('aria-pressed', String(b)); }
    if (phone.matches) { if (b) ui.setTab && ui.setTab('list'); else if (body.dataset.tab === 'list') ui.setTab && ui.setTab(null); }
  }
  if (stamp) stamp.addEventListener('click', () => setOpen(!open));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });
  // other panels and the phone tabs: the list gives way to a card or the sheet, and follows the "List" tab
  new MutationObserver(() => {
    if (open && body.classList.contains('card-open')) { setOpen(false); return; }
    if (open && !dock.matches && body.classList.contains('trip-open')) { setOpen(false); return; }
    if (phone.matches) {
      const t = body.dataset.tab;
      if (t === 'list' && !open) setOpen(true);
      else if (t !== 'list' && open) setOpen(false);
    }
  }).observe(body, { attributes: true, attributeFilter: ['class', 'data-tab'] });
  phone.addEventListener?.('change', () => { if (open) setOpen(false); });

  return { setOpen, toggle() { setOpen(!open); }, render() { if (open) render(); }, get open() { return open; } };
}
