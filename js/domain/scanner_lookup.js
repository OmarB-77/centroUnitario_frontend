// js/domain/scanner_lookup.js
//
// Logica di dominio PURA per il lookup di un prodotto a partire dal codice
// acquisito dallo Scanner_Barcode (o inserito manualmente come fallback).
//
// Questo modulo NON ha effetti collaterali: niente DOM, niente rete, niente
// fotocamera, niente stato. È pensato per essere testabile in isolamento con
// Vitest + fast-check (vedi task 14.2 — Property 9).
//
// Contesto (requisiti R15.2/R15.3, design "Property 9: Selezione prodotto da
// scanner per codice"):
//   - R15.2: quando lo scanner riconosce un Codice_Prodotto ESISTENTE in
//            anagrafica e associato a un prodotto ATTIVO, il sistema seleziona
//            il prodotto corrispondente nel flusso operativo in corso.
//   - R15.3: se il codice è ASSENTE dall'anagrafica OPPURE associato a un
//            prodotto NON attivo, il sistema NON seleziona alcun prodotto e
//            segnala "codice non riconosciuto".
//
//   In sintesi (Property 9): il prodotto è selezionato *se e solo se* esiste
//   un prodotto ATTIVO con quel codice.
//
// NORMALIZZAZIONE DEL CODICE SCANSIONATO
//   I lettori barcode/QR aggiungono spesso caratteri di controllo in coda
//   (tipicamente un invio "\r"/"\n", talvolta un tab) come separatore di fine
//   lettura; possono inoltre esserci spazi iniziali/finali. Per confrontare il
//   codice scansionato con il `codice` di anagrafica si applica quindi una
//   normalizzazione MINIMALE e conservativa:
//     - si rimuovono gli spazi bianchi e i caratteri di controllo iniziali e
//       finali (trim esteso: spazi, tab, newline, altri whitespace/controllo);
//     - NON si tocca il contenuto interno del codice (nessuna rimozione di
//       spazi interni, nessuna rimozione di zeri, nessuna normalizzazione).
//   Il confronto è CASE-SENSITIVE: i codici prodotto sono identificativi esatti
//   (il vincolo UNIQUE lato DB è su `codice` così com'è), quindi non si applica
//   alcuna conversione di maiuscole/minuscole. Lo stesso trim viene applicato al
//   `codice` di anagrafica per robustezza, ma l'uguaglianza resta esatta.
//
// GESTIONE DEI CASI
//   - codice vuoto/blank (o solo whitespace/controllo) -> { trovato: false }
//   - nessun prodotto con quel codice                   -> { trovato: false }
//   - prodotto trovato ma NON attivo                    -> { trovato: false }
//   - esattamente un prodotto attivo con quel codice    -> { trovato: true, prodotto }
//   - più prodotti con lo stesso codice (non dovrebbe accadere: il DB ha un
//     vincolo UNIQUE su `codice`) -> si restituisce il PRIMO prodotto attivo
//     incontrato; è un caso degenere tollerato per robustezza lato client.
//
// NOTA: modulo PURO. Nessun accesso a DOM, rete o Supabase.

/**
 * Normalizza un codice (scansionato o di anagrafica) per il confronto.
 *
 * Applica un trim esteso che rimuove spazi, tab, newline e altri caratteri di
 * controllo/whitespace iniziali e finali, lasciando INVARIATO il contenuto
 * interno. Il confronto resta case-sensitive (nessuna conversione di case).
 *
 * @param {unknown} codice valore grezzo (tipicamente stringa dallo scanner)
 * @returns {string} codice normalizzato; stringa vuota se l'input non è una
 *          stringa valorizzata o contiene solo whitespace/controllo
 */
export function normalizzaCodice(codice) {
  if (typeof codice !== "string") return "";
  // \s copre spazi/tab/newline; \u0000-\u001F i caratteri di controllo che i
  // lettori possono accodare. Si rimuovono SOLO in testa e in coda.
  return codice.replace(/^[\s\u0000-\u001F]+|[\s\u0000-\u001F]+$/g, "");
}

/**
 * Cerca in anagrafica il prodotto ATTIVO corrispondente a un codice scansionato.
 *
 * Replica lato client la Property 9 (R15.2/R15.3): restituisce un esito
 * "trovato" se e solo se esiste un prodotto attivo il cui `codice` normalizzato
 * coincide esattamente con il codice scansionato normalizzato.
 *
 * @param {Array<{codice?: string, attivo?: boolean}>} prodotti anagrafica
 *        prodotti (ogni voce con almeno `codice` e `attivo`)
 * @param {string} codice codice acquisito dallo scanner (o inserito a mano)
 * @returns {{trovato: true, prodotto: object} | {trovato: false}}
 *          esito del lookup: il prodotto selezionato oppure "non trovato"
 */
export function lookupPerCodice(prodotti, codice) {
  const cercato = normalizzaCodice(codice);

  // Codice vuoto/blank: nessuna selezione (R15.3, caso degenere di input).
  if (cercato === "") {
    return { trovato: false };
  }

  // Difesa sull'anagrafica: input non iterabile -> nessuna selezione.
  if (!Array.isArray(prodotti)) {
    return { trovato: false };
  }

  for (const p of prodotti) {
    if (!p) continue;
    // Solo prodotti ATTIVI sono selezionabili (R15.3: codice associato a
    // prodotto non attivo -> nessuna selezione).
    if (!p.attivo) continue;
    // Confronto esatto (case-sensitive) sui codici normalizzati.
    if (normalizzaCodice(p.codice) === cercato) {
      // Primo prodotto attivo corrispondente. In presenza del vincolo UNIQUE
      // lato DB c'è al più un prodotto per codice; in caso di duplicati
      // degeneri si restituisce comunque il primo (R15.2).
      return { trovato: true, prodotto: p };
    }
  }

  // Codice assente dall'anagrafica (tra i prodotti attivi): nessuna selezione
  // e il chiamante mostrerà "codice non riconosciuto" (R15.3).
  return { trovato: false };
}

export default { lookupPerCodice, normalizzaCodice };
