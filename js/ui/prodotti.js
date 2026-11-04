// js/ui/prodotti.js
//
// Schermata "Gestione prodotti" (R1) per Admin/Power-user.
//
// Responsabilità:
//   - elencare tutti i prodotti (attivi e disattivati), ordinati per nome, con
//     un badge per i prodotti non attivi (R1.3, R1.5);
//   - offrire un form completo di anagrafica con TUTTI i campi del modello:
//     nome, codice, pezzi_per_confezione,
//     giacenza_minima_cu, giacenza_minima_armadi, intervallo_allerta_scadenza,
//     flag senza_scadenza, flag attivo, posizioni (cu_scaffale, cu_piano,
//     armadio, armadio_scaffale) e punto_di_prelievo_id (select FK) (R1.1–R1.14);
//   - creare e modificare prodotti (R1.1, R1.4);
//   - attivare/disattivare un prodotto per riga (soft, R1.5);
//   - validare lato client PRIMA dell'invio con messaggi inline in italiano
//     (R1.2, R1.7, R1.8, R1.9) e mostrare gli errori restituiti dall'API/DB
//     (R1.6, R1.11).
//
// Sicurezza/UX (steering):
//   - Tutti i valori provenienti dal DB sono inseriti via textContent / helper
//     `el` (mai innerHTML con dati grezzi): difesa anti-XSS (R15.6/convenzioni).
//   - Le checkbox restano native (nessun appearance:none applicato qui; il CSS
//     globale esclude già checkbox/radio dal reset).
//   - Controlli a sola icona con aria-label.
//
// La difesa reale resta lato DB (CHECK/FK/RLS/trigger): questo modulo è il
// mirror client per un feedback immediato.

import { el, svuota } from "./_dom.js";
import {
  listaProdotti,
  creaProdotto,
  aggiornaProdotto,
  impostaAttivo,
} from "../api/prodotti.js";
import { listaPuntiDiPrelievo } from "../api/puntiPrelievo.js";
import {
  avviaScansione,
  fermaScansione,
  scansioneAttiva,
  ScannerError,
} from "../scanner.js";
import { iconaBarcode, impostaIconaBottone } from "./_icone.js";
import {
  validaNome,
  validaCodice,
  validaPezziPerConfezione,
  validaSogliaNonNegativa,
  validaIntervallo,
} from "../domain/validation.js";

// Definizione dichiarativa dei campi numerici interi del form, con il relativo
// validatore di dominio e l'etichetta usata nei messaggi.
const CAMPI_INTERI = [
  {
    nome: "pezzi_per_confezione",
    etichetta: "Pezzi per confezione",
    valida: (v) => validaPezziPerConfezione(v),
    min: 1,
  },
  {
    nome: "giacenza_minima_cu",
    etichetta: "Giacenza minima CU",
    valida: (v) => validaSogliaNonNegativa(v, "La giacenza minima CU"),
    min: 0,
  },
  {
    nome: "giacenza_minima_armadi",
    etichetta: "Giacenza minima armadi",
    valida: (v) => validaSogliaNonNegativa(v, "La giacenza minima armadi"),
    min: 0,
  },
  {
    nome: "intervallo_allerta_scadenza",
    etichetta: "Intervallo allerta scadenza (giorni)",
    valida: (v) => validaIntervallo(v),
    min: 0,
  },
];

const CAMPI_POSIZIONE = [
  { nome: "cu_scaffale", etichetta: "Scaffale CU" },
  { nome: "cu_piano", etichetta: "Piano CU" },
  { nome: "armadio", etichetta: "Armadio ripristino" },
  { nome: "armadio_scaffale", etichetta: "Scaffale ripristino" },
];

/**
 * Converte una stringa in intero oppure restituisce NaN se non convertibile.
 * @param {string} v
 * @returns {number}
 */
