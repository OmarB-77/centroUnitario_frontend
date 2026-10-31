// js/integrazione.test.js
//
// Test di INTEGRAZIONE a livello di logica dei flussi principali (task 21.2).
//
// CONTESTO E CONFINI
//   I test di Vitest girano in ambiente Node SENZA jsdom e i moduli UI/API
//   importano supabase-js da una CDN (non caricabile in Node) — vedi la nota in
//   js/router.test.js. Perciò qui NON si importano main.js / ui/* / api/* /
//   supabaseClient.js. Si verificano invece, a livello di INTEGRAZIONE, i pezzi
//   di logica PURA che COMPONGONO i flussi principali dell'app, importando solo
//   moduli puri: js/roles.js, js/routing.js, js/domain/*.
//
//   Questo è il complemento "flow-level" dei property test di dominio: lì si
//   verificano le singole proprietà universali, qui si verifica che i pezzi si
//   incastrino correttamente lungo un intero flusso (home per ruolo, carico,
//   scarico con tripla destinazione atomica, generazione delle tre check-list,
//   selezione da scanner che abilita il flusso).
//
// Copertura trasversale dei requisiti dei flussi:
//   - filtro home per ruolo (R4.1, R5.2/5.3/5.4) + routing round-trip
//   - flusso carico: units.quantitaInBase + dates.scadenzaEffettiva (R7.1/7.7/7.8/7.13)
//   - flusso scarico: giacenze.giacenzaLotto + effetto atomico per destinazione (R8.5/8.6/8.7)
//   - generazione check-list: giacenze + checklists (R11/R12/R13), con rimozione
//     automatica di un lotto in scadenza dopo lo scarico (R13.2/R13.3)
//   - selezione da scanner: scanner_lookup.lookupPerCodice (R15.2/R15.3) che
//     abilita il proseguimento del flusso carico/scarico con quel prodotto.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Ruoli e schermate (guard UI che rispecchiano le policy RLS).
import {
  RUOLI,
  SCHERMATE,
  schermatePerRuolo,
  puoAccedere,
} from "./roles.js";

// Helper puri di routing hash-based.
import { parseHash, hashPerRotta } from "./routing.js";

// Logica di dominio pura dei flussi.
import { quantitaInBase, UNITA_BASE, UNITA_CARICO } from "./domain/units.js";
import { scadenzaEffettiva, addYears } from "./domain/dates.js";
import { giacenzaCu, giacenzaArmadi, giacenzaLotto } from "./domain/giacenze.js";
import { carenzaCu, carenzaArmadi, scadenzaPerLotto } from "./domain/checklists.js";
import { lookupPerCodice } from "./domain/scanner_lookup.js";

// -----------------------------------------------------------------------------
// Helper condivisi tra i flussi (modelli puri degli effetti server)
// -----------------------------------------------------------------------------

/**
 * Modello PURO dell'effetto della RPC `scarico_cu` (mirror di 0012), identico
 * a quello usato nel property test 11.10 ma riusato qui a livello di flusso:
 * produce le righe di movimentazione prodotte da uno scarico, mantenendo
 * atomicamente CU e armadi coerenti.
 *
 * @param {object} args
 * @param {string} args.prodottoId
 * @param {number} args.quantita quantità base scaricata (>= 1)
 * @param {string|null} args.lotto lotto da cui si scarica
 * @param {'armadio_ripristino'|'associazione'|'altro'} args.destinazione
 * @param {string} [args.dataScadenzaEffettiva] scadenza effettiva del lotto
 * @returns {{ movimentiCu: Array<object>, movimentiArmadi: Array<object> }}
 */
function effettoScarico({ prodottoId, quantita, lotto, destinazione, dataScadenzaEffettiva }) {
  const rigaScaricoCu = {
    prodotto_id: prodottoId,
    tipo: "scarico",
    quantita_base: quantita,
    lotto,
    destinazione,
    data_scadenza_effettiva: dataScadenzaEffettiva ?? null,
  };
  if (destinazione === "armadio_ripristino") {
    return {
      movimentiCu: [rigaScaricoCu],
      movimentiArmadi: [
        { prodotto_id: prodottoId, tipo: "carico_automatico", quantita_base: quantita },
      ],
    };
  }
  return { movimentiCu: [rigaScaricoCu], movimentiArmadi: [] };
}

// =============================================================================
// 1. Home filtrata per ruolo + routing round-trip
// =============================================================================

