/* Rubbelwelt – interaktive Rubbel-Weltkarte
   Datenquellen: data/countries.json (195 Länder) + data/countries-50m.json (Geometrie) */
'use strict';

const HOLD_MS = 1500;   // so lange gedrückt halten zum Freischalten
const TAP_MS  = 260;    // kürzer = Tipp (Detail öffnen)
const MOVE_CANCEL = 12; // px Bewegung bricht Long-Press ab (dann ist es Schieben)
const TOTAL = 195;
const LS_KEY = 'rubbelwelt_v1';
const FLAG = (iso, size) => `https://flagcdn.com/${size ? size + '/' : ''}${iso}${size ? '.png' : '.svg'}`;

/* ---------- State ---------- */
let state = { visited: {}, capitals: {} };
try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s) state = Object.assign(state, s); } catch (e) {}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  if (window.RubbelSync) window.RubbelSync.push(state);   // Hook für spätere Cloud-Sync
}

/* ---------- Daten ---------- */
let COUNTRIES = [];       // Array
let byIso = {};           // iso -> country
let byNum = {};           // num -> country
let features = {};        // iso -> GeoJSON feature (nur unsere 195)
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ---------- SVG / D3 ---------- */
const svgEl = document.getElementById('map');
const wrap = document.getElementById('map-wrap');
const svg = d3.select(svgEl);
let W = 0, H = 0, projection, path, zoom, viewport;
let gOcean, gGrat, gOther, gFlags, gCovers, gBorders, gPoles, defs;
let curK = 1;
const coverEl = {};       // iso -> <path.cover>
const borderEl = {};      // iso -> <path.border>
const flagShown = {};     // iso -> true (Flaggenbild schon erzeugt)

/* ---------- Init ---------- */
Promise.all([
  fetch('data/countries.json?v=5').then(r => r.json()),
  fetch('data/countries-50m.json?v=5').then(r => r.json())
]).then(([countries, topo]) => {
  COUNTRIES = countries;
  COUNTRIES.forEach(c => { byIso[c.iso2] = c; byNum[c.num] = c; });

  const fc = topojson.feature(topo, topo.objects.countries);
  const otherFeatures = [];
  fc.features.forEach(f => {
    const c = byNum[+f.id];
    if (c) {
      // Natural Earth vergibt dieselbe ID teils mehrfach (Festland + winzige Außeninseln,
      // z. B. Australien + "Ashmore and Cartier Is."). Immer die größte Fläche behalten.
      const area = d3.geoArea(f);
      const cur = features[c.iso2];
      if (!cur || area > cur.__area) { f.__area = area; features[c.iso2] = f; }
    } else otherFeatures.push(f);
  });

  // Abtrünnige/umstrittene Gebiete ihrem Land zuschlagen (verschmelzen), damit sie
  // beim Freirubbeln des Landes mit-freigeschaltet werden und kein Fleck bleibt.
  const MERGE = { 'Somaliland': 'so', 'N. Cyprus': 'cy', 'W. Sahara': 'ma',
    'Siachen Glacier': 'in', 'Indian Ocean Ter.': 'au' };
  const otherKept = [];
  otherFeatures.forEach(f => {
    const piso = MERGE[f.properties && f.properties.name];
    const parent = piso && features[piso];
    if (parent) {
      const pp = parent.geometry.type === 'Polygon' ? [parent.geometry.coordinates] : parent.geometry.coordinates;
      const ep = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      parent.geometry = { type: 'MultiPolygon', coordinates: pp.concat(ep) };
    } else otherKept.push(f);
  });
  window.__other = otherKept;

  buildGrid();
  setupSvg();
  render();
  refreshCounters();

  document.getElementById('loading').style.display = 'none';
  if (window.RubbelSync) window.RubbelSync.init();   // Cloud-Sync starten (falls eingerichtet)
  // Handy: gleich bei Deutschland starten
  if (window.innerWidth < 900) setTimeout(() => flyTo('de', 3.2, 0), 300);
  setTimeout(() => { const h = document.getElementById('hint'); if (h) h.style.opacity = '0'; }, 6000);
}).catch(err => {
  document.getElementById('loading').textContent = 'Fehler beim Laden: ' + err.message;
  console.error(err);
});

