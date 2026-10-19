// Spot-Liste, Ortssuche, Spot teilen und Export als Tabelle (CSV).

// ---- Spot teilen ----
// Der Link enthält den Spot im Fragment (#spot=…). Das Fragment wird nicht an den Server
// geschickt; die Daten stehen nur in der Nachricht selbst.

const SHARE_VERSION = 1;

function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Nur bekannte Felder mit gültigen Werten übernehmen (der Link kann von irgendwem kommen).
function validateSharedSpot(p) {
  if (!p || p.v !== SHARE_VERSION) return null;
  const lat = Number(p.la);
  const lng = Number(p.lo);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const spot = {
    name: typeof p.n === 'string' ? p.n.trim().slice(0, 80) : '',
    lat,
    lng,
    mode: MODES[p.m] ? p.m : 'raubfisch',
    waterTypes: Array.isArray(p.w) ? p.w.filter((w) => WATER_TYPES[w]) : [],
    summary: null,
  };
  if (p.s && typeof p.s === 'object') {
    spot.summary = {
      rating: RATINGS[p.s.r] ? p.s.r : null,
      visits: Number.isInteger(p.s.c) && p.s.c > 0 ? Math.min(p.s.c, 9999) : null,
      fish: Array.isArray(p.s.f) ? p.s.f
        .filter((f) => f && ALL_FISH[f.f])
        .map((f) => ({
          f: f.f,
          n: Number.isInteger(f.n) && f.n > 0 ? Math.min(f.n, 9999) : 1,
          max: Number.isFinite(f.max) && f.max > 0 && f.max <= 300 ? Math.round(f.max) : null,
        })) : [],
    };
  }
  return spot;
}

function sharePayload(key, withSummary) {
  const a = spotAnchor(key);
  const payload = {
    v: SHARE_VERSION,
    n: spotName(key) || '',
    la: Math.round(a.lat * 1e5) / 1e5,
    lo: Math.round(a.lng * 1e5) / 1e5,
    m: entryMode(a),
    w: spotWaterTypes(key),
  };
  const visits = spotVisits(key);
  if (withSummary && visits.length) {
    const fish = {};
    for (const v of visits) {
      for (const f of v.fish || []) {
        const catches = (v.catches || []).filter((c) => c.fish === f);
        const sizes = [...catches.map((c) => c.size), v.fishSizes && v.fishSizes[f]].filter(Number.isFinite);
        if (!fish[f]) fish[f] = { f, n: 0, max: null };
        fish[f].n += catches.length || 1;
        if (sizes.length) fish[f].max = Math.max(fish[f].max || 0, ...sizes);
      }
    }
    payload.s = { r: overallRating(visits), c: visits.length, f: Object.values(fish) };
  }
  return payload;
}

function shareLink(payload) {
  return `${location.origin}${location.pathname}#spot=${encodeShare(payload)}`;
}

async function shareSpot(key, withSummary) {
  const a = spotAnchor(key);
  if (!a) return;
  const name = spotName(key) || 'Angel-Spot';
  const link = shareLink(sharePayload(key, withSummary));
  const text = `🎣 Angel-Spot „${name}“\n` +
    `In der App übernehmen: ${link}\n` +
    `Apple Karten: ${appleMapsUrl(key)}\n` +
    `Google Maps: https://maps.google.com/?q=${a.lat.toFixed(6)},${a.lng.toFixed(6)}`;
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
    showToast('Spot-Nachricht in die Zwischenablage kopiert');
  } catch {
    prompt('Spot-Link zum Kopieren:', link);
  }
}

// Dialog vor dem Teilen: nur der Ort oder zusätzlich die Zusammenfassung.
const shareDialog = document.getElementById('share-dialog');
const shareSummary = document.getElementById('share-summary');
let shareKey = null;

function openShareDialog(key) {
  shareKey = key;
  const hasVisits = spotVisits(key).length > 0;
  shareSummary.checked = false;
  shareSummary.disabled = !hasVisits;
  document.getElementById('share-dialog-name').textContent = spotName(key) || 'Angel-Spot';
  document.getElementById('share-summary-label').classList.toggle('disabled', !hasVisits);
  map.closePopup();
  shareDialog.hidden = false;
}

document.getElementById('share-dialog-send').addEventListener('click', () => {
  const key = shareKey;
  const withSummary = shareSummary.checked;
  shareDialog.hidden = true;
  if (key) shareSpot(key, withSummary); // direkt im Tipp: Teilen-Menü braucht eine frische Nutzeraktion
});
document.getElementById('share-dialog-cancel').addEventListener('click', () => { shareDialog.hidden = true; });

function buildShareButton(key) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'apple-maps-link share-spot';
  b.textContent = 'Spot teilen';
  b.addEventListener('click', (e) => {
    L.DomEvent.stopPropagation(e);
    openShareDialog(key);
  });
  return b;
}

// ---- Geteilten Spot empfangen ----

const importDialog = document.getElementById('import-dialog');
let incomingSpot = null;

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function showImportDialog(spot, link) {
  incomingSpot = { spot, link };
  const water = spot.waterTypes.map((w) => WATER_TYPES[w]).join(', ');
  document.getElementById('import-dialog-body').innerHTML =
    `<div class="spot-name">📍 ${escapeHtml(spot.name || 'Angel-Spot')}</div>` +
    `<div class="muted">${MODES[spot.mode].icon} ${MODES[spot.mode].label}${water ? ` · ${water}` : ''}</div>` +
    (spot.summary ? `<div class="cond shared-summary">${sharedSummaryHtml(spot.summary)}</div>` : '');
  // Auf dem iPhone öffnen Links in Safari, nicht in der App vom Home-Bildschirm (getrennter
  // Speicher). Dann zusätzlich „Für die App kopieren“ anbieten.
  const inBrowser = !isStandalone();
  document.getElementById('import-copy').hidden = !inBrowser;
  document.getElementById('import-hint').hidden = !inBrowser;
  importDialog.hidden = false;
}

