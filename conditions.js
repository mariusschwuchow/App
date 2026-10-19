// Ruft Wetter, Luftdruck und Wasserstand für einen Standort ab.
//
// Wetter und Luftdruck: Open-Meteo (https://open-meteo.com), kostenlos, ohne Schlüssel.
// Wasserstand: PEGELONLINE der Wasserstraßen- und Schifffahrtsverwaltung des Bundes
// (https://www.pegelonline.wsv.de). Enthält die Pegel an Bundeswasserstraßen; kleinere
// Gewässer und Seen werden oft von Landesämtern gemessen und sind dort nicht enthalten.

const PEGEL_RADIUS_KM = 25;
const FETCH_TIMEOUT_MS = 15000;
const DAY_S = 86400;
// Die Vorhersage-API liefert Werte bis ca. 92 Tage zurück, ältere kommen aus dem Archiv.
const FORECAST_API_MAX_PAST_DAYS = 85;
// PEGELONLINE speichert Messwerte nur etwa 30 Tage.
const PEGEL_HISTORY_DAYS = 30;

const HOURLY_WEATHER_VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code',
  'cloud_cover', 'precipitation', 'wind_speed_10m', 'wind_direction_10m',
  'wind_gusts_10m', 'pressure_msl',
];

const WEATHER_CODES = {
  0: 'Klar',
  1: 'Überwiegend klar',
  2: 'Teilweise bewölkt',
  3: 'Bedeckt',
  45: 'Nebel',
  48: 'Nebel mit Reif',
  51: 'Leichter Nieselregen',
  53: 'Nieselregen',
  55: 'Starker Nieselregen',
  56: 'Leichter gefrierender Nieselregen',
  57: 'Gefrierender Nieselregen',
  61: 'Leichter Regen',
  63: 'Regen',
  65: 'Starker Regen',
  66: 'Leichter gefrierender Regen',
  67: 'Gefrierender Regen',
  71: 'Leichter Schneefall',
  73: 'Schneefall',
  75: 'Starker Schneefall',
  77: 'Schneegriesel',
  80: 'Leichte Regenschauer',
  81: 'Regenschauer',
  82: 'Heftige Regenschauer',
  85: 'Leichte Schneeschauer',
  86: 'Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit Hagel',
  99: 'Schweres Gewitter mit Hagel',
};

function weatherDescription(code) {
  return WEATHER_CODES[code] || 'Unbekannt';
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// Aktuelles Wetter sowie Luftdruck (auf Meereshöhe reduziert, wie im Wetterbericht)
// jetzt, 24 Stunden vorher und 24 Stunden später (Vorhersage).
async function fetchWeather(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code',
      'cloud_cover', 'precipitation', 'wind_speed_10m', 'wind_direction_10m',
      'wind_gusts_10m', 'pressure_msl',
    ].join(','),
    hourly: 'pressure_msl,temperature_2m',
    past_days: '7',
    forecast_days: '2',
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  const data = await fetchJson(openMeteoUrl('forecast', params));
  const c = data.current || {};

  const times = (data.hourly && data.hourly.time) || [];
  const pressures = (data.hourly && data.hourly.pressure_msl) || [];
  const now = Math.floor(Date.now() / 1000);
  const waterTempEstimate = estimateWaterTemp(times, (data.hourly && data.hourly.temperature_2m) || [], now);
  const pressureAt = (target) => {
    let best = -1;
    let bestDiff = Infinity;
    times.forEach((t, i) => {
      const diff = Math.abs(t - target);
      if (diff < bestDiff && Number.isFinite(pressures[i])) {
        best = i;
        bestDiff = diff;
      }
    });
    // Nur akzeptieren, wenn ein Wert innerhalb einer Stunde um den Zielzeitpunkt existiert.
    return best >= 0 && bestDiff <= 3600 ? round(pressures[best]) : null;
  };

  return {
    weather: {
      description: weatherDescription(c.weather_code),
      weatherCode: c.weather_code ?? null,
      temperature: round(c.temperature_2m),
      apparentTemperature: round(c.apparent_temperature),
      humidity: round(c.relative_humidity_2m, 0),
      cloudCover: round(c.cloud_cover, 0),
      precipitation: round(c.precipitation),
      windSpeed: round(c.wind_speed_10m),
      windGusts: round(c.wind_gusts_10m),
      windDirection: round(c.wind_direction_10m, 0),
      source: 'Open-Meteo',
    },
    pressure: {
      unit: 'hPa',
      current: round(c.pressure_msl) ?? pressureAt(now),
      yesterday: pressureAt(now - 86400),
      tomorrow: pressureAt(now + 86400),
      tomorrowIsForecast: true,
      source: 'Open-Meteo',
    },
    waterTempEstimate,
  };
}