/* ---------- SVG aufbauen ---------- */
function setupSvg() {
  defs = svg.append('defs');
  viewport = svg.append('g').attr('id', 'viewport');
  gOcean   = viewport.append('g');
  gGrat    = viewport.append('g');
  gOther   = viewport.append('g');
  gFlags   = viewport.append('g');
  gCovers  = viewport.append('g');
  gBorders = viewport.append('g');
  gPoles   = viewport.append('g');

  zoom = d3.zoom().scaleExtent([1, 14])
    .on('zoom', (e) => { viewport.attr('transform', e.transform); curK = e.transform.k; })
    .on('start', () => svgEl.classList.add('grabbing'))
    .on('end', () => svgEl.classList.remove('grabbing'));
  svg.call(zoom).on('dblclick.zoom', null);

  // Zoom-Buttons
  document.querySelector('.map-ctrl').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const kind = b.dataset.zoom;
    if (kind === 'reset') svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
    else svg.transition().duration(250).call(zoom.scaleBy, kind === 'in' ? 1.6 : 1 / 1.6);
  });

  buildPressRing();
  window.addEventListener('resize', debounce(() => { render(); }, 200));
}

function resize() {
  const r = wrap.getBoundingClientRect();
  W = r.width; H = r.height;
  svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);
  projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
  path = d3.geoPath(projection);
}

/* ---------- Karte zeichnen ---------- */
function render() {
  resize();
  [gOcean, gGrat, gOther, gFlags, gCovers, gBorders, gPoles].forEach(g => g.selectAll('*').remove());
  Object.keys(coverEl).forEach(k => delete coverEl[k]);
  Object.keys(borderEl).forEach(k => delete borderEl[k]);
  Object.keys(flagShown).forEach(k => delete flagShown[k]);
  defs.selectAll('clipPath').remove();

  // Ozean (Kugel) + Gitternetz
  gOcean.append('path').attr('class', 'ocean-sphere').attr('d', path({ type: 'Sphere' }))
    .attr('fill', '#0c1d2e').attr('stroke', '#1c3348').attr('stroke-width', 1);
  gGrat.append('path').attr('d', path(d3.geoGraticule10()))
    .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,.035)').attr('stroke-width', .5);

  // Territorien (keine Länder in unserer 195er-Liste)
  (window.__other || []).forEach(f => gOther.append('path').attr('class', 'other-land').attr('d', path(f)));

  // Unsere Länder: Grau-Cover + Rand
  COUNTRIES.forEach(c => {
    const f = features[c.iso2]; if (!f) return;
    const d = path(f);
    const cover = gCovers.append('path').attr('class', 'cover').attr('d', d)
      .attr('data-iso', c.iso2).node();
    coverEl[c.iso2] = cover;
    const border = gBorders.append('path').attr('class', 'border').attr('d', d).node();
    borderEl[c.iso2] = border;
    attachPress(cover, c.iso2);
    if (state.visited[c.iso2]) applyVisitedVisual(c.iso2, false);
    if (state.capitals[c.iso2]) drawCapital(c.iso2);
  });
}

