// Property test della non-negatività delle giacenze (js/domain/giacenze.js).
//
// Property 4 — Giacenza mai negativa (design.md)
// Validates: Requirements 8.2, 8.3, 9.5
//
// Mirror a livello di dominio PURO del trigger anti-giacenza-negativa del backend
// (migrazione 0008_trigger_antinegativa.sql): `BEFORE INSERT` sui movimenti di
// `scarico` CU (per lotto selezionato, R8.2) e di `prelievo` armadi (R9.5),
// che calcola la giacenza risultante e rifiuta l'operazione se scenderebbe
// sotto zero (R8.3).
//
// Non esiste (ancora) un mutatore "applica scarico" nel dominio: la proprietà è
// modellata con un piccolo PREDICATO GUARDIA locale definito nel test, che —
// data la lista corrente dei movimenti e una proposta di scarico/prelievo di
// quantità q — è ammessa se e solo se q <= giacenza corrente. Questo replica
// esattamente il predicato del trigger DB.
//
// Due invarianti verificate:
//   1) applicando SOLO scarichi/prelievi ammessi (q <= giacenza corrente),
//      la giacenza risultante resta >= 0;
//   2) uno scarico/prelievo ECCEDENTE (q' > giacenza corrente) viene respinto
//      dal predicato guardia (ammesso === false), e quindi non viene applicato.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { giacenzaLotto, giacenzaArmadi } from "./giacenze.js";

// -----------------------------------------------------------------------------
// Predicato guardia locale (mirror del trigger DB 0008).
// Ammette uno scarico/prelievo di quantità q solo se non porta la giacenza
// corrente sotto zero, cioè q <= giacenza. q deve essere un intero >= 1
// (coerente con il CHECK quantita_base BETWEEN 1 AND 999999 del backend).
// -----------------------------------------------------------------------------

/** Scarico CU su un lotto ammesso se q <= giacenza residua del lotto (R8.2, R8.3). */
function scaricoCuAmmesso(movimentiCu, prodottoId, lotto, q) {
  return q <= giacenzaLotto(movimentiCu, prodottoId, lotto);
}

/** Prelievo armadi ammesso se q <= giacenza armadi (R9.5). */
function prelievoArmadiAmmesso(movimentiArmadi, q) {
  return q <= giacenzaArmadi(movimentiArmadi);
}

// -----------------------------------------------------------------------------
// Generatori vincolati all'insieme valido degli input.
// -----------------------------------------------------------------------------

const PRODOTTO_ID = "p1";
const qPos = fc.integer({ min: 1, max: 999999 }); // quantità di movimento (unità base)
const lottoGen = fc.constantFrom("L1", "L2", null); // include il lotto "senza lotto"

// Sequenza di carichi CU per un singolo prodotto/lotto.
function carichiCuGen(lotto) {
  return fc.array(
    qPos.map((q) => ({
      prodotto_id: PRODOTTO_ID,
      tipo: "carico",
      quantita_base: q,
      lotto,
    })),
    { minLength: 0, maxLength: 12 }
  );
}

// Sequenza di soli carichi_automatici per gli armadi di un prodotto.
const carichiArmadiGen = fc.array(
  qPos.map((q) => ({
    prodotto_id: PRODOTTO_ID,
    tipo: "carico_automatico",
    quantita_base: q,
  })),
  { minLength: 0, maxLength: 12 }
);

// -----------------------------------------------------------------------------
// R8.2 / R8.3 — Scarico CU per lotto
// -----------------------------------------------------------------------------

