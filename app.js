const STORAGE_KEY = 'standort-bewertungen';

// Gewässertyp gehört zum Spot (wird bei allen Besuchen des Spots gespeichert).
const WATER_TYPES = {
  grossgewaesser: 'Großgewässer',
  meer: 'Meer',
  polder: 'Polder',
  fluss: 'Fluss',
  kanal: 'Kanal',
  see: 'See',
};

// Zwei strikt getrennte Sparten mit eigenen Fischarten und Ködern. Jeder Eintrag gehört
// zu genau einer Sparte (Feld „mode“, ältere Einträge ohne Feld = Raubfisch). Karte,
// Analyse und Statistik zeigen immer nur die gewählte Sparte.
const MODES = {
  raubfisch: {
    label: 'Raubfisch',
    icon: '🎣',
    fish: { barsch: 'Barsch', zander: 'Zander', hecht: 'Hecht' },
    baits: {
      gummifisch: 'Gummifisch', wobbler: 'Wobbler', spinner: 'Spinner', blinker: 'Blinker',
      dropshot: 'Dropshot', jerkbait: 'Jerkbait', koederfisch: 'Köderfisch',
    },
  },
  friedfisch: {
    label: 'Friedfisch',
    icon: '🐟',
    fish: {
      karpfen: 'Karpfen', brasse: 'Brasse', rotauge: 'Rotauge', schleie: 'Schleie',
      barbe: 'Barbe', rotfeder: 'Rotfeder',
    },
    baits: {
      mais: 'Mais', boilie: 'Boilie', made: 'Made', wurm: 'Wurm', teig: 'Teig',
      pellet: 'Pellet', brot: 'Brot',
    },
  },
};
const ALL_FISH = { ...MODES.raubfisch.fish, ...MODES.friedfisch.fish };
const ALL_BAITS = { ...MODES.raubfisch.baits, ...MODES.friedfisch.baits };

const MODE_KEY = 'angel-sparte';
let currentMode = 'raubfisch';
try {
  if (MODES[localStorage.getItem(MODE_KEY)]) currentMode = localStorage.getItem(MODE_KEY);
} catch { /* ohne Speicher: Standard */ }

function entryMode(entry) {
  return entry.mode === 'friedfisch' ? 'friedfisch' : 'raubfisch';
}

function modeFish(mode = currentMode) {
  return MODES[mode].fish;
}

const RATINGS = {
  'sehr-gut': { label: 'Sehr gut', color: '#1a7f37' },
  'gut':      { label: 'Gut',      color: '#4caf50' },
  'mittel':   { label: 'Mittel',   color: '#d29922' },
  'schlecht': { label: 'Schlecht', color: '#cf222e' },
};

const map = L.map('map', { zoomControl: false }).setView([51.1657, 10.4515], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const statusEl = document.getElementById('status');
const rateButton = document.getElementById('rate-button');
const pickButton = document.getElementById('pick-button');
const bottomBar = document.getElementById('bottom-bar');
const crosshair = document.getElementById('crosshair');
const pickBar = document.getElementById('pick-bar');
const visitDateField = document.getElementById('visit-date-field');
const visitDateInput = document.getElementById('visit-date');
const visitTimeInput = document.getElementById('visit-time');
const menu = document.getElementById('rating-menu');
const toast = document.getElementById('toast');

let currentPosition = null;
let positionMarker = null;
let accuracyCircle = null;
let hasCentered = false;

// ---- Speicher ----
// Bewertungen liegen in IndexedDB und zusätzlich als Kopie in localStorage.
// Beim Start werden beide zusammengeführt, damit nichts verloren geht, falls
// einer der beiden Speicher geleert wurde.

const DB_NAME = 'standort-bewertung';
const DB_STORE = 'ratings';
// Fotos liegen nur in IndexedDB (für localStorage zu groß) und in der Sicherungsdatei.
const PHOTO_STORE = 'photos';

let ratings = [];
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB nicht verfügbar'));
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' }).createIndex('entryId', 'entryId');
        }
      };
      req.onsuccess = () => {
        // Eine neuere App-Version in einem anderen Tab darf die Datenbank aktualisieren.
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function dbRequest(mode, fn, storeName = DB_STORE) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result && result.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function readLocalCopy() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function writeLocalCopy() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
    return true;
  } catch {
    return false;
  }
}

