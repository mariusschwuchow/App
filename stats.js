// Fangstatistik der gewählten Sparte: Kennzahlen, Fischarten mit Größen und die
// durchschnittliche Bewertung nach Monat, Tageszeit, Luftdruckverlauf, Mondphase,
// Köder, Gewässertyp und Wassertemperatur.

const statsEl = document.getElementById('stats');
const statsBody = document.getElementById('stats-body');
const statsFish = document.getElementById('stats-fish');
const statsTitle = document.getElementById('stats-title');
let statsFishFilter = null;

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const DAYTIME_BUCKETS = [
  ['Morgen (5–9 Uhr)', (h) => h >= 5 && h < 9],
  ['Vormittag (9–12)', (h) => h >= 9 && h < 12],
  ['Mittag (12–15)', (h) => h >= 12 && h < 15],
  ['Nachmittag (15–18)', (h) => h >= 15 && h < 18],
  ['Abend (18–22)', (h) => h >= 18 && h < 22],
  ['Nacht (22–5)', (h) => h >= 22 || h < 5],
];

const PRESSURE_BUCKETS = [
  ['Stark fallend (< −2 hPa)', (t) => t < -2],
  ['Leicht fallend', (t) => t >= -2 && t < -0.5],
  ['Stabil (±0,5 hPa)', (t) => t >= -0.5 && t <= 0.5],
  ['Leicht steigend', (t) => t > 0.5 && t <= 2],
  ['Stark steigend (> +2 hPa)', (t) => t > 2],
];

const MOON_BUCKETS = [
  ['🌑 Um Neumond', (p) => p < 0.125 || p >= 0.875],
  ['🌓 Zunehmend', (p) => p >= 0.125 && p < 0.375],
  ['🌕 Um Vollmond', (p) => p >= 0.375 && p < 0.625],
  ['🌗 Abnehmend', (p) => p >= 0.625 && p < 0.875],
];

const WATER_TEMP_BUCKETS = [
  ['unter 8 °C', (t) => t < 8],
  ['8–12 °C', (t) => t >= 8 && t < 12],
  ['12–16 °C', (t) => t >= 12 && t < 16],
  ['16–20 °C', (t) => t >= 16 && t < 20],
  ['ab 20 °C', (t) => t >= 20],
];

function statsVisits() {
  const visits = allSpotKeys().flatMap((key) => spotVisits(key));
  return statsFishFilter ? visits.filter((v) => (v.fish || []).includes(statsFishFilter)) : visits;
}

// Gruppiert Besuche (ein Besuch kann in mehreren Gruppen landen, z. B. mehrere Köder).
function groupRatings(visits, groupsOf) {
  const groups = new Map();
  for (const v of visits) {
    for (const g of groupsOf(v)) {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(SCORES[v.rating]);
    }
  }
  return groups;
}

function bucketOf(buckets, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return [];
  const b = buckets.find(([, test]) => test(value));
  return b ? [b[0]] : [];
}

function avgLabel(avg) {
  const key = RATING_BY_SCORE[Math.min(4, Math.max(1, Math.round(avg)))];
  return `${RATINGS[key].label} (${avg.toFixed(1).replace('.', ',')})`;
}

// Balkenliste: Länge = Ø-Bewertung (Skala 0–4), Wert und Anzahl direkt am Balken.
function barSection(title, groups, order) {
  const rows = order
    ? order.filter((label) => groups.has(label)).map((label) => [label, groups.get(label)])
    : [...groups.entries()].sort((a, b) => avg(b[1]) - avg(a[1]) || b[1].length - a[1].length);
  if (!rows.length) return '';
  const html = rows.map(([label, scores]) => {
    const a = avg(scores);
    const text = `${avgLabel(a)} · ${scores.length}×`;
    return `<div class="stat-row" title="${escapeHtml(label)}: ${text}">` +
      `<span class="stat-label">${escapeHtml(label)}</span>` +
      `<span class="stat-track"><span class="stat-bar" style="width:${(a / 4) * 100}%"></span></span>` +
      `<span class="stat-value">${text}</span></div>`;
  }).join('');
  return `<section class="stat-section"><h3>${title}</h3>${html}</section>`;
}

