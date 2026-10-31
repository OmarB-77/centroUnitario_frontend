// Property test della derivazione delle check-list di CARENZA
// (js/domain/checklists.js: carenzaCu, carenzaArmadi) con il modello di
// giacenze (js/domain/giacenze.js: giacenzaCu, giacenzaArmadi).
//
// Property 7 — Appartenenza alle check-list di carenza (design.md)
// Validates: Requirements 11.1, 11.3, 12.1, 12.2
//
// Invarianti verificate:
//   - CU (R11.1): un prodotto ATTIVO con giacenza CU G e soglia
//     giacenza_minima_cu T appartiene a carenzaCu(...) SE E SOLO SE G < T
//     (confronto STRETTO), indipendentemente dai movimenti e da T.
//   - CU (R11.3): il flag `ordinato` (statoOrdini) NON cambia l'appartenenza:
//     per lo stesso prodotto la membership è identica che statoOrdini riporti
//     ordinato=true, ordinato=false o nessuna riga. La spunta determina solo il
//     valore del campo `ordinato`, mai la presenza in lista.
//   - Prodotti NON attivi (attivo=false) non compaiono mai (né CU né armadi).
//   - Armadi (R12.1): un prodotto ATTIVO con giacenza armadi G e soglia
//     giacenza_minima_armadi T appartiene a carenzaArmadi(...) SE E SOLO SE G < T.
//   - Armadi (R12.2): la lista armadi non ha alcuna spunta/flag che influenzi
//     l'appartenenza (nessun parametro di stato nella firma, output privo di
//     flag): la membership dipende solo da giacenza vs soglia.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { carenzaCu, carenzaArmadi } from "./checklists.js";
import { giacenzaCu, giacenzaArmadi } from "./giacenze.js";

// -----------------------------------------------------------------------------
// Generatori (arbitraries)
// -----------------------------------------------------------------------------

// Un pugno di id prodotto distinti su cui costruire anagrafica e movimenti.
const PRODOTTO_IDS = ["p1", "p2", "p3", "p4", "p5"];

// Soglia di giacenza minima: interi non negativi in un range ristretto, così da
// esercitare frequentemente sia il caso G < T sia G >= T.
const sogliaArb = fc.integer({ min: 0, max: 20 });

// Anagrafica di un prodotto per la carenza CU.
function prodottoCuArb(id) {
  return fc.record({
    id: fc.constant(id),
    nome: fc.constant(`Prodotto ${id}`),
    codice: fc.constant(`COD-${id}`),
    attivo: fc.boolean(),
    giacenza_minima_cu: sogliaArb,
  });
}

// Anagrafica di un prodotto per la carenza armadi.
function prodottoArmadiArb(id) {
  return fc.record({
    id: fc.constant(id),
    nome: fc.constant(`Prodotto ${id}`),
    codice: fc.constant(`COD-${id}`),
    attivo: fc.boolean(),
    giacenza_minima_armadi: sogliaArb,
  });
}

// Movimento CU: carico (+) o scarico (-), con lotto opzionale.
// Nota: i movimenti portano prodotto_id, così carenzaCu/giacenzaCu possono
// restringere al singolo prodotto (come il JOIN su prodotto_id).
function movimentoCuArb(ids) {
  return fc.record({
    prodotto_id: fc.constantFrom(...ids),
    tipo: fc.constantFrom("carico", "scarico"),
    quantita_base: fc.integer({ min: 1, max: 50 }),
    lotto: fc.option(fc.constantFrom("L1", "L2", "L3"), { nil: null }),
  });
}

// Movimento armadi: carico_automatico (+), prelievo (-), segnalazione (0).
function movimentoArmadiArb(ids) {
  return fc.record({
    prodotto_id: fc.constantFrom(...ids),
    tipo: fc.constantFrom("carico_automatico", "prelievo", "segnalazione"),
    quantita_base: fc.integer({ min: 0, max: 50 }),
  });
}

// Lista di prodotti CU su un sottoinsieme non vuoto di id distinti.
const prodottiCuArb = fc
  .subarray(PRODOTTO_IDS, { minLength: 1 })
  .chain((ids) => fc.tuple(...ids.map((id) => prodottoCuArb(id))));

