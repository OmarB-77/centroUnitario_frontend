// Validazioni di dominio pure (nessun DOM, nessuna rete, nessun Supabase).
//
// Questo modulo è il "mirror client" delle difese applicate dal database
// (CHECK, trigger, funzioni plpgsql, RLS): serve a dare un feedback immediato
// all'operatore (UX), MA non è mai l'unica barriera. La validazione reale
// resta lato DB (vedi migrazioni backend). Qui replichiamo le stesse regole
// così da poterle verificare con Vitest/fast-check indipendentemente dal backend.
//
// Convenzioni:
//   - Ogni funzione è PURA: stesso input → stesso output, nessun side effect.
//   - Il risultato è sempre un oggetto { ok: boolean, errors: string[] }.
//   - I messaggi di errore sono in italiano e descrivono il problema per l'utente.
//   - `ok` è true se e solo se `errors` è vuoto.

/**
 * @typedef {Object} RisultatoValidazione
 * @property {boolean} ok        true se non ci sono errori
 * @property {string[]} errors   elenco dei messaggi di errore (vuoto se ok)
 */

// Limiti di dominio (coerenti con i CHECK del database).
export const LIMITI = Object.freeze({
  QUANTITA_MIN: 1,
  QUANTITA_MAX: 999999,
  NOME_MAX: 200,
  CODICE_MAX: 50,
  PEZZI_MIN: 1,
  TESTO_ALTRO_MAX: 500,
});

/** Destinazioni valide per lo scarico dal Centro Unitario (enum destinazione_scarico). */
export const DESTINAZIONI = Object.freeze([
  "armadio_ripristino",
  "associazione",
  "altro",
]);

/** Unità di inserimento valide (enum unita_inserimento). */
export const UNITA_INSERIMENTO = Object.freeze(["unita_carico", "unita_base"]);

/**
 * Costruisce un risultato di validazione a partire da una lista di errori.
 * @param {string[]} errors
 * @returns {RisultatoValidazione}
 */
function risultato(errors) {
  const puliti = errors.filter((e) => typeof e === "string" && e.length > 0);
  return { ok: puliti.length === 0, errors: puliti };
}

/**
 * Verifica che un valore sia un intero finito (number senza parte frazionaria).
 * Esclude NaN, Infinity, stringhe, null/undefined, booleani e valori non interi.
 * @param {unknown} n
 * @returns {boolean}
 */
export function isIntero(n) {
  return typeof n === "number" && Number.isInteger(n);
}

/**
 * Valida la quantità di un movimento (carico/scarico CU, prelievo armadi).
 * Regola: intero compreso in [1, 999999] (R7.3, R8.4, R9.3).
 *
 * @param {unknown} n quantità da validare (in unità base per gli scarichi/prelievi)
 * @returns {RisultatoValidazione}
 */
export function validaQuantita(n) {
  if (!isIntero(n)) {
    return risultato(["La quantità deve essere un numero intero."]);
  }
  if (n < LIMITI.QUANTITA_MIN || n > LIMITI.QUANTITA_MAX) {
    return risultato([
      `La quantità deve essere compresa tra ${LIMITI.QUANTITA_MIN} e ${LIMITI.QUANTITA_MAX}.`,
    ]);
  }
  return risultato([]);
}

/**
 * Valida una soglia di giacenza minima (CU o armadi).
 * Regola: intero non negativo, cioè >= 0 (R1.7).
 *
 * @param {unknown} n soglia da validare
 * @param {string} [nomeCampo="La soglia"] etichetta usata nel messaggio di errore
 * @returns {RisultatoValidazione}
 */
export function validaSogliaNonNegativa(n, nomeCampo = "La soglia") {
  if (!isIntero(n)) {
    return risultato([`${nomeCampo} deve essere un numero intero.`]);
  }
  if (n < 0) {
    return risultato([`${nomeCampo} non può essere negativa.`]);
  }
  return risultato([]);
}

/**
 * Valida l'intervallo di allerta scadenza (giorni).
 * Regola: intero non negativo, cioè >= 0 (R1.7).
 *
 * @param {unknown} n intervallo in giorni
 * @returns {RisultatoValidazione}
 */
export function validaIntervallo(n) {
  if (!isIntero(n)) {
    return risultato(["L'intervallo di allerta deve essere un numero intero."]);
  }
  if (n < 0) {
    return risultato(["L'intervallo di allerta non può essere negativo."]);
  }
  return risultato([]);
}

/**
 * Valida i pezzi per confezione del prodotto.
 * Regola: intero >= 1 (R1.8); un valore pari a 0 non è ammesso.
 *
 * @param {unknown} n pezzi per confezione
 * @returns {RisultatoValidazione}
 */
export function validaPezziPerConfezione(n) {
  if (!isIntero(n)) {
    return risultato(["I pezzi per confezione devono essere un numero intero."]);
  }
  if (n < LIMITI.PEZZI_MIN) {
    return risultato([
      `I pezzi per confezione devono essere almeno ${LIMITI.PEZZI_MIN}.`,
    ]);
  }
  return risultato([]);
}

/**
 * Valida un testo obbligatorio con limite di lunghezza (es. nome anagrafica).
 * Regola: stringa non vuota (dopo trim) e lunghezza <= max (R1.9, R2.2, R3.2).
 *
 * @param {unknown} valore testo da validare
 * @param {number} max lunghezza massima consentita
 * @param {string} [nomeCampo="Il nome"] etichetta usata nei messaggi di errore
 * @returns {RisultatoValidazione}
 */