// Grobe Schätzung der Wassertemperatur aus dem Mittel der Lufttemperatur der letzten
// 7 Tage (Faustformel für Fließgewässer nach Stefan & Preud'homme: Tw ≈ 5 + 0,75 · Tl).
// Nur als Ersatz, wenn kein Pegel misst und nichts selbst gemessen wurde.
function estimateWaterTemp(times, temps, target) {
  const values = [];
  times.forEach((t, i) => {
    if (t > target - 7 * DAY_S && t <= target && Number.isFinite(temps[i])) values.push(temps[i]);
  });
  if (values.length < 72) return null; // mindestens 3 Tage Daten
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return round(Math.max(0, 5 + 0.75 * mean));
}

function utcDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Wetter zu einem vergangenen Zeitpunkt (Unix-Sekunden) sowie Luftdruck 24 Stunden
// davor und danach. Werte stammen aus stündlichen Modell- bzw. Reanalysedaten.
async function fetchHistoricalWeather(lat, lng, target) {
  const now = Math.floor(Date.now() / 1000);
  const recent = target >= now - FORECAST_API_MAX_PAST_DAYS * DAY_S;
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly: HOURLY_WEATHER_VARS.join(','),
    start_date: utcDateString(target - 8 * DAY_S),
    end_date: utcDateString(target + 2 * DAY_S),
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  const data = await fetchJson(openMeteoUrl(recent ? 'forecast' : 'archive', params));
  const h = data.hourly || {};
  const times = h.time || [];

  const indexAt = (t, key) => {
    let best = -1;
    let bestDiff = Infinity;
    times.forEach((time, i) => {
      const diff = Math.abs(time - t);
      if (diff < bestDiff && Number.isFinite((h[key] || [])[i])) {
        best = i;
        bestDiff = diff;
      }
    });
    return best >= 0 && bestDiff <= 3600 ? best : -1;
  };
  const valueAt = (t, key, digits = 1) => {
    const i = indexAt(t, key);
    return i >= 0 ? round(h[key][i], digits) : null;
  };

  const code = valueAt(target, 'weather_code', 0);
  if (code === null && valueAt(target, 'temperature_2m') === null) {
    throw new Error('Keine Wetterdaten für diesen Zeitpunkt');
  }
  return {
    weather: {
      description: code === null ? 'Unbekannt' : weatherDescription(code),
      weatherCode: code,
      temperature: valueAt(target, 'temperature_2m'),
      apparentTemperature: valueAt(target, 'apparent_temperature'),
      humidity: valueAt(target, 'relative_humidity_2m', 0),
      cloudCover: valueAt(target, 'cloud_cover', 0),
      precipitation: valueAt(target, 'precipitation'),
      windSpeed: valueAt(target, 'wind_speed_10m'),
      windGusts: valueAt(target, 'wind_gusts_10m'),
      windDirection: valueAt(target, 'wind_direction_10m', 0),
      source: recent ? 'Open-Meteo' : 'Open-Meteo (Archiv)',
    },
    pressure: {
      unit: 'hPa',
      current: valueAt(target, 'pressure_msl'),
      yesterday: valueAt(target - DAY_S, 'pressure_msl'),
      tomorrow: valueAt(target + DAY_S, 'pressure_msl'),
      tomorrowIsForecast: target + DAY_S > now,
      source: recent ? 'Open-Meteo' : 'Open-Meteo (Archiv)',
    },
    waterTempEstimate: estimateWaterTemp(times, h.temperature_2m || [], target),
  };
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Nächstgelegener Pegel mit Wasserstandsmessung (innerhalb von PEGEL_RADIUS_KM).
async function findNearestGauge(lat, lng, withCurrent) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    radius: String(PEGEL_RADIUS_KM),
    timeseries: 'W',
    includeTimeseries: 'true',
    includeCurrentMeasurement: String(withCurrent),
  });
  const stations = await fetchJson(
    pegelonlineUrl('/stations.json', params));

  let nearest = null;
  for (const s of stations || []) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const ts = (s.timeseries || []).find((t) => t.shortname === 'W' && (!withCurrent || t.currentMeasurement));
    if (!ts) continue;
    const dist = distanceKm(lat, lng, s.latitude, s.longitude);
    if (dist > PEGEL_RADIUS_KM) continue;
    if (!nearest || dist < nearest.dist) nearest = { station: s, ts, dist };
  }
  return nearest;
}

