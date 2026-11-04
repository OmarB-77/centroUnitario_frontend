// js/api/prodotti.js
//
// Layer API per l'anagrafica PRODOTTI (R1). Espone le operazioni CRUD verso la
// tabella `prodotti` tramite supabase-js (PostgREST). Le scritture sono protette
// lato DB da RLS (solo Admin/Power-user), CHECK di dominio, FK e trigger di
// audit: questo modulo valida PRIMA lato client per un feedback immediato (UX),
// ma la difesa reale resta nel database.
//
// Regole del layer:
//   - Nessuna stringa SQL costruita a mano: solo chiamate parametrizzate
//     supabase.from('prodotti')...
//   - Il client usa SOLO la anon key; i permessi sono applicati dalle policy RLS.
//   - Ogni funzione restituisce un risultato normalizzato { ok, data?, error?, errors? }.
//   - Nessun accesso al DOM: l'escape anti-XSS avviene nel layer UI.
//
// Mapping colonne DB (vedi migrazione 0002_anagrafiche.sql):
//   nome, codice, pezzi_per_confezione,
//   giacenza_minima_cu, giacenza_minima_armadi, intervallo_allerta_scadenza,
//   senza_scadenza, attivo, punto_di_prelievo_id,
//   posizioni → { cu_scaffale, cu_piano, armadio, armadio_scaffale } (colonne separate sul DB).
//
// Per comodità del layer UI le quattro colonne di posizione vengono raggruppate
// in input/output sotto `posizioni`; verso il DB vengono scritte come colonne
// singole (cu_scaffale, cu_piano, armadio, armadio_scaffale).

import { supabase } from "../supabaseClient.js";
import {
  validaNome,
  validaCodice,
  validaPezziPerConfezione,
  validaSogliaNonNegativa,
  validaIntervallo,
} from "../domain/validation.js";
import { ok, errore, erroreValidazione, mappaErroreDb } from "./_errori.js";

const TABELLA = "prodotti";

// Elenco esplicito delle colonne lette: evita SELECT * e rende stabile il mapping.
const COLONNE = [
  "id",
  "nome",
  "codice",
  "pezzi_per_confezione",
  "giacenza_minima_cu",
  "giacenza_minima_armadi",
  "intervallo_allerta_scadenza",
  "senza_scadenza",
  "attivo",
  "cu_scaffale",
  "cu_piano",
  "armadio",
  "armadio_scaffale",
  "punto_di_prelievo_id",
  "created_at",
  "created_by",
].join(", ");

/**
 * Converte un valore in intero se possibile, altrimenti lo restituisce invariato
 * (così la validazione a monte può segnalare il tipo errato).
 * @param {*} v
 * @returns {*}
 */
function aIntero(v) {
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return v;
}

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
 * Raggruppa le quattro colonne di posizione del DB in un oggetto `posizioni`.
 * @param {object} riga riga grezza da PostgREST
 * @returns {object} riga con `posizioni` aggregato
 */
function mappaRigaInUscita(riga) {
  if (!riga) return riga;
  const { cu_scaffale, cu_piano, armadio, armadio_scaffale, ...resto } = riga;
  return {
    ...resto,
    posizioni: { cu_scaffale, cu_piano, armadio, armadio_scaffale },
  };
}

/**
 * Valida lato client i campi anagrafici del prodotto comuni a create/update.
 * Replica i CHECK del DB (R1.7, R1.8, R1.9). L'unicità del codice (R1.6) e
 * l'esistenza del punto di prelievo (R1.11) sono verificate dal DB.
 * @param {object} dati dati del prodotto
 * @param {{ parziale?: boolean }} [opts] se parziale=true valida solo i campi presenti (update)
 * @returns {string[]} elenco errori (vuoto se valido)
 */
