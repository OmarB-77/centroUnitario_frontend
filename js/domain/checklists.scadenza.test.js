// Property test di membership della check-list di prossima scadenza per LOTTO.
//
// Runner: Vitest. Property-based: fast-check.
// Modulo sotto test: js/domain/checklists.js -> scadenzaPerLotto(prodotti, movimentiCu, oggi)
// Riusa js/domain/dates.js (diffGiorni, toYmd, addYears) e la logica di
// giacenza per lotto di js/domain/giacenze.js (giacenzaLotto).
//
// Property 11.13: Membership della Check_List_Scadenza per lotto
// Validates: Requirements 13.1, 13.2, 13.3
//
// Criterio di appartenenza (mirror della vista check_list_scadenza, 0011):
//   un lotto (prodotto_id, lotto, data_scadenza_effettiva) compare IFF
//     - il prodotto esiste ed è ATTIVO, AND
//     - la giacenza residua del lotto (carichi - scarichi su prodotto+lotto) > 0, AND
//     - diffGiorni(data_scadenza_effettiva, oggi) < intervallo_allerta_scadenza (stretto).
//   La rimozione quando la giacenza residua scende a 0 vale per QUALSIASI
//   destinazione dello scarico (R13.2) e non dipende da spunte manuali (R13.3).
//
// Le date "civili" sono sempre stringhe 'YYYY-MM-DD' costruite da componenti
// locali (dates.js): nessun uso di toISOString()/UTC.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scadenzaPerLotto } from "./checklists.js";
import { diffGiorni, toYmd, addYears } from "./dates.js";

// ---------------------------------------------------------------------------
// Generatori di date civili e di scadenze controllate rispetto a `oggi`
// ---------------------------------------------------------------------------

