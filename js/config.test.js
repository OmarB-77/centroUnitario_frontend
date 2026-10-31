// Test unitari per la configurazione centralizzata.
// NB: nessun test effettua chiamate di rete reali a Supabase; verifichiamo solo
// la logica pura del base path e l'immutabilità della config.
import { describe, it, expect } from "vitest";
import { CONFIG, withBase, asset, basePath, BASE_PATH } from "./config.js";

describe("withBase (join del base path GitHub Pages)", () => {
  it("antepone il base path a un percorso relativo senza slash iniziale", () => {
    expect(withBase("css/styles.css")).toBe("/centroUnitario_frontend/css/styles.css");
  });

  it("gestisce uno slash iniziale nel percorso relativo senza produrre '//'", () => {
    expect(withBase("/css/styles.css")).toBe("/centroUnitario_frontend/css/styles.css");
  });

  it("collassa slash iniziali multipli", () => {
    expect(withBase("///js/main.js")).toBe("/centroUnitario_frontend/js/main.js");
  });

  it("con percorso vuoto restituisce il base path con slash finale", () => {
    expect(withBase("")).toBe("/centroUnitario_frontend/");
  });

  it("con solo slash restituisce il base path", () => {
    expect(withBase("/")).toBe("/centroUnitario_frontend/");
  });

  it("usa come default il percorso vuoto se chiamato senza argomenti", () => {
    expect(withBase()).toBe("/centroUnitario_frontend/");
  });

  it("non lascia mai doppi slash nel risultato (tranne lo slash iniziale)", () => {
    const risultato = withBase("/a//b");
    expect(risultato.slice(1)).not.toContain("//");
  });

  it("produce sempre un percorso assoluto che inizia con il base path", () => {
    expect(withBase("qualsiasi/cosa").startsWith(BASE_PATH)).toBe(true);
  });

  it("asset e basePath sono alias di withBase", () => {
    expect(asset).toBe(withBase);
    expect(basePath).toBe(withBase);
    expect(asset("x")).toBe(withBase("x"));
  });
});

describe("CONFIG (immutabilità e contenuto)", () => {
  it("è un oggetto congelato", () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
  });

  it("non consente la modifica delle proprietà (fallisce silenziosamente o lancia)", () => {
    const originale = CONFIG.SUPABASE_URL;
    try {
      // In strict mode (modulo ES) questo lancia; verifichiamo comunque il valore immutato.
      CONFIG.SUPABASE_URL = "https://malevolo.example";
    } catch (_) {
      // atteso in strict mode
    }
    expect(CONFIG.SUPABASE_URL).toBe(originale);
  });

  it("espone le chiavi attese", () => {
    expect(Object.keys(CONFIG).sort()).toEqual(
      ["BASE_PATH", "SUPABASE_ANON_KEY", "SUPABASE_URL", "VERSION"].sort()
    );
  });

  it("l'URL Supabase non contiene il suffisso /rest/v1/ (lo aggiunge supabase-js)", () => {
    expect(CONFIG.SUPABASE_URL).not.toContain("/rest/v1");
  });

  it("il BASE_PATH inizia e termina con '/'", () => {
    expect(CONFIG.BASE_PATH.startsWith("/")).toBe(true);
    expect(CONFIG.BASE_PATH.endsWith("/")).toBe(true);
  });
});
