// Logica di dominio: date civili e calcolo della scadenza effettiva.
//
// MODULO PURO — nessun accesso a DOM, rete o Supabase: solo funzioni
// deterministiche e testabili (Vitest + fast-check). Mirror lato client della
// logica del trigger DB 0007_trigger_scadenza.sql.
//
// REGOLA FONDAMENTALE SULLE DATE (steering + design.md "Logica delle date"):
//   Le date "civili" (giorno di calendario, senza ora) vanno costruite dai
//   COMPONENTI LOCALI (getFullYear/getMonth/getDate) e MAI con toISOString(),
//   che converte in UTC e può far "slittare" il giorno a cavallo del fuso.
//   Qui si lavora sempre su stringhe 'YYYY-MM-DD' o su triplette {y, m, d},
//   senza mai passare per UTC.
//
// Requisiti coperti: 7.1, 7.7, 7.8, 13.1, 13.4.

/**
 * Antepone zeri a sinistra fino alla lunghezza richiesta.
 * @param {number} n numero intero non negativo
 * @param {number} [larghezza=2] lunghezza minima della stringa risultante
 * @returns {string} numero formattato con zero-padding
 */
function pad(n, larghezza = 2) {
  return String(n).padStart(larghezza, "0");
}

/**
 * Converte un oggetto Date (o {y,m,d}) in stringa civile 'YYYY-MM-DD',
 * costruita dai COMPONENTI LOCALI. Non usa toISOString() (R13.4).
 *
 * Per un Date usa getFullYear()/getMonth()+1/getDate(): così la stringa
 * rappresenta il giorno nel fuso locale, non in UTC.
 *
 * @param {Date | {y: number, m: number, d: number}} date Date o tripletta civile
 * @returns {string} data nel formato 'YYYY-MM-DD'
 */
export function toYmd(date) {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      throw new TypeError("toYmd: Date non valida");
    }
    // Componenti LOCALI: getMonth() è 0-based, quindi +1.
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  if (date && typeof date === "object") {
    const { y, m, d } = date;
    return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  }
  throw new TypeError("toYmd: atteso Date o {y, m, d}");
}

/**
 * Restituisce la data odierna locale come stringa 'YYYY-MM-DD', costruita dai
 * componenti locali (mai toISOString()). È la "data odierna" usata lato client
 * per le check-list di scadenza (R13.4).
 *
 * @param {Date} [now=new Date()] momento di riferimento (iniettabile per i test)
 * @returns {string} data odierna locale in formato 'YYYY-MM-DD'
 */
export function oggiYmd(now = new Date()) {
  return toYmd(now);
}

/**
 * Valida e scompone una stringa civile 'YYYY-MM-DD' nei suoi componenti,
 * SENZA passare per UTC (nessun new Date(str), che interpreterebbe la stringa
 * come mezzanotte UTC e potrebbe slittare il giorno nel fuso locale).
 *
 * @param {string} str data nel formato 'YYYY-MM-DD'
 * @returns {{y: number, m: number, d: number}} componenti civili (m: 1..12)
 */
