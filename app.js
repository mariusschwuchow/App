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

function renderRatings() {
  ratingsLayer.clearLayers();
  for (const entry of ratings) {
    const rating = RATINGS[entry.rating];
    if (!rating) continue;

    const icon = L.divIcon({
      className: '',
      html: `<div class="rating-dot" style="background:${rating.color}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    const popup = document.createElement('div');
    popup.innerHTML = `<strong>${rating.label}</strong><br>${new Date(entry.timestamp).toLocaleString('de-DE')}<br>`;
    const del = document.createElement('button');
    del.className = 'popup-delete';
    del.textContent = 'Löschen';
    del.addEventListener('click', async () => {
      if (!confirm(`Bewertung „${rating.label}“ wirklich löschen?`)) return;
      await deleteRating(entry.id);
      renderRatings();
      updateBackupInfo();
    });
    popup.appendChild(del);

    L.marker([entry.lat, entry.lng], { icon }).bindPopup(popup).addTo(ratingsLayer);
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

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    lat: currentPosition.lat,
    lng: currentPosition.lng,
    accuracy: currentPosition.accuracy,
    rating,
    timestamp: new Date().toISOString(),
  };

  closeMenu();
  try {
    await addRatings([entry]);
    renderRatings();
    updateBackupInfo();
    showToast(`„${RATINGS[rating].label}“ für diesen Standort gespeichert`);
  } catch {
    showToast('Fehler: Bewertung konnte nicht gespeichert werden!');
  }
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
