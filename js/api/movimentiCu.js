// js/api/movimentiCu.js
//
// Layer API per le movimentazioni del CENTRO UNITARIO (R7, R8). Espone:
//   - caricoCu(...)        -> insert diretto di un movimento 'carico' su
//                             registro_movimentazioni_cu (R7.x).
//   - scaricoCu(...)       -> chiamata alla funzione RPC atomica scarico_cu
//                             (R8.x): scarico CU e, se destinazione
//                             armadio_ripristino, carico automatico armadi in
//                             un'unica transazione lato DB.
//   - listaMovimentiCu(...) -> lettura (storico) dei movimenti CU.
//
// Regole del layer (coerenti con gli altri moduli API):
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate
//     supabase.from(...)/supabase.rpc(...).
//   - Il client usa SOLO la anon key; i permessi reali sono applicati dalle
//     policy RLS lato DB e dall'autorizzazione difensiva della RPC.
//   - Validazione client PRIMA dell'invio (UX), MAI come unica difesa: CHECK,
//     trigger (audit, scadenza effettiva, anti-negativa) e RPC restano la
//     barriera reale.
//   - Ogni funzione restituisce un risultato normalizzato
//     { ok, data?, error?, errors?, code? }.
//   - Nessun accesso al DOM: l'escape anti-XSS avviene nel layer UI.
//
// Mapping colonne/parametri DB:
//   - registro_movimentazioni_cu (migrazione 0003): prodotto_id, tipo,
//     quantita_base, unita_inserimento, lotto?, data_scadenza?,
//     data_produzione?, data_scadenza_effettiva?, destinazione?,
//     dettaglio_destinazione_associazione_id?, dettaglio_destinazione_testo?.
//     created_at/created_by sono gestiti dai trigger di audit (0006): NON
//     inviati dal client. data_scadenza_effettiva per il carico è calcolata dal
//     trigger 0007; il client può passare un override quando fornito (R7.8).
//   - RPC scarico_cu (migrazione 0012): parametri p_prodotto_id,
//     p_quantita_base, p_lotto, p_destinazione, p_associazione_id, p_testo_altro.

import { supabase } from "../supabaseClient.js";
import { quantitaInBase } from "../domain/units.js";
import {
  validaQuantita,
  validaUnitaInserimento,
  validaDestinazione,
} from "../domain/validation.js";
import { ok, errore, erroreValidazione, mappaErroreDb } from "./_errori.js";

const TABELLA = "registro_movimentazioni_cu";
const ENTITA = "il movimento del centro unitario";

// Colonne lette nello storico: evita SELECT * e stabilizza il contratto.
const COLONNE = [
  "id",
  "prodotto_id",
  "tipo",
  "quantita_base",
  "unita_inserimento",
  "lotto",
  "data_scadenza",
  "data_produzione",
  "data_scadenza_effettiva",
  "destinazione",
  "dettaglio_destinazione_associazione_id",
  "dettaglio_destinazione_testo",
  "created_at",
  "created_by",
].join(", ");

/**
 * Normalizza una stringa opzionale: trim; stringa vuota → null (campo assente).
 * @param {*} v
 * @returns {string|null}
 */
function testoOpzionale(v) {
  if (typeof v !== "string") return v == null ? null : v;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Registra un CARICO nel Centro Unitario (R7.1, R7.2, R7.3, R7.13).
 *
 * La quantità viene convertita in unità base lato client tramite
 * quantitaInBase (R7.1/R7.13); la conversione valida anche la quantità e il
 * fattore pezzi_per_confezione. L'unità di inserimento è obbligatoria e senza
 * default (R7.11). data_scadenza_effettiva è normalmente calcolata dal trigger
 * DB 0007 in base al flag `senza_scadenza` del prodotto; quando l'operatore
 * fornisce un override per un prodotto senza scadenza (R7.8) lo si passa come
 * valore esplicito.
 *
 * @param {Object} params
 * @param {string} params.prodottoId id del prodotto
 * @param {number} params.quantita quantità espressa nell'unità scelta (intero >= 1)
 * @param {string} params.unitaInserimento 'unita_base' | 'unita_carico'
 * @param {number} params.pezziPerConfezione fattore di conversione (intero >= 1)
 * @param {string} [params.lotto] lotto opzionale (R7.2)
 * @param {string} [params.dataScadenza] data di scadenza 'YYYY-MM-DD' (prodotti con scadenza)
 * @param {string} [params.dataProduzione] data di produzione 'YYYY-MM-DD' (prodotti senza scadenza)
 * @param {string} [params.dataScadenzaEffettivaOverride] scadenza effettiva imposta dall'operatore (R7.8)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function caricoCu({
  prodottoId,
  quantita,
  unitaInserimento,
  pezziPerConfezione,
  lotto,
  dataScadenza,
  dataProduzione,
  dataScadenzaEffettivaOverride,
} = {}) {
  if (typeof prodottoId !== "string" || prodottoId.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }

  // Unità di inserimento: obbligatoria e senza default (R7.11, R7.12).
  const vUnita = validaUnitaInserimento(unitaInserimento);
  if (!vUnita.ok) return erroreValidazione(vUnita.errors);

  // Quantità inserita: intero in [1, 999999] (R7.3).
  const vQta = validaQuantita(quantita);
  if (!vQta.ok) return erroreValidazione(vQta.errors);

  // Conversione in unità base (R7.1/R7.13). quantitaInBase valida anche
  // pezziPerConfezione e rilancia un errore chiaro in italiano.
  let quantitaBase;
  try {
    quantitaBase = quantitaInBase(quantita, unitaInserimento, pezziPerConfezione);
  } catch (e) {
    return erroreValidazione([e && e.message ? e.message : "Quantità non valida."]);
  }

  // La quantità convertita deve restare nei limiti del dominio (R7.3): la
  // conversione in unità di carico può superare 999999 anche con input validi.
  const vQtaBase = validaQuantita(quantitaBase);
  if (!vQtaBase.ok) return erroreValidazione(vQtaBase.errors);

  const riga = {
    prodotto_id: prodottoId,
    tipo: "carico",
    quantita_base: quantitaBase,
    unita_inserimento: unitaInserimento,
    lotto: testoOpzionale(lotto),
    data_scadenza: testoOpzionale(dataScadenza),
    data_produzione: testoOpzionale(dataProduzione),
  };

  // Override della scadenza effettiva: solo se fornito. In assenza, il trigger
  // DB 0007 calcola data_scadenza_effettiva (R7.1/R7.7/R7.8).
  const override = testoOpzionale(dataScadenzaEffettivaOverride);
  if (override !== null) {
    riga.data_scadenza_effettiva = override;
  }

  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .insert(riga)
      .select(COLONNE)
      .single();
    if (error) return mappaErroreDb(error, { entita: ENTITA, operazione: "insert" });
    return ok(data);
  } catch (e) {
    return errore("Impossibile registrare il carico nel centro unitario.");
  }
}

