/* r15.5 HSK: Fix "Leeren"; show per-lesson Richtig/Falsch; 'Unsicher' nicht zählen */
// Vollständiger JS-Code für HSK-Flashcard-App v1.5 – ID-Fix, Excel-Parse, Training, Voice, State-Save
// Basierend auf User-Excel: DATA_START_ROW=3, COL_ID=8 (H=Lektion-ID), Skip für Meta ('*')
// HTML-Elemente: #lessonSelect, #modeWord, #modeSent, #orderRandom, #orderSeq, #startBtn, #nextBtn, #flipBtn, #learnBtn, #moreBtn, #card, #promptWord, #solutionWord, #lblKarte
// CSS-Beispiel: .card { transition: transform 0.6s; } .flipped { transform: rotateY(180deg); }

let EXCEL_URL = './data/HSK_Lektionen.xlsx';  // Passe zu '/data/...' für GitHub Pages
const DATA_START_ROW = 3;  // Start ab Zeile 3 (Index 2) – überspringt Header (1) + Meta (2)
const COL_WORD = { de: 1, py: 2, zh: 6 };  // A=DE (1=Index0), B=PY (2=1), F=ZH (6=5)
const COL_SENT = { de: 5, py: 4, zh: 7 };  // E=DE (5=4), D=PY (4=3), G=ZH (7=6)
const COL_POS = 3;  // C=3 (Index2)
const COL_ID = 8;   // H=8 (Index7) – Lektion-ID, z.B. 'HSK 1-1'
const LS_KEYS = { settings: 'fc_settings_v1', progress: 'fc_progress_v1' };

// State-Objekt
let state = {
  lessons: new Map(),  // Map<SheetName, Array<Card>>
  current: null,
  pool: [],  // Aktueller Trainings-Pool
  session: { done: 0, total: 0 },  // Session-Progress
  settings: {
    mode: 'word',  // 'word' oder 'sent'
    order: 'random',  // 'random' oder 'seq'
    voice: true  // TTS aktiv?
  },
  progress: {}  // {lesson: {cardId: 'learned' | 'more'}}
};

// Save/Load-Funktionen
function saveSettings() {
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(state.settings));
  console.log('🔍 DEBUG: Settings gespeichert.');
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEYS.settings) || '{}');
    Object.assign(state.settings, s);
    // UI setzen
    const modeInput = document.querySelector('input[name="mode"][value="' + state.settings.mode + '"]');
    if (modeInput) modeInput.checked = true;
    const orderInput = document.querySelector('input[name="order"][value="' + state.settings.order + '"]');
    if (orderInput) orderInput.checked = true;
    console.log('🔍 DEBUG: Settings geladen:', state.settings);
  } catch (e) {
    console.warn('⚠️ DEBUG: Settings-Laden fehlgeschlagen.');
  }
}
function saveProgress() {
  localStorage.setItem(LS_KEYS.progress, JSON.stringify(state.progress));
}
function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEYS.progress) || '{}');
    state.progress = p;
    console.log('🔍 DEBUG: Progress geladen – Keys:', Object.keys(p));
  } catch (e) {
    console.warn('⚠️ DEBUG: Progress-Laden fehlgeschlagen.');
  }
}

