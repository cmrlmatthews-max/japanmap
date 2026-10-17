// One place that loads a person's day plan (data/itinerary-<who>.json) and applies this device's swaps.
// The route layer, the drawer, the player, the pins and the Your Trip list all read the result, so they always agree.
//
// Swaps are saved in localStorage "jmap.swaps.v1": { cade: { "<day number>:<original stop id>": "<new place id>" }, casey: { ... } }.
// The key always names the stop of the starter plan, so swapping a swapped stop again just replaces the value.

const KEY = 'jmap.swaps.v1';
const WHO = (w) => (w === 'casey' ? 'casey' : 'cade');
const baseCache = new Map();                          // who -> parsed starter plan (never modified)

export const Swaps = {
  all() {
    try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
  },
  get(who) { const m = this.all()[WHO(who)]; return m && typeof m === 'object' ? m : {}; },
  save(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* private mode: the swap lasts until reload */ } },
  set(who, day, origId, newId) {
    const all = this.all(), w = WHO(who); all[w] = all[w] && typeof all[w] === 'object' ? all[w] : {};
    const k = `${day}:${origId}`;
    if (newId === origId) delete all[w][k]; else all[w][k] = newId;
    this.save(all);
  },
  undo(who, day, origId) { this.set(who, day, origId, origId); },
  reset(who) { const all = this.all(); delete all[WHO(who)]; this.save(all); },
  count(who) { return Object.keys(this.get(who)).length; },
};

// ---------- distance helpers (km) for the leg fix-up ----------
function km(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return null;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(q));
}
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

/**
 * Apply swaps to a starter plan. Returns a new plan (the input is not changed).
 * Each day gets `swapped`: { newId: originalId } for its swapped stops. The plan gets `swapCount`.
 * A swap is ignored when its place is unknown, is not a stop of that day, or would put one place in the trip twice.
 */
export function applySwaps(base, swaps, placeById) {
  const it = JSON.parse(JSON.stringify(base));
  it.swapCount = 0;
  const days = it.days || [], maps = days.map(() => ({}));
  const baseStops = new Set(); days.forEach((d) => (d.stops || []).forEach((s) => baseStops.add(s)));
  const claimed = new Set();
  // 1. which swaps are valid (simultaneous: the new ids must not clash with the plan after all swaps)
  const wanted = [];
  for (const [k, newId] of Object.entries(swaps || {})) {
    const i = k.indexOf(':'), dn = Number(k.slice(0, i)), oldId = k.slice(i + 1);
    const di = days.findIndex((d) => d.day === dn);
    if (di < 0 || !(days[di].stops || []).includes(oldId) || (placeById && !placeById.has(newId)) || newId === oldId) continue;
    wanted.push({ di, oldId, newId });
  }
  const swappedOut = new Set(wanted.map((w) => w.oldId));
  for (const w of wanted) {
    const stays = [...baseStops].filter((s) => !swappedOut.has(s));
    if (stays.includes(w.newId) || claimed.has(w.newId)) continue;
    claimed.add(w.newId); maps[w.di][w.oldId] = w.newId; it.swapCount++;
  }
  if (!it.swapCount) { days.forEach((d) => { d.swapped = {}; }); return it; }
  // a swap-out id that nothing took stays where it was (its map entry is absent)
  const G = {}; maps.forEach((m) => Object.assign(G, m));
  const place = (id) => (placeById ? placeById.get(id) : null);
  days.forEach((d, di) => {
    const M = maps[di], P = di > 0 ? maps[di - 1] : {};
    d.swapped = {};
    d.stops = (d.stops || []).map((s) => { if (M[s]) { d.swapped[M[s]] = s; return M[s]; } return s; });
    if (d.stay && G[d.stay]) d.stay = G[d.stay];
    (d.legs || []).forEach((leg, li) => {
      const from0 = leg.from, to0 = leg.to;
      const nf = M[leg.from] || (li === 0 && P[leg.from]) || leg.from, nt = M[leg.to] || leg.to;
      leg.from = nf; leg.to = nt;
      const moved = nf !== from0 || nt !== to0;
      if (!moved) return;
      leg.swapped = true;
      if (leg.parts && leg.parts.length) {
        const first = leg.parts[0], last = leg.parts[leg.parts.length - 1];
        if (nt !== to0) {
          for (const p of leg.parts) if (p.to === to0) p.to = nt;
          const d0 = km(place(to0), place(nt));
          if (last.mode === 'walk' && d0 != null && d0 > 1.2) { last.mode = 'local'; last.minutes = round5(8 + d0 * 3); }   // too far to walk from the station
        }
        if (nf !== from0 && first.mode === 'walk') {
          const d0 = km(place(from0), place(nf));
          if (d0 != null && d0 > 1.2) { first.mode = 'local'; first.minutes = round5(8 + d0 * 3); }
        }
      } else if (leg.mode === 'walk' || leg.mode === 'local') {
        const dd = km(place(nf), place(nt));
        if (dd != null) { leg.mode = dd <= 1.6 ? 'walk' : 'local'; leg.minutes = leg.mode === 'walk' ? round5(dd * 13) : round5(10 + dd * 3); }
      }
    });
  });
  return it;
}

/** Load the starter plan of `who` (falls back to Cade's file), apply this device's swaps. -> { it, who, base } */
export async function loadItinerary(who, placeById) {
  const w = WHO(who);
  let base = baseCache.get(w);
  if (!base) {
    for (const name of w === 'casey' ? ['casey', 'cade'] : ['cade']) {
      try { const r = await fetch(`data/itinerary-${name}.json`); if (r.ok) { base = await r.json(); break; } } catch (e) { /* try the fallback */ }
    }
    if (base) baseCache.set(w, base);
  }
  if (!base) return { it: null, who: w, base: null };
  return { it: applySwaps(base, Swaps.get(w), placeById), who: w, base };
}

export const baseOf = (who) => baseCache.get(WHO(who)) || null;

/** ids of the accepted places: every stop (and stay) of the plan, plus the places the person marked "Add to trip". */
export function tripSet(it, choices) {
  const s = new Set();
  for (const d of (it && it.days) || []) { (d.stops || []).forEach((id) => s.add(id)); if (d.stay) s.add(d.stay); }
  for (const [id, c] of Object.entries(choices || {})) if (c && c.c === 'add') s.add(id);
  return s;
}
