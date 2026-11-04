// js/main.js
//
// Entry point della webapp (modulo ES) — WIRING FINALE (task 21.1).
//
// Collega in un unico flusso coerente, a partire dal login:
//   - il router hash-based con le guardie di autenticazione/ruolo (router.js);
//   - l'autenticazione/sessione (auth.js, usata internamente dal router);
//   - la schermata di login (ui/login.js) tramite l'handler "login" del router;
//   - tutte le schermate operative (ui/*), registrate per ciascuna rotta di
//     SCHERMATE (roles.js). La home ha già un handler interno nel router.
//
// Sequenza all'avvio (DOMContentLoaded):
//   1. mostra la versione nei segnaposto [data-versione] (R17.3);
//   2. registra il service worker (PWA, best-effort — R16.1);
//   3. registra gli handler di rotta (login + schermate per ruolo);
//   4. avvia il router sul container #contenuto: da qui in poi il router
//      decide cosa mostrare (login se non autenticato, home/ schermate se sì)
//      e reagisce ai cambi di stato auth (SIGNED_IN → home, SIGNED_OUT → login).
//
// GESTIONE CLEANUP DELLE SCHERMATE
//   Alcune schermate (armadi, caricoCu, scaricoCu, impostazioni) restituiscono
//   da mount(...) una funzione di cleanup/unmount (es. per fermare lo scanner o
//   rimuovere listener). Il router, ad ogni navigazione, svuota il container con
//   replaceChildren: questo rimuove i nodi ma NON invoca il cleanup del modulo.
//   Per non lasciare risorse appese (scanner della fotocamera, timer), ogni
//   handler qui registrato invoca prima l'eventuale cleanup della schermata
//   precedente (currentCleanup) e poi memorizza quello restituito dal nuovo
//   mount. Semplice e sufficiente: una sola schermata è montata per volta.
//
// Nessun segreto nel frontend: la sicurezza reale è nelle policy RLS lato DB.

import { VERSION } from "./version.js";
import { registraServiceWorker } from "./pwa.js";

import { avviaRouter, registraRotta, registraLogin } from "./router.js";
import { SCHERMATE } from "./roles.js";

import { mount as montaLogin } from "./ui/login.js";
import { mount as montaProdotti } from "./ui/prodotti.js";
import { mount as montaPuntiPrelievo } from "./ui/puntiPrelievo.js";
import { mount as montaAssociazioni } from "./ui/associazioni.js";
import { mount as montaCaricoCu } from "./ui/caricoCu.js";
import { mount as montaScaricoCu } from "./ui/scaricoCu.js";
import { mount as montaArmadi } from "./ui/armadi.js";
import { mount as montaCheckList } from "./ui/checklists.js";
import { mount as montaUtenti } from "./ui/utenti.js";
import { mount as montaImpostazioni } from "./ui/impostazioni.js";

/**
 * Cleanup della schermata attualmente montata (se il suo mount ne ha restituito
 * uno). Viene invocato prima di montare la schermata successiva.
 * @type {null | (() => void)}
 */
let currentCleanup = null;

/**
 * Esegue il cleanup della schermata precedente, se presente, in modo difensivo.
 */
function eseguiCleanupPrecedente() {
  if (typeof currentCleanup === "function") {
    try {
      currentCleanup();
    } catch (err) {
      // Il cleanup è best-effort: un errore qui non deve bloccare la
      // navigazione verso la schermata successiva.
      console.warn("Cleanup della schermata precedente non riuscito:", err);
    }
  }
  currentCleanup = null;
}

/**
 * Avvolge il mount di una schermata gestendo il cleanup della precedente e la
 * memorizzazione dell'eventuale cleanup restituito. Supporta mount sincroni e
 * asincroni (alcune schermate sono `async`): se mount ritorna una Promise, il
 * cleanup eventuale viene memorizzato quando la Promise si risolve.
 *
 * @param {(container: HTMLElement) => (void | (() => void) | Promise<void | (() => void)>)} montaFn
 * @returns {(container: HTMLElement) => void} handler compatibile con il router
 */
function conCleanup(montaFn) {
  return function handler(container) {
    eseguiCleanupPrecedente();
    const risultato = montaFn(container);
    if (risultato && typeof risultato.then === "function") {
      // Mount asincrono: memorizza il cleanup quando disponibile.
      risultato
        .then((cleanup) => {
          currentCleanup = typeof cleanup === "function" ? cleanup : null;
        })
        .catch((err) => {
          console.warn("Montaggio schermata non riuscito:", err);
          currentCleanup = null;
        });
    } else {
      currentCleanup = typeof risultato === "function" ? risultato : null;
    }
  };
}

/** Mostra la versione corrente in tutti i segnaposto [data-versione] (R17.3). */
function mostraVersione() {
  const nodi = document.querySelectorAll("[data-versione]");
  nodi.forEach((n) => {
    n.textContent = `v${VERSION}`;
  });
}