describe("Flusso: home filtrata per ruolo (R4.1, R5.2/5.3/5.4)", () => {
  // Insiemi attesi, per ruolo, espressi come Set di identificatori di SCHERMATE.
  const ATTESE_ADMIN = new Set(Object.values(SCHERMATE)); // Admin: tutto
  const ATTESE_POWER_USER = new Set([
    SCHERMATE.GESTIONE_PRODOTTI,
    SCHERMATE.PUNTI_PRELIEVO,
    SCHERMATE.ASSOCIAZIONI,
    SCHERMATE.CARICO_CU,
    SCHERMATE.SCARICO_CU,
    SCHERMATE.CHECK_LIST,
    SCHERMATE.SCARICO_ARMADI,
    SCHERMATE.SEGNALAZIONE_ARMADI,
    SCHERMATE.IMPOSTAZIONI,
  ]);
  const ATTESE_USER = new Set([
    SCHERMATE.SCARICO_ARMADI,
    SCHERMATE.SEGNALAZIONE_ARMADI,
    SCHERMATE.IMPOSTAZIONI,
  ]);

  it("Admin vede TUTTE le schermate, inclusa la gestione utenti", () => {
    const set = new Set(schermatePerRuolo(RUOLI.ADMIN));
    expect(set).toEqual(ATTESE_ADMIN);
    expect(set.has(SCHERMATE.GESTIONE_UTENTI)).toBe(true);
  });

  it("Power-user vede anagrafiche + CU + check-list + armadi + impostazioni, MAI gestione utenti", () => {
    const set = new Set(schermatePerRuolo(RUOLI.POWER_USER));
    expect(set).toEqual(ATTESE_POWER_USER);
    expect(set.has(SCHERMATE.GESTIONE_UTENTI)).toBe(false);
  });

  it("User vede SOLO scarico/segnalazione armadi + impostazioni", () => {
    const set = new Set(schermatePerRuolo(RUOLI.USER));
    expect(set).toEqual(ATTESE_USER);
    // Nessun accesso a CU, anagrafiche, check-list o gestione utenti.
    for (const vietata of [
      SCHERMATE.GESTIONE_UTENTI,
      SCHERMATE.GESTIONE_PRODOTTI,
      SCHERMATE.PUNTI_PRELIEVO,
      SCHERMATE.ASSOCIAZIONI,
      SCHERMATE.CARICO_CU,
      SCHERMATE.SCARICO_CU,
      SCHERMATE.CHECK_LIST,
    ]) {
      expect(set.has(vietata)).toBe(false);
    }
  });

  it("puoAccedere rispecchia esattamente schermatePerRuolo per ogni ruolo e schermata", () => {
    for (const ruolo of Object.values(RUOLI)) {
      const consentite = new Set(schermatePerRuolo(ruolo));
      for (const schermata of Object.values(SCHERMATE)) {
        expect(puoAccedere(ruolo, schermata)).toBe(consentite.has(schermata));
      }
    }
  });

  it("routing round-trip: parseHash(hashPerRotta(s)) === s per ogni schermata consentita a ciascun ruolo", () => {
    for (const ruolo of Object.values(RUOLI)) {
      for (const schermata of schermatePerRuolo(ruolo)) {
        expect(parseHash(hashPerRotta(schermata))).toBe(schermata);
      }
    }
  });
});

// =============================================================================
// 2. Flusso di carico: conversione unità + scadenza effettiva
// =============================================================================

describe("Flusso: carico CU — conversione unità + scadenza effettiva (R7.1/7.7/7.8/7.13)", () => {
  it("carico in unità di carico: quantità convertita in base e scadenza = data_scadenza (prodotto con scadenza)", () => {
    // Un carico reale compone: (a) conversione della quantità in unità base e
    // (b) calcolo della scadenza effettiva, prima di inserire il movimento.
    const pezziPerConfezione = 12;
    const qInserita = 5; // 5 confezioni
    const qBase = quantitaInBase(qInserita, UNITA_CARICO, pezziPerConfezione);
    expect(qBase).toBe(60);

    const scad = scadenzaEffettiva({
      senzaScadenza: false,
      dataScadenza: "2025-06-30",
    });
    expect(scad).toBe("2025-06-30");

    // La riga di movimento risultante usa entrambi i valori composti.
    const riga = {
      prodotto_id: "p1",
      tipo: "carico",
      quantita_base: qBase,
      data_scadenza_effettiva: scad,
    };
    expect(giacenzaCu([riga]).totale).toBe(60);
  });

  it("carico in unità base: nessuna conversione; prodotto senza scadenza senza override => produzione + 5 anni", () => {
    const qBase = quantitaInBase(8, UNITA_BASE, 12); // unità base: fattore ignorato
    expect(qBase).toBe(8);

    const scad = scadenzaEffettiva({
      senzaScadenza: true,
      dataProduzione: "2024-01-15",
    });
    expect(scad).toBe(addYears("2024-01-15", 5));
    expect(scad).toBe("2029-01-15");
  });

  it("prodotto senza scadenza con override operatore: l'override prevale", () => {
    const scad = scadenzaEffettiva({
      senzaScadenza: true,
      dataProduzione: "2024-01-15",
      override: "2026-03-01",
    });
    expect(scad).toBe("2026-03-01");
  });

  it("property: carico in unità di carico => quantita_base == q * pezzi e la giacenza riflette la somma", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }), // quantità inserita (confezioni)
        fc.integer({ min: 1, max: 999 }), // pezzi per confezione
        (q, pezzi) => {
          fc.pre(q * pezzi <= 999999); // resta nel dominio valido della quantità base
          const qBase = quantitaInBase(q, UNITA_CARICO, pezzi);
          expect(qBase).toBe(q * pezzi);
          const riga = { prodotto_id: "p", tipo: "carico", quantita_base: qBase };
          expect(giacenzaCu([riga]).totale).toBe(q * pezzi);
        }
      )
    );
  });
});