/**
 * Registra uno SCARICO dal Centro Unitario tramite la funzione RPC atomica
 * `scarico_cu` (R8.2, R8.5, R8.7). La RPC esegue in un'unica transazione lo
 * scarico CU e — solo per destinazione 'armadio_ripristino' — il carico
 * automatico negli armadi (R8.5), garantendo atomicità e rollback (R8.6).
 *
 * La quantità è già attesa in UNITÀ BASE (lo scarico seleziona un lotto, non
 * applica conversioni). Destinazione e dettaglio vengono validati lato client
 * PRIMA della chiamata (R8.10/R8.11/R8.12); la RPC ripete comunque la
 * validazione come difesa reale.
 *
 * @param {Object} params
 * @param {string} params.prodottoId id del prodotto
 * @param {number} params.quantitaBase quantità in unità base (intero >= 1)
 * @param {string} [params.lotto] lotto selezionato (null/omesso = "senza lotto")
 * @param {string} params.destinazione 'armadio_ripristino' | 'associazione' | 'altro'
 * @param {string} [params.associazioneId] id associazione (obbligatorio per 'associazione')
 * @param {string} [params.testoAltro] testo libero (consentito per 'altro', max 500)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function scaricoCu({
  prodottoId,
  quantitaBase,
  lotto,
  destinazione,
  associazioneId,
  testoAltro,
} = {}) {
  if (typeof prodottoId !== "string" || prodottoId.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }

  // Quantità in unità base: intero in [1, 999999] (R8.4).
  const vQta = validaQuantita(quantitaBase);
  if (!vQta.ok) return erroreValidazione(vQta.errors);

  // Coerenza destinazione/dettaglio (R8.10/R8.11/R8.12).
  const vDest = validaDestinazione(destinazione, { associazioneId, testoAltro });
  if (!vDest.ok) return erroreValidazione(vDest.errors);

  // Parametri della RPC (migrazione 0012). Il dettaglio non pertinente alla
  // destinazione viene inviato come null: la RPC lo valorizza solo dove serve.
  const params = {
    p_prodotto_id: prodottoId,
    p_quantita_base: quantitaBase,
    p_lotto: testoOpzionale(lotto),
    p_destinazione: destinazione,
    p_associazione_id:
      destinazione === "associazione" ? testoOpzionale(associazioneId) : null,
    p_testo_altro: destinazione === "altro" ? testoOpzionale(testoAltro) : null,
  };

  try {
    const { data, error } = await supabase.rpc("scarico_cu", params);
    if (error) {
      // La RPC può sollevare check_violation (quantità/destinazione/giacenza
      // insufficiente dal trigger anti-negativa) o insufficient_privilege: il
      // mapping le traduce in messaggi italiani per la UI.
      return mappaErroreDb(error, { entita: ENTITA, operazione: "insert" });
    }
    // scarico_cu RETURNS void: in caso di successo non c'è payload significativo.
    return ok(data ?? null);
  } catch (e) {
    return errore("Impossibile registrare lo scarico dal centro unitario.");
  }
}

/**
 * Restituisce lo storico delle movimentazioni del Centro Unitario, in ordine
 * cronologico decrescente. Lettura opzionale di supporto alla UI (R8.x).
 *
 * @param {{ prodottoId?: string }} [opts] filtro opzionale per prodotto
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaMovimentiCu({ prodottoId } = {}) {
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
    return errore("Impossibile recuperare i movimenti del centro unitario.");
  }
}

export default { caricoCu, scaricoCu, listaMovimentiCu };
