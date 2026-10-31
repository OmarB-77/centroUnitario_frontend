// js/scanner.js
//
// Scanner_Barcode live (R15.1, R15.4, R15.5, R15.6, R15.7).
//
// Integra la libreria `html5-qrcode` in modalità SCANSIONE LIVE dalla
// fotocamera (stream in tempo reale). È ESCLUSA per progetto la lettura di
// codici da foto/immagini caricate: qui NON si usano `Html5Qrcode.scanFile`
// né input di tipo file. Solo stream dalla camera (R15.4).
//
// Responsabilità del modulo:
//   - enumerare le fotocamere disponibili (enumeraCamere);
//   - gestire la preferenza di fotocamera persistita in localStorage
//     (cameraPreferita / salvaCameraPreferita) con default sulla camera
//     POSTERIORE quando non c'è preferenza salvata (R15.5, R15.6);
//   - avviare/fermare la scansione live (avviaScansione / fermaScansione)
//     chiamando una callback `onRisultato(testo)` ad ogni lettura;
//   - fallire con un errore chiaro (in italiano) quando la libreria non è
//     disponibile o non c'è accesso alla fotocamera, così che la UI possa
//     offrire il fallback all'inserimento manuale del codice (R15.7).
//
// SEPARAZIONE LOGICA PURA / EFFETTI
//   La libreria `html5-qrcode`, la fotocamera e `localStorage` sono dipendenze
//   reali del browser e NON sono unit-testabili in isolamento qui. L'unica
//   logica realmente verificabile — l'euristica di scelta della fotocamera
//   predefinita — è estratta nella funzione PURA ed esportata
//   `scegliCameraPredefinita(cameras, preferenza)`, priva di effetti collaterali
//   e quindi testabile con Vitest.
//
// IMPORT DELLA LIBRERIA
//   `html5-qrcode` è importata come build ESM da CDN con versione PINNATA.
//   L'import è dinamico così che il semplice caricamento del modulo (es. per
//   usare la funzione pura o la gestione della preferenza) non richieda la rete
//   né la libreria: la dipendenza è risolta solo all'avvio effettivo della
//   scansione.

/**
 * URL della build ESM di html5-qrcode, con VERSIONE PINNATA.
 * Pinnare la major (2.x) protegge da breaking change inattesi della CDN.
 */
export const HTML5_QRCODE_ESM_URL = "https://esm.sh/html5-qrcode@2.3.8";

/** Chiave di localStorage per la preferenza di fotocamera (R15.5). */
export const CHIAVE_CAMERA_PREFERITA = "centro-unitario-camera";

// Parole chiave (case-insensitive) che, se presenti nella label del device,
// identificano tipicamente la fotocamera POSTERIORE. Su Android/iOS le label
// contengono spesso "back"/"rear"; "environment" è il termine dello standard
// MediaDevices per la camera rivolta verso l'ambiente.
const PAROLE_CHIAVE_POSTERIORE = ["back", "rear", "environment", "posteriore"];

/**
 * Indica se la label di una fotocamera suggerisce che sia la camera posteriore.
 * @param {string} [label]
 * @returns {boolean}
 */
function sembraPosteriore(label) {
  if (typeof label !== "string") return false;
  const l = label.toLowerCase();
  return PAROLE_CHIAVE_POSTERIORE.some((k) => l.includes(k));
}

/**
 * Euristica PURA di scelta della fotocamera predefinita.
 *
 * Priorità:
 *   1. se `preferenza` è valorizzata ed esiste tra le camere disponibili,
 *      vince la preferenza salvata dall'utente (R15.6);
 *   2. altrimenti si sceglie la prima camera la cui label sembra POSTERIORE
 *      (euristica "back"/"rear"/"environment"/"posteriore") (R15.6);
 *   3. altrimenti si ripiega sulla prima camera disponibile;
 *   4. se non ci sono camere, restituisce null.
 *
 * Nota: una preferenza che non corrisponde ad alcuna camera presente viene
 * IGNORATA (il device potrebbe non essere più disponibile), ricadendo sulle
 * regole 2–3.
 *
 * Modulo/funzione PURA: nessun accesso a DOM, rete, fotocamera o localStorage.
 *
 * @param {Array<{id: string, label?: string}>} cameras elenco camere {id,label}
 * @param {string|null|undefined} [preferenza] id camera preferito (se presente)
 * @returns {string|null} id della camera scelta, oppure null se nessuna camera
 */
export function scegliCameraPredefinita(cameras, preferenza) {
  if (!Array.isArray(cameras) || cameras.length === 0) {
    return null;
  }

  // 1) Preferenza esplicita, se ancora presente tra le camere disponibili.
  if (typeof preferenza === "string" && preferenza !== "") {
    const match = cameras.find((c) => c && c.id === preferenza);
    if (match) return match.id;
  }

  // 2) Prima camera che sembra posteriore.
  const posteriore = cameras.find((c) => c && sembraPosteriore(c.label));
  if (posteriore) return posteriore.id;

  // 3) Ripiego sulla prima camera disponibile.
  const prima = cameras.find((c) => c && typeof c.id === "string");
  return prima ? prima.id : null;
}

