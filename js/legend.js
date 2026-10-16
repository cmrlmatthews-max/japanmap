// Line legend: which line is which travel mode. Same colours, dashes and weights as the route shader (js/route.js).
// 1. A small "Lines" tab above the map key. A tap opens the six swatches; a second tap, or a tap on the map, closes them.
// 2. linesKey(): a compact key for the top of the itinerary sheet (js/trip.js).

export const LINE_MODES = [
  { id: 'shinkansen', en: 'Bullet train', color: '#C8341E', w: 5,    dash: '22 8' },
  { id: 'local',      en: 'Train',        color: '#2E4A7A', w: 3.75, dash: '12 6' },
  { id: 'bus',        en: 'Bus',          color: '#B07A2A', w: 3.3,  dash: '6 5' },
  { id: 'boat',       en: 'Boat',         color: '#3E7C7A', w: 3.3,  dash: '10 5 0.01 5' },
  { id: 'ropeway',    en: 'Ropeway',      color: '#7A3E5A', w: 2.9,  dash: '10 4', ticks: true },
  { id: 'walk',       en: 'Walk',         color: '#2C2C2A', w: 3.5,  dash: '0.01 9' },
];

// an SVG swatch: a short line in the mode's style (round caps make the dashes and dots match the shader)
export function swatch(m, len = 40) {
  const y = 7, w = m.w, x0 = w / 2 + 1, x1 = len - w / 2 - 1;
  let ticks = '';
  if (m.ticks) for (let x = x0 + 12; x < x1; x += 14) ticks += `<line x1="${x}" y1="${y - 3.6}" x2="${x}" y2="${y + 3.6}" stroke="${m.color}" stroke-width="1.4" stroke-linecap="round"/>`;
  return `<svg class="lg-sw" viewBox="0 0 ${len} 14" width="${len}" height="14" aria-hidden="true">` +
    `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${m.color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${m.dash}"/>${ticks}</svg>`;
}

// compact key: swatch plus word for each mode, wrapping in rows
export function linesKey() {
  const el = document.createElement('div'); el.className = 'lines-key'; el.setAttribute('aria-label', 'Line key');
  el.innerHTML = LINE_MODES.map(m => `<span class="lk">${swatch(m, 26)}<i>${m.en}</i></span>`).join('');
  return el;
}

export function initLegend() {
  const host = document.getElementById('scroll') || document.body;
  const box = document.createElement('div'); box.id = 'legend';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'lg-tab';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'legendPanel'); btn.dataset.tip = 'Lines · Which line is which';
  btn.innerHTML = '<span>Lines</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.8L6 4.3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const panel = document.createElement('div'); panel.id = 'legendPanel'; panel.className = 'lg-panel'; panel.hidden = true;
  panel.innerHTML = '<div class="lg-h">Travel lines</div>' + LINE_MODES.map(m => `<div class="lg-row">${swatch(m, 44)}<span>${m.en}</span></div>`).join('');
  box.append(panel, btn); host.appendChild(box);
  const set = (open) => { panel.hidden = !open; box.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(panel.hidden); });
  document.getElementById('map')?.addEventListener('pointerdown', () => set(false));
  return { el: box, set };
}
