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

const DEPTH_BUCKETS = [
  ['unter 2 m', (d) => d < 2],
  ['2–4 m', (d) => d >= 2 && d < 4],
  ['4–6 m', (d) => d >= 4 && d < 6],
  ['6–10 m', (d) => d >= 6 && d < 10],
  ['ab 10 m', (d) => d >= 10],
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

// Alle Auswertungen: Titel, Kurzname für die Erkenntnisse, Gruppierung, feste Reihenfolge.
function statDimensions() {
  return [
    { title: 'Nach Monat', short: 'Monat', order: MONTHS, groupsOf: (v) => {
      const t = visitTime(v);
      return t === null ? [] : [MONTHS[new Date(t).getMonth()]];
    } },
    { title: 'Nach Tageszeit', short: 'Tageszeit', order: DAYTIME_BUCKETS.map((b) => b[0]),
      groupsOf: (v) => bucketOf(DAYTIME_BUCKETS, hourOf(v)) },
    { title: 'Nach Luftdruckverlauf (24 h)', short: 'Luftdruck', order: PRESSURE_BUCKETS.map((b) => b[0]),
      groupsOf: (v) => {
        const p = v.conditions && v.conditions.pressure;
        const t = p && Number.isFinite(p.current) && Number.isFinite(p.yesterday) ? p.current - p.yesterday : null;
        return bucketOf(PRESSURE_BUCKETS, t);
      } },
    { title: 'Nach Mondphase', short: 'Mond', order: MOON_BUCKETS.map((b) => b[0]), groupsOf: (v) => {
      const phase = v.moon && Number.isFinite(v.moon.phase) ? v.moon.phase : null;
      return bucketOf(MOON_BUCKETS, phase);
    } },
    { title: 'Nach Wassertemperatur', short: 'Wasser', order: WATER_TEMP_BUCKETS.map((b) => b[0]), groupsOf: (v) => {
      const wt = effectiveWaterTemp(v);
      return bucketOf(WATER_TEMP_BUCKETS, wt ? wt.value : null);
    } },
    { title: 'Nach Wassertrübung', short: 'Trübung', order: Object.values(TURBIDITY),
      groupsOf: (v) => (v.turbidity ? [TURBIDITY[v.turbidity]] : []) },
    { title: 'Nach Angeltiefe', short: 'Tiefe', order: DEPTH_BUCKETS.map((b) => b[0]),
      groupsOf: (v) => bucketOf(DEPTH_BUCKETS, v.depth) },
    { title: 'Nach Köder', short: 'Köder', groupsOf: (v) => (v.baits || []).map((b) => ALL_BAITS[b]) },
    { title: 'Nach Angelmethode', short: 'Methode', groupsOf: (v) => (v.methods || []).map((m) => ALL_METHODS[m]) },
    { title: 'Nach Gewässertyp', short: 'Gewässer',
      groupsOf: (v) => spotWaterTypes(spotKey(v)).map((w) => WATER_TYPES[w]) },
  ];
}

// Erkenntnisse in Worten: je Auswertung die Gruppe, die mit mindestens 2 Besuchen deutlich
// besser (bzw. schlechter) als der Durchschnitt aller Besuche abschneidet.
function insightsHtml(visits, dims) {
  const overall = avg(visits.map((v) => SCORES[v.rating]));
  const good = [];
  const bad = [];
  for (const d of dims) {
    const groups = [...groupRatings(visits, d.groupsOf).entries()].filter(([, s]) => s.length >= 2);
    if (groups.length < 2) continue; // nur vergleichen, wenn es Alternativen gibt
    const best = groups.reduce((a, b) => (avg(b[1]) > avg(a[1]) ? b : a));
    const worst = groups.reduce((a, b) => (avg(b[1]) < avg(a[1]) ? b : a));
    if (avg(best[1]) >= overall + 0.25) good.push({ d, label: best[0], scores: best[1] });
    if (avg(worst[1]) <= overall - 0.5) bad.push({ d, label: worst[0], scores: worst[1] });
  }
  const item = ({ d, label, scores }) =>
    `<li><b>${d.short}:</b> ${escapeHtml(label)} <span class="muted">(Ø ${avgLabel(avg(scores))}, ${scores.length} Besuche)</span></li>`;
  const who = statsFishFilter ? `${ALL_FISH[statsFishFilter]}-` : '';
  if (!good.length && !bad.length) {
    return '<section class="stat-section insights"><h3>Erkenntnisse</h3><p class="muted">Noch zu wenige Daten: ' +
      'Für Aussagen braucht es je Bedingung mindestens 2 Besuche und einen Vergleich.</p></section>';
  }
  return '<section class="stat-section insights"><h3>Erkenntnisse</h3>' +
    (good.length ? `<p>Deine besten ${who}Tage hattest du bei:</p><ul>${good.map(item).join('')}</ul>` : '') +
    (bad.length ? `<p>Eher schwach lief es bei:</p><ul>${bad.map(item).join('')}</ul>` : '') +
    `<p class="muted">Verglichen mit deinem Durchschnitt (${avgLabel(overall)}).</p></section>`;
}

// Saisonkalender: Ø-Bewertung je Spot und Monat (nur Monate mit Besuchen).
function seasonCalendarHtml(visits) {
  const months = new Set();
  const bySpot = new Map();
  for (const v of visits) {
    const t = visitTime(v);
    if (t === null) continue;
    const m = new Date(t).getMonth();
    months.add(m);
    const key = spotKey(v);
    if (!bySpot.has(key)) bySpot.set(key, new Map());
    const cell = bySpot.get(key);
    if (!cell.has(m)) cell.set(m, []);
    cell.get(m).push(SCORES[v.rating]);
  }
  if (!months.size) return '';
  const cols = [...months].sort((a, b) => a - b);
  const rows = [...bySpot.entries()].map(([key, cells]) => {
    const name = spotName(key) || 'Spot';
    const tds = cols.map((m) => {
      const scores = cells.get(m);
      if (!scores) return '<td></td>';
      const r = RATING_BY_SCORE[Math.min(4, Math.max(1, Math.round(avg(scores))))];
      return `<td><span class="season-cell" style="background:${RATINGS[r].color}" ` +
        `title="${escapeHtml(name)}, ${MONTHS[m]}: ${avgLabel(avg(scores))}, ${scores.length}×">` +
        `${RATINGS[r].label.replace('Sehr gut', 'S.gut')}</span></td>`;
    }).join('');
    return `<tr><th scope="row">${escapeHtml(name)}</th>${tds}</tr>`;
  }).join('');
  return '<section class="stat-section"><h3>Saisonkalender</h3>' +
    '<p class="muted stat-hint">Ø-Bewertung je Spot und Monat (über alle Jahre).</p>' +
    `<div class="season-scroll"><table class="season"><thead><tr><th></th>${cols.map((m) => `<th>${MONTHS[m]}</th>`).join('')}` +
    `</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// Einzelfänge (aus Sessions/Nachträgen) bzw. – bei Besuchen ohne Fangliste – die Fischart.
function catchesOf(v, f) {
  const list = (v.catches || []).filter((c) => c.fish === f);
  if (list.length) return list.map((c) => c.size).map((s) => (Number.isFinite(s) ? s : null));
  if ((v.fish || []).includes(f)) return [v.fishSizes && Number.isFinite(v.fishSizes[f]) ? v.fishSizes[f] : null];
  return [];
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

  // Fischarten mit Größen (Einzelfänge zählen einzeln)
  const fishKeys = statsFishFilter ? [statsFishFilter] : Object.keys(modeFish());
  let biggest = null;
  let totalCatches = 0;
  const fishRows = fishKeys.map((f) => {
    const all = visits.flatMap((v) => catchesOf(v, f));
    if (!all.length) return '';
    totalCatches += all.length;
    const sizes = all.filter(Number.isFinite);
    const max = sizes.length ? Math.max(...sizes) : null;
    if (max && (!biggest || max > biggest.size)) biggest = { fish: f, size: max };
    const mean = sizes.length ? Math.round(sizes.reduce((s, x) => s + x, 0) / sizes.length) : null;
    return `<div class="stat-fish"><b>${ALL_FISH[f]}</b> <span class="muted">${all.length}× gefangen</span>` +
      (max ? `<br>größter ${max} cm · Ø ${mean} cm <span class="muted">(${sizes.length} mit Größe)</span>` : '') +
      '</div>';
  }).join('');

  // Fangrate über alle Sessions (Fänge pro Stunde)
  const sessions = visits.filter((v) => v.sessionStart);
  const sessionMs = sessions.reduce((s, v) => s + (new Date(v.timestamp) - new Date(v.sessionStart)), 0);
  const sessionCatches = sessions.reduce((s, v) => s + (v.catches || [])
    .filter((c) => !statsFishFilter || c.fish === statsFishFilter).length, 0);
  const rate = sessionMs >= 15 * 60000 ? (sessionCatches / (sessionMs / 3600000)).toFixed(1).replace('.', ',') : null;

  const dims = statDimensions();
  let html = '<div class="stat-tiles">' +
    statTile('Spots', spots.size) +
    statTile('Besuche', visits.length) +
    statTile('Fänge', totalCatches) +
    statTile('Größter Fisch', biggest ? `${biggest.size} cm` : '–', biggest ? ALL_FISH[biggest.fish] : '') +
    statTile('Fangrate', rate ? `${rate}/h` : '–', rate
      ? `${sessions.length} ${sessions.length === 1 ? 'Session' : 'Sessions'}, ${(sessionMs / 3600000).toFixed(1).replace('.', ',')} h`
      : 'aus Angel-Sessions') +
    statTile('Schneidertage', sessions.filter((v) => !(v.catches || []).length).length, 'Sessions ohne Fang') +
    '</div>';
  html += insightsHtml(visits, dims);
  html += '<p class="stat-note">Balken = durchschnittliche Bewertung (Schlecht 1 … Sehr gut 4), ' +
    'dahinter die Anzahl der Besuche. Wenige Besuche sind wenig aussagekräftig.</p>';
  if (fishRows) html += `<section class="stat-section"><h3>Fischarten</h3>${fishRows}</section>`;
  html += seasonCalendarHtml(visits);
  for (const d of dims) html += barSection(d.title, groupRatings(visits, d.groupsOf), d.order);

  statsBody.innerHTML = html;
}

function openStats() {
  statsEl.hidden = false;
  document.getElementById('backup-panel').hidden = true;
  renderStats();
}

document.getElementById('stats-open').addEventListener('click', openStats);
document.getElementById('stats-close').addEventListener('click', () => { statsEl.hidden = true; });