function closeImportDialog() {
  importDialog.hidden = true;
  incomingSpot = null;
}

async function importSharedSpot(spot) {
  if (spot.mode !== currentMode) setMode(spot.mode);
  const near = nearbySpot(spot.lat, spot.lng);
  const now = new Date();
  // Schon einmal übernommen: vorhandene Infos des Freundes aktualisieren statt doppelt speichern.
  const existing = near && spotEntries(near.key).find(isSharedSpot);
  if (existing) {
    await updateRating({ ...existing, shared: { ...(spot.summary || {}), receivedAt: now.toISOString() } });
    renderRatings();
    map.setView([existing.lat, existing.lng], Math.max(map.getZoom(), 15));
    openSpot(near.key);
    showToast('Diesen Spot hattest du schon – Infos aktualisiert');
    return;
  }
  const entry = {
    id: newId(now),
    kind: 'shared-spot',
    mode: spot.mode,
    lat: near ? near.lat : spot.lat,
    lng: near ? near.lng : spot.lng,
    timestamp: now.toISOString(),
    shared: { ...(spot.summary || {}), receivedAt: now.toISOString() },
  };
  if (near) {
    entry.spotId = near.key; // gleicher Platz wie ein eigener Spot: Infos dort anhängen
  } else {
    if (spot.name) entry.customName = spot.name;
    if (spot.waterTypes.length) entry.waterTypes = spot.waterTypes;
  }
  try {
    await addRatings([entry]);
  } catch {
    showToast('Spot konnte nicht gespeichert werden');
    return;
  }
  renderRatings();
  updateBackupInfo();
  ensureSpotNames();
  const key = spotKey(entry);
  map.setView([entry.lat, entry.lng], Math.max(map.getZoom(), 15));
  openSpot(key);
  showToast(near ? 'Spot liegt bei einem deiner Spots – Infos dort ergänzt' : 'Geteilter Spot gespeichert');
}

document.getElementById('import-save').addEventListener('click', async () => {
  if (!incomingSpot) return;
  const { spot } = incomingSpot;
  closeImportDialog();
  await importSharedSpot(spot);
});

document.getElementById('import-copy').addEventListener('click', async () => {
  if (!incomingSpot) return;
  const { link } = incomingSpot;
  try {
    await navigator.clipboard.writeText(link);
    closeImportDialog();
    alert('Kopiert! Öffne jetzt die App über das Symbol auf dem Home-Bildschirm und tippe im Menü ☰ auf ' +
      '„Geteilten Spot einfügen“.');
  } catch {
    prompt('Diesen Link kopieren und in der App unter ☰ → „Geteilten Spot einfügen“ einfügen:', link);
  }
});
document.getElementById('import-cancel').addEventListener('click', closeImportDialog);

function spotFromText(text) {
  const m = /#spot=([A-Za-z0-9_-]+)/.exec(text || '');
  if (!m) return null;
  try {
    return validateSharedSpot(decodeShare(m[1]));
  } catch {
    return null;
  }
}

// Menü: Link aus der Zwischenablage lesen (auf dem iPhone erscheint dafür „Einfügen“).
document.getElementById('paste-spot').addEventListener('click', async () => {
  document.getElementById('backup-panel').hidden = true;
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch { /* kein Zugriff: manuell einfügen lassen */ }
  let spot = spotFromText(text);
  if (!spot) {
    const manual = prompt('Geteilten Spot-Link hier einfügen:');
    if (manual === null) return;
    text = manual;
    spot = spotFromText(manual);
  }
  if (!spot) {
    alert('In der Zwischenablage ist kein geteilter Spot. Kopiere zuerst den Link aus der Nachricht.');
    return;
  }
  showImportDialog(spot, text);
});

// Beim Öffnen eines geteilten Links (#spot=…) den Dialog zeigen und das Fragment entfernen.
async function handleIncomingShare() {
  const spot = spotFromText(location.hash);
  if (!location.hash.includes('spot=')) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!spot) {
    showToast('Der geteilte Link ist ungültig oder unvollständig');
    return;
  }
  await ratingsReady;
  showImportDialog(spot, shareLink({ v: SHARE_VERSION, n: spot.name, la: spot.lat, lo: spot.lng, m: spot.mode,
    w: spot.waterTypes, ...(spot.summary ? { s: { r: spot.summary.rating, c: spot.summary.visits, f: spot.summary.fish } } : {}) }));
}

window.addEventListener('hashchange', handleIncomingShare);
handleIncomingShare();

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
    const anchor = spotAnchor(key);
    const overall = overallRating(visits);
    const dist = currentPosition
      ? distanceKm(currentPosition.lat, currentPosition.lng, anchor.lat, anchor.lng) : null;
    const avgScore = visits.length ? visits.reduce((s, v) => s + SCORES[v.rating], 0) / visits.length : 0;
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
      `<div class="spot-card-head"><b>${escapeHtml(it.name)}</b> ` +
      `${it.overall ? ratingBadge(it.overall) : '<span class="rating-badge shared-badge">🤝 Geteilt</span>'}</div>` +
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
      const v = spotAnchor(it.key);
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
    const results = await fetchJson(nominatimUrl('/search', params));
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
