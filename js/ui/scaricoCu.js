// js/ui/scaricoCu.js
//
// Schermata SCARICO dal Centro Unitario (R8.1-R8.12), per Admin/Power-user.
//
// Flusso operativo:
//   1. Selezione del prodotto tramite Codice_Prodotto: inserimento manuale +
//      scansione LIVE dalla fotocamera (Scanner_Barcode). Il lookup riusa la
//      logica di dominio pura lookupPerCodice (R15.2/R15.3). Mostrato il nome
//      del prodotto selezionato.
//   2. Caricati i LOTTI disponibili del prodotto nel CU (lottiDisponibili):
//      per ogni lotto si mostra lotto + data_scadenza_effettiva + giacenza
//      residua; sono presentati SOLO i lotti con giacenza > 0 (R8.1). Se non
//      esistono lotti con giacenza si mostra "assenza di giacenza" (R8.9).
//   3. Quantità in UNITÀ BASE (R8.2/R8.4): intero >= 1 validato lato client e
//      limitato alla giacenza residua del lotto scelto (guardia UX; la difesa
//      reale è il trigger anti-negativa del DB).
//   4. Destinazione TRIPLA tramite radio (R8.2): 'armadio_ripristino' |
//      'associazione' | 'altro'. Dettaglio condizionato (R8.10/R8.11/R8.12):
//        - associazione → select OBBLIGATORIA dall'Anagrafica_Associazioni;
//        - altro → testo libero FACOLTATIVO (max 500);
//        - armadio_ripristino → nessun dettaglio.
//      Coerenza destinazione/dettaglio validata con validaDestinazione.
//   5. Invio tramite la RPC atomica scarico_cu (via api scaricoCu): la RPC
//      esegue atomicamente lo scarico CU e, SOLO per armadio_ripristino, il
//      carico automatico negli armadi (R8.5/R8.6/R8.7). Feedback di esito in
//      italiano; errori del DB (es. giacenza insufficiente) mostrati mappati.
//
// SICUREZZA / ANTI-XSS
//   Tutti i valori provenienti dal DB (nome prodotto, lotto, associazioni) sono
//   inseriti nel DOM via textContent / proprietà (value, option.textContent),
//   MAI tramite innerHTML con dati grezzi. Si costruisce il DOM con
//   createElement. Questo rispetta R "escape anti-XSS".
//
// CHECKBOX/RADIO RENDERING
//   La destinazione usa input radio reali (non checkbox) con <label> associate,
//   così da non incorrere nei problemi di appearance:none del reset CSS globale.
//
// ACCESSIBILITÀ
//   Controlli a sola icona con aria-label; label esplicite per ogni campo;
//   messaggi di stato in aria-live.
//
// CICLO DI VITA
//   mount(container) monta la UI e restituisce una funzione di unmount che
//   ferma lo scanner (se attivo) e pulisce il contenitore (R15: stop scanner
//   all'unmount).

import { listaProdotti } from "../api/prodotti.js";
import { listaAssociazioni } from "../api/associazioni.js";
import { lottiDisponibili } from "../api/giacenze.js";
import { scaricoCu } from "../api/movimentiCu.js";
import { lookupPerCodice } from "../domain/scanner_lookup.js";
import { validaQuantita, validaDestinazione } from "../domain/validation.js";
import {
  avviaScansione,
  fermaScansione,
  scansioneAttiva,
  ScannerError,
} from "../scanner.js";

/** Id del contenitore DOM usato dallo scanner live. */
const ID_SCANNER = "scaricoCu-scanner";

/**
 * Crea un elemento DOM con attributi e figli, impostando SEMPRE il testo via
 * textContent (mai innerHTML) per l'escape anti-XSS.
 * @param {string} tag
 * @param {object} [attrs] attributi/proprietà da assegnare
 * @param {Array<Node|string>} [figli]
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, figli = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset" && typeof v === "object") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k in node) {
      try {
        node[k] = v;
      } catch {
        node.setAttribute(k, v);
      }
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const f of [].concat(figli)) {
    if (f == null) continue;
    node.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
  }
  return node;
}

/**
 * Formatta la descrizione di un lotto per la lista di selezione, usando solo
 * testo (nessun HTML). "senza lotto" per lotto nullo/vuoto.
 * @param {{lotto: string|null, giacenza: number, data_scadenza_effettiva: string|null}} l
 * @returns {string}
 */
