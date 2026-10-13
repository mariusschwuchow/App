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
