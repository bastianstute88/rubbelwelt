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
let state = { visited: {}, capitals: {}, heritage: {} };
try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s) state = Object.assign(state, s); } catch (e) {}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  if (window.RubbelSync) window.RubbelSync.push(state);   // Hook für spätere Cloud-Sync
}
// Entfernt verwaiste Welterbe-Schlüssel (z. B. vom früheren ID-Schema). true = etwas entfernt.
function pruneHeritage() {
  let changed = false;
  Object.keys(state.heritage || {}).forEach(id => {
    if (!heritageById[id]) { delete state.heritage[id]; changed = true; }
  });
  return changed;
}

/* ---------- Daten ---------- */
let COUNTRIES = [];       // die 195 UN-Länder
let TERRITORIES = [];     // Extra-Gebiete (Taiwan, Kosovo … – zählen separat)
let ALL = [];             // beide zusammen
let COUNTRY_SET = new Set();
let TERR_SET = new Set();
let byIso = {};           // iso -> eintrag
let byNum = {};           // num -> country
let features = {};        // iso -> GeoJSON feature (nur unsere 195)
let HERITAGE = [];        // UNESCO-Welterbestätten
let heritageById = {};    // id -> stätte
let heritageByIso = {};   // iso -> [stätten]
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ---------- SVG / D3 ---------- */
const svgEl = document.getElementById('map');
const wrap = document.getElementById('map-wrap');
const svg = d3.select(svgEl);
let W = 0, H = 0, projection, path, zoom, viewport;
let gOcean, gGrat, gOther, gFlags, gCovers, gBorders, gHeritage, gPoles, defs;
let curK = 1;
let flatMode = localStorage.getItem('rw_flat') === '1';   // flache Karte statt Globus-Look
const coverEl = {};       // iso -> <path.cover>
const borderEl = {};      // iso -> <path.border>
const flagShown = {};     // iso -> true (Flaggenbild schon erzeugt)