function sortRatings() {
  ratings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function loadRatings() {
  const byId = new Map();
  let fromDb = [];
  try {
    fromDb = await dbRequest('readonly', (store) => store.getAll());
  } catch (err) {
    console.warn('IndexedDB konnte nicht gelesen werden', err);
  }
  for (const r of [...readLocalCopy(), ...(fromDb || [])]) {
    if (r && r.id) byId.set(r.id, r);
  }
  ratings = [...byId.values()];
  sortRatings();

  // Beide Speicher auf denselben Stand bringen.
  const dbIds = new Set((fromDb || []).map((r) => r.id));
  const missingInDb = ratings.filter((r) => !dbIds.has(r.id));
  if (missingInDb.length) {
    try {
      await dbRequest('readwrite', (store) => missingInDb.forEach((r) => store.put(r)));
    } catch (err) {
      console.warn('IndexedDB konnte nicht geschrieben werden', err);
    }
  }
  writeLocalCopy();
}

// Speichert Einträge in beiden Speichern. Gilt als erfolgreich, wenn
// mindestens einer der beiden Speicher geschrieben werden konnte.
async function addRatings(entries) {
  await ratingsReady;
  const known = new Set(ratings.map((r) => r.id));
  const fresh = entries.filter((r) => r && r.id && !known.has(r.id));
  ratings.push(...fresh);
  sortRatings();

  let dbOk = false;
  try {
    await dbRequest('readwrite', (store) => fresh.forEach((r) => store.put(r)));
    dbOk = true;
  } catch (err) {
    console.warn('IndexedDB konnte nicht geschrieben werden', err);
  }
  const localOk = writeLocalCopy();

  if (!dbOk && !localOk) {
    const ids = new Set(fresh.map((r) => r.id));
    ratings = ratings.filter((r) => !ids.has(r.id));
    throw new Error('Speichern fehlgeschlagen');
  }
  return fresh.length;
}

async function updateRating(entry) {
  await ratingsReady;
  const index = ratings.findIndex((r) => r.id === entry.id);
  if (index === -1) return; // wurde inzwischen gelöscht
  ratings[index] = entry;
  try {
    await dbRequest('readwrite', (store) => store.put(entry));
  } catch (err) {
    console.warn('IndexedDB konnte nicht geschrieben werden', err);
  }
  writeLocalCopy();
}

async function deleteRating(id) {
  await ratingsReady;
  const entry = getEntry(id);
  ratings = ratings.filter((r) => r.id !== id);
  try {
    await dbRequest('readwrite', (store) => store.delete(id));
    for (const photoId of (entry && entry.photoIds) || []) await deletePhotoBlob(photoId);
  } catch (err) {
    console.warn('IndexedDB konnte nicht geschrieben werden', err);
  }
  writeLocalCopy();
}

// ---- Fotos ----

function savePhotoBlob(photo) {
  return dbRequest('readwrite', (store) => store.put(photo), PHOTO_STORE);
}

function getPhotoBlob(id) {
  return dbRequest('readonly', (store) => store.get(id), PHOTO_STORE);
}

function getAllPhotoBlobs() {
  return dbRequest('readonly', (store) => store.getAll(), PHOTO_STORE);
}

function deletePhotoBlob(id) {
  return dbRequest('readwrite', (store) => store.delete(id), PHOTO_STORE);
}

// Verkleinert ein Foto (längste Seite max. 1600 px, JPEG), damit der Speicher reicht.
async function compressImage(file, maxSize = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob || file;
  } catch {
    return file; // Format nicht lesbar: Original speichern
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Bittet den Browser, die Daten nicht automatisch zu löschen
// (z. B. bei wenig Speicherplatz).
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

// ---- Bewertungen auf der Karte ----

const ratingsLayer = L.layerGroup().addTo(map);

const markersBySpot = new Map();
const RETRY_WINDOW_MS = 3 * 60 * 60 * 1000;
const SAME_SPOT_RADIUS_M = 50;
const loadingIds = new Set();

// Gesamtbewertung: Durchschnitt der Besuche (Schlecht = 1 … Sehr gut = 4), gerundet.
const SCORES = { 'schlecht': 1, 'mittel': 2, 'gut': 3, 'sehr-gut': 4 };
const RATING_BY_SCORE = { 1: 'schlecht', 2: 'mittel', 3: 'gut', 4: 'sehr-gut' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmt(value, unit) {
  return value === null || value === undefined ? '–' : `${String(value).replace('.', ',')} ${unit}`;
}

function windDirectionName(deg) {
  if (!Number.isFinite(deg)) return '';
  return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function conditionsHtml(entry) {
  if (loadingIds.has(entry.id)) {
    return '<div class="cond muted">Wetter und Wasserstand werden abgerufen …</div>';
  }
  const c = entry.conditions;
  if (!c) return '<div class="cond muted">Keine Wetter- und Pegeldaten gespeichert.</div>';

  let html = '';
  if (c.weather) {
    const w = c.weather;
    html += `<div class="cond"><b>Wetter:</b> ${escapeHtml(w.description)}, ${fmt(w.temperature, '°C')}` +
      ` (gefühlt ${fmt(w.apparentTemperature, '°C')})<br>` +
      `Wind ${fmt(w.windSpeed, 'km/h')} ${windDirectionName(w.windDirection)}, Böen ${fmt(w.windGusts, 'km/h')}<br>` +
      `Bewölkung ${fmt(w.cloudCover, '%')}, Feuchte ${fmt(w.humidity, '%')}, Niederschlag ${fmt(w.precipitation, 'mm')}</div>`;
  }
  if (c.pressure) {
    const pr = c.pressure;
    html += `<div class="cond"><b>Luftdruck:</b><br>` +
      `Vortag: ${fmt(pr.yesterday, 'hPa')}<br>` +
      `${c.for ? 'Zum Zeitpunkt' : 'Aktuell'}: ${fmt(pr.current, 'hPa')}<br>` +
      `Folgetag: ${fmt(pr.tomorrow, 'hPa')}` +
      (pr.tomorrowIsForecast !== false ? ' <span class="muted">(Vorhersage)</span>' : '') + '</div>';
  }
  if (c.errors && c.errors.weather) {
    html += '<div class="cond muted">Wetter konnte nicht abgerufen werden.</div>';
  }

  if (c.waterLevel) {
    const wl = c.waterLevel;
    const trend = { '-1': ' ↘ fallend', '0': ' → gleichbleibend', '1': ' ↗ steigend' }[wl.trend] || '';
    const state = { low: ' (niedrig)', normal: ' (normal)', high: ' (hoch)' }[wl.state] || '';
    html += `<div class="cond"><b>Wasserstand:</b> ${fmt(wl.value, escapeHtml(wl.unit))}${trend}${state}<br>` +
      `Pegel ${escapeHtml(wl.station)}${wl.water ? ` (${escapeHtml(wl.water)})` : ''}, ` +
      `${fmt(wl.distanceKm, 'km')} entfernt` +
      (wl.measuredAt ? `<br><span class="muted">gemessen ${new Date(wl.measuredAt).toLocaleString('de-DE')}</span>` : '') +
      '</div>';
  } else if (c.errors && c.errors.waterLevel) {
    html += '<div class="cond muted">Wasserstand konnte nicht abgerufen werden.</div>';
  } else if (c.waterLevelUnavailable) {
    html += `<div class="cond muted">Wasserstand: Pegeldaten gibt es nur für die letzten ${PEGEL_HISTORY_DAYS} Tage.</div>`;
  } else if (c.waterLevel === null) {
    html += `<div class="cond muted">Kein Pegel im Umkreis von ${PEGEL_RADIUS_KM} km gefunden.</div>`;
  }

  if (c.waterTemp) {
    const wt = c.waterTemp;
    html += `<div class="cond"><b>Wassertemperatur:</b> ${fmt(wt.value, '°C')}<br>` +
      `<span class="muted">Pegel ${escapeHtml(wt.station)}${wt.water ? ` (${escapeHtml(wt.water)})` : ''}, ` +
      `${fmt(wt.distanceKm, 'km')} entfernt</span></div>`;
  } else if (c.waterTemp === null) {
    html += '<div class="cond muted">Wassertemperatur: kein Messpegel in der Nähe.</div>';
  }
  return html;
}

// Sonnenzeiten als Text, z. B. „Dämmerung 07:29 · Aufgang 08:02 · Untergang 18:34 · Dämmerung 19:07“.
function sunTimesHtml(date, lat, lng) {
  if (typeof sunTimes !== 'function') return '';
  const t = sunTimes(date, lat, lng);
  if (!t.sunrise && !t.sunset) return '';
  return `🌅 ${formatClock(t.sunrise)} – 🌇 ${formatClock(t.sunset)} ` +
    `<span class="muted">(Dämmerung ${formatClock(t.dawn)} / ${formatClock(t.dusk)})</span>`;
}

// Zeitpunkt (Unix-Sekunden), für den Wetterdaten abgerufen werden:
// bei manuellen Einträgen das Besuchsdatum (ohne Uhrzeit: 12 Uhr), sonst jetzt (null).
function conditionsTarget(entry) {
  if (!entry.manual) return null;
  return Math.floor(new Date(`${entry.visitedAt}T${entry.visitedTime || '12:00'}:00`).getTime() / 1000);
}

function canRetry(entry) {
  if (loadingIds.has(entry.id)) return false;
  const c = entry.conditions;
  const incomplete = !c || (c.errors && Object.keys(c.errors).length > 0);
  if (!incomplete) return false;
  if (entry.manual) return Boolean(entry.visitedAt);
  return Date.now() - new Date(entry.timestamp).getTime() < RETRY_WINDOW_MS;
}

function getEntry(id) {
  return ratings.find((r) => r.id === id);
}

// ---- Spots: mehrere Besuche am selben Ort ----

function spotKey(entry) {
  return entry.spotId || entry.id;
}

// Zeitpunkt des Besuchs in ms (null = Datum unbekannt).
function visitTime(entry) {
  if (!entry.manual) return new Date(entry.timestamp).getTime();
  if (!entry.visitedAt) return null;
  return new Date(`${entry.visitedAt}T${entry.visitedTime || '12:00'}:00`).getTime();
}

function visitDateLabel(entry, withTime = true) {
  if (!entry.manual) {
    return withTime ? new Date(entry.timestamp).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }) + ' Uhr' : new Date(entry.timestamp).toLocaleDateString('de-DE');
  }
  if (!entry.visitedAt) return 'Datum unbekannt';
  const date = new Date(`${entry.visitedAt}T12:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  return withTime && entry.visitedTime ? `${date}, ${entry.visitedTime} Uhr` : date;
}

// Besuche eines Spots, neueste zuerst; Besuche ohne Datum am Ende.
function spotVisits(key) {
  return ratings
    .filter((r) => spotKey(r) === key && RATINGS[r.rating])
    .sort((a, b) => (visitTime(b) ?? -Infinity) - (visitTime(a) ?? -Infinity));
}

// Spots der Sparte `mode` (null = alle Sparten).
function allSpotKeys(mode = currentMode) {
  return [...new Set(ratings
    .filter((r) => RATINGS[r.rating] && (mode === null || entryMode(r) === mode))
    .map(spotKey))];
}

function overallRating(visits) {
  const avg = visits.reduce((sum, v) => sum + SCORES[v.rating], 0) / visits.length;
  return RATING_BY_SCORE[Math.min(4, Math.max(1, Math.round(avg)))];
}

// Nächster gespeicherter Spot innerhalb von SAME_SPOT_RADIUS_M Metern.
function nearbySpot(lat, lng) {
  let best = null;
  for (const key of allSpotKeys()) {
    const v = spotVisits(key)[0];
    const meters = distanceKm(lat, lng, v.lat, v.lng) * 1000;
    if (meters <= SAME_SPOT_RADIUS_M && (!best || meters < best.meters)) best = { key, meters, lat: v.lat, lng: v.lng };
  }
  return best;
}

// Teil des Popups, der sich durch Datenabrufe ändert (Mond, Wetter, Pegel).
function renderPopupDetails(entry, container) {
  // Ältere Bewertungen ohne gespeicherte Mondphase: aus dem Zeitpunkt berechnen.
  // Manuelle Einträge haben nur dann eine Mondphase, wenn ein Datum angegeben wurde.
  const moon = entry.moon || (!entry.manual && typeof moonPhaseAt === 'function'
    ? moonPhaseAt(new Date(entry.timestamp)) : null);
  const moonLabel = entry.manual && !entry.visitedTime ? 'Mond (Tagesmitte)' : 'Mond';
  const when = visitTime(entry);
  const sun = when !== null ? sunTimesHtml(new Date(when), entry.lat, entry.lng) : '';
  container.innerHTML =
    (sun ? `<div class="cond"><b>Sonne:</b> ${sun}</div>` : '') +
    (moon ? `<div class="cond"><b>${moonLabel}:</b> ${moon.symbol} ${moon.name}, ` +
      `${moon.illumination} % beleuchtet</div>` : '') +
    (entry.manual && !entry.visitedAt
      ? '<div class="cond muted">Ohne Besuchsdatum gibt es keine Wetterdaten.</div>'
      : conditionsHtml(entry));

  if (canRetry(entry)) {
    const retry = document.createElement('button');
    retry.className = 'popup-retry';
    retry.textContent = entry.conditions ? 'Daten erneut abrufen' : 'Wetterdaten abrufen';
    retry.addEventListener('click', (e) => {
      // Der Button wird beim Neuzeichnen ersetzt; ohne stopPropagation hielte Leaflet
      // den Klick für einen Kartenklick und würde das Popup schließen.
      L.DomEvent.stopPropagation(e);
      loadConditions(entry.id);
    });
    container.appendChild(retry);
  }
}

const FISH_SIZE_MIN = 1;
const FISH_SIZE_MAX = 150;

function fishLabelWithSize(entry, f) {
  const size = entry.fishSizes && entry.fishSizes[f];
  return size ? `${ALL_FISH[f]} ${size} cm` : ALL_FISH[f];
}

// Größe einer Fischart per Schieberegler (1–150 cm) mit −/+ für zentimetergenaues Einstellen.
function buildSizeRow(id, key) {
  const row = document.createElement('div');
  row.className = 'size-row';
  const current = (getEntry(id).fishSizes || {})[key];

  const name = document.createElement('span');
  name.className = 'size-name';
  name.textContent = ALL_FISH[key];
  const value = document.createElement('span');
  value.className = 'size-value';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(FISH_SIZE_MIN);
  slider.max = String(FISH_SIZE_MAX);
  slider.step = '1';
  slider.value = String(current || 50);
  slider.setAttribute('aria-label', `Größe ${ALL_FISH[key]} in cm`);
  const show = (v) => { value.textContent = v ? `${v} cm` : '– cm'; };
  show(current);

  const save = async () => {
    const entry = getEntry(id);
    if (!entry) return;
    const size = Number(slider.value);
    show(size);
    await updateRating({ ...entry, fishSizes: { ...(entry.fishSizes || {}), [key]: size } });
    refreshSpotSummary(spotKey(getEntry(id)));
  };
  slider.addEventListener('input', () => show(Number(slider.value)));
  slider.addEventListener('change', save);
  // Leaflet soll Wischen auf dem Regler nicht als Kartenbewegung verstehen.
  L.DomEvent.disableClickPropagation(row);

  const step = (delta) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'size-step';
    btn.textContent = delta < 0 ? '−' : '+';
    btn.setAttribute('aria-label', `${ALL_FISH[key]} ${delta < 0 ? 'kleiner' : 'größer'}`);
    btn.addEventListener('click', () => {
      slider.value = String(Math.min(FISH_SIZE_MAX, Math.max(FISH_SIZE_MIN, Number(slider.value) + delta)));
      save();
    });
    return btn;
  };

  const head = document.createElement('div');
  head.className = 'size-head';
  head.append(name, value);
  const controls = document.createElement('div');
  controls.className = 'size-controls';
  controls.append(step(-1), slider, step(1));
  row.append(head, controls);
  return row;
}

function buildFishPicker(id) {
  const wrap = document.createElement('div');
  wrap.className = 'cond';
  wrap.innerHTML = '<b>Gut gefangen:</b>';
  const chips = document.createElement('div');
  chips.className = 'fish-chips';
  const sizes = document.createElement('div');
  sizes.className = 'size-rows';

  const renderSizes = () => {
    sizes.innerHTML = '';
    for (const f of getEntry(id).fish || []) sizes.appendChild(buildSizeRow(id, f));
    const marker = markersBySpot.get(spotKey(getEntry(id)));
    if (marker && marker.isPopupOpen()) marker.getPopup().update();
  };

  for (const [key, label] of Object.entries(modeFish(entryMode(getEntry(id))))) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fish-chip';
    chip.textContent = label;
    const selected = (getEntry(id).fish || []).includes(key);
    chip.setAttribute('aria-pressed', String(selected));
    chip.addEventListener('click', async () => {
      const current = getEntry(id);
      if (!current) return;
      const fish = new Set(current.fish || []);
      const fishSizes = { ...(current.fishSizes || {}) };
      if (fish.has(key)) {
        fish.delete(key);
        delete fishSizes[key];
      } else {
        fish.add(key);
      }
      chip.setAttribute('aria-pressed', String(fish.has(key)));
      await updateRating({ ...getEntry(id), fish: Object.keys(ALL_FISH).filter((k) => fish.has(k)), fishSizes });
      renderSizes();
      refreshSpotSummary(spotKey(getEntry(id)));
    });
    chips.appendChild(chip);
  }
  wrap.append(chips, sizes);
  for (const f of getEntry(id).fish || []) sizes.appendChild(buildSizeRow(id, f));
  return wrap;
}

// Köder (Mehrfachauswahl, je nach Sparte) plus optionale Details wie Farbe oder Größe.
function buildBaitPicker(id) {
  const wrap = document.createElement('div');
  wrap.className = 'cond';
  wrap.innerHTML = '<b>Köder:</b>';
  const chips = document.createElement('div');
  chips.className = 'fish-chips';
  for (const [key, label] of Object.entries(MODES[entryMode(getEntry(id))].baits)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fish-chip';
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String((getEntry(id).baits || []).includes(key)));
    chip.addEventListener('click', async () => {
      const current = getEntry(id);
      if (!current) return;
      const baits = new Set(current.baits || []);
      if (baits.has(key)) baits.delete(key); else baits.add(key);
      chip.setAttribute('aria-pressed', String(baits.has(key)));
      await updateRating({ ...getEntry(id), baits: Object.keys(ALL_BAITS).filter((b) => baits.has(b)) });
      refreshSpotSummary(spotKey(getEntry(id)));
    });
    chips.appendChild(chip);
  }

  const detail = document.createElement('input');
  detail.type = 'text';
  detail.className = 'bait-detail';
  detail.placeholder = 'Farbe / Größe / Details (optional)';
  detail.value = getEntry(id).baitDetail || '';
  const save = async () => {
    const current = getEntry(id);
    if (!current || (current.baitDetail || '') === detail.value) return;
    await updateRating({ ...current, baitDetail: detail.value });
  };
  let timer = null;
  detail.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 600); });
  detail.addEventListener('blur', () => { clearTimeout(timer); save(); });

  wrap.append(chips, detail);
  return wrap;
}

// Fotos eines Besuchs: Vorschaubilder, Hinzufügen aus der Foto-App, Vollbild mit Löschen.
function buildPhotoSection(id) {
  const wrap = document.createElement('div');
  wrap.className = 'cond photo-section';
  wrap.innerHTML = '<b>Fotos:</b>';
  const grid = document.createElement('div');
  grid.className = 'photo-grid';

  const clear = () => {
    grid.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
    grid.innerHTML = '';
  };
  const render = async () => {
    clear();
    const entry = getEntry(id);
    if (!entry) return;
    for (const photoId of entry.photoIds || []) {
      let photo = null;
      try { photo = await getPhotoBlob(photoId); } catch { /* fehlt */ }
      if (!photo) continue;
      const img = document.createElement('img');
      img.src = URL.createObjectURL(photo.blob);
      img.alt = 'Foto';
      img.addEventListener('click', (e) => {
        L.DomEvent.stopPropagation(e);
        openPhotoViewer(id, photoId, render);
      });
      grid.appendChild(img);
    }
    const marker = markersBySpot.get(spotKey(getEntry(id)));
    if (marker && marker.isPopupOpen()) marker.getPopup().update();
  };

  const add = document.createElement('label');
  add.className = 'photo-add';
  add.textContent = '+ Foto hinzufügen';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    showToast(files.length === 1 ? 'Foto wird gespeichert …' : `${files.length} Fotos werden gespeichert …`);
    const ids = [];
    try {
      for (const file of files) {
        const blob = await compressImage(file);
        const photoId = newId(new Date());
        await savePhotoBlob({ id: photoId, entryId: id, blob, createdAt: new Date().toISOString() });
        ids.push(photoId);
      }
    } catch {
      showToast('Foto konnte nicht gespeichert werden (Speicher voll?)');
    }
    if (!ids.length) return;
    const entry = getEntry(id);
    await updateRating({ ...entry, photoIds: [...(entry.photoIds || []), ...ids] });
    await render();
    refreshSpotSummary(spotKey(getEntry(id)));
    showToast(ids.length === 1 ? 'Foto gespeichert' : `${ids.length} Fotos gespeichert`);
  });
  add.appendChild(input);
  L.DomEvent.disableClickPropagation(add);

  wrap.append(grid, add);
  // Vorschaubilder erst laden, wenn der Besuch sichtbar ist (siehe loadVisiblePhotos).
  wrap.renderPhotos = render;
  wrap.clearPhotos = clear;
  return wrap;
}

const photoViewer = document.getElementById('photo-viewer');
const photoViewerImg = document.getElementById('photo-viewer-img');
let photoViewerState = null;

async function openPhotoViewer(entryId, photoId, onChange) {
  const photo = await getPhotoBlob(photoId);
  if (!photo) return;
  if (photoViewerImg.src) URL.revokeObjectURL(photoViewerImg.src);
  photoViewerImg.src = URL.createObjectURL(photo.blob);
  photoViewerState = { entryId, photoId, onChange };
  photoViewer.hidden = false;
}

function closePhotoViewer() {
  photoViewer.hidden = true;
  if (photoViewerImg.src) URL.revokeObjectURL(photoViewerImg.src);
  photoViewerImg.removeAttribute('src');
  photoViewerState = null;
}

document.getElementById('photo-viewer-close').addEventListener('click', closePhotoViewer);
document.getElementById('photo-viewer-delete').addEventListener('click', async () => {
  if (!photoViewerState || !confirm('Dieses Foto wirklich löschen?')) return;
  const { entryId, photoId, onChange } = photoViewerState;
  const entry = getEntry(entryId);
  if (entry) await updateRating({ ...entry, photoIds: (entry.photoIds || []).filter((p) => p !== photoId) });
  try { await deletePhotoBlob(photoId); } catch { /* bereits weg */ }
  closePhotoViewer();
  await onChange();
  if (entry) refreshSpotSummary(spotKey(getEntry(entryId)));
});

function buildNotesField(id) {
  const wrap = document.createElement('label');
  wrap.className = 'cond notes-field';
  wrap.innerHTML = '<b>Notizen:</b>';
  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.placeholder = 'z. B. Köder, Tiefe, Uhrzeit, Besonderheiten …';
  textarea.value = getEntry(id).notes || '';
  const status = document.createElement('span');
  status.className = 'muted notes-status';

  let timer = null;
  const save = async () => {
    clearTimeout(timer);
    timer = null;
    const current = getEntry(id);
    if (!current || (current.notes || '') === textarea.value) return;
    await updateRating({ ...current, notes: textarea.value });
    status.textContent = 'Gespeichert ✓';
  };
  textarea.addEventListener('input', () => {
    status.textContent = '';
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  textarea.addEventListener('blur', save);

  wrap.append(textarea, status);
  return wrap;
}

function fishSummary(visits) {
  const counts = {};
  const max = {};
  for (const v of visits) {
    for (const f of v.fish || []) {
      counts[f] = (counts[f] || 0) + 1;
      const size = v.fishSizes && v.fishSizes[f];
      if (size && (!max[f] || size > max[f])) max[f] = size;
    }
  }
  return Object.keys(ALL_FISH).filter((f) => counts[f]).map((f) => {
    let text = visits.length > 1 ? `${ALL_FISH[f]} ${counts[f]}×` : ALL_FISH[f];
    if (max[f]) text += visits.length > 1 ? ` (max. ${max[f]} cm)` : ` ${max[f]} cm`;
    return text;
  }).join(', ');
}

// Name des Spots = nächstgelegener Ort (bei einem der Besuche gespeichert).
function spotWaterTypes(key) {
  const v = spotVisits(key).find((e) => Array.isArray(e.waterTypes));
  return v ? v.waterTypes : [];
}

// Auswahl des Gewässertyps (wie bei den Fischarten, Mehrfachauswahl möglich).
// Änderungen gelten für den ganzen Spot und werden in allen Besuchen angezeigt.
function buildWaterTypePicker(id) {
  const wrap = document.createElement('div');
  wrap.className = 'cond';
  wrap.innerHTML = '<b>Gewässertyp:</b>';
  const chips = document.createElement('div');
  chips.className = 'fish-chips water-chips';
  const key = spotKey(getEntry(id));
  const selected = spotWaterTypes(key);
  for (const [type, label] of Object.entries(WATER_TYPES)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fish-chip water-chip';
    chip.dataset.water = type;
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(selected.includes(type)));
    chip.addEventListener('click', async () => {
      const spot = spotKey(getEntry(id));
      const types = new Set(spotWaterTypes(spot));
      if (types.has(type)) types.delete(type); else types.add(type);
      const waterTypes = Object.keys(WATER_TYPES).filter((t) => types.has(t));
      for (const v of spotVisits(spot)) await updateRating({ ...getEntry(v.id), waterTypes });
      // Auswahl in allen Besuchen dieses Spots aktualisieren
      const content = popupContent(spot);
      (content || wrap).querySelectorAll('.water-chip').forEach((c) => {
        c.setAttribute('aria-pressed', String(types.has(c.dataset.water)));
      });
      refreshSpotSummary(spot);
    });
    chips.appendChild(chip);
  }
  wrap.appendChild(chips);
  return wrap;
}

// Eigener Name (umbenannt) hat Vorrang vor dem automatisch ermittelten Ortsnamen.
function spotName(key) {
  const visits = spotVisits(key);
  const custom = visits.find((e) => e.customName);
  if (custom) return custom.customName;
  const v = visits.find((e) => e.placeName);
  return v ? v.placeName : null;
}

async function renameSpot(key) {
  const visits = spotVisits(key);
  const current = (visits.find((e) => e.customName) || {}).customName || '';
  const auto = (visits.find((e) => e.placeName) || {}).placeName || '';
  const input = prompt(`Name für diesen Spot${auto ? ` (leer = „${auto}“)` : ''}:`, current || auto);
  if (input === null) return;
  const name = input.trim();
  for (const v of visits) {
    const updated = { ...getEntry(v.id) };
    if (name && name !== auto) updated.customName = name; else delete updated.customName;
    await updateRating(updated);
  }
  refreshSpotSummary(key);
}

function baitSummary(visits) {
  const counts = {};
  for (const v of visits) for (const b of v.baits || []) counts[b] = (counts[b] || 0) + 1;
  return Object.keys(ALL_BAITS).filter((b) => counts[b])
    .map((b) => (visits.length > 1 ? `${ALL_BAITS[b]} ${counts[b]}×` : ALL_BAITS[b])).join(', ');
}

function ratingBadge(key) {
  return `<span class="rating-badge" style="background:${RATINGS[key].color}">${RATINGS[key].label}</span>`;
}

function spotHeaderHtml(key) {
  const visits = spotVisits(key);
  const overall = overallRating(visits);
  const name = spotName(key);
  let html = `<div class="spot-name">📍 ${name ? escapeHtml(name) : '<span class="muted">Ort wird ermittelt …</span>'}` +
    ' <button type="button" class="spot-rename" aria-label="Spot umbenennen">✎</button></div>';
  html += visits.length > 1
    ? `<div class="spot-title">Gesamt: ${ratingBadge(overall)}</div>` +
      `<div class="muted">${visits.length} Besuche: ` +
      Object.keys(SCORES).reverse()
        .map((r) => [r, visits.filter((v) => v.rating === r).length])
        .filter(([, n]) => n).map(([r, n]) => `${n}× ${RATINGS[r].label}`).join(', ') + '</div>'
    : `<div class="spot-title">${ratingBadge(overall)}</div><div class="muted">1 Besuch</div>`;
  const fish = fishSummary(visits);
  if (fish) html += `<div class="cond"><b>Gut gefangen:</b> ${fish}</div>`;
  const baits = baitSummary(visits);
  if (baits) html += `<div class="cond"><b>Köder:</b> ${baits}</div>`;
  const water = spotWaterTypes(key).map((t) => WATER_TYPES[t]).join(', ');
  if (water) html += `<div class="cond"><b>Gewässer:</b> ${water}</div>`;
  const sun = sunTimesHtml(new Date(), visits[0].lat, visits[0].lng);
  if (sun) html += `<div class="cond"><b>Heute:</b> ${sun}</div>`;
  return html;
}

function visitTitleHtml(entry) {
  const fish = (entry.fish || []).map((f) => fishLabelWithSize(entry, f)).join(', ');
  const photos = (entry.photoIds || []).length;
  return `<span class="visit-date">${escapeHtml(visitDateLabel(entry, false))}</span> ${ratingBadge(entry.rating)}` +
    (fish ? ` <span class="muted">${fish}</span>` : '') +
    (photos ? ` <span class="muted">📷 ${photos}</span>` : '');
}

function buildVisit(entry, open) {
  const id = entry.id;
  const rating = RATINGS[entry.rating];
  const visit = document.createElement('details');
  visit.className = 'visit';
  visit.dataset.visit = id;
  visit.open = open;

  const summary = document.createElement('summary');
  summary.innerHTML = `<span class="visit-title">${visitTitleHtml(entry)}</span>`;
  // Auf- und Zuklappen ändert die Höhe: Popup neu ausrichten.
  visit.addEventListener('toggle', () => {
    const section = visit.querySelector('.photo-section');
    if (section) { if (visit.open) section.renderPhotos(); else section.clearPhotos(); }
    const marker = markersBySpot.get(spotKey(entry));
    if (marker && marker.isPopupOpen()) marker.getPopup().update();
  });

  const when = document.createElement('div');
  when.className = 'muted';
  when.textContent = visitDateLabel(entry) + (entry.manual ? ' · manuell eingetragen' : '');

  const details = document.createElement('div');
  details.className = 'popup-details';
  renderPopupDetails(entry, details);

  const actions = document.createElement('div');
  actions.className = 'popup-actions';
  const del = document.createElement('button');
  del.className = 'popup-delete';
  del.textContent = 'Besuch löschen';
  del.addEventListener('click', async (e) => {
    L.DomEvent.stopPropagation(e);
    if (!confirm(`Besuch vom ${visitDateLabel(entry, false)} („${rating.label}“) wirklich löschen?`)) return;
    const key = spotKey(entry);
    await deleteRating(id);
    renderRatings();
    updateBackupInfo();
    openSpot(key);
  });
  actions.appendChild(del);

  visit.append(summary, when, details, buildFishPicker(id), buildBaitPicker(id), buildWaterTypePicker(id),
    buildNotesField(id), buildPhotoSection(id), actions);
  return visit;
}

function buildSpotPopup(key, expandId) {
  const visits = spotVisits(key);
  const popup = document.createElement('div');
  popup.className = 'popup';
  popup.dataset.spot = key;

  const header = document.createElement('div');
  header.className = 'spot-header';
  header.innerHTML = spotHeaderHtml(key);
  // Kopf wird bei Änderungen neu geschrieben – daher Klick über den Container abfangen.
  header.addEventListener('click', (e) => {
    if (!e.target.closest('.spot-rename')) return;
    L.DomEvent.stopPropagation(e);
    renameSpot(key);
  });

  const add = document.createElement('button');
  add.className = 'popup-add';
  add.textContent = '+ Besuch hinzufügen';
  add.addEventListener('click', (e) => {
    L.DomEvent.stopPropagation(e);
    targetSpot = key;
    map.closePopup();
    openMenu('visit');
  });

  const list = document.createElement('div');
  list.className = 'visit-list';
  for (const v of visits) {
    list.appendChild(buildVisit(v, visits.length === 1 || v.id === expandId));
  }

  popup.append(header, buildAppleMapsLink(key), add, list);

  if (allSpotKeys().length > 1) {
    const merge = document.createElement('button');
    merge.className = 'popup-secondary';
    merge.textContent = 'Mit anderem Spot zusammenlegen';
    merge.addEventListener('click', (e) => {
      L.DomEvent.stopPropagation(e);
      startMerge(key);
    });
    popup.appendChild(merge);
  }

  if (visits.length > 1) {
    const delSpot = document.createElement('button');
    delSpot.className = 'popup-delete spot-delete';
    delSpot.textContent = 'Ganzen Spot löschen';
    delSpot.addEventListener('click', async (e) => {
      L.DomEvent.stopPropagation(e);
      if (!confirm(`Diesen Spot mit allen ${visits.length} Besuchen wirklich löschen?`)) return;
      for (const v of spotVisits(key)) await deleteRating(v.id);
      renderRatings();
      updateBackupInfo();
    });
    popup.appendChild(delSpot);
  }
  return popup;
}

function popupContent(key) {
  const marker = markersBySpot.get(key);
  const content = marker && marker.getPopup() && marker.getPopup().getContent();
  return content instanceof HTMLElement ? content : null;
}

// Aktualisiert Kopf und Besuchs-Überschriften (z. B. nach Änderung der Fischarten).
function refreshSpotSummary(key) {
  const content = popupContent(key);
  if (!content) return;
  content.querySelector('.spot-header').innerHTML = spotHeaderHtml(key);
  for (const v of spotVisits(key)) {
    const title = content.querySelector(`[data-visit="${v.id}"] .visit-title`);
    if (title) title.innerHTML = visitTitleHtml(v);
  }
}

// Aktualisiert nur den Datenteil eines Besuchs, damit Eingaben im Notizfeld erhalten bleiben.
function refreshPopup(id) {
  const entry = getEntry(id);
  if (!entry) return;
  const content = popupContent(spotKey(entry));
  const details = content && content.querySelector(`[data-visit="${id}"] .popup-details`);
  if (!details) return;
  renderPopupDetails(entry, details);
  markersBySpot.get(spotKey(entry)).getPopup().update();
}

// Ermittelt fehlende Spot-Namen (nächstgelegener Ort) und speichert sie bei allen
// Besuchen des Spots. Läuft beim Start und nach dem Anlegen neuer Spots.
const namingSpots = new Set();
async function ensureSpotNames() {
  for (const key of allSpotKeys(null)) {
    if (spotName(key) || namingSpots.has(key)) continue;
    namingSpots.add(key);
    const { lat, lng } = spotVisits(key)[0];
    queueReverseGeocode(lat, lng).then(async (name) => {
      if (!name) return;
      for (const v of spotVisits(key)) await updateRating({ ...getEntry(v.id), placeName: name });
      refreshSpotSummary(key);
    }).catch(() => { /* offline o. Ä.: beim nächsten Start erneut versuchen */ })
      .finally(() => namingSpots.delete(key));
  }
}

// Link, der den Spot in Apple Karten öffnet (auf dem iPhone in der Karten-App,
// sonst auf maps.apple.com). Dort lässt sich direkt eine Route starten.
function appleMapsUrl(key) {
  const { lat, lng } = spotVisits(key)[0];
  const params = new URLSearchParams({
    ll: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    q: spotName(key) || 'Angel-Spot',
  });
  return `https://maps.apple.com/?${params}`;
}

function buildAppleMapsLink(key) {
  const link = document.createElement('a');
  link.className = 'apple-maps-link';
  link.href = appleMapsUrl(key);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'In Apple Karten öffnen';
  link.addEventListener('click', (e) => {
    L.DomEvent.stopPropagation(e);
    link.href = appleMapsUrl(key); // aktueller Name, falls er erst nachträglich ermittelt wurde
  });
  return link;
}

// Lädt Vorschaubilder nur für aufgeklappte Besuche im geöffneten Popup.
function loadVisiblePhotos(content) {
  content.querySelectorAll('details.visit').forEach((visit) => {
    const section = visit.querySelector('.photo-section');
    if (!section) return;
    if (visit.open) section.renderPhotos(); else section.clearPhotos();
  });
}

// ---- Spots zusammenlegen ----

const mergeBar = document.getElementById('merge-bar');
let mergeSource = null;

function startMerge(key) {
  hideBackupReminder();
  mergeSource = key;
  map.closePopup();
  bottomBar.hidden = true;
  mergeBar.hidden = false;
}

function stopMerge() {
  mergeSource = null;
  mergeBar.hidden = true;
  bottomBar.hidden = false;
}

document.getElementById('merge-cancel').addEventListener('click', stopMerge);

// Alle Besuche von `source` wandern zu `target` (Position, Name und Gewässertyp des Ziels;
// Gewässertypen beider Spots werden vereinigt).
async function mergeSpots(source, target) {
  const t = spotVisits(target)[0];
  const waterTypes = Object.keys(WATER_TYPES)
    .filter((w) => spotWaterTypes(source).includes(w) || spotWaterTypes(target).includes(w));
  const targetVisits = spotVisits(target);
  const custom = (targetVisits.find((e) => e.customName) || {}).customName;
  const place = (targetVisits.find((e) => e.placeName) || {}).placeName;
  for (const v of [...spotVisits(source), ...targetVisits]) {
    const updated = { ...getEntry(v.id), spotId: target, lat: t.lat, lng: t.lng };
    if (waterTypes.length) updated.waterTypes = waterTypes;
    if (place) updated.placeName = place;
    if (custom) updated.customName = custom; else delete updated.customName;
    await updateRating(updated);
  }
  renderRatings();
  openSpot(target);
}

async function handleMergeTarget(target) {
  const source = mergeSource;
  if (!source || target === source) return;
  map.closePopup();
  const a = spotVisits(source)[0];
  const b = spotVisits(target)[0];
  const meters = Math.round(distanceKm(a.lat, a.lng, b.lat, b.lng) * 1000);
  const dist = meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${meters} m`;
  const n = spotVisits(source).length;
  const ok = confirm(`„${spotName(source) || 'Spot'}“ (${n} ${n === 1 ? 'Besuch' : 'Besuche'}) mit ` +
    `„${spotName(target) || 'Spot'}“ zusammenlegen? Die Spots liegen ${dist} auseinander. ` +
    'Alle Besuche landen beim angetippten Spot.');
  stopMerge();
  if (ok) {
    await mergeSpots(source, target);
    showToast('Spots zusammengelegt');
  }
}

function openSpot(key, expandId) {
  // Spot durch den Kartenfilter ausgeblendet: Filter aufheben, damit er sichtbar wird.
  if (!markersBySpot.has(key) && filterActive()) {
    resetMapFilter();
  }
  const marker = markersBySpot.get(key);
  if (!marker) return;
  if (expandId) marker.setPopupContent(buildSpotPopup(key, expandId));
  marker.openPopup();
}

function renderRatings() {
  ratingsLayer.clearLayers();
  markersBySpot.clear();
  for (const key of allSpotKeys()) {
    if (!spotMatchesFilter(key)) continue;
    const visits = spotVisits(key);
    const overall = RATINGS[overallRating(visits)];
    const allManual = visits.every((v) => v.manual);
    const count = visits.length > 1 ? visits.length : '';
    const size = count ? 24 : 18;

    const icon = L.divIcon({
      className: '',
      html: `<div class="rating-dot${allManual ? ' manual' : ''}${count ? ' multi' : ''}" ` +
        `style="background:${overall.color}">${count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([visits[0].lat, visits[0].lng], { icon })
      .bindPopup(buildSpotPopup(key), {
        maxWidth: 300,
        minWidth: 240,
        // Abstand zu den Bedienelementen oben (Menü, Zoom) und unten (Buttons)
        autoPanPaddingTopLeft: L.point(12, 70),
        autoPanPaddingBottomRight: L.point(12, 100),
      })
      .addTo(ratingsLayer);
    marker.on('click', () => { if (mergeSource) handleMergeTarget(key); });
    marker.on('popupopen', () => {
      if (mergeSource) return;
      loadVisiblePhotos(marker.getPopup().getContent());
    });
    marker.on('popupclose', () => marker.getPopup().getContent()
      .querySelectorAll('.photo-section').forEach((sec) => sec.clearPhotos()));
    markersBySpot.set(key, marker);
  }
}

// Ruft Wetter und Wasserstand ab und hängt sie an die (bereits gespeicherte) Bewertung an.
async function loadConditions(id) {
  const entry = ratings.find((r) => r.id === id);
  if (!entry || loadingIds.has(id)) return;
  loadingIds.add(id);
  refreshPopup(id);
  try {
    const conditions = await fetchConditions(entry.lat, entry.lng, conditionsTarget(entry));
    const current = getEntry(id);
    if (current) await updateRating({ ...current, conditions });
    return conditions;
  } finally {
    loadingIds.delete(id);
    refreshPopup(id);
  }
}

// ---- Standort ----

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = !text;
}

function onPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  currentPosition = { lat: latitude, lng: longitude, accuracy };
  const latlng = [latitude, longitude];

  if (!positionMarker) {
    positionMarker = L.circleMarker(latlng, {
      radius: 9, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1,
    }).addTo(map);
    accuracyCircle = L.circle(latlng, {
      radius: accuracy, color: '#1f6feb', weight: 1, fillOpacity: 0.1,
    }).addTo(map);
  } else {
    positionMarker.setLatLng(latlng);
    accuracyCircle.setLatLng(latlng).setRadius(accuracy);
  }

  if (!hasCentered) {
    map.setView(latlng, 17);
    hasCentered = true;
  }

  rateButton.disabled = false;
  setStatus('');
}

function onPositionError(err) {
  const messages = {
    1: 'Standortzugriff verweigert. Bitte in den Einstellungen erlauben.',
    2: 'Standort nicht verfügbar.',
    3: 'Zeitüberschreitung bei der Standortermittlung.',
  };
  setStatus(messages[err.code] || 'Standort konnte nicht ermittelt werden.', true);
  if (!currentPosition) rateButton.disabled = true;
}

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20000,
  });
} else {
  setStatus('Dein Browser unterstützt keine Standortermittlung.', true);
}

