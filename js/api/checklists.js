// js/api/checklists.js
//
// Layer API per le tre CHECK-LIST (R11, R12, R13) e per la spunta "ordine
// effettuato" della carenza CU (R11.2). Legge le viste derivate del DB tramite
// supabase-js (PostgREST) e registra lo stato dell'ordine con un upsert sulla
// tabella `stato_ordini_carenza_cu`.
//
// Principi del layer:
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate supabase.from(...).
//   - Il client usa SOLO la anon key; i permessi sono applicati dalle policy RLS
//     (le viste ereditano la sicurezza delle tabelle sottostanti: le check-list
//     sono interrogabili solo da Admin/Power-user).
//   - Ogni funzione restituisce un risultato normalizzato { ok, data?, error? }.
//   - Nessun accesso al DOM: l'escape anti-XSS avviene nel layer UI.
//
// Viste lette (vedi migrazioni 0010/0011):
//   - check_list_carenza_cu     → prodotti attivi con giacenza_cu < giacenza_minima_cu
//                                  (include punto di prelievo e flag `ordinato`), R11.1/R11.3
//   - check_list_carenza_armadi → prodotti attivi con giacenza_armadi < giacenza_minima_armadi, R12.1
//   - check_list_scadenza       → lotti di prodotti attivi con giacenza residua > 0 e
//                                  (data_scadenza_effettiva - oggi) < intervallo_allerta, R13.1
//
// Spunta ordine CU (R11.2): `stato_ordini_carenza_cu` ha UNIQUE(prodotto_id),
// quindi la spunta è uno STATO (non uno storico): si usa un upsert con
// onConflict su `prodotto_id`. La rimozione dalla check-list resta comunque
// guidata dalla giacenza (R11.3): la spunta registra solo che l'ordine è stato
// effettuato, non fa sparire la riga.

import { supabase } from "../supabaseClient.js";
import { ok, errore, mappaErroreDb } from "./_errori.js";

const VISTA_CARENZA_CU = "check_list_carenza_cu";
const VISTA_CARENZA_ARMADI = "check_list_carenza_armadi";
const VISTA_SCADENZA = "check_list_scadenza";
const TABELLA_STATO_ORDINI = "stato_ordini_carenza_cu";

// Colonne esposte da ciascuna vista (evita SELECT * e stabilizza il mapping).
const COLONNE_CARENZA_CU = [
  "prodotto_id",
  "nome",
  "codice",
  "giacenza",
  "giacenza_minima_cu",
  "punto_di_prelievo_id",
  "punto_di_prelievo_nome",
  "ordinato",
].join(", ");

const COLONNE_CARENZA_ARMADI = [
  "prodotto_id",
  "nome",
  "codice",
  "giacenza",
  "giacenza_minima_armadi",
].join(", ");

const COLONNE_SCADENZA = [
  "prodotto_id",
  "nome",
  "codice",
  "lotto",
  "data_scadenza_effettiva",
  "giacenza_lotto",
].join(", ");

/**
 * Check-list carenza Centro Unitario (R11.1): prodotti attivi con giacenza CU
 * sotto la soglia minima, con punto di prelievo associato e flag `ordinato`
 * della spunta (quando presente; NULL/`null` se mai registrata).
 * Ordinata per nome prodotto.
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaCarenzaCu() {
  try {
    const { data, error } = await supabase
      .from(VISTA_CARENZA_CU)
      .select(COLONNE_CARENZA_CU)
      .order("nome", { ascending: true });
    if (error) {
      return mappaErroreDb(error, { entita: "la check-list carenza CU" });
    }
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare la check-list carenza CU.");
  }
}

/**
 * Check-list carenza Armadi di Ripristino (R12.1): prodotti attivi con giacenza
 * armadi sotto la soglia minima. Nessuna spunta (R12.3): la rimozione è guidata
 * dalla giacenza (tipicamente per effetto del carico automatico, R12.2).
 * Ordinata per nome prodotto.
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaCarenzaArmadi() {
  try {
    const { data, error } = await supabase
      .from(VISTA_CARENZA_ARMADI)
      .select(COLONNE_CARENZA_ARMADI)
      .order("nome", { ascending: true });
    if (error) {
      return mappaErroreDb(error, { entita: "la check-list carenza armadi" });
    }
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare la check-list carenza armadi.");
  }
}

/**
 * Check-list prossima scadenza per LOTTO (R13.1): lotti di prodotti attivi con
 * giacenza residua del lotto > 0 e differenza tra scadenza effettiva e oggi
 * inferiore all'intervallo di allerta del prodotto. Nessuna spunta (R13.3).
 * Ordinata per data di scadenza effettiva crescente (le più imminenti prima).
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaScadenza() {
  try {
    const { data, error } = await supabase
      .from(VISTA_SCADENZA)
      .select(COLONNE_SCADENZA)
      .order("data_scadenza_effettiva", { ascending: true });
    if (error) {
      return mappaErroreDb(error, { entita: "la check-list scadenza" });
    }
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare la check-list scadenza.");
  }
}

/**
 * Registra (o aggiorna) la spunta "ordine effettuato" per un prodotto in
 * carenza CU (R11.2). Essendo `stato_ordini_carenza_cu` univoca per
 * `prodotto_id`, si usa un upsert con onConflict: una sola riga di stato per
 * prodotto. created_at/created_by sono gestiti dai trigger di audit lato DB:
 * NON vengono inviati dal client.
 *
 * NOTA (R11.3): la spunta registra soltanto che l'ordine ai punti di prelievo è
 * stato effettuato; la rimozione del prodotto dalla check-list resta guidata
 * dalla giacenza (quando giacenza_cu >= giacenza_minima_cu la riga esce dalla
 * vista, indipendentemente dalla spunta).
 *
 * @param {string} prodottoId id del prodotto in carenza CU
 * @param {boolean} [ordinato=true] stato della spunta (true = ordine effettuato)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function impostaOrdinato(prodottoId, ordinato = true) {
  if (typeof prodottoId !== "string" || prodottoId.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }
  if (typeof ordinato !== "boolean") {
    return errore("Il valore della spunta deve essere booleano.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA_STATO_ORDINI)
      .upsert(
        { prodotto_id: prodottoId, ordinato },
        { onConflict: "prodotto_id" },
      )
      .select("id, prodotto_id, ordinato, created_at, created_by")
      .single();
    if (error) {
      return mappaErroreDb(error, {
        entita: "lo stato ordine",
        operazione: "insert",
      });
    }
    return ok(data);
  } catch (e) {
    return errore("Impossibile aggiornare lo stato dell'ordine.");
  }
}

export default {
  listaCarenzaCu,
  listaCarenzaArmadi,
  listaScadenza,
  impostaOrdinato,
};