/* ---------- Init ---------- */
Promise.all([
  fetch('data/countries.json?v=16').then(r => r.json()),
  fetch('data/countries-50m.json?v=16').then(r => r.json()),
  fetch('data/territories.json?v=16').then(r => r.json()),
  fetch('data/heritage.json?v=16').then(r => r.json())
]).then(([countries, topo, territories, heritage]) => {
  COUNTRIES = countries;
  TERRITORIES = territories.sort((a, b) => a.name.localeCompare(b.name, 'de'));  // Extra-Gebiete alphabetisch
  ALL = COUNTRIES.concat(TERRITORIES);
  HERITAGE = heritage;
  HERITAGE.forEach(h => {
    heritageById[h.id] = h;
    h.iso.forEach(code => { (heritageByIso[code] = heritageByIso[code] || []).push(h); });
  });
  const prunedAtLoad = pruneHeritage();   // verwaiste Welterbe-Schlüssel entfernen
  COUNTRY_SET = new Set(COUNTRIES.map(c => c.iso2));
  TERR_SET = new Set(TERRITORIES.map(c => c.iso2));
  ALL.forEach(c => { byIso[c.iso2] = c; if (c.num) byNum[c.num] = c; });
  const terrByFeat = {};
  TERRITORIES.forEach(t => { terrByFeat[t.feat] = t; });

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

  // Extra-Gebiete (Taiwan, Kosovo …) über den Natural-Earth-Namen zuordnen -> freirubbelbar
  const rest = [];
  otherFeatures.forEach(f => {
    const t = terrByFeat[f.properties && f.properties.name];
    if (t) {
      const area = d3.geoArea(f);
      const cur = features[t.iso2];
      if (!cur || area > cur.__area) { f.__area = area; features[t.iso2] = f; }
    } else rest.push(f);
  });

  // Abtrünnige/umstrittene Gebiete ihrem Land zuschlagen (verschmelzen), damit sie
  // beim Freirubbeln des Landes mit-freigeschaltet werden und kein Fleck bleibt.
  // Nur zusammenhängende Gebiete verschmelzen (KEINE fernen Inseln – die würden die
  // Bounding-Box aufblähen und die Flaggen-Einpassung verzerren, z. B. Australien).
  const MERGE = { 'Somaliland': 'so', 'N. Cyprus': 'cy', 'W. Sahara': 'ma', 'Siachen Glacier': 'in' };
  const otherKept = [];
  rest.forEach(f => {
    const piso = MERGE[f.properties && f.properties.name];
    const parent = piso && features[piso];
    if (parent) {
      const pp = parent.geometry.type === 'Polygon' ? [parent.geometry.coordinates] : parent.geometry.coordinates;
      const ep = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      parent.geometry = { type: 'MultiPolygon', coordinates: pp.concat(ep) };
    } else otherKept.push(f);
  });
  window.__other = otherKept;

  // Französische Übersee-Départements aus dem Frankreich-Umriss herauslösen (eigene Extra-Gebiete)
  const dom = TERRITORIES.filter(t => t.splitFrom);
  [...new Set(dom.map(t => t.splitFrom))].forEach(piso => {
    const pf = features[piso]; if (!pf) return;
    const kids = dom.filter(t => t.splitFrom === piso);
    const polys = pf.geometry.type === 'Polygon' ? [pf.geometry.coordinates] : pf.geometry.coordinates;
    const keep = [], buckets = {};
    polys.forEach(poly => {
      const cen = d3.geoCentroid({ type: 'Polygon', coordinates: poly });
      let best = null, bestD = 0.25;   // Radius ~1600 km um die Départements-Koordinate
      kids.forEach(t => { const dd = d3.geoDistance(cen, [t.clng, t.clat]); if (dd < bestD) { bestD = dd; best = t; } });
      if (best) (buckets[best.iso2] = buckets[best.iso2] || []).push(poly); else keep.push(poly);
    });
    pf.geometry = { type: 'MultiPolygon', coordinates: keep };
    kids.forEach(t => { if (buckets[t.iso2]) features[t.iso2] = { type: 'Feature', properties: { name: t.name }, geometry: { type: 'MultiPolygon', coordinates: buckets[t.iso2] } }; });
  });

  buildGrid();
  setupSvg();
  render();
  refreshCounters();

  document.getElementById('loading').style.display = 'none';
  if (window.RubbelSync) window.RubbelSync.init();   // Cloud-Sync starten (falls eingerichtet)
  // Bereinigung persistieren (bei Sync erledigt das applyState nach dem Pull)
  if (prunedAtLoad && !(window.RubbelSync && window.RubbelSync.hasCode && window.RubbelSync.hasCode())) save();
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
  gHeritage = viewport.append('g');  // Welterbe-Marker (nur gesehene, als goldene Trophäen)
  gPoles   = viewport.append('g');

  zoom = d3.zoom().scaleExtent([1, 14])
    .on('zoom', (e) => {
      viewport.attr('transform', e.transform); curK = e.transform.k;
      // Hauptstadt-Punkte gegen-skalieren -> konstante Bildschirmgröße statt Riesenblasen
      gPoles.selectAll('.capmark').attr('transform', d => `translate(${d.x},${d.y}) scale(${1 / curK})`);
      gHeritage.selectAll('.hmark').attr('transform', d => `translate(${d.x},${d.y}) scale(${1 / curK})`);
    })
    .on('start', () => svgEl.classList.add('grabbing'))
    .on('end', () => svgEl.classList.remove('grabbing'));
  svg.call(zoom).on('dblclick.zoom', null);

  // Zoom-Buttons + Kartenform-Umschalter
  document.querySelector('.map-ctrl').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.proj !== undefined) { toggleProjection(); return; }
    const kind = b.dataset.zoom;
    if (kind === 'reset') svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
    else svg.transition().duration(250).call(zoom.scaleBy, kind === 'in' ? 1.6 : 1 / 1.6);
  });
  updateProjBtn();

  buildPressRing();
  window.addEventListener('resize', debounce(() => { render(); }, 200));
}

