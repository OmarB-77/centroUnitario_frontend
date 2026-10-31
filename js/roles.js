// js/roles.js
//
// Ruoli utente e GUARD di autorizzazione lato UI (funzioni pure).
//
// Questo modulo definisce i tre ruoli dell'applicazione e un insieme di
// predicati puri che decidono, in base al ruolo, quali schermate e quali azioni
// sono consentite nell'interfaccia. Serve a costruire la home filtrata per ruolo
// (task 15.x / 18.x) e a nascondere/disabilitare i controlli non pertinenti.
//
// IMPORTANTE (sicurezza): queste sono GUARD LATO UI. L'enforcement reale dei
// permessi avviene a livello di database con le policy RLS di Supabase
// (migrazioni 0004_rls_helper.sql / 0005_rls_policies.sql, Requisito 5). La UI
// può solo migliorare l'esperienza; non è mai l'unica difesa. I predicati qui
// sotto RISPECCHIANO le policy RLS così che ciò che la UI mostra coincida con
// ciò che il server effettivamente consente:
//   - Admin:      lettura/scrittura su tutto, inclusa la gestione utenti (R5.2, R6.1/R6.4).
//   - Power-user: anagrafiche (prodotti, punti di prelievo, associazioni),
//                 carico/scarico CU, ripristino/segnalazione armadi, check-list;
//                 NIENTE gestione utenti (R5.3, R6.6).
//   - User:       solo scarico/prelievo armadi e segnalazione carenza armadi,
//                 più le proprie impostazioni (R5.4).
//
// NOTA: modulo PURO. Nessun accesso a DOM, rete o Supabase. La lettura del ruolo
// corrente dalla sessione/profilo `users` è responsabilità di auth.js: qui si
// ricevono i ruoli già come stringhe canoniche.

// -----------------------------------------------------------------------------
// Ruoli
// -----------------------------------------------------------------------------

/**
 * Ruoli canonici, allineati all'enum Postgres `ruolo_utente`
 * ('admin', 'power_user', 'user') definito in 0001_enums.sql e usato da
 * `users.ruolo` e dalla funzione helper `ruolo_corrente()`.
 * Oggetto congelato: i valori non vanno modificati a runtime.
 *
 * @readonly
 */
export const RUOLI = Object.freeze({
  ADMIN: "admin",
  POWER_USER: "power_user",
  USER: "user",
});

/** Insieme dei valori di ruolo validi, per la validazione dei predicati. */
const RUOLI_VALIDI = Object.freeze(new Set(Object.values(RUOLI)));

// -----------------------------------------------------------------------------
// Schermate
// -----------------------------------------------------------------------------

/**
 * Identificatori stabili delle schermate operative dell'app, usati dal router
 * (routing hash-based) e dalla home filtrata per ruolo. Allineati alla struttura
 * delle schermate del design (home per ruolo, moduli ui/*).
 * Oggetto congelato.
 *
 * @readonly
 */
export const SCHERMATE = Object.freeze({
  // Solo Admin
  GESTIONE_UTENTI: "gestione_utenti",
  // Admin e Power-user — anagrafiche
  GESTIONE_PRODOTTI: "gestione_prodotti",
  PUNTI_PRELIEVO: "punti_prelievo",
  ASSOCIAZIONI: "associazioni",
  // Admin e Power-user — movimenti Centro Unitario
  CARICO_CU: "carico_cu",
  SCARICO_CU: "scarico_cu",
  // Admin e Power-user — check-list operative (carenza CU/armadi, scadenza)
  CHECK_LIST: "check_list",
  // Tutti gli utenti — armadi di ripristino
  SCARICO_ARMADI: "scarico_armadi",
  SEGNALAZIONE_ARMADI: "segnalazione_armadi",
  // Tutti gli utenti — proprie impostazioni (cambio password, scelta camera)
  IMPOSTAZIONI: "impostazioni",
});

/**
 * Mappa schermata -> ruoli che possono accedervi.
 * Fonte di verità per `puoAccedere` e `schermatePerRuolo`, costruita in modo da
 * rispecchiare le policy RLS lato server (vedi intestazione del modulo).
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const ACCESSO_SCHERMATE = Object.freeze({
  // Solo Admin (R6.*): la scrittura su `users` è negata al client per gli altri
  // ruoli; l'operazione privilegiata passa dalla Edge Function `gestione-utenti`.
  [SCHERMATE.GESTIONE_UTENTI]: [RUOLI.ADMIN],

  // Anagrafiche: scrittura consentita ad Admin e Power-user (R5.2, R5.3).
  [SCHERMATE.GESTIONE_PRODOTTI]: [RUOLI.ADMIN, RUOLI.POWER_USER],
  [SCHERMATE.PUNTI_PRELIEVO]: [RUOLI.ADMIN, RUOLI.POWER_USER],
  [SCHERMATE.ASSOCIAZIONI]: [RUOLI.ADMIN, RUOLI.POWER_USER],

  // Movimenti Centro Unitario (R5.2, R5.3, R7/R8).
  [SCHERMATE.CARICO_CU]: [RUOLI.ADMIN, RUOLI.POWER_USER],
  [SCHERMATE.SCARICO_CU]: [RUOLI.ADMIN, RUOLI.POWER_USER],

  // Check-list operative: lettura/spunta per Admin e Power-user (R11/R12/R13).
  [SCHERMATE.CHECK_LIST]: [RUOLI.ADMIN, RUOLI.POWER_USER],

  // Armadi di ripristino: tutti gli utenti autenticati (R5.4, R9).
  [SCHERMATE.SCARICO_ARMADI]: [RUOLI.ADMIN, RUOLI.POWER_USER, RUOLI.USER],
  [SCHERMATE.SEGNALAZIONE_ARMADI]: [RUOLI.ADMIN, RUOLI.POWER_USER, RUOLI.USER],

  // Impostazioni personali (cambio password, scelta camera): tutti.
  [SCHERMATE.IMPOSTAZIONI]: [RUOLI.ADMIN, RUOLI.POWER_USER, RUOLI.USER],
});

// -----------------------------------------------------------------------------
// Predicati di autorizzazione (puri)
// -----------------------------------------------------------------------------

/**
 * Indica se la stringa passata è un ruolo valido e riconosciuto.
 *
 * @param {string} ruolo valore del ruolo da verificare
 * @returns {boolean} true se è uno dei valori di `RUOLI`
 */