// ---- Menü ----

// 'current' = aktueller Standort, 'manual' = auf der Karte gewählter Ort,
// 'visit' = weiterer Besuch an einem vorhandenen Spot (targetSpot)
let menuMode = 'current';
let pickedLatLng = null;
let targetSpot = null;
const visitDateLabelEl = document.getElementById('visit-date-label');

function localDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Die Sicherungs-Erinnerung darf Bedienelemente nicht verdecken.
function hideBackupReminder() {
  const el = document.getElementById('backup-reminder');
  if (el) el.hidden = true;
}

function openMenu(mode) {
  hideBackupReminder();
  menuMode = mode;
  visitDateField.hidden = mode === 'current';
  visitDateLabelEl.innerHTML = mode === 'visit'
    ? 'Datum des Besuchs <span class="muted">(leer = jetzt)</span>'
    : 'Wann warst du dort? <span class="muted">(optional)</span>';
  if (mode !== 'current') {
    visitDateInput.value = '';
    visitTimeInput.value = '';
    visitDateInput.max = localDateString(new Date());
  }
  menu.hidden = false;
  bottomBar.hidden = true;
  rateButton.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  menu.hidden = true;
  bottomBar.hidden = false;
  rateButton.setAttribute('aria-expanded', 'false');
}

function startPicking() {
  hideBackupReminder();
  map.closePopup();
  ratingsLayer.eachLayer((layer) => layer.closePopup());
  bottomBar.hidden = true;
  crosshair.hidden = false;
  pickBar.hidden = false;
}

