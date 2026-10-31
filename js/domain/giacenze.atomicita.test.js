// Property test dell'atomicità dello scarico CU per destinazione.
//
// Property 5 — Atomicità dello scarico CU per destinazione (design.md)
// Validates: Requirements 8.5, 8.6, 8.7
//
// Lo scarico atomico è implementato lato server dalla funzione RPC `scarico_cu`
// (backend: supabase/migrations/0012_rpc_scarico.sql). Qui non si testa la RPC,
// ma se ne MODELLA l'EFFETTO a livello di dominio, in modo puro, attraverso le
// righe di movimentazione che la RPC produrrebbe. Le righe vengono poi riaggregate
// con i riduttori puri di js/domain/giacenze.js (mirror delle viste Postgres),
// così da verificare che lo stato (giacenza_cu, giacenza_armadi) evolva come la
// semantica della migrazione 0012:
//
//   destinazione 'armadio_ripristino'
//     => una riga scarico CU  (effetto -q sulla giacenza_cu)
//     +  una riga carico_automatico armadi (effetto +q sulla giacenza_armadi)
//   destinazione 'associazione' | 'altro'
//     => solo una riga scarico CU (effetto -q sulla giacenza_cu)
//     => nessuna riga armadi (giacenza_armadi invariata)
//
// Atomicità (R8.6): la RPC esegue le due insert in un'unica transazione; qui il
// modello riflette il successo (entrambe le righe) — lo stato intermedio
// "solo scarico CU senza carico armadi" per destinazione armadio NON è mai
// osservabile, perché l'helper emette le righe insieme (tutto-o-niente).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { giacenzaCu, giacenzaArmadi } from "./giacenze.js";

const PRODOTTO = "prod-1";

/**
 * Modello PURO dell'effetto della RPC scarico_cu (mirror di 0012).
 * Produce le righe di movimentazione risultanti da uno scarico di quantità q
 * dal lotto indicato, con una data destinazione.
 *
 * @param {object} args
 * @param {string} args.prodottoId
 * @param {number} args.quantita quantità base scaricata (q >= 1)
 * @param {string|null} args.lotto lotto da cui si scarica
 * @param {'armadio_ripristino'|'associazione'|'altro'} args.destinazione
 * @returns {{ movimentiCu: Array<object>, movimentiArmadi: Array<object> }}
 *          righe di movimentazione da aggiungere ai registri
 */
function effettoScarico({ prodottoId, quantita, lotto, destinazione }) {
  // Riga di scarico CU: presente per OGNI destinazione (effetto -q su giacenza_cu).
  const rigaScaricoCu = {
    prodotto_id: prodottoId,
    tipo: "scarico",
    quantita_base: quantita,
    lotto,
    destinazione,
  };

  // Carico automatico negli armadi SOLO per destinazione armadio_ripristino (R8.5).
  if (destinazione === "armadio_ripristino") {
    return {
      movimentiCu: [rigaScaricoCu],
      movimentiArmadi: [
        {
          prodotto_id: prodottoId,
          tipo: "carico_automatico",
          quantita_base: quantita,
        },
      ],
    };
  }

  // associazione | altro: solo scarico CU, nessuna riga armadi (R8.7).
  return { movimentiCu: [rigaScaricoCu], movimentiArmadi: [] };
}

// -----------------------------------------------------------------------------
// Generatori vincolati allo spazio valido degli input.
// -----------------------------------------------------------------------------

// Lotto: una stringa non vuota oppure "nessun lotto" (null).
const lottoGen = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0)
);

// Seed di carichi iniziali per il lotto scelto: danno la giacenza del lotto
// (quindi un limite superiore per q) e, sommati, la giacenza CU totale S.
// Un carico "extra" su un altro lotto garantisce che S possa superare la
// giacenza del singolo lotto (lo scarico non deve andare sotto zero sul lotto).
const caricoQtyGen = fc.integer({ min: 1, max: 5000 });

