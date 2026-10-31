// js/api/associazioni.js
//
// Layer API per l'anagrafica ASSOCIAZIONI (R3). CRUD verso la tabella
// `associazioni` tramite supabase-js (PostgREST), protetto lato DB da RLS
// (scrittura solo Admin/Power-user), CHECK sul nome (1..200) e audit.
//
// Note:
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate supabase.from(...).
//   - Validazione client del nome PRIMA dell'invio (R3.2); limite/obbligatorietà
//     sono comunque garantiti dai CHECK del DB.
//   - L'eliminazione di un'associazione referenziata da un movimento di scarico
//     è bloccata dal DB (ON DELETE RESTRICT): l'errore FK viene tradotto in
//     "in uso" (R3.5).
//   - created_at/created_by sono gestiti dai trigger di audit: non inviati dal client.
//
// Mapping colonne DB: nome, note.

import { supabase } from "../supabaseClient.js";
import { validaNome } from "../domain/validation.js";
import { ok, errore, erroreValidazione, mappaErroreDb } from "./_errori.js";

const TABELLA = "associazioni";
const COLONNE = "id, nome, note, created_at, created_by";
const ENTITA = "l'associazione";

/**
 * Normalizza un campo di testo opzionale: trim; vuoto → null.
 * @param {*} v
 * @returns {string|null}
 */
function testoOpzionale(v) {
  if (typeof v !== "string") return v == null ? null : v;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Restituisce l'elenco delle associazioni (R3.3).
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaAssociazioni() {
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .select(COLONNE)
      .order("nome", { ascending: true });
    if (error) return mappaErroreDb(error, { entita: ENTITA });
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare le associazioni.");
  }
}

/**
 * Restituisce una singola associazione per id.
 * @param {string} id
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function getAssociazione(id) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo associazione mancante.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .select(COLONNE)
      .eq("id", id)
      .maybeSingle();
    if (error) return mappaErroreDb(error, { entita: ENTITA });
    if (!data) return errore("Associazione non trovata.");
    return ok(data);
  } catch (e) {
    return errore("Impossibile recuperare l'associazione.");
  }
}

/**
 * Crea un'associazione indicando almeno il nome (R3.1). Valida il nome lato
 * client (R3.2).
 * @param {{ nome: string, note?: string }} dati
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function creaAssociazione(dati) {
  if (!dati || typeof dati !== "object") {
    return errore("Dati dell'associazione mancanti.");
  }
  const vNome = validaNome(dati.nome);
  if (!vNome.ok) return erroreValidazione(vNome.errors);

  const riga = {
    nome: String(dati.nome).trim(),
    note: testoOpzionale(dati.note),
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
    return errore("Impossibile creare l'associazione.");
  }
}

/**
 * Aggiorna un'associazione esistente (R3.4). Valida il nome se fornito.
 * @param {string} id
 * @param {{ nome?: string, note?: string }} dati
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function aggiornaAssociazione(id, dati) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo associazione mancante.");
  }
  if (!dati || typeof dati !== "object") {
    return errore("Dati di aggiornamento mancanti.");
  }
  const riga = {};
  if (Object.prototype.hasOwnProperty.call(dati, "nome")) {
    const vNome = validaNome(dati.nome);
    if (!vNome.ok) return erroreValidazione(vNome.errors);
    riga.nome = String(dati.nome).trim();
  }
  if (Object.prototype.hasOwnProperty.call(dati, "note")) {
    riga.note = testoOpzionale(dati.note);
  }
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
    if (error) return mappaErroreDb(error, { entita: ENTITA, operazione: "update" });
    if (!data) return errore("Associazione non trovata.");
    return ok(data);
  } catch (e) {
    return errore("Impossibile aggiornare l'associazione.");
  }
}

/**
 * Elimina un'associazione (R3.5). Se è referenziata da almeno un movimento di
 * scarico, il DB blocca l'eliminazione (ON DELETE RESTRICT) e l'errore FK viene
 * tradotto in un messaggio "in uso".
 * @param {string} id
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function eliminaAssociazione(id) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo associazione mancante.");
  }
  try {
    const { error } = await supabase.from(TABELLA).delete().eq("id", id);
    if (error) return mappaErroreDb(error, { entita: ENTITA, operazione: "delete" });
    return ok({ id });
  } catch (e) {
    return errore("Impossibile eliminare l'associazione.");
  }
}

export default {
  listaAssociazioni,
  getAssociazione,
  creaAssociazione,
  aggiornaAssociazione,
  eliminaAssociazione,
};
