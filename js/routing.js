// js/routing.js
//
// Helper PURI di routing hash-based, senza DOM né dipendenze con effetti
// collaterali (nessun import di auth/supabase). Sono isolati qui — e non in
// router.js — proprio perché router.js importa auth.js → supabaseClient.js, che
// carica la build ESM di supabase-js da CDN e NON è caricabile in ambiente Node
// (Vitest). Tenendo i helper puri in un modulo a sé, restano importabili e
// unit-testabili senza trascinare la rete né il browser. router.js li re-esporta.
//
// RELAZIONE COL BASE PATH
//   Il routing per hash è INDIPENDENTE dal base path di GitHub Pages: l'hash
//   (dopo '#') non viene inviato al server e non va mai prefissato con
//   `withBase`. I link di navigazione restano quindi relativi ("#/...").

/** Rotta speciale della home (non è una schermata operativa di SCHERMATE). */
export const ROTTA_HOME = "home";

/**
 * Estrae l'identificatore di schermata dall'hash corrente.
 * Esempi: "#/home" -> "home", "#/carico_cu" -> "carico_cu", "" -> "" .
 * È tollerante a slash iniziali multipli e a hash senza slash ("#home"),
 * e ignora un'eventuale query ("#/prodotti?x=1" -> "prodotti").
 *
 * @param {string} [hash=location.hash] valore grezzo dell'hash
 * @returns {string} identificatore di schermata (stringa vuota se assente)
 */
export function parseHash(hash = typeof location !== "undefined" ? location.hash : "") {
  const grezzo = String(hash ?? "");
  const senzaHash = grezzo.replace(/^#/, "").replace(/^\/+/, "");
  const primoSegmento = senzaHash.split(/[/?]/)[0];
  return primoSegmento.trim();
}

/**
 * Costruisce il valore di hash per una schermata/rotta.
 * @param {string} schermata identificatore (es. "home", "carico_cu")
 * @returns {string} es. "#/home"
 */
export function hashPerRotta(schermata) {
  return `#/${String(schermata ?? ROTTA_HOME)}`;
}
