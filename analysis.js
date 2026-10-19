// Spot-Analyse: vergleicht die Wettervorhersage (heute, morgen, übermorgen) mit den
// Bedingungen früherer Besuche und empfiehlt Spots, an denen es bei ähnlichem Wetter
// gut lief.
//
// Ähnlichkeit je Merkmal: 1 bei gleichem Wert, linear fallend bis 0 bei „Toleranz“.
// Die Gesamtähnlichkeit ist der gewichtete Mittelwert der verfügbaren Merkmale.

const ANALYSIS_FEATURES = [
  { key: 'pressureTrend', label: 'Druckverlauf', tolerance: 6, weight: 2 },
  { key: 'pressure', label: 'Luftdruck', tolerance: 10, weight: 1.5 },
  { key: 'temperature', label: 'Temperatur', tolerance: 6, weight: 1.5 },
  { key: 'windSpeed', label: 'Wind', tolerance: 15, weight: 1 },
  { key: 'windDirection', label: 'Windrichtung', tolerance: 90, weight: 0.5, circular: 360 },
  { key: 'cloudCover', label: 'Bewölkung', tolerance: 50, weight: 1 },
  { key: 'precipitation', label: 'Niederschlag', tolerance: 2, weight: 1 },
  { key: 'moonPhase', label: 'Mondphase', tolerance: 0.15, weight: 1, circular: 1 },
  // Für die Wassertemperatur gibt es keine Vorhersage: verglichen wird mit dem aktuell
  // gemessenen Wert (sie ändert sich nur langsam).
  { key: 'waterTemp', label: 'Wassertemperatur', tolerance: 4, weight: 1.5 },
];

const FORECAST_CACHE_MS = 30 * 60 * 1000;
let forecastCache = { time: 0, key: '', data: null };

// Stunde (lokal), zu der ein Besuch stattfand – Vergleichszeitpunkt für die Vorhersage.
function visitHour(entry) {
  if (entry.manual) return entry.visitedTime || '12:00';
  const d = new Date(entry.timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

// Merkmale eines gespeicherten Besuchs (null, wenn keine Wetterdaten vorhanden sind).
function visitFeatures(entry) {
  const c = entry.conditions;
  if (!c || !c.weather || !c.pressure) return null;
  const w = c.weather;
  const p = c.pressure;
  let moonPhase = entry.moon && Number.isFinite(entry.moon.phase) ? entry.moon.phase : null;
  if (moonPhase === null && typeof moonPhaseAt === 'function') {
    const t = visitTime(entry);
    if (t !== null) moonPhase = moonPhaseAt(new Date(t)).phase;
  }
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    pressure: num(p.current),
    pressureTrend: Number.isFinite(p.current) && Number.isFinite(p.yesterday) ? p.current - p.yesterday : null,
    temperature: num(w.temperature),
    windSpeed: num(w.windSpeed),
    // Windrichtung nur vergleichen, wenn überhaupt nennenswert Wind war.
    windDirection: Number.isFinite(w.windSpeed) && w.windSpeed >= 5 ? num(w.windDirection) : null,
    cloudCover: num(w.cloudCover),
    precipitation: num(w.precipitation),
    moonPhase,
    waterTemp: effectiveWaterTemp(entry) ? effectiveWaterTemp(entry).value : null,
  };
}

function featureSimilarity(f, a, b) {
  let diff = Math.abs(a - b);
  if (f.circular) diff = Math.min(diff, f.circular - diff);
  return Math.max(0, 1 - diff / f.tolerance);
}

// Gewichtete Ähnlichkeit (0–1) und die Einzelwerte je Merkmal.
function similarity(visit, forecast) {
  let sum = 0;
  let weights = 0;
  const parts = [];
  for (const f of ANALYSIS_FEATURES) {
    const a = visit[f.key];
    const b = forecast[f.key];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    const s = featureSimilarity(f, a, b);
    sum += s * f.weight;
    weights += f.weight;
    parts.push({ label: f.label, value: s });
  }
  // Zu wenige vergleichbare Merkmale: nicht aussagekräftig.
  if (weights < 4) return null;
  return { value: sum / weights, parts };
}

// Vorhersage für alle Spots in einer Anfrage (Open-Meteo erlaubt mehrere Koordinaten).
async function fetchSpotForecasts(points) {
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join(';');
  if (forecastCache.key === key && Date.now() - forecastCache.time < FORECAST_CACHE_MS) {
    return forecastCache.data;
  }
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lng.toFixed(3)).join(','),
    hourly: 'temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code',
    past_days: '7', // 7 Tage zurück für die Schätzung der Wassertemperatur
    forecast_days: '3',
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  const raw = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const data = Array.isArray(raw) ? raw : [raw];
  forecastCache = { time: Date.now(), key, data };
  return data;
}

