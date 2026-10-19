// Spot-Liste, Ortssuche, Spot teilen und Export als Tabelle (CSV).

// ---- Spot teilen ----

async function shareSpot(key) {
  const v = spotVisits(key)[0];
  if (!v) return;
  const name = spotName(key) || 'Angel-Spot';
  const coords = `${v.lat.toFixed(6)}, ${v.lng.toFixed(6)}`;
  const text = `${name}\n${coords}\nApple Karten: ${appleMapsUrl(key)}\n` +
    `Google Maps: https://maps.google.com/?q=${v.lat.toFixed(6)},${v.lng.toFixed(6)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: name, text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Spot-Daten in die Zwischenablage kopiert');
  } catch {
    prompt('Spot-Daten zum Kopieren:', text.replace(/\n/g, ' | '));
  }
}

function buildShareButton(key) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'apple-maps-link share-spot';
  b.textContent = 'Spot teilen';
  b.addEventListener('click', (e) => {
    L.DomEvent.stopPropagation(e);
    shareSpot(key);
  });
  return b;
}

// ---- Spot-Liste ----

const spotListEl = document.getElementById('spot-list');
const spotListBody = document.getElementById('spot-list-body');
const spotListSort = document.getElementById('spot-list-sort');
let spotSort = 'rating';
const SORTS = [['rating', 'Bewertung'], ['distance', 'Entfernung'], ['recent', 'Letzter Besuch'], ['name', 'Name']];

function lastVisitTime(visits) {
  const times = visits.map(visitTime).filter((t) => t !== null);
  return times.length ? Math.max(...times) : null;
}

function renderSpotList() {
  document.getElementById('spot-list-title').textContent = `Spots – ${MODES[currentMode].label}`;
  chipRow(spotListSort, SORTS, (v) => v === spotSort, (v) => { spotSort = v; renderSpotList(); });

  const items = allSpotKeys().map((key) => {
    const visits = spotVisits(key);
    const overall = overallRating(visits);
    const dist = currentPosition
      ? distanceKm(currentPosition.lat, currentPosition.lng, visits[0].lat, visits[0].lng) : null;
    const avgScore = visits.reduce((s, v) => s + SCORES[v.rating], 0) / visits.length;
    return { key, visits, overall, dist, avgScore, last: lastVisitTime(visits), name: spotName(key) || 'Spot' };
  });
  if (!items.length) {
    spotListBody.innerHTML = `<p class="analysis-empty">Noch keine ${MODES[currentMode].label}-Spots.</p>`;
    return;
  }
  const cmp = {
    rating: (a, b) => b.avgScore - a.avgScore || b.visits.length - a.visits.length,
    distance: (a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity),
    recent: (a, b) => (b.last ?? -Infinity) - (a.last ?? -Infinity),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
  }[spotSort];
  items.sort(cmp);

  spotListBody.innerHTML = '';
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'analysis-card spot-card';
    const fish = fishSummary(it.visits);
    const water = spotWaterTypes(it.key).map((t) => WATER_TYPES[t]).join(', ');
    card.innerHTML =
      `<div class="spot-card-head"><b>${escapeHtml(it.name)}</b> ${ratingBadge(it.overall)}</div>` +
      `<div class="muted">${it.visits.length} ${it.visits.length === 1 ? 'Besuch' : 'Besuche'}` +
      (it.last ? ` · zuletzt ${new Date(it.last).toLocaleDateString('de-DE')}` : '') +
      (it.dist !== null ? ` · ${it.dist < 10 ? it.dist.toFixed(1).replace('.', ',') : Math.round(it.dist)} km` : '') +
      '</div>' +
      (fish ? `<div class="cond"><b>Gefangen:</b> ${fish}</div>` : '') +
      (water ? `<div class="cond"><b>Gewässer:</b> ${water}</div>` : '');
    const actions = document.createElement('div');
    actions.className = 'spot-card-actions';
    const show = document.createElement('button');
    show.className = 'popup-add';
    show.textContent = 'Auf der Karte zeigen';
    show.addEventListener('click', () => {
      spotListEl.hidden = true;
      const v = it.visits[0];
      map.setView([v.lat, v.lng], Math.max(map.getZoom(), 15));
      openSpot(it.key);
    });
    actions.append(show, buildAppleMapsLink(it.key), buildShareButton(it.key));
    card.appendChild(actions);
    spotListBody.appendChild(card);
  }
}

document.getElementById('spot-list-open').addEventListener('click', () => {
  document.getElementById('backup-panel').hidden = true;
  spotListEl.hidden = false;
  renderSpotList();
});
document.getElementById('spot-list-close').addEventListener('click', () => { spotListEl.hidden = true; });

// ---- Ortssuche (Nominatim; Suche nur auf Knopfdruck, gemäß Nutzungsregeln) ----

const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

document.getElementById('search-toggle').addEventListener('click', () => {
  searchPanel.hidden = !searchPanel.hidden;
  if (!searchPanel.hidden) {
    document.getElementById('backup-panel').hidden = true;
    closeFilterPanel();
    searchInput.focus();
  }
});

document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchResults.innerHTML = '<li class="muted">Suche …</li>';
  try {
    const params = new URLSearchParams({ format: 'jsonv2', q, limit: '8', 'accept-language': 'de' });
    const results = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`);
    searchResults.innerHTML = '';
    if (!results.length) {
      searchResults.innerHTML = '<li class="muted">Nichts gefunden.</li>';
      return;
    }
    for (const r of results) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.display_name;
      b.addEventListener('click', () => {
        map.setView([Number(r.lat), Number(r.lon)], 15);
        searchPanel.hidden = true;
      });
      li.appendChild(b);
      searchResults.appendChild(li);
    }
  } catch {
    searchResults.innerHTML = '<li class="muted">Suche fehlgeschlagen – Internetverbindung prüfen.</li>';
  }
});

