// js/ui/_dom.js
//
// Helper DOM condivisi dal layer UI. Obiettivi:
//   - costruire il DOM via createElement/textContent (MAI innerHTML con dati
//     dal DB) per evitare XSS: i valori provenienti dal database vengono
//     sempre inseriti come testo, non come markup (convenzione anti-XSS);
//   - fornire primitive riutilizzabili e coerenti tra le varie schermate
//     (prodotti, puntiPrelievo, associazioni, ...).
//
// Nessuna dipendenza da Supabase o dalla rete: solo DOM puro. Tutti i testi
// visibili sono in italiano.

/**
 * Crea un elemento applicando attributi, proprietà testuali e figli.
 *
 * `opzioni`:
 *   - class / className : stringa di classi CSS
 *   - text              : contenuto testuale (via textContent, sicuro anti-XSS)
 *   - attrs             : mappa di attributi HTML (incl. aria-*, title, type, ...)
 *   - dataset           : mappa di data-* (impostati via element.dataset)
 *   - on                : mappa evento → handler (addEventListener)
 *   - <altre proprietà> : assegnate direttamente come proprietà DOM
 *                         (es. value, disabled, checked, htmlFor, ...)
 *
 * @param {string} tag nome del tag (es. "div", "button", "input")
 * @param {Object} [opzioni={}]
 * @param {(Node|string|null|undefined)[]} [figli=[]] nodi o testo da appendere
 * @returns {HTMLElement}
 */
export function el(tag, opzioni = {}, figli = []) {
  const node = document.createElement(tag);
  const o = opzioni || {};

  for (const [chiave, valore] of Object.entries(o)) {
    if (valore == null) continue;
    if (chiave === "class" || chiave === "className") {
      node.className = String(valore);
    } else if (chiave === "text") {
      node.textContent = String(valore);
    } else if (chiave === "attrs") {
      for (const [a, v] of Object.entries(valore)) {
        if (v == null) continue;
        node.setAttribute(a, String(v));
      }
    } else if (chiave === "dataset") {
      for (const [d, v] of Object.entries(valore)) {
        if (v == null) continue;
        node.dataset[d] = String(v);
      }
    } else if (chiave === "on") {
      for (const [evento, handler] of Object.entries(valore)) {
        if (typeof handler === "function") node.addEventListener(evento, handler);
      }
    } else {
      // Proprietà DOM diretta (value, disabled, checked, type, htmlFor, ...).
      try {
        node[chiave] = valore;
      } catch {
        node.setAttribute(chiave, String(valore));
      }
    }
  }

  const lista = Array.isArray(figli) ? figli : [figli];
  for (const f of lista) {
    if (f == null) continue;
    node.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
  }
  return node;
}

/**
 * Rimuove tutti i figli di un nodo.
 * @param {Node} node
 */
export function svuota(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Crea un bottone con sola icona accessibile: il testo dell'icona è decorativo
 * (aria-hidden) e l'etichetta reale è fornita via aria-label + title (R: a11y).
 *
 * @param {Object} opzioni
 * @param {string} opzioni.etichetta testo per aria-label e title (obbligatorio)
 * @param {string} opzioni.icona glifo/simbolo visibile (es. "✏️", "🗑")
 * @param {(ev: Event) => void} opzioni.onClick handler del click
 * @param {string} [opzioni.className] classi CSS aggiuntive
 * @returns {HTMLButtonElement}
 */
export function bottoneIcona({ etichetta, icona, onClick, className } = {}) {
  return el(
    "button",
    {
      type: "button",
      class: className ? `btn-icona ${className}` : "btn-icona",
      attrs: { "aria-label": etichetta, title: etichetta },
      on: { click: onClick },
    },
    [el("span", { attrs: { "aria-hidden": "true" }, text: icona || "" })],
  );
}

/**
 * Crea un contenitore per i messaggi di stato/errore (aria-live) riutilizzabile.
 * @returns {HTMLElement}
 */
export function areaMessaggi() {
  return el("div", {
    class: "ui-messaggio",
    attrs: { role: "status", "aria-live": "polite" },
  });
}

/**
 * Mostra un messaggio (errore o successo) nell'area indicata, usando textContent.
 * @param {HTMLElement} area nodo creato da areaMessaggi()
 * @param {string} testo messaggio da mostrare (sempre via textContent)
 * @param {"errore"|"successo"|"info"} [tipo="info"]
 */
export function mostraMessaggio(area, testo, tipo = "info") {
  if (!area) return;
  area.textContent = testo || "";
  area.className = `ui-messaggio ui-messaggio--${tipo}`;
}

export default { el, svuota, bottoneIcona, areaMessaggi, mostraMessaggio };
