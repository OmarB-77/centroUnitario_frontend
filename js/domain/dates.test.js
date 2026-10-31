// Property test della logica di dominio delle date e della scadenza effettiva.
//
// Runner: Vitest. Property-based: fast-check.
// Modulo sotto test: js/domain/dates.js (funzione pura, mirror del trigger DB
// 0007_trigger_scadenza.sql).
//
// Property 6: Data di scadenza effettiva al carico
// Validates: Requirements 7.1, 7.7, 7.8
//
// Le date "civili" sono sempre stringhe 'YYYY-MM-DD' costruite da componenti
// locali: nessun uso di toISOString()/UTC.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  scadenzaEffettiva,
  toYmd,
  parseYmd,
  addYears,
} from "./dates.js";

// ---------------------------------------------------------------------------
// Generatori di date civili valide 'YYYY-MM-DD'
// ---------------------------------------------------------------------------

/** Giorni nel mese (gestisce bisestili), coerente con la logica del modulo. */
function giorniNelMese(y, m) {
  return new Date(y, m, 0).getDate();
}

/** Formatta una tripletta {y,m,d} in 'YYYY-MM-DD' (zero-padding). */
function fmt(y, m, d) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}`;
}

/**
 * Arbitrary di date civili valide in [1970-01-01, 2100-12-31]:
 * costruisce anno/mese e poi il giorno vincolato ai giorni effettivi del mese.
 */
const arbYmd = fc
  .record({
    y: fc.integer({ min: 1970, max: 2100 }),
    m: fc.integer({ min: 1, max: 12 }),
  })
  .chain(({ y, m }) =>
    fc
      .integer({ min: 1, max: giorniNelMese(y, m) })
      .map((d) => ({ y, m, d, str: fmt(y, m, d) })),
  );

/**
 * Come arbYmd ma esclude il 29 febbraio, così da avere un comportamento
 * round-trip stabile sotto addYears (nessun clamp bisestile).
 * Inoltre limita l'anno in modo che +/-5 anni resti nel range gestibile.
 */
const arbYmdNoFeb29 = fc
  .record({
    y: fc.integer({ min: 1975, max: 2095 }),
    m: fc.integer({ min: 1, max: 12 }),
  })
  .chain(({ y, m }) =>
    fc
      .integer({ min: 1, max: giorniNelMese(y, m) })
      .map((d) => ({ y, m, d, str: fmt(y, m, d) })),
  )
  .filter(({ m, d }) => !(m === 2 && d === 29));

// ---------------------------------------------------------------------------
// Property 6: scadenzaEffettiva
// Validates: Requirements 7.1, 7.7, 7.8
// ---------------------------------------------------------------------------

describe("Property 6: scadenzaEffettiva (Requirements 7.1, 7.7, 7.8)", () => {
  it("con scadenza ⇒ pari alla data di scadenza (normalizzata)", () => {
    fc.assert(
      fc.property(arbYmd, ({ str }) => {
        const atteso = toYmd(parseYmd(str));
        const out = scadenzaEffettiva({ senzaScadenza: false, dataScadenza: str });
        expect(out).toBe(atteso);
      }),
    );
  });

  it("senza scadenza, senza override ⇒ data di produzione + 5 anni", () => {
    fc.assert(
      fc.property(arbYmd, ({ str }) => {
        const atteso = addYears(str, 5);
        const out = scadenzaEffettiva({ senzaScadenza: true, dataProduzione: str });
        expect(out).toBe(atteso);
      }),
    );
  });

  it("senza scadenza, con override ⇒ valore fornito (normalizzato), prevale sulla produzione", () => {
    fc.assert(
      fc.property(arbYmd, arbYmd, ({ str: prod }, { str: over }) => {
        const atteso = toYmd(parseYmd(over));
        const out = scadenzaEffettiva({
          senzaScadenza: true,
          dataProduzione: prod,
          override: over,
        });
        expect(out).toBe(atteso);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// toYmd / parseYmd: round-trip e assenza di UTC
// ---------------------------------------------------------------------------

describe("toYmd / parseYmd (date civili, nessun UTC)", () => {
  it("round-trip parseYmd(toYmd({y,m,d})) === {y,m,d} per date valide", () => {
    fc.assert(
      fc.property(arbYmd, ({ y, m, d }) => {
        const round = parseYmd(toYmd({ y, m, d }));
        expect(round).toEqual({ y, m, d });
      }),
    );
  });

  it("toYmd usa i componenti LOCALI: un Date a mezzanotte locale formatta lo stesso giorno", () => {
    fc.assert(
      fc.property(arbYmd, ({ y, m, d }) => {
        // Date costruita per componenti = mezzanotte locale (nessuno slittamento UTC).
        const local = new Date(y, m - 1, d);
        expect(toYmd(local)).toBe(fmt(y, m, d));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// addYears: inverso +5/-5 su date non-29-febbraio
// ---------------------------------------------------------------------------

describe("addYears (inverso su date non 29/02)", () => {
  it("addYears(addYears(x, 5), -5) === x per date senza clamp bisestile", () => {
    fc.assert(
      fc.property(arbYmdNoFeb29, ({ str }) => {
        const avanti = addYears(str, 5);
        const indietro = addYears(avanti, -5);
        expect(indietro).toBe(str);
      }),
    );
  });

  it("clamp esplicito del 29/02: 2020-02-29 + 1 anno ⇒ 2021-02-28", () => {
    expect(addYears("2020-02-29", 1)).toBe("2021-02-28");
  });
});