function avg(scores) {
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

function statTile(label, value, sub = '') {
  return `<div class="stat-tile"><div class="stat-tile-label">${label}</div>` +
    `<div class="stat-tile-value">${value}</div>${sub ? `<div class="stat-tile-sub">${sub}</div>` : ''}</div>`;
}

function hourOf(v) {
  const t = visitTime(v);
  if (t === null || (v.manual && !v.visitedTime)) return null; // ohne Uhrzeit keine Tageszeit
  return new Date(t).getHours();
}

function renderStats() {
  if (statsFishFilter && !modeFish()[statsFishFilter]) statsFishFilter = null;
  statsTitle.textContent = `Fangstatistik – ${MODES[currentMode].label}`;
  chipRow(statsFish, [[null, 'Alle'], ...Object.entries(modeFish())],
    (v) => v === statsFishFilter, (v) => { statsFishFilter = v; renderStats(); });

  const visits = statsVisits();
  const spots = new Set(visits.map(spotKey));
  if (!visits.length) {
    statsBody.innerHTML = `<p class="analysis-empty">${statsFishFilter
      ? `Noch keine Besuche mit ${ALL_FISH[statsFishFilter]}.`
      : `Noch keine ${MODES[currentMode].label}-Besuche gespeichert.`}</p>`;
    return;
  }

  // Fischarten mit Größen
  const fishKeys = statsFishFilter ? [statsFishFilter] : Object.keys(modeFish());
  let biggest = null;
  const fishRows = fishKeys.map((f) => {
    const withFish = visits.filter((v) => (v.fish || []).includes(f));
    if (!withFish.length) return '';
    const sizes = withFish.map((v) => v.fishSizes && v.fishSizes[f]).filter(Number.isFinite);
    const max = sizes.length ? Math.max(...sizes) : null;
    if (max && (!biggest || max > biggest.size)) biggest = { fish: f, size: max };
    const mean = sizes.length ? Math.round(sizes.reduce((s, x) => s + x, 0) / sizes.length) : null;
    return `<div class="stat-fish"><b>${ALL_FISH[f]}</b> <span class="muted">${withFish.length}× gefangen</span>` +
      (max ? `<br>größter ${max} cm · Ø ${mean} cm <span class="muted">(${sizes.length} mit Größe)</span>` : '') +
      '</div>';
  }).join('');

  const catches = visits.filter((v) => (v.fish || []).length).length;
  let html = '<div class="stat-tiles">' +
    statTile('Spots', spots.size) +
    statTile('Besuche', visits.length) +
    statTile('Mit Fang', catches) +
    statTile('Größter Fisch', biggest ? `${biggest.size} cm` : '–', biggest ? ALL_FISH[biggest.fish] : '') +
    '</div>';
  html += '<p class="stat-note">Balken = durchschnittliche Bewertung (Schlecht 1 … Sehr gut 4), ' +
    'dahinter die Anzahl der Besuche. Wenige Besuche sind wenig aussagekräftig.</p>';
  if (fishRows) html += `<section class="stat-section"><h3>Fischarten</h3>${fishRows}</section>`;

  html += barSection('Nach Monat', groupRatings(visits, (v) => {
    const t = visitTime(v);
    return t === null ? [] : [MONTHS[new Date(t).getMonth()]];
  }), MONTHS);
  html += barSection('Nach Tageszeit', groupRatings(visits, (v) => bucketOf(DAYTIME_BUCKETS, hourOf(v))),
    DAYTIME_BUCKETS.map((b) => b[0]));
  html += barSection('Nach Luftdruckverlauf (24 h)', groupRatings(visits, (v) => {
    const p = v.conditions && v.conditions.pressure;
    const t = p && Number.isFinite(p.current) && Number.isFinite(p.yesterday) ? p.current - p.yesterday : null;
    return bucketOf(PRESSURE_BUCKETS, t);
  }), PRESSURE_BUCKETS.map((b) => b[0]));
  html += barSection('Nach Mondphase', groupRatings(visits, (v) => {
    const phase = v.moon && Number.isFinite(v.moon.phase) ? v.moon.phase : null;
    return bucketOf(MOON_BUCKETS, phase);
  }), MOON_BUCKETS.map((b) => b[0]));
  html += barSection('Nach Wassertemperatur', groupRatings(visits, (v) => {
    const wt = v.conditions && v.conditions.waterTemp;
    return bucketOf(WATER_TEMP_BUCKETS, wt ? wt.value : null);
  }), WATER_TEMP_BUCKETS.map((b) => b[0]));
  html += barSection('Nach Köder', groupRatings(visits, (v) => (v.baits || []).map((b) => ALL_BAITS[b])));
  html += barSection('Nach Gewässertyp', groupRatings(visits, (v) => spotWaterTypes(spotKey(v)).map((w) => WATER_TYPES[w])));

  statsBody.innerHTML = html;
}

function openStats() {
  statsEl.hidden = false;
  document.getElementById('backup-panel').hidden = true;
  renderStats();
}

document.getElementById('stats-open').addEventListener('click', openStats);
document.getElementById('stats-close').addEventListener('click', () => { statsEl.hidden = true; });
