// js/router.js
//
// Router hash-based per la PWA (task 13.3, R4.1, R5.2/5.3/5.4).
//
// SCELTA: routing basato su `location.hash` (es. "#/home", "#/carico_cu").
// Motivazione: il sito è servito da GitHub Pages sotto /<nome-repo>/ (base path),
// senza un server che possa riscrivere le rotte verso index.html. Il routing per
// hash funziona interamente lato client, non richiede riscritture server ed è
// INDIPENDENTE dal base path: l'hash viene ignorato dal server. I link restano
// quindi relativi ("#/..."), mentre `withBase` serve SOLO per gli asset (vedi
// config.js / pwa.js), non per le rotte.
//
// GUARDIE DI AUTENTICAZIONE E RUOLO
//   Ad ogni navigazione il router:
//     1. verifica la sessione (getSessione): se assente, mostra il login
//        (R4.1: nessun accesso senza autenticazione) qualunque sia l'hash;
//     2. risolve il ruolo corrente (getUtenteCorrente) e, se la schermata
//        richiesta è consentita a quel ruolo (puoAccedere), la renderizza;
//     3. altrimenti reindirizza alla home (schermata non autorizzata), coerente
//        con il filtro per ruolo della home (R5.2/5.3/5.4).
//   Queste sono guardie LATO UI: la sicurezza reale è nelle policy RLS lato DB.
//
// REATTIVITÀ ALL'AUTH
//   Il router si sottoscrive a onCambioStatoAuth: su SIGNED_IN va alla home,
//   su SIGNED_OUT torna al login. Così il cambio di sessione aggiorna subito la
//   schermata senza interazione manuale.
//
// CONFINI
//   Il router conosce il DOM (monta le schermate nel container) e orchestra
//   auth + roles + home. I singoli handler di schermata (ui/*) sono registrati
//   dall'esterno con `registraRotta` per mantenere il router disaccoppiato dalle
//   schermate ancora da implementare.

import { SCHERMATE, puoAccedere } from "./roles.js";
import {
  getSessione,
  getUtenteCorrente,
  onCambioStatoAuth,
  logout as authLogout,
} from "./auth.js";
import { mount as montaHome } from "./ui/home.js";
// Helper PURI di routing (parsing/costruzione hash): vivono in un modulo a sé
// (routing.js) senza dipendenze con effetti collaterali, così da restare
// unit-testabili senza importare auth/supabase. Qui li re-esportiamo per
// mantenere invariata la superficie pubblica del router.
import { ROTTA_HOME, parseHash, hashPerRotta } from "./routing.js";

export { ROTTA_HOME, parseHash, hashPerRotta };

// Insieme degli identificatori di schermata validi (da roles.SCHERMATE).
const SCHERMATE_VALIDE = new Set(Object.values(SCHERMATE));

// Registro degli handler di schermata: schermata -> handler(container, ctx).
// Gli handler vengono registrati dall'esterno (main.js / moduli ui) con
// registraRotta. La home ha un handler interno di default.
const _handler = new Map();

// Stato interno del router.
let _container = null;
let _annullaSottoscrizione = null;
let _avviato = false;

// --- Registrazione rotte -------------------------------------------------

/**
 * Registra l'handler di rendering per una schermata.
 *
 * L'handler riceve `(container, contesto)` dove `contesto` contiene almeno
 * `{ ruolo, profilo, naviga }`. Il router garantisce che l'handler venga
 * invocato solo dopo le guardie di autenticazione/ruolo.
 *
 * @param {string} schermata identificatore di `SCHERMATE`
 * @param {(container: HTMLElement, contesto: object) => void} handler
 */
export function registraRotta(schermata, handler) {
  if (!SCHERMATE_VALIDE.has(schermata)) {
    throw new Error(`registraRotta: schermata sconosciuta "${schermata}"`);
  }
  if (typeof handler !== "function") {
    throw new Error("registraRotta: handler non valido");
  }
  _handler.set(schermata, handler);
}

/** Rimuove tutte le rotte registrate (utile nei test). */
export function reset() {
  _handler.clear();
  _container = null;
  _avviato = false;
  if (typeof _annullaSottoscrizione === "function") {
    _annullaSottoscrizione();
    _annullaSottoscrizione = null;
  }
}

// --- Navigazione ---------------------------------------------------------

/**
 * Naviga verso una schermata/rotta aggiornando l'hash. Se l'hash risultante è
 * già quello corrente, forza comunque un re-render (utile dopo il login).
 *
 * @param {string} [schermata=ROTTA_HOME] identificatore di destinazione
 */
export function naviga(schermata = ROTTA_HOME) {
  const nuovoHash = hashPerRotta(schermata);
  if (typeof location !== "undefined") {
    if (location.hash === nuovoHash) {
      // Stesso hash: 'hashchange' non scatterebbe, renderizziamo a mano.
      void risolviERenderizza();
    } else {
      location.hash = nuovoHash;
    }
  }
}

// --- Rendering di base ---------------------------------------------------

/**
 * Mostra un messaggio semplice nel container (schermate stub / errori).
 * Testo inserito con textContent (anti-XSS).
 * @param {string} testo
 */
function mostraMessaggio(testo) {
  if (!_container) return;
  _container.replaceChildren();
  const p = document.createElement("p");
  p.className = "router-messaggio";
  p.setAttribute("role", "status");
  p.textContent = testo;
  _container.append(p);
}

/**
 * Schermata di login minima (stub).
 *
 * La schermata di login completa è demandata a un task successivo; qui il router
 * garantisce comunque che l'utente non autenticato veda SEMPRE qualcosa (R4.1).
 * Se un handler per il login è stato registrato esternamente (chiave "login"),
 * viene usato quello; altrimenti si mostra uno stub accessibile con la versione.
 */
