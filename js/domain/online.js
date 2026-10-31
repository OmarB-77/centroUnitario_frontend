// Logica di dominio pura: predicato "is-online" per l'health-check della PWA.
//
// Questo modulo NON ha effetti collaterali: niente DOM, niente rete, niente stato.
// È pensato per essere testabile in isolamento con Vitest (vedi task 11.15).
//
// Contesto (design "Strategia offline / PWA", R16.4):
//   Il banner "offline" deve basarsi su un health-check realistico. Il punto chiave è:
//   una risposta HTTP da Supabase — ANCHE un 401/403 o un qualsiasi 4xx/5xx —
//   significa che il server è RAGGIUNGIBILE, quindi lo stato è "online".
//   Solo un errore di rete / timeout / abort (nessuna risposta HTTP) indica "offline".
//
// L'input è modellato come una piccola forma discriminata per renderlo facile da testare:
//   - { type: 'response', status }  -> il server ha risposto con uno status HTTP
//   - { type: 'error', error }      -> errore di rete / timeout / abort (nessuna risposta)

/** Discriminante per un esito in cui il server ha risposto con uno status HTTP. */
export const ESITO_RISPOSTA = "response";
/** Discriminante per un esito di errore di rete / timeout / abort. */
export const ESITO_ERRORE = "error";

/**
 * Verifica se un valore è uno status HTTP plausibile (intero finito in [100, 599]).
 * @param {unknown} status
 * @returns {boolean}
 */
function isStatusHttpValido(status) {
  return (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  );
}

/**
 * Classifica online/offline a partire da un oggetto simile a una fetch Response.
 *
 * Regola (R16.4): se il server ha prodotto uno status HTTP — qualunque esso sia,
 * incluso 401/403 e ogni altro 4xx/5xx — il server è raggiungibile ⇒ "online" (true).
 *
 * @param {{ status?: number }} response oggetto con almeno la proprietà `status`
 * @returns {boolean} true se il server è raggiungibile (online), false altrimenti
 */
export function isOnlineFromResponse(response) {
  if (response === null || response === undefined) {
    return false;
  }
  return isStatusHttpValido(response.status);
}

/**
 * Classifica online/offline a partire da un esito discriminato dell'health-check.
 *
 * Forma dell'input:
 *   - { type: 'response', status }  -> qualsiasi status HTTP valido ⇒ online (true),
 *                                       incluso 401/403 (server raggiungibile, R16.4)
 *   - { type: 'error', error }      -> errore di rete / timeout / abort ⇒ offline (false)
 *
 * Tolleranza: un input nullo, malformato o con tipo sconosciuto è trattato come
 * "offline" (false), perché non possiamo confermare la raggiungibilità del server.
 *
 * @param {{ type?: string, status?: number, error?: unknown }} esito
 * @returns {boolean} true se online, false se offline
 */
export function classify(esito) {
  if (esito === null || typeof esito !== "object") {
    return false;
  }

  switch (esito.type) {
    case ESITO_RISPOSTA:
      // Una risposta HTTP valida (anche 4xx/5xx) significa server raggiungibile.
      return isStatusHttpValido(esito.status);
    case ESITO_ERRORE:
      // Errore di rete / timeout / abort: nessuna risposta ⇒ offline.
      return false;
    default:
      // Tipo mancante o sconosciuto: non possiamo affermare "online".
      return false;
  }
}

/**
 * Classifica online/offline a partire da un esito "piatto" dell'health-check,
 * comodo quando si dispone già di { ok, status, error } senza discriminante.
 *
 * Regola:
 *   - se è presente uno `status` HTTP valido ⇒ online (true), incluso 401/403;
 *   - altrimenti, se è presente un `error` (rete/timeout/abort) ⇒ offline (false);
 *   - casi ambigui o input mancante ⇒ offline (false).
 *
 * @param {{ ok?: boolean, status?: number, error?: unknown }} esito
 * @returns {boolean} true se online, false se offline
 */
export function isOnlineFromOutcome(esito) {
  if (esito === null || typeof esito !== "object") {
    return false;
  }
  if (isStatusHttpValido(esito.status)) {
    return true;
  }
  // Nessuno status HTTP: se c'è un errore è un problema di rete ⇒ offline;
  // in ogni altro caso non possiamo confermare la raggiungibilità ⇒ offline.
  return false;
}

export default {
  ESITO_RISPOSTA,
  ESITO_ERRORE,
  isOnlineFromResponse,
  isOnlineFromOutcome,
  classify,
};
