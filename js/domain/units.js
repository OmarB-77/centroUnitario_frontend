// Logica di dominio pura: conversione tra unità di inserimento e unità base.
//
// Questo modulo NON ha effetti collaterali: niente DOM, niente rete, niente stato.
// È pensato per essere testabile in isolamento con Vitest + fast-check (vedi task 11.2).
//
// Contesto (design "Logica di conversione unità", R7.1/R7.13/R1.13/R1.14):
//   - L'operatore sceglie ESPLICITAMENTE l'unità con cui esprime la quantità al carico:
//       * 'unita_base'  -> quantità già in unità base, nessuna conversione.
//       * 'unita_carico'-> quantità in unità di carico, da moltiplicare per
//                          pezzi_per_confezione per ottenere l'unità base.
//   - pezzi_per_confezione è il numero di unità base contenute in una unità di carico
//     e vale almeno 1; quando unita_carico coincide con unita_base il fattore è 1 (R1.14).
//   - La quantità di movimento è un intero in [1, 999999] (R7.3/R9.3).
//
// Questa è la difesa client (UX/anteprima): il DB resta la difesa reale (CHECK, trigger).

/** Valori ammessi per l'unità di inserimento (enum `unita_inserimento` lato DB). */
export const UNITA_BASE = "unita_base";
export const UNITA_CARICO = "unita_carico";

/** Insieme delle unità di inserimento valide. */
export const UNITA_INSERIMENTO_VALIDE = Object.freeze([UNITA_BASE, UNITA_CARICO]);

/** Limiti della quantità di movimento in unità base (R7.3/R9.3). */
export const QUANTITA_MIN = 1;
export const QUANTITA_MAX = 999999;

/**
 * Verifica che un valore sia un intero finito (nessun float, NaN, Infinity, stringa…).
 * @param {unknown} v
 * @returns {boolean}
 */
function isInteroFinito(v) {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * Converte una quantità dall'unità di inserimento scelta dall'operatore all'unità base.
 *
 * Regola (design):
 *   - unita_inserimento === 'unita_base'   -> ritorna q (nessuna conversione, R7.13)
 *   - unita_inserimento === 'unita_carico' -> ritorna q * pezzi_per_confezione (R7.1)
 *   - con unita_carico === unita_base, pezzi_per_confezione vale 1 (R1.14)
 *
 * L'unità è obbligatoria e senza default (R7.11): un valore mancante o non ammesso
 * fa fallire la conversione con un errore chiaro.
 *
 * @param {number} quantita quantità intera in [1, 999999] espressa nell'unità scelta
 * @param {string} unitaInserimento 'unita_base' oppure 'unita_carico'
 * @param {number} pezziPerConfezione fattore di conversione, intero >= 1
 * @returns {number} quantità equivalente in unità base (intero >= 1)
 * @throws {Error} con messaggio in italiano se un input non è valido
 */
export function quantitaInBase(quantita, unitaInserimento, pezziPerConfezione) {
  // Unità: obbligatoria e senza default (R7.11/R7.12).
  if (unitaInserimento === undefined || unitaInserimento === null || unitaInserimento === "") {
    throw new Error("Selezionare l'unità di inserimento: la scelta è obbligatoria.");
  }
  if (!UNITA_INSERIMENTO_VALIDE.includes(unitaInserimento)) {
    throw new Error(
      `Unità di inserimento non valida: ammessi solo '${UNITA_BASE}' o '${UNITA_CARICO}'.`
    );
  }

  // Quantità: intero in [1, 999999] (R7.3/R9.3).
  if (!isInteroFinito(quantita)) {
    throw new Error("La quantità deve essere un numero intero.");
  }
  if (quantita < QUANTITA_MIN || quantita > QUANTITA_MAX) {
    throw new Error(
      `La quantità deve essere compresa tra ${QUANTITA_MIN} e ${QUANTITA_MAX}.`
    );
  }

  // Fattore di conversione: intero >= 1 (R1.8/R1.14).
  if (!isInteroFinito(pezziPerConfezione)) {
    throw new Error("Il numero di pezzi per confezione deve essere un numero intero.");
  }
  if (pezziPerConfezione < 1) {
    throw new Error("Il numero di pezzi per confezione deve essere almeno 1.");
  }

  // Nessuna conversione per l'unità base (R7.13).
  if (unitaInserimento === UNITA_BASE) {
    return quantita;
  }

  // Conversione per l'unità di carico (R7.1).
  return quantita * pezziPerConfezione;
}

/**
 * Converte una quantità espressa in unità di carico nell'equivalente in unità base.
 * Comodità esplicita quando l'unità è nota a monte; equivale a
 * quantitaInBase(quantita, 'unita_carico', pezziPerConfezione).
 *
 * @param {number} quantita quantità intera in [1, 999999] in unità di carico
 * @param {number} pezziPerConfezione fattore di conversione, intero >= 1
 * @returns {number} quantità equivalente in unità base
 * @throws {Error} con messaggio in italiano se un input non è valido
 */
export function caricoInBase(quantita, pezziPerConfezione) {
  return quantitaInBase(quantita, UNITA_CARICO, pezziPerConfezione);
}

export default { quantitaInBase, caricoInBase, UNITA_BASE, UNITA_CARICO };
