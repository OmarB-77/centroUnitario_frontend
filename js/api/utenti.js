// js/api/utenti.js
//
// Layer API per la GESTIONE UTENTI (R6). La lettura dell'elenco utenti avviene
// via PostgREST sulla tabella `users` (consentita all'Admin dalla RLS: SELECT
// del proprio profilo o di tutti se Admin). Le operazioni privilegiate su
// `auth.users` (creazione/eliminazione account e cambio ruolo) NON sono
// eseguibili dal client: passano dalla Edge Function `gestione-utenti` (Deno,
// service role), invocata con supabase.functions.invoke (R6.2, R6.3).
//
// Principi del layer:
//   - Nessuna stringa SQL a mano: solo chiamate parametrizzate supabase.from(...)
//     e invoke della Edge Function.
//   - Il client usa SOLO la anon key; la service role key vive esclusivamente
//     nei secrets della Edge Function (mai nel frontend, R6.3).
//   - Ogni funzione restituisce un risultato normalizzato { ok, data?, error?, code? }.
//   - I messaggi di errore sono in italiano, pronti per la UI; i codici HTTP
//     della Edge Function (401/403/404/409...) sono mappati a messaggi chiari.
//   - Nessun accesso al DOM: l'escape anti-XSS avviene nel layer UI.
//
// Contratto Edge Function `gestione-utenti` (vedi backend index.ts):
//   body JSON { action, ... } con action ∈ { create, update, delete }:
//     - create: { action:'create', email, password, ruolo, display_name? } → 201 { ok, id, ruolo }
//     - update: { action:'update', user_id, ruolo }                        → 200 { ok, id, ruolo }
//     - delete: { action:'delete', user_id }                               → 200 { ok, id }
//   In caso di errore risponde { error: "<messaggio>" } con status:
//     400 (validazione), 401 (token mancante/non valido), 403 (non Admin),
//     404 (utente non trovato), 409 (vincolo ultimo-Admin), 500 (errore server).
//   Il ruolo sul DB usa i valori enum 'admin' | 'power_user' | 'user'.

import { supabase } from "../supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { ok, errore, mappaErroreDb } from "./_errori.js";

const TABELLA_USERS = "users";
const COLONNE_USERS = "id, ruolo, display_name, created_at, created_by";
const NOME_FUNZIONE = "gestione-utenti";

/**
 * Estrae in modo difensivo un messaggio di errore testuale da un corpo JSON
 * della Edge Function. La function risponde con { error: "<messaggio>" }.
 * @param {*} corpo corpo JSON già parsato (o null)
 * @returns {string|null}
 */
function messaggioDaCorpo(corpo) {
  if (corpo && typeof corpo === "object" && typeof corpo.error === "string") {
    return corpo.error;
  }
  return null;
}

/**
 * Traduce uno status HTTP della Edge Function in un messaggio italiano chiaro.
 * Se la function ha fornito un messaggio specifico nel corpo, quello ha
 * precedenza (è già in italiano e puntuale).
 * @param {number} status codice HTTP
 * @param {string|null} messaggioServer messaggio dal corpo della risposta
 * @returns {string}
 */
function messaggioPerStatus(status, messaggioServer) {
  // Il vincolo ultimo-Admin (409) merita un messaggio dedicato e stabile,
  // indipendentemente dal testo del server (R6.5).
  if (status === 409) {
    return "Operazione rifiutata: deve esistere almeno un Admin.";
  }
  if (messaggioServer) return messaggioServer;
  switch (status) {
    case 400:
      return "Dati non validi per l'operazione sugli utenti.";
    case 401:
      return "Sessione scaduta o non valida: effettua di nuovo l'accesso.";
    case 403:
      return "Operazione riservata agli Admin: permessi insufficienti.";
    case 404:
      return "Utente non trovato.";
    case 500:
      return "Errore del server durante l'operazione sugli utenti.";
    default:
      return "Si è verificato un errore durante l'operazione sugli utenti.";
  }
}