function toggleProjection() {
  flatMode = !flatMode;
  localStorage.setItem('rw_flat', flatMode ? '1' : '0');
  svg.call(zoom.transform, d3.zoomIdentity);   // Zoom zurücksetzen (curK -> 1)
  render();
  updateProjBtn();
  toast(flatMode ? 'Flache Karte' : 'Globus-Ansicht');
}
function updateProjBtn() {
  const b = document.querySelector('.map-ctrl [data-proj]');
  if (b) { b.textContent = flatMode ? '🌐' : '🗺️'; b.title = flatMode ? 'Zur Globus-Ansicht' : 'Zur flachen Karte'; }
}

function resize() {
  const r = wrap.getBoundingClientRect();
  W = r.width; H = r.height;
  svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);
  if (flatMode) {
    projection = d3.geoEquirectangular().fitWidth(W, { type: 'Sphere' });   // volle Breite
    const b = d3.geoPath(projection).bounds({ type: 'Sphere' });
    const t = projection.translate();
    projection.translate([t[0], t[1] + (H / 2 - (b[0][1] + b[1][1]) / 2)]);  // vertikal zentrieren
  } else {
    projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
  }
  path = d3.geoPath(projection);
}

/* ---------- Karte zeichnen ---------- */
function render() {
  resize();
  [gOcean, gGrat, gOther, gFlags, gCovers, gBorders, gHeritage, gPoles].forEach(g => g.selectAll('*').remove());
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

  // Länder + Extra-Gebiete: Grau-Cover + Rand
  ALL.forEach(c => {
    const f = features[c.iso2]; if (!f) return;
    const d = path(f);
    const cover = gCovers.append('path').attr('class', 'cover').attr('d', d)
      .attr('data-iso', c.iso2).node();
    coverEl[c.iso2] = cover;
    const border = gBorders.append('path').attr('class', 'border').attr('d', d).node();
    borderEl[c.iso2] = border;
    attachPress(cover, c.iso2);
    if (state.visited[c.iso2]) applyVisitedVisual(c.iso2, false);
    drawCapMarker(c.iso2);   // Hauptstadt-Punkt immer (dunkel, golden wenn besucht)
  });

  // Welterbe-Marker: nur die GESEHENEN als goldene Trophäen (kein grauer Punkte-Brei)
  HERITAGE.forEach(h => { if (state.heritage[h.id]) drawHmark(h); });
}

function drawHmark(h) {
  if (!projection) return;
  const p = projection([h.lng, h.lat]); if (!p || isNaN(p[0])) return;
  gHeritage.append('g').attr('class', 'hmark').attr('data-hid', h.id)
    .datum({ x: p[0], y: p[1] })
    .attr('transform', `translate(${p[0]},${p[1]}) scale(${1 / curK})`)
    .append('rect').attr('class', 'hdia').attr('x', -1.4).attr('y', -1.4)
    .attr('width', 2.8).attr('height', 2.8).attr('transform', 'rotate(45)');
}

/* ---------- Flagge unter dem Land sichtbar machen ----------
   Die Flagge wird PRO Landmasse (Polygon) separat eingepasst. So zeigt jede Insel /
   jedes Festland die komplette, unverzerrte Flagge – auch bei weit auseinander
   liegenden Teilen (USA mit Alaska/Hawaii, Chile mit Osterinsel …). */