// =============================================================================
// 3. Flusso di scarico: selezione lotto + effetto atomico per destinazione
// =============================================================================

describe("Flusso: scarico CU — selezione lotto + atomicità per destinazione (R8.5/8.6/8.7)", () => {
  const PROD = "prod-scarico";

  // Stato CU iniziale: due lotti dello stesso prodotto con residui diversi.
  const movimentiCuIniziali = [
    { prodotto_id: PROD, tipo: "carico", quantita_base: 100, lotto: "L1", data_scadenza_effettiva: "2025-12-31" },
    { prodotto_id: PROD, tipo: "carico", quantita_base: 40, lotto: "L2", data_scadenza_effettiva: "2026-01-31" },
    { prodotto_id: PROD, tipo: "scarico", quantita_base: 30, lotto: "L1" },
  ];

  it("giacenzaLotto seleziona il residuo corretto per ciascun lotto", () => {
    expect(giacenzaLotto(movimentiCuIniziali, PROD, "L1")).toBe(70); // 100 - 30
    expect(giacenzaLotto(movimentiCuIniziali, PROD, "L2")).toBe(40);
    // giacenza CU totale = somma dei residui dei lotti
    expect(giacenzaCu(movimentiCuIniziali).totale).toBe(110);
  });

  it("destinazione armadio_ripristino: CU scende di q E armadi salgono di q (atomico)", () => {
    const armadiIniziali = [
      { prodotto_id: PROD, tipo: "carico_automatico", quantita_base: 5 },
    ];
    const S = giacenzaCu(movimentiCuIniziali).totale; // 110
    const A = giacenzaArmadi(armadiIniziali); // 5
    const q = 50; // <= giacenzaLotto(L1) = 70, scarico ammesso

    const eff = effettoScarico({
      prodottoId: PROD,
      quantita: q,
      lotto: "L1",
      destinazione: "armadio_ripristino",
    });
    const cuDopo = giacenzaCu([...movimentiCuIniziali, ...eff.movimentiCu]).totale;
    const armadiDopo = giacenzaArmadi([...armadiIniziali, ...eff.movimentiArmadi]);

    expect(cuDopo).toBe(S - q); // 60
    expect(armadiDopo).toBe(A + q); // 55
    // Il lotto scaricato resta non negativo.
    expect(giacenzaLotto([...movimentiCuIniziali, ...eff.movimentiCu], PROD, "L1")).toBe(20);
  });

  it("destinazione associazione/altro: CU scende di q, armadi invariati", () => {
    const armadiIniziali = [
      { prodotto_id: PROD, tipo: "carico_automatico", quantita_base: 5 },
    ];
    const S = giacenzaCu(movimentiCuIniziali).totale;
    for (const destinazione of ["associazione", "altro"]) {
      const q = 20;
      const eff = effettoScarico({ prodottoId: PROD, quantita: q, lotto: "L2", destinazione });
      const cuDopo = giacenzaCu([...movimentiCuIniziali, ...eff.movimentiCu]).totale;
      const armadiDopo = giacenzaArmadi([...armadiIniziali, ...eff.movimentiArmadi]);
      expect(cuDopo).toBe(S - q);
      expect(armadiDopo).toBe(giacenzaArmadi(armadiIniziali)); // invariato
      expect(eff.movimentiArmadi).toHaveLength(0);
    }
  });
});

// =============================================================================
// 4. Generazione delle tre check-list su un dataset campione
// =============================================================================