/**
 * Errore specifico dello scanner, con messaggi in italiano adatti alla UI.
 * `codice` consente alla UI di distinguere i casi (es. per attivare subito il
 * fallback manuale su `no-camera`/`permesso-negato`).
 */
export class ScannerError extends Error {
  /**
   * @param {string} message messaggio in italiano
   * @param {string} codice codice macchina ('no-libreria'|'no-camera'|'permesso-negato'|'non-avviato'|'generico')
   */
  constructor(message, codice = "generico") {
    super(message);
    this.name = "ScannerError";
    this.codice = codice;
  }
}

/** Riferimento al localStorage, con guardia per ambienti che non lo espongono. */
function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    // Alcuni contesti (es. privacy mode) lanciano all'accesso: trattiamo come assente.
    return null;
  }
}

/**
 * Legge dalla persistenza l'id della fotocamera preferita (R15.5/R15.6).
 * @returns {string|null} id salvato, oppure null se assente/non disponibile
 */
export function cameraPreferita() {
  const s = storage();
  if (!s) return null;
  const v = s.getItem(CHIAVE_CAMERA_PREFERITA);
  return v && v !== "" ? v : null;
}

/**
 * Salva (o azzera) nella persistenza l'id della fotocamera preferita (R15.5).
 * @param {string|null} id id della camera da memorizzare; null/'' per rimuovere
 * @returns {boolean} true se l'operazione è stata applicata, false se lo storage non è disponibile
 */
export function salvaCameraPreferita(id) {
  const s = storage();
  if (!s) return false;
  if (typeof id === "string" && id !== "") {
    s.setItem(CHIAVE_CAMERA_PREFERITA, id);
  } else {
    s.removeItem(CHIAVE_CAMERA_PREFERITA);
  }
  return true;
}

// Istanza corrente di Html5Qrcode (una scansione live per volta) e id del
// contenitore in uso. Mantenuti a livello di modulo per supportare
// avvia/ferma senza che il chiamante gestisca lo stato della libreria.
let _istanza = null;
let _elementIdCorrente = null;

/**
 * Carica dinamicamente la libreria html5-qrcode dalla CDN (versione pinnata).
 * Isola l'import per poter restituire un errore chiaro se la libreria non è
 * raggiungibile/caricabile (es. offline, CDN bloccata).
 *
 * @returns {Promise<{Html5Qrcode: Function}>}
 * @throws {ScannerError} codice 'no-libreria' se l'import fallisce o l'export manca
 */
async function caricaLibreria() {
  let mod;
  try {
    mod = await import(/* @vite-ignore */ HTML5_QRCODE_ESM_URL);
  } catch {
    throw new ScannerError(
      "Impossibile caricare la libreria di scansione. Verifica la connessione e riprova, oppure inserisci il codice manualmente.",
      "no-libreria",
    );
  }
  const Html5Qrcode = mod?.Html5Qrcode ?? mod?.default?.Html5Qrcode;
  if (typeof Html5Qrcode !== "function") {
    throw new ScannerError(
      "Libreria di scansione non valida. Inserisci il codice manualmente.",
      "no-libreria",
    );
  }
  return { Html5Qrcode };
}

/**
 * Enumera le fotocamere disponibili sul dispositivo (R15.6).
 *
 * Avvolge `Html5Qrcode.getCameras()` normalizzandone l'output in
 * `{ id, label }`. Richiede che l'utente conceda il permesso fotocamera: in
 * caso di diniego/assenza viene lanciato uno ScannerError adeguato così che la
 * UI possa proporre il fallback manuale (R15.7).
 *
 * @returns {Promise<Array<{id: string, label: string}>>} elenco camere
 * @throws {ScannerError} 'no-libreria' | 'permesso-negato' | 'no-camera'
 */
export async function enumeraCamere() {
  const { Html5Qrcode } = await caricaLibreria();

  let devices;
  try {
    devices = await Html5Qrcode.getCameras();
  } catch (err) {
    // getCameras fallisce tipicamente quando il permesso è negato o non ci sono
    // dispositivi/API disponibili: lo trattiamo come "nessuna camera usabile".
    throw new ScannerError(
      "Accesso alla fotocamera negato o non disponibile. Puoi inserire il codice manualmente.",
      classificaErroreCamera(err),
    );
  }

  if (!Array.isArray(devices) || devices.length === 0) {
    throw new ScannerError(
      "Nessuna fotocamera disponibile. Puoi inserire il codice manualmente.",
      "no-camera",
    );
  }

  return devices.map((d) => ({
    id: d.id,
    label: typeof d.label === "string" ? d.label : "",
  }));
}

