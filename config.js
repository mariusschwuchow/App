// Zentrale Einstellungen für alle externen Dienste. Für einen kommerziellen Betrieb (siehe
// Quellen & Lizenzen) werden hier die Adressen bzw. Schlüssel bezahlter Anbieter eingetragen –
// der übrige Code bleibt unverändert.

const SERVICES = {
  // Wetter, Luftdruck, Vorhersage – Open-Meteo (Daten: CC BY 4.0).
  // Kostenlos nur für nicht-kommerzielle Nutzung. Mit Abo: apiKey eintragen; dann werden
  // automatisch die Kunden-Server (customer-api…) verwendet.
  openMeteo: {
    apiKey: '',
    forecastUrl: 'https://api.open-meteo.com/v1/forecast',
    archiveUrl: 'https://archive-api.open-meteo.com/v1/archive',
    customerForecastUrl: 'https://customer-api.open-meteo.com/v1/forecast',
    customerArchiveUrl: 'https://customer-archive-api.open-meteo.com/v1/archive',
  },

  // Wasserstand und Wassertemperatur – PEGELONLINE der WSV.
  pegelonline: {
    baseUrl: 'https://www.pegelonline.wsv.de/webservices/rest-api/v2',
  },

  // Ortsnamen und Ortssuche – Nominatim (OpenStreetMap-Daten, ODbL).
  // Öffentliche Instanz nur bei moderater Nutzung; für mehr Nutzer eigener/kommerzieller Dienst.
  nominatim: {
    baseUrl: 'https://nominatim.openstreetmap.org',
    contactEmail: '', // optional: wird als „email“-Parameter mitgeschickt (Nutzungsregeln)
  },

  // Kartenkacheln
  streetTiles: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    maxZoom: 19,
  },
  satelliteTiles: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Luftbild &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    maxNativeZoom: 18,
  },
};

function openMeteoUrl(kind, params) {
  const c = SERVICES.openMeteo;
  const base = kind === 'archive'
    ? (c.apiKey ? c.customerArchiveUrl : c.archiveUrl)
    : (c.apiKey ? c.customerForecastUrl : c.forecastUrl);
  const p = new URLSearchParams(params);
  if (c.apiKey) p.set('apikey', c.apiKey);
  return `${base}?${p}`;
}

function pegelonlineUrl(path, params) {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return `${SERVICES.pegelonline.baseUrl}${path}${query}`;
}

function nominatimUrl(path, params) {
  const p = new URLSearchParams(params);
  if (SERVICES.nominatim.contactEmail) p.set('email', SERVICES.nominatim.contactEmail);
  return `${SERVICES.nominatim.baseUrl}${path}?${p}`;
}