describe("Flusso: generazione delle tre check-list (R11/R12/R13)", () => {
  // Dataset campione: tre prodotti attivi + uno disattivo.
  const prodotti = [
    {
      id: "A",
      nome: "Prodotto A",
      codice: "AAA",
      attivo: true,
      giacenza_minima_cu: 50,
      giacenza_minima_armadi: 10,
      intervallo_allerta_scadenza: 30,
    },
    {
      id: "B",
      nome: "Prodotto B",
      codice: "BBB",
      attivo: true,
      giacenza_minima_cu: 20,
      giacenza_minima_armadi: 5,
      intervallo_allerta_scadenza: 60,
    },
    {
      id: "C",
      nome: "Prodotto C",
      codice: "CCC",
      attivo: true,
      giacenza_minima_cu: 10,
      giacenza_minima_armadi: 100, // volutamente alta -> armadi in carenza
      intervallo_allerta_scadenza: 7,
    },
    {
      id: "D",
      nome: "Prodotto D (disattivo)",
      codice: "DDD",
      attivo: false,
      giacenza_minima_cu: 999,
      giacenza_minima_armadi: 999,
      intervallo_allerta_scadenza: 999,
    },
  ];

  const OGGI = "2025-01-01";

  // Movimenti CU:
  //  - A: carico 30 (< soglia 50) con lotto in scadenza imminente -> carenza CU + scadenza
  //  - B: carico 100 (>= soglia 20) -> NON in carenza CU; scadenza lontana
  //  - C: carico 5 (< soglia 10) -> carenza CU; scadenza lontanissima
  //  - D: disattivo -> mai nelle liste
  const movimentiCu = [
    { prodotto_id: "A", tipo: "carico", quantita_base: 30, lotto: "LA", data_scadenza_effettiva: "2025-01-10" }, // 9 giorni -> < 30
    { prodotto_id: "B", tipo: "carico", quantita_base: 100, lotto: "LB", data_scadenza_effettiva: "2026-01-01" }, // 365 giorni -> >= 60
    { prodotto_id: "C", tipo: "carico", quantita_base: 5, lotto: "LC", data_scadenza_effettiva: "2030-01-01" }, // lontano -> >= 7
    { prodotto_id: "D", tipo: "carico", quantita_base: 1, lotto: "LD", data_scadenza_effettiva: "2025-01-02" },
  ];

  // Movimenti armadi: C ha 0 in armadi (soglia 100) -> carenza armadi; A/B sopra soglia.
  const movimentiArmadi = [
    { prodotto_id: "A", tipo: "carico_automatico", quantita_base: 50 }, // >= 10
    { prodotto_id: "B", tipo: "carico_automatico", quantita_base: 8 }, // >= 5
    // C: nessun movimento -> giacenza 0 < 100 -> carenza armadi
  ];

  it("carenza CU: solo i prodotti attivi con giacenza < soglia (A e C), non B né il disattivo D", () => {
    const righe = carenzaCu(prodotti, movimentiCu, []);
    const ids = new Set(righe.map((r) => r.prodotto_id));
    expect(ids).toEqual(new Set(["A", "C"]));
    const rigaA = righe.find((r) => r.prodotto_id === "A");
    expect(rigaA.giacenza).toBe(30);
    expect(rigaA.giacenza_minima_cu).toBe(50);
    expect(rigaA.ordinato).toBe(false); // nessuno stato ordini passato
  });

  it("carenza CU: la spunta 'ordinato' NON rimuove dalla lista (rimozione solo data-driven, R11.3)", () => {
    const statoOrdini = [{ prodotto_id: "A", ordinato: true }];
    const righe = carenzaCu(prodotti, movimentiCu, statoOrdini);
    const rigaA = righe.find((r) => r.prodotto_id === "A");
    expect(rigaA).toBeDefined(); // ancora presente nonostante la spunta
    expect(rigaA.ordinato).toBe(true);
  });

  it("carenza armadi: solo C (giacenza 0 < 100); A e B sopra soglia, D disattivo escluso", () => {
    const righe = carenzaArmadi(prodotti, movimentiArmadi);
    const ids = new Set(righe.map((r) => r.prodotto_id));
    expect(ids).toEqual(new Set(["C"]));
    expect(righe[0].giacenza).toBe(0);
    expect(righe[0].giacenza_minima_armadi).toBe(100);
  });

  it("prossima scadenza per lotto: solo il lotto LA di A (9 giorni < 30); non B, C, D", () => {
    const righe = scadenzaPerLotto(prodotti, movimentiCu, OGGI);
    const chiavi = new Set(righe.map((r) => `${r.prodotto_id}:${r.lotto}`));
    expect(chiavi).toEqual(new Set(["A:LA"]));
    expect(righe[0].giacenza_lotto).toBe(30);
    expect(righe[0].data_scadenza_effettiva).toBe("2025-01-10");
  });

  it("lo scarico di un lotto in scadenza lo RIMUOVE dalla check-list scadenza (R13.2/R13.3)", () => {
    // Prima: LA di A è in lista.
    expect(scadenzaPerLotto(prodotti, movimentiCu, OGGI).map((r) => r.prodotto_id)).toContain("A");

    // Scarico totale del lotto LA (30) con destinazione qualsiasi (es. associazione).
    const eff = effettoScarico({
      prodottoId: "A",
      quantita: 30,
      lotto: "LA",
      destinazione: "associazione",
    });
    const movimentiCuDopo = [...movimentiCu, ...eff.movimentiCu];

    // Residuo del lotto LA ora 0 -> esce dalla lista scadenza.
    expect(giacenzaLotto(movimentiCuDopo, "A", "LA")).toBe(0);
    const righeDopo = scadenzaPerLotto(prodotti, movimentiCuDopo, OGGI);
    expect(righeDopo.map((r) => `${r.prodotto_id}:${r.lotto}`)).not.toContain("A:LA");

    // Coerentemente A ora è anche più carente in CU (giacenza 0 < 50): resta in carenza CU.
    const carenzaDopo = carenzaCu(prodotti, movimentiCuDopo, []);
    const rigaA = carenzaDopo.find((r) => r.prodotto_id === "A");
    expect(rigaA.giacenza).toBe(0);
  });
});