// Vorhersage-Merkmale zu einem Zeitpunkt (Unix-Sekunden) aus stündlichen Daten.
function forecastFeatures(hourly, target) {
  const times = hourly.time || [];
  const at = (t, k) => {
    let best = -1;
    let bestDiff = Infinity;
    times.forEach((time, i) => {
      const d = Math.abs(time - t);
      if (d < bestDiff && Number.isFinite((hourly[k] || [])[i])) {
        best = i;
        bestDiff = d;
      }
    });
    return best >= 0 && bestDiff <= 3600 ? hourly[k][best] : null;
  };
  const pressure = at(target, 'pressure_msl');
  const before = at(target - 86400, 'pressure_msl');
  const windSpeed = at(target, 'wind_speed_10m');
  const windDirection = at(target, 'wind_direction_10m');
  return {
    pressure,
    pressureTrend: pressure !== null && before !== null ? pressure - before : null,
    temperature: at(target, 'temperature_2m'),
    windSpeed,
    windDirection: windSpeed !== null && windSpeed >= 5 ? windDirection : null,
    windDirectionRaw: windDirection,
    cloudCover: at(target, 'cloud_cover'),
    precipitation: at(target, 'precipitation'),
    weatherCode: at(target, 'weather_code'),
    moonPhase: typeof moonPhaseAt === 'function' ? moonPhaseAt(new Date(target * 1000)).phase : null,
  };
}

// Unix-Sekunden für Tag (0 = heute) und Uhrzeit „HH:MM“ in der Zeitzone des Geräts.
function dayTarget(dayOffset, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return Math.floor(d.getTime() / 1000);
}

// Bewertung eines Besuchs für die Analyse. Mit Fischfilter zählen nur Besuche, bei denen
// diese Art gut lief, sowie schlechte Besuche (als Gegenbeispiel).
function analysisScore(entry, fish) {
  if (!fish) return SCORES[entry.rating];
  if ((entry.fish || []).includes(fish)) return SCORES[entry.rating];
  if (entry.rating === 'schlecht') return SCORES.schlecht;
  return null;
}