function mostraLogin() {
  if (!_container) return;

  const handlerLogin = _handler.get("login");
  if (typeof handlerLogin === "function") {
    _container.replaceChildren();
    handlerLogin(_container, { naviga });
    return;
  }

  _container.replaceChildren();
  const sezione = document.createElement("section");
  sezione.className = "login";
  sezione.setAttribute("aria-label", "Accesso");

  const titolo = document.createElement("h2");
  titolo.className = "login-titolo";
  titolo.textContent = "Accesso richiesto";

  const testo = document.createElement("p");
  testo.textContent =
    "Effettua l'accesso per usare l'applicazione.";

  sezione.append(titolo, testo);
  _container.append(sezione);
}

/**
 * Renderizza la home filtrata per ruolo, collegando navigazione e logout.
 * @param {{ ruolo: string, display_name?: string|null }} profilo
 */
function renderizzaHome(profilo) {
  if (!_container) return;
  montaHome(_container, {
    ruolo: profilo.ruolo,
    displayName: profilo.display_name ?? null,
    onNaviga: (schermata) => naviga(schermata),
    onLogout: () => {
      // Il logout provoca SIGNED_OUT → il listener riporterà al login.
      void authLogout();
    },
  });
}

/**
 * Cuore del router: risolve la rotta corrente applicando le guardie.
 *
 * Passi:
 *   1. nessuna sessione → login (qualunque hash);
 *   2. sessione presente ma profilo non recuperabile → messaggio di errore;
 *   3. hash vuoto o "home" → home filtrata per ruolo;
 *   4. schermata valida e consentita al ruolo → handler registrato (o stub);
 *   5. schermata valida ma non consentita, o sconosciuta → redirect alla home.
 */
export async function risolviERenderizza() {
  if (!_container) return;

  const sessione = await getSessione();
  if (!sessione) {
    mostraLogin();
    return;
  }

  const profilo = await getUtenteCorrente();
  if (!profilo || !profilo.ruolo) {
    mostraMessaggio(
      "Profilo utente non disponibile. Riprova o contatta un amministratore."
    );
    return;
  }

  const schermata = parseHash();

  // Home: hash vuoto o rotta home esplicita.
  if (schermata === "" || schermata === ROTTA_HOME) {
    renderizzaHome(profilo);
    return;
  }

  // Schermata sconosciuta → torna alla home.
  if (!SCHERMATE_VALIDE.has(schermata)) {
    naviga(ROTTA_HOME);
    return;
  }

  // Guardia di ruolo: schermata non consentita → torna alla home.
  if (!puoAccedere(profilo.ruolo, schermata)) {
    naviga(ROTTA_HOME);
    return;
  }

  // Schermata consentita: delega all'handler registrato, se presente.
  const handler = _handler.get(schermata);
  if (typeof handler === "function") {
    _container.replaceChildren();
    handler(_container, { ruolo: profilo.ruolo, profilo, naviga });
    return;
  }

  // Nessun handler registrato (schermata non ancora implementata): stub con
  // un modo per tornare alla home.
  _container.replaceChildren();
  const sezione = document.createElement("section");
  sezione.className = "schermata-stub";

  const h = document.createElement("h2");
  h.textContent = "Schermata in preparazione";
  const p = document.createElement("p");
  p.textContent = "Questa funzione non è ancora disponibile.";

  const btnHome = document.createElement("button");
  btnHome.type = "button";
  btnHome.className = "torna-home";
  btnHome.textContent = "Torna alla home";
  btnHome.addEventListener("click", () => naviga(ROTTA_HOME));

  sezione.append(h, p, btnHome);
  _container.append(sezione);
}

// --- Avvio ---------------------------------------------------------------

/**
 * Avvia il router sul container indicato.
 *
 * - Collega l'ascolto di `hashchange` per renderizzare ad ogni cambio rotta.
 * - Si sottoscrive ai cambi di stato auth: SIGNED_IN → home, SIGNED_OUT → login.
 * - Esegue un primo render in base all'hash corrente.
 *
 * @param {HTMLElement} container nodo in cui montare le schermate
 * @returns {() => void} funzione per fermare il router (rimuove i listener)
 */
export function avviaRouter(container) {
  if (!container) {
    throw new Error("avviaRouter: container mancante");
  }
  _container = container;

  const onHashChange = () => {
    void risolviERenderizza();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", onHashChange);
  }

  // Reagisce ai cambi di autenticazione.
  _annullaSottoscrizione = onCambioStatoAuth((evento) => {
    if (evento === "SIGNED_IN") {
      naviga(ROTTA_HOME);
    } else if (evento === "SIGNED_OUT") {
      // Torna al login: azzeriamo l'hash e renderizziamo.
      if (typeof location !== "undefined" && location.hash !== "") {
        // Impostare l'hash vuoto senza aggiungere voci inutili alla history.
        location.hash = "";
      }
      void risolviERenderizza();
    }
  });

  _avviato = true;

  // Primo render in base allo stato corrente.
  void risolviERenderizza();

  // Funzione di arresto (rimuove i listener e la sottoscrizione).
  return function fermaRouter() {
    if (typeof window !== "undefined") {
      window.removeEventListener("hashchange", onHashChange);
    }
    if (typeof _annullaSottoscrizione === "function") {
      _annullaSottoscrizione();
      _annullaSottoscrizione = null;
    }
    _avviato = false;
  };
}

/** Indica se il router è stato avviato (utile ai test/diagnostica). */
export function isAvviato() {
  return _avviato;
}

export default {
  ROTTA_HOME,
  registraRotta,
  naviga,
  avviaRouter,
  risolviERenderizza,
  parseHash,
  hashPerRotta,
  isAvviato,
  reset,
};