function validaDatiProdotto(dati, opts = {}) {
  const parziale = opts.parziale === true;
  const errori = [];
  const presente = (k) => Object.prototype.hasOwnProperty.call(dati, k);

  const aggiungi = (ris) => {
    if (ris && !ris.ok) errori.push(...ris.errors);
  };

  if (!parziale || presente("nome")) aggiungi(validaNome(dati.nome));
  if (!parziale || presente("codice")) aggiungi(validaCodice(dati.codice));
  if (!parziale || presente("pezzi_per_confezione")) {
    aggiungi(validaPezziPerConfezione(aIntero(dati.pezzi_per_confezione)));
  }
  if (!parziale || presente("giacenza_minima_cu")) {
    aggiungi(
      validaSogliaNonNegativa(
        aIntero(dati.giacenza_minima_cu),
        "La giacenza minima CU",
      ),
    );
  }
  if (!parziale || presente("giacenza_minima_armadi")) {
    aggiungi(
      validaSogliaNonNegativa(
        aIntero(dati.giacenza_minima_armadi),
        "La giacenza minima armadi",
      ),
    );
  }
  if (!parziale || presente("intervallo_allerta_scadenza")) {
    aggiungi(validaIntervallo(aIntero(dati.intervallo_allerta_scadenza)));
  }

  return errori;
}

/**
 * Costruisce la riga da inviare al DB a partire dai dati in ingresso, mappando
 * `posizioni` sulle colonne singole e normalizzando i tipi. created_at/created_by
 * sono gestiti dai trigger di audit lato DB (R1.10): NON vengono inviati dal client.
 * @param {object} dati dati del prodotto (eventualmente parziali per update)
 * @param {{ parziale?: boolean }} [opts]
 * @returns {object} riga pronta per insert/update
 */
function costruisciRiga(dati, opts = {}) {
  const parziale = opts.parziale === true;
  const presente = (k) => Object.prototype.hasOwnProperty.call(dati, k);
  const riga = {};

  const copiaTesto = (k) => {
    if (!parziale || presente(k)) riga[k] = String(dati[k]).trim();
  };
  const copiaIntero = (k) => {
    if (!parziale || presente(k)) riga[k] = aIntero(dati[k]);
  };
  const copiaBool = (k, def) => {
    if (presente(k)) riga[k] = Boolean(dati[k]);
    else if (!parziale && def !== undefined) riga[k] = def;
  };

  copiaTesto("nome");
  copiaTesto("codice");
  copiaIntero("pezzi_per_confezione");
  copiaIntero("giacenza_minima_cu");
  copiaIntero("giacenza_minima_armadi");
  copiaIntero("intervallo_allerta_scadenza");

  // R1.12: senza_scadenza default false alla creazione se non specificato.
  copiaBool("senza_scadenza", false);
  // attivo: default true alla creazione (il DB ha comunque DEFAULT true).
  copiaBool("attivo", true);

  // punto_di_prelievo_id è opzionale (R1.11): stringa vuota → null.
  if (!parziale || presente("punto_di_prelievo_id")) {
    riga.punto_di_prelievo_id = testoOpzionale(dati.punto_di_prelievo_id);
  }

  // Posizioni opzionali: accetta sia `posizioni: {...}` sia colonne singole.
  const pos = dati.posizioni || {};
  const assegnaPos = (chiaveOut, chiavePos) => {
    if (presente(chiaveOut)) {
      riga[chiaveOut] = testoOpzionale(dati[chiaveOut]);
    } else if (dati.posizioni && Object.prototype.hasOwnProperty.call(pos, chiavePos)) {
      riga[chiaveOut] = testoOpzionale(pos[chiavePos]);
    }
  };
  assegnaPos("cu_scaffale", "cu_scaffale");
  assegnaPos("cu_piano", "cu_piano");
  assegnaPos("armadio", "armadio");
  assegnaPos("armadio_scaffale", "armadio_scaffale");

  return riga;
}