export function validaTestoObbligatorio(valore, max, nomeCampo = "Il nome") {
  if (typeof valore !== "string" || valore.trim().length === 0) {
    return risultato([`${nomeCampo} è obbligatorio.`]);
  }
  if (valore.length > max) {
    return risultato([
      `${nomeCampo} non può superare ${max} caratteri.`,
    ]);
  }
  return risultato([]);
}

/**
 * Valida il nome di un prodotto/anagrafica (1..200 caratteri) (R1.9, R2.2, R3.2).
 * @param {unknown} nome
 * @returns {RisultatoValidazione}
 */
export function validaNome(nome) {
  return validaTestoObbligatorio(nome, LIMITI.NOME_MAX, "Il nome");
}

/**
 * Valida il codice prodotto (1..50 caratteri) (R1.9).
 * L'unicità del codice è verificata dal database (CHECK/UNIQUE), non qui.
 * @param {unknown} codice
 * @returns {RisultatoValidazione}
 */
export function validaCodice(codice) {
  return validaTestoObbligatorio(codice, LIMITI.CODICE_MAX, "Il codice prodotto");
}

/**
 * Valida la scelta dell'unità di inserimento al carico CU.
 * Regola: scelta obbligatoria e senza default, tra 'unita_carico' e 'unita_base'
 * (R7.11, R7.12).
 *
 * @param {unknown} unita valore scelto dall'operatore
 * @returns {RisultatoValidazione}
 */
export function validaUnitaInserimento(unita) {
  if (unita === null || unita === undefined || unita === "") {
    return risultato(["L'unità di inserimento è obbligatoria."]);
  }
  if (!UNITA_INSERIMENTO.includes(unita)) {
    return risultato(["L'unità di inserimento non è valida."]);
  }
  return risultato([]);
}

/**
 * Valida l'obbligatorietà dei campi data al carico, in base al flag del prodotto.
 *
 * Regole (R7.9, R7.10):
 *   - prodotto CON scadenza (`senza_scadenza === false`): richiede `data_scadenza`;
 *   - prodotto SENZA scadenza (`senza_scadenza === true`): richiede `data_produzione`.
 *
 * Le date sono trattate come "presenti" se sono stringhe non vuote (es. "2025-03-01").
 * La validità del formato/valore della data è responsabilità di js/domain/dates.js
 * e dei CHECK del database; qui si verifica solo l'obbligatorietà coerente col flag.
 *
 * @param {{ senza_scadenza?: boolean }} prodotto anagrafica del prodotto
 * @param {{ data_scadenza?: unknown, data_produzione?: unknown }} movimento dati del carico
 * @returns {RisultatoValidazione}
 */
export function validaCampiScadenza(prodotto, movimento) {
  const errori = [];
  const p = prodotto || {};
  const m = movimento || {};

  const presente = (v) => typeof v === "string" && v.trim().length > 0;

  if (p.senza_scadenza === true) {
    // Prodotto senza scadenza: serve la data di produzione.
    if (!presente(m.data_produzione)) {
      errori.push("La data di produzione è obbligatoria per questo prodotto.");
    }
  } else {
    // Prodotto con data di scadenza (default): serve la data di scadenza.
    if (!presente(m.data_scadenza)) {
      errori.push("La data di scadenza è obbligatoria per questo prodotto.");
    }
  }

  return risultato(errori);
}

/**
 * Valida la coerenza tra destinazione dello scarico CU e il relativo dettaglio.
 *
 * Regole:
 *   - destinazione = 'associazione' → richiede un `associazioneId` valorizzato
 *     (l'esistenza dell'associazione è verificata dal DB tramite FK) (R8.10);
 *   - destinazione = 'altro' → consente un `testoAltro` facoltativo, max 500 caratteri
 *     (R8.11);
 *   - destinazione = 'armadio_ripristino' → non richiede alcun dettaglio (R8.12):
 *     eventuali associazioneId/testoAltro forniti vengono considerati incoerenti.
 *
 * @param {unknown} destinazione una tra 'armadio_ripristino' | 'associazione' | 'altro'
 * @param {{ associazioneId?: unknown, testoAltro?: unknown }} [dettaglio={}] dettaglio destinazione
 * @returns {RisultatoValidazione}
 */
export function validaDestinazione(destinazione, dettaglio = {}) {
  const errori = [];
  const d = dettaglio || {};
  const associazioneId = d.associazioneId;
  const testoAltro = d.testoAltro;

  const presente = (v) =>
    v !== null && v !== undefined && !(typeof v === "string" && v.trim().length === 0);

  if (!DESTINAZIONI.includes(destinazione)) {
    return risultato(["La destinazione dello scarico non è valida."]);
  }

  if (destinazione === "associazione") {
    if (!presente(associazioneId)) {
      errori.push("L'associazione di destinazione è obbligatoria.");
    }
    if (presente(testoAltro)) {
      errori.push(
        'Il testo libero è consentito solo per la destinazione "Altro".',
      );
    }
  } else if (destinazione === "altro") {
    if (presente(associazioneId)) {
      errori.push(
        'L\'associazione non è applicabile alla destinazione "Altro".',
      );
    }
    if (typeof testoAltro === "string" && testoAltro.length > LIMITI.TESTO_ALTRO_MAX) {
      errori.push(
        `Il testo della destinazione non può superare ${LIMITI.TESTO_ALTRO_MAX} caratteri.`,
      );
    }
  } else {
    // armadio_ripristino: nessun dettaglio ammesso.
    if (presente(associazioneId) || presente(testoAltro)) {
      errori.push(
        'La destinazione "Armadio di ripristino" non prevede alcun dettaglio.',
      );
    }
  }

  return risultato(errori);
}