/**
 * Invoca la Edge Function `gestione-utenti` normalizzando l'esito in
 * { ok, data?/error?, code? }. supabase-js restituisce { data, error }:
 *   - successo: data = corpo JSON (la function risponde 2xx con { ok, ... });
 *   - errore HTTP: error è un FunctionsHttpError con la Response in error.context,
 *     da cui si leggono status e messaggio del server.
 * @param {object} body corpo JSON da inviare (deve includere `action`)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
async function invocaGestioneUtenti(body) {
  try {
    // Ottiene un access token FRESCO prima della chiamata. Rinnovare sempre la
    // sessione (quando presente) è l'unico modo affidabile per avere un token
    // appena firmato: su PWA/mobile il timer di auto-refresh di supabase-js può
    // non essere scattato dopo una sospensione della tab, e il token in cache
    // sarebbe scaduto (la Edge Function risponderebbe 401 "token scaduto").
    let tokenFresco = null;
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed?.session?.access_token) {
        tokenFresco = refreshed.session.access_token;
      } else {
        // Nessun refresh (es. refresh token assente): ripiego sulla sessione
        // corrente, se c'è.
        const { data: sess } = await supabase.auth.getSession();
        tokenFresco = sess?.session?.access_token ?? null;
      }
    } catch {
      tokenFresco = null;
    }

    if (!tokenFresco) {
      // Nessuna sessione valida: inutile chiamare, l'esito sarebbe 401.
      return errore(
        "Sessione scaduta o non valida: effettua di nuovo l'accesso.",
        { code: "401" },
      );
    }

    // Chiamata diretta all'endpoint della Edge Function via fetch, così
    // controlliamo ESATTAMENTE gli header (Authorization con il token fresco +
    // apikey). Questo evita qualsiasi problema di stato interno/caching del
    // token da parte di supabase.functions.invoke, che si è rivelato la causa
    // dei 401 ricorrenti nel browser pur avendo una sessione valida.
    const url = `${SUPABASE_URL}/functions/v1/${NOME_FUNZIONE}`;
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${tokenFresco}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return errore("Impossibile contattare il servizio di gestione utenti.");
    }

    // Prova a leggere il corpo JSON (sia per successo sia per errore).
    let corpo = null;
    try {
      corpo = await response.json();
    } catch {
      corpo = null;
    }

    if (!response.ok) {
      const messaggioServer = messaggioDaCorpo(corpo);
      return errore(messaggioPerStatus(response.status, messaggioServer), {
        code: String(response.status),
      });
    }

    // Alcune risposte 2xx potrebbero comunque contenere { error }.
    const messaggioApplicativo = messaggioDaCorpo(corpo);
    if (messaggioApplicativo) {
      return errore(messaggioApplicativo);
    }

    return ok(corpo);
  } catch (e) {
    return errore("Impossibile eseguire l'operazione sugli utenti.");
  }
}

/**
 * Elenco di tutti gli utenti applicativi (R6). La RLS consente all'Admin di
 * leggere tutti i profili `users`; gli altri ruoli vedono (al più) il proprio.
 * Ordinato per `display_name` quando presente.
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function listaUtenti() {
  try {
    const { data, error } = await supabase
      .from(TABELLA_USERS)
      .select(COLONNE_USERS)
      .order("display_name", { ascending: true, nullsFirst: false });
    if (error) return mappaErroreDb(error, { entita: "gli utenti" });
    return ok(data || []);
  } catch (e) {
    return errore("Impossibile recuperare l'elenco degli utenti.");
  }
}

/**
 * Crea un nuovo utente (account + profilo con ruolo) via Edge Function (R6.1).
 * L'autorizzazione (chiamante Admin) e la creazione su auth.users avvengono
 * lato server con service role.
 * @param {{ email: string, password: string, ruolo: string, displayName?: string }} dati
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function creaUtente(dati) {
  if (!dati || typeof dati !== "object") {
    return errore("Dati dell'utente mancanti.");
  }
  const email = typeof dati.email === "string" ? dati.email.trim() : "";
  const password = typeof dati.password === "string" ? dati.password : "";
  const ruolo = dati.ruolo;

  if (email === "") {
    return errore("L'email è obbligatoria.");
  }
  if (password.length < 8 || password.length > 72) {
    return errore("La password deve essere lunga da 8 a 72 caratteri.");
  }
  if (typeof ruolo !== "string" || ruolo.trim() === "") {
    return errore("Il ruolo è obbligatorio.");
  }

  const body = {
    action: "create",
    email,
    password,
    ruolo,
  };
  // La Edge Function legge il nome visualizzato da `display_name`.
  if (typeof dati.displayName === "string" && dati.displayName.trim() !== "") {
    body.display_name = dati.displayName.trim();
  }

  return invocaGestioneUtenti(body);
}

/**
 * Cambia il ruolo di un utente esistente via Edge Function (R6.4). Il degrado
 * di un Admin è soggetto al vincolo ultimo-Admin lato server (R6.5 → 409).
 * @param {string} userId id dell'utente (= auth.users.id)
 * @param {string} ruolo nuovo ruolo ('admin' | 'power_user' | 'user')
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function cambiaRuolo(userId, ruolo) {
  if (typeof userId !== "string" || userId.trim() === "") {
    return errore("Identificativo utente mancante.");
  }
  if (typeof ruolo !== "string" || ruolo.trim() === "") {
    return errore("Il ruolo è obbligatorio.");
  }
  return invocaGestioneUtenti({
    action: "update",
    user_id: userId,
    ruolo,
  });
}

/**
 * Elimina un utente via Edge Function (R6.4). L'eliminazione di un Admin è
 * soggetta al vincolo ultimo-Admin lato server (R6.5 → 409).
 * @param {string} userId id dell'utente (= auth.users.id)
 * @returns {Promise<import('./_errori.js').RisultatoApi>}
 */
export async function eliminaUtente(userId) {
  if (typeof userId !== "string" || userId.trim() === "") {
    return errore("Identificativo utente mancante.");
  }
  return invocaGestioneUtenti({
    action: "delete",
    user_id: userId,
  });
}

export default {
  listaUtenti,
  creaUtente,
  cambiaRuolo,
  eliminaUtente,
};