function stopPicking() {
  crosshair.hidden = true;
  pickBar.hidden = true;
  bottomBar.hidden = false;
}

pickButton.addEventListener('click', startPicking);
document.getElementById('pick-cancel').addEventListener('click', stopPicking);
document.getElementById('pick-confirm').addEventListener('click', () => {
  pickedLatLng = map.getCenter();
  crosshair.hidden = true;
  pickBar.hidden = true;
  openMenu('manual');
});

// Im Auswahlmodus springt die Karte auf einen angetippten Punkt.
map.on('click', (e) => {
  if (!pickBar.hidden) map.panTo(e.latlng);
});

let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}

rateButton.addEventListener('click', () => openMenu('current'));

function newId(now) {
  return now.getTime().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Fragt, ob ein neuer Eintrag in der Nähe eines vorhandenen Spots zu diesem gehören soll.
function askForNearbySpot(lat, lng) {
  const near = nearbySpot(lat, lng);
  if (!near) return null;
  const ok = confirm(`Hier ist bereits ein Spot gespeichert (${Math.round(near.meters)} m entfernt). ` +
    'Als weiteren Besuch zu diesem Spot hinzufügen?\n\nAbbrechen = als neuen Spot speichern.');
  return ok ? near : null;
}

// Eintrag speichern, Karte aktualisieren und ggf. Wetterdaten nachladen.
async function saveEntry(entry, { fetchData, openPopup }) {
  closeMenu();
  try {
    await addRatings([entry]);
  } catch {
    showToast('Fehler: Bewertung konnte nicht gespeichert werden!');
    return;
  }
  renderRatings();
  updateBackupInfo();
  if (openPopup) openSpot(spotKey(entry), entry.id);
  ensureSpotNames();

  const label = RATINGS[entry.rating].label;
  if (!fetchData) {
    showToast(`„${label}“ gespeichert`);
    return;
  }
  showToast(entry.manual
    ? `„${label}“ gespeichert – Wetterdaten vom ${visitDateLabel(entry, false)} werden abgerufen …`
    : `„${label}“ gespeichert – Wetter und Wasserstand werden abgerufen …`);
  const conditions = await loadConditions(entry.id);
  const failed = !conditions || Object.keys(conditions.errors).length > 0;
  showToast(failed
    ? 'Einige Daten konnten nicht abgerufen werden (Details im Spot auf der Karte).'
    : entry.manual ? 'Wetterdaten für den Besuchstag gespeichert' : 'Wetter, Luftdruck und Wasserstand gespeichert');
}

function buildEntry(rating, lat, lng, { accuracy = null, spotId, dated }) {
  const now = new Date();
  const entry = { id: newId(now), mode: currentMode, lat, lng, accuracy, rating, timestamp: now.toISOString() };
  if (spotId) {
    entry.spotId = spotId;
    const visits = spotVisits(spotId);
    const place = (visits.find((e) => e.placeName) || {}).placeName;
    const custom = (visits.find((e) => e.customName) || {}).customName;
    if (place) entry.placeName = place;
    if (custom) entry.customName = custom;
    const waterTypes = spotWaterTypes(spotId);
    if (waterTypes.length) entry.waterTypes = waterTypes;
  }
  if (dated) {
    const visitedAt = visitDateInput.value || null; // JJJJ-MM-TT
    const visitedTime = (visitedAt && visitTimeInput.value) || null; // HH:MM
    Object.assign(entry, {
      manual: true,
      visitedAt,
      visitedTime,
      moon: visitedAt && typeof moonPhaseAt === 'function'
        ? moonPhaseAt(new Date(`${visitedAt}T${visitedTime || '12:00'}:00`)) : null,
    });
  } else {
    entry.moon = typeof moonPhaseAt === 'function' ? moonPhaseAt(now) : null;
  }
  return entry;
}

function saveManualRating(rating) {
  const near = askForNearbySpot(pickedLatLng.lat, pickedLatLng.lng);
  const entry = near
    ? buildEntry(rating, near.lat, near.lng, { spotId: near.key, dated: true })
    : buildEntry(rating, pickedLatLng.lat, pickedLatLng.lng, { dated: true });
  saveEntry(entry, { fetchData: Boolean(entry.visitedAt), openPopup: Boolean(near) });
}

function saveCurrentRating(rating) {
  const near = askForNearbySpot(currentPosition.lat, currentPosition.lng);
  const entry = near
    ? buildEntry(rating, near.lat, near.lng, { spotId: near.key })
    : buildEntry(rating, currentPosition.lat, currentPosition.lng, { accuracy: currentPosition.accuracy });
  saveEntry(entry, { fetchData: true, openPopup: Boolean(near) });
}

// Weiterer Besuch an einem vorhandenen Spot: ohne Datum = jetzt (aktuelle Daten),
// mit Datum = vergangener Besuch (historische Daten).
function saveVisitRating(rating) {
  const visits = spotVisits(targetSpot);
  if (!visits.length) return;
  const { lat, lng } = visits[0];
  const entry = buildEntry(rating, lat, lng, { spotId: targetSpot, dated: Boolean(visitDateInput.value) });
  saveEntry(entry, { fetchData: !entry.manual || Boolean(entry.visitedAt), openPopup: true });
}

menu.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  if (button.hasAttribute('data-cancel')) {
    closeMenu();
    return;
  }

  const rating = button.dataset.rating;
  if (!rating) return;

  if (menuMode === 'visit') {
    if (targetSpot) saveVisitRating(rating);
  } else if (menuMode === 'manual') {
    if (pickedLatLng) saveManualRating(rating);
  } else if (currentPosition) {
    saveCurrentRating(rating);
  }
});