/* ---------- Flagge unter dem Land sichtbar machen ---------- */
function applyVisitedVisual(iso, animate) {
  const f = features[iso]; if (!f) return;
  if (!flagShown[iso]) {
    const b = path.bounds(f);
    const x = b[0][0], y = b[0][1], w = b[1][0] - x, h = b[1][1] - y;
    defs.append('clipPath').attr('id', 'cp-' + iso).append('path').attr('d', path(f));
    gFlags.append('image').attr('class', 'flag-img')
      .attr('href', FLAG(iso)).attr('x', x).attr('y', y).attr('width', w).attr('height', h)
      .attr('preserveAspectRatio', 'xMidYMid slice')
      .attr('clip-path', 'url(#cp-' + iso + ')');
    flagShown[iso] = true;
  }
  const cover = coverEl[iso], border = borderEl[iso];
  if (cover) cover.classList.add('visited');
  if (border) border.classList.add('visited-b');
  if (animate) {
    // kleiner „Aufleucht"-Effekt
    const f2 = gFlags.select('image:last-child');
    f2.style('opacity', 0.2).transition().duration(500).style('opacity', 1);
  }
}
function removeVisitedVisual(iso) {
  const cover = coverEl[iso], border = borderEl[iso];
  if (cover) cover.classList.remove('visited');
  if (border) border.classList.remove('visited-b');
  const img = gFlags.selectAll('image').filter(function () {
    return this.getAttribute('clip-path') === 'url(#cp-' + iso + ')';
  });
  img.remove();
  defs.select('#cp-' + iso).remove();
  flagShown[iso] = false;
}

/* ---------- Dezenter Hauptstadt-Marker (goldener Punkt an der echten Hauptstadt) ---------- */
function drawCapital(iso) {
  const c = byIso[iso]; if (!c || c.clat == null || !projection) return;
  const p = projection([c.clng, c.clat]); if (!p || isNaN(p[0])) return;
  const g = gPoles.append('g').attr('class', 'capmark').attr('data-iso', iso)
    .attr('transform', `translate(${p[0]},${p[1]})`);
  g.append('circle').attr('class', 'halo').attr('r', 4);
  g.append('circle').attr('class', 'dot').attr('r', 1.8);
}
function removeCapital(iso) { gPoles.selectAll('.capmark').filter(function () { return this.getAttribute('data-iso') === iso; }).remove(); }

/* ---------- Toggles ---------- */
function setVisited(iso, on, animate) {
  if (on) { state.visited[iso] = true; applyVisitedVisual(iso, animate); }
  else { delete state.visited[iso]; removeVisitedVisual(iso); if (state.capitals[iso]) setCapital(iso, false); }
  save(); refreshCounters(); syncGridCell(iso); syncDetail(iso);
}
function setCapital(iso, on) {
  if (on) { state.capitals[iso] = true; if (!state.visited[iso]) { state.visited[iso] = true; applyVisitedVisual(iso, true); } drawCapital(iso); }
  else { delete state.capitals[iso]; removeCapital(iso); }
  save(); refreshCounters(); syncGridCell(iso); syncDetail(iso);
}

/* ---------- Long-Press ---------- */
let press = null;
function attachPress(el, iso) {
  el.addEventListener('pointerdown', (e) => startPress(e, iso), { passive: true });
}
function startPress(e, iso) {
  if (press) endPress();
  const rect = wrap.getBoundingClientRect();
  press = { iso, startX: e.clientX, startY: e.clientY, t0: performance.now(), moved: false, done: false, raf: 0 };
  coverEl[iso] && coverEl[iso].classList.add('arming');
  positionRing(e.clientX - rect.left, e.clientY - rect.top);
  ring.classList.add('on');
  const tick = (now) => {
    if (!press) return;
    const p = Math.min(1, (now - press.t0) / HOLD_MS);
    ringProg.style.strokeDashoffset = String(176 * (1 - p));
    if (p >= 1) { completePress(); return; }
    press.raf = requestAnimationFrame(tick);
  };
  press.raf = requestAnimationFrame(tick);
  window.addEventListener('pointermove', onPressMove, { passive: true });
  window.addEventListener('pointerup', onPressUp, { passive: true });
  window.addEventListener('pointercancel', onPressUp, { passive: true });
}
function onPressMove(e) {
  if (!press) return;
  if (Math.abs(e.clientX - press.startX) > MOVE_CANCEL || Math.abs(e.clientY - press.startY) > MOVE_CANCEL) {
    press.moved = true; cancelPressVisual(); // Schieben -> abbrechen (Karte pannen)
  }
}
function onPressUp() {
  if (!press) return;
  const elapsed = performance.now() - press.t0;
  const iso = press.iso, moved = press.moved, done = press.done;
  endPress();
  if (done) return;
  if (!moved && elapsed < TAP_MS) openDetail(iso);   // kurzer Tipp
}
function completePress() {
  if (!press || press.done) return;
  const iso = press.iso; press.done = true;
  cancelPressVisual();
  const nowOn = !state.visited[iso];
  setVisited(iso, nowOn, true);
  haptic();
  const c = byIso[iso];
  if (nowOn) { toast(`${c.emoji || ''} ${c.name} freigeschaltet!`); setTimeout(() => openDetail(iso), 350); }
  else toast(`${c.name} wieder ausgegraut`);
}
function cancelPressVisual() {
  ring.classList.remove('on');
  Object.values(coverEl).forEach(el => el.classList.remove('arming'));
}
function endPress() {
  if (!press) return;
  cancelAnimationFrame(press.raf);
  cancelPressVisual();
  window.removeEventListener('pointermove', onPressMove);
  window.removeEventListener('pointerup', onPressUp);
  window.removeEventListener('pointercancel', onPressUp);
  press = null;
}