// Analysiert alle Spots für einen Tag. Ergebnis sortiert nach Empfehlung (0–100).
function analyzeSpots(forecasts, spotPoints, dayOffset, fish) {
  const results = [];
  spotPoints.forEach((spot, i) => {
    const hourly = forecasts[i] && forecasts[i].hourly;
    if (!hourly) return;

    const matches = [];
    for (const v of spot.visits) {
      const score = analysisScore(v, fish);
      const features = visitFeatures(v);
      if (score === null || !features) continue;
      const hour = visitHour(v);
      const target = dayTarget(dayOffset, hour);
      const estimate = estimateWaterTemp(hourly.time || [], hourly.temperature_2m || [], target);
      const measured = Number.isFinite(spot.waterTemp);
      const forecast = {
        ...forecastFeatures(hourly, target),
        waterTemp: measured ? spot.waterTemp : estimate,
        waterTempSource: measured ? 'gemessen' : estimate !== null ? 'geschätzt' : null,
      };
      const sim = similarity(features, forecast);
      if (!sim) continue;
      matches.push({ visit: v, score, sim: sim.value, parts: sim.parts, hour, forecast });
    }
    if (!matches.length) return;
    // Mit Fischfilter nur Spots, an denen diese Art mindestens einmal gut lief.
    if (fish && !matches.some((m) => (m.visit.fish || []).includes(fish))) return;

    // Erwartete Bewertung: ähnliche Besuche zählen deutlich stärker (Gewicht = Ähnlichkeit³).
    let wSum = 0;
    let rSum = 0;
    for (const m of matches) {
      const w = m.sim ** 3 + 1e-6;
      wSum += w;
      rSum += w * m.score;
    }
    const expected = rSum / wSum; // 1 … 4
    const best = matches.reduce((a, b) => (b.sim > a.sim ? b : a));
    const goodMatches = matches.filter((m) => m.score >= SCORES.gut);
    const bestGood = goodMatches.length ? goodMatches.reduce((a, b) => (b.sim > a.sim ? b : a)) : null;
    // Empfehlung: erwartete Bewertung, abgeschwächt, wenn kein Besuch wirklich ähnlich war.
    const recommendation = Math.round(((expected - 1) / 3) * best.sim * 100);

    // Köder-Tipp: Köder aus guten Besuchen, gewichtet nach Ähnlichkeit.
    const baitWeights = {};
    for (const m of goodMatches) {
      for (const b of m.visit.baits || []) baitWeights[b] = (baitWeights[b] || 0) + m.sim ** 3;
    }
    const bestBait = Object.keys(baitWeights).sort((x, y) => baitWeights[y] - baitWeights[x])[0] || null;

    results.push({
      key: spot.key, visits: spot.visits, lat: spot.lat, lng: spot.lng,
      expected, recommendation, best, bestGood, bestBait, matchCount: matches.length,
      waterTemp: spot.waterTemp ?? null,
    });
  });
  return results.sort((a, b) => b.recommendation - a.recommendation);
}

// ---- Oberfläche ----

const analysisEl = document.getElementById('analysis');
const analysisList = document.getElementById('analysis-list');
const analysisDays = document.getElementById('analysis-days');
const analysisFish = document.getElementById('analysis-fish');
let analysisDay = 0;
let analysisFishFilter = null;
let analysisWaterFilter = null;
const analysisWater = document.getElementById('analysis-water');
const analysisTitle = document.getElementById('analysis-title');

function dayLabel(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const name = ['Heute', 'Morgen', 'Übermorgen'][offset];
  return `${name}<small>${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</small>`;
}

function renderAnalysisControls() {
  analysisDays.innerHTML = '';
  [0, 1, 2].forEach((offset) => {
    const b = document.createElement('button');
    b.innerHTML = dayLabel(offset);
    b.setAttribute('aria-pressed', String(offset === analysisDay));
    b.addEventListener('click', () => { analysisDay = offset; runAnalysis(); });
    analysisDays.appendChild(b);
  });
  if (analysisFishFilter && !modeFish()[analysisFishFilter]) analysisFishFilter = null;
  analysisTitle.textContent = `Spot-Analyse – ${MODES[currentMode].label}`;
  analysisFish.innerHTML = '';
  [[null, 'Alle'], ...Object.entries(modeFish())].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'fish-chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(key === analysisFishFilter));
    b.addEventListener('click', () => { analysisFishFilter = key; runAnalysis(); });
    analysisFish.appendChild(b);
  });
  analysisWater.innerHTML = '';
  [[null, 'Alle Gewässer'], ...Object.entries(WATER_TYPES)].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'fish-chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(key === analysisWaterFilter));
    b.addEventListener('click', () => { analysisWaterFilter = key; runAnalysis(); });
    analysisWater.appendChild(b);
  });
}

function trendText(t) {
  if (t === null) return '';
  const v = `${t > 0 ? '+' : ''}${t.toFixed(1).replace('.', ',')}`;
  return t <= -1 ? ` ↘ ${v}` : t >= 1 ? ` ↗ ${v}` : ` → ${v}`;
}