// ---- Sicherung (Export / Import) ----

const backupToggle = document.getElementById('backup-toggle');
const backupPanel = document.getElementById('backup-panel');
const backupInfo = document.getElementById('backup-info');
const exportButton = document.getElementById('export-button');
const importInput = document.getElementById('import-input');
let persistent = false;

const BACKUP_TIME_KEY = 'letzte-sicherung';
const BACKUP_COUNT_KEY = 'eintraege-bei-sicherung';
const REMINDER_SNOOZE_KEY = 'sicherungs-erinnerung-pausiert-bis';
const REMINDER_DAYS = 14;
const REMINDER_NEW_ENTRIES = 10;

function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ohne Speicher */ }
}

function updateBackupInfo() {
  const count = ratings.length;
  const byMode = (m) => ratings.filter((r) => entryMode(r) === m).length;
  const last = readStored(BACKUP_TIME_KEY);
  backupInfo.textContent =
    `${count} ${count === 1 ? 'Bewertung' : 'Bewertungen'} auf diesem Gerät ` +
    `(Raubfisch ${byMode('raubfisch')}, Friedfisch ${byMode('friedfisch')}). ` +
    (last
      ? `Letzte Sicherung: ${new Date(last).toLocaleDateString('de-DE')}.`
      : 'Noch keine Sicherung erstellt.');
}

