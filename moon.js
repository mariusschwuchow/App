// Berechnet die Mondphase für einen Zeitpunkt (ohne Internet).
// Verfahren nach dem Low-Precision-Ansatz von SunCalc (Vladimir Agafonkin, BSD-Lizenz),
// der auf den Formeln von J. Meeus beruht. Genauigkeit: wenige Stunden.

const MOON_RAD = Math.PI / 180;
const SYNODIC_MONTH = 29.530588853;

function moonPhaseAt(date) {
  const d = date.getTime() / 86400000 - 0.5 + 2440588 - 2451545; // Tage seit J2000
  const e = MOON_RAD * 23.4397; // Schiefe der Ekliptik

  const rightAscension = (l, b) =>
    Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const declination = (l, b) =>
    Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));

  // Sonne
  const sM = MOON_RAD * (357.5291 + 0.98560028 * d);
  const sC = MOON_RAD * (1.9148 * Math.sin(sM) + 0.02 * Math.sin(2 * sM) + 0.0003 * Math.sin(3 * sM));
  const sL = sM + sC + MOON_RAD * 102.9372 + Math.PI;
  const sun = { ra: rightAscension(sL, 0), dec: declination(sL, 0) };

  // Mond
  const mL = MOON_RAD * (218.316 + 13.176396 * d);
  const mM = MOON_RAD * (134.963 + 13.064993 * d);
  const mF = MOON_RAD * (93.272 + 13.22935 * d);
  const l = mL + MOON_RAD * 6.289 * Math.sin(mM);
  const b = MOON_RAD * 5.128 * Math.sin(mF);
  const moon = { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(mM) };

  const sunDist = 149598000;
  const phi = Math.acos(Math.sin(sun.dec) * Math.sin(moon.dec) +
    Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra));
  const inc = Math.atan2(sunDist * Math.sin(phi), moon.dist - sunDist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(sun.dec) * Math.sin(sun.ra - moon.ra),
    Math.sin(sun.dec) * Math.cos(moon.dec) - Math.cos(sun.dec) * Math.sin(moon.dec) * Math.cos(sun.ra - moon.ra));

  // phase: 0 = Neumond, 0,25 = erstes Viertel, 0,5 = Vollmond, 0,75 = letztes Viertel
  const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;
  const illumination = (1 + Math.cos(inc)) / 2;

  // Die vier Hauptphasen gelten jeweils ±1 Tag um den exakten Zeitpunkt.
  const window = 1 / SYNODIC_MONTH;
  const near = (target) => Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target)) <= window;
  let name;
  let symbol;
  if (near(0)) [name, symbol] = ['Neumond', '🌑'];
  else if (near(0.25)) [name, symbol] = ['Zunehmender Halbmond', '🌓'];
  else if (near(0.5)) [name, symbol] = ['Vollmond', '🌕'];
  else if (near(0.75)) [name, symbol] = ['Abnehmender Halbmond', '🌗'];
  else if (phase < 0.25) [name, symbol] = ['Zunehmende Sichel', '🌒'];
  else if (phase < 0.5) [name, symbol] = ['Zunehmender Mond', '🌔'];
  else if (phase < 0.75) [name, symbol] = ['Abnehmender Mond', '🌖'];
  else [name, symbol] = ['Abnehmende Sichel', '🌘'];

  return {
    name,
    symbol,
    illumination: Math.round(illumination * 100), // in %
    phase: Math.round(phase * 1000) / 1000,
  };
}

// ---- Sonne: Auf- und Untergang, bürgerliche Dämmerung (ebenfalls nach SunCalc) ----

// Zeiten für den Kalendertag von `date` (Zeitzone des Geräts) am Ort lat/lng.
// Ergebnis: Date-Objekte oder null (z. B. Polartag/-nacht).
function sunTimes(date, lat, lng) {
  const rad = MOON_RAD;
  const dayMs = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const J0 = 0.0009;
  const e = rad * 23.4397;

  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const d = noon.getTime() / dayMs - 0.5 + J1970 - J2000;
  const lw = rad * -lng;
  const phi = rad * lat;

  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const approxTransit = (ht) => J0 + (ht + lw) / (2 * Math.PI) + n;
  const ds = approxTransit(0);
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const transit = (x) => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jnoon = transit(ds);
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);

  const times = (angle) => {
    const cosH = (Math.sin(angle * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosH < -1 || cosH > 1) return [null, null];
    const Jset = transit(approxTransit(Math.acos(cosH)));
    return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)];
  };
  const [sunrise, sunset] = times(-0.833);
  const [dawn, dusk] = times(-6);
  return { dawn, sunrise, sunset, dusk };
}

function formatClock(date) {
  return date ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–';
}