// ---- Export als Tabelle (CSV für Excel/Numbers) ----

function csvValue(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const header = [
    'Sparte', 'Spot', 'Breitengrad', 'Längengrad', 'Datum', 'Uhrzeit', 'Bewertung', 'Fischarten',
    'Größte Größe (cm)', 'Anzahl Fänge', 'Fangliste', 'Köder', 'Köder-Details', 'Angelmethode',
    'Gewässertyp', 'Wassertemperatur (°C)', 'Wassertemperatur Quelle', 'Trübung', 'Angeltiefe (m)',
    'Wetter', 'Lufttemperatur (°C)', 'Luftdruck (hPa)', 'Luftdruck Vortag', 'Luftdruck Folgetag',
    'Wind (km/h)', 'Windrichtung', 'Bewölkung (%)', 'Niederschlag (mm)', 'Wasserstand (cm)', 'Pegel',
    'Mondphase', 'Mond beleuchtet (%)', 'Session Beginn', 'Session Ende', 'Notizen',
  ];
  const rows = [...ratings]
    .filter((r) => RATINGS[r.rating])
    .sort((a, b) => (visitTime(a) ?? 0) - (visitTime(b) ?? 0))
    .map((v) => {
      const t = visitTime(v);
      const d = t !== null ? new Date(t) : null;
      const c = v.conditions || {};
      const w = c.weather || {};
      const p = c.pressure || {};
      const wl = c.waterLevel || {};
      const wt = effectiveWaterTemp(v);
      const sizes = Object.values(v.fishSizes || {}).filter(Number.isFinite);
      const catches = (v.catches || []).map((x) => [
        new Date(x.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        ALL_FISH[x.fish], x.size ? `${x.size} cm` : '', x.weight ? `${String(x.weight).replace('.', ',')} kg` : '',
        x.released === true ? 'zurückgesetzt' : x.released === false ? 'entnommen' : '',
      ].filter(Boolean).join(' ')).join(' | ');
      return [
        MODES[entryMode(v)].label, spotName(spotKey(v)) || '', v.lat.toFixed(6), v.lng.toFixed(6),
        d ? d.toLocaleDateString('de-DE') : '', d && !(v.manual && !v.visitedTime) ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '',
        RATINGS[v.rating].label, (v.fish || []).map((f) => ALL_FISH[f]).join(', '),
        sizes.length ? Math.max(...sizes) : null, (v.catches || []).length || null, catches,
        (v.baits || []).map((b) => ALL_BAITS[b]).join(', '), v.baitDetail || '',
        (v.methods || []).map((m) => ALL_METHODS[m]).join(', '),
        spotWaterTypes(spotKey(v)).map((x) => WATER_TYPES[x]).join(', '),
        wt ? wt.value : null, wt ? { manual: 'selbst gemessen', pegel: 'Pegel', estimate: 'geschätzt' }[wt.source] : '',
        v.turbidity ? TURBIDITY[v.turbidity] : '', Number.isFinite(v.depth) ? v.depth : null,
        w.description || '', w.temperature ?? null, p.current ?? null, p.yesterday ?? null, p.tomorrow ?? null,
        w.windSpeed ?? null, Number.isFinite(w.windDirection) ? windDirectionName(w.windDirection) : '',
        w.cloudCover ?? null, w.precipitation ?? null, wl.value ?? null, wl.station || '',
        v.moon ? v.moon.name : '', v.moon ? v.moon.illumination : null,
        v.sessionStart ? new Date(v.sessionStart).toLocaleString('de-DE') : '',
        v.sessionStart ? new Date(v.timestamp).toLocaleString('de-DE') : '',
        v.notes || '',
      ];
    });
  // BOM + Semikolon: Excel erkennt Umlaute und Spalten in deutscher Einstellung direkt.
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvValue).join(';')).join('\r\n');
  const file = new File([csv], `angel-spots-${localDateString(new Date())}.csv`, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Angel-Spots Tabelle' }).catch((err) => {
      if (!err || err.name !== 'AbortError') downloadFile(file);
    });
  } else {
    downloadFile(file);
  }
}

document.getElementById('csv-export').addEventListener('click', exportCsv);