backupToggle.addEventListener('click', () => {
  backupPanel.hidden = !backupPanel.hidden;
  backupToggle.setAttribute('aria-expanded', String(!backupPanel.hidden));
  if (!backupPanel.hidden) closeFilterPanel();
  updateBackupInfo();
  updateModeUI();
});

function markBackupDone() {
  writeStored(BACKUP_TIME_KEY, new Date().toISOString());
  writeStored(BACKUP_COUNT_KEY, String(ratings.length));
  backupReminder.hidden = true;
  updateBackupInfo();
}

// ---- Sicherungs-Erinnerung ----

const backupReminder = document.getElementById('backup-reminder');
const backupReminderText = document.getElementById('backup-reminder-text');

function checkBackupReminder() {
  if (!ratings.length) return;
  const snoozed = Number(readStored(REMINDER_SNOOZE_KEY) || 0);
  if (Date.now() < snoozed) return;
  const last = readStored(BACKUP_TIME_KEY);
  const countAtBackup = Number(readStored(BACKUP_COUNT_KEY) || 0);
  const newEntries = ratings.length - countAtBackup;
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  let reason = null;
  if (!last && ratings.length >= 3) reason = 'Du hast noch nie eine Sicherung erstellt.';
  else if (last && newEntries >= REMINDER_NEW_ENTRIES) reason = `Seit der letzten Sicherung sind ${newEntries} Einträge dazugekommen.`;
  else if (last && newEntries > 0 && days >= REMINDER_DAYS) reason = `Die letzte Sicherung ist ${Math.floor(days)} Tage her.`;
  if (!reason) return;
  backupReminderText.textContent = `${reason} Sichere deine Daten, z. B. in iCloud Drive, damit sie auch bei Handyverlust erhalten bleiben.`;
  backupReminder.hidden = false;
}