/**
 * Registra tutte le rotte: la schermata di login (chiave "login" usata dal
 * router per gli utenti non autenticati) e le schermate operative per ciascun
 * identificatore di SCHERMATE. La home è gestita internamente dal router.
 *
 * Nota: SCARICO_ARMADI e SEGNALAZIONE_ARMADI mappano entrambe su ui/armadi.js
 * (gestisce internamente le due modalità tramite tab).
 */
function registraRotte() {
  // Login: non è una SCHERMATA operativa, ma uno stato a sé per gli utenti non
  // autenticati. Si registra con registraLogin (chiave speciale "login" nel
  // router), non con registraRotta che validerebbe contro SCHERMATE.
  // L'handler riceve (container, { naviga }).
  registraLogin((container, ctx) => {
    eseguiCleanupPrecedente();
    montaLogin(container, ctx);
  });

  // Anagrafiche (Admin/Power-user).
  registraRotta(SCHERMATE.GESTIONE_PRODOTTI, conCleanup((c) => montaProdotti(c)));
  registraRotta(SCHERMATE.PUNTI_PRELIEVO, conCleanup((c) => montaPuntiPrelievo(c)));
  registraRotta(SCHERMATE.ASSOCIAZIONI, conCleanup((c) => montaAssociazioni(c)));

  // Movimenti Centro Unitario (Admin/Power-user).
  registraRotta(SCHERMATE.CARICO_CU, conCleanup((c) => montaCaricoCu(c)));
  registraRotta(SCHERMATE.SCARICO_CU, conCleanup((c) => montaScaricoCu(c)));

  // Armadi di ripristino (tutti gli utenti): stesso modulo per entrambe le
  // rotte, ma con la modalità iniziale decisa dalla rotta che lo apre, così le
  // due voci di menu mostrano schermate diverse (prelievo vs segnalazione).
  registraRotta(SCHERMATE.SCARICO_ARMADI, conCleanup((c) => montaArmadi(c, { modalita: "prelievo" })));
  registraRotta(SCHERMATE.SEGNALAZIONE_ARMADI, conCleanup((c) => montaArmadi(c, { modalita: "segnalazione" })));

  // Check-list operative (Admin/Power-user).
  registraRotta(SCHERMATE.CHECK_LIST, conCleanup((c) => montaCheckList(c)));

  // Gestione utenti (solo Admin).
  registraRotta(SCHERMATE.GESTIONE_UTENTI, conCleanup((c) => montaUtenti(c)));

  // Impostazioni personali (tutti gli utenti).
  registraRotta(SCHERMATE.IMPOSTAZIONI, conCleanup((c) => montaImpostazioni(c)));
}

/** Bootstrap dell'applicazione. */
function avvia() {
  mostraVersione();

  // Registrazione del service worker (network-first + fallback cache, R16).
  // Best-effort: non blocca l'avvio se non supportato o se fallisce.
  registraServiceWorker();

  // Collega tutte le rotte prima di avviare il router.
  registraRotte();

  // Avvia il router sul contenitore principale della shell PWA.
  const contenuto = document.getElementById("contenuto");
  if (contenuto) {
    avviaRouter(contenuto);
  } else {
    console.error("main: elemento #contenuto non trovato; router non avviato.");
  }
}

// Avvio robusto rispetto al timing: con <script type="module"> (deferred) il
// modulo puo' essere eseguito DOPO che DOMContentLoaded e' gia' scattato; in quel
// caso un listener aggiunto qui non verrebbe mai invocato e la pagina resterebbe
// sullo stub "Caricamento in corso...". Percio' se il DOM e' gia' pronto avviamo
// subito, altrimenti aspettiamo l'evento. Il try/catch rende visibile a schermo
// un eventuale errore di bootstrap invece di lasciare la pagina muta.
function avviaSicuro() {
  try {
    avvia();
  } catch (err) {
    console.error("Errore di avvio dell'applicazione:", err);
    const c = document.getElementById("contenuto");
    if (c) {
      c.replaceChildren();
      const p = document.createElement("p");
      p.setAttribute("role", "alert");
      p.textContent = "Errore di avvio. Ricarica la pagina; se persiste, controlla la console del browser.";
      c.append(p);
      // Diagnostica temporanea: mostra a schermo il messaggio reale per
      // facilitare la diagnosi senza aprire la console del browser.
      const pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.fontSize = "12px";
      pre.style.color = "#b00";
      pre.textContent = String((err && err.stack) || (err && err.message) || err);
      c.append(pre);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", avviaSicuro);
} else {
  // DOM gia' pronto (es. modulo deferred eseguito dopo il parsing): avvia subito.
  avviaSicuro();
}

