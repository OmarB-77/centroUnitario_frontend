// Autenticazione e gestione della sessione (Supabase Auth).
//
// Responsabilità (task 13.1, R4.1/4.2/4.3/4.5/4.6, R16/17 session):
//   - login/logout dell'utente tramite Supabase Auth;
//   - recupero della sessione corrente e del profilo utente (ruolo) dalla tabella `users`;
//   - cambio password per l'utente autenticato;
//   - sottoscrizione ai cambi di stato auth, così che il router possa reagire a
//     SIGNED_IN / SIGNED_OUT (montare la home vs. mostrare il login).
//
// Confini (side effects):
//   - QUESTO MODULO NON tocca il DOM. Gli unici effetti collaterali sono le chiamate
//     a Supabase (auth + lettura del profilo) e una piccola cache in memoria del profilo.
//   - La sicurezza reale resta nelle policy RLS lato DB: qui usiamo solo la anon key
//     tramite il singleton `supabase`.
//
// Convenzioni di ritorno:
//   - Le operazioni restituiscono un oggetto `{ ok: boolean, error?: string, ... }`.
//   - I messaggi di errore sono in italiano e, per il login, volutamente GENERICI:
//     non si rivela mai quale credenziale sia errata (R4.3).

import { supabase } from "./supabaseClient.js";

// --- Costanti di dominio -------------------------------------------------

/** Lunghezza minima consentita per una nuova password (R4.5). */
export const PASSWORD_MIN = 8;
/** Lunghezza massima consentita per una nuova password (R4.5, limite Supabase/bcrypt). */
export const PASSWORD_MAX = 72;

/** Colonne del profilo lette dalla tabella `users`. */
const PROFILO_COLONNE = "id, ruolo, display_name";

// --- Messaggi di errore (italiano) --------------------------------------

const MSG = Object.freeze({
  // Generico e non rivelatore: non distinguere email errata da password errata (R4.3).
  CREDENZIALI: "Credenziali non valide.",
  // Supabase applica il rate-limit lato server (R4.4): mostriamo un messaggio dedicato.
  TROPPI_TENTATIVI:
    "Troppi tentativi di accesso. Riprova tra qualche minuto.",
  LOGIN_GENERICO: "Impossibile completare l'accesso. Riprova.",
  LOGOUT_GENERICO: "Impossibile completare la disconnessione. Riprova.",
  SESSIONE_ASSENTE: "Nessuna sessione attiva.",
  PROFILO_NON_TROVATO: "Profilo utente non trovato.",
  PROFILO_GENERICO: "Impossibile recuperare il profilo utente.",
  PASSWORD_LUNGHEZZA: `La nuova password deve avere da ${PASSWORD_MIN} a ${PASSWORD_MAX} caratteri.`,
  PASSWORD_GENERICO: "Impossibile aggiornare la password. Riprova.",
});

// --- Cache in memoria del profilo ---------------------------------------
//
// Il profilo (id/ruolo/display_name) cambia di rado durante una sessione; lo
// memorizziamo per evitare una query ad ogni guard del router. La cache viene
// invalidata ai cambi di stato auth (vedi onCambioStatoAuth) e al logout.

let _profiloCache = null;

/** Invalida la cache del profilo in memoria. */
export function invalidaProfiloCache() {
  _profiloCache = null;
}

// --- Helper interni ------------------------------------------------------

/**
 * Normalizza un errore di login di Supabase in un messaggio italiano generico.
 * Non rivela mai quale credenziale è errata (R4.3); distingue solo il rate-limit.
 * @param {{ message?: string, status?: number } | null | undefined} error
 * @returns {string}
 */
function messaggioErroreLogin(error) {
  const testo = String(error?.message ?? "").toLowerCase();
  // Supabase segnala il blocco per troppi tentativi con status 429 o messaggi dedicati.
  if (
    error?.status === 429 ||
    testo.includes("rate limit") ||
    testo.includes("too many")
  ) {
    return MSG.TROPPI_TENTATIVI;
  }
  // Credenziali errate / utente inesistente / email non confermata: messaggio unico.
  if (
    testo.includes("invalid login") ||
    testo.includes("invalid credentials") ||
    testo.includes("email not confirmed") ||
    error?.status === 400
  ) {
    return MSG.CREDENZIALI;
  }
  return MSG.LOGIN_GENERICO;
}

// --- API pubblica --------------------------------------------------------

/**
 * Autentica l'utente con email e password.
 *
 * In caso di successo Supabase stabilisce e persiste la sessione (vedi
 * supabaseClient.js, persistSession). La cache del profilo viene invalidata
 * così che la prima getUtenteCorrente dopo il login rilegga dal DB.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function login(email, password) {
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(email ?? "").trim(),
      password: String(password ?? ""),
    });
    if (error) {
      return { ok: false, error: messaggioErroreLogin(error) };
    }
    // Nuova sessione: il profilo precedente (se presente) non è più valido.
    invalidaProfiloCache();
    return { ok: true };
  } catch (_e) {
    return { ok: false, error: MSG.LOGIN_GENERICO };
  }
}

/**
 * Disconnette l'utente corrente e invalida la cache del profilo.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function logout() {
  try {
    const { error } = await supabase.auth.signOut();
    invalidaProfiloCache();
    if (error) {
      return { ok: false, error: MSG.LOGOUT_GENERICO };
    }
    return { ok: true };
  } catch (_e) {
    // Anche in caso di eccezione, la cache locale va comunque pulita.
    invalidaProfiloCache();
    return { ok: false, error: MSG.LOGOUT_GENERICO };
  }
}

/**
 * Restituisce la sessione corrente di Supabase (o null se assente).
 *
 * Utile al router per decidere se mostrare il login o la home prima ancora di
 * leggere il profilo. Non solleva eccezioni: in caso di errore ritorna null.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session | null>}
 */