document.getElementById('backup-reminder-later').addEventListener('click', () => {
  writeStored(REMINDER_SNOOZE_KEY, String(Date.now() + 3 * 86400000));
  backupReminder.hidden = true;
});

document.getElementById('backup-reminder-now').addEventListener('click', () => {
  backupReminder.hidden = true;
  backupPanel.hidden = false;
  backupToggle.setAttribute('aria-expanded', 'true');
  updateBackupInfo();
  updateModeUI();
  exportButton.click();
});

// ---- Sparte wechseln (Raubfisch / Friedfisch) ----

const modeBadge = document.getElementById('mode-badge');

function updateModeUI() {
  modeBadge.textContent = `${MODES[currentMode].icon} ${MODES[currentMode].label}`;
  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === currentMode));
  });
}

function setMode(mode) {
  if (!MODES[mode] || mode === currentMode) return;
  currentMode = mode;
  writeStored(MODE_KEY, mode);
  stopMerge();
  map.closePopup();
  mapFilter.fish = null; // Fischarten unterscheiden sich je Sparte
  renderFilterPanel();
  renderRatings();
  updateModeUI();
  updateBackupInfo();
  const n = allSpotKeys().length;
  showToast(`${MODES[mode].icon} ${MODES[mode].label}-Karte: ${n} ${n === 1 ? 'Spot' : 'Spots'}`);
}

