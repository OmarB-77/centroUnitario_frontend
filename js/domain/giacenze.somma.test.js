// Property test del modello di dominio delle giacenze (js/domain/giacenze.js).
//
// Property 1 — Giacenza come somma algebrica dei movimenti (design.md)
// Validates: Requirements 10.1, 10.2, 10.3, 10.4
//
// Per ogni lista di movimenti di un prodotto, la giacenza calcolata è pari alla
// somma algebrica con segno delle quantità in unità base:
//   - CU:     carico (+), scarico (-)
//   - armadi: carico_automatico (+), prelievo (-), segnalazione (0)
// Il risultato è invariante per permutazione dell'ordine dei movimenti
// (la somma algebrica è commutativa) e per il CU la somma delle giacenze
// per lotto coincide col totale.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { giacenzaCu, giacenzaArmadi } from "./giacenze.js";

// -----------------------------------------------------------------------------
// Generatori vincolati all'insieme valido degli input.
// Limitiamo il numero di movimenti (<= 50) e quantita_base a [1, 999999] così
// che le somme restino ampiamente entro Number.MAX_SAFE_INTEGER (~9e15):
// 50 * 999999 ≈ 5e7, quindi nessun falso fallimento per arrotondamento.
// -----------------------------------------------------------------------------

const PRODOTTO_ID = "11111111-1111-1111-1111-111111111111";

// Insieme ristretto di lotti, incluso null (gruppo "senza lotto").
const lottoArb = fc.constantFrom(null, "L1", "L2", "L3");

const quantitaArb = fc.integer({ min: 1, max: 999999 });

// Movimento CU: tipo in {carico, scarico}, con lotto.
const movCuArb = fc.record({
  prodotto_id: fc.constant(PRODOTTO_ID),
  tipo: fc.constantFrom("carico", "scarico"),
  quantita_base: quantitaArb,
  lotto: lottoArb,
});

// Movimento armadi: tipo in {carico_automatico, prelievo, segnalazione}.
// La segnalazione può avere quantita_base null/0 (non altera la giacenza).
const movArmadiArb = fc.record({
  prodotto_id: fc.constant(PRODOTTO_ID),
  tipo: fc.constantFrom("carico_automatico", "prelievo", "segnalazione"),
  quantita_base: fc.oneof(quantitaArb, fc.constant(null), fc.constant(0)),
});

const movimentiCuArb = fc.array(movCuArb, { maxLength: 50 });
const movimentiArmadiArb = fc.array(movArmadiArb, { maxLength: 50 });

// Restituisce una permutazione dell'array `arr` guidata dai valori casuali in
// `keys` (stessa lunghezza di `arr`): ordina gli indici per chiave. Così la
// permutazione è deterministica rispetto a un input generato da fast-check,
// e `arr` resta invariato (shuffle non in place).
function permuta(arr, keys) {
  return arr
    .map((valore, i) => ({ valore, k: keys[i] }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.valore);
}

// Genera una coppia {movimenti, keys} con keys della stessa lunghezza, usata
// per ottenere una permutazione dei movimenti nello stesso test di proprietà.
function conChiaviDiPermutazione(movArb) {
  return fc
    .array(movArb, { maxLength: 50 })
    .chain((movimenti) =>
      fc
        .array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: movimenti.length,
          maxLength: movimenti.length,
        })
        .map((keys) => ({ movimenti, keys }))
    );
}

const cuConPermutazioneArb = conChiaviDiPermutazione(movCuArb);
const armadiConPermutazioneArb = conChiaviDiPermutazione(movArmadiArb);

// Riferimento indipendente: somma algebrica attesa per il CU.
function sommaAttesaCu(movimenti) {
  return movimenti.reduce((acc, m) => {
    const q = Number(m.quantita_base) || 0;
    return acc + (m.tipo === "carico" ? q : -q);
  }, 0);
}

// Riferimento indipendente: somma algebrica attesa per gli armadi.
function sommaAttesaArmadi(movimenti) {
  return movimenti.reduce((acc, m) => {
    const q = Number(m.quantita_base) || 0;
    if (m.tipo === "carico_automatico") return acc + q;
    if (m.tipo === "prelievo") return acc - q;
    return acc; // segnalazione: 0
  }, 0);
}

describe("giacenzaCu — Property 1: giacenza come somma algebrica", () => {
  it("il totale è la somma con segno (carico +, scarico -) dei movimenti", () => {
    fc.assert(
      fc.property(movimentiCuArb, (movimenti) => {
        expect(giacenzaCu(movimenti).totale).toBe(sommaAttesaCu(movimenti));
      })
    );
  });

  it("lista vuota -> totale 0 e nessun lotto (R10.4)", () => {
    expect(giacenzaCu([])).toEqual({ totale: 0, perLotto: [] });
  });

  it("invariante per permutazione dell'ordine dei movimenti", () => {
    fc.assert(
      fc.property(cuConPermutazioneArb, ({ movimenti, keys }) => {
        const atteso = giacenzaCu(movimenti).totale;
        const permutato = permuta(movimenti, keys);
        expect(giacenzaCu(permutato).totale).toBe(atteso);
      })
    );
  });

  it("la somma delle giacenze per lotto coincide col totale", () => {
    fc.assert(
      fc.property(movimentiCuArb, (movimenti) => {
        const { totale, perLotto } = giacenzaCu(movimenti);
        const sommaPerLotto = perLotto.reduce((acc, p) => acc + p.giacenza, 0);
        expect(sommaPerLotto).toBe(totale);
      })
    );
  });
});

describe("giacenzaArmadi — Property 1: giacenza come somma algebrica", () => {
  it("il totale è carico_automatico(+) - prelievo(-), segnalazione 0", () => {
    fc.assert(
      fc.property(movimentiArmadiArb, (movimenti) => {
        expect(giacenzaArmadi(movimenti)).toBe(sommaAttesaArmadi(movimenti));
      })
    );
  });

  it("lista vuota -> 0 (R10.4)", () => {
    expect(giacenzaArmadi([])).toBe(0);
  });

  it("le sole segnalazioni non alterano la giacenza (contributo 0)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            prodotto_id: fc.constant(PRODOTTO_ID),
            tipo: fc.constant("segnalazione"),
            quantita_base: fc.oneof(quantitaArb, fc.constant(null), fc.constant(0)),
          }),
          { maxLength: 50 }
        ),
        (segnalazioni) => {
          expect(giacenzaArmadi(segnalazioni)).toBe(0);
        }
      )
    );
  });

  it("invariante per permutazione dell'ordine dei movimenti", () => {
    fc.assert(
      fc.property(armadiConPermutazioneArb, ({ movimenti, keys }) => {
        const atteso = giacenzaArmadi(movimenti);
        const permutato = permuta(movimenti, keys);
        expect(giacenzaArmadi(permutato)).toBe(atteso);
      })
    );
  });
});