/* Ring-Element */
let ring, ringProg;
function buildPressRing() {
  ring = document.createElement('div'); ring.id = 'press-ring';
  ring.innerHTML = '<svg viewBox="0 0 64 64" width="64" height="64"><circle class="track" cx="32" cy="32" r="28"/><circle class="prog" cx="32" cy="32" r="28"/></svg>';
  wrap.appendChild(ring);
  ringProg = ring.querySelector('.prog');
}
function positionRing(x, y) { ring.style.left = x + 'px'; ring.style.top = y + 'px'; ringProg.style.strokeDashoffset = '176'; }

/* ---------- Fly-to ---------- */
function flyTo(iso, k, dur) {
  const f = features[iso]; if (!f || !projection) return;
  const c = path.centroid(f); if (isNaN(c[0])) return;
  k = k || 3.4; dur = dur == null ? 700 : dur;
  const t = d3.zoomIdentity.translate(W / 2 - k * c[0], H / 2 - k * c[1]).scale(k);
  if (dur === 0) svg.call(zoom.transform, t);
  else svg.transition().duration(dur).call(zoom.transform, t);
}

/* ---------- Detail-Panel ---------- */
const detail = document.getElementById('detail');
let detailIso = null, clockTimer = null;
function openDetail(iso) {
  const c = byIso[iso]; if (!c) return;
  detailIso = iso;
  document.getElementById('d-flag').src = FLAG(iso, 'w640');
  document.getElementById('d-name').textContent = c.name;
  document.getElementById('d-region').textContent = c.region || '';
  document.getElementById('d-cap').innerHTML = c.capital ? `Hauptstadt: <b>${c.capital}</b>` : '';
  syncDetail(iso);
  updateClock();
  clearInterval(clockTimer); clockTimer = setInterval(updateClock, 1000);
  detail.classList.remove('hidden'); detail.setAttribute('aria-hidden', 'false');
}
function closeDetail() {
  detail.classList.add('hidden'); detail.setAttribute('aria-hidden', 'true');
  clearInterval(clockTimer); detailIso = null;
}
function syncDetail(iso) {
  if (detailIso !== iso) return;
  const v = document.getElementById('d-visit'), cap = document.getElementById('d-capital');
  v.classList.toggle('on', !!state.visited[iso]);
  v.textContent = state.visited[iso] ? 'Land besucht' : 'Land besucht';
  cap.classList.toggle('on', !!state.capitals[iso]);
}
function updateClock() {
  if (!detailIso) return;
  const c = byIso[detailIso];
  const now = new Date();
  document.getElementById('d-clock').textContent =
    new Intl.DateTimeFormat('de-DE', { timeZone: c.tz, hour: '2-digit', minute: '2-digit' }).format(now);
  document.getElementById('d-offset').textContent = offsetLabel(c.tz);
}
function zoneHours(tz) {
  const now = new Date();
  const inv = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return (inv - utc) / 3600000;
}
function offsetLabel(tz) {
  let diff = zoneHours(tz) - zoneHours(LOCAL_TZ);
  diff = Math.round(diff * 2) / 2;
  if (Math.abs(diff) < 0.01) return 'Gleiche Uhrzeit wie bei dir';
  const sign = diff > 0 ? '+' : '−';
  const val = Math.abs(diff).toString().replace('.', ',');
  return `${sign}${val} Std zu deiner Zeit`;
}

