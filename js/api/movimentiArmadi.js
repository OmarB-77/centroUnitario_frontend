// js/api/movimentiArmadi.js
//
// Layer API per le movimentazioni degli ARMADI DI RIPRISTINO (R9). Espone:
//   - prelievoArmadi(...)      -> insert di un movimento 'prelievo' (R9.2).
//   - segnalazioneArmadi(...)  -> insert di un movimento 'segnalazione'
//                                 (quantita_base null, non altera la giacenza, R9.1).
//   - listaMovimentiArmadi(...) -> lettura (storico) dei movimenti armadi.
//
// Chi può scrivere: qualsiasi utente autenticato (prelievo/segnalazione) con
// created_by = auth.uid(), come da policy RLS (0005). Il carico automatico negli
// armadi NON si fa da qui: avviene solo dentro la RPC scarico_cu (0012) quando
// la destinazione è 'armadio_ripristino'.
//
// Regole del layer:
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate supabase.from(...).
//   - Solo anon key; i permessi reali sono applicati dalle policy RLS lato DB.
//   - Validazione client PRIMA dell'invio (UX), mai come unica difesa: CHECK
//     (quantità coerente col tipo) e trigger (audit, anti-negativa sul prelievo)
//     restano la barriera reale.
//   - Risultato normalizzato { ok, data?, error?, errors?, code? }; nessun DOM.
//
// Mapping colonne DB (registro_movimentazioni_armadi, migrazione 0003):
//   prodotto_id, tipo ('prelievo' | 'segnalazione' | 'carico_automatico'),
//   quantita_base (>=1 per prelievo/carico_automatico; NULL per segnalazione),
//   mov_cu_origine_id (solo per carico_automatico). created_at/created_by sono
//   gestiti dai trigger di audit (0006): NON inviati dal client.

import { supabase } from "../supabaseClient.js";
import { validaQuantita } from "../domain/validation.js";
import { ok, errore, erroreValidazione, mappaErroreDb } from "./_errori.js";

const TABELLA = "registro_movimentazioni_armadi";
const ENTITA = "il movimento dell'armadio di ripristino";

// Colonne lette nello storico: evita SELECT * e stabilizza il contratto.
const COLONNE = [
  "id",
  "prodotto_id",
  "tipo",
  "quantita_base",
  "mov_cu_origine_id",
  "created_at",
  "created_by",
].join(", ");

/**
 * Registra un PRELIEVO dagli armadi di ripristino (R9.2). La quantità è in
 * unità base, intero in [1, 999999] (R9.3). Il trigger anti-negativa (0008)
 * rifiuta il prelievo se porterebbe la giacenza armadi sotto zero (R9.5): il
 * controllo lato client resta un aiuto UX, non la difesa reale.
 *
 * @param {Object} params
 * @param {string} params.prodottoId id del prodotto
 * @param {number} params.quantitaBase quantità prelevata in unità base (intero >= 1)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function prelievoArmadi({ prodottoId, quantitaBase } = {}) {
  if (typeof prodottoId !== "string" || prodottoId.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }

  const vQta = validaQuantita(quantitaBase);
  if (!vQta.ok) return erroreValidazione(vQta.errors);

  const riga = {
    prodotto_id: prodottoId,
    tipo: "prelievo",
    quantita_base: quantitaBase,
  };

  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .insert(riga)
      .select(COLONNE)
      .single();
    if (error) return mappaErroreDb(error, { entita: ENTITA, operazione: "insert" });
    return ok(data);
  } catch (e) {
    return errore("Impossibile registrare il prelievo dall'armadio di ripristino.");
  }
}

/**
 * Registra una SEGNALAZIONE di prodotto carente/mancante negli armadi (R9.1).
 * La segnalazione non movimenta la giacenza: `quantita_base` è null (coerente
 * col CHECK mov_armadi_quantita_tipo_chk della migrazione 0003).
 *
 * @param {Object} params
 * @param {string} params.prodottoId id del prodotto
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function segnalazioneArmadi({ prodottoId } = {}) {
  if (typeof prodottoId !== "string" || prodottoId.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }

  const riga = {
    prodotto_id: prodottoId,
    tipo: "segnalazione",
    quantita_base: null,
  };

  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .insert(riga)
      .select(COLONNE)
      .single();
    if (error) return mappaErroreDb(error, { entita: ENTITA, operazione: "insert" });
    return ok(data);
  } catch (e) {
    return errore("Impossibile registrare la segnalazione dell'armadio di ripristino.");
  }
}

/**
 * Restituisce lo storico delle movimentazioni degli armadi di ripristino, in
 * ordine cronologico decrescente. Lettura opzionale di supporto alla UI.
 *
 * @param {{ prodottoId?: string }} [opts] filtro opzionale per prodotto
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaMovimentiArmadi({ prodottoId } = {}) {
  try {
    let query = supabase
      .from(TABELLA)
      .select(COLONNE)
      .order("created_at", { ascending: false });
    if (typeof prodottoId === "string" && prodottoId.trim() !== "") {
      query = query.eq("prodotto_id", prodottoId);
    }
    const { data, error } = await query;
    if (error) return mappaErroreDb(error, { entita: ENTITA });
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare i movimenti degli armadi di ripristino.");
  }
}

export default { prelievoArmadi, segnalazioneArmadi, listaMovimentiArmadi };
