/* r15.5 HSK: Fix "Leeren"; show per-lesson Richtig/Falsch; 'Unsicher' nicht zählen */
/* r15.3 HSK: Fix für User-Excel – DATA_START_ROW=3 (überspringt Header+Meta), COL_ID=8 (H=Index7), verbesserte Skip für '*' Meta */
let EXCEL_URL = './data/HSK_Lektionen.xlsx';
const DATA_START_ROW=3;  // Geändert: Start ab Zeile 3 (Index 2) – überspringt Header (1) + Meta (2)
const COL_WORD={de:1, py:2, zh:6};  // Unverändert: de=A(1=Index0), py=B(2=1), zh=F(6=5) – passt zu Logs
const COL_SENT={de:5, py:4, zh:7};  // Unverändert: de=E(5=4), py=D(4=3), zh=G(7=6) – passt
const COL_POS=3;  // Unverändert: C(3=2)
const COL_ID=8;  // Unverändert: H(8=7) – ID in 'Lektion'-Spalte, z.B. 'HSK 1-1'
const LS_KEYS={ settings:'fc_settings_v1', progress:'fc_progress_v1' };

// state-Objekt, save/load-Funktionen, Voice-Funktionen – unverändert (kopiere aus deiner Version)

// Angepasste parseExcelBuffer: Start ab Index 2, Skip für Meta ('*'), Logs für ID in Index 7
async function parseExcelBuffer(buf){ 
  console.log('🔍 DEBUG: parseExcelBuffer gestartet – Buffer-Größe:', buf?.byteLength); 
  const wb=XLSX.read(buf,{type:'array'}); 
  console.log('🔍 DEBUG: Workbook geladen – Sheets:', wb.SheetNames); 
  state.lessons.clear(); 
  for(const name of wb.SheetNames){ 
    const sh=wb.Sheets[name]; 
    const rows=XLSX.utils.sheet_to_json(sh,{header:1,blankrows:false}); 
    console.log(`🔍 DEBUG: Sheet "${name}" – Rows geladen:`, rows.length, ' (Start ab Zeile', DATA_START_ROW, ', Index', DATA_START_ROW-1, ')'); 
    const r0=DATA_START_ROW-1;  // r0=2 (für Zeile 3, Index 2)
    const key=name; 
    if(!state.lessons.has(key)) state.lessons.set(key,[]); 
    let parsedCount = 0;  // NEU: Zähler für echte Karten
    for(let r=r0;r<rows.length;r++){ 
      const row=rows[r]||[]; 
      if (r < r0 + 3) {  // Logs für erste 3 Daten-Rows
        console.log(`🔍 DEBUG: Row ${r+1} (Index ${r}) – Vollständige Row:`, row); 
        console.log(`🔍 DEBUG: Row ${r+1} – ID aus Spalte H (Index 7): "${row[7]}"`);  // Speziell ID loggen
      }
      
      const w={de:String(row[COL_WORD.de-1]||'').trim(), py:String(row[COL_WORD.py-1]||'').trim(), zh:String(row[COL_WORD.zh-1]||'').trim()}; 
      const s={de:String(row[COL_SENT.de-1]||'').trim(), py:String(row[COL_SENT.py-1]||'').trim(), zh:String(row[COL_SENT.zh-1]||'').trim()}; 
      const pos=String(row[COL_POS-1]||'').trim(); 
      
      // ID aus Index 7 (H)
      let id = String(row[COL_ID-1] || '').trim();
      console.log(`🔍 DEBUG: Rohe ID aus Spalte H (Row ${r+1}): "${row[COL_ID-1]}" → Getrimmt: "${id}"`); 
      if (!id) { 
        id = `Nr. ${r - r0 + 1}`;
        console.log(`🔍 DEBUG: Fallback-ID gesetzt: "${id}"`); 
      }
      
      // Verbesserte Skip: Leere Felder ODER Meta-Zeilen mit '*'
      if(!(w.de||w.zh||s.de||s.zh) || w.de.startsWith('*') || s.de.startsWith('*')) { 
        console.log(`🔍 DEBUG: Row ${r+1} übersprungen (leer oder Meta mit '*')`); 
        continue; 
      }
      
      const card = {word:w, sent:s, pos, id}; 
      state.lessons.get(key).push(card); 
      parsedCount++;
      console.log(`🔍 DEBUG: Karte geparst für Row ${r+1}: ID="${id}", Wort DE="${w.de}", ZH="${w.zh}"`);  // Kompakter Log
      if (parsedCount > 3) break;  // Nur erste 3 loggen pro Sheet
    } 
    console.log(`🔍 DEBUG: Sheet "${name}" – Finale echte Karten: ${parsedCount} (von ${rows.length - r0} potenziellen Rows)`); 
  } 
  console.log('🔍 DEBUG: Alle Lessons geparst – Gesamt-Size:', state.lessons.size); 
  populateLessonSelect(); 
}

// loadExcel() – unverändert, aber ruft parseExcelBuffer auf

// updateCardInfo() – unverändert, mit dynamischem Label (aus vorheriger Antwort)
function updateCardInfo() {
  console.log('🔍 DEBUG: updateCardInfo aufgerufen'); 

  let lbl = $('#lblKarte');
  if (!lbl) {
    lbl = $('.card .lbl:first-of-type') || null;
    console.log('🔍 DEBUG: Fallback-Label gesucht:', lbl ? 'Gefunden' : 'Nicht gefunden');
  }
  if (!lbl) {
    const promptWord = $('#promptWord');
    if (promptWord && promptWord.parentNode) {
      lbl = document.createElement('label');
      lbl.id = 'lblKarte';
      lbl.className = 'lbl card-info';
      lbl.innerHTML = 'Karte:';
      promptWord.parentNode.insertBefore(lbl, promptWord);
      console.log('🔍 DEBUG: Label dynamisch erstellt vor #promptWord');
    } else {
      console.warn('⚠️ DEBUG: Kein #promptWord – passe HTML an.');
      return;
    }
  }

  console.log('🔍 DEBUG: Label gefunden/erstellt:', lbl); 

  if (!state.current || state.pool.length === 0) {
    console.log('🔍 DEBUG: Kein current/Pool leer');
    lbl.innerHTML = 'Karte:';
    lbl.classList.add('card-info');
    return;
  }

  console.log('🔍 DEBUG: Current-Karte ID:', state.current.id);
  const cardId = state.current.id || '—';
  console.log('🔍 DEBUG: Extrahierte ID:', cardId);

  let globalInfo = ` <span class="emphasis">(${state.session.done + 1}/${state.pool.length})</span>`;  // Vereinfacht, ohne seq-Check
  const fullText = `Karte: <span class="emphasis">${cardId}</span>${globalInfo}`;
  lbl.innerHTML = fullText;
  lbl.classList.add('card-info');
  console.log('🔍 DEBUG: Label gesetzt zu:', fullText);
}

// Rest des JS-Codes: setCard() muss updateCardInfo() aufrufen (z.B. in setCard(): updateCardInfo(); )
// gatherPool, startTraining, etc. – unverändert (kopiere aus deiner Version)
// DOMContentLoaded: loadSettings, loadExcel, Events – unverändert, aber stelle sicher: in setCard() { ... updateCardInfo(); ... }
