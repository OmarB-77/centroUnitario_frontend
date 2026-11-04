// js/ui/armadi.js
//
// Schermata ARMADI DI RIPRISTINO (R9), accessibile a TUTTI gli utenti
// autenticati (Admin, Power-user, User). Offre due flussi alternativi,
// selezionabili tramite tab:
//
//   (A) SEGNALAZIONE prodotto carente/mancante (R9.1):
//       selezione del prodotto tramite Codice_Prodotto (inserimento manuale +
//       scansione LIVE) e invio di una segnalazione. La segnalazione NON
//       movimenta la giacenza: richiede SOLO il codice (nessuna quantità).
//
//   (B) PRELIEVO dagli armadi (R9.2/R9.3):
//       selezione del prodotto tramite Codice_Prodotto (+ scanner), quantità in
//       Unita_Base (intero >= 1, validata con validaQuantita) e invio del
//       prelievo. Accanto al campo quantità è mostrata la Giacenza_Armadi
//       attuale del prodotto (R9.7). Se la quantità supera la giacenza
//       disponibile viene mostrato un WARNING BLOCCANTE e la conferma è
//       impedita (R9.8). La difesa reale contro la giacenza negativa resta
//       comunque il trigger anti-negativa del DB (R9.5): un errore lato DB
//       viene mostrato mappato in italiano.
//
// SELEZIONE PRODOTTO (comune ai due flussi)
//   Il lookup del codice riusa la logica di dominio pura lookupPerCodice
//   (R15.2/R15.3): il prodotto è selezionato se e solo se esiste un prodotto
//   ATTIVO con quel codice; in caso contrario si mostra "prodotto non
//   disponibile" (R9.4) e nessun movimento è possibile. È sempre disponibile il
//   fallback di inserimento MANUALE del codice.
//
// SCANNER LIVE
//   Integrazione con js/scanner.js in modalità stream (stesso pattern di
//   scaricoCu.js). Lo scanner viene fermato dopo una lettura valida e
//   all'unmount della schermata (R15: stop scanner).
//
// ANTI-XSS / A11Y
//   Tutti i valori provenienti dal DB (nome/codice prodotto) sono inseriti via
//   textContent (mai innerHTML con dati grezzi), costruendo il DOM con il
//   helper condiviso js/ui/_dom.js. I controlli a sola icona hanno aria-label;
//   i messaggi di stato usano aria-live. Testi in italiano.
//
// CICLO DI VITA
//   mount(container) monta la UI e restituisce una funzione di unmount che
//   ferma lo scanner (se attivo) e svuota il contenitore.

import { listaProdotti } from "../api/prodotti.js";
import { prelievoArmadi, segnalazioneArmadi } from "../api/movimentiArmadi.js";
import { giacenzaArmadi } from "../api/giacenze.js";
import { lookupPerCodice } from "../domain/scanner_lookup.js";
import { validaQuantita } from "../domain/validation.js";
import {
  avviaScansione,
  fermaScansione,
  scansioneAttiva,
  ScannerError,
} from "../scanner.js";
import { el, svuota, areaMessaggi, mostraMessaggio } from "./_dom.js";
import { iconaBarcode, impostaIconaBottone } from "./_icone.js";

/** Id dei contenitori DOM usati dallo scanner live (uno per modalità). */
const ID_SCANNER_SEGN = "armadi-scanner-segnalazione";
const ID_SCANNER_PREL = "armadi-scanner-prelievo";

/**
 * Monta la schermata degli armadi di ripristino nel contenitore indicato.
 *
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {() => void} funzione di unmount (ferma lo scanner e svuota il DOM)
 */
export function mount(container) {
  if (!container || typeof container.appendChild !== "function") {
    throw new Error("Contenitore non valido per la schermata armadi.");
  }
  svuota(container);

  // Stato locale della schermata.
  const stato = {
    prodotti: /** @type {any[]} */ ([]), // anagrafica attiva (per lookup codice)
    modalita: /** @type {"segnalazione"|"prelievo"} */ ("segnalazione"),
    // Prodotto selezionato per ciascun flusso (indipendenti tra loro).
    prodottoSegnalazione: /** @type {any|null} */ (null),
    prodottoPrelievo: /** @type {any|null} */ (null),
    giacenzaPrelievo: /** @type {number|null} */ (null), // giacenza armadi del prodotto scelto
    scannerOn: false,
    scannerId: /** @type {string|null} */ (null), // contenitore scanner attivo
  };

  // ---- Struttura statica ---------------------------------------------------

  const titolo = el("h2", { text: "Armadi di ripristino" });
  const messaggi = areaMessaggi();

  // --- Tab di selezione modalità (segnalazione / prelievo) ---
  const tabSegnalazione = el("button", {
    type: "button",
    class: "armadi-tab",
    text: "Segnala carenza",
    attrs: {
      role: "tab",
      "aria-selected": "true",
      "aria-controls": "armadi-pannello-segnalazione",
    },
    on: { click: () => cambiaModalita("segnalazione") },
  });
  const tabPrelievo = el("button", {
    type: "button",
    class: "armadi-tab",
    text: "Registra prelievo",
    attrs: {
      role: "tab",
      "aria-selected": "false",
      "aria-controls": "armadi-pannello-prelievo",
    },
    on: { click: () => cambiaModalita("prelievo") },
  });
  const barraTab = el("div", { class: "armadi-tabs", attrs: { role: "tablist" } }, [
    tabSegnalazione,
    tabPrelievo,
  ]);

  // ======================================================================
  // (A) PANNELLO SEGNALAZIONE (R9.1) — solo codice prodotto.
  // ======================================================================

  const segnInputCodice = el("input", {
    type: "text",
    id: "armadi-segn-codice",
    autocomplete: "off",
    attrs: { placeholder: "Codice prodotto" },
  });
  const segnLabelCodice = el("label", {
    htmlFor: "armadi-segn-codice",
    text: "Codice prodotto",
  });
  const segnBtnCerca = el("button", { type: "button", text: "Cerca" });
  const segnBtnScanner = el("button", {
    type: "button",
    class: "btn-scanner btn-icona",
    attrs: {
      title: "Avvia scansione",
      "aria-label": "Avvia la scansione del codice con la fotocamera",
    },
  });
  segnBtnScanner.appendChild(iconaBarcode());
  const segnScannerBox = el("div", {
    id: ID_SCANNER_SEGN,
    class: "armadi-scanner",
    hidden: true,
  });
  const segnNomeProdotto = el("p", {
    class: "armadi-prodotto",
    attrs: { "aria-live": "polite" },
  });
  const segnBtnInvia = el("button", {
    type: "submit",
    class: "btn-primario",
    text: "Segnala prodotto carente",
    disabled: true,
  });

  const formSegnalazione = el(
    "form",
    {
      class: "armadi-form",
      attrs: { novalidate: "novalidate" },
      on: { submit: onSubmitSegnalazione },
    },
    [
      el("div", { class: "campo" }, [segnLabelCodice, segnInputCodice]),
      el("div", { class: "azioni" }, [segnBtnCerca, segnBtnScanner]),
      segnScannerBox,
      segnNomeProdotto,
      segnBtnInvia,
    ],
  );

  const pannelloSegnalazione = el(
    "section",
    {
      id: "armadi-pannello-segnalazione",
      class: "armadi-pannello",
      attrs: { role: "tabpanel", "aria-label": "Segnalazione prodotto carente" },
    },
    [
      el("p", {
        class: "armadi-descrizione",
        text: "Segnala un prodotto carente o mancante negli armadi di ripristino. Non serve indicare la quantità.",
      }),
      formSegnalazione,
    ],
  );

  // ======================================================================
  // (B) PANNELLO PRELIEVO (R9.2/R9.3/R9.7/R9.8) — codice + quantità.
  // ======================================================================

  const prelInputCodice = el("input", {
    type: "text",
    id: "armadi-prel-codice",
    autocomplete: "off",
    attrs: { placeholder: "Codice prodotto" },
  });
  const prelLabelCodice = el("label", {
    htmlFor: "armadi-prel-codice",
    text: "Codice prodotto",
  });
  const prelBtnCerca = el("button", { type: "button", text: "Cerca" });
  const prelBtnScanner = el("button", {
    type: "button",
    class: "btn-scanner btn-icona",
    attrs: {
      title: "Avvia scansione",
      "aria-label": "Avvia la scansione del codice con la fotocamera",
    },
  });
  prelBtnScanner.appendChild(iconaBarcode());
  const prelScannerBox = el("div", {
    id: ID_SCANNER_PREL,
    class: "armadi-scanner",
    hidden: true,
  });
  const prelNomeProdotto = el("p", {
    class: "armadi-prodotto",
    attrs: { "aria-live": "polite" },
  });

  const prelInputQta = el("input", {
    type: "number",
    id: "armadi-prel-qta",
    min: "1",
    step: "1",
    inputmode: "numeric",
    disabled: true,
    on: { input: aggiornaStatoPrelievo },
  });
  const prelLabelQta = el("label", {
    htmlFor: "armadi-prel-qta",
    text: "Quantità da prelevare (pezzi)",
  });
  // Giacenza armadi attuale mostrata accanto alla quantità (R9.7).
  const prelGiacenza = el("span", {
    class: "armadi-giacenza",
    attrs: { "aria-live": "polite" },
  });
  // Warning bloccante quando la quantità supera la giacenza (R9.8).
  const prelWarning = el("p", {
    class: "armadi-warning",
    attrs: { role: "alert", "aria-live": "assertive" },
    hidden: true,
  });

  const prelBtnInvia = el("button", {
    type: "submit",
    class: "btn-primario",
    text: "Registra prelievo",
    disabled: true,
  });

  const formPrelievo = el(
    "form",
    {
      class: "armadi-form",
      attrs: { novalidate: "novalidate" },
      on: { submit: onSubmitPrelievo },
    },
    [
      el("div", { class: "campo" }, [prelLabelCodice, prelInputCodice]),
      el("div", { class: "azioni" }, [prelBtnCerca, prelBtnScanner]),
      prelScannerBox,
      prelNomeProdotto,
      el("div", { class: "campo armadi-campo-qta" }, [
        prelLabelQta,
        prelInputQta,
        prelGiacenza,
      ]),
      prelWarning,
      prelBtnInvia,
    ],
  );

  const pannelloPrelievo = el(
    "section",
    {
      id: "armadi-pannello-prelievo",
      class: "armadi-pannello",
      hidden: true,
      attrs: { role: "tabpanel", "aria-label": "Prelievo dagli armadi di ripristino" },
    },
    [
      el("p", {
        class: "armadi-descrizione",
        text: "Registra un prelievo dagli armadi di ripristino indicando il prodotto e la quantità in pezzi.",
      }),
      formPrelievo,
    ],
  );

  const radice = el("section", { class: "armadi" }, [
    titolo,
    messaggi,
    barraTab,
    pannelloSegnalazione,
    pannelloPrelievo,
  ]);
  container.appendChild(radice);

  // ---- Scanner: avvio/stop (riuso del pattern di scaricoCu.js) ------------

  /**
   * Ferma lo scanner in modo sicuro e ripristina lo stato dei bottoni/box.
   */
  async function fermaScannerSicuro() {
    try {
      await fermaScansione();
    } catch {
      /* no-op */
    }
    const wasId = stato.scannerId;
    stato.scannerOn = false;
    stato.scannerId = null;
    // Ripristina ENTRAMBE le modalità (il box attivo era una sola, ma il reset
    // generale è idempotente e robusto al cambio tab).
    for (const [box, btn] of [
      [segnScannerBox, segnBtnScanner],
      [prelScannerBox, prelBtnScanner],
    ]) {
      box.hidden = true;
      impostaIconaBottone(btn, "barcode");
      btn.setAttribute("aria-label", "Avvia la scansione del codice con la fotocamera");
      btn.title = "Avvia scansione";
    }
    void wasId;
  }

  /**
   * Avvia/ferma lo scanner per la modalità indicata, impostando il codice letto
   * e tentando subito il lookup del prodotto.
   * @param {"segnalazione"|"prelievo"} modalita
   */
  async function toggleScanner(modalita) {
    const isSegn = modalita === "segnalazione";
    const box = isSegn ? segnScannerBox : prelScannerBox;
    const btn = isSegn ? segnBtnScanner : prelBtnScanner;
    const id = isSegn ? ID_SCANNER_SEGN : ID_SCANNER_PREL;
    const inputCodice = isSegn ? segnInputCodice : prelInputCodice;

    if (stato.scannerOn || scansioneAttiva()) {
      await fermaScannerSicuro();
      return;
    }

    box.hidden = false;
    impostaIconaBottone(btn, "stop");
    btn.setAttribute("aria-label", "Ferma la scansione");
    btn.title = "Ferma scansione";

    try {
      await avviaScansione(id, {
        onRisultato: (testo) => {
          inputCodice.value = testo;
          fermaScannerSicuro();
          selezionaProdotto(modalita, testo);
        },
      });
      stato.scannerOn = true;
      stato.scannerId = id;
    } catch (e) {
      stato.scannerOn = false;
      stato.scannerId = null;
      box.hidden = true;
      impostaIconaBottone(btn, "barcode");
      btn.setAttribute("aria-label", "Avvia la scansione del codice con la fotocamera");
      btn.title = "Avvia scansione";
      const msg =
        e instanceof ScannerError
          ? e.message
          : "Scanner non disponibile. Inserisci il codice manualmente.";
      mostraMessaggio(messaggi, msg, "errore");
    }
  }

  // ---- Selezione prodotto (lookup puro) -----------------------------------

  /**
   * Cerca il prodotto ATTIVO per codice nel flusso indicato e aggiorna lo stato.
   * @param {"segnalazione"|"prelievo"} modalita
   * @param {string} codice
   */
  async function selezionaProdotto(modalita, codice) {
    const esito = lookupPerCodice(stato.prodotti, codice);

    if (modalita === "segnalazione") {
      if (!esito.trovato) {
        stato.prodottoSegnalazione = null;
        segnNomeProdotto.textContent = "";
        segnBtnInvia.disabled = true;
        // R9.4: prodotto non disponibile.
        mostraMessaggio(messaggi, "Prodotto non disponibile.", "errore");
        return;
      }
      stato.prodottoSegnalazione = esito.prodotto;
      segnNomeProdotto.textContent = `Prodotto: ${esito.prodotto.nome} (${esito.prodotto.codice})`;
      segnBtnInvia.disabled = false;
      mostraMessaggio(messaggi, "", "info");
      return;
    }

    // modalita === "prelievo"
    if (!esito.trovato) {
      stato.prodottoPrelievo = null;
      stato.giacenzaPrelievo = null;
      prelNomeProdotto.textContent = "";
      prelGiacenza.textContent = "";
      prelInputQta.value = "";
      prelInputQta.disabled = true;
      prelWarning.hidden = true;
      aggiornaStatoPrelievo();
      mostraMessaggio(messaggi, "Prodotto non disponibile.", "errore");
      return;
    }

    stato.prodottoPrelievo = esito.prodotto;
    prelNomeProdotto.textContent = `Prodotto: ${esito.prodotto.nome} (${esito.prodotto.codice})`;
    prelInputQta.disabled = false;
    mostraMessaggio(messaggi, "", "info");
    await caricaGiacenzaPrelievo(esito.prodotto.id);
  }

  /**
   * Carica e mostra la Giacenza_Armadi attuale del prodotto scelto (R9.7).
   * @param {string} prodottoId
   */
  async function caricaGiacenzaPrelievo(prodottoId) {
    stato.giacenzaPrelievo = null;
    prelGiacenza.textContent = "Giacenza disponibile: …";
    const res = await giacenzaArmadi(prodottoId);
    if (!res.ok) {
      prelGiacenza.textContent = "";
      mostraMessaggio(
        messaggi,
        res.error || "Impossibile recuperare la giacenza degli armadi.",
        "errore",
      );
      aggiornaStatoPrelievo();
      return;
    }
    const g = res.data && typeof res.data.giacenza === "number" ? res.data.giacenza : 0;
    stato.giacenzaPrelievo = g;
    // Guida UX per non superare la giacenza (la difesa reale resta il DB).
    prelInputQta.max = String(g);
    prelGiacenza.textContent = `Giacenza disponibile: ${g}`;
    aggiornaStatoPrelievo();
  }

  /**
   * Ricalcola warning bloccante (R9.8) e stato del bottone di invio prelievo.
   */
  function aggiornaStatoPrelievo() {
    const haProdotto = !!stato.prodottoPrelievo;
    const grezzo = prelInputQta.value;
    const quantita = Number(grezzo);
    const qtaValida =
      grezzo !== "" && Number.isInteger(quantita) && validaQuantita(quantita).ok;

    let superaGiacenza = false;
    if (
      qtaValida &&
      typeof stato.giacenzaPrelievo === "number" &&
      quantita > stato.giacenzaPrelievo
    ) {
      superaGiacenza = true;
    }

    // Warning bloccante quando la quantità supera la giacenza disponibile.
    if (superaGiacenza) {
      prelWarning.hidden = false;
      prelWarning.textContent = `La quantità (${quantita}) supera la giacenza disponibile (${stato.giacenzaPrelievo}).`;
    } else {
      prelWarning.hidden = true;
      prelWarning.textContent = "";
    }

    prelBtnInvia.disabled = !(haProdotto && qtaValida && !superaGiacenza);
  }

  // ---- Invio: segnalazione (R9.1) -----------------------------------------

  async function onSubmitSegnalazione(ev) {
    ev.preventDefault();
    mostraMessaggio(messaggi, "", "info");

    if (!stato.prodottoSegnalazione) {
      mostraMessaggio(messaggi, "Seleziona prima un prodotto.", "errore");
      return;
    }

    segnBtnInvia.disabled = true;
    mostraMessaggio(messaggi, "Invio segnalazione in corso…", "info");

    const res = await segnalazioneArmadi({ prodottoId: stato.prodottoSegnalazione.id });
    if (!res.ok) {
      mostraMessaggio(
        messaggi,
        res.error || "Impossibile registrare la segnalazione.",
        "errore",
      );
      segnBtnInvia.disabled = false;
      return;
    }

    mostraMessaggio(messaggi, "Segnalazione registrata.", "successo");
    // Reset del flusso mantenendo l'anagrafica caricata.
    stato.prodottoSegnalazione = null;
    segnInputCodice.value = "";
    segnNomeProdotto.textContent = "";
    segnBtnInvia.disabled = true;
  }

  // ---- Invio: prelievo (R9.2/R9.3/R9.5/R9.8) ------------------------------

  async function onSubmitPrelievo(ev) {
    ev.preventDefault();
    mostraMessaggio(messaggi, "", "info");

    if (!stato.prodottoPrelievo) {
      mostraMessaggio(messaggi, "Seleziona prima un prodotto.", "errore");
      return;
    }

    const quantita = Number(prelInputQta.value);
    const vQta = validaQuantita(Number.isInteger(quantita) ? quantita : prelInputQta.value);
    if (!vQta.ok) {
      mostraMessaggio(messaggi, vQta.errors[0], "errore");
      return;
    }

    // Guardia bloccante client sulla giacenza (R9.8); la difesa reale è il DB.
    if (
      typeof stato.giacenzaPrelievo === "number" &&
      quantita > stato.giacenzaPrelievo
    ) {
      mostraMessaggio(
        messaggi,
        `La quantità (${quantita}) supera la giacenza disponibile (${stato.giacenzaPrelievo}).`,
        "errore",
      );
      aggiornaStatoPrelievo();
      return;
    }

    prelBtnInvia.disabled = true;
    mostraMessaggio(messaggi, "Registrazione prelievo in corso…", "info");

    const res = await prelievoArmadi({
      prodottoId: stato.prodottoPrelievo.id,
      quantitaBase: quantita,
    });
    if (!res.ok) {
      // Errore mappato in italiano (es. giacenza insufficiente dal trigger, R9.5).
      mostraMessaggio(messaggi, res.error || "Impossibile registrare il prelievo.", "errore");
      aggiornaStatoPrelievo();
      return;
    }

    mostraMessaggio(messaggi, "Prelievo registrato.", "successo");
    // Ricarica la giacenza (è cambiata) e azzera la quantità, mantenendo il
    // prodotto selezionato.
    prelInputQta.value = "";
    prelWarning.hidden = true;
    await caricaGiacenzaPrelievo(stato.prodottoPrelievo.id);
  }

  // ---- Cambio modalità (tab) ----------------------------------------------

  /**
   * Passa tra segnalazione e prelievo, fermando l'eventuale scanner attivo.
   * @param {"segnalazione"|"prelievo"} modalita
   */
  function cambiaModalita(modalita) {
    if (modalita === stato.modalita) return;
    fermaScannerSicuro();
    stato.modalita = modalita;
    const isSegn = modalita === "segnalazione";

    pannelloSegnalazione.hidden = !isSegn;
    pannelloPrelievo.hidden = isSegn;
    tabSegnalazione.setAttribute("aria-selected", isSegn ? "true" : "false");
    tabPrelievo.setAttribute("aria-selected", isSegn ? "false" : "true");
    tabSegnalazione.classList.toggle("armadi-tab--attiva", isSegn);
    tabPrelievo.classList.toggle("armadi-tab--attiva", !isSegn);
    mostraMessaggio(messaggi, "", "info");
  }

  // ---- Wiring eventi di ricerca/scanner -----------------------------------

  function onCercaSegnalazione() {
    selezionaProdotto("segnalazione", segnInputCodice.value);
  }
  function onCercaPrelievo() {
    selezionaProdotto("prelievo", prelInputCodice.value);
  }

  segnBtnCerca.addEventListener("click", onCercaSegnalazione);
  prelBtnCerca.addEventListener("click", onCercaPrelievo);
  segnInputCodice.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onCercaSegnalazione();
    }
  });
  prelInputCodice.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onCercaPrelievo();
    }
  });
  segnBtnScanner.addEventListener("click", () => toggleScanner("segnalazione"));
  prelBtnScanner.addEventListener("click", () => toggleScanner("prelievo"));

  // Stato iniziale: tab segnalazione attiva.
  tabSegnalazione.classList.add("armadi-tab--attiva");

  // ---- Caricamento anagrafica ---------------------------------------------

  (async function caricaAnagrafica() {
    mostraMessaggio(messaggi, "Caricamento anagrafica prodotti…", "info");
    const res = await listaProdotti({ attiviSolo: true });
    if (!res.ok) {
      mostraMessaggio(
        messaggi,
        res.error || "Impossibile caricare i prodotti.",
        "errore",
      );
      return;
    }
    stato.prodotti = Array.isArray(res.data) ? res.data : [];
    mostraMessaggio(messaggi, "", "info");
  })();

  // ---- Unmount -------------------------------------------------------------
  return function unmount() {
    // Ferma lo scanner se attivo (R15: stop scanner all'unmount).
    fermaScannerSicuro();
    if (radice.parentNode) radice.parentNode.removeChild(radice);
  };
}

export default { mount };