export async function getSessione() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return null;
    }
    return data?.session ?? null;
  } catch (_e) {
    return null;
  }
}

/**
 * Indica se esiste una sessione autenticata valida.
 * @returns {Promise<boolean>}
 */
export async function isAutenticato() {
  const sessione = await getSessione();
  return sessione != null;
}

/**
 * Recupera il profilo dell'utente autenticato dalla tabella `users`
 * (id, ruolo, display_name) e lo mette in cache.
 *
 * Ritorna:
 *   - l'oggetto profilo `{ id, ruolo, display_name }` se la sessione esiste e il
 *     profilo è presente;
 *   - `null` se non c'è alcuna sessione attiva (R4.1: nessun accesso senza login).
 *
 * La lettura è filtrata da RLS: l'utente vede solo il proprio profilo
 * (policy users_select_self), quindi la query per `id = auth.uid()` è sicura.
 *
 * @param {{ forza?: boolean }} [opzioni] forza=true ignora la cache e rilegge dal DB
 * @returns {Promise<{ id: string, ruolo: string, display_name: string | null } | null>}
 */
export async function getUtenteCorrente({ forza = false } = {}) {
  if (!forza && _profiloCache) {
    return _profiloCache;
  }

  const sessione = await getSessione();
  if (!sessione) {
    // Nessuna sessione: nessun profilo. Mantieni la cache pulita.
    invalidaProfiloCache();
    return null;
  }

  const userId = sessione.user?.id;
  if (!userId) {
    invalidaProfiloCache();
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select(PROFILO_COLONNE)
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      // Profilo non leggibile o inesistente: non memorizzare nulla in cache.
      return null;
    }

    _profiloCache = {
      id: data.id,
      ruolo: data.ruolo,
      display_name: data.display_name ?? null,
    };
    return _profiloCache;
  } catch (_e) {
    return null;
  }
}

/**
 * Restituisce il ruolo dell'utente corrente ('admin' | 'power_user' | 'user')
 * oppure null se non autenticato / profilo non disponibile.
 * @returns {Promise<string | null>}
 */
export async function getRuoloCorrente() {
  const profilo = await getUtenteCorrente();
  return profilo?.ruolo ?? null;
}

/**
 * Aggiorna la password dell'utente autenticato.
 *
 * Valida la lunghezza della nuova password (8..72, R4.5/R4.6) prima della
 * chiamata di rete. Supabase richiede una sessione valida: la verifica della
 * password corrente è demandata al backend secondo la configurazione del
 * progetto. In caso di nuova password fuori range, nessuna chiamata viene fatta.
 *
 * @param {string} nuovaPassword
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function cambioPassword(nuovaPassword) {
  const pwd = String(nuovaPassword ?? "");
  if (pwd.length < PASSWORD_MIN || pwd.length > PASSWORD_MAX) {
    return { ok: false, error: MSG.PASSWORD_LUNGHEZZA };
  }

  const sessione = await getSessione();
  if (!sessione) {
    return { ok: false, error: MSG.SESSIONE_ASSENTE };
  }

  try {
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) {
      const testo = String(error.message ?? "").toLowerCase();
      // Supabase può rifiutare se la nuova password non rispetta i criteri.
      if (testo.includes("password") && testo.includes("characters")) {
        return { ok: false, error: MSG.PASSWORD_LUNGHEZZA };
      }
      return { ok: false, error: MSG.PASSWORD_GENERICO };
    }
    return { ok: true };
  } catch (_e) {
    return { ok: false, error: MSG.PASSWORD_GENERICO };
  }
}

/**
 * Sottoscrive i cambi di stato dell'autenticazione, invocando `callback` quando
 * l'utente effettua l'accesso (SIGNED_IN) o la disconnessione (SIGNED_OUT), così
 * che il router possa reagire (montare la home o tornare al login).
 *
 * Ad ogni cambio di stato la cache del profilo viene invalidata, per evitare di
 * servire il profilo di una sessione precedente.
 *
 * La callback riceve `(evento, sessione)`:
 *   - evento: 'SIGNED_IN' | 'SIGNED_OUT' (sono gli unici propagati);
 *   - sessione: la sessione corrente (o null su SIGNED_OUT).
 *
 * @param {(evento: 'SIGNED_IN' | 'SIGNED_OUT', sessione: import('@supabase/supabase-js').Session | null) => void} callback
 * @returns {() => void} funzione per annullare la sottoscrizione
 */
export function onCambioStatoAuth(callback) {
  const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
    // Qualsiasi transizione invalida la cache del profilo in memoria.
    invalidaProfiloCache();

    // Propaghiamo al router solo gli eventi rilevanti per il routing.
    if (evento === "SIGNED_IN" || evento === "SIGNED_OUT") {
      if (typeof callback === "function") {
        callback(evento, sessione ?? null);
      }
    }
  });

  // Restituisce un unsubscribe robusto rispetto alla forma del dato di Supabase.
  return () => {
    try {
      data?.subscription?.unsubscribe?.();
    } catch (_e) {
      // Ignora: l'annullamento è best-effort.
    }
  };
}

export default {
  PASSWORD_MIN,
  PASSWORD_MAX,
  login,
  logout,
  getSessione,
  isAutenticato,
  getUtenteCorrente,
  getRuoloCorrente,
  cambioPassword,
  onCambioStatoAuth,
  invalidaProfiloCache,
};