function forecastSummary(f) {
  const parts = [];
  if (f.weatherCode !== null) parts.push(weatherDescription(f.weatherCode));
  if (f.temperature !== null) parts.push(fmt(Math.round(f.temperature * 10) / 10, '°C'));
  if (f.pressure !== null) parts.push(`${Math.round(f.pressure)} hPa${trendText(f.pressureTrend)}`);
  if (f.windSpeed !== null) parts.push(`Wind ${Math.round(f.windSpeed)} km/h ${windDirectionName(f.windDirectionRaw)}`);
  if (f.cloudCover !== null) parts.push(`Wolken ${Math.round(f.cloudCover)} %`);
  if (f.precipitation) parts.push(`Regen ${fmt(f.precipitation, 'mm')}`);
  if (f.waterTemp !== null && f.waterTemp !== undefined) {
    parts.push(f.waterTempSource === 'gemessen'
      ? `Wasser ${fmt(f.waterTemp, '°C')} (aktuell gemessen)`
      : `Wasser ≈ ${fmt(f.waterTemp, '°C')} (geschätzt)`);
  }
  return parts.join(' · ');
}

function recommendationLabel(r) {
  if (r >= 60) return ['Sehr empfehlenswert', 'top'];
  if (r >= 40) return ['Gute Chancen', 'good'];
  if (r >= 25) return ['Mäßig', 'mid'];
  return ['Eher nicht', 'low'];
}

function spotDescription(result) {
  const parts = [];
  const name = spotName(result.key);
  if (name) parts.push(`<b class="analysis-name">${escapeHtml(name)}</b>`);
  const water = result.visits.map((v) => v.conditions && v.conditions.waterLevel && v.conditions.waterLevel.water)
    .find(Boolean);
  if (water) parts.push(escapeHtml(water));
  if (currentPosition) {
    const km = distanceKm(currentPosition.lat, currentPosition.lng, result.lat, result.lng);
    parts.push(`${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km entfernt`);
  }
  parts.push(`${result.visits.length} ${result.visits.length === 1 ? 'Besuch' : 'Besuche'}`);
  return parts.join(' · ');
}

function renderAnalysisResults(results, skipped) {
  analysisList.innerHTML = '';
  if (!results.length) {
    analysisList.innerHTML = `<p class="analysis-empty">${analysisFishFilter || analysisWaterFilter
      ? 'Für diese Auswahl gibt es noch keine Besuche mit Wetterdaten.'
      : 'Noch keine Besuche mit Wetterdaten gespeichert. Bewerte Spots vor Ort oder trage Besuche mit Datum ein.'}</p>`;
    return;
  }
  results.forEach((r, i) => {
    const [label, cls] = recommendationLabel(r.recommendation);
    const expectedKey = RATING_BY_SCORE[Math.min(4, Math.max(1, Math.round(r.expected)))];
    const ref = r.bestGood && r.bestGood.sim >= r.best.sim - 0.05 ? r.bestGood : r.best;
    const fish = (ref.visit.fish || []).map((f) => ALL_FISH[f]).join(', ');
    const day = new Date();
    day.setDate(day.getDate() + analysisDay);
    const sun = sunTimesHtml(day, r.lat, r.lng);
    const topParts = [...ref.parts].sort((a, b) => b.value - a.value);
    const fits = topParts.filter((p) => p.value >= 0.7).map((p) => p.label);
    const misses = topParts.filter((p) => p.value < 0.3).map((p) => p.label);

    const card = document.createElement('div');
    card.className = `analysis-card ${cls}`;
    card.innerHTML =
      `<div class="analysis-head"><span class="analysis-rank">${i + 1}</span>` +
      `<div><b>${label}</b> <span class="muted">(${r.recommendation} / 100)</span><br>` +
      `<span class="muted">${spotDescription(r)}</span></div></div>` +
      `<div class="analysis-bar"><span style="width:${r.recommendation}%"></span></div>` +
      `<div class="cond"><b>Erwartung:</b> ${ratingBadge(expectedKey)} ` +
      `<span class="muted">aus ${r.matchCount} ${r.matchCount === 1 ? 'Besuch' : 'Besuchen'}</span></div>` +
      `<div class="cond"><b>Vorhersage ${ref.hour} Uhr:</b> ${forecastSummary(ref.forecast)}</div>` +
      `<div class="cond"><b>Am ähnlichsten:</b> ${escapeHtml(visitDateLabel(ref.visit))} ` +
      `${ratingBadge(ref.visit.rating)}${fish ? ` <span class="muted">${fish}</span>` : ''} – ` +
      `${Math.round(ref.sim * 100)} % Übereinstimmung</div>` +
      (r.bestBait ? `<div class="cond"><b>Köder-Tipp:</b> ${ALL_BAITS[r.bestBait]} ` +
        '<span class="muted">(lief bei ähnlichem Wetter)</span></div>' : '') +
      (sun ? `<div class="cond"><b>Sonne:</b> ${sun}</div>` : '') +
      (fits.length ? `<div class="cond muted">Passt: ${fits.join(', ')}</div>` : '') +
      (misses.length ? `<div class="cond muted">Weicht ab: ${misses.join(', ')}</div>` : '');

    const show = document.createElement('button');
    show.className = 'popup-add';
    show.textContent = 'Auf der Karte zeigen';
    show.addEventListener('click', () => {
      closeAnalysis();
      map.setView([r.lat, r.lng], Math.max(map.getZoom(), 15));
      openSpot(r.key);
    });
    card.append(show, buildAppleMapsLink(r.key));
    analysisList.appendChild(card);
  });
  if (skipped) {
    const p = document.createElement('p');
    p.className = 'analysis-note';
    p.textContent = `${skipped} ${skipped === 1 ? 'Spot hat' : 'Spots haben'} noch keine Besuche mit Wetterdaten und ` +
      `${skipped === 1 ? 'fehlt' : 'fehlen'} in der Analyse.`;
    analysisList.appendChild(p);
  }
}

