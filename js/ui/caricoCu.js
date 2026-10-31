// js/ui/caricoCu.js
//
// Schermata di CARICO nel Centro Unitario (Task 17.1, R7.1-7.13), per Admin e
// Power-user. Costruisce un form di carico con:
//   - selezione del prodotto tramite CODICE, con pulsante "scansiona" che avvia
//     lo scanner live (js/scanner.js) e, sul testo decodificato, esegue
//     lookupPerCodice (js/domain/scanner_lookup.js) contro l'anagrafica caricata
//     per selezionare il prodotto; fallback con inserimento manuale del codice;
//   - scelta ESPLICITA e SENZA DEFAULT dell'unità di inserimento
//     (unita_base / unita_carico) (R7.11/R7.12), con visualizzazione dei
//     pezzi_per_confezione e anteprima LIVE della quantità risultante in unità
//     base (quantitaInBase di js/domain/units.js) (R7.1/R7.13);
//   - quantità (intero >= 1) e lotto opzionale (R7.2/R7.3);
//   - campi scadenza CONDIZIONATI dal flag senza_scadenza del prodotto:
//       * con scadenza  -> data_scadenza (obbligatoria) (R7.5/R7.9);
//       * senza scadenza -> data_produzione (obbligatoria) + override opzionale
//         della scadenza effettiva (R7.6/R7.7/R7.8/R7.10);
//   - validazione client con messaggi inline in italiano e invio tramite
//     caricoCu(...) di js/api/movimentiCu.js, con feedback di esito/errore.
//
// SICUREZZA ANTI-XSS: i valori derivati dal DB (nome/codice prodotto, messaggi
// del backend) vengono SEMPRE inseriti via textContent, mai via innerHTML con
// dati grezzi. L'HTML statico del form è costruito con createElement, quindi non
// c'è interpolazione di dati non fidati. Le checkbox/radio non sono usate qui;
// per i controlli a sola icona è impostato aria-label.
//
// CICLO DI VITA: mount(container) monta la UI e restituisce una funzione di
// unmount; lo scanner viene SEMPRE fermato in fase di unmount e dopo una
// scansione andata a buon fine (fermaScansione è idempotente).

import { listaProdotti } from "../api/prodotti.js";
import { caricoCu } from "../api/movimentiCu.js";
import { quantitaInBase, UNITA_BASE, UNITA_CARICO } from "../domain/units.js";
import { lookupPerCodice } from "../domain/scanner_lookup.js";
import {
  validaQuantita,
  validaUnitaInserimento,
  validaCampiScadenza,
} from "../domain/validation.js";
import { avviaScansione, fermaScansione, ScannerError } from "../scanner.js";

// Id del contenitore DOM in cui lo scanner monta lo stream video.
const ID_SCANNER = "carico-cu-scanner";

/**
 * Crea un elemento con classi e, opzionalmente, testo (via textContent) e
 * attributi. Nessun uso di innerHTML: i valori sono sempre impostati come testo.
 * @param {string} tag nome del tag
 * @param {{ classe?: string, testo?: string, attr?: Record<string,string> }} [opts]
 * @returns {HTMLElement}
 */
function el(tag, opts = {}) {
  const n = document.createElement(tag);
  if (opts.classe) n.className = opts.classe;
  if (opts.testo != null) n.textContent = opts.testo;
  if (opts.attr) {
    for (const [k, v] of Object.entries(opts.attr)) {
      if (v != null) n.setAttribute(k, String(v));
    }
  }
  return n;
}

/**
 * Crea una coppia <label>/<campo> con un elemento di errore inline associato.
 * @param {string} idCampo id del campo (usato per label e aria-describedby)
 * @param {string} etichetta testo della label
 * @param {HTMLElement} campo l'elemento input/select/textarea
 * @returns {{ wrapper: HTMLElement, errore: HTMLElement }}
 */