function aIntero(v) {
  if (typeof v !== "string" || v.trim() === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Monta la schermata di gestione prodotti nel container fornito.
 *
 * @param {HTMLElement} container nodo in cui montare la UI
 * @returns {{ destroy: () => void }} handle con metodo di cleanup
 */
export function mount(container) {
  if (!container) throw new Error("mount: container mancante");
  svuota(container);

  // Stato locale della schermata.
  const stato = {
    prodotti: [],
    puntiPrelievo: [],
    inModifica: null, // id del prodotto in modifica, null = creazione
    scannerOn: false, // scansione barcode del codice attiva
  };

  // Id del contenitore DOM usato dallo scanner live per il campo codice.
  const ID_SCANNER_CODICE = "prodotti-scanner-codice";

  const radice = el("section", { class: "prodotti", attrs: { "aria-label": "Gestione prodotti" } });

  const titolo = el("h2", { text: "Gestione prodotti" });

  // Banner messaggi (esito/errore) a livello di schermata.
  const banner = el("div", {
    attrs: { role: "status", "aria-live": "polite" },
    class: "prodotti-banner",
  });
  banner.hidden = true;

  const contenitoreForm = el("div", { class: "prodotti-form-wrap" });
  const contenitoreLista = el("div", { class: "prodotti-lista-wrap" });

  radice.append(titolo, banner, contenitoreForm, contenitoreLista);
  container.appendChild(radice);

  /**
   * Mostra un messaggio nel banner di schermata.
   * @param {string} testo
   * @param {"ok"|"errore"} tipo
   */
  function mostraBanner(testo, tipo) {
    svuota(banner);
    banner.hidden = false;
    banner.dataset.tipo = tipo;
    banner.appendChild(el("p", { text: testo }));
  }

  function nascondiBanner() {
    banner.hidden = true;
    svuota(banner);
  }

  // ---- FORM -------------------------------------------------------------

  // Riferimenti ai controlli del form e ai nodi di errore inline.
  const controlli = {};
  const erroriInline = {};

  /**
   * Crea un gruppo "etichetta + controllo + messaggio di errore inline".
   * @param {string} id id del controllo (usato per label/for e aria-describedby)
   * @param {string} etichetta testo della label
   * @param {HTMLElement} controllo input/select da inserire
   * @returns {HTMLElement} il gruppo .campo
   */
  function gruppoCampo(id, etichetta, controllo) {
    const errId = `${id}-errore`;
    const label = el("label", { text: etichetta, attrs: { for: id } });
    const err = el("p", {
      class: "campo-errore",
      attrs: { id: errId, role: "alert" },
    });
    err.hidden = true;
    controllo.setAttribute("id", id);
    controllo.setAttribute("aria-describedby", errId);
    erroriInline[id] = err;
    return el("div", { class: "campo", children: [label, controllo, err] });
  }

  function inputTesto(nome, attrs = {}) {
    const c = el("input", { attrs: { type: "text", name: nome, ...attrs } });
    controlli[nome] = c;
    return c;
  }

  function inputNumero(nome, min) {
    const c = el("input", {
      attrs: { type: "number", name: nome, step: "1", min: String(min) },
    });
    controlli[nome] = c;
    return c;
  }

  function inputCheckbox(nome) {
    const c = el("input", { attrs: { type: "checkbox", name: nome } });
    controlli[nome] = c;
    return c;
  }

  // Select del punto di prelievo (FK opzionale, R1.11).
  const selectPunto = el("select", { attrs: { name: "punto_di_prelievo_id" } });
  controlli.punto_di_prelievo_id = selectPunto;

  function popolaSelectPunti() {
    svuota(selectPunto);
    selectPunto.appendChild(
      el("option", { text: "— nessuno —", attrs: { value: "" } }),
    );
    for (const p of stato.puntiPrelievo) {
      selectPunto.appendChild(
        el("option", { text: p.nome, attrs: { value: p.id } }),
      );
    }
  }

  // Costruzione statica del form.
  const form = el("form", { attrs: { novalidate: "novalidate" }, class: "prodotti-form" });

  const legenda = el("legend", { text: "Nuovo prodotto" });

  // Campo codice con opzione di scansione barcode live dalla fotocamera.
  // L'input resta modificabile a mano (fallback); il bottone con icona barcode avvia/ferma lo
  // scanner, che a lettura valida riempie il campo e si spegne.
  const inputCodice = inputTesto("codice", { maxlength: "50", required: "required" });
  const btnScannerCodice = el("button", {
    class: "btn-scanner btn-icona",
    attrs: {
      type: "button",
      "aria-label": "Scansiona il codice con la fotocamera",
      title: "Scansiona codice",
    },
  });
  btnScannerCodice.appendChild(iconaBarcode());
  const scannerBoxCodice = el("div", {
    class: "prodotti-scanner",
    attrs: { id: ID_SCANNER_CODICE },
  });
  scannerBoxCodice.hidden = true;

  // Gruppo codice: etichetta + (input affiancato al bottone scanner) + box
  // stream + messaggio d'errore inline. Riusa lo stile .campo e .azioni.
  const errCodiceId = "p-codice-errore";
  inputCodice.setAttribute("id", "p-codice");
  inputCodice.setAttribute("aria-describedby", errCodiceId);
  const errCodice = el("p", {
    class: "campo-errore",
    attrs: { id: errCodiceId, role: "alert" },
  });
  errCodice.hidden = true;
  erroriInline["p-codice"] = errCodice;
  const gruppoCodice = el("div", {
    class: "campo",
    children: [
      el("label", { text: "Codice *", attrs: { for: "p-codice" } }),
      el("div", { class: "azioni-codice", children: [inputCodice, btnScannerCodice] }),
      scannerBoxCodice,
      errCodice,
    ],
  });

  const campiBase = el("div", {
    class: "prodotti-campi",
    children: [
      gruppoCampo("p-nome", "Nome *", inputTesto("nome", { maxlength: "200", required: "required" })),
      gruppoCodice,
    ],
  });

  const campiNum = el("div", { class: "prodotti-campi" });
  for (const def of CAMPI_INTERI) {
    campiNum.appendChild(
      gruppoCampo(`p-${def.nome}`, `${def.etichetta} *`, inputNumero(def.nome, def.min)),
    );
  }

  // Flag senza_scadenza e attivo (checkbox native).
  const gruppoSenzaScad = el("div", {
    class: "campo campo-flag",
    children: [
      inputCheckbox("senza_scadenza"),
      el("label", { text: "Prodotto senza scadenza (solo data di produzione)", attrs: { for: "p-senza_scadenza" } }),
    ],
  });
  controlli.senza_scadenza.setAttribute("id", "p-senza_scadenza");

  const gruppoAttivo = el("div", {
    class: "campo campo-flag",
    children: [
      inputCheckbox("attivo"),
      el("label", { text: "Prodotto attivo", attrs: { for: "p-attivo" } }),
    ],
  });
  controlli.attivo.setAttribute("id", "p-attivo");
  controlli.attivo.checked = true; // default in creazione (R1 default attivo)

  // Posizioni (opzionali).
  const campiPos = el("div", { class: "prodotti-campi" });
  for (const def of CAMPI_POSIZIONE) {
    campiPos.appendChild(
      gruppoCampo(`p-${def.nome}`, def.etichetta, inputTesto(def.nome)),
    );
  }

  const gruppoPunto = gruppoCampo("p-punto_di_prelievo_id", "Punto di prelievo", selectPunto);

  const btnInvia = el("button", { attrs: { type: "submit" }, text: "Crea prodotto" });
  const btnAnnulla = el("button", {
    attrs: { type: "button" },
    class: "secondario",
    text: "Annulla modifica",
  });
  btnAnnulla.hidden = true;
  btnAnnulla.addEventListener("click", () => resetForm());

  const azioni = el("div", { class: "prodotti-azioni", children: [btnInvia, btnAnnulla] });

  const fieldset = el("fieldset", {
    children: [
      legenda,
      campiBase,
      campiNum,
      gruppoSenzaScad,
      gruppoAttivo,
      campiPos,
      gruppoPunto,
      azioni,
    ],
  });
  form.appendChild(fieldset);
  form.addEventListener("submit", onSubmit);
  contenitoreForm.appendChild(form);

  // ---- Scanner barcode del campo codice ---------------------------------

  /** Ferma lo scanner (se attivo) e ripristina il bottone/box. Best-effort. */
  async function fermaScannerCodice() {
    try {
      await fermaScansione();
    } catch {
      /* no-op: lo stop è best-effort */
    }
    stato.scannerOn = false;
    scannerBoxCodice.hidden = true;
    impostaIconaBottone(btnScannerCodice, "barcode");
    btnScannerCodice.setAttribute("aria-label", "Scansiona il codice con la fotocamera");
    btnScannerCodice.title = "Scansiona codice";
  }

  /** Avvia/ferma la scansione live del codice con lo stesso bottone. */
  async function toggleScannerCodice() {
    if (stato.scannerOn || scansioneAttiva()) {
      await fermaScannerCodice();
      return;
    }
    scannerBoxCodice.hidden = false;
    impostaIconaBottone(btnScannerCodice, "stop");
    btnScannerCodice.setAttribute("aria-label", "Ferma la scansione");
    btnScannerCodice.title = "Ferma scansione";
    try {
      await avviaScansione(ID_SCANNER_CODICE, {
        onRisultato: (testo) => {
          // Lettura valida: riempiamo il campo codice e spegniamo lo scanner.
          controlli.codice.value = testo;
          erroriInline["p-codice"].hidden = true;
          svuota(erroriInline["p-codice"]);
          controlli.codice.removeAttribute("aria-invalid");
          fermaScannerCodice();
        },
      });
      stato.scannerOn = true;
    } catch (err) {
      await fermaScannerCodice();
      const msg =
        err instanceof ScannerError
          ? err.message
          : "Scanner non disponibile. Inserisci il codice manualmente.";
      mostraBanner(msg, "errore");
    }
  }

  btnScannerCodice.addEventListener("click", () => {
    toggleScannerCodice();
  });

  /** Pulisce tutti gli errori inline. */
  function pulisciErroriInline() {
    for (const err of Object.values(erroriInline)) {
      err.hidden = true;
      svuota(err);
    }
  }

  /**
   * Mostra un errore inline sotto il controllo indicato.
   * @param {string} idControllo id (es. "p-nome")
   * @param {string} messaggio
   */
  function mostraErroreInline(idControllo, messaggio) {
    const err = erroriInline[idControllo];
    if (!err) return;
    err.hidden = false;
    svuota(err);
    err.appendChild(document.createTextNode(messaggio));
    const c = controlli[idControllo.replace(/^p-/, "")];
    if (c) c.setAttribute("aria-invalid", "true");
  }

  /** Legge i valori correnti dal form in un oggetto dati per l'API. */
  function leggiForm() {
    const v = (nome) => controlli[nome].value;
    return {
      nome: v("nome"),
      codice: v("codice"),
      pezzi_per_confezione: aIntero(v("pezzi_per_confezione")),
      giacenza_minima_cu: aIntero(v("giacenza_minima_cu")),
      giacenza_minima_armadi: aIntero(v("giacenza_minima_armadi")),
      intervallo_allerta_scadenza: aIntero(v("intervallo_allerta_scadenza")),
      senza_scadenza: controlli.senza_scadenza.checked,
      attivo: controlli.attivo.checked,
      punto_di_prelievo_id: v("punto_di_prelievo_id") || "",
      posizioni: {
        cu_scaffale: v("cu_scaffale"),
        cu_piano: v("cu_piano"),
        armadio: v("armadio"),
        armadio_scaffale: v("armadio_scaffale"),
      },
    };
  }

  /**
   * Validazione client con messaggi inline. Ritorna true se valido.
   * @param {object} dati
   * @returns {boolean}
   */
  function validaFormInline(dati) {
    pulisciErroriInline();
    for (const c of Object.values(controlli)) c.removeAttribute("aria-invalid");
    let valido = true;

    const applica = (idControllo, ris) => {
      if (ris && !ris.ok) {
        mostraErroreInline(idControllo, ris.errors[0]);
        valido = false;
      }
    };

    applica("p-nome", validaNome(dati.nome));
    applica("p-codice", validaCodice(dati.codice));

    for (const def of CAMPI_INTERI) {
      applica(`p-${def.nome}`, def.valida(dati[def.nome]));
    }

    return valido;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    nascondiBanner();
    const dati = leggiForm();
    if (!validaFormInline(dati)) {
      mostraBanner("Correggi i campi evidenziati prima di salvare.", "errore");
      return;
    }

    btnInvia.disabled = true;
    try {
      const risultato = stato.inModifica
        ? await aggiornaProdotto(stato.inModifica, dati)
        : await creaProdotto(dati);

      if (!risultato.ok) {
        // Errori API/DB (es. codice duplicato R1.6, punto di prelievo inesistente R1.11).
        mostraBanner(risultato.error || "Operazione non riuscita.", "errore");
        // Se l'errore riguarda il codice, evidenzialo inline.
        if ((risultato.error || "").toLowerCase().includes("codice")) {
          mostraErroreInline("p-codice", risultato.error);
        }
        return;
      }

      mostraBanner(
        stato.inModifica ? "Prodotto aggiornato." : "Prodotto creato.",
        "ok",
      );
      resetForm();
      await ricaricaLista();
    } finally {
      btnInvia.disabled = false;
    }
  }

  /** Riporta il form allo stato di creazione. */
  function resetForm() {
    stato.inModifica = null;
    form.reset();
    controlli.attivo.checked = true;
    controlli.senza_scadenza.checked = false;
    pulisciErroriInline();
    for (const c of Object.values(controlli)) c.removeAttribute("aria-invalid");
    legenda.textContent = "Nuovo prodotto";
    btnInvia.textContent = "Crea prodotto";
    btnAnnulla.hidden = true;
  }

  /**
   * Popola il form con i dati di un prodotto per la modifica.
   * @param {object} p prodotto (formato API, con `posizioni`)
   */
  function caricaInForm(p) {
    stato.inModifica = p.id;
    controlli.nome.value = p.nome ?? "";
    controlli.codice.value = p.codice ?? "";
    controlli.pezzi_per_confezione.value = p.pezzi_per_confezione ?? "";
    controlli.giacenza_minima_cu.value = p.giacenza_minima_cu ?? "";
    controlli.giacenza_minima_armadi.value = p.giacenza_minima_armadi ?? "";
    controlli.intervallo_allerta_scadenza.value = p.intervallo_allerta_scadenza ?? "";
    controlli.senza_scadenza.checked = Boolean(p.senza_scadenza);
    controlli.attivo.checked = Boolean(p.attivo);
    controlli.punto_di_prelievo_id.value = p.punto_di_prelievo_id ?? "";
    const pos = p.posizioni || {};
    controlli.cu_scaffale.value = pos.cu_scaffale ?? "";
    controlli.cu_piano.value = pos.cu_piano ?? "";
    controlli.armadio.value = pos.armadio ?? "";
    controlli.armadio_scaffale.value = pos.armadio_scaffale ?? "";

    pulisciErroriInline();
    legenda.textContent = "Modifica prodotto";
    btnInvia.textContent = "Salva modifiche";
    btnAnnulla.hidden = false;
    radice.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- LISTA ------------------------------------------------------------

  /** Mappa id punto di prelievo → nome, per la visualizzazione in lista. */
  function nomePunto(id) {
    if (!id) return null;
    const p = stato.puntiPrelievo.find((x) => x.id === id);
    return p ? p.nome : null;
  }

  /**
   * Costruisce la riga di lista per un prodotto (DOM sicuro via textContent).
   * @param {object} p prodotto
   * @returns {HTMLElement}
   */
  function rigaProdotto(p) {
    const intestazione = el("div", { class: "prodotto-intestazione" });
    intestazione.appendChild(el("span", { class: "prodotto-nome", text: p.nome }));
    intestazione.appendChild(el("span", { class: "prodotto-codice", text: `Cod. ${p.codice}` }));
    if (!p.attivo) {
      intestazione.appendChild(
        el("span", { class: "badge badge-inattivo", text: "Disattivato" }),
      );
    }

    const dettagli = el("dl", { class: "prodotto-dettagli" });
    const coppia = (etichetta, valore) => {
      dettagli.appendChild(el("dt", { text: etichetta }));
      dettagli.appendChild(el("dd", { text: valore }));
    };
    coppia("Pezzi per confezione", `${p.pezzi_per_confezione}`);
    coppia("Soglie (CU / armadi)", `${p.giacenza_minima_cu} / ${p.giacenza_minima_armadi}`);
    coppia("Allerta scadenza", `${p.intervallo_allerta_scadenza} giorni`);
    coppia("Scadenza", p.senza_scadenza ? "Senza scadenza" : "Con scadenza");
    const punto = nomePunto(p.punto_di_prelievo_id);
    if (punto) coppia("Punto di prelievo", punto);

    // Azioni riga.
    const btnModifica = el("button", {
      attrs: { type: "button", "aria-label": `Modifica ${p.nome}`, title: "Modifica" },
      class: "secondario",
      text: "Modifica",
      on: { click: () => caricaInForm(p) },
    });

    const btnToggle = el("button", {
      attrs: {
        type: "button",
        "aria-label": p.attivo ? `Disattiva ${p.nome}` : `Attiva ${p.nome}`,
        title: p.attivo ? "Disattiva" : "Attiva",
      },
      class: p.attivo ? "secondario" : "",
      text: p.attivo ? "Disattiva" : "Attiva",
      on: { click: () => onToggleAttivo(p) },
    });

    const azioniRiga = el("div", { class: "prodotto-azioni", children: [btnModifica, btnToggle] });

    return el("li", {
      class: p.attivo ? "prodotto" : "prodotto prodotto-inattivo",
      children: [intestazione, dettagli, azioniRiga],
    });
  }

  async function onToggleAttivo(p) {
    nascondiBanner();
    const risultato = await impostaAttivo(p.id, !p.attivo);
    if (!risultato.ok) {
      mostraBanner(risultato.error || "Impossibile aggiornare lo stato.", "errore");
      return;
    }
    mostraBanner(
      risultato.data.attivo ? "Prodotto attivato." : "Prodotto disattivato.",
      "ok",
    );
    await ricaricaLista();
  }

  /** Ridisegna la lista ordinata per nome (l'API già ordina). */
  function renderLista() {
    svuota(contenitoreLista);
    const h3 = el("h3", { text: `Prodotti (${stato.prodotti.length})` });
    contenitoreLista.appendChild(h3);

    if (stato.prodotti.length === 0) {
      contenitoreLista.appendChild(
        el("p", { class: "vuoto", text: "Nessun prodotto presente." }),
      );
      return;
    }
    const ul = el("ul", { class: "prodotti-lista" });
    for (const p of stato.prodotti) ul.appendChild(rigaProdotto(p));
    contenitoreLista.appendChild(ul);
  }

  async function ricaricaLista() {
    const risultato = await listaProdotti();
    if (!risultato.ok) {
      mostraBanner(risultato.error || "Impossibile caricare i prodotti.", "errore");
      stato.prodotti = [];
    } else {
      stato.prodotti = risultato.data;
    }
    renderLista();
  }

  async function caricaPuntiPrelievo() {
    const risultato = await listaPuntiDiPrelievo();
    stato.puntiPrelievo = risultato.ok ? risultato.data : [];
    popolaSelectPunti();
  }

  // ---- INIT -------------------------------------------------------------
  (async () => {
    await caricaPuntiPrelievo();
    await ricaricaLista();
  })();

  return {
    destroy() {
      // Ferma lo scanner se attivo (stop camera all'unmount).
      fermaScannerCodice();
      form.removeEventListener("submit", onSubmit);
      svuota(container);
    },
  };
}

export default { mount };