function gaugeInfo({ station, ts, dist }) {
  return {
    station: station.longname || station.shortname || station.number,
    water: (station.water && (station.water.longname || station.water.shortname)) || null,
    distanceKm: round(dist),
    unit: ts.unit || 'cm',
    source: 'PEGELONLINE (WSV)',
  };
}

// Aktueller Wasserstand am nächstgelegenen Pegel.
async function fetchWaterLevel(lat, lng) {
  const nearest = await findNearestGauge(lat, lng, true);
  if (!nearest) return null;
  const m = nearest.ts.currentMeasurement;
  return {
    ...gaugeInfo(nearest),
    value: m.value,
    measuredAt: m.timestamp || null,
    trend: Number.isFinite(m.trend) ? m.trend : null,
    state: m.stateMnwMhw || null,
  };
}

// Wasserstand zu einem vergangenen Zeitpunkt (Unix-Sekunden), nur ca. 30 Tage zurück.
async function fetchHistoricalWaterLevel(lat, lng, target) {
  const nearest = await findNearestGauge(lat, lng, false);
  if (!nearest) return null;
  const uuid = nearest.station.uuid;
  const params = new URLSearchParams({
    start: new Date((target - 3 * 3600) * 1000).toISOString(),
    end: new Date((target + 3 * 3600) * 1000).toISOString(),
  });
  const measurements = await fetchJson(
    pegelonlineUrl(`/stations/${encodeURIComponent(uuid)}/W/measurements.json`, params));

  let best = null;
  for (const m of measurements || []) {
    const t = Date.parse(m.timestamp) / 1000;
    if (!Number.isFinite(t) || !Number.isFinite(m.value)) continue;
    if (!best || Math.abs(t - target) < Math.abs(best.t - target)) best = { t, m };
  }
  if (!best) throw new Error('Keine Messwerte für diesen Zeitpunkt');
  return {
    ...gaugeInfo(nearest),
    value: best.m.value,
    measuredAt: best.m.timestamp,
    trend: null,
    state: null,
  };
}

// ---- Wassertemperatur (Zeitreihe „WT“, nur an einem Teil der Pegel gemessen) ----

const WATER_TEMP_CACHE_MS = 30 * 60 * 1000;
// Wassertemperatur ändert sich entlang eines Flusses nur langsam: größerer Suchradius.
const WATER_TEMP_RADIUS_KM = 50;
let waterTempStationsCache = { time: 0, promise: null };

// Alle Pegel mit Wassertemperatur in einer Anfrage (deutlich weniger als mit Wasserstand).
function fetchWaterTempStations() {
  if (!waterTempStationsCache.promise || Date.now() - waterTempStationsCache.time > WATER_TEMP_CACHE_MS) {
    const params = new URLSearchParams({
      timeseries: 'WT',
      includeTimeseries: 'true',
      includeCurrentMeasurement: 'true',
    });
    const promise = fetchJson(pegelonlineUrl('/stations.json', params));
    promise.catch(() => { waterTempStationsCache = { time: 0, promise: null }; });
    waterTempStationsCache = { time: Date.now(), promise };
  }
  return waterTempStationsCache.promise;
}