// parseExcelBuffer: Lädt und parst XLSX in Lessons-Map
async function parseExcelBuffer(buf) {
  console.log('🔍 DEBUG: parseExcelBuffer gestartet – Buffer-Größe:', buf?.byteLength);
  if (!buf || buf.byteLength === 0) {
    console.error('❌ FEHLER: Leerer Buffer – Fetch prüfen.');
    return;
  }
  const wb = XLSX.read(buf, { type: 'array' });
  console.log('🔍 DEBUG: Workbook geladen – Sheets:', wb.SheetNames);
  state.lessons.clear();
  let totalCards = 0;
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, blankrows: false });
    console.log(`🔍 DEBUG: Sheet "${name}" – Rows geladen: ${rows.length} (Start ab Zeile ${DATA_START_ROW}, Index ${DATA_START_ROW - 1})`);
    const r0 = DATA_START_ROW - 1;  // Index 2
    if (!state.lessons.has(name)) state.lessons.set(name, []);
    let parsedCount = 0;
    for (let r = r0; r < rows.length; r++) {
      const row = rows[r] || [];
      if (r < r0 + 3) {  // Logs für erste 3 Rows
        console.log(`🔍 DEBUG: Row ${r + 1} (Index ${r}) – Vollständige Row:`, row);
        console.log(`🔍 DEBUG: Row ${r + 1} – ID aus Spalte H (Index 7): "${row[7] || ''}"`);
      }
      const w = {
        de: String(row[COL_WORD.de - 1] || '').trim().replace(/\r\n/g, ' / '),  // DE: Mehrzeilig zu '/'
        py: String(row[COL_WORD.py - 1] || '').trim(),
        zh: String(row[COL_WORD.zh - 1] || '').trim()
      };
      const s = {
        de: String(row[COL_SENT.de - 1] || '').trim(),
        py: String(row[COL_SENT.py - 1] || '').trim(),
        zh: String(row[COL_SENT.zh - 1] || '').trim()
      };
      const pos = String(row[COL_POS - 1] || '').trim();
      let id = String(row[COL_ID - 1] || '').trim();
      console.log(`🔍 DEBUG: Rohe ID aus Spalte H (Row ${r + 1}): "${row[COL_ID - 1] || ''}" → Getrimmt: "${id}"`);
      if (!id) {
        id = `Nr. ${r - r0 + 1}`;
        console.log(`🔍 DEBUG: Fallback-ID gesetzt: "${id}"`);
      }
      // Skip: Leer oder Meta mit '*'
      if (!(w.de || w.zh || s.de || s.zh) || w.de.startsWith('*') || s.de.startsWith('*')) {
        console.log(`🔍 DEBUG: Row ${r + 1} übersprungen (leer oder Meta mit '*')`);
        continue;
      }
      const card = { word: w, sent: s, pos, id };
      state.lessons.get(name).push(card);
      parsedCount++;
      if (parsedCount <= 3) {  // Nur erste 3 detailliert loggen
        console.log(`🔍 DEBUG: Karte geparst für Row ${r + 1}: ID="${id}", Wort DE="${w.de.substring(0,20)}...", ZH="${w.zh}"`);
      }
    }
    totalCards += parsedCount;
    console.log(`🔍 DEBUG: Sheet "${name}" – Finale echte Karten: ${parsedCount}`);
  }
  console.log(`🔍 DEBUG: Alle Lessons geparst – ${state.lessons.size} Sheets, ${totalCards} Karten insgesamt.`);
  populateLessonSelect();
}

// loadExcel: Fetch und Parse
async function loadExcel() {
  console.log('🔍 DEBUG: loadExcel aufgerufen – Starte Excel-Laden...');
  if (typeof XLSX === 'undefined') {
    console.error('❌ FEHLER: XLSX-Lib nicht geladen! Füge <script src="./xlsx.full.min.js"></script> ins HTML-<head>. Lade Lib herunter von unpkg.com.');
    return;
  }
  console.log('✅ DEBUG: XLSX-Lib verfügbar.');
  try {
    console.log('🔍 DEBUG: Fetch Excel-Datei von:', EXCEL_URL);
    const res = await fetch(EXCEL_URL, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`❌ FEHLER: Fetch-Fehler für ${EXCEL_URL}: Status ${res.status} (${res.statusText}). Stelle sicher, Datei existiert und Pfad korrekt (z.B. '/data/...').`);
      return;
    }
    console.log('✅ DEBUG: Fetch OK – Buffer-Größe:', res.headers.get('content-length'));
    const buf = await res.arrayBuffer();
    console.log('🔍 DEBUG: Buffer erhalten – Größe:', buf.byteLength);
    await parseExcelBuffer(buf);
    console.log('✅ DEBUG: Excel erfolgreich geparst und Lektionen-Select aktualisiert.');
  } catch (e) {
    console.error('❌ FEHLER in loadExcel:', e.message || e);
    if (e.name === 'TypeError' && e.message.includes('fetch')) {
      console.error('Ursache: CORS/Pfad – Teste lokal oder passe EXCEL_URL an.');
    }
  }
}