function applyVisitedVisual(iso, animate) {
  const f = features[iso]; if (!f) return;
  if (!flagShown[iso]) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const added = [];
    polys.forEach((poly, idx) => {
      const geom = { type: 'Polygon', coordinates: poly };
      const b = path.bounds(geom);
      const x = b[0][0], y = b[0][1], w = b[1][0] - x, h = b[1][1] - y;
      if (!(w > 0.8 && h > 0.8)) return;             // sub-pixel-Inseln überspringen
      const cid = 'cp-' + iso + '-' + idx;
      defs.append('clipPath').attr('id', cid).append('path').attr('d', path(geom));
      // PNG (nicht SVG): iOS-Safari füllt <image>+SVG mit "slice" nur teilweise
      const img = gFlags.append('image').attr('class', 'flag-img').attr('data-iso', iso)
        .attr('href', FLAG(iso, 'w1280')).attr('x', x).attr('y', y).attr('width', w).attr('height', h)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('clip-path', 'url(#' + cid + ')');
      added.push(img);
    });
    flagShown[iso] = true;
    if (animate) added.forEach(im => im.style('opacity', 0.2).transition().duration(500).style('opacity', 1));
  }
  const cover = coverEl[iso], border = borderEl[iso];
  if (cover) cover.classList.add('visited');
  if (border) border.classList.add('visited-b');
}
function removeVisitedVisual(iso) {
  const cover = coverEl[iso], border = borderEl[iso];
  if (cover) cover.classList.remove('visited');
  if (border) border.classList.remove('visited-b');
  gFlags.selectAll('image').filter(function () { return this.getAttribute('data-iso') === iso; }).remove();
  defs.selectAll('clipPath').filter(function () { return this.id.indexOf('cp-' + iso + '-') === 0; }).remove();
  flagShown[iso] = false;
}

/* ---------- Hauptstadt-Marker: immer sichtbar (dunkler Punkt), golden wenn besucht ---------- */
function drawCapMarker(iso) {
  const c = byIso[iso]; if (!c || c.clat == null || !projection) return;
  const p = projection([c.clng, c.clat]); if (!p || isNaN(p[0])) return;
  const g = gPoles.append('g').attr('class', 'capmark' + (state.capitals[iso] ? ' on' : '')).attr('data-iso', iso)
    .datum({ x: p[0], y: p[1] })
    .attr('transform', `translate(${p[0]},${p[1]}) scale(${1 / curK})`);
  g.append('circle').attr('class', 'halo').attr('r', 3.6);
  g.append('circle').attr('class', 'dot').attr('r', state.capitals[iso] ? 1.7 : 1.25);
}
function setCapMarker(iso, on) {
  gPoles.selectAll('.capmark').filter(function () { return this.getAttribute('data-iso') === iso; })
    .select('.dot').attr('r', on ? 1.7 : 1.25);
  gPoles.selectAll('.capmark').filter(function () { return this.getAttribute('data-iso') === iso; }).classed('on', !!on);
}

/* ---------- Toggles ---------- */
function setVisited(iso, on, animate) {
  if (on) { state.visited[iso] = true; applyVisitedVisual(iso, animate); }
  else { delete state.visited[iso]; removeVisitedVisual(iso); if (state.capitals[iso]) setCapital(iso, false); }
  save(); refreshCounters(); syncGridCell(iso); syncDetail(iso);
}
function setCapital(iso, on) {
  if (on) { state.capitals[iso] = true; if (!state.visited[iso]) { state.visited[iso] = true; applyVisitedVisual(iso, true); } }
  else { delete state.capitals[iso]; }
  setCapMarker(iso, on);
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
  buildHeritageList(iso);
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
  v.textContent = (byIso[iso] && byIso[iso].terr) ? 'Gebiet besucht' : 'Land besucht';
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

/* ---------- Welterbe-Liste pro Land ---------- */
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function whCatIcon(cat) { return cat === 'N' ? '🌿' : cat === 'M' ? '🏞️' : '🏛️'; }
function buildHeritageList(iso) {
  const box = document.getElementById('d-heritage'), list = document.getElementById('wh-list');
  const sites = (heritageByIso[iso] || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!sites.length) { box.classList.add('hidden'); list.innerHTML = ''; return; }
  box.classList.remove('hidden');
  updateWhCount(iso);
  list.innerHTML = sites.map(s =>
    `<div class="wh-row${state.heritage[s.id] ? ' on' : ''}" data-hid="${s.id}">` +
    `<span class="wh-check"></span><span class="wh-cat">${whCatIcon(s.cat)}</span>` +
    `<span class="wh-name">${escapeHtml(s.name)}</span></div>`).join('');
}
function updateWhCount(iso) {
  const sites = heritageByIso[iso] || [];
  const seen = sites.filter(s => state.heritage[s.id]).length;
  const el = document.getElementById('wh-count'); if (el) el.textContent = `${seen} / ${sites.length} gesehen`;
}
function toggleHeritage(id) {
  if (state.heritage[id]) delete state.heritage[id]; else state.heritage[id] = true;
  const on = !!state.heritage[id];
  const row = document.querySelector('#wh-list .wh-row[data-hid="' + id + '"]');
  if (row) row.classList.toggle('on', on);
  if (on) drawHmark(heritageById[id]);
  else gHeritage.selectAll('.hmark').filter(function () { return this.getAttribute('data-hid') === id; }).remove();
  if (detailIso) updateWhCount(detailIso);
  save(); refreshCounters();
}
document.getElementById('wh-list').addEventListener('click', (e) => {
  const row = e.target.closest('.wh-row'); if (row) toggleHeritage(row.dataset.hid);
});

/* ---------- Übersicht pro Zähler (anklickbare Chips) ---------- */
const overview = document.getElementById('overview');
function ovRow(iso, name, sub, icon) {
  const left = icon ? `<span class="ov-ic">${icon}</span>` : `<img class="ov-flag" src="${FLAG(iso, 'w40')}" alt="">`;
  return `<div class="ov-row" data-iso="${iso}">${left}<div class="ov-txt"><div class="ov-name">${escapeHtml(name)}</div>` +
    (sub ? `<div class="ov-sub">${escapeHtml(sub)}</div>` : '') + '</div></div>';
}
function openOverview(kind) {
  let rows = [], title = '';
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  if (kind === 'countries') {
    const it = COUNTRIES.filter(c => state.visited[c.iso2]).sort(byName);
    title = `🗺️ Besuchte Länder · ${it.length} / ${TOTAL}`;
    rows = it.map(c => ovRow(c.iso2, c.name, state.capitals[c.iso2] ? '🚩 Hauptstadt: ' + c.capital : ''));
  } else if (kind === 'capitals') {
    const it = COUNTRIES.filter(c => state.capitals[c.iso2]).sort(byName);
    title = `🚩 Gesehene Hauptstädte · ${it.length} / ${TOTAL}`;
    rows = it.map(c => ovRow(c.iso2, c.capital, c.name));
  } else if (kind === 'extra') {
    const it = TERRITORIES.filter(c => state.visited[c.iso2]).sort(byName);
    title = `✨ Extra-Gebiete · ${it.length}`;
    rows = it.map(c => ovRow(c.iso2, c.name, c.region || ''));
  } else if (kind === 'heritage') {
    const it = HERITAGE.filter(h => state.heritage[h.id]).sort(byName);
    title = `🏛️ Gesehene Welterbestätten · ${it.length}`;
    rows = it.map(h => { const iso = h.iso[0]; return ovRow(iso, h.name, byIso[iso] ? byIso[iso].name : '', whCatIcon(h.cat)); });
  }
  document.getElementById('ov-title').textContent = title;
  document.getElementById('ov-list').innerHTML = rows.length ? rows.join('') : '<div class="ov-empty">Noch nichts markiert – leg los! 🙂</div>';
  overview.classList.remove('hidden');
}
document.getElementById('ov-list').addEventListener('click', (e) => {
  const row = e.target.closest('.ov-row'); if (!row) return;
  overview.classList.add('hidden');
  const iso = row.dataset.iso; flyTo(iso, 3.6); openDetail(iso);
});
document.getElementById('ov-close').addEventListener('click', () => overview.classList.add('hidden'));
overview.addEventListener('click', (e) => { if (e.target === overview) overview.classList.add('hidden'); });
[['chip-countries', 'countries'], ['chip-capitals', 'capitals'], ['chip-extra', 'extra'], ['chip-wh', 'heritage']]
  .forEach(([id, kind]) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => openOverview(kind)); });