function descriviLotto(l) {
  const nomeLotto =
    l.lotto === null || l.lotto === undefined || l.lotto === ""
      ? "senza lotto"
      : l.lotto;
  const scad = l.data_scadenza_effettiva
    ? `scad. ${l.data_scadenza_effettiva}`
    : "senza scadenza";
  return `${nomeLotto} — ${scad} — giacenza ${l.giacenza}`;
}

/**
 * Monta la schermata di scarico CU nel contenitore indicato.
 *
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {() => void} funzione di unmount (ferma lo scanner e svuota il DOM)
 */
export function mount(container) {
  if (!container || typeof container.appendChild !== "function") {
    throw new Error("Contenitore non valido per la schermata di scarico CU.");
  }

  // Stato locale della schermata.
  const stato = {
    prodotti: [], // anagrafica attiva (per lookup codice)
    associazioni: [], // anagrafica associazioni (per dettaglio)
    prodottoSelezionato: null, // { id, nome, codice, ... }
    lotti: [], // lotti disponibili del prodotto (giacenza > 0)
    lottoSelezionato: null, // oggetto lotto scelto
    scannerOn: false,
  };

  // ---- Costruzione del DOM -------------------------------------------------

  const titolo = el("h2", { text: "Scarico dal Centro Unitario" });

  // Riga di stato/messaggi (aria-live per screen reader).
  const messaggio = el("p", {
    class: "scaricoCu-messaggio",
    role: "status",
    "aria-live": "polite",
  });

  function mostraMessaggio(testo, tipo = "info") {
    messaggio.textContent = testo || "";
    messaggio.dataset.tipo = tipo;
  }

  // --- Sezione 1: selezione prodotto ---
  const inputCodice = el("input", {
    type: "text",
    id: "scaricoCu-codice",
    name: "codice",
    autocomplete: "off",
    placeholder: "Codice prodotto",
  });
  const labelCodice = el("label", { htmlFor: "scaricoCu-codice", text: "Codice prodotto" });

  const btnCerca = el("button", { type: "button", text: "Cerca" });
  const btnScanner = el("button", {
    type: "button",
    text: "📷",
    title: "Avvia scansione",
    "aria-label": "Avvia la scansione del codice con la fotocamera",
  });

  const scannerBox = el("div", {
    id: ID_SCANNER,
    class: "scaricoCu-scanner",
    hidden: true,
  });

  const nomeProdotto = el("p", { class: "scaricoCu-prodotto", "aria-live": "polite" });

  const sezioneProdotto = el("fieldset", {}, [
    el("legend", { text: "1. Prodotto" }),
    labelCodice,
    inputCodice,
    btnCerca,
    btnScanner,
    scannerBox,
    nomeProdotto,
  ]);

  // --- Sezione 2: selezione lotto ---
  const selLotto = el("select", {
    id: "scaricoCu-lotto",
    name: "lotto",
    disabled: true,
  });
  const labelLotto = el("label", { htmlFor: "scaricoCu-lotto", text: "Lotto / scadenza" });
  const infoLotto = el("p", { class: "scaricoCu-info-lotto", "aria-live": "polite" });

  const sezioneLotto = el("fieldset", {}, [
    el("legend", { text: "2. Lotto e scadenza" }),
    labelLotto,
    selLotto,
    infoLotto,
  ]);

  // --- Sezione 3: quantità ---
  const inputQta = el("input", {
    type: "number",
    id: "scaricoCu-qta",
    name: "quantita",
    min: "1",
    step: "1",
    inputmode: "numeric",
    disabled: true,
  });
  const labelQta = el("label", {
    htmlFor: "scaricoCu-qta",
    text: "Quantità (unità base)",
  });

  const sezioneQta = el("fieldset", {}, [
    el("legend", { text: "3. Quantità" }),
    labelQta,
    inputQta,
  ]);

  // --- Sezione 4: destinazione (radio) + dettaglio condizionato ---
  function radioDest(valore, etichetta) {
    const input = el("input", {
      type: "radio",
      name: "scaricoCu-destinazione",
      id: `scaricoCu-dest-${valore}`,
      value: valore,
    });
    const label = el("label", {
      htmlFor: `scaricoCu-dest-${valore}`,
      text: etichetta,
    });
    return { input, wrapper: el("div", { class: "scaricoCu-radio" }, [input, label]) };
  }

  const destArmadio = radioDest("armadio_ripristino", "Armadio di ripristino");
  const destAssociazione = radioDest("associazione", "Associazione");
  const destAltro = radioDest("altro", "Altro");

  // Dettaglio associazione (select obbligatoria).
  const selAssociazione = el("select", {
    id: "scaricoCu-associazione",
    name: "associazione",
  });
  const labelAssociazione = el("label", {
    htmlFor: "scaricoCu-associazione",
    text: "Associazione di destinazione",
  });
  const dettaglioAssociazione = el(
    "div",
    { class: "scaricoCu-dettaglio", hidden: true },
    [labelAssociazione, selAssociazione],
  );

  // Dettaglio altro (testo libero facoltativo, max 500).
  const inputAltro = el("input", {
    type: "text",
    id: "scaricoCu-altro",
    name: "altro",
    maxLength: "500",
    placeholder: "Dettaglio (facoltativo)",
  });
  const labelAltro = el("label", {
    htmlFor: "scaricoCu-altro",
    text: "Dettaglio destinazione (facoltativo)",
  });
  const dettaglioAltro = el(
    "div",
    { class: "scaricoCu-dettaglio", hidden: true },
    [labelAltro, inputAltro],
  );

  const sezioneDest = el("fieldset", {}, [
    el("legend", { text: "4. Destinazione" }),
    destArmadio.wrapper,
    destAssociazione.wrapper,
    destAltro.wrapper,
    dettaglioAssociazione,
    dettaglioAltro,
  ]);

  // --- Submit ---
  const btnInvia = el("button", {
    type: "submit",
    text: "Registra scarico",
    disabled: true,
  });

  const form = el("form", { class: "scaricoCu-form", novalidate: true }, [
    sezioneProdotto,
    sezioneLotto,
    sezioneQta,
    sezioneDest,
    btnInvia,
  ]);

  const radice = el("section", { class: "scaricoCu" }, [titolo, messaggio, form]);
  container.appendChild(radice);

  // ---- Logica di abilitazione / reset -------------------------------------

  /** Ricalcola lo stato "abilitato" del bottone di invio. */
  function aggiornaInvio() {
    const haProdotto = !!stato.prodottoSelezionato;
    const haLotto = !!stato.lottoSelezionato;
    const dest = destinazioneSelezionata();
    btnInvia.disabled = !(haProdotto && haLotto && !!dest);
  }

  /** @returns {string|null} valore della destinazione radio selezionata. */
  function destinazioneSelezionata() {
    if (destArmadio.input.checked) return "armadio_ripristino";
    if (destAssociazione.input.checked) return "associazione";
    if (destAltro.input.checked) return "altro";
    return null;
  }

  /** Reset della selezione lotto/quantità (dopo cambio prodotto o invio). */
  function resetLottiEQuantita() {
    stato.lotti = [];
    stato.lottoSelezionato = null;
    selLotto.innerHTML = "";
    selLotto.disabled = true;
    inputQta.value = "";
    inputQta.disabled = true;
    inputQta.removeAttribute("max");
    infoLotto.textContent = "";
    aggiornaInvio();
  }

  /** Popola la select dei lotti disponibili (solo giacenza > 0). */
  function popolaLotti(lotti) {
    stato.lotti = Array.isArray(lotti) ? lotti : [];
    selLotto.innerHTML = "";
    if (stato.lotti.length === 0) {
      selLotto.disabled = true;
      return;
    }
    // Opzione placeholder iniziale.
    selLotto.appendChild(
      el("option", { value: "", text: "— seleziona lotto —", disabled: true, selected: true }),
    );
    stato.lotti.forEach((l, idx) => {
      // value = indice nello stato (il lotto può essere null): evitiamo di
      // usare il contenuto DB come value semantico.
      selLotto.appendChild(el("option", { value: String(idx), text: descriviLotto(l) }));
    });
    selLotto.disabled = false;
  }

  // ---- Caricamento dati anagrafici ----------------------------------------

  async function caricaAnagrafiche() {
    mostraMessaggio("Caricamento anagrafiche…");
    const [resProd, resAss] = await Promise.all([
      listaProdotti({ attiviSolo: true }),
      listaAssociazioni(),
    ]);
    if (!resProd.ok) {
      mostraMessaggio(resProd.error || "Impossibile caricare i prodotti.", "errore");
    } else {
      stato.prodotti = resProd.data || [];
    }
    if (!resAss.ok) {
      mostraMessaggio(resAss.error || "Impossibile caricare le associazioni.", "errore");
    } else {
      stato.associazioni = resAss.data || [];
      // Popola la select associazioni: placeholder + voci da anagrafica.
      selAssociazione.innerHTML = "";
      selAssociazione.appendChild(
        el("option", { value: "", text: "— seleziona associazione —" }),
      );
      stato.associazioni.forEach((a) => {
        // textContent per il nome (anti-XSS); value = id.
        selAssociazione.appendChild(el("option", { value: a.id, text: a.nome }));
      });
    }
    if (resProd.ok && resAss.ok) mostraMessaggio("");
  }

  // ---- Selezione prodotto -------------------------------------------------

  async function selezionaProdotto(codice) {
    const esito = lookupPerCodice(stato.prodotti, codice);
    if (!esito.trovato) {
      stato.prodottoSelezionato = null;
      nomeProdotto.textContent = "";
      resetLottiEQuantita();
      mostraMessaggio("Codice non riconosciuto.", "errore");
      return;
    }
    stato.prodottoSelezionato = esito.prodotto;
    // Nome prodotto via textContent (anti-XSS).
    nomeProdotto.textContent = `Prodotto: ${esito.prodotto.nome} (${esito.prodotto.codice})`;
    mostraMessaggio("");
    await caricaLotti(esito.prodotto.id);
  }

  async function caricaLotti(prodottoId) {
    resetLottiEQuantita();
    mostraMessaggio("Caricamento lotti disponibili…");
    const res = await lottiDisponibili(prodottoId);
    if (!res.ok) {
      mostraMessaggio(res.error || "Impossibile caricare i lotti.", "errore");
      return;
    }
    const lotti = res.data || [];
    if (lotti.length === 0) {
      // R8.9: nessun lotto/giacenza disponibile.
      mostraMessaggio(
        "Nessun lotto con giacenza disponibile per questo prodotto.",
        "errore",
      );
      return;
    }
    popolaLotti(lotti);
    mostraMessaggio("");
  }

  // ---- Gestione eventi UI -------------------------------------------------

  function onCerca() {
    const codice = inputCodice.value;
    selezionaProdotto(codice);
  }

  inputCodice.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onCerca();
    }
  });
  btnCerca.addEventListener("click", onCerca);

  // Scanner live: avvio/stop con lo stesso bottone.
  async function toggleScanner() {
    if (stato.scannerOn || scansioneAttiva()) {
      await fermaScannerSicuro();
      return;
    }
    scannerBox.hidden = false;
    btnScanner.textContent = "⏹";
    btnScanner.setAttribute("aria-label", "Ferma la scansione");
    btnScanner.title = "Ferma scansione";
    try {
      await avviaScansione(ID_SCANNER, {
        onRisultato: (testo) => {
          // Lettura valida: impostiamo il codice e tentiamo la selezione.
          inputCodice.value = testo;
          fermaScannerSicuro();
          selezionaProdotto(testo);
        },
      });
      stato.scannerOn = true;
    } catch (e) {
      stato.scannerOn = false;
      scannerBox.hidden = true;
      btnScanner.textContent = "📷";
      btnScanner.setAttribute("aria-label", "Avvia la scansione del codice con la fotocamera");
      btnScanner.title = "Avvia scansione";
      const msg =
        e instanceof ScannerError
          ? e.message
          : "Scanner non disponibile. Inserisci il codice manualmente.";
      mostraMessaggio(msg, "errore");
    }
  }

  async function fermaScannerSicuro() {
    try {
      await fermaScansione();
    } catch {
      /* no-op */
    }
    stato.scannerOn = false;
    scannerBox.hidden = true;
    btnScanner.textContent = "📷";
    btnScanner.setAttribute("aria-label", "Avvia la scansione del codice con la fotocamera");
    btnScanner.title = "Avvia scansione";
  }

  btnScanner.addEventListener("click", () => {
    toggleScanner();
  });

  // Selezione lotto.
  selLotto.addEventListener("change", () => {
    const idx = Number(selLotto.value);
    if (!Number.isInteger(idx) || idx < 0 || idx >= stato.lotti.length) {
      stato.lottoSelezionato = null;
      inputQta.disabled = true;
      infoLotto.textContent = "";
      aggiornaInvio();
      return;
    }
    const lotto = stato.lotti[idx];
    stato.lottoSelezionato = lotto;
    inputQta.disabled = false;
    inputQta.max = String(lotto.giacenza);
    infoLotto.textContent = `Giacenza residua del lotto: ${lotto.giacenza}`;
    aggiornaInvio();
  });

  // Destinazione: mostra/nasconde il dettaglio coerente.
  function onCambioDestinazione() {
    const dest = destinazioneSelezionata();
    dettaglioAssociazione.hidden = dest !== "associazione";
    dettaglioAltro.hidden = dest !== "altro";
    aggiornaInvio();
  }
  [destArmadio.input, destAssociazione.input, destAltro.input].forEach((r) =>
    r.addEventListener("change", onCambioDestinazione),
  );

  // ---- Invio --------------------------------------------------------------

  async function onSubmit(ev) {
    ev.preventDefault();
    mostraMessaggio("");

    if (!stato.prodottoSelezionato) {
      mostraMessaggio("Seleziona prima un prodotto.", "errore");
      return;
    }
    if (!stato.lottoSelezionato) {
      mostraMessaggio("Seleziona un lotto.", "errore");
      return;
    }

    const quantita = Number(inputQta.value);
    const vQta = validaQuantita(Number.isInteger(quantita) ? quantita : inputQta.value);
    if (!vQta.ok) {
      mostraMessaggio(vQta.errors[0], "errore");
      return;
    }
    // Guardia client sulla giacenza del lotto (la difesa reale è il DB).
    if (quantita > stato.lottoSelezionato.giacenza) {
      mostraMessaggio(
        `La quantità supera la giacenza residua del lotto (${stato.lottoSelezionato.giacenza}).`,
        "errore",
      );
      return;
    }

    const destinazione = destinazioneSelezionata();
    const associazioneId =
      destinazione === "associazione" ? selAssociazione.value || "" : undefined;
    const testoAltro = destinazione === "altro" ? inputAltro.value : undefined;

    const vDest = validaDestinazione(destinazione, { associazioneId, testoAltro });
    if (!vDest.ok) {
      mostraMessaggio(vDest.errors[0], "errore");
      return;
    }

    btnInvia.disabled = true;
    mostraMessaggio("Registrazione scarico in corso…");

    const res = await scaricoCu({
      prodottoId: stato.prodottoSelezionato.id,
      quantitaBase: quantita,
      lotto: stato.lottoSelezionato.lotto,
      destinazione,
      associazioneId,
      testoAltro,
    });

    if (!res.ok) {
      // Mostra l'errore mappato in italiano (es. giacenza insufficiente).
      mostraMessaggio(res.error || "Impossibile registrare lo scarico.", "errore");
      aggiornaInvio();
      return;
    }

    // Successo: feedback atomico. Per armadio_ripristino segnaliamo anche il
    // carico automatico negli armadi (R8.5).
    const nota =
      destinazione === "armadio_ripristino"
        ? " Il materiale è stato caricato anche nell'armadio di ripristino."
        : "";
    mostraMessaggio(`Scarico registrato.${nota}`, "successo");

    // Ricarica i lotti del prodotto (la giacenza è cambiata) e azzera il form
    // mantenendo il prodotto selezionato.
    inputQta.value = "";
    await caricaLotti(stato.prodottoSelezionato.id);
  }

  form.addEventListener("submit", onSubmit);

  // Avvio: carica le anagrafiche.
  caricaAnagrafiche();

  // ---- Unmount ------------------------------------------------------------
  return function unmount() {
    // Ferma lo scanner se attivo (R15: stop scanner all'unmount).
    fermaScannerSicuro();
    form.removeEventListener("submit", onSubmit);
    if (radice.parentNode) radice.parentNode.removeChild(radice);
  };
}

export default { mount };
