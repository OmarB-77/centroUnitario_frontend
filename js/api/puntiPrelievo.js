// js/api/puntiPrelievo.js
//
// Layer API per l'anagrafica PUNTI DI PRELIEVO (R2). CRUD verso la tabella
// `punti_di_prelievo` tramite supabase-js (PostgREST), protetto lato DB da RLS
// (scrittura solo Admin/Power-user), CHECK sul nome (1..200) e audit.
//
// Note:
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate supabase.from(...).
//   - Validazione client del nome PRIMA dell'invio (R2.2); limite/obbligatorietà
//     sono comunque garantiti dai CHECK del DB.
//   - L'eliminazione di un punto di prelievo referenziato da un prodotto è
//     bloccata dal DB (ON DELETE RESTRICT): l'errore FK viene tradotto in
//     "in uso" (R2.5).
//   - created_at/created_by sono gestiti dai trigger di audit: non inviati dal client.
//
// Mapping colonne DB: nome, contatti.

import { supabase } from "../supabaseClient.js";
import { validaNome } from "../domain/validation.js";
import { ok, errore, erroreValidazione, mappaErroreDb } from "./_errori.js";

const TABELLA = "punti_di_prelievo";
const COLONNE = "id, nome, contatti, created_at, created_by";
const ENTITA = "il punto di prelievo";

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
 * Restituisce l'elenco dei punti di prelievo (R2.3).
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaPuntiDiPrelievo() {
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .select(COLONNE)
      .order("nome", { ascending: true });
    if (error) return mappaErroreDb(error, { entita: ENTITA });
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare i punti di prelievo.");
  }
}

/**
 * Restituisce un singolo punto di prelievo per id.
 * @param {string} id
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function getPuntoDiPrelievo(id) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo punto di prelievo mancante.");
  }
  try {
    const { data, error } = await supabase
      .from(TABELLA)
      .select(COLONNE)
      .eq("id", id)
      .maybeSingle();
    if (error) return mappaErroreDb(error, { entita: ENTITA });
    if (!data) return errore("Punto di prelievo non trovato.");
    return ok(data);
  } catch (e) {
    return errore("Impossibile recuperare il punto di prelievo.");
  }
}

/**
 * Crea un punto di prelievo indicando almeno il nome (R2.1). Valida il nome
 * lato client (R2.2).
 * @param {{ nome: string, contatti?: string }} dati
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function creaPuntoDiPrelievo(dati) {
  if (!dati || typeof dati !== "object") {
    return errore("Dati del punto di prelievo mancanti.");
  }
  const vNome = validaNome(dati.nome);
  if (!vNome.ok) return erroreValidazione(vNome.errors);

  const riga = {
    nome: String(dati.nome).trim(),
    contatti: testoOpzionale(dati.contatti),
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
    return errore("Impossibile creare il punto di prelievo.");
  }
}

/**
 * Aggiorna un punto di prelievo esistente (R2.4). Valida il nome se fornito.
 * @param {string} id
 * @param {{ nome?: string, contatti?: string }} dati
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function aggiornaPuntoDiPrelievo(id, dati) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo punto di prelievo mancante.");
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
  if (Object.prototype.hasOwnProperty.call(dati, "contatti")) {
    riga.contatti = testoOpzionale(dati.contatti);
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
    if (!data) return errore("Punto di prelievo non trovato.");
    return ok(data);
  } catch (e) {
    return errore("Impossibile aggiornare il punto di prelievo.");
  }
}

/**
 * Elimina un punto di prelievo (R2.5). Se è referenziato da almeno un prodotto,
 * il DB blocca l'eliminazione (ON DELETE RESTRICT) e l'errore FK viene tradotto
 * in un messaggio "in uso".
 * @param {string} id
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function eliminaPuntoDiPrelievo(id) {
  if (typeof id !== "string" || id.trim() === "") {
    return errore("Identificativo punto di prelievo mancante.");
  }
  try {
    const { error } = await supabase.from(TABELLA).delete().eq("id", id);
    if (error) return mappaErroreDb(error, { entita: ENTITA, operazione: "delete" });
    return ok({ id });
  } catch (e) {
    return errore("Impossibile eliminare il punto di prelievo.");
  }
}

export default {
  listaPuntiDiPrelievo,
  getPuntoDiPrelievo,
  creaPuntoDiPrelievo,
  aggiornaPuntoDiPrelievo,
  eliminaPuntoDiPrelievo,
};