/* ---------- Flaggen-Leiste ---------- */
const grid = document.getElementById('flag-grid');
const cellEl = {};
function buildGrid() {
  COUNTRIES.forEach(c => addCell(c, false));
  if (TERRITORIES.length) {
    const sec = document.createElement('div');
    sec.className = 'grid-section'; sec.id = 'grid-section-terr';
    sec.textContent = '✨ Extra-Gebiete (zählen separat)';
    grid.appendChild(sec);
    TERRITORIES.forEach(c => addCell(c, true));
  }
  syncAllGrid();
}
function addCell(c, terr) {
  const cell = document.createElement('div');
  cell.className = 'flag-cell' + (terr ? ' terr' : '');
  cell.dataset.iso = c.iso2; cell.dataset.name = c.name.toLowerCase();
  cell.innerHTML =
    `<img loading="lazy" src="${FLAG(c.iso2, 'w80')}" alt="${c.name}">` +
    `<span>${c.name}</span><i class="cap-dot"></i>`;
  cell.addEventListener('click', () => { flyTo(c.iso2, 3.6); openDetail(c.iso2); });
  grid.appendChild(cell);
  cellEl[c.iso2] = cell;
}
function syncGridCell(iso) {
  const cell = cellEl[iso]; if (!cell) return;
  cell.classList.toggle('on', !!state.visited[iso]);
  cell.classList.toggle('cap', !!state.capitals[iso]);
}
function syncAllGrid() { ALL.forEach(c => syncGridCell(c.iso2)); }

// Suche + Filter
let curFilter = 'all', curQuery = '';
document.getElementById('search').addEventListener('input', (e) => { curQuery = e.target.value.trim().toLowerCase(); applyGridFilter(); });
document.querySelector('.seg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.seg button').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); curFilter = b.dataset.filter; applyGridFilter();
});
function applyGridFilter() {
  let terrVisible = 0;
  ALL.forEach(c => {
    const cell = cellEl[c.iso2];
    const matchQ = !curQuery || c.name.toLowerCase().includes(curQuery);
    const vis = !!state.visited[c.iso2];
    const matchF = curFilter === 'all' || (curFilter === 'visited' && vis) || (curFilter === 'open' && !vis);
    const show = matchQ && matchF;
    cell.style.display = show ? '' : 'none';
    if (show && c.terr) terrVisible++;
  });
  const sec = document.getElementById('grid-section-terr');
  if (sec) sec.style.display = terrVisible ? '' : 'none';
  grid.scrollTop = 0;   // nach Filterwechsel oben starten (sonst hängt man bei wenig Treffern im Leeren)
}

/* ---------- Zähler ---------- */
function refreshCounters() {
  const nc = Object.keys(state.visited).filter(i => COUNTRY_SET.has(i)).length;   // nur die 195
  const ncap = Object.keys(state.capitals).filter(i => COUNTRY_SET.has(i)).length;
  const nterr = Object.keys(state.visited).filter(i => TERR_SET.has(i)).length;   // Extra-Gebiete separat
  const pct = (nc / TOTAL * 100);
  document.getElementById('pct-num').textContent = pct === 0 ? '0' : pct.toFixed(1).replace('.', ',');
  document.getElementById('bar-fill').style.width = pct + '%';
  document.getElementById('c-countries').textContent = nc;
  document.getElementById('c-capitals').textContent = ncap;
  const ex = document.getElementById('chip-extra');
  if (ex) { ex.style.display = nterr > 0 ? '' : 'none'; document.getElementById('c-extra').textContent = nterr; }
  const nwh = Object.keys(state.heritage).length;
  const wc = document.getElementById('chip-wh');
  if (wc) { wc.style.display = nwh > 0 ? '' : 'none'; document.getElementById('c-wh').textContent = nwh; }
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
    state = { visited: remote.visited || {}, capitals: remote.capitals || {}, heritage: remote.heritage || {} };
    if (pruneHeritage()) save();   // verwaiste Welterbe-Schlüssel auch aus dem Sync entfernen
    else localStorage.setItem(LS_KEY, JSON.stringify(state));   // lokal spiegeln, ohne erneuten Push
    if (projection) render();
    refreshCounters(); syncAllGrid();
    if (detailIso) { syncDetail(detailIso); buildHeritageList(detailIso); }
  }
};
