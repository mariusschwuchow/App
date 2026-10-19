// Angel-Session: „Session starten“ beim Ankommen, Fänge einzeln eintragen (Art, Größe,
// Gewicht, Uhrzeit, Köder, Methode, Verbleib, Foto), „Beenden“ mit Bewertung. Daraus wird
// ein Besuch mit Fangliste, Angeldauer und Fangrate.
//
// Die laufende Session liegt in localStorage, damit sie ein Schließen der App übersteht.
// Fotos von Fängen werden sofort in IndexedDB gespeichert (entryId = Session-ID, die später
// die ID des Besuchs wird).

const SESSION_KEY = 'aktive-session';
let activeSession = null;
try {
  const stored = JSON.parse(localStorage.getItem(SESSION_KEY));
  if (stored && stored.id && stored.start) activeSession = stored;
} catch { /* keine laufende Session */ }

const sessionBar = document.getElementById('session-bar');
const sessionTitle = document.getElementById('session-title');
const sessionStatus = document.getElementById('session-status');

function saveSession() {
  try {
    if (activeSession) localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ohne Speicher läuft die Session nur bis zum Schließen */ }
}

function formatDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}

function catchRate(count, ms) {
  const hours = ms / 3600000;
  return hours >= 0.25 ? (count / hours).toFixed(1).replace('.', ',') : null;
}

function updateSessionBar() {
  if (!activeSession) return;
  const ms = Date.now() - new Date(activeSession.start).getTime();
  const n = activeSession.catches.length;
  const rate = catchRate(n, ms);
  sessionTitle.textContent = `${MODES[activeSession.mode].icon} Session läuft · ${formatDuration(ms)}`;
  sessionStatus.textContent = `${n} ${n === 1 ? 'Fang' : 'Fänge'}` + (rate ? ` · ${rate} pro Stunde` : '') +
    (activeSession.spotName ? ` · ${activeSession.spotName}` : '');
}

setInterval(updateSessionBar, 30000);

function startSession() {
  if (!currentPosition) {
    alert('Dein Standort ist noch nicht bekannt. Bitte kurz warten und erneut versuchen.');
    return;
  }
  hideBackupReminder();
  const near = askForNearbySpot(currentPosition.lat, currentPosition.lng);
  activeSession = {
    id: newId(new Date()),
    mode: currentMode,
    lat: near ? near.lat : currentPosition.lat,
    lng: near ? near.lng : currentPosition.lng,
    accuracy: near ? null : currentPosition.accuracy,
    spotId: near ? near.key : null,
    spotName: near ? spotName(near.key) : null,
    start: new Date().toISOString(),
    catches: [],
  };
  saveSession();
  showBottomControls();
  updateSessionBar();
  showToast('Session gestartet – Fänge mit „+ Fang“ eintragen');
}

async function discardSession() {
  if (!activeSession) return;
  const n = activeSession.catches.length;
  if (!confirm(`Session verwerfen?${n ? ` Die ${n} eingetragenen Fänge gehen verloren.` : ''}`)) return;
  for (const c of activeSession.catches) {
    for (const p of c.photoIds || []) await deletePhotoBlob(p).catch(() => {});
  }
  activeSession = null;
  saveSession();
  showBottomControls();
}

function endSession() {
  if (!activeSession) return;
  if (activeSession.mode !== currentMode) setMode(activeSession.mode);
  openMenu('session');
  visitDateLabelEl.textContent = '';
}

// Wird vom Bewertungsmenü aufgerufen: Session wird zum Besuch.
async function finishSession(rating) {
  const s = activeSession;
  if (!s) return;
  const end = new Date();
  const summary = summarizeCatches(s.catches);
  const mid = new Date((new Date(s.start).getTime() + end.getTime()) / 2);
  const entry = {
    id: s.id,
    mode: s.mode,
    lat: s.lat,
    lng: s.lng,
    accuracy: s.accuracy,
    rating,
    timestamp: end.toISOString(),
    sessionStart: s.start,
    catches: s.catches,
    ...summary,
    moon: typeof moonPhaseAt === 'function' ? moonPhaseAt(mid) : null,
  };
  if (s.spotId) {
    entry.spotId = s.spotId;
    const visits = spotEntries(s.spotId);
    const place = (visits.find((e) => e.placeName) || {}).placeName;
    const custom = (visits.find((e) => e.customName) || {}).customName;
    const water = spotWaterTypes(s.spotId);
    if (place) entry.placeName = place;
    if (custom) entry.customName = custom;
    if (water.length) entry.waterTypes = water;
  }
  activeSession = null;
  saveSession();
  await saveEntry(entry, { fetchData: true, openPopup: true });
  showBottomControls();
}

