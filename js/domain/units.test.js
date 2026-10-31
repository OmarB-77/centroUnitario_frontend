// Property test della logica di conversione unità (js/domain/units.js).
//
// Property 2 — Conversione unità coerente (design.md)
// Validates: Requirements 7.1, 7.13, 1.13, 1.14
//
// Per ogni quantità intera q in [1, 999999] e fattore pezzi_per_confezione >= 1,
// la conversione in unità base restituisce:
//   - q                         quando unita_inserimento === 'unita_base'
//   - q * pezzi_per_confezione  quando unita_inserimento === 'unita_carico'
// con unita_carico uguale a unita_base (fattore 1) la quantità resta invariata.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  quantitaInBase,
  caricoInBase,
  UNITA_BASE,
  UNITA_CARICO,
  QUANTITA_MIN,
  QUANTITA_MAX,
} from "./units.js";

// Generatori vincolati all'insieme valido degli input.
// q*ppc resta ampiamente entro Number.MAX_SAFE_INTEGER (~9e15):
// max 999999 * 1000 ≈ 1e9, quindi i prodotti sono esatti (nessun falso fallimento).
const qValida = fc.integer({ min: QUANTITA_MIN, max: QUANTITA_MAX });
const ppcValido = fc.integer({ min: 1, max: 1000 });

describe("quantitaInBase — Property 2: conversione unità coerente", () => {
  it("identità: unita_base restituisce q per ogni q valido e ppc>=1", () => {
    fc.assert(
      fc.property(qValida, ppcValido, (q, ppc) => {
        expect(quantitaInBase(q, UNITA_BASE, ppc)).toBe(q);
      })
    );
  });

  it("scaling: unita_carico restituisce q*ppc ed è divisibile per ppc", () => {
    fc.assert(
      fc.property(qValida, ppcValido, (q, ppc) => {
        const base = quantitaInBase(q, UNITA_CARICO, ppc);
        expect(base).toBe(q * ppc);
        expect(base % ppc).toBe(0);
      })
    );
  });

  it("fattore 1 (unita_carico ≡ unita_base): nessuna perdita, q invariato", () => {
    fc.assert(
      fc.property(qValida, (q) => {
        expect(quantitaInBase(q, UNITA_CARICO, 1)).toBe(q);
        expect(quantitaInBase(q, UNITA_BASE, 1)).toBe(q);
      })
    );
  });

  it("round-trip: dividere il risultato unita_carico per ppc ridà q", () => {
    fc.assert(
      fc.property(qValida, ppcValido, (q, ppc) => {
        const base = quantitaInBase(q, UNITA_CARICO, ppc);
        expect(base / ppc).toBe(q);
      })
    );
  });

  it("nessuna perdita su interi positivi: il risultato è intero >= q", () => {
    fc.assert(
      fc.property(qValida, ppcValido, (q, ppc) => {
        const base = quantitaInBase(q, UNITA_CARICO, ppc);
        expect(Number.isInteger(base)).toBe(true);
        expect(base).toBeGreaterThanOrEqual(q);
      })
    );
  });
});

describe("caricoInBase — equivalenza con quantitaInBase(...,'unita_carico',...)", () => {
  it("caricoInBase(q, ppc) === quantitaInBase(q, 'unita_carico', ppc)", () => {
    fc.assert(
      fc.property(qValida, ppcValido, (q, ppc) => {
        expect(caricoInBase(q, ppc)).toBe(quantitaInBase(q, UNITA_CARICO, ppc));
      })
    );
  });
});

describe("quantitaInBase — input non validi sollevano errore", () => {
  it("unità mancante/invalida lancia", () => {
    fc.assert(
      fc.property(
        qValida,
        ppcValido,
        fc.constantFrom(undefined, null, "", "unita_strana", "UNITA_BASE", 0, 42),
        (q, ppc, unita) => {
          expect(() => quantitaInBase(q, unita, ppc)).toThrow();
        }
      )
    );
  });

  it("quantità non intera o fuori range [1, 999999] lancia", () => {
    const qNonValida = fc.oneof(
      fc.double({ noInteger: true, noNaN: true }), // non intero
      fc.integer({ min: QUANTITA_MAX + 1, max: QUANTITA_MAX + 1_000_000 }), // troppo grande
      fc.integer({ min: -1_000_000, max: QUANTITA_MIN - 1 }), // <= 0
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, "10", null, undefined)
    );
    fc.assert(
      fc.property(
        qNonValida,
        fc.constantFrom(UNITA_BASE, UNITA_CARICO),
        ppcValido,
        (q, unita, ppc) => {
          expect(() => quantitaInBase(q, unita, ppc)).toThrow();
        }
      )
    );
  });

  it("pezzi_per_confezione non intero o < 1 lancia", () => {
    const ppcNonValido = fc.oneof(
      fc.double({ noInteger: true, noNaN: true }),
      fc.integer({ min: -1000, max: 0 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, "2", null, undefined)
    );
    fc.assert(
      fc.property(
        qValida,
        fc.constantFrom(UNITA_BASE, UNITA_CARICO),
        ppcNonValido,
        (q, unita, ppc) => {
          expect(() => quantitaInBase(q, unita, ppc)).toThrow();
        }
      )
    );
  });
});
