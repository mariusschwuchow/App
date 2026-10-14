// Ortsnamen für Spots über Nominatim (OpenStreetMap), z. B. „Holweide, Köln“.
// Nutzungsregeln von Nominatim: höchstens eine Anfrage pro Sekunde, Ergebnisse
// speichern statt erneut abfragen – deshalb läuft alles über eine Warteschlange und
// der Name wird beim Spot gespeichert.

const GEOCODE_INTERVAL_MS = 1100;
let geocodeQueue = Promise.resolve();

async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(5),
    lon: lng.toFixed(5),
    zoom: '14', // Ebene Ortsteil/Dorf
    addressdetails: '1',
    'accept-language': 'de',
  });
  const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`);
  const a = (data && data.address) || {};
  const local = a.suburb || a.village || a.hamlet || a.quarter || a.city_district ||
    a.borough || a.neighbourhood || a.town;
  const city = a.city || a.town || a.municipality || a.county;
  if (local && city && local !== city) return `${local}, ${city}`;
  return local || city || a.state || (data && data.name) || null;
}

// Reiht eine Anfrage ein, damit mindestens GEOCODE_INTERVAL_MS zwischen Anfragen liegen.
function queueReverseGeocode(lat, lng) {
  const result = geocodeQueue.then(() => reverseGeocode(lat, lng));
  geocodeQueue = result.catch(() => {}).then(() => new Promise((r) => setTimeout(r, GEOCODE_INTERVAL_MS)));
  return result;
}
