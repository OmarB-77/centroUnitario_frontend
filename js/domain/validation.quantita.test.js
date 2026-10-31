// Property test — Validazione quantità movimento (Property 3)
//
// **Validates: Requirements 7.3, 9.3, 1.7, 1.8**
//
// Verifica la funzione pura `validaQuantita(n)` di js/domain/validation.js:
//   accetta SOLO interi compresi in [QUANTITA_MIN, QUANTITA_MAX] = [1, 999999];
//   rifiuta zero, negativi, interi fuori range, numeri non interi (float con
//   parte frazionaria, NaN, Infinity) e input non numerici.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validaQuantita, LIMITI } from "./validation.js";

const { QUANTITA_MIN, QUANTITA_MAX } = LIMITI;

describe("validaQuantita — property test (Property 3)", () => {
  it("accetta ogni intero in [1, 999999]: ok === true e errors vuoto", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: QUANTITA_MIN, max: QUANTITA_MAX }),
        (n) => {
          const r = validaQuantita(n);
          expect(r.ok).toBe(true);
          expect(r.errors).toEqual([]);
        },
      ),
    );
  });

  it("rifiuta ogni intero <= 0 oppure > 999999: ok === false e errors non vuoto", () => {
    const fuoriRange = fc.oneof(
      // n <= 0 (include lo zero e i negativi)
      fc.integer({ min: -1_000_000_000, max: QUANTITA_MIN - 1 }),
      // n > QUANTITA_MAX
      fc.integer({ min: QUANTITA_MAX + 1, max: 2_000_000_000 }),
    );
    fc.assert(
      fc.property(fuoriRange, (n) => {
        const r = validaQuantita(n);
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
      }),
    );
  });

  it("rifiuta i numeri non interi (float con parte frazionaria): ok === false", () => {
    const nonIntero = fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .filter((x) => !Number.isInteger(x));
    fc.assert(
      fc.property(nonIntero, (n) => {
        const r = validaQuantita(n);
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
      }),
    );
  });

  it("rifiuta NaN e Infinity: ok === false", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(NaN, Infinity, -Infinity),
        (n) => {
          const r = validaQuantita(n);
          expect(r.ok).toBe(false);
          expect(r.errors.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("rifiuta input non numerici (string, null, undefined, boolean): ok === false", () => {
    const nonNumero = fc.oneof(
      fc.string(),
      fc.constant(null),
      fc.constant(undefined),
      fc.boolean(),
    );
    fc.assert(
      fc.property(nonNumero, (v) => {
        const r = validaQuantita(v);
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
      }),
    );
  });
});