/**
 * Classifica un errore di accesso alla fotocamera in un codice ScannerError.
 * @param {unknown} err
 * @returns {string} 'permesso-negato' | 'no-camera'
 */
function classificaErroreCamera(err) {
  const nome = err && typeof err === "object" ? String(err.name || "") : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "permesso-negato";
  }
  return "no-camera";
}

/**
 * Avvia la scansione LIVE dalla fotocamera all'interno dell'elemento indicato.
 *
 * Usa `Html5Qrcode.start` con, in ordine di priorità:
 *   - `cameraId` esplicito passato dal chiamante;
 *   - altrimenti un vincolo `{ facingMode: "environment" }` per preferire la
 *     fotocamera posteriore senza dover enumerare i device (R15.6).
 * Non viene mai usata `scanFile` né alcun input immagine: SOLO stream (R15.4).
 *
 * Ad ogni lettura valida invoca `onRisultato(testoDecodificato)`. Gli errori di
 * decodifica frame-by-frame (nessun codice nel frame) sono ignorati: non sono
 * errori operativi.
 *
 * @param {string} elementId id del contenitore DOM in cui montare lo stream
 * @param {{ onRisultato: (testo: string) => void, cameraId?: string, fps?: number, qrbox?: number|{width:number,height:number} }} opzioni
 * @returns {Promise<void>}
 * @throws {ScannerError} 'no-libreria' | 'no-camera' | 'permesso-negato' | 'generico'
 */
export async function avviaScansione(elementId, opzioni = {}) {
  const { onRisultato, cameraId, fps = 10, qrbox = 250 } = opzioni;

  if (typeof elementId !== "string" || elementId === "") {
    throw new ScannerError(
      "Elemento contenitore dello scanner non valido.",
      "generico",
    );
  }
  if (typeof onRisultato !== "function") {
    throw new ScannerError(
      "Callback di risultato dello scanner mancante.",
      "generico",
    );
  }

  // Una sola scansione live alla volta: fermiamo l'eventuale precedente.
  if (_istanza) {
    await fermaScansione();
  }

  const { Html5Qrcode } = await caricaLibreria();

  let istanza;
  try {
    istanza = new Html5Qrcode(elementId);
  } catch {
    throw new ScannerError(
      "Impossibile inizializzare lo scanner sull'elemento indicato.",
      "generico",
    );
  }

  // Sorgente camera: id esplicito oppure vincolo "environment" (posteriore).
  const sorgente =
    typeof cameraId === "string" && cameraId !== ""
      ? cameraId
      : { facingMode: "environment" };

  const config = { fps, qrbox };

  const onScanSuccess = (decodedText) => {
    try {
      onRisultato(decodedText);
    } catch {
      // Non lasciamo che un errore della callback interrompa lo stream.
    }
  };

  // Callback di errore per frame SENZA codice: va ignorata (è il flusso normale
  // della scansione live frame-by-frame), altrimenti la libreria logga a raffica.
  const onScanFailure = () => {};

  try {
    await istanza.start(sorgente, config, onScanSuccess, onScanFailure);
  } catch (err) {
    // Pulizia best-effort dell'istanza non avviata.
    try {
      await istanza.clear();
    } catch {
      /* no-op */
    }
    throw new ScannerError(
      "Impossibile avviare la scansione dalla fotocamera. Verifica i permessi o inserisci il codice manualmente.",
      classificaErroreCamera(err),
    );
  }

  _istanza = istanza;
  _elementIdCorrente = elementId;
}

/**
 * Ferma la scansione live in corso e libera le risorse (stream + DOM montato).
 *
 * È idempotente: se nessuna scansione è attiva non fa nulla e non lancia.
 *
 * @returns {Promise<void>}
 */
export async function fermaScansione() {
  const istanza = _istanza;
  if (!istanza) return;

  // Azzeriamo subito lo stato di modulo per evitare doppie chiamate concorrenti.
  _istanza = null;
  _elementIdCorrente = null;

  try {
    await istanza.stop();
  } catch {
    // stop() può lanciare se lo scanner è già fermo: lo ignoriamo.
  }
  try {
    await istanza.clear();
  } catch {
    // clear() può lanciare se il DOM è già stato smontato: lo ignoriamo.
  }
}

/**
 * Indica se è attualmente in corso una scansione live.
 * @returns {boolean}
 */
export function scansioneAttiva() {
  return _istanza !== null;
}

export default {
  HTML5_QRCODE_ESM_URL,
  CHIAVE_CAMERA_PREFERITA,
  ScannerError,
  scegliCameraPredefinita,
  cameraPreferita,
  salvaCameraPreferita,
  enumeraCamere,
  avviaScansione,
  fermaScansione,
  scansioneAttiva,
};