const prodottiArmadiArb = fc
  .subarray(PRODOTTO_IDS, { minLength: 1 })
  .chain((ids) => fc.tuple(...ids.map((id) => prodottoArmadiArb(id))));

// Movimenti su tutti gli id possibili (anche prodotti non in anagrafica: devono
// semplicemente essere ignorati dalla derivazione).
const movimentiCuArb = fc.array(movimentoCuArb(PRODOTTO_IDS), { maxLength: 30 });
const movimentiArmadiArb = fc.array(movimentoArmadiArb(PRODOTTO_IDS), { maxLength: 30 });

// Stato ordini: per un sottoinsieme di id, un flag ordinato arbitrario.
const statoOrdiniArb = fc.array(
  fc.record({
    prodotto_id: fc.constantFrom(...PRODOTTO_IDS),
    ordinato: fc.boolean(),
  }),
  { maxLength: 8 },
);

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

function idsInLista(righe) {
  return new Set(righe.map((r) => r.prodotto_id));
}

function movimentiDi(movimenti, id) {
  return movimenti.filter((m) => m.prodotto_id === id);
}

// -----------------------------------------------------------------------------
// carenzaCu — Property 7 (R11.1, R11.3)
// -----------------------------------------------------------------------------

describe("carenzaCu — Property 7: membership iff giacenza < soglia (R11.1)", () => {
  it("un prodotto attivo è in lista SE E SOLO SE giacenza_cu < giacenza_minima_cu (stretto)", () => {
    fc.assert(
      fc.property(prodottiCuArb, movimentiCuArb, statoOrdiniArb, (prodotti, movimenti, stato) => {
        const righe = carenzaCu(prodotti, movimenti, stato);
        const presenti = idsInLista(righe);

        for (const p of prodotti) {
          const { totale: giacenza } = giacenzaCu(movimentiDi(movimenti, p.id));
          const atteso = p.attivo && giacenza < p.giacenza_minima_cu;
          expect(presenti.has(p.id)).toBe(atteso);
        }
      }),
    );
  });

  it("la riga riporta la giacenza calcolata e la soglia del prodotto", () => {
    fc.assert(
      fc.property(prodottiCuArb, movimentiCuArb, statoOrdiniArb, (prodotti, movimenti, stato) => {
        const righe = carenzaCu(prodotti, movimenti, stato);
        for (const r of righe) {
          const p = prodotti.find((x) => x.id === r.prodotto_id);
          const { totale: giacenza } = giacenzaCu(movimentiDi(movimenti, p.id));
          expect(r.giacenza).toBe(giacenza);
          expect(r.giacenza_minima_cu).toBe(p.giacenza_minima_cu);
          // Coerenza con il predicato di carenza stretta.
          expect(r.giacenza).toBeLessThan(r.giacenza_minima_cu);
        }
      }),
    );
  });

  it("prodotti non attivi non compaiono mai", () => {
    fc.assert(
      fc.property(prodottiCuArb, movimentiCuArb, statoOrdiniArb, (prodotti, movimenti, stato) => {
        const presenti = idsInLista(carenzaCu(prodotti, movimenti, stato));
        for (const p of prodotti) {
          if (!p.attivo) expect(presenti.has(p.id)).toBe(false);
        }
      }),
    );
  });
});