document.getElementById('detail-close').addEventListener('click', closeDetail);
detail.addEventListener('click', (e) => { if (e.target === detail) closeDetail(); });
document.getElementById('d-visit').addEventListener('click', () => detailIso && setVisited(detailIso, !state.visited[detailIso], true));
document.getElementById('d-capital').addEventListener('click', () => detailIso && setCapital(detailIso, !state.capitals[detailIso]));

/* ---------- Flaggen-Leiste ---------- */
const grid = document.getElementById('flag-grid');
const cellEl = {};
function buildGrid() {
  COUNTRIES.forEach(c => {
    const cell = document.createElement('div');
    cell.className = 'flag-cell';
    cell.dataset.iso = c.iso2; cell.dataset.name = c.name.toLowerCase();
    cell.innerHTML =
      `<img loading="lazy" src="${FLAG(c.iso2, 'w80')}" alt="${c.name}">` +
      `<span>${c.name}</span><i class="cap-dot"></i>`;
    cell.addEventListener('click', () => { flyTo(c.iso2, 3.6); openDetail(c.iso2); });
    grid.appendChild(cell);
    cellEl[c.iso2] = cell;
  });
  syncAllGrid();
}
function syncGridCell(iso) {
  const cell = cellEl[iso]; if (!cell) return;
  cell.classList.toggle('on', !!state.visited[iso]);
  cell.classList.toggle('cap', !!state.capitals[iso]);
}
function syncAllGrid() { COUNTRIES.forEach(c => syncGridCell(c.iso2)); }

// Suche + Filter
let curFilter = 'all', curQuery = '';
document.getElementById('search').addEventListener('input', (e) => { curQuery = e.target.value.trim().toLowerCase(); applyGridFilter(); });
document.querySelector('.seg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.seg button').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); curFilter = b.dataset.filter; applyGridFilter();
});
function applyGridFilter() {
  COUNTRIES.forEach(c => {
    const cell = cellEl[c.iso2];
    const matchQ = !curQuery || c.name.toLowerCase().includes(curQuery);
    const vis = !!state.visited[c.iso2];
    const matchF = curFilter === 'all' || (curFilter === 'visited' && vis) || (curFilter === 'open' && !vis);
    cell.style.display = (matchQ && matchF) ? '' : 'none';
  });
}

/* ---------- Zähler ---------- */
function refreshCounters() {
  const nc = Object.keys(state.visited).length;
  const ncap = Object.keys(state.capitals).length;
  const pct = (nc / TOTAL * 100);
  document.getElementById('pct-num').textContent = pct === 0 ? '0' : pct.toFixed(1).replace('.', ',');
  document.getElementById('bar-fill').style.width = pct + '%';
  document.getElementById('c-countries').textContent = nc;
  document.getElementById('c-capitals').textContent = ncap;
}

/* ---------- Helpers ---------- */
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function haptic() { if (navigator.vibrate) navigator.vibrate(30); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* Sync-Button */
document.getElementById('btn-sync').addEventListener('click', () => {
  if (window.RubbelSync) window.RubbelSync.openPanel();
  else toast('Geräte-Sync richten wir als Nächstes ein ☁️');
});

/* Schnittstelle für den Cloud-Sync (sync.js) */
window.Rubbel = {
  getState: () => state,
  applyState: (remote) => {
    if (!remote) return;
    state = { visited: remote.visited || {}, capitals: remote.capitals || {} };
    localStorage.setItem(LS_KEY, JSON.stringify(state));   // lokal spiegeln, ohne erneuten Push
    if (projection) render();
    refreshCounters(); syncAllGrid();
    if (detailIso) syncDetail(detailIso);
  }
};