// Fischarten, größte Größe je Art, Köder und Methoden aus der Fangliste ableiten.
function summarizeCatches(catches, base = {}) {
  const fish = new Set(base.fish || []);
  const fishSizes = { ...(base.fishSizes || {}) };
  const baits = new Set(base.baits || []);
  const methods = new Set(base.methods || []);
  const photoIds = [...(base.photoIds || [])];
  for (const c of catches) {
    fish.add(c.fish);
    if (Number.isFinite(c.size) && (!fishSizes[c.fish] || c.size > fishSizes[c.fish])) fishSizes[c.fish] = c.size;
    if (c.bait) baits.add(c.bait);
    if (c.method) methods.add(c.method);
    for (const p of c.photoIds || []) if (!photoIds.includes(p)) photoIds.push(p);
  }
  return {
    fish: Object.keys(ALL_FISH).filter((f) => fish.has(f)),
    fishSizes,
    baits: Object.keys(ALL_BAITS).filter((b) => baits.has(b)),
    methods: Object.keys(ALL_METHODS).filter((m) => methods.has(m)),
    photoIds,
  };
}

document.getElementById('session-start').addEventListener('click', startSession);
document.getElementById('session-catch').addEventListener('click', () => openCatchForm({ session: true }));
document.getElementById('session-end').addEventListener('click', endSession);
document.getElementById('session-discard').addEventListener('click', discardSession);

// ---- Fang-Formular (für die laufende Session und zum Nachtragen bei Besuchen) ----

const catchForm = document.getElementById('catch-form');
const catchSize = document.getElementById('catch-size');
const catchSizeValue = document.getElementById('catch-size-value');
const catchWeight = document.getElementById('catch-weight');
const catchTime = document.getElementById('catch-time');
const catchPhoto = document.getElementById('catch-photo');
const catchPhotoInfo = document.getElementById('catch-photo-info');
let catchState = null;

function renderSingleChoice(containerId, options, field) {
  chipRow(document.getElementById(containerId), Object.entries(options),
    (v) => v === catchState[field],
    (v) => { catchState[field] = catchState[field] === v ? null : v; renderCatchChoices(); });
}

function renderCatchChoices() {
  const mode = catchState.mode;
  renderSingleChoice('catch-fish', MODES[mode].fish, 'fish');
  renderSingleChoice('catch-bait', MODES[mode].baits, 'bait');
  renderSingleChoice('catch-method', MODES[mode].methods, 'method');
  chipRow(document.getElementById('catch-released'), [[true, 'Zurückgesetzt'], [false, 'Entnommen']],
    (v) => v === catchState.released,
    (v) => { catchState.released = catchState.released === v ? null : v; renderCatchChoices(); });
}

function showCatchSize() {
  catchSizeValue.textContent = catchState.size ? `${catchState.size} cm` : '– cm';
}

// target: { session: true } oder { entryId }
function openCatchForm(target) {
  const entry = target.entryId ? getEntry(target.entryId) : null;
  const previous = target.session ? activeSession.catches[activeSession.catches.length - 1]
    : entry && (entry.catches || [])[entry.catches.length - 1];
  catchState = {
    target,
    mode: target.session ? activeSession.mode : entryMode(entry),
    fish: previous ? previous.fish : null,
    size: null,
    bait: previous ? previous.bait : null, // Köder und Methode vom letzten Fang übernehmen
    method: previous ? previous.method : null,
    released: previous ? previous.released : null,
    files: [],
  };
  // Uhrzeit vorbelegen: jetzt (Session) bzw. Zeitpunkt des Besuchs (Nachtragen).
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (target.session) {
    catchTime.value = hhmm(new Date());
  } else {
    const t = visitTime(entry);
    catchTime.value = t !== null && !(entry.manual && !entry.visitedTime) ? hhmm(new Date(t)) : '';
  }
  catchSize.value = '50';
  catchWeight.value = '';
  catchPhotoInfo.textContent = '';
  document.getElementById('catch-form-title').textContent = target.session ? 'Fang eintragen' : 'Fang nachtragen';
  showCatchSize();
  renderCatchChoices();
  map.closePopup();
  catchForm.hidden = false;
}

function closeCatchForm() {
  catchForm.hidden = true;
  catchState = null;
}

catchSize.addEventListener('input', () => { catchState.size = Number(catchSize.value); showCatchSize(); });
catchForm.querySelectorAll('.size-step').forEach((b) => b.addEventListener('click', () => {
  const v = Math.min(150, Math.max(1, (catchState.size || Number(catchSize.value)) + Number(b.dataset.step)));
  catchSize.value = String(v);
  catchState.size = v;
  showCatchSize();
}));
document.getElementById('catch-size-clear').addEventListener('click', () => { catchState.size = null; showCatchSize(); });
catchPhoto.addEventListener('change', () => {
  catchState.files = [...catchPhoto.files];
  catchPhoto.value = '';
  const n = catchState.files.length;
  catchPhotoInfo.textContent = n ? `${n} ${n === 1 ? 'Foto' : 'Fotos'} ausgewählt` : '';
});
document.getElementById('catch-cancel').addEventListener('click', closeCatchForm);