/** Giorni nel mese (gestisce bisestili). */
function giorniNelMese(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * Arbitrary di una data civile "oggi" lontana dai bordi del calendario, così
 * che aggiungere/togliere alcuni giorni resti sempre nel range gestibile.
 * Evitiamo il 29/02 per non incappare nel clamp bisestile di addYears quando
 * costruiamo scadenze a distanza di anni.
 */
const arbOggi = fc
  .record({
    y: fc.integer({ min: 2010, max: 2080 }),
    m: fc.integer({ min: 1, max: 12 }),
  })
  .chain(({ y, m }) =>
    fc.integer({ min: 1, max: giorniNelMese(y, m) }).map((d) => toYmd({ y, m, d })),
  )
  .filter((ymd) => !ymd.endsWith("-02-29"));

/**
 * Costruisce una scadenza a `offsetGiorni` da `oggi` usando SOLO helper civili:
 * partiamo da `oggi`, aggiungiamo 10 anni (addYears) e poi togliamo 10 anni,
 * ma per gli offset in giorni ci appoggiamo a un Date locale costruito per
 * componenti e riformattato con toYmd — nessun passaggio per UTC.
 *
 * @param {string} oggi 'YYYY-MM-DD'
 * @param {number} offsetGiorni giorni da aggiungere (può essere negativo)
 * @returns {string} scadenza 'YYYY-MM-DD'
 */
function scadenzaConOffset(oggi, offsetGiorni) {
  // Date locale a mezzanotte dai componenti civili di `oggi`.
  const [y, m, d] = oggi.split("-").map(Number);
  const base = new Date(y, m - 1, d); // mezzanotte locale
  base.setDate(base.getDate() + offsetGiorni); // aritmetica su data locale
  return toYmd(base); // riformattazione da componenti locali (no UTC)
}

// ---------------------------------------------------------------------------
// Property 11.13
// Validates: Requirements 13.1, 13.2, 13.3
// ---------------------------------------------------------------------------

describe("Property 11.13: membership scadenza per lotto (Requirements 13.1, 13.2, 13.3)", () => {
  it("un lotto compare IFF prodotto attivo AND residuo > 0 AND diff < intervallo (stretto)", () => {
    fc.assert(
      fc.property(
        arbOggi,
        fc.integer({ min: 1, max: 365 }), // intervallo_allerta_scadenza del prodotto
        fc.boolean(), // prodotto attivo?
        fc.integer({ min: 1, max: 50 }), // quantita caricata del lotto
        fc.integer({ min: 0, max: 60 }), // quantita scaricata del lotto (<= carico -> residuo >= 0)
        // Posizione della scadenza rispetto all'intervallo: la calcoliamo dopo.
        fc.integer({ min: -30, max: 400 }), // offset (giorni) della scadenza da oggi
        fc.constantFrom("armadi_ripristino", "associazioni", "altro"), // destinazione scarico
        (oggi, intervallo, attivo, caricata, scaricataGrezza, offsetGiorni, destinazione) => {
          // Il residuo non deve andare sotto zero: clamp dello scarico al carico.
          const scaricata = Math.min(scaricataGrezza, caricata);
          const residuo = caricata - scaricata;

          const scadenza = scadenzaConOffset(oggi, offsetGiorni);
          const prodotti = [
            {
              id: "P1",
              nome: "Prodotto 1",
              codice: "C1",
              attivo,
              intervallo_allerta_scadenza: intervallo,
            },
          ];
          const movimenti = [
            {
              prodotto_id: "P1",
              tipo: "carico",
              quantita_base: caricata,
              lotto: "L1",
              data_scadenza_effettiva: scadenza,
            },
          ];
          if (scaricata > 0) {
            movimenti.push({
              prodotto_id: "P1",
              tipo: "scarico",
              quantita_base: scaricata,
              lotto: "L1",
              destinazione,
            });
          }

          const righe = scadenzaPerLotto(prodotti, movimenti, oggi);
          const presente = righe.some(
            (r) => r.prodotto_id === "P1" && r.lotto === "L1",
          );

          const diff = diffGiorni(scadenza, oggi);
          const atteso = attivo && residuo > 0 && diff < intervallo;

          expect(presente).toBe(atteso);
          if (atteso) {
            const riga = righe.find((r) => r.lotto === "L1");
            expect(riga.giacenza_lotto).toBe(residuo);
            expect(riga.data_scadenza_effettiva).toBe(scadenza);
          }
        },
      ),
    );
  });

  it("scarichi che azzerano il residuo rimuovono il lotto, per QUALSIASI destinazione (R13.2)", () => {
    fc.assert(
      fc.property(
        arbOggi,
        fc.integer({ min: 1, max: 50 }), // quantita caricata (residuo iniziale > 0, scadenza vicina)
        fc.constantFrom("armadi_ripristino", "associazioni", "altro"),
        (oggi, caricata, destinazione) => {
          // Scadenza sicuramente dentro l'intervallo (diff = 1 < 10).
          const scadenza = scadenzaConOffset(oggi, 1);
          const prodotti = [
            {
              id: "P1",
              nome: "Prodotto 1",
              codice: "C1",
              attivo: true,
              intervallo_allerta_scadenza: 10,
            },
          ];
          const caricoMov = {
            prodotto_id: "P1",
            tipo: "carico",
            quantita_base: caricata,
            lotto: "L1",
            data_scadenza_effettiva: scadenza,
          };

          // Prima dello scarico totale: il lotto deve comparire.
          const primaRighe = scadenzaPerLotto(prodotti, [caricoMov], oggi);
          expect(primaRighe.some((r) => r.lotto === "L1")).toBe(true);

          // Scarico pari al carico, con la destinazione generata -> residuo 0.
          const scaricoMov = {
            prodotto_id: "P1",
            tipo: "scarico",
            quantita_base: caricata,
            lotto: "L1",
            destinazione,
          };
          const dopoRighe = scadenzaPerLotto(prodotti, [caricoMov, scaricoMov], oggi);
          expect(dopoRighe.some((r) => r.lotto === "L1")).toBe(false);
        },
      ),
    );
  });

  it("un lotto con scadenza lontana (diff >= intervallo) non compare", () => {
    fc.assert(
      fc.property(
        arbOggi,
        fc.integer({ min: 1, max: 100 }), // intervallo
        fc.integer({ min: 0, max: 400 }), // extra giorni oltre l'intervallo
        fc.integer({ min: 1, max: 50 }), // caricata (residuo > 0)
        (oggi, intervallo, extra, caricata) => {
          // diff = intervallo + extra >= intervallo -> NON deve comparire.
          const scadenza = scadenzaConOffset(oggi, intervallo + extra);
          const prodotti = [
            {
              id: "P1",
              nome: "Prodotto 1",
              codice: "C1",
              attivo: true,
              intervallo_allerta_scadenza: intervallo,
            },
          ];
          const movimenti = [
            {
              prodotto_id: "P1",
              tipo: "carico",
              quantita_base: caricata,
              lotto: "L1",
              data_scadenza_effettiva: scadenza,
            },
          ];
          const righe = scadenzaPerLotto(prodotti, movimenti, oggi);
          expect(righe.some((r) => r.lotto === "L1")).toBe(false);
        },
      ),
    );
  });

  it("granularità per lotto: due lotti dello stesso prodotto sono valutati in modo indipendente", () => {
    fc.assert(
      fc.property(
        arbOggi,
        fc.integer({ min: 1, max: 50 }), // residuo lotto A (> 0)
        fc.integer({ min: 1, max: 50 }), // carico lotto B
        (oggi, caricaA, caricaB) => {
          const intervallo = 10;
          const scadenzaVicina = scadenzaConOffset(oggi, 1); // diff 1 < 10 -> candidabile
          const prodotti = [
            {
              id: "P1",
              nome: "Prodotto 1",
              codice: "C1",
              attivo: true,
              intervallo_allerta_scadenza: intervallo,
            },
          ];
          // Lotto A: residuo > 0, scadenza vicina -> compare.
          // Lotto B: carico interamente scaricato (residuo 0) -> NON compare,
          //          anche se ha la stessa scadenza vicina.
          const movimenti = [
            {
              prodotto_id: "P1",
              tipo: "carico",
              quantita_base: caricaA,
              lotto: "A",
              data_scadenza_effettiva: scadenzaVicina,
            },
            {
              prodotto_id: "P1",
              tipo: "carico",
              quantita_base: caricaB,
              lotto: "B",
              data_scadenza_effettiva: scadenzaVicina,
            },
            {
              prodotto_id: "P1",
              tipo: "scarico",
              quantita_base: caricaB,
              lotto: "B",
              destinazione: "associazioni",
            },
          ];

          const righe = scadenzaPerLotto(prodotti, movimenti, oggi);
          expect(righe.some((r) => r.lotto === "A")).toBe(true);
          expect(righe.some((r) => r.lotto === "B")).toBe(false);
          // La riga del lotto A espone il residuo corretto, indipendente da B.
          const rigaA = righe.find((r) => r.lotto === "A");
          expect(rigaA.giacenza_lotto).toBe(caricaA);
        },
      ),
    );
  });
});