describe("carenzaCu — Property 7: `ordinato` non influenza la membership (R11.3)", () => {
  it("la membership è identica con statoOrdini true, false o assente", () => {
    fc.assert(
      fc.property(prodottiCuArb, movimentiCuArb, (prodotti, movimenti) => {
        const idsAttivi = prodotti.map((p) => p.id);

        const statoVuoto = [];
        const statoTuttiTrue = idsAttivi.map((id) => ({ prodotto_id: id, ordinato: true }));
        const statoTuttiFalse = idsAttivi.map((id) => ({ prodotto_id: id, ordinato: false }));

        const mVuoto = idsInLista(carenzaCu(prodotti, movimenti, statoVuoto));
        const mTrue = idsInLista(carenzaCu(prodotti, movimenti, statoTuttiTrue));
        const mFalse = idsInLista(carenzaCu(prodotti, movimenti, statoTuttiFalse));

        const set = (s) => Array.from(s).sort();
        // Stessa appartenenza in tutti e tre i casi.
        expect(set(mTrue)).toEqual(set(mVuoto));
        expect(set(mFalse)).toEqual(set(mVuoto));
      }),
    );
  });

  it("`ordinato` cambia SOLO il valore del campo, non la presenza della riga", () => {
    fc.assert(
      fc.property(prodottiCuArb, movimentiCuArb, (prodotti, movimenti) => {
        const idsAttivi = prodotti.map((p) => p.id);
        const statoTuttiTrue = idsAttivi.map((id) => ({ prodotto_id: id, ordinato: true }));

        const righeVuoto = carenzaCu(prodotti, movimenti, []);
        const righeTrue = carenzaCu(prodotti, movimenti, statoTuttiTrue);

        // Le righe presenti sono le stesse; cambia solo il flag `ordinato`.
        expect(idsInLista(righeTrue)).toEqual(idsInLista(righeVuoto));
        for (const r of righeVuoto) expect(r.ordinato).toBe(false);
        for (const r of righeTrue) expect(r.ordinato).toBe(true);
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// carenzaArmadi — Property 7 (R12.1, R12.2)
// -----------------------------------------------------------------------------

describe("carenzaArmadi — Property 7: membership iff giacenza < soglia (R12.1)", () => {
  it("un prodotto attivo è in lista SE E SOLO SE giacenza_armadi < giacenza_minima_armadi (stretto)", () => {
    fc.assert(
      fc.property(prodottiArmadiArb, movimentiArmadiArb, (prodotti, movimenti) => {
        const righe = carenzaArmadi(prodotti, movimenti);
        const presenti = idsInLista(righe);

        for (const p of prodotti) {
          const giacenza = giacenzaArmadi(movimentiDi(movimenti, p.id));
          const atteso = p.attivo && giacenza < p.giacenza_minima_armadi;
          expect(presenti.has(p.id)).toBe(atteso);
        }
      }),
    );
  });

  it("la riga riporta la giacenza calcolata e la soglia; nessun flag di spunta (R12.2)", () => {
    fc.assert(
      fc.property(prodottiArmadiArb, movimentiArmadiArb, (prodotti, movimenti) => {
        const righe = carenzaArmadi(prodotti, movimenti);
        for (const r of righe) {
          const p = prodotti.find((x) => x.id === r.prodotto_id);
          const giacenza = giacenzaArmadi(movimentiDi(movimenti, p.id));
          expect(r.giacenza).toBe(giacenza);
          expect(r.giacenza_minima_armadi).toBe(p.giacenza_minima_armadi);
          expect(r.giacenza).toBeLessThan(r.giacenza_minima_armadi);
          // Nessuna spunta che determini l'appartenenza: non esiste il campo `ordinato`.
          expect(r).not.toHaveProperty("ordinato");
        }
      }),
    );
  });

  it("prodotti non attivi non compaiono mai", () => {
    fc.assert(
      fc.property(prodottiArmadiArb, movimentiArmadiArb, (prodotti, movimenti) => {
        const presenti = idsInLista(carenzaArmadi(prodotti, movimenti));
        for (const p of prodotti) {
          if (!p.attivo) expect(presenti.has(p.id)).toBe(false);
        }
      }),
    );
  });

  it("nessuna spunta/stato altera l'output: un terzo argomento è ignorato (R12.2)", () => {
    // La membership armadi dipende solo da (prodotti, movimentiArmadi): un
    // eventuale terzo argomento "di stato/spunta" non deve cambiare il risultato.
    fc.assert(
      fc.property(
        prodottiArmadiArb,
        movimentiArmadiArb,
        // Qualsiasi "stato ordini" plausibile passato per errore come 3° arg.
        fc.array(
          fc.record({
            prodotto_id: fc.constantFrom(...PRODOTTO_IDS),
            ordinato: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        (prodotti, movimenti, statoSpurio) => {
          const baseline = carenzaArmadi(prodotti, movimenti);
          const conStato = carenzaArmadi(prodotti, movimenti, statoSpurio);
          expect(conStato).toEqual(baseline);
        },
      ),
    );
  });
});
