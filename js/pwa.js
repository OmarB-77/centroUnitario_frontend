// Registrazione del service worker della PWA (R16.1).
//
// Il service worker e il suo scope usano il BASE_PATH centralizzato (js/config.js),
// perché GitHub Pages serve il sito sotto /<nome-repo>/ e non alla root: senza
// scope corretto il SW non controllerebbe le pagine dell'app.
//
// La registrazione è "best-effort": se il browser non supporta i service worker
// o la registrazione fallisce, l'app continua a funzionare online senza offline.
import { withBase } from "./config.js";

/**
 * Registra il service worker se supportato dal browser.
 * - URL dello script: withBase("sw.js") → /<base>/sw.js
 * - scope: withBase("") → /<base>/ (il SW controlla tutta l'app)
 *
 * @returns {Promise<ServiceWorkerRegistration|null>} la registrazione, o null
 *   se i service worker non sono supportati o la registrazione fallisce.
 */
export async function registraServiceWorker() {
  // Guard: nei contesti senza supporto (o durante i test con Node) si esce.
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      withBase("sw.js"),
      { scope: withBase("") }
    );
    return registration;
  } catch (err) {
    // La PWA è un miglioramento progressivo: un fallimento qui non deve
    // impedire l'uso dell'app online.
    console.warn("Registrazione service worker non riuscita:", err);
    return null;
  }
}