function nearestWaterTempStation(stations, lat, lng) {
  let nearest = null;
  for (const s of stations || []) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const ts = (s.timeseries || []).find((t) => t.shortname === 'WT');
    if (!ts) continue;
    const dist = distanceKm(lat, lng, s.latitude, s.longitude);
    if (dist > WATER_TEMP_RADIUS_KM) continue;
    if (!nearest || dist < nearest.dist) nearest = { station: s, ts, dist };
  }
  return nearest;
}

// Wassertemperatur am nächsten Pegel – aktuell (target = null) oder zu einem vergangenen
// Zeitpunkt (nur ca. 30 Tage zurück). null = kein Pegel mit Temperatur in der Nähe.
async function fetchWaterTemperature(lat, lng, target = null) {
  const nearest = nearestWaterTempStation(await fetchWaterTempStations(), lat, lng);
  if (!nearest) return null;
  const info = { ...gaugeInfo(nearest), unit: '°C' };

  if (target === null) {
    const m = nearest.ts.currentMeasurement;
    if (!m || !Number.isFinite(m.value)) return null;
    return { ...info, value: round(m.value), measuredAt: m.timestamp || null };
  }

  const params = new URLSearchParams({
    start: new Date((target - 3 * 3600) * 1000).toISOString(),
    end: new Date((target + 3 * 3600) * 1000).toISOString(),
  });
  const measurements = await fetchJson(
    pegelonlineUrl(`/stations/${encodeURIComponent(nearest.station.uuid)}/WT/measurements.json`, params));
  let best = null;
  for (const m of measurements || []) {
    const t = Date.parse(m.timestamp) / 1000;
    if (!Number.isFinite(t) || !Number.isFinite(m.value)) continue;
    if (!best || Math.abs(t - target) < Math.abs(best.t - target)) best = { t, m };
  }
  if (!best) return null;
  return { ...info, value: round(best.m.value), measuredAt: best.m.timestamp };
}

// Ruft alle Daten parallel ab – für jetzt (target = null) oder einen vergangenen
// Zeitpunkt (Unix-Sekunden). Teilfehler werden pro Bereich vermerkt, damit z. B. das
// Wetter auch dann gespeichert wird, wenn der Pegel nicht erreichbar ist.
async function fetchConditions(lat, lng, target = null) {
  const now = Math.floor(Date.now() / 1000);
  const waterTooOld = target !== null && target < now - PEGEL_HISTORY_DAYS * DAY_S;

  const [weather, water, waterTemp] = await Promise.allSettled([
    target === null ? fetchWeather(lat, lng) : fetchHistoricalWeather(lat, lng, target),
    target === null ? fetchWaterLevel(lat, lng)
      : waterTooOld ? Promise.resolve(undefined) : fetchHistoricalWaterLevel(lat, lng, target),
    waterTooOld ? Promise.resolve(undefined) : fetchWaterTemperature(lat, lng, target),
  ]);
  const result = { fetchedAt: new Date().toISOString(), errors: {} };
  if (target !== null) result.for = new Date(target * 1000).toISOString();

  if (weather.status === 'fulfilled') {
    result.weather = weather.value.weather;
    result.pressure = weather.value.pressure;
    result.waterTempEstimate = weather.value.waterTempEstimate ?? null;
  } else {
    result.errors.weather = String(weather.reason && weather.reason.message || weather.reason);
  }

  if (waterTooOld) {
    result.waterLevelUnavailable = true; // zu weit zurück für PEGELONLINE
  } else if (water.status === 'fulfilled') {
    result.waterLevel = water.value; // null = kein Pegel in der Nähe
  } else {
    result.errors.waterLevel = String(water.reason && water.reason.message || water.reason);
  }

  // Fehlende Wassertemperatur ist kein Fehler (viele Pegel messen sie nicht).
  if (!waterTooOld) {
    result.waterTemp = waterTemp.status === 'fulfilled' ? waterTemp.value : null;
  }
  return result;
}
