// Darstellung (Hell / Dunkel / Rotlicht für die Nacht) und Kartenart (Karte / Satellit).

const THEME_KEY = 'darstellung';
const LAYER_KEY = 'kartenart';
const THEMES = [['hell', '☀️ Hell'], ['dunkel', '🌙 Dunkel'], ['rot', '🔴 Rotlicht']];

const nightOverlay = document.getElementById('night-overlay');
let currentTheme = readStored(THEME_KEY) || 'hell';

// Rotlicht = dunkle Ansicht + rote Ebene im Modus „multiply“: übrig bleiben nur Rottöne,
// die die Nachtsicht kaum beeinträchtigen.
function applyTheme(theme) {
  currentTheme = THEMES.some(([t]) => t === theme) ? theme : 'hell';
  document.documentElement.dataset.theme = currentTheme === 'hell' ? 'light' : 'dark';
  nightOverlay.hidden = currentTheme !== 'rot';
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', currentTheme === 'hell' ? '#1f6feb' : currentTheme === 'rot' ? '#200000' : '#0d1117');
  writeStored(THEME_KEY, currentTheme);
  chipRow(document.getElementById('theme-switch'), THEMES, (v) => v === currentTheme, applyTheme);
}

// ---- Satellitenansicht (Esri World Imagery) ----

const satelliteLayer = L.tileLayer(SERVICES.satelliteTiles.url, {
  maxZoom: SERVICES.satelliteTiles.maxZoom,
  maxNativeZoom: SERVICES.satelliteTiles.maxNativeZoom,
  attribution: SERVICES.satelliteTiles.attribution,
});
// Ortsnamen und Grenzen über dem Luftbild zur Orientierung
const satelliteLabels = L.tileLayer(SERVICES.satelliteTiles.labelsUrl, {
  maxZoom: SERVICES.satelliteTiles.maxZoom,
  maxNativeZoom: SERVICES.satelliteTiles.maxNativeZoom,
});
const layerToggle = document.getElementById('layer-toggle');

function applyLayer(kind) {
  const satellite = kind === 'satellit';
  if (satellite) {
    map.removeLayer(streetLayer);
    satelliteLayer.addTo(map);
    satelliteLabels.addTo(map);
  } else {
    map.removeLayer(satelliteLayer);
    map.removeLayer(satelliteLabels);
    streetLayer.addTo(map);
  }
  document.documentElement.dataset.layer = satellite ? 'satellit' : 'karte';
  layerToggle.setAttribute('aria-pressed', String(satellite));
  layerToggle.textContent = satellite ? '🗺️' : '🛰️';
  layerToggle.title = satellite ? 'Straßenkarte' : 'Satellitenansicht';
  writeStored(LAYER_KEY, satellite ? 'satellit' : 'karte');
}

layerToggle.addEventListener('click', () => {
  applyLayer(document.documentElement.dataset.layer === 'satellit' ? 'karte' : 'satellit');
});

applyTheme(currentTheme);
applyLayer(readStored(LAYER_KEY) || 'karte');