function campoConErrore(idCampo, etichetta, campo) {
  const wrapper = el("div", { classe: "campo" });
  const label = el("label", { testo: etichetta, attr: { for: idCampo } });
  campo.id = idCampo;
  const errore = el("p", {
    classe: "campo-errore",
    attr: { id: `${idCampo}-errore`, role: "alert", hidden: "hidden" },
  });
  campo.setAttribute("aria-describedby", errore.id);
  wrapper.append(label, campo, errore);
  return { wrapper, errore };
}

/**
 * Imposta/azzera il messaggio di errore inline di un campo.
 * @param {HTMLElement} nodoErrore elemento <p> dell'errore
 * @param {string|null} messaggio messaggio in italiano, o null per nascondere
 */
function mostraErroreCampo(nodoErrore, messaggio) {
  if (messaggio) {
    nodoErrore.textContent = messaggio;
    nodoErrore.hidden = false;
  } else {
    nodoErrore.textContent = "";
    nodoErrore.hidden = true;
  }
}

/**
 * Converte il valore di un input numerico in intero, o restituisce NaN se vuoto
 * o non numerico (così la validazione segnala il tipo errato).
 * @param {string} v
 * @returns {number}
 */
function aIntero(v) {
  const t = String(v ?? "").trim();
  if (t === "" || !Number.isFinite(Number(t))) return NaN;
  const n = Number(t);
  return Number.isInteger(n) ? n : n; // non-interi lasciati passare: validaQuantita li rifiuta
}

/**
 * Monta la schermata di carico CU nel contenitore indicato.
 *
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {() => void} funzione di smontaggio (ferma lo scanner e pulisce il DOM)
 */
