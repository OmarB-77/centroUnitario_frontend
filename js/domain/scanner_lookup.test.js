// Property test della selezione prodotto da scanner per codice
// (js/domain/scanner_lookup.js: lookupPerCodice, normalizzaCodice).
//
// Property 9 — Selezione prodotto da scanner per codice (design.md)
// Validates: Requirements 15.1, 15.2, 15.3
//
// Invarianti verificate:
//   - R15.2: scansionando il codice di un prodotto ATTIVO esistente,
//     lookupPerCodice restituisce { trovato: true, prodotto: P } con P proprio
//     il prodotto target.
//   - R15.3 (codice assente): un codice non presente in anagrafica restituisce
//     { trovato: false }.
//   - R15.3 (prodotto non attivo): il codice di un prodotto con attivo=false
//     restituisce { trovato: false } (nessuna selezione).
//   - R15.1 (acquisizione da scanner): il codice acquisito dal lettore può
//     portare whitespace/newline/caratteri di controllo in testa e in coda; la
//     normalizzazione fa sì che il confronto trovi comunque il prodotto. Un
//     codice vuoto o composto solo da whitespace/controllo non seleziona nulla.
//   - Case-sensitivity: un codice che differisce solo per il case NON combacia
//     (coerente con il design: i codici sono identificativi esatti,
//     confronto case-sensitive).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { lookupPerCodice, normalizzaCodice } from "./scanner_lookup.js";

// -----------------------------------------------------------------------------
// Generatori (arbitraries)
// -----------------------------------------------------------------------------

// Un codice prodotto "base" plausibile: alfanumerico + alcuni simboli comuni
// nei barcode, SENZA whitespace/controllo iniziali o finali (quelli li aggiunge
// lo scanner e sono gestiti dalla normalizzazione). Lunghezza 1..20 come da
// vincolo DB (codice 1..50). Si evita di generare whitespace interno in testa/
// coda per non ambiguare l'uguaglianza esatta dopo il trim.
const codiceCharArb = fc.constantFrom(
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."0123456789".split(""),
  ..."-_./".split(""),
);

