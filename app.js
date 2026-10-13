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

function loadRatings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRatings(ratings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
}

// ---- Bewertungen auf der Karte ----

const ratingsLayer = L.layerGroup().addTo(map);

function renderRatings() {
  ratingsLayer.clearLayers();
  for (const entry of loadRatings()) {
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
    del.addEventListener('click', () => {
      saveRatings(loadRatings().filter((r) => r.id !== entry.id));
      renderRatings();
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

menu.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  if (button.hasAttribute('data-cancel')) {
    closeMenu();
    return;
  }

  const rating = button.dataset.rating;
  if (!rating || !currentPosition) return;

  const ratings = loadRatings();
  ratings.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    lat: currentPosition.lat,
    lng: currentPosition.lng,
    accuracy: currentPosition.accuracy,
    rating,
    timestamp: new Date().toISOString(),
  });
  saveRatings(ratings);
  renderRatings();
  closeMenu();
  showToast(`„${RATINGS[rating].label}“ für diesen Standort gespeichert`);
});

renderRatings();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
