// js/api/giacenze.js
//
// Layer API in SOLA LETTURA per le giacenze (R10). Espone:
//   - giacenzaCu(prodottoId?)      -> legge la vista giacenza_cu (R10.1/R10.2).
//   - giacenzaArmadi(prodottoId?)  -> legge la vista giacenza_armadi (R10.3).
//   - lottiDisponibili(prodottoId) -> calcola la giacenza residua per LOTTO del
//                                     Centro Unitario (per il selettore lotto in
//                                     fase di scarico), restituendo solo i lotti
//                                     con giacenza > 0 e la loro scadenza effettiva.
//
// Le viste giacenza_cu/giacenza_armadi (migrazione 0009) sono la fonte derivata
// delle giacenze a partire dai registri (append-only). Ereditano la RLS dalle
// tabelle sottostanti: sono leggibili dagli utenti autorizzati.
//
// Per i LOTTI non esiste una vista dedicata di giacenza-per-lotto: il residuo
// per lotto si ricava leggendo i movimenti CU del prodotto e riducendoli con il
// MODELLO DI DOMINIO PURO js/domain/giacenze.js (giacenzaCu.perLotto /
// giacenzaLotto), che è il mirror client della logica delle viste. Si mantiene
// così un'unica fonte di verità di calcolo tra client e DB.
//
// Regole del layer:
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate supabase.from(...).
//   - Solo anon key; RLS applica i permessi.
//   - Risultato normalizzato { ok, data?, error?, code? }; nessun DOM.

import { supabase } from "../supabaseClient.js";
import { giacenzaCu as modelloGiacenzaCu } from "../domain/giacenze.js";
import { ok, errore, mappaErroreDb } from "./_errori.js";

const VISTA_CU = "giacenza_cu";
const VISTA_ARMADI = "giacenza_armadi";
const TABELLA_MOV_CU = "registro_movimentazioni_cu";

// Colonne delle viste di giacenza (0009): prodotto_id + giacenza.
const COLONNE_VISTA = "prodotto_id, giacenza";

// Colonne dei movimenti CU necessarie al calcolo del residuo per lotto.
const COLONNE_MOV_CU_LOTTO =
  "prodotto_id, tipo, quantita_base, lotto, data_scadenza_effettiva";

/**
 * Legge la giacenza del Centro Unitario dalla vista giacenza_cu (R10.1/R10.2).
 * Senza argomento restituisce l'elenco di tutti i prodotti; con `prodottoId`
 * restituisce la singola riga di giacenza del prodotto.
 *
 * @param {string} [prodottoId] id del prodotto; se omesso restituisce tutte le righe
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 *          data: Array<{prodotto_id, giacenza}> oppure {prodotto_id, giacenza}
 */
export async function giacenzaCu(prodottoId) {
  try {
    if (typeof prodottoId === "string" && prodottoId.trim() !== "") {
      const { data, error } = await supabase
        .from(VISTA_CU)
        .select(COLONNE_VISTA)
        .eq("prodotto_id", prodottoId)
        .maybeSingle();
      if (error) return mappaErroreDb(error, { entita: "la giacenza del centro unitario" });
      // Prodotto senza riga in vista (inatteso: la vista parte da prodotti) → 0.
      return ok(data || { prodotto_id: prodottoId, giacenza: 0 });
    }
    const { data, error } = await supabase
      .from(VISTA_CU)
      .select(COLONNE_VISTA)
      .order("prodotto_id", { ascending: true });
    if (error) return mappaErroreDb(error, { entita: "la giacenza del centro unitario" });
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare la giacenza del centro unitario.");
  }
}

/**
 * Legge la giacenza degli armadi di ripristino dalla vista giacenza_armadi
 * (R10.3). Senza argomento restituisce tutti i prodotti; con `prodottoId` la
 * singola riga.
 *
 * @param {string} [prodottoId] id del prodotto; se omesso restituisce tutte le righe
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 *          data: Array<{prodotto_id, giacenza}> oppure {prodotto_id, giacenza}
 */
export async function giacenzaArmadi(prodottoId) {
  try {
    if (typeof prodottoId === "string" && prodottoId.trim() !== "") {
      const { data, error } = await supabase
        .from(VISTA_ARMADI)
        .select(COLONNE_VISTA)
        .eq("prodotto_id", prodottoId)
        .maybeSingle();
      if (error) return mappaErroreDb(error, { entita: "la giacenza degli armadi" });
      return ok(data || { prodotto_id: prodottoId, giacenza: 0 });
    }
    const { data, error } = await supabase
      .from(VISTA_ARMADI)
      .select(COLONNE_VISTA)
      .order("prodotto_id", { ascending: true });
    if (error) return mappaErroreDb(error, { entita: "la giacenza degli armadi" });
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare la giacenza degli armadi.");
  }
}

/**
 * Calcola i LOTTI disponibili di un prodotto nel Centro Unitario, per il
 * selettore lotto in fase di scarico (R8.x). Legge i movimenti CU del prodotto
 * e ne deriva la giacenza residua per lotto riusando il modello di dominio puro
 * (giacenzaCu.perLotto): restituisce solo i lotti con giacenza > 0, con la
 * relativa data_scadenza_effettiva (presa dal movimento di carico del lotto,
 * coerente con la logica della RPC scarico_cu).
 *
 * Il confronto sul lotto è null-safe nel modello di dominio: il gruppo "senza
 * lotto" (lotto null) è un lotto a sé.
 *
 * @param {string} prodottoId id del prodotto
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 *          data: Array<{ lotto: string|null, giacenza: number, data_scadenza_effettiva: string|null }>
 */
export async function lottiDisponibili(prodottoId) {
  if (typeof prodottoId !== "string" || prodottoId.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA_MOV_CU)
      .select(COLONNE_MOV_CU_LOTTO)
      .eq("prodotto_id", prodottoId)
      .order("created_at", { ascending: true });
    if (error) {
      return mappaErroreDb(error, { entita: "i lotti disponibili" });
    }

    const movimenti = data || [];

    // Giacenza residua per lotto tramite il modello di dominio (mirror delle viste).
    const { perLotto } = modelloGiacenzaCu(movimenti);

    // Scadenza effettiva per lotto: dal carico di riferimento del lotto, come
    // in scarico_cu (il carico più vecchio del lotto). I movimenti sono già
    // ordinati per created_at crescente, quindi il primo carico trovato per il
    // lotto è quello di riferimento.
    const scadenzaPerLotto = new Map(); // chiave lotto normalizzata → scadenza
    const chiave = (l) => (l === null || l === undefined || l === "" ? "\u0000__NULL__" : `s:${l}`);
    for (const mov of movimenti) {
      if (mov.tipo !== "carico") continue;
      const k = chiave(mov.lotto);
      if (!scadenzaPerLotto.has(k)) {
        scadenzaPerLotto.set(k, mov.data_scadenza_effettiva ?? null);
      }
    }

    const lotti = perLotto
      .filter((l) => l.giacenza > 0)
      .map((l) => ({
        lotto: l.lotto,
        giacenza: l.giacenza,
        data_scadenza_effettiva: scadenzaPerLotto.get(chiave(l.lotto)) ?? null,
      }));

    return ok(lotti);
  } catch (e) {
    return errore("Impossibile recuperare i lotti disponibili.");
  }
}

export default { giacenzaCu, giacenzaArmadi, lottiDisponibili };