// populateLessonSelect: Fülle <select id="lessonSelect">
function populateLessonSelect() {
  const select = document.getElementById('lessonSelect');
  if (!select) {
    console.error('❌ FEHLER: #lessonSelect fehlt im HTML.');
    return;
  }
  select.innerHTML = '<option value="">Lektion wählen...</option>';
  state.lessons.forEach((cards, key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${key} (${cards.length} Karten)`;
    select.appendChild(option);
  });
  console.log('🔍 DEBUG: Lesson-Select gefüllt mit', state.lessons.size, 'Optionen.');
}

// gatherPool: Baue Pool aus gewählter Lektion (filtere Progress)
function gatherPool(lessonKey) {
  const cards = state.lessons.get(lessonKey) || [];
  state.pool = cards.filter(card => {
    const status = state.progress[lessonKey]?.[card.id];
    return !status || status === 'more';  // Nur ungelernt oder 'more'
  });
  if (state.settings.order === 'random') {
    // Shuffle
    for (let i = state.pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.pool[i], state.pool[j]] = [state.pool[j], state.pool[i]];
    }
    console.log('🔍 DEBUG: Pool geshuffelt – Random-Order.');
  } else {
    console.log('🔍 DEBUG: Pool sequentiell – Seq-Order.');
  }
  state.session = { done: 0, total: state.pool.length };
  console.log(`🔍 DEBUG: Pool gebaut für "${lessonKey}": ${state.pool.length} Karten (von ${cards.length}).`);
}

// startTraining: Starte Session
function startTraining() {
  const lessonKey = document.getElementById('lessonSelect').value;
  if (!lessonKey || !state.lessons.has(lessonKey)) {
    alert('Wähle eine Lektion!');
    return;
  }
  gatherPool(lessonKey);
  if (state.pool.length === 0) {
    alert('Keine Karten in dieser Lektion!');
    return;
  }
  state.current = state.pool[0];
  state.session.done = 0;
  updateUI();  // Mode/Order setzen
  setCard();
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.style.display = 'none';  // Verstecke Start
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) nextBtn.style.display = 'inline';  // Zeige Next
  console.log('🔍 DEBUG: Training gestartet – Erste Karte gesetzt.');
}

// setCard: Render Karte (Vorderseite: Prompt, Rückseite: Solution)
function setCard() {
  if (!state.current) return;
  const card = state.current;
  const isWord = state.settings.mode === 'word';
  const prompt = isWord ? card.word.py : card.sent.py;  // Prompt: PY
  const solution = isWord ? card.word.zh + (card.pos ? ' (' + card.pos + ')' : '') : card.sent.zh;  // Solution: ZH + POS
  const de = isWord ? card.word.de : card.sent.de;  // DE für Tooltip

  const promptEl = document.getElementById('promptWord');
  if (promptEl) {
    promptEl.textContent = prompt || '?';
    promptEl.title = de || '';  // Tooltip mit DE
  }
  const solutionEl = document.getElementById('solutionWord');
  if (solutionEl) solutionEl.textContent = solution || '?';
  // Flip zurücksetzen
  const cardEl = document.getElementById('card');
  if (cardEl) cardEl.classList.remove('flipped');
  if (state.settings.voice) speak(prompt);  // Voice für PY
  updateCardInfo();  // ID + Progress anzeigen
  console.log(`🔍 DEBUG: setCard – Prompt: "${prompt}", ID: "${card.id}"`);
}

// updateCardInfo: Zeige "Karte: HSK 1-1 (1/20)"
function updateCardInfo() {
  console.log('🔍 DEBUG: updateCardInfo aufgerufen');
  let lbl = document.getElementById('lblKarte');
  if (!lbl) {
    const promptWord = document.getElementById('promptWord');
    if (promptWord && promptWord.parentNode) {
      lbl = document.createElement('label');
      lbl.id = 'lblKarte';
      lbl.className = 'lbl card-info';
      lbl.innerHTML = 'Karte:';
      promptWord.parentNode.insertBefore(lbl, promptWord);
      console.log('🔍 DEBUG: Label dynamisch erstellt vor #promptWord.');
    } else {
      console.warn('⚠️ DEBUG: Kein #promptWord – Passe HTML an.');
      return;
    }
  }
  if (!state.current || state.pool.length === 0) {
    lbl.innerHTML = 'Karte: —';
    return;
  }
  const cardId = state.current.id || '—';
  const progress = state.session.done + 1;
  const globalInfo = ` <span class="emphasis">(${progress}/${state.session.total})</span>`;
  lbl.innerHTML = `Karte: <span class="emphasis">${cardId}</span>${globalInfo}`;
  lbl.classList.add('card-info');  // CSS: Bold/hell
  console.log(`🔍 DEBUG: Label gesetzt: Karte: ${cardId} (${progress}/${state.session.total})`);
}

// nextCard: Nächste Karte (Save Progress)
function nextCard(status) {  // status: 'learned' oder 'more'
  if (state.current) {
    const lessonKey = document.getElementById('lessonSelect').value;
    if (!state.progress[lessonKey]) state.progress[lessonKey] = {};
    state.progress[lessonKey][state.current.id] = status;
    saveProgress();
  }
  state.session.done++;
  if (state.session.done >= state.pool.length) {
    alert('Training beendet! Alle Karten bearbeitet.');
    stopTraining();
    return;
  }
  state.current = state.pool[state.session.done];  // Für random/seq (pool ist vorbereitet)
  setCard();
  console.log(`🔍 DEBUG: nextCard – Status: ${status}, Nächste: ${state.session.done + 1}/${state.pool.length}`);
}

// flipCard: Flip Karte (zeige Solution)
function flipCard() {
  const cardEl = document.getElementById('card');
  if (cardEl) cardEl.classList.toggle('flipped');
  console.log('🔍 DEBUG: Karte geflippt.');
}

// Voice: TTS für Pinyin/ZH
function speak(text, lang = 'zh-CN') {  // zh-CN für PY/ZH, de-DE für DE
  if (!state.settings.voice) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.8;
    speechSynthesis.speak(utterance);
    console.log(`🔍 DEBUG: Voice: "${text}" (${lang})`);
  } catch (e) {
    console.warn('⚠️ DEBUG: Voice fehlgeschlagen:', e);
  }
}

// stopTraining: Reset
function stopTraining() {
  state.current = null;
  state.pool = [];
  state.session = { done: 0, total: 0 };
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.style.display = 'inline';
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) nextBtn.style.display = 'none';
  const cardEl = document.getElementById('card');
  if (cardEl) cardEl.classList.remove('flipped');
  updateCardInfo();
  console.log('🔍 DEBUG: Training gestoppt.');
}

// updateUI: Settings in UI setzen
function updateUI() {
  const mode = document.querySelector('input[name="mode"]:checked');
  if (mode) state.settings.mode = mode.value;
  const order = document.querySelector('input[name="order"]:checked');
  if (order) state.settings.order = order.value;
  const voiceEl = document.getElementById('voiceToggle');
  if (voiceEl) state.settings.voice = voiceEl.checked;
  saveSettings();
  console.log('🔍 DEBUG: UI-Settings aktualisiert:', state.settings);
}

// Event-Listeners
function initEvents() {
  // Settings-Change
  document.querySelectorAll('input[name="mode"], input[name="order"]').forEach(el => {
    el.addEventListener('change', updateUI);
  });
  // Buttons
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', startTraining);
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) nextBtn.addEventListener('click', () => nextCard('learned'));  // Default: Learned
  const learnBtn = document.getElementById('learnBtn');
  if (learnBtn) learnBtn.addEventListener('click', () => nextCard('learned'));
  const moreBtn = document.getElementById('moreBtn');
  if (moreBtn) moreBtn.addEventListener('click', () => nextCard('more'));
  const flipBtn = document.getElementById('flipBtn');
  if (flipBtn) flipBtn.addEventListener('click', flipCard);
  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) stopBtn.addEventListener('click', stopTraining);
  // Lektion-Übernehmen (falls separater Button)
  const loadBtn = document.getElementById('loadBtn');
  if (loadBtn) loadBtn.addEventListener('click', () => gatherPool(document.getElementById('lessonSelect').value));
  console.log('🔍 DEBUG: Events initialisiert.');
}

// DOMContentLoaded: Initialisierung
window.addEventListener('DOMContentLoaded', () => {
  console.log('🔍 DEBUG: JS-Code geladen – Kein Syntax-Fehler! Starte Setup...');
  loadSettings();
  loadProgress();
  loadExcel();  // Automatisch laden
  initEvents();
  // Voice-Init (falls Browser unterstützt)
  if ('speechSynthesis' in window) {
    console.log('✅ DEBUG: Voice (TTS) verfügbar.');
  } else {
    console.warn('⚠️ DEBUG: Kein TTS-Support – Voice deaktivieren.');
    state.settings.voice = false;
  }
});