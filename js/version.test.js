// Smoke test "versione e cache" (task 10.4).
//
// Scopo: impedire il DRIFT tra i punti in cui la versione semantica compare.
// L'unico punto di verità è js/version.js (export const VERSION). Da lì devono
// restare allineati: il CACHE_NAME del service worker, la versione di package.json,
// la versione mostrata in UI (footer index.html) e il re-export in js/config.js.
//
// Il service worker (sw.js) NON è un modulo ES (usa self/caches) e ripete la
// versione a mano come APP_VERSION: proprio per questo è il punto più esposto al
// disallineamento. Non lo importiamo: ne leggiamo il testo e ne estraiamo i valori
// con regex, così il test fallisce non appena qualcuno bumpa VERSION senza
// aggiornare sw.js (o viceversa).
//
// Requisiti coperti:
//   - R17.1: versione nel formato X.Y.Z definita in un unico punto.
//   - R17.2: la versione mostrata in UI deriva da quell'unico punto.
//   - R17.4: versione UI, nome cache del service worker e tag git vX.Y.Z identici.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { VERSION } from "./version.js";
import { CONFIG, VERSION as CONFIG_VERSION } from "./config.js";

// Percorsi risolti rispetto a questo file (robusto a cwd e al base path).
const QUESTA_DIR = dirname(fileURLToPath(import.meta.url)); // .../js
const ROOT_DIR = join(QUESTA_DIR, ".."); // root del repo frontend

const testoSw = readFileSync(join(ROOT_DIR, "sw.js"), "utf8");
const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
const testoIndexHtml = readFileSync(join(ROOT_DIR, "index.html"), "utf8");

// --- Estrazione valori dal service worker (non importabile come modulo ES) ---

// const APP_VERSION = "X.Y.Z";
const matchAppVersion = testoSw.match(/APP_VERSION\s*=\s*["'`]([^"'`]+)["'`]/);
const appVersion = matchAppVersion ? matchAppVersion[1] : null;

// const CACHE_NAME = `centro-unitario-cache-v${APP_VERSION}`;  (template literal)
const matchCacheTemplate = testoSw.match(
  /CACHE_NAME\s*=\s*`centro-unitario-cache-v\$\{APP_VERSION\}`/
);

describe("Smoke test versione e cache (task 10.4)", () => {
  it("VERSION è definita nel formato semantico X.Y.Z (R17.1)", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("il service worker definisce APP_VERSION come stringa X.Y.Z", () => {
    expect(appVersion).not.toBeNull();
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("APP_VERSION del service worker è allineato a VERSION (R17.4)", () => {
    expect(appVersion).toBe(VERSION);
  });

  it("CACHE_NAME deriva da VERSION come `centro-unitario-cache-v${VERSION}` (R17.4)", () => {
    // Il service worker usa un template literal su APP_VERSION: verifichiamo sia
    // la forma del template sia che, risolto, coincida col nome atteso.
    expect(matchCacheTemplate).not.toBeNull();
    const cacheNameAtteso = `centro-unitario-cache-v${VERSION}`;
    expect(`centro-unitario-cache-v${appVersion}`).toBe(cacheNameAtteso);
  });

  it("package.json version è allineato a VERSION (R17.4)", () => {
    expect(packageJson.version).toBe(VERSION);
  });

  it("CONFIG.VERSION re-esporta lo stesso VERSION (R17.1/R17.2)", () => {
    expect(CONFIG.VERSION).toBe(VERSION);
    expect(CONFIG_VERSION).toBe(VERSION);
  });

  it("il footer di index.html mostra la versione allineata a VERSION (R17.2)", () => {
    // Il footer usa <span ... data-versione>vX.Y.Z</span>.
    const matchFooter = testoIndexHtml.match(/data-versione\s*>\s*v([^<]+)</);
    expect(matchFooter).not.toBeNull();
    expect(matchFooter[1].trim()).toBe(VERSION);
  });
});
