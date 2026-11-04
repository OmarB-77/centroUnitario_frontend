// js/ui/_icone.js
//
// Icone SVG inline condivise dalla UI. Perché SVG e non emoji?
//   Le emoji/caratteri "barcode" non hanno un glifo standard reso in modo
//   coerente su iOS/Android/desktop: su alcune piattaforme mancano del tutto o
//   appaiono come caratteri spezzati. Un'icona SVG inline si rende IDENTICA
//   ovunque, scala senza perdita ed eredita il colore del testo del bottone
//   (fill/stroke = currentColor), così lo stesso markup funziona sia sui
//   bottoni primari (blu) sia su quelli secondari.
//
// Le icone sono decorative: i bottoni che le usano espongono comunque
// aria-label/title testuali, quindi marchiamo l'SVG con aria-hidden="true".

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Crea un elemento SVG con i figli indicati e gli attributi comuni alle icone.
 * @param {Array<SVGElement>} figli
 * @returns {SVGSVGElement}
 */
function creaSvg(figli) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icona");
  for (const f of figli) svg.appendChild(f);
  return svg;
}

/**
 * Icona BARCODE: barre verticali di spessore variabile, nel colore del testo.
 * Usata dai bottoni che aprono lo scanner del codice.
 * @returns {SVGSVGElement}
 */
export function iconaBarcode() {
  // Ogni barra è un <rect>; x/width scelti per un pattern da "codice a barre".
  const barre = [
    [3, 2],
    [6.5, 1],
    [9, 2.5],
    [13, 1],
    [15.5, 1],
    [18, 3],
  ];
  const figli = barre.map(([x, w]) => {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", "4");
    r.setAttribute("width", String(w));
    r.setAttribute("height", "16");
    r.setAttribute("fill", "currentColor");
    return r;
  });
  return creaSvg(figli);
}

/**
 * Icona STOP: quadrato pieno, mostrata mentre la scansione è in corso.
 * @returns {SVGSVGElement}
 */
export function iconaStop() {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", "6");
  r.setAttribute("y", "6");
  r.setAttribute("width", "12");
  r.setAttribute("height", "12");
  r.setAttribute("rx", "1.5");
  r.setAttribute("fill", "currentColor");
  return creaSvg([r]);
}

/**
 * Sostituisce il contenuto di un bottone con l'icona indicata (rimuove i figli
 * esistenti). Utile per passare da barcode a stop e viceversa senza toccare le
 * classi/attributi del bottone.
 * @param {HTMLElement} bottone
 * @param {"barcode"|"stop"} tipo
 */
export function impostaIconaBottone(bottone, tipo) {
  if (!bottone) return;
  while (bottone.firstChild) bottone.removeChild(bottone.firstChild);
  bottone.appendChild(tipo === "stop" ? iconaStop() : iconaBarcode());
}

export default { iconaBarcode, iconaStop, impostaIconaBottone };