export function parseYmd(str) {
  if (typeof str !== "string") {
    throw new TypeError("parseYmd: atteso string 'YYYY-MM-DD'");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) {
    throw new TypeError(`parseYmd: formato non valido: ${str}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  // Controllo di validità del calendario (es. rifiuta 2024-02-31, mese 13, giorno 0).
  if (m < 1 || m > 12 || d < 1 || d > giorniNelMese(y, m)) {
    throw new RangeError(`parseYmd: data inesistente nel calendario: ${str}`);
  }
  return { y, m, d };
}

/**
 * Restituisce un Date LOCALE a mezzanotte corrispondente alla data civile.
 * Usa il costruttore per componenti (anno, mese 0-based, giorno), che è
 * interpretato nel fuso locale — nessuno slittamento UTC.
 *
 * @param {string} str data nel formato 'YYYY-MM-DD'
 * @returns {Date} Date locale a mezzanotte del giorno civile
 */
export function parseYmdToLocalDate(str) {
  const { y, m, d } = parseYmd(str);
  return new Date(y, m - 1, d);
}

/**
 * Numero di giorni nel mese dato (gestisce gli anni bisestili).
 * @param {number} y anno
 * @param {number} m mese 1..12
 * @returns {number} giorni del mese
 */
function giorniNelMese(y, m) {
  // Il giorno 0 del mese successivo è l'ultimo giorno del mese corrente.
  return new Date(y, m, 0).getDate();
}

/**
 * Aggiunge n anni a una data civile 'YYYY-MM-DD', restituendo una nuova stringa
 * 'YYYY-MM-DD'. Il calcolo avviene su componenti locali (nessun UTC).
 *
 * Gestione 29 febbraio: se il giorno non esiste nell'anno di destinazione
 * (es. 2020-02-29 + 1 anno), si normalizza all'ultimo giorno valido del mese
 * (coerente con il comportamento del costruttore Date per componenti).
 *
 * @param {string} ymd data di partenza in formato 'YYYY-MM-DD'
 * @param {number} n numero (intero) di anni da aggiungere (può essere negativo)
 * @returns {string} data risultante in formato 'YYYY-MM-DD'
 */
export function addYears(ymd, n) {
  const { y, m, d } = parseYmd(ymd);
  if (!Number.isInteger(n)) {
    throw new TypeError("addYears: n deve essere un intero");
  }
  const annoDest = y + n;
  // Clamp del giorno all'ultimo giorno valido del mese di destinazione.
  const giorno = Math.min(d, giorniNelMese(annoDest, m));
  return toYmd({ y: annoDest, m, d: giorno });
}

/**
 * Differenza, in giorni interi, tra due date civili (ymdA - ymdB).
 * Positivo se ymdA è successiva a ymdB, negativo se precedente, 0 se uguali.
 *
 * Il calcolo usa Date locali a mezzanotte e si basa sulla differenza in
 * millisecondi arrotondata: poiché entrambe sono mezzanotte locale, la
 * differenza è un multiplo esatto di giorni (eventuali salti DST sono
 * assorbiti dall'arrotondamento a giorno intero).
 *
 * @param {string} ymdA prima data in formato 'YYYY-MM-DD'
 * @param {string} ymdB seconda data in formato 'YYYY-MM-DD'
 * @returns {number} differenza (ymdA - ymdB) in giorni interi
 */
export function diffGiorni(ymdA, ymdB) {
  const a = parseYmdToLocalDate(ymdA);
  const b = parseYmdToLocalDate(ymdB);
  const MS_PER_GIORNO = 24 * 60 * 60 * 1000;
  return Math.round((a.getTime() - b.getTime()) / MS_PER_GIORNO);
}

/**
 * Calcola la data di scadenza effettiva di un carico, come mirror lato client
 * del trigger DB 0007_trigger_scadenza.sql. Funzione pura.
 *
 * Regole (R7.1, R7.7, R7.8):
 *   - prodotto CON scadenza (senzaScadenza=false): richiede dataScadenza;
 *     la scadenza effettiva = dataScadenza (R7.1).
 *   - prodotto SENZA scadenza (senzaScadenza=true) e nessun override:
 *     richiede dataProduzione; scadenza effettiva = dataProduzione + 5 anni (R7.7).
 *   - prodotto SENZA scadenza con override operatore valorizzato:
 *     la scadenza effettiva = override, che prevale (R7.8).
 *
 * Tutte le date sono stringhe civili 'YYYY-MM-DD'; l'output è una stringa civile.
 *
 * @param {Object} params parametri del carico
 * @param {boolean} params.senzaScadenza true se il prodotto è "senza scadenza"
 * @param {string} [params.dataScadenza] data di scadenza (per prodotti con scadenza)
 * @param {string} [params.dataProduzione] data di produzione (per prodotti senza scadenza)
 * @param {string} [params.override] scadenza effettiva imposta dall'operatore (prevale)
 * @returns {string} data di scadenza effettiva in formato 'YYYY-MM-DD'
 */
export function scadenzaEffettiva({ senzaScadenza, dataScadenza, dataProduzione, override } = {}) {
  if (senzaScadenza) {
    // Prodotto SENZA scadenza: l'override operatore prevale su tutto (R7.8).
    if (override != null && override !== "") {
      // parseYmd convalida il formato; si restituisce la stringa normalizzata.
      return toYmd(parseYmd(override));
    }
    // Senza override: serve la data di produzione (R7.7, cfr. R7.9 lato DB).
    if (dataProduzione == null || dataProduzione === "") {
      throw new Error(
        "scadenzaEffettiva: data di produzione obbligatoria per un prodotto senza scadenza",
      );
    }
    // scadenza effettiva = data di produzione + 5 anni (R7.7).
    return addYears(dataProduzione, 5);
  }

  // Prodotto CON scadenza: serve la data di scadenza (R7.1, cfr. R7.10 lato DB).
  if (dataScadenza == null || dataScadenza === "") {
    throw new Error(
      "scadenzaEffettiva: data di scadenza obbligatoria per un prodotto con scadenza",
    );
  }
  // scadenza effettiva = data di scadenza (R7.1).
  return toYmd(parseYmd(dataScadenza));
}
