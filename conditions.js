// Ruft Wetter, Luftdruck und Wasserstand für einen Standort ab.
//
// Wetter und Luftdruck: Open-Meteo (https://open-meteo.com), kostenlos, ohne Schlüssel.
// Wasserstand: PEGELONLINE der Wasserstraßen- und Schifffahrtsverwaltung des Bundes
// (https://www.pegelonline.wsv.de). Enthält die Pegel an Bundeswasserstraßen; kleinere
// Gewässer und Seen werden oft von Landesämtern gemessen und sind dort nicht enthalten.

const PEGEL_RADIUS_KM = 25;
const FETCH_TIMEOUT_MS = 15000;

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
    hourly: 'pressure_msl',
    past_days: '1',
    forecast_days: '2',
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const c = data.current || {};

  const times = (data.hourly && data.hourly.time) || [];
  const pressures = (data.hourly && data.hourly.pressure_msl) || [];
  const now = Math.floor(Date.now() / 1000);
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
      source: 'Open-Meteo',
    },
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

// Wasserstand am nächstgelegenen Pegel (innerhalb von PEGEL_RADIUS_KM).
async function fetchWaterLevel(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    radius: String(PEGEL_RADIUS_KM),
    timeseries: 'W',
    includeTimeseries: 'true',
    includeCurrentMeasurement: 'true',
  });
  const stations = await fetchJson(
    `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?${params}`);

  let nearest = null;
  for (const s of stations || []) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const ts = (s.timeseries || []).find((t) => t.shortname === 'W' && t.currentMeasurement);
    if (!ts) continue;
    const dist = distanceKm(lat, lng, s.latitude, s.longitude);
    if (dist > PEGEL_RADIUS_KM) continue;
    if (!nearest || dist < nearest.dist) nearest = { station: s, ts, dist };
  }
  if (!nearest) return null;

  const { station, ts, dist } = nearest;
  const m = ts.currentMeasurement;
  return {
    station: station.longname || station.shortname || station.number,
    water: (station.water && (station.water.longname || station.water.shortname)) || null,
    distanceKm: round(dist),
    value: m.value,
    unit: ts.unit || 'cm',
    measuredAt: m.timestamp || null,
    trend: Number.isFinite(m.trend) ? m.trend : null,
    state: m.stateMnwMhw || null,
    source: 'PEGELONLINE (WSV)',
  };
}

// Ruft alle Daten parallel ab. Teilfehler werden pro Bereich vermerkt, damit z. B. das
// Wetter auch dann gespeichert wird, wenn der Pegel nicht erreichbar ist.
async function fetchConditions(lat, lng) {
  const [weather, water] = await Promise.allSettled([
    fetchWeather(lat, lng),
    fetchWaterLevel(lat, lng),
  ]);
  const result = { fetchedAt: new Date().toISOString(), errors: {} };

  if (weather.status === 'fulfilled') {
    result.weather = weather.value.weather;
    result.pressure = weather.value.pressure;
  } else {
    result.errors.weather = String(weather.reason && weather.reason.message || weather.reason);
  }

  if (water.status === 'fulfilled') {
    result.waterLevel = water.value; // null = kein Pegel in der Nähe
  } else {
    result.errors.waterLevel = String(water.reason && water.reason.message || water.reason);
  }
  return result;
}
