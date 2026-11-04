// Service worker della PWA "Centro Unitario".
//
// Strategia: NETWORK-FIRST con timeout breve e fallback su cache (R16.2, R16.3).
// L'app privilegia sempre i dati freschi dalla rete; se la rete non risponde
// entro il timeout o fallisce, si serve la copia in cache quando disponibile,
// così la UI non resta bloccata su connessioni lente o assenti.
//
// ───────────────────────────────────────────────────────────────────────────
// ⚠️ VERSIONE — DA TENERE ALLINEATA A MANO (R16.5, R17.1/R17.4)
//
// Un service worker non può importare in modo affidabile i moduli ES
// (`js/version.js`) in tutti i browser durante install/activate, quindi la
// versione è RIPETUTA QUI come stringa letterale. NON è l'unico punto di verità:
// quello resta `js/version.js`.
//
// REGOLA DI RILASCIO (steering "progetto-magazzino" → Versioning e rilascio):
// ad ogni modifica funzionale bisogna fare il BUMP della versione in
// `js/version.js` E aggiornare `APP_VERSION` qui sotto, così che `CACHE_NAME`
// cambi e invalidi automaticamente la cache vecchia sui client. Sequenza:
//   bump VERSION (js/version.js) → aggiorna APP_VERSION qui → commit →
//   tag git vX.Y.Z → git push --follow-tags.
// Non lasciare MAI disallineati js/version.js, package.json, questo APP_VERSION
// e il tag git.
// ───────────────────────────────────────────────────────────────────────────
const APP_VERSION = "0.1.7";

// Nome della cache derivato dalla versione: cambia a ogni release e fa sì che
// l'evento `activate` elimini le cache delle versioni precedenti (R16.5).
const CACHE_NAME = `centro-unitario-cache-v${APP_VERSION}`;

// Base path di GitHub Pages: il sito è servito sotto /<nome-repo>/, non alla root.
// Deve restare coerente con BASE_PATH in js/config.js. Il service worker gira in
// un contesto senza moduli ES, quindi il valore è ripetuto qui come costante.
const BASE_PATH = "/centroUnitario_frontend/";

// Timeout della rete per la strategia network-first (~3 secondi): oltre questa
// soglia si considera la rete troppo lenta e si ricade sulla cache (R16.3).
const NETWORK_TIMEOUT_MS = 3000;

// Shell applicativa da pre-cachare in fase di install. Tutti i path passano dal
// base path per essere corretti su GitHub Pages (niente "/..." assoluti hardcoded).
const APP_SHELL = [
  `${BASE_PATH}`,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}css/styles.css`,
  `${BASE_PATH}js/main.js`,
  `${BASE_PATH}js/pwa.js`,
  `${BASE_PATH}js/version.js`,
  `${BASE_PATH}js/config.js`,
];

// INSTALL: pre-cache dell'app shell. `skipWaiting` fa attivare subito il nuovo SW.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll fallisce in blocco se un file manca: usiamo add tollerante per
      // non bloccare l'install se un asset opzionale non è ancora presente.
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            // Asset non disponibile in fase di scaffold: si ignora senza
            // compromettere l'installazione del service worker.
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

// ACTIVATE: rimuove le cache vecchie (nome diverso da CACHE_NAME) e prende il
// controllo dei client già aperti (R16.5).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nomi = await caches.keys();
      await Promise.all(
        nomi
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      );
      await self.clients.claim();
    })()
  );
});

/**
 * Esegue un fetch con timeout: se la rete non risponde entro `timeoutMs`,
 * la promessa viene rifiutata (AbortController) così da innescare il fallback.
 *
 * NOTA sull'health-check (R16.4): una risposta HTTP 401/403 da Supabase NON è
 * un errore di rete — significa che il server è raggiungibile, quindi lo stato
 * è comunque "online". Qui qualunque risposta HTTP (anche 4xx/5xx) conta come
 * "rete ha risposto" e viene restituita/cacheata; il predicato is-online
 * dedicato (js/domain/online.js, task 11.14) applica la stessa logica lato app.
 */
function fetchConTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(request, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// FETCH: network-first con timeout ~3s e fallback su cache (R16.1, R16.2, R16.3).
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Gestiamo solo richieste GET same-origin: le chiamate API a Supabase
  // (altra origine) non vanno intercettate/cacheate dal service worker.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        // 1) Si prova la rete entro il timeout.
        const response = await fetchConTimeout(request, NETWORK_TIMEOUT_MS);
        // Si aggiorna la cache con l'ultima copia valida (solo risposte base,
        // per non cachear risposte opache o di altra origine).
        if (response && response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (_err) {
        // 2) Timeout o rete assente: si prova la cache.
        const cached = await caches.match(request);
        if (cached) return cached;

        // 3) Per le navigazioni (apertura di una pagina) si ricade sulla shell,
        // così l'app resta aperta anche offline.
        if (request.mode === "navigate") {
          const shell =
            (await caches.match(`${BASE_PATH}index.html`)) ||
            (await caches.match(`${BASE_PATH}`));
          if (shell) return shell;
        }

        // 4) Nessuna copia disponibile: si rilancia l'errore originale.
        throw _err;
      }
    })()
  );
});