export function mount(container) {
  if (!container || typeof container.append !== "function") {
    throw new Error("mount(caricoCu): contenitore DOM non valido.");
  }

  // Stato locale della schermata.
  let prodotti = []; // anagrafica caricata (prodotti attivi)
  let prodottoSelezionato = null; // prodotto corrente scelto da codice/scanner
  let scannerInCorso = false;

  container.textContent = "";
  const root = el("section", { classe: "schermata carico-cu" });
  root.setAttribute("aria-labelledby", "carico-cu-titolo");

  const titolo = el("h2", {
    testo: "Carico centro unitario",
    attr: { id: "carico-cu-titolo" },
  });
  root.append(titolo);

  const form = el("form", { classe: "form carico-cu-form", attr: { novalidate: "novalidate" } });

  // --- Selezione prodotto (codice + scanner) ---------------------------------
  const gruppoProdotto = el("fieldset", { classe: "gruppo" });
  gruppoProdotto.append(el("legend", { testo: "Prodotto" }));

  const inputCodice = el("input", {
    attr: { type: "text", inputmode: "text", autocomplete: "off", placeholder: "Codice prodotto" },
  });
  const { wrapper: wCodice, errore: errCodice } = campoConErrore(
    "carico-cu-codice",
    "Codice prodotto",
    inputCodice,
  );

  const riga = el("div", { classe: "riga-codice" });
  const btnScansiona = el("button", {
    classe: "pulsante pulsante-icona",
    testo: "📷",
    attr: { type: "button", "aria-label": "Scansiona il codice con la fotocamera", title: "Scansiona il codice" },
  });
  riga.append(wCodice, btnScansiona);
  gruppoProdotto.append(riga);

  // Contenitore dello stream scanner (nascosto finché non si avvia).
  const boxScanner = el("div", { classe: "scanner-box", attr: { hidden: "hidden" } });
  const nodoScanner = el("div", { attr: { id: ID_SCANNER } });
  const btnChiudiScanner = el("button", {
    classe: "pulsante pulsante-secondario",
    testo: "Chiudi scanner",
    attr: { type: "button" },
  });
  boxScanner.append(nodoScanner, btnChiudiScanner);
  gruppoProdotto.append(boxScanner);

  // Nome del prodotto selezionato (valore DB → textContent).
  const nomeProdotto = el("p", { classe: "prodotto-selezionato", attr: { "aria-live": "polite" } });
  gruppoProdotto.append(nomeProdotto);
  form.append(gruppoProdotto);

  // --- Unità di inserimento (obbligatoria, senza default) --------------------
  const gruppoUnita = el("fieldset", { classe: "gruppo" });
  gruppoUnita.append(el("legend", { testo: "Unità di inserimento" }));

  const selUnita = el("select");
  // Opzione placeholder NON selezionabile: nessun default preselezionato (R7.11).
  const optVuota = el("option", {
    testo: "— Seleziona unità —",
    attr: { value: "", disabled: "disabled", selected: "selected" },
  });
  const optBase = el("option", { testo: "Unità base", attr: { value: UNITA_BASE } });
  const optCarico = el("option", { testo: "Unità di carico (confezione)", attr: { value: UNITA_CARICO } });
  selUnita.append(optVuota, optBase, optCarico);
  const { wrapper: wUnita, errore: errUnita } = campoConErrore(
    "carico-cu-unita",
    "Unità di inserimento",
    selUnita,
  );
  gruppoUnita.append(wUnita);

  // Info pezzi per confezione (valore numerico del prodotto) + anteprima.
  const infoPezzi = el("p", { classe: "info-pezzi", attr: { "aria-live": "polite" } });
  const anteprima = el("p", { classe: "anteprima-base", attr: { "aria-live": "polite" } });
  gruppoUnita.append(infoPezzi, anteprima);
  form.append(gruppoUnita);

  // --- Quantità e lotto ------------------------------------------------------
  const gruppoQta = el("fieldset", { classe: "gruppo" });
  gruppoQta.append(el("legend", { testo: "Quantità e lotto" }));

  const inputQta = el("input", {
    attr: { type: "number", min: "1", step: "1", inputmode: "numeric", placeholder: "Quantità" },
  });
  const { wrapper: wQta, errore: errQta } = campoConErrore("carico-cu-quantita", "Quantità", inputQta);

  const inputLotto = el("input", {
    attr: { type: "text", autocomplete: "off", placeholder: "Lotto (facoltativo)" },
  });
  const { wrapper: wLotto } = campoConErrore("carico-cu-lotto", "Lotto (facoltativo)", inputLotto);

  gruppoQta.append(wQta, wLotto);
  form.append(gruppoQta);

  // --- Date (condizionate dal flag senza_scadenza) ---------------------------
  const gruppoDate = el("fieldset", { classe: "gruppo" });
  gruppoDate.append(el("legend", { testo: "Scadenza" }));

  const inputScadenza = el("input", { attr: { type: "date" } });
  const { wrapper: wScadenza, errore: errScadenza } = campoConErrore(
    "carico-cu-scadenza",
    "Data di scadenza",
    inputScadenza,
  );

  const inputProduzione = el("input", { attr: { type: "date" } });
  const { wrapper: wProduzione, errore: errProduzione } = campoConErrore(
    "carico-cu-produzione",
    "Data di produzione",
    inputProduzione,
  );

  const inputOverride = el("input", { attr: { type: "date" } });
  const { wrapper: wOverride } = campoConErrore(
    "carico-cu-override",
    "Scadenza effettiva (facoltativa, sovrascrive il calcolo)",
    inputOverride,
  );

  // Di default tutti nascosti finché non si seleziona un prodotto.
  wScadenza.hidden = true;
  wProduzione.hidden = true;
  wOverride.hidden = true;
  gruppoDate.append(wScadenza, wProduzione, wOverride);
  form.append(gruppoDate);

  // --- Azioni e feedback -----------------------------------------------------
  const btnInvia = el("button", {
    classe: "pulsante pulsante-primario",
    testo: "Registra carico",
    attr: { type: "submit" },
  });
  form.append(btnInvia);

  const feedback = el("p", { classe: "feedback", attr: { role: "status", "aria-live": "polite", hidden: "hidden" } });
  form.append(feedback);

  root.append(form);
  container.append(root);

  // -------------------------------------------------------------------------
  // Logica di supporto
  // -------------------------------------------------------------------------

  function mostraFeedback(messaggio, tipo) {
    // messaggio può provenire dal backend → sempre via textContent.
    feedback.textContent = messaggio || "";
    feedback.hidden = !messaggio;
    feedback.classList.remove("feedback-ok", "feedback-errore");
    if (tipo === "ok") feedback.classList.add("feedback-ok");
    else if (tipo === "errore") feedback.classList.add("feedback-errore");
  }

  /** Aggiorna i campi dipendenti dal prodotto selezionato (unità/date). */
  function applicaProdotto(p) {
    prodottoSelezionato = p;
    if (!p) {
      nomeProdotto.textContent = "";
      infoPezzi.textContent = "";
      wScadenza.hidden = true;
      wProduzione.hidden = true;
      wOverride.hidden = true;
      aggiornaAnteprima();
      return;
    }
    // Nome + codice dal DB → textContent (anti-XSS).
    nomeProdotto.textContent = `Selezionato: ${p.nome} (${p.codice})`;
    const ppc = Number(p.pezzi_per_confezione);
    infoPezzi.textContent = Number.isFinite(ppc)
      ? `Pezzi per confezione: ${ppc}`
      : "";

    // Campi data condizionati dal flag senza_scadenza (R7.5/R7.6).
    if (p.senza_scadenza === true) {
      wProduzione.hidden = false;
      wOverride.hidden = false;
      wScadenza.hidden = true;
      inputScadenza.value = "";
    } else {
      wScadenza.hidden = false;
      wProduzione.hidden = true;
      wOverride.hidden = true;
      inputProduzione.value = "";
      inputOverride.value = "";
    }
    aggiornaAnteprima();
  }

  /** Ricalcola l'anteprima della quantità in unità base (R7.1/R7.13). */
  function aggiornaAnteprima() {
    const unita = selUnita.value;
    const q = aIntero(inputQta.value);
    if (!prodottoSelezionato || unita === "" || Number.isNaN(q)) {
      anteprima.textContent = "";
      return;
    }
    try {
      const base = quantitaInBase(q, unita, Number(prodottoSelezionato.pezzi_per_confezione));
      anteprima.textContent = `Quantità in unità base: ${base}`;
    } catch {
      anteprima.textContent = "";
    }
  }

  /** Cerca il prodotto per codice (manuale o da scanner) e lo applica. */
  function selezionaDaCodice(codice) {
    const esito = lookupPerCodice(prodotti, codice);
    if (esito.trovato) {
      mostraErroreCampo(errCodice, null);
      applicaProdotto(esito.prodotto);
      return true;
    }
    applicaProdotto(null);
    mostraErroreCampo(errCodice, "Codice non riconosciuto tra i prodotti attivi.");
    return false;
  }

  async function chiudiScanner() {
    boxScanner.hidden = true;
    scannerInCorso = false;
    await fermaScansione();
  }

  async function apriScanner() {
    mostraFeedback(null);
    boxScanner.hidden = false;
    scannerInCorso = true;
    try {
      await avviaScansione(ID_SCANNER, {
        onRisultato: (testo) => {
          // Scrive il codice letto nell'input e tenta la selezione.
          inputCodice.value = testo;
          const ok = selezionaDaCodice(testo);
          // Ferma lo scanner dopo una lettura andata a buon fine (R: stop dopo scansione).
          if (ok) {
            chiudiScanner();
          }
        },
      });
    } catch (err) {
      // Fallback: su errore camera/libreria resta l'inserimento manuale.
      boxScanner.hidden = true;
      scannerInCorso = false;
      const msg =
        err instanceof ScannerError
          ? err.message
          : "Scanner non disponibile: inserisci il codice manualmente.";
      mostraErroreCampo(errCodice, msg);
    }
  }

  /** Validazione client complessiva prima dell'invio. */
  function validaForm() {
    let valido = true;
    // Reset errori inline.
    mostraErroreCampo(errCodice, null);
    mostraErroreCampo(errUnita, null);
    mostraErroreCampo(errQta, null);
    mostraErroreCampo(errScadenza, null);
    mostraErroreCampo(errProduzione, null);

    if (!prodottoSelezionato) {
      mostraErroreCampo(errCodice, "Seleziona un prodotto valido tramite codice o scanner.");
      valido = false;
    }

    const vUnita = validaUnitaInserimento(selUnita.value || "");
    if (!vUnita.ok) {
      mostraErroreCampo(errUnita, vUnita.errors[0]);
      valido = false;
    }

    const q = aIntero(inputQta.value);
    const vQta = validaQuantita(q);
    if (!vQta.ok) {
      mostraErroreCampo(errQta, vQta.errors[0]);
      valido = false;
    }

    if (prodottoSelezionato) {
      const vDate = validaCampiScadenza(prodottoSelezionato, {
        data_scadenza: inputScadenza.value,
        data_produzione: inputProduzione.value,
      });
      if (!vDate.ok) {
        if (prodottoSelezionato.senza_scadenza === true) {
          mostraErroreCampo(errProduzione, vDate.errors[0]);
        } else {
          mostraErroreCampo(errScadenza, vDate.errors[0]);
        }
        valido = false;
      }
    }

    return valido;
  }

  async function onSubmit(evento) {
    evento.preventDefault();
    mostraFeedback(null);
    if (!validaForm()) {
      mostraFeedback("Correggi i campi evidenziati e riprova.", "errore");
      return;
    }

    btnInvia.disabled = true;
    try {
      const senza = prodottoSelezionato.senza_scadenza === true;
      const esito = await caricoCu({
        prodottoId: prodottoSelezionato.id,
        quantita: aIntero(inputQta.value),
        unitaInserimento: selUnita.value,
        pezziPerConfezione: Number(prodottoSelezionato.pezzi_per_confezione),
        lotto: inputLotto.value,
        dataScadenza: senza ? undefined : inputScadenza.value,
        dataProduzione: senza ? inputProduzione.value : undefined,
        dataScadenzaEffettivaOverride: senza ? inputOverride.value : undefined,
      });

      if (esito && esito.ok) {
        mostraFeedback("Carico registrato correttamente.", "ok");
        // Reset dei campi di movimento, mantenendo il prodotto selezionato.
        inputQta.value = "";
        inputLotto.value = "";
        inputScadenza.value = "";
        inputProduzione.value = "";
        inputOverride.value = "";
        aggiornaAnteprima();
      } else {
        // Messaggio di errore dal layer API (italiano) → textContent.
        mostraFeedback((esito && esito.error) || "Impossibile registrare il carico.", "errore");
      }
    } catch {
      mostraFeedback("Si è verificato un errore durante il salvataggio.", "errore");
    } finally {
      btnInvia.disabled = false;
    }
  }

  // -------------------------------------------------------------------------
  // Listener
  // -------------------------------------------------------------------------
  const onCodiceChange = () => {
    const v = inputCodice.value;
    if (v.trim() === "") {
      applicaProdotto(null);
      mostraErroreCampo(errCodice, null);
      return;
    }
    selezionaDaCodice(v);
  };
  inputCodice.addEventListener("change", onCodiceChange);
  selUnita.addEventListener("change", aggiornaAnteprima);
  inputQta.addEventListener("input", aggiornaAnteprima);
  btnScansiona.addEventListener("click", apriScanner);
  btnChiudiScanner.addEventListener("click", chiudiScanner);
  form.addEventListener("submit", onSubmit);

  // Caricamento asincrono dell'anagrafica (solo prodotti attivi).
  (async () => {
    const res = await listaProdotti({ attiviSolo: true });
    if (res && res.ok && Array.isArray(res.data)) {
      prodotti = res.data;
    } else {
      mostraFeedback(
        (res && res.error) || "Impossibile caricare l'anagrafica prodotti.",
        "errore",
      );
    }
  })();

  // Funzione di smontaggio: ferma SEMPRE lo scanner e pulisce il DOM.
  return function unmount() {
    try {
      form.removeEventListener("submit", onSubmit);
    } catch {
      /* no-op */
    }
    if (scannerInCorso) {
      // Best-effort; fermaScansione è idempotente e asincrona.
      fermaScansione();
      scannerInCorso = false;
    }
    container.textContent = "";
  };
}

export default { mount };