// Uhrzeit des Fangs als ISO-Zeitpunkt: Datum der Session bzw. des Besuchs + gewählte Uhrzeit.
function catchTimestamp(target) {
  const [h, m] = (catchTime.value || '').split(':').map(Number);
  let base = new Date();
  if (target.entryId) {
    const t = visitTime(getEntry(target.entryId));
    if (t !== null) base = new Date(t);
  }
  if (Number.isFinite(h)) base.setHours(h, m || 0, 0, 0);
  return base.toISOString();
}

document.getElementById('catch-save').addEventListener('click', async () => {
  if (!catchState) return;
  if (!catchState.fish) {
    alert('Bitte eine Fischart wählen.');
    return;
  }
  const { target } = catchState;
  const photoOwner = target.session ? activeSession.id : target.entryId;
  const photoIds = [];
  try {
    for (const file of catchState.files) {
      const blob = await compressImage(file);
      const photoId = newId(new Date());
      await savePhotoBlob({ id: photoId, entryId: photoOwner, blob, createdAt: new Date().toISOString() });
      photoIds.push(photoId);
    }
  } catch {
    showToast('Foto konnte nicht gespeichert werden (Speicher voll?)');
  }
  const weightRaw = catchWeight.value.trim().replace(',', '.');
  const weight = weightRaw === '' ? null : Math.round(Number(weightRaw) * 100) / 100;
  const fang = {
    id: newId(new Date()),
    fish: catchState.fish,
    size: catchState.size,
    weight: Number.isFinite(weight) && weight > 0 ? weight : null,
    time: catchTimestamp(target),
    bait: catchState.bait,
    method: catchState.method,
    released: catchState.released,
    photoIds,
  };
  const label = `${ALL_FISH[fang.fish]}${fang.size ? ` ${fang.size} cm` : ''}`;

  if (target.session) {
    activeSession.catches.push(fang);
    saveSession();
    updateSessionBar();
    closeCatchForm();
    showToast(`${label} eingetragen 🎉`);
    return;
  }

  const entry = getEntry(target.entryId);
  if (!entry) return;
  const catches = [...(entry.catches || []), fang].sort((a, b) => a.time.localeCompare(b.time));
  await updateRating({ ...entry, catches, ...summarizeCatches([fang], entry) });
  closeCatchForm();
  renderRatings();
  openSpot(spotKey(entry), entry.id);
  showToast(`${label} nachgetragen`);
});

// ---- Fangliste im Besuch ----

function catchLine(c) {
  const time = new Date(c.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const parts = [`<b>${ALL_FISH[c.fish] || c.fish}</b>`];
  if (c.size) parts.push(`${c.size} cm`);
  if (c.weight) parts.push(`${String(c.weight).replace('.', ',')} kg`);
  const how = [c.bait && ALL_BAITS[c.bait], c.method && ALL_METHODS[c.method]].filter(Boolean).join(' / ');
  if (how) parts.push(escapeHtml(how));
  if (c.released === true) parts.push('zurückgesetzt');
  if (c.released === false) parts.push('entnommen');
  if ((c.photoIds || []).length) parts.push(`📷 ${c.photoIds.length}`);
  return `<span class="catch-time">${time}</span> ${parts.join(' · ')}`;
}

function buildCatchSection(id) {
  const entry = getEntry(id);
  const catches = entry.catches || [];
  const wrap = document.createElement('div');
  wrap.className = 'cond catch-section';

  let head = `<b>Fänge (${catches.length})</b>`;
  if (entry.sessionStart) {
    const ms = new Date(entry.timestamp).getTime() - new Date(entry.sessionStart).getTime();
    const rate = catchRate(catches.length, ms);
    const from = new Date(entry.sessionStart).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const to = new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    head += `<div class="muted">Session ${from}–${to} Uhr · ${formatDuration(ms)}` +
      (rate ? ` · ${rate} Fänge pro Stunde` : '') + (catches.length ? '' : ' · Schneidertag') + '</div>';
  }
  wrap.innerHTML = head;

  const list = document.createElement('div');
  list.className = 'catch-list';
  for (const c of catches) {
    const row = document.createElement('div');
    row.className = 'catch-row';
    row.innerHTML = `<span>${catchLine(c)}</span>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'catch-delete';
    del.setAttribute('aria-label', 'Fang löschen');
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      L.DomEvent.stopPropagation(e);
      if (!confirm(`Fang „${ALL_FISH[c.fish]}${c.size ? ` ${c.size} cm` : ''}“ löschen?`)) return;
      const current = getEntry(id);
      await updateRating({ ...current, catches: (current.catches || []).filter((x) => x.id !== c.id) });
      renderRatings();
      openSpot(spotKey(current), id);
    });
    row.appendChild(del);
    list.appendChild(row);
  }
  wrap.appendChild(list);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'popup-secondary';
  add.textContent = '+ Fang nachtragen';
  add.addEventListener('click', (e) => {
    L.DomEvent.stopPropagation(e);
    openCatchForm({ entryId: id });
  });
  wrap.appendChild(add);
  return wrap;
}

// Laufende Session nach dem Start der App wieder anzeigen.
showBottomControls();
updateSessionBar();
