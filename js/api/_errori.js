// js/api/_errori.js
//
// Helper condivisi dal layer API per normalizzare risultati ed errori.
//
// Convenzioni del layer API (client → backend):
//   - Ogni funzione API restituisce SEMPRE un oggetto normalizzato:
//       { ok: true,  data }                       in caso di successo
//       { ok: false, error, errors?, code? }      in caso di errore
//   - `error` è un messaggio in ITALIANO pronto per la UI.
//   - `errors` (opzionale) è l'elenco degli errori di validazione client.
//   - `code` (opzionale) è il codice SQLSTATE/PostgREST originale, utile per log.
//
// La sicurezza reale resta lato DB (CHECK, FK, trigger, policy RLS): questo
// layer traduce gli errori del database in messaggi comprensibili, ma non è
// mai l'unica barriera. I dati vengono inviati tramite chiamate parametrizzate
// di supabase-js (PostgREST): NON si costruiscono stringhe SQL a mano.
// L'escape anti-XSS dei valori avviene nel layer UI (textContent/escape),
// non qui: questo modulo non tocca il DOM.

/**
 * @typedef {Object} RisultatoApi
 * @property {boolean} ok              esito dell'operazione
 * @property {*} [data]                payload in caso di successo
 * @property {string} [error]          messaggio di errore in italiano (UI)
 * @property {string[]} [errors]       errori di validazione client (se presenti)
 * @property {string} [code]           codice errore originale (SQLSTATE/PostgREST)
 */

/**
 * Costruisce un risultato di successo.
 * @param {*} data payload da restituire al chiamante
 * @returns {RisultatoApi}
 */
export function ok(data) {
  return { ok: true, data };
}

/**
 * Costruisce un risultato di errore.
 * @param {string} error messaggio in italiano per la UI
 * @param {{ errors?: string[], code?: string }} [extra] dettagli aggiuntivi
 * @returns {RisultatoApi}
 */
export function errore(error, extra = {}) {
  const out = { ok: false, error };
  if (Array.isArray(extra.errors) && extra.errors.length > 0) {
    out.errors = extra.errors;
  }
  if (extra.code) out.code = extra.code;
  return out;
}

/**
 * Costruisce un risultato di errore a partire dagli errori di validazione
 * client (tipicamente da js/domain/validation.js). Il primo messaggio diventa
 * `error`, l'elenco completo resta in `errors`.
 * @param {string[]} errors elenco di messaggi di validazione
 * @returns {RisultatoApi}
 */
export function erroreValidazione(errors) {
  const lista = Array.isArray(errors) ? errors.filter(Boolean) : [];
  const principale = lista[0] || "Dati non validi.";
  return errore(principale, { errors: lista });
}

// Codici SQLSTATE Postgres rilevanti per il mapping (vedi documentazione Postgres).
const SQLSTATE = Object.freeze({
  UNIQUE_VIOLATION: "23505", // violazione UNIQUE (es. codice duplicato, R1.6)
  FOREIGN_KEY_VIOLATION: "23503", // FK mancante o RESTRICT su delete (R1.11, R2.5, R3.5)
  CHECK_VIOLATION: "23514", // violazione CHECK di dominio (R1.7, R1.8, R1.9, ...)
  NOT_NULL_VIOLATION: "23502", // colonna NOT NULL mancante
});

/**
 * Traduce un errore restituito da supabase-js/PostgREST in un messaggio italiano.
 *
 * `err` è l'oggetto `error` tipico di supabase-js, con i campi:
 *   - code     SQLSTATE Postgres o codice PostgREST
 *   - message  messaggio tecnico (inglese)
 *   - details  dettagli aggiuntivi
 *
 * Il parametro `contesto` consente messaggi più mirati per operazione/entità
 * (es. "eliminazione del punto di prelievo") senza esporre dettagli tecnici.
 *
 * @param {{ code?: string, message?: string, details?: string } | null | undefined} err
 * @param {{ entita?: string, operazione?: string }} [contesto={}]
 * @returns {RisultatoApi} risultato di errore normalizzato
 */
export function mappaErroreDb(err, contesto = {}) {
  if (!err) return errore("Si è verificato un errore imprevisto.");

  const code = err.code;
  const msg = (err.message || "").toLowerCase();
  const entita = contesto.entita || "il record";
  const operazione = contesto.operazione;

  // Violazione di unicità: tipicamente il codice prodotto (R1.6).
  if (code === SQLSTATE.UNIQUE_VIOLATION || msg.includes("duplicate key")) {
    if (msg.includes("codice")) {
      return errore("Esiste già un prodotto con questo codice.", { code });
    }
    return errore("Esiste già un record con questi valori.", { code });
  }

  // Violazione di chiave esterna.
  if (code === SQLSTATE.FOREIGN_KEY_VIOLATION || msg.includes("foreign key")) {
    // Su DELETE: il record è referenziato altrove (ON DELETE RESTRICT).
    // (punto di prelievo in uso R2.5, associazione in uso R3.5)
    if (operazione === "delete") {
      return errore(`Impossibile eliminare: ${entita} è in uso.`, { code });
    }
    // Su INSERT/UPDATE: il riferimento indicato non esiste (es. punto di
    // prelievo inesistente, R1.11).
    if (msg.includes("punto_di_prelievo")) {
      return errore("Il punto di prelievo indicato non esiste.", { code });
    }
    if (msg.includes("associazion")) {
      return errore("L'associazione indicata non esiste.", { code });
    }
    return errore("Riferimento non valido: il record collegato non esiste.", {
      code,
    });
  }

  // Violazione di CHECK di dominio (lunghezze, soglie, pezzi >= 1, ...).
  if (code === SQLSTATE.CHECK_VIOLATION || msg.includes("check constraint")) {
    return errore("Alcuni valori non rispettano i vincoli di validità.", {
      code,
    });
  }

  // Colonna obbligatoria mancante.
  if (code === SQLSTATE.NOT_NULL_VIOLATION || msg.includes("null value")) {
    return errore("Mancano uno o più campi obbligatori.", { code });
  }

  // Autorizzazione negata dalle policy RLS (nessuna riga scrivibile/leggibile).
  // PostgREST non espone un codice dedicato: il messaggio resta generico.
  if (msg.includes("row-level security") || msg.includes("permission denied")) {
    return errore("Operazione non consentita per il tuo ruolo.", { code });
  }

  // Fallback: non esponiamo il messaggio tecnico grezzo alla UI.
  return errore("Si è verificato un errore durante l'operazione.", { code });
}

export default { ok, errore, erroreValidazione, mappaErroreDb };