// =============================================================================
// 5. Selezione da scanner che abilita il flusso carico/scarico
// =============================================================================

describe("Flusso: selezione prodotto da scanner (R15.2/R15.3)", () => {
  const anagrafica = [
    { id: "p1", codice: "COD-100", attivo: true, pezzi_per_confezione: 12 },
    { id: "p2", codice: "COD-200", attivo: false, pezzi_per_confezione: 6 }, // disattivo
    { id: "p3", codice: "COD-300", attivo: true, pezzi_per_confezione: 1 },
  ];

  it("codice di prodotto ATTIVO: selezione riuscita e il flusso carico può proseguire con quel prodotto", () => {
    const esito = lookupPerCodice(anagrafica, "COD-100");
    expect(esito.trovato).toBe(true);
    expect(esito.prodotto.id).toBe("p1");

    // Il prodotto selezionato alimenta la conversione del carico.
    const qBase = quantitaInBase(3, UNITA_CARICO, esito.prodotto.pezzi_per_confezione);
    expect(qBase).toBe(36);
  });

  it("codice con rumore dello scanner (trailing newline/spazi): comunque selezionato", () => {
    const esito = lookupPerCodice(anagrafica, "  COD-300\r\n");
    expect(esito.trovato).toBe(true);
    expect(esito.prodotto.id).toBe("p3");
  });

  it("codice di prodotto NON attivo: nessuna selezione (flusso non prosegue)", () => {
    const esito = lookupPerCodice(anagrafica, "COD-200");
    expect(esito.trovato).toBe(false);
    expect(esito.prodotto).toBeUndefined();
  });

  it("codice sconosciuto: nessuna selezione", () => {
    expect(lookupPerCodice(anagrafica, "COD-999").trovato).toBe(false);
    expect(lookupPerCodice(anagrafica, "").trovato).toBe(false);
  });

  it("flusso end-to-end: scanner -> prodotto attivo -> scarico atomico verso armadi resta coerente", () => {
    const PROD = "p3";
    const esito = lookupPerCodice(anagrafica, "COD-300");
    expect(esito.trovato).toBe(true);
    expect(esito.prodotto.id).toBe(PROD);

    const movimentiCu = [
      { prodotto_id: PROD, tipo: "carico", quantita_base: 20, lotto: null },
    ];
    const S = giacenzaCu(movimentiCu).totale;
    const q = giacenzaLotto(movimentiCu, PROD, null); // scarico dell'intero residuo del lotto nullo
    expect(q).toBe(20);

    const eff = effettoScarico({
      prodottoId: PROD,
      quantita: q,
      lotto: null,
      destinazione: "armadio_ripristino",
    });
    const cuDopo = giacenzaCu([...movimentiCu, ...eff.movimentiCu]).totale;
    const armadiDopo = giacenzaArmadi(eff.movimentiArmadi);
    expect(cuDopo).toBe(S - q); // 0
    expect(armadiDopo).toBe(q); // 20
  });
});
