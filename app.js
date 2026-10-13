const STORAGE_KEY = 'standort-bewertungen';

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

let ratings = [];
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB nicht verfügbar'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function dbRequest(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const result = fn(tx.objectStore(DB_STORE));
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
  ratings = ratings.filter((r) => r.id !== id);
  try {
    await dbRequest('readwrite', (store) => store.delete(id));
  } catch (err) {
    console.warn('IndexedDB konnte nicht geschrieben werden', err);
  }
  writeLocalCopy();
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

const markersById = new Map();
const RETRY_WINDOW_MS = 3 * 60 * 60 * 1000;
const loadingIds = new Set();

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
      `Aktuell: ${fmt(pr.current, 'hPa')}<br>` +
      `Folgetag: ${fmt(pr.tomorrow, 'hPa')} <span class="muted">(Vorhersage)</span></div>`;
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
  } else if (c.waterLevel === null) {
    html += `<div class="cond muted">Kein Pegel im Umkreis von ${PEGEL_RADIUS_KM} km gefunden.</div>`;
  }
  return html;
}

function canRetry(entry) {
  const c = entry.conditions;
  const incomplete = !c || (c.errors && Object.keys(c.errors).length > 0);
  return incomplete && !loadingIds.has(entry.id) &&
    Date.now() - new Date(entry.timestamp).getTime() < RETRY_WINDOW_MS;
}

function buildPopup(entry) {
  const rating = RATINGS[entry.rating];
  const popup = document.createElement('div');
  popup.className = 'popup';
  // Ältere Bewertungen ohne gespeicherte Mondphase: aus dem Zeitpunkt berechnen.
  const moon = entry.moon || moonPhaseAt(new Date(entry.timestamp));
  popup.innerHTML = `<strong>${rating.label}</strong><br>${new Date(entry.timestamp).toLocaleString('de-DE')}` +
    `<div class="cond"><b>Mond:</b> ${moon.symbol} ${moon.name}, ${moon.illumination} % beleuchtet</div>` +
    conditionsHtml(entry);

  const actions = document.createElement('div');
  actions.className = 'popup-actions';

  if (canRetry(entry)) {
    const retry = document.createElement('button');
    retry.className = 'popup-retry';
    retry.textContent = 'Daten erneut abrufen';
    retry.addEventListener('click', () => loadConditions(entry.id));
    actions.appendChild(retry);
  }

  const del = document.createElement('button');
  del.className = 'popup-delete';
  del.textContent = 'Löschen';
  del.addEventListener('click', async () => {
    if (!confirm(`Bewertung „${rating.label}“ wirklich löschen?`)) return;
    await deleteRating(entry.id);
    renderRatings();
    updateBackupInfo();
  });
  actions.appendChild(del);
  popup.appendChild(actions);
  return popup;
}

function refreshPopup(id) {
  const marker = markersById.get(id);
  const entry = ratings.find((r) => r.id === id);
  if (marker && entry) marker.setPopupContent(buildPopup(entry));
}

function renderRatings() {
  ratingsLayer.clearLayers();
  markersById.clear();
  for (const entry of ratings) {
    const rating = RATINGS[entry.rating];
    if (!rating) continue;

    const icon = L.divIcon({
      className: '',
      html: `<div class="rating-dot" style="background:${rating.color}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    const marker = L.marker([entry.lat, entry.lng], { icon })
      .bindPopup(buildPopup(entry), { maxWidth: 280 })
      .addTo(ratingsLayer);
    markersById.set(entry.id, marker);
  }
}

// Ruft Wetter und Wasserstand ab und hängt sie an die (bereits gespeicherte) Bewertung an.
async function loadConditions(id) {
  const entry = ratings.find((r) => r.id === id);
  if (!entry || loadingIds.has(id)) return;
  loadingIds.add(id);
  refreshPopup(id);
  try {
    const conditions = await fetchConditions(entry.lat, entry.lng);
    const current = ratings.find((r) => r.id === id);
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

function openMenu() {
  menu.hidden = false;
  rateButton.hidden = true;
  rateButton.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  menu.hidden = true;
  rateButton.hidden = false;
  rateButton.setAttribute('aria-expanded', 'false');
}

let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
}

rateButton.addEventListener('click', openMenu);

menu.addEventListener('click', async (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  if (button.hasAttribute('data-cancel')) {
    closeMenu();
    return;
  }

  const rating = button.dataset.rating;
  if (!rating || !currentPosition) return;

  const now = new Date();
  const entry = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 7),
    lat: currentPosition.lat,
    lng: currentPosition.lng,
    accuracy: currentPosition.accuracy,
    rating,
    timestamp: now.toISOString(),
    moon: moonPhaseAt(now),
  };

  closeMenu();
  try {
    await addRatings([entry]);
  } catch {
    showToast('Fehler: Bewertung konnte nicht gespeichert werden!');
    return;
  }
  renderRatings();
  updateBackupInfo();
  showToast(`„${RATINGS[rating].label}“ gespeichert – Wetter und Wasserstand werden abgerufen …`);

  const conditions = await loadConditions(entry.id);
  const failed = !conditions || Object.keys(conditions.errors).length > 0;
  showToast(failed
    ? 'Einige Daten konnten nicht abgerufen werden (Details im Punkt auf der Karte).'
    : 'Wetter, Luftdruck und Wasserstand gespeichert');
});

// ---- Sicherung (Export / Import) ----

const backupToggle = document.getElementById('backup-toggle');
const backupPanel = document.getElementById('backup-panel');
const backupInfo = document.getElementById('backup-info');
const exportButton = document.getElementById('export-button');
const importInput = document.getElementById('import-input');
let persistent = false;

function updateBackupInfo() {
  const count = ratings.length;
  backupInfo.textContent =
    `${count} ${count === 1 ? 'Bewertung' : 'Bewertungen'} auf diesem Gerät gespeichert. ` +
    (persistent
      ? 'Der Browser hat dauerhaften Speicher zugesagt.'
      : 'Tipp: Regelmäßig sichern, damit die Daten auch beim Gerätewechsel erhalten bleiben.');
}

backupToggle.addEventListener('click', () => {
  backupPanel.hidden = !backupPanel.hidden;
  backupToggle.setAttribute('aria-expanded', String(!backupPanel.hidden));
  updateBackupInfo();
});

exportButton.addEventListener('click', () => {
  const data = JSON.stringify({ app: 'standort-bewertung', version: 1, ratings }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `standort-bewertungen-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const added = await addRatings(valid);
    renderRatings();
    updateBackupInfo();
    showToast(`${added} Bewertungen wiederhergestellt`);
  } catch {
    showToast('Datei konnte nicht gelesen werden');
  }
});

const ratingsReady = loadRatings();

(async () => {
  await ratingsReady;
  renderRatings();
  persistent = await requestPersistentStorage();
  updateBackupInfo();
})();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