document.querySelectorAll('.mode-switch button').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});
modeBadge.addEventListener('click', () => {
  backupPanel.hidden = false;
  backupToggle.setAttribute('aria-expanded', 'true');
  closeFilterPanel();
  updateBackupInfo();
  updateModeUI();
});

// ---- Kartenfilter ----

const filterToggle = document.getElementById('filter-toggle');
const filterPanel = document.getElementById('filter-panel');
const mapFilter = { fish: null, water: null, minScore: 0 };
const MIN_RATING_OPTIONS = [[0, 'Alle'], [2, 'Mittel+'], [3, 'Gut+'], [4, 'Sehr gut']];

function filterActive() {
  return Boolean(mapFilter.fish || mapFilter.water || mapFilter.minScore);
}

function spotMatchesFilter(key) {
  if (!filterActive()) return true;
  const visits = spotVisits(key);
  if (mapFilter.fish && !visits.some((v) => (v.fish || []).includes(mapFilter.fish))) return false;
  if (mapFilter.water && !spotWaterTypes(key).includes(mapFilter.water)) return false;
  if (mapFilter.minScore && SCORES[overallRating(visits)] < mapFilter.minScore) return false;
  return true;
}

function chipRow(container, options, isSelected, onSelect) {
  container.innerHTML = '';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fish-chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(isSelected(value)));
    b.addEventListener('click', () => onSelect(value));
    container.appendChild(b);
  }
}

function applyMapFilter() {
  renderFilterPanel();
  renderRatings();
}

function renderFilterPanel() {
  chipRow(document.getElementById('filter-fish'), [[null, 'Alle'], ...Object.entries(modeFish())],
    (v) => v === mapFilter.fish, (v) => { mapFilter.fish = v; applyMapFilter(); });
  chipRow(document.getElementById('filter-water'), [[null, 'Alle'], ...Object.entries(WATER_TYPES)],
    (v) => v === mapFilter.water, (v) => { mapFilter.water = v; applyMapFilter(); });
  chipRow(document.getElementById('filter-rating'), MIN_RATING_OPTIONS,
    (v) => v === mapFilter.minScore, (v) => { mapFilter.minScore = v; applyMapFilter(); });
  const n = [mapFilter.fish, mapFilter.water, mapFilter.minScore].filter(Boolean).length;
  filterToggle.textContent = n ? `Filter (${n})` : 'Filter';
  filterToggle.classList.toggle('active', n > 0);
}

function resetMapFilter() {
  mapFilter.fish = null;
  mapFilter.water = null;
  mapFilter.minScore = 0;
  applyMapFilter();
}

function closeFilterPanel() {
  filterPanel.hidden = true;
  filterToggle.setAttribute('aria-expanded', 'false');
}

filterToggle.addEventListener('click', () => {
  filterPanel.hidden = !filterPanel.hidden;
  filterToggle.setAttribute('aria-expanded', String(!filterPanel.hidden));
  if (!filterPanel.hidden) {
    backupPanel.hidden = true;
    backupToggle.setAttribute('aria-expanded', 'false');
    renderFilterPanel();
  }
});
document.getElementById('filter-reset').addEventListener('click', resetMapFilter);

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Sicherung erstellen. Auf dem iPhone geht sie über das Teilen-Menü direkt in „Dateien“
// (z. B. iCloud Drive). Teilen braucht einen frischen Tipp, daher zwei Schritte:
// erst Datei erstellen, dann „In Dateien sichern“ antippen.
const shareBackupButton = document.getElementById('share-backup');
let pendingBackupFile = null;

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

exportButton.addEventListener('click', async () => {
  let photos = [];
  try {
    const all = await getAllPhotoBlobs();
    if (all && all.length) showToast(`Sicherung mit ${all.length} Fotos wird erstellt …`);
    for (const p of all || []) {
      photos.push({ id: p.id, entryId: p.entryId, createdAt: p.createdAt, dataUrl: await blobToDataUrl(p.blob) });
    }
  } catch (err) {
    console.warn('Fotos konnten nicht gelesen werden', err);
    photos = [];
  }
  const data = JSON.stringify({ app: 'standort-bewertung', version: 3, ratings, photos });
  const name = `angel-spots-sicherung-${localDateString(new Date())}.json`;
  const file = new File([data], name, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    pendingBackupFile = file;
    shareBackupButton.hidden = false;
    showToast('Sicherung erstellt – jetzt „In Dateien / iCloud Drive sichern“ antippen');
  } else {
    downloadFile(file);
    markBackupDone();
  }
});

shareBackupButton.addEventListener('click', async () => {
  if (!pendingBackupFile) return;
  try {
    await navigator.share({ files: [pendingBackupFile], title: 'Angel-Spots Sicherung' });
    markBackupDone();
    showToast('Sicherung gespeichert');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // abgebrochen
    downloadFile(pendingBackupFile);
    markBackupDone();
  }
  pendingBackupFile = null;
  shareBackupButton.hidden = true;
});

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const list = Array.isArray(parsed) ? parsed : parsed.ratings;
    if (!Array.isArray(list)) throw new Error('Ungültiges Format');
    const valid = list.filter((r) =>
      r && typeof r.id === 'string' && RATINGS[r.rating] &&
      Number.isFinite(r.lat) && Number.isFinite(r.lng) && typeof r.timestamp === 'string');

    let photoCount = 0;
    for (const p of (!Array.isArray(parsed) && parsed.photos) || []) {
      if (!p || typeof p.id !== 'string' || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/')) continue;
      if (await getPhotoBlob(p.id)) continue;
      const blob = await (await fetch(p.dataUrl)).blob();
      await savePhotoBlob({ id: p.id, entryId: p.entryId, blob, createdAt: p.createdAt });
      photoCount++;
    }

    const added = await addRatings(valid);
    renderRatings();
    updateBackupInfo();
    ensureSpotNames();
    showToast(`${added} ${added === 1 ? 'Bewertung' : 'Bewertungen'}` +
      (photoCount ? ` und ${photoCount} ${photoCount === 1 ? 'Foto' : 'Fotos'}` : '') + ' wiederhergestellt');
  } catch {
    showToast('Datei konnte nicht gelesen werden');
  }
});

const ratingsReady = loadRatings();

(async () => {
  await ratingsReady;
  updateModeUI();
  renderFilterPanel();
  renderRatings();
  ensureSpotNames();
  persistent = await requestPersistentStorage();
  updateBackupInfo();
  checkBackupReminder();
})();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