describe("scarico CU — Property 5: atomicità per destinazione", () => {
  it("destinazione armadio_ripristino: giacenza_cu == S - q e giacenza_armadi == A + q", () => {
    fc.assert(
      fc.property(
        lottoGen,
        caricoQtyGen, // carico sul lotto scelto -> determina giacenzaLotto
        caricoQtyGen, // carico su un altro lotto -> rende S > giacenzaLotto
        fc.integer({ min: 0, max: 5000 }), // giacenza armadi iniziale A
        fc.double({ min: 0, max: 1, noNaN: true }), // frazione per scegliere q in [1, giacenzaLotto]
        (lotto, qLotto, qAltroLotto, A, frazione) => {
          // Stato iniziale CU: due carichi su lotti distinti del prodotto.
          const altroLotto = lotto === null ? "LOTTO-X" : `${lotto}#altro`;
          const movimentiCu = [
            { prodotto_id: PRODOTTO, tipo: "carico", quantita_base: qLotto, lotto },
            { prodotto_id: PRODOTTO, tipo: "carico", quantita_base: qAltroLotto, lotto: altroLotto },
          ];
          // Stato iniziale armadi: eventuale carico automatico pregresso.
          const movimentiArmadi =
            A > 0
              ? [{ prodotto_id: PRODOTTO, tipo: "carico_automatico", quantita_base: A }]
              : [];

          const S = giacenzaCu(movimentiCu).totale;
          const Ainiziale = giacenzaArmadi(movimentiArmadi);
          expect(Ainiziale).toBe(A);

          // q nell'intervallo valido [1, giacenzaLotto]: lo scarico non porta il lotto sotto zero.
          const q = 1 + Math.floor(frazione * (qLotto - 1));

          const eff = effettoScarico({
            prodottoId: PRODOTTO,
            quantita: q,
            lotto,
            destinazione: "armadio_ripristino",
          });

          const cuDopo = giacenzaCu([...movimentiCu, ...eff.movimentiCu]).totale;
          const armadiDopo = giacenzaArmadi([...movimentiArmadi, ...eff.movimentiArmadi]);

          // Entrambe le transizioni insieme (atomicità del successo).
          expect(cuDopo).toBe(S - q);
          expect(armadiDopo).toBe(A + q);
        }
      )
    );
  });

  it("destinazione associazione/altro: giacenza_cu == S - q e giacenza_armadi invariata (A)", () => {
    fc.assert(
      fc.property(
        lottoGen,
        caricoQtyGen,
        caricoQtyGen,
        fc.integer({ min: 0, max: 5000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("associazione", "altro"),
        (lotto, qLotto, qAltroLotto, A, frazione, destinazione) => {
          const altroLotto = lotto === null ? "LOTTO-X" : `${lotto}#altro`;
          const movimentiCu = [
            { prodotto_id: PRODOTTO, tipo: "carico", quantita_base: qLotto, lotto },
            { prodotto_id: PRODOTTO, tipo: "carico", quantita_base: qAltroLotto, lotto: altroLotto },
          ];
          const movimentiArmadi =
            A > 0
              ? [{ prodotto_id: PRODOTTO, tipo: "carico_automatico", quantita_base: A }]
              : [];

          const S = giacenzaCu(movimentiCu).totale;
          expect(giacenzaArmadi(movimentiArmadi)).toBe(A);

          const q = 1 + Math.floor(frazione * (qLotto - 1));

          const eff = effettoScarico({
            prodottoId: PRODOTTO,
            quantita: q,
            lotto,
            destinazione,
          });

          const cuDopo = giacenzaCu([...movimentiCu, ...eff.movimentiCu]).totale;
          const armadiDopo = giacenzaArmadi([...movimentiArmadi, ...eff.movimentiArmadi]);

          // Solo la giacenza_cu cambia; gli armadi restano invariati (nessuna riga emessa).
          expect(cuDopo).toBe(S - q);
          expect(armadiDopo).toBe(A);
          expect(eff.movimentiArmadi).toHaveLength(0);
        }
      )
    );
  });

  it("invariante trasversale: lo scarico decrementa SEMPRE la giacenza_cu di q", () => {
    fc.assert(
      fc.property(
        lottoGen,
        caricoQtyGen,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("armadio_ripristino", "associazione", "altro"),
        (lotto, qLotto, frazione, destinazione) => {
          const movimentiCu = [
            { prodotto_id: PRODOTTO, tipo: "carico", quantita_base: qLotto, lotto },
          ];
          const S = giacenzaCu(movimentiCu).totale;
          const q = 1 + Math.floor(frazione * (qLotto - 1));

          const eff = effettoScarico({
            prodottoId: PRODOTTO,
            quantita: q,
            lotto,
            destinazione,
          });

          const cuDopo = giacenzaCu([...movimentiCu, ...eff.movimentiCu]).totale;
          expect(cuDopo).toBe(S - q);
          // giacenza del lotto scaricato mai sotto zero (q <= qLotto).
          expect(cuDopo).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});
