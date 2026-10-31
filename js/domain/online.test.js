// Unit test della logica di dominio pura "is-online" dell'health-check PWA.
//
// Runner: Vitest. Modulo sotto test: js/domain/online.js (funzioni pure).
//
// Task 11.15: Unit test predicato is-online
// Validates: Requirements 16.4
//
// Insidia nota verificata esplicitamente: una risposta HTTP da Supabase — ANCHE
// un 401/403 — significa che il server è RAGGIUNGIBILE, quindi lo stato è
// "online". Solo un errore di rete / timeout / abort (nessuna risposta) è "offline".

import { describe, it, expect } from "vitest";
import {
  isOnlineFromResponse,
  classify,
  isOnlineFromOutcome,
  ESITO_RISPOSTA,
  ESITO_ERRORE,
} from "./online.js";

// ---------------------------------------------------------------------------
// Costanti discriminanti
// ---------------------------------------------------------------------------

describe("costanti discriminanti", () => {
  it("ESITO_RISPOSTA / ESITO_ERRORE hanno i valori attesi", () => {
    expect(ESITO_RISPOSTA).toBe("response");
    expect(ESITO_ERRORE).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// isOnlineFromResponse
// ---------------------------------------------------------------------------

describe("isOnlineFromResponse (Requirements 16.4)", () => {
  it("status 200 ⇒ online (true)", () => {
    expect(isOnlineFromResponse({ status: 200 })).toBe(true);
  });

  // Insidia nota: 401 = NON autorizzato, ma il server HA risposto ⇒ online.
  it("status 401 ⇒ online (true) — server raggiungibile", () => {
    expect(isOnlineFromResponse({ status: 401 })).toBe(true);
  });

  // Insidia nota: 403 = vietato, ma il server HA risposto ⇒ online.
  it("status 403 ⇒ online (true) — server raggiungibile", () => {
    expect(isOnlineFromResponse({ status: 403 })).toBe(true);
  });

  it("status 500 ⇒ online (true) — errore server ma raggiungibile", () => {
    expect(isOnlineFromResponse({ status: 500 })).toBe(true);
  });

  it("copre altri status HTTP validi (100, 204, 301, 404, 503, 599)", () => {
    for (const s of [100, 204, 301, 404, 503, 599]) {
      expect(isOnlineFromResponse({ status: s })).toBe(true);
    }
  });

  it("null ⇒ offline (false)", () => {
    expect(isOnlineFromResponse(null)).toBe(false);
  });

  it("undefined ⇒ offline (false)", () => {
    expect(isOnlineFromResponse(undefined)).toBe(false);
  });

  it("status non valido come HTTP ⇒ offline (false)", () => {
    // Fuori range, non intero, tipo errato, mancante.
    expect(isOnlineFromResponse({ status: 99 })).toBe(false);
    expect(isOnlineFromResponse({ status: 600 })).toBe(false);
    expect(isOnlineFromResponse({ status: 200.5 })).toBe(false);
    expect(isOnlineFromResponse({ status: NaN })).toBe(false);
    expect(isOnlineFromResponse({ status: Infinity })).toBe(false);
    expect(isOnlineFromResponse({ status: "200" })).toBe(false);
    expect(isOnlineFromResponse({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classify (forma discriminata { type, status | error })
// ---------------------------------------------------------------------------

describe("classify (Requirements 16.4)", () => {
  it("type 'response' con status 200/401/403/503 ⇒ online (true)", () => {
    for (const s of [200, 401, 403, 503]) {
      expect(classify({ type: ESITO_RISPOSTA, status: s })).toBe(true);
    }
  });

  it("type 'response' con status non valido ⇒ offline (false)", () => {
    expect(classify({ type: ESITO_RISPOSTA, status: 0 })).toBe(false);
    expect(classify({ type: ESITO_RISPOSTA })).toBe(false);
  });

  it("type 'error' (timeout/rete) ⇒ offline (false)", () => {
    expect(
      classify({ type: ESITO_ERRORE, error: new Error("network timeout") }),
    ).toBe(false);
    expect(
      classify({ type: ESITO_ERRORE, error: new DOMException("aborted", "AbortError") }),
    ).toBe(false);
  });

  it("null / oggetto vuoto / tipo sconosciuto ⇒ offline (false)", () => {
    expect(classify(null)).toBe(false);
    expect(classify(undefined)).toBe(false);
    expect(classify({})).toBe(false);
    expect(classify({ type: "???" })).toBe(false);
    expect(classify("response")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isOnlineFromOutcome (forma "piatta" { ok, status, error })
// ---------------------------------------------------------------------------

describe("isOnlineFromOutcome (Requirements 16.4)", () => {
  it("status HTTP valido ⇒ online (true), incluso 401/403", () => {
    expect(isOnlineFromOutcome({ status: 200 })).toBe(true);
    expect(isOnlineFromOutcome({ status: 401 })).toBe(true);
    expect(isOnlineFromOutcome({ status: 403 })).toBe(true);
  });

  it("solo error (nessuno status) ⇒ offline (false)", () => {
    expect(isOnlineFromOutcome({ error: new Error("Failed to fetch") })).toBe(false);
    expect(
      isOnlineFromOutcome({ error: new DOMException("aborted", "AbortError") }),
    ).toBe(false);
  });

  it("null / oggetto vuoto / status non valido ⇒ offline (false)", () => {
    expect(isOnlineFromOutcome(null)).toBe(false);
    expect(isOnlineFromOutcome(undefined)).toBe(false);
    expect(isOnlineFromOutcome({})).toBe(false);
    expect(isOnlineFromOutcome({ status: 42 })).toBe(false);
  });
});
