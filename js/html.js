// js/html.js
//
// Helper anti-XSS per la costruzione del DOM nel layer UI.
//
// Regola di sicurezza (steering): i valori provenienti dal database NON vengono
// MAI iniettati come HTML grezzo. Si usa sempre `textContent` (o `setAttribute`
// con valori non-HTML) tramite questi helper, così che eventuale markup nei dati
// venga mostrato come testo e non interpretato dal browser.
//
// Nessun uso di innerHTML con dati dinamici. Nessuna dipendenza da Supabase né
// dalla rete: solo DOM.

/**
 * Crea un elemento DOM impostando attributi, testo e figli in modo sicuro.
 *
 * @param {string} tag nome del tag (es. "div", "button", "input")
 * @param {Object} [opts] opzioni di costruzione
 * @param {Object<string,string>} [opts.attrs] attributi (set via setAttribute)
 * @param {Object<string,string>} [opts.dataset] coppie data-* (via dataset)
 * @param {string|string[]} [opts.class] classi CSS
 * @param {string} [opts.text] contenuto testuale (via textContent, sicuro)
 * @param {Object<string,Function>} [opts.on] listener di eventi { evento: handler }
 * @param {Array<Node|string>} [opts.children] figli (stringhe → nodi di testo)
 * @returns {HTMLElement}
 */
export function el(tag, opts = {}) {
  const node = document.createElement(tag);

  if (opts.class) {
    const classi = Array.isArray(opts.class) ? opts.class : [opts.class];
    for (const c of classi) {
      if (c) node.classList.add(c);
    }
  }

  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === null || v === undefined || v === false) continue;
      node.setAttribute(k, String(v));
    }
  }

  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) {
      if (v === null || v === undefined) continue;
      node.dataset[k] = String(v);
    }
  }

  // Testo sempre via textContent: i valori dal DB non sono mai interpretati come HTML.
  if (opts.text !== undefined && opts.text !== null) {
    node.textContent = String(opts.text);
  }

  if (opts.on) {
    for (const [evento, handler] of Object.entries(opts.on)) {
      if (typeof handler === "function") node.addEventListener(evento, handler);
    }
  }

  if (opts.children) {
    for (const figlio of opts.children) {
      if (figlio === null || figlio === undefined) continue;
      node.appendChild(
        typeof figlio === "string" ? document.createTextNode(figlio) : figlio,
      );
    }
  }

  return node;
}

/**
 * Svuota un nodo rimuovendo tutti i figli (senza usare innerHTML = "").
 * @param {Node} node
 * @returns {Node} lo stesso nodo, ora vuoto
 */
export function svuota(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Rende una stringa sicura per l'inserimento come testo.
 * Normalizza null/undefined in stringa vuota. Non serve escaping manuale perché
 * il consumo avviene sempre via textContent/appendChild, ma l'helper è utile per
 * concatenazioni di sola stringa.
 * @param {*} v
 * @returns {string}
 */
export function testo(v) {
  return v === null || v === undefined ? "" : String(v);
}

export default { el, svuota, testo };