export function ruoloValido(ruolo) {
  return RUOLI_VALIDI.has(ruolo);
}

/**
 * Predicato puro: il ruolo può accedere alla schermata indicata?
 *
 * Rispecchia le policy RLS (vedi intestazione): un ruolo sconosciuto o una
 * schermata sconosciuta producono sempre `false` (negazione per default,
 * coerente con R5.5/R5.6).
 *
 * @param {string} ruolo ruolo corrente ('admin' | 'power_user' | 'user')
 * @param {string} schermata identificatore di `SCHERMATE`
 * @returns {boolean} true se l'accesso è consentito
 */
export function puoAccedere(ruolo, schermata) {
  if (!ruoloValido(ruolo)) return false;
  const consentiti = ACCESSO_SCHERMATE[schermata];
  if (!consentiti) return false; // schermata sconosciuta -> negato per default
  return consentiti.includes(ruolo);
}

/**
 * Elenco (ordinato) delle schermate a cui il ruolo può accedere, per costruire
 * la home filtrata per ruolo. L'ordine segue la dichiarazione in `SCHERMATE`.
 * Un ruolo non valido restituisce lista vuota.
 *
 * @param {string} ruolo ruolo corrente
 * @returns {string[]} identificatori di schermata consentiti per quel ruolo
 */
export function schermatePerRuolo(ruolo) {
  if (!ruoloValido(ruolo)) return [];
  return Object.values(SCHERMATE).filter((schermata) =>
    puoAccedere(ruolo, schermata)
  );
}

// -----------------------------------------------------------------------------
// Guard per azione (granularità più fine della schermata)
// -----------------------------------------------------------------------------

/**
 * Può gestire gli utenti (creare/eliminare account, modificare ruolo)?
 * Solo Admin (R6.1/R6.4/R6.6). L'operazione effettiva è privilegiata e passa
 * dalla Edge Function `gestione-utenti` con service role, mai dal client.
 *
 * @param {string} ruolo ruolo corrente
 * @returns {boolean}
 */
export function puoGestireUtenti(ruolo) {
  return ruolo === RUOLI.ADMIN;
}

/**
 * Può creare/modificare le anagrafiche (prodotti, punti di prelievo,
 * associazioni)? Admin e Power-user (R5.2, R5.3).
 *
 * @param {string} ruolo ruolo corrente
 * @returns {boolean}
 */
export function puoScrivereAnagrafiche(ruolo) {
  return ruolo === RUOLI.ADMIN || ruolo === RUOLI.POWER_USER;
}

/**
 * Può registrare movimenti sul Centro Unitario (carico e scarico, inclusa la
 * tripla destinazione dello scarico via RPC)? Admin e Power-user (R5.2, R5.3).
 *
 * @param {string} ruolo ruolo corrente
 * @returns {boolean}
 */
export function puoMovimentareCu(ruolo) {
  return ruolo === RUOLI.ADMIN || ruolo === RUOLI.POWER_USER;
}

/**
 * Può vedere e gestire le check-list operative (carenza CU/armadi, prossima
 * scadenza) e spuntare "ordine effettuato"? Admin e Power-user (R11/R12/R13).
 *
 * @param {string} ruolo ruolo corrente
 * @returns {boolean}
 */
export function puoGestireCheckList(ruolo) {
  return ruolo === RUOLI.ADMIN || ruolo === RUOLI.POWER_USER;
}

/**
 * Può operare sugli armadi di ripristino (registrare prelievi e segnalare
 * prodotti carenti)? Tutti gli utenti autenticati (R5.4, R9). Admin e Power-user
 * hanno comunque accesso completo (R5.2, R5.3).
 *
 * @param {string} ruolo ruolo corrente
 * @returns {boolean}
 */
export function puoOperareArmadi(ruolo) {
  return ruoloValido(ruolo);
}

/**
 * Può usare la schermata Impostazioni personali (cambio password, scelta
 * fotocamera)? Tutti gli utenti autenticati (R4.5, R15).
 *
 * @param {string} ruolo ruolo corrente
 * @returns {boolean}
 */
export function puoGestireImpostazioni(ruolo) {
  return ruoloValido(ruolo);
}