let analysisRun = 0;
async function runAnalysis() {
  renderAnalysisControls();
  const run = ++analysisRun;
  const spots = allSpotKeys()
    .filter((key) => !analysisWaterFilter || spotWaterTypes(key).includes(analysisWaterFilter))
    .map((key) => {
    const visits = spotVisits(key);
    return { key, visits, lat: visits[0].lat, lng: visits[0].lng };
  });
  const withData = spots.filter((s) => s.visits.some(visitFeatures));
  const skipped = spots.length - withData.length;
  if (!withData.length) {
    renderAnalysisResults([], skipped);
    return;
  }

  analysisList.innerHTML = '<p class="analysis-empty">Vorhersage wird geladen …</p>';
  const forecastsPromise = fetchSpotForecasts(withData);
  forecastsPromise.catch(() => {}); // Fehler wird unten behandelt
  // Aktuelle Wassertemperatur je Spot (falls ein Messpegel in der Nähe ist), parallel zur Vorhersage.
  try {
    const stations = await fetchWaterTempStations();
    for (const s of withData) {
      const near = nearestWaterTempStation(stations, s.lat, s.lng);
      const m = near && near.ts.currentMeasurement;
      s.waterTemp = m && Number.isFinite(m.value) ? Math.round(m.value * 10) / 10 : null;
    }
  } catch { /* ohne Wassertemperatur weiterrechnen */ }
  try {
    const forecasts = await forecastsPromise;
    if (run !== analysisRun) return; // inzwischen anderer Tag/Filter gewählt
    renderAnalysisResults(analyzeSpots(forecasts, withData, analysisDay, analysisFishFilter), skipped);
  } catch {
    if (run !== analysisRun) return;
    analysisList.innerHTML = '<p class="analysis-empty">Die Wettervorhersage konnte nicht geladen werden. ' +
      'Bitte Internetverbindung prüfen und erneut öffnen.</p>';
  }
}

function openAnalysis() {
  analysisEl.hidden = false;
  document.getElementById('backup-panel').hidden = true;
  runAnalysis();
}

function closeAnalysis() {
  analysisEl.hidden = true;
}

document.getElementById('analysis-open').addEventListener('click', openAnalysis);
document.getElementById('analysis-close').addEventListener('click', closeAnalysis);