const codiceBaseArb = fc
  .array(codiceCharArb, { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(""));

// Genera N codici DISTINTI (uso di un Set per garantire l'unicità, come da
// vincolo UNIQUE lato DB). Restituisce un array di lunghezza esattamente n.
function codiciDistintiArb(n) {
  return fc
    .uniqueArray(codiceBaseArb, {
      minLength: n,
      maxLength: n,
      // Confronto case-sensitive per l'unicità, coerente col design.
      comparator: (a, b) => a === b,
    });
}

// Costruisce un prodotto d'anagrafica dato id/codice/attivo.
function prodotto(id, codice, attivo) {
  return {
    id,
    nome: `Prodotto ${id}`,
    codice,
    attivo,
  };
}

// Affissi di whitespace/controllo che un lettore barcode può accodare:
// spazio, tab, CR, LF, NUL e altri caratteri di controllo bassi.
const affissoRumoreArb = fc
  .array(fc.constantFrom(" ", "\t", "\r", "\n", "\u0000", "\u0001", "\u001F", "\v", "\f"), {
    minLength: 0,
    maxLength: 4,
  })
  .map((cs) => cs.join(""));

// Un'anagrafica di prodotti con codici distinti e flag attivo arbitrario, più
// l'indice del prodotto "target" scelto tra quelli generati.
const anagraficaArb = fc
  .integer({ min: 1, max: 6 })
  .chain((n) =>
    fc.tuple(
      codiciDistintiArb(n),
      fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    ),
  )
  .map(([codici, flags]) =>
    codici.map((codice, i) => prodotto(`p${i}`, codice, flags[i])),
  );

// -----------------------------------------------------------------------------
// R15.2 — scansione di un prodotto ATTIVO esistente seleziona proprio quello
// -----------------------------------------------------------------------------

describe("lookupPerCodice — Property 9: selezione di un prodotto attivo (R15.2)", () => {
  it("scansionando il codice di un prodotto attivo restituisce { trovato:true, prodotto:P }", () => {
    fc.assert(
      fc.property(
        codiciDistintiArb(5),
        // indice del target tra i 5 prodotti
        fc.integer({ min: 0, max: 4 }),
        // flag attivo per i NON-target; il target sarà forzato attivo
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        (codici, idxTarget, flags) => {
          const prodotti = codici.map((codice, i) =>
            prodotto(`p${i}`, codice, i === idxTarget ? true : flags[i]),
          );
          const target = prodotti[idxTarget];

          const esito = lookupPerCodice(prodotti, target.codice);
          expect(esito.trovato).toBe(true);
          // Deve essere proprio il prodotto target (stesso riferimento/codice).
          expect(esito.prodotto).toBe(target);
          expect(esito.prodotto.codice).toBe(target.codice);
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------------
// R15.3 — codice assente dall'anagrafica: nessuna selezione
// -----------------------------------------------------------------------------

describe("lookupPerCodice — Property 9: codice assente (R15.3)", () => {
  it("scansionando un codice non presente restituisce { trovato:false }", () => {
    fc.assert(
      fc.property(anagraficaArb, codiceBaseArb, (prodotti, codiceEstraneo) => {
        // Pre-condizione: il codice estraneo non deve coincidere (dopo trim,
        // case-sensitive) con nessun codice in anagrafica.
        const cercato = normalizzaCodice(codiceEstraneo);
        const presente = prodotti.some((p) => normalizzaCodice(p.codice) === cercato);
        fc.pre(!presente);

        const esito = lookupPerCodice(prodotti, codiceEstraneo);
        expect(esito.trovato).toBe(false);
        expect(esito).not.toHaveProperty("prodotto");
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// R15.3 — codice di un prodotto NON attivo: nessuna selezione
// -----------------------------------------------------------------------------

describe("lookupPerCodice — Property 9: prodotto non attivo (R15.3)", () => {
  it("scansionando il codice di un prodotto con attivo=false restituisce { trovato:false }", () => {
    fc.assert(
      fc.property(
        codiciDistintiArb(5),
        fc.integer({ min: 0, max: 4 }),
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        (codici, idxTarget, flags) => {
          // Il target è forzato NON attivo; gli altri con flag arbitrario ma
          // comunque con codice diverso (codici distinti per costruzione).
          const prodotti = codici.map((codice, i) =>
            prodotto(`p${i}`, codice, i === idxTarget ? false : flags[i]),
          );
          const target = prodotti[idxTarget];

          const esito = lookupPerCodice(prodotti, target.codice);
          // Poiché i codici sono distinti, nessun altro prodotto attivo può
          // combaciare con il codice del target non attivo.
          expect(esito.trovato).toBe(false);
          expect(esito).not.toHaveProperty("prodotto");
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------------
// R15.1 — normalizzazione del codice acquisito dallo scanner
// -----------------------------------------------------------------------------

describe("lookupPerCodice — Property 9: normalizzazione codice acquisito (R15.1)", () => {
  it("il codice del target con whitespace/controllo in testa e coda combacia comunque", () => {
    fc.assert(
      fc.property(
        codiciDistintiArb(5),
        fc.integer({ min: 0, max: 4 }),
        affissoRumoreArb,
        affissoRumoreArb,
        (codici, idxTarget, prefisso, suffisso) => {
          const prodotti = codici.map((codice, i) => prodotto(`p${i}`, codice, true));
          const target = prodotti[idxTarget];

          const scansionato = `${prefisso}${target.codice}${suffisso}`;
          const esito = lookupPerCodice(prodotti, scansionato);
          expect(esito.trovato).toBe(true);
          expect(esito.prodotto).toBe(target);
        },
      ),
    );
  });

  it("un codice vuoto o composto solo da whitespace/controllo non seleziona nulla", () => {
    fc.assert(
      fc.property(anagraficaArb, affissoRumoreArb, (prodotti, soloRumore) => {
        const esito = lookupPerCodice(prodotti, soloRumore);
        expect(esito.trovato).toBe(false);
        expect(esito).not.toHaveProperty("prodotto");
      }),
    );
  });

  it("normalizzaCodice rimuove solo gli affissi, lasciando invariato il contenuto interno", () => {
    fc.assert(
      fc.property(codiceBaseArb, affissoRumoreArb, affissoRumoreArb, (base, pre, suf) => {
        // base non contiene whitespace/controllo in testa/coda per costruzione.
        expect(normalizzaCodice(`${pre}${base}${suf}`)).toBe(base);
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// Case-sensitivity — il confronto è esatto (design: identificativi esatti)
// -----------------------------------------------------------------------------

describe("lookupPerCodice — Property 9: confronto case-sensitive", () => {
  it("un codice che differisce solo per il case NON combacia", () => {
    fc.assert(
      fc.property(
        codiciDistintiArb(5),
        fc.integer({ min: 0, max: 4 }),
        (codici, idxTarget) => {
          const prodotti = codici.map((codice, i) => prodotto(`p${i}`, codice, true));
          const target = prodotti[idxTarget];

          // Cambia il case del target: inverte maiuscole/minuscole.
          const swapCase = (s) =>
            s
              .split("")
              .map((ch) =>
                ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase(),
              )
              .join("");
          const variante = swapCase(target.codice);

          // Pre-condizione: lo swap deve effettivamente cambiare la stringa
          // (altrimenti il codice non ha lettere e il test è banale) e NON deve
          // collidere con un altro codice in anagrafica.
          fc.pre(variante !== target.codice);
          const cercato = normalizzaCodice(variante);
          const collide = prodotti.some((p) => normalizzaCodice(p.codice) === cercato);
          fc.pre(!collide);

          const esito = lookupPerCodice(prodotti, variante);
          expect(esito.trovato).toBe(false);
        },
      ),
    );
  });
});
