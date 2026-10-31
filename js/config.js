// Configurazione centralizzata del frontend.
//
// SICUREZZA — da leggere prima di toccare questo file:
//   - La anon/publishable key qui sotto è PUBBLICA per definizione: finisce nel
//     bundle statico servito da GitHub Pages ed è visibile a chiunque. Va bene così.
//     La sicurezza reale NON sta nel nascondere questa chiave, ma nelle policy RLS
//     di Postgres/Supabase, che filtrano riga per riga in base al ruolo dell'utente
//     autenticato (R6.3).
//   - La SERVICE ROLE KEY non deve MAI comparire in questo file, nel frontend o in
//     qualunque file versionato. Le operazioni privilegiate (creare/eliminare utenti,
//     azioni admin) passano da Edge Function lato server con la service role.
//   - Questi valori sono pubblici e vengono inclusi nel bundle statico su GitHub Pages.

import { VERSION } from "./version.js";

// URL base del progetto Supabase (SENZA suffisso /rest/v1/: lo aggiunge supabase-js).
const SUPABASE_URL = "https://jwqsxirmfaiylglxzyjj.supabase.co";

// Chiave pubblica anon (vedi nota di sicurezza sopra).
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3cXN4aXJtZmFpeWxnbHh6eWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3OTA3NzEsImV4cCI6MjEwNjM2Njc3MX0.XebNQ1O1mc68ZwHyJDTOsfhvzjiDLRhNSHpOOqppF6U";

// Base path di GitHub Pages: il sito è servito sotto /<nome-repo>/, non alla root.
// Unico punto di verità per router, registrazione del service worker e risoluzione asset.
// Deve iniziare e terminare con "/".
const BASE_PATH = "/centroUnitario_frontend/";

// Oggetto di configurazione immutabile: unico punto di verità per l'app.
export const CONFIG = Object.freeze({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  BASE_PATH,
  VERSION,
});

// Esportazioni comode per chi non vuole passare dall'oggetto CONFIG.
export { SUPABASE_URL, SUPABASE_ANON_KEY, BASE_PATH, VERSION };

/**
 * Unisce il BASE_PATH con un percorso relativo, producendo un percorso assoluto
 * corretto per GitHub Pages (servito sotto /<nome-repo>/).
 *
 * Nessun percorso assoluto "/..." hardcoded nel resto del codice: tutti i path
 * devono passare da qui, così cambiare repo/base richiede una sola modifica.
 *
 * Gestisce in modo robusto slash iniziali/finali per evitare "//" o segmenti mancanti:
 *   withBase("css/styles.css")   -> "/centroUnitario_frontend/css/styles.css"
 *   withBase("/css/styles.css")  -> "/centroUnitario_frontend/css/styles.css"
 *   withBase("")                 -> "/centroUnitario_frontend/"
 *   withBase("/")                -> "/centroUnitario_frontend/"
 *
 * @param {string} [path=""] percorso relativo alla root dell'app
 * @returns {string} percorso assoluto comprensivo di base path
 */
export function withBase(path = "") {
  // Normalizza il base: garantisce uno slash iniziale e uno finale, senza doppioni.
  const baseConSlash = `/${String(BASE_PATH).replace(/^\/+/, "").replace(/\/+$/, "")}/`;
  // Rimuove gli slash iniziali e collassa gli slash interni multipli del relativo,
  // così il risultato non contiene mai "//" (a parte lo slash iniziale assoluto).
  const relativo = String(path).replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  return `${baseConSlash}${relativo}`;
}

// Alias semantici: stesso comportamento di withBase, nomi più espressivi a seconda del contesto.
export const asset = withBase;
export const basePath = withBase;