describe("Property 4 (CU per lotto): giacenza mai negativa", () => {
  it("scarico ammesso (q <= giacenza del lotto) mantiene la giacenza >= 0", () => {
    fc.assert(
      fc.property(lottoGen, qPos, (lotto, qScarico) => {
        return fc.assert(
          fc.property(carichiCuGen(lotto), (carichi) => {
            const giacenzaPrima = giacenzaLotto(carichi, PRODOTTO_ID, lotto);
            // Consideriamo solo gli scarichi ammessi dal predicato guardia.
            fc.pre(scaricoCuAmmesso(carichi, PRODOTTO_ID, lotto, qScarico));

            const dopo = [
              ...carichi,
              {
                prodotto_id: PRODOTTO_ID,
                tipo: "scarico",
                quantita_base: qScarico,
                lotto,
              },
            ];
            const giacenzaDopo = giacenzaLotto(dopo, PRODOTTO_ID, lotto);

            expect(giacenzaDopo).toBe(giacenzaPrima - qScarico);
            expect(giacenzaDopo).toBeGreaterThanOrEqual(0);
          }),
          { numRuns: 50 }
        );
      })
    );
  });

  it("scarico eccedente (q' > giacenza del lotto) viene rifiutato dal predicato guardia", () => {
    fc.assert(
      fc.property(lottoGen, fc.integer({ min: 1, max: 100000 }), (lotto, extra) => {
        return fc.assert(
          fc.property(carichiCuGen(lotto), (carichi) => {
            const giacenza = giacenzaLotto(carichi, PRODOTTO_ID, lotto);
            const qEccedente = giacenza + extra; // strettamente > giacenza

            // Il predicato guardia (mirror del trigger) deve rifiutare.
            expect(scaricoCuAmmesso(carichi, PRODOTTO_ID, lotto, qEccedente)).toBe(false);

            // Se (ipoteticamente) venisse applicato, porterebbe sotto zero:
            // lo verifichiamo per rendere esplicito il motivo del rifiuto.
            const dopoIpotetico = [
              ...carichi,
              {
                prodotto_id: PRODOTTO_ID,
                tipo: "scarico",
                quantita_base: qEccedente,
                lotto,
              },
            ];
            expect(giacenzaLotto(dopoIpotetico, PRODOTTO_ID, lotto)).toBeLessThan(0);
          }),
          { numRuns: 50 }
        );
      })
    );
  });

  it("sequenza di scarichi tutti ammessi: la giacenza resta sempre >= 0", () => {
    fc.assert(
      fc.property(
        lottoGen,
        carichiCuGen("L1"), // base di carichi
        fc.array(qPos, { minLength: 0, maxLength: 10 }),
        (lotto, carichiBase, richiesteScarico) => {
          // Normalizziamo i carichi sul lotto in esame.
          const movimenti = carichiBase.map((m) => ({ ...m, lotto }));

          for (const q of richiesteScarico) {
            if (scaricoCuAmmesso(movimenti, PRODOTTO_ID, lotto, q)) {
              movimenti.push({
                prodotto_id: PRODOTTO_ID,
                tipo: "scarico",
                quantita_base: q,
                lotto,
              });
            }
            // Dopo ogni applicazione ammessa, la giacenza non è mai negativa.
            expect(
              giacenzaLotto(movimenti, PRODOTTO_ID, lotto)
            ).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });
});

// -----------------------------------------------------------------------------
// R9.5 — Prelievo armadi
// -----------------------------------------------------------------------------

describe("Property 4 (armadi): giacenza mai negativa", () => {
  it("prelievo ammesso (q <= giacenza armadi) mantiene la giacenza >= 0", () => {
    fc.assert(
      fc.property(carichiArmadiGen, qPos, (carichi, qPrelievo) => {
        const giacenzaPrima = giacenzaArmadi(carichi);
        fc.pre(prelievoArmadiAmmesso(carichi, qPrelievo));

        const dopo = [
          ...carichi,
          { prodotto_id: PRODOTTO_ID, tipo: "prelievo", quantita_base: qPrelievo },
        ];
        const giacenzaDopo = giacenzaArmadi(dopo);

        expect(giacenzaDopo).toBe(giacenzaPrima - qPrelievo);
        expect(giacenzaDopo).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("prelievo eccedente (q' > giacenza armadi) viene rifiutato dal predicato guardia", () => {
    fc.assert(
      fc.property(
        carichiArmadiGen,
        fc.integer({ min: 1, max: 100000 }),
        (carichi, extra) => {
          const giacenza = giacenzaArmadi(carichi);
          const qEccedente = giacenza + extra;

          expect(prelievoArmadiAmmesso(carichi, qEccedente)).toBe(false);

          const dopoIpotetico = [
            ...carichi,
            {
              prodotto_id: PRODOTTO_ID,
              tipo: "prelievo",
              quantita_base: qEccedente,
            },
          ];
          expect(giacenzaArmadi(dopoIpotetico)).toBeLessThan(0);
        }
      )
    );
  });

  it("segnalazione non altera la giacenza e non viola la non-negatività", () => {
    fc.assert(
      fc.property(carichiArmadiGen, qPos, (carichi, q) => {
        const prima = giacenzaArmadi(carichi);
        const dopo = giacenzaArmadi([
          ...carichi,
          { prodotto_id: PRODOTTO_ID, tipo: "segnalazione", quantita_base: q },
        ]);
        expect(dopo).toBe(prima);
        expect(dopo).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("sequenza di prelievi tutti ammessi: la giacenza resta sempre >= 0", () => {
    fc.assert(
      fc.property(
        carichiArmadiGen,
        fc.array(qPos, { minLength: 0, maxLength: 10 }),
        (carichiBase, richiestePrelievo) => {
          const movimenti = [...carichiBase];
          for (const q of richiestePrelievo) {
            if (prelievoArmadiAmmesso(movimenti, q)) {
              movimenti.push({
                prodotto_id: PRODOTTO_ID,
                tipo: "prelievo",
                quantita_base: q,
              });
            }
            expect(giacenzaArmadi(movimenti)).toBeGreaterThanOrEqual(0);
          }
        }
      )
    );
  });
});
