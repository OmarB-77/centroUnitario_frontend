// Test unitari per il router hash-based e le etichette della home (task 13.3).
//
// NB: i test di Vitest girano in ambiente Node senza DOM (nessun jsdom
// installato). Verifichiamo quindi la LOGICA PURA ed esente da DOM:
//   - parsing e costruzione dell'hash (indipendenti dal base path);
//   - coerenza delle etichette della home con gli identificatori di SCHERMATE.
// Il rendering DOM (mount/avviaRouter) è verificato manualmente nel browser e
// nei task di integrazione: qui ci basta garantire che i moduli si importino
// senza errori e che la logica di routing sia corretta.

import { describe, it, expect } from "vitest";

// I helper puri di routing sono importati da routing.js (modulo senza effetti
// collaterali): router.js li re-esporta, ma importarlo qui trascinerebbe
// auth.js → supabaseClient.js (build da CDN) non caricabile in Node/Vitest.
import { parseHash, hashPerRotta, ROTTA_HOME } from "./routing.js";
import { ETICHETTE_SCHERMATE, etichettaSchermata } from "./ui/home.js";
import { SCHERMATE, schermatePerRuolo, RUOLI } from "./roles.js";

describe("router.parseHash (routing indipendente dal base path)", () => {
  it("estrae la schermata da un hash ben formato", () => {
    expect(parseHash("#/home")).toBe("home");
    expect(parseHash("#/carico_cu")).toBe("carico_cu");
  });

  it("tollera slash iniziali multipli e assenza di slash", () => {
    expect(parseHash("#///scarico_cu")).toBe("scarico_cu");
    expect(parseHash("#home")).toBe("home");
  });

  it("ignora eventuali query dopo la schermata", () => {
    expect(parseHash("#/prodotti?x=1")).toBe("prodotti");
  });

  it("restituisce stringa vuota per hash assente o solo '#'", () => {
    expect(parseHash("")).toBe("");
    expect(parseHash("#")).toBe("");
  });
});

describe("router.hashPerRotta", () => {
  it("costruisce un hash relativo (nessun base path nelle rotte)", () => {
    expect(hashPerRotta("home")).toBe("#/home");
    expect(hashPerRotta(SCHERMATE.CHECK_LIST)).toBe("#/check_list");
  });

  it("usa la home come default", () => {
    expect(hashPerRotta()).toBe(`#/${ROTTA_HOME}`);
  });

  it("parseHash è inverso di hashPerRotta per ogni schermata", () => {
    for (const schermata of Object.values(SCHERMATE)) {
      expect(parseHash(hashPerRotta(schermata))).toBe(schermata);
    }
  });
});

describe("home.ETICHETTE_SCHERMATE (etichette italiane per ruolo)", () => {
  it("fornisce un'etichetta per ogni schermata di SCHERMATE", () => {
    for (const schermata of Object.values(SCHERMATE)) {
      const etichetta = ETICHETTE_SCHERMATE[schermata];
      expect(etichetta, `manca etichetta per ${schermata}`).toBeDefined();
      expect(typeof etichetta.titolo).toBe("string");
      expect(etichetta.titolo.length).toBeGreaterThan(0);
    }
  });

  it("etichettaSchermata ha un fallback robusto per schermate sconosciute", () => {
    const e = etichettaSchermata("schermata_inesistente");
    expect(typeof e.titolo).toBe("string");
    expect(e.titolo.length).toBeGreaterThan(0);
  });

  it("ogni schermata consentita a un ruolo ha un'etichetta (home montabile)", () => {
    for (const ruolo of Object.values(RUOLI)) {
      for (const schermata of schermatePerRuolo(ruolo)) {
        expect(ETICHETTE_SCHERMATE[schermata]).toBeDefined();
      }
    }
  });
});