/**
 * Restituisce l'elenco dei prodotti con tutti i campi di anagrafica (R1.3).
 * @param {{ attiviSolo?: boolean }} [opts] se attiviSolo=true filtra `attivo = true`
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaProdotti(opts = {}) {
  try {
    let query = supabase.from(TABELLA).select(COLONNE).order("nome", {
      ascending: true,
    });
    if (opts.attiviSolo === true) {
      query = query.eq("attivo", true);
    }
    const { data, error } = await query;
    if (error) return mappaErroreDb(error, { entita: "il prodotto" });
    return ok((data || []).map(mappaRigaInUscita));
  } catch (e) {
    return errore("Impossibile recuperare i prodotti.");
  }
}

/**
 * Restituisce un singolo prodotto per id (R1.3).
 * @param {string} id id del prodotto
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function getProdotto(id) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .select(COLONNE)
      .eq("id", id)
      .maybeSingle();
    if (error) return mappaErroreDb(error, { entita: "il prodotto" });
    if (!data) return errore("Prodotto non trovato.");
    return ok(mappaRigaInUscita(data));
  } catch (e) {
    return errore("Impossibile recuperare il prodotto.");
  }
}

/**
 * Crea un nuovo prodotto (R1.1). Valida i campi obbligatori lato client (R1.2,
 * R1.7, R1.8, R1.9) prima dell'invio; unicità codice (R1.6) e punto di prelievo
 * esistente (R1.11) sono verificati dal DB.
 * @param {object} dati dati del prodotto
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function creaProdotto(dati) {
  if (!dati || typeof dati !== "object") {
    return errore("Dati del prodotto mancanti.");
  }
  const errori = validaDatiProdotto(dati, { parziale: false });
  if (errori.length > 0) return erroreValidazione(errori);

  const riga = costruisciRiga(dati, { parziale: false });
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .insert(riga)
      .select(COLONNE)
      .single();
    if (error) {
      return mappaErroreDb(error, { entita: "il prodotto", operazione: "insert" });
    }
    return ok(mappaRigaInUscita(data));
  } catch (e) {
    return errore("Impossibile creare il prodotto.");
  }
}

/**
 * Aggiorna i campi di un prodotto esistente (R1.4). Valida solo i campi forniti
 * (update parziale). Non consente di modificare l'audit (gestito dal DB).
 * @param {string} id id del prodotto
 * @param {object} dati campi da aggiornare (sottoinsieme dell'anagrafica)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function aggiornaProdotto(id, dati) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }
  if (!dati || typeof dati !== "object") {
    return errore("Dati di aggiornamento mancanti.");
  }
  const errori = validaDatiProdotto(dati, { parziale: true });
  if (errori.length > 0) return erroreValidazione(errori);

  const riga = costruisciRiga(dati, { parziale: true });
  if (Object.keys(riga).length === 0) {
    return errore("Nessun campo da aggiornare.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .update(riga)
      .eq("id", id)
      .select(COLONNE)
      .single();
    if (error) {
      return mappaErroreDb(error, { entita: "il prodotto", operazione: "update" });
    }
    if (!data) return errore("Prodotto non trovato.");
    return ok(mappaRigaInUscita(data));
  } catch (e) {
    return errore("Impossibile aggiornare il prodotto.");
  }
}

/**
 * Imposta il flag `attivo` del prodotto (toggle soft, R1.5). La disattivazione
 * non elimina il record né le movimentazioni storiche: aggiorna solo il flag.
 * @param {string} id id del prodotto
 * @param {boolean} attivo nuovo stato del flag
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function impostaAttivo(id, attivo) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo prodotto mancante.");
  }
  if (typeof attivo !== "boolean") {
    return errore("Il valore del flag attivo deve essere booleano.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .update({ attivo })
      .eq("id", id)
      .select(COLONNE)
      .single();
    if (error) {
      return mappaErroreDb(error, { entita: "il prodotto", operazione: "update" });
    }
    if (!data) return errore("Prodotto non trovato.");
    return ok(mappaRigaInUscita(data));
  } catch (e) {
    return errore("Impossibile aggiornare lo stato del prodotto.");
  }
}

export default {
  listaProdotti,
  getProdotto,
  creaProdotto,
  aggiornaProdotto,
  impostaAttivo,
};
