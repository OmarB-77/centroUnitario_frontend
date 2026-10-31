// js/ui/checklists.js
//
// Schermata delle TRE CHECK-LIST operative (R11, R12, R13), per Admin/Power-user.
//
// Le tre liste sono organizzate in tab/sezioni:
//   (A) Carenza Centro Unitario (R11): prodotti attivi con giacenza CU sotto la
//       soglia minima CU. Ogni riga mostra giacenza, soglia e punto di prelievo,
//       con una checkbox "ordine effettuato" (R11.2) che persiste lo stato via
//       impostaOrdinato(). La spunta NON rimuove la riga: la rimozione è guidata
//       dalla giacenza (R11.3) — la riga sparisce al prossimo refresh quando il
//       prodotto esce dalla vista perché rifornito.
//   (B) Carenza Armadi di Ripristino (R12): prodotti attivi con giacenza armadi
//       sotto la soglia minima armadi. NESSUNA spunta (R12.3): la rimozione è
//       data-driven (R12.2), tipicamente per effetto del carico automatico.
//   (C) Prossima scadenza (R13): una riga per LOTTO (prodotto, lotto, scadenza
//       effettiva, giacenza del lotto), ordinata per scadenza crescente.
//       NESSUNA spunta (R13.3): rimozione data-driven quando il lotto si esaurisce.
//
// FONTE DATI
//   Le liste sono lette dalle viste derivate del DB tramite js/api/checklists.js
//   (listaCarenzaCu / listaCarenzaArmadi / listaScadenza). La "rimozione
//   automatica" è quindi intrinseca: ogni refresh ricalcola dalle viste, quindi
//   le righe non più in carenza / non più in scadenza semplicemente non
//   tornano. La spunta ordine è persistita con impostaOrdinato().
//
// SICUREZZA / ANTI-XSS
//   Tutti i valori provenienti dal DB (nome, codice, lotto, punto di prelievo,
//   data di scadenza) sono inseriti nel DOM via textContent attraverso l'helper
//   `el` di _dom.js (mai innerHTML con dati grezzi).
//
// CHECKBOX
//   La checkbox "ordine effettuato" è un input nativo: il reset CSS globale
//   esclude già checkbox/radio da appearance:none, quindi il rendering nativo è
//   preservato. Ha aria-label descrittiva per l'accessibilità.
//
// ACCESSIBILITÀ
//   Tab con aria-selected; sezioni con aria-label; conteggi annunciati; messaggi
//   di stato in aria-live; controlli a sola icona con aria-label (bottoneIcona).
//
// CICLO DI VITA
//   mount(container) monta la UI, avvia il primo caricamento e restituisce un
//   handle { destroy } per il cleanup del contenitore.

import { el, svuota, bottoneIcona, areaMessaggi, mostraMessaggio } from "./_dom.js";
import {
  listaCarenzaCu,
  listaCarenzaArmadi,
  listaScadenza,
  impostaOrdinato,
} from "../api/checklists.js";

// Definizione dichiarativa delle tre schede.
const SCHEDE = [
  { id: "carenza-cu", etichetta: "Carenza CU" },
  { id: "carenza-armadi", etichetta: "Carenza armadi" },
  { id: "scadenza", etichetta: "Prossima scadenza" },
];

/**
 * Etichetta leggibile per un lotto (gestisce lotto nullo/vuoto).
 * @param {string|null|undefined} lotto
 * @returns {string}
 */
function etichettaLotto(lotto) {
  return lotto === null || lotto === undefined || lotto === "" ? "senza lotto" : lotto;
}

/**
 * Monta la schermata delle check-list nel contenitore indicato.
 *
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {{ destroy: () => void }} handle con metodo di cleanup
 */
export function mount(container) {
  if (!container || typeof container.appendChild !== "function") {
    throw new Error("mount: contenitore non valido per le check-list.");
  }
  svuota(container);

  // Stato locale della schermata.
  const stato = {
    schedaAttiva: SCHEDE[0].id,
    caricamento: false,
    carenzaCu: [],
    carenzaArmadi: [],
    scadenza: [],
  };

  // ---- Struttura statica ---------------------------------------------------

  const radice = el("section", {
    class: "checklists",
    attrs: { "aria-label": "Check-list operative" },
  });

  const titolo = el("h2", { text: "Check-list" });

  // Barra superiore: refresh + area messaggi.
  const area = areaMessaggi();
  const btnRefresh = bottoneIcona({
    etichetta: "Aggiorna le check-list",
    icona: "🔄",
    className: "checklists-refresh",
    onClick: () => ricaricaTutto(),
  });
  const barra = el("div", { class: "checklists-barra", children: [btnRefresh, area] });

  // Tablist.
  const tablist = el("div", {
    class: "checklists-tablist",
    attrs: { role: "tablist", "aria-label": "Tipo di check-list" },
  });
  const tabs = new Map(); // id scheda -> bottone tab
  for (const scheda of SCHEDE) {
    const tab = el("button", {
      type: "button",
      class: "checklists-tab",
      text: scheda.etichetta,
      attrs: {
        role: "tab",
        id: `tab-${scheda.id}`,
        "aria-controls": `pannello-${scheda.id}`,
        "aria-selected": scheda.id === stato.schedaAttiva ? "true" : "false",
      },
      on: { click: () => selezionaScheda(scheda.id) },
    });
    tabs.set(scheda.id, tab);
    tablist.appendChild(tab);
  }

  // Pannelli (uno per scheda); il contenuto viene (ri)disegnato on demand.
  const pannelli = new Map(); // id scheda -> contenitore pannello
  const contenitorePannelli = el("div", { class: "checklists-pannelli" });
  for (const scheda of SCHEDE) {
    const pannello = el("div", {
      class: "checklists-pannello",
      attrs: {
        role: "tabpanel",
        id: `pannello-${scheda.id}`,
        "aria-labelledby": `tab-${scheda.id}`,
      },
    });
    pannello.hidden = scheda.id !== stato.schedaAttiva;
    pannelli.set(scheda.id, pannello);
    contenitorePannelli.appendChild(pannello);
  }

  radice.append(titolo, barra, tablist, contenitorePannelli);
  container.appendChild(radice);

  // ---- Selezione scheda ----------------------------------------------------

  /**
   * Attiva una scheda aggiornando tab e pannelli (aria-selected/hidden).
   * @param {string} idScheda
   */
  function selezionaScheda(idScheda) {
    if (!pannelli.has(idScheda)) return;
    stato.schedaAttiva = idScheda;
    for (const scheda of SCHEDE) {
      const attiva = scheda.id === idScheda;
      tabs.get(scheda.id).setAttribute("aria-selected", attiva ? "true" : "false");
      pannelli.get(scheda.id).hidden = !attiva;
    }
  }

  // ---- Rendering dei pannelli ---------------------------------------------

  /**
   * Intestazione di pannello con conteggio e (eventuale) stato vuoto.
   * @param {HTMLElement} pannello
   * @param {string} titoloTesto
   * @param {number} conteggio
   * @returns {HTMLUListElement|null} la lista da popolare, o null se vuota
   */
  function preparaPannello(pannello, titoloTesto, conteggio) {
    svuota(pannello);
    pannello.appendChild(
      el("h3", {
        class: "checklists-titolo-sezione",
        text: `${titoloTesto} (${conteggio})`,
      }),
    );
    if (conteggio === 0) {
      pannello.appendChild(
        el("p", { class: "checklists-vuoto", text: "Nessun elemento in lista." }),
      );
      return null;
    }
    const ul = el("ul", { class: "checklists-lista" });
    pannello.appendChild(ul);
    return ul;
  }

  /** (A) Carenza CU — con checkbox "ordine effettuato" (R11.2). */
  function renderCarenzaCu() {
    const pannello = pannelli.get("carenza-cu");
    const righe = stato.carenzaCu;
    const ul = preparaPannello(pannello, "Carenza Centro Unitario", righe.length);
    if (!ul) return;

    for (const r of righe) {
      const intestazione = el("div", { class: "checklists-riga-intestazione" });
      intestazione.appendChild(el("span", { class: "checklists-nome", text: r.nome }));
      intestazione.appendChild(
        el("span", { class: "checklists-codice", text: `Cod. ${r.codice}` }),
      );

      const dettagli = el("dl", { class: "checklists-dettagli" });
      const coppia = (etichetta, valore) => {
        dettagli.appendChild(el("dt", { text: etichetta }));
        dettagli.appendChild(el("dd", { text: valore }));
      };
      coppia("Giacenza CU", String(r.giacenza));
      coppia("Soglia minima CU", String(r.giacenza_minima_cu));
      coppia(
        "Punto di prelievo",
        r.punto_di_prelievo_nome || "— non assegnato —",
      );

      // Checkbox "ordine effettuato" (nativa). Riflette lo stato persistito.
      const idCheck = `ordine-${r.prodotto_id}`;
      const check = el("input", {
        attrs: {
          type: "checkbox",
          id: idCheck,
          "aria-label": `Segna come ordinato: ${r.nome}`,
        },
      });
      check.checked = Boolean(r.ordinato);
      check.addEventListener("change", () => onToggleOrdine(r, check));
      const labelCheck = el("label", {
        class: "checklists-ordine",
        attrs: { for: idCheck },
        children: [check, document.createTextNode(" Ordine effettuato")],
      });

      const li = el("li", {
        class: "checklists-item checklists-item--cu",
        children: [intestazione, dettagli, labelCheck],
      });
      ul.appendChild(li);
    }
  }

  /** (B) Carenza armadi — nessuna spunta (R12.3). */
  function renderCarenzaArmadi() {
    const pannello = pannelli.get("carenza-armadi");
    const righe = stato.carenzaArmadi;
    const ul = preparaPannello(pannello, "Carenza Armadi di Ripristino", righe.length);
    if (!ul) return;

    for (const r of righe) {
      const intestazione = el("div", { class: "checklists-riga-intestazione" });
      intestazione.appendChild(el("span", { class: "checklists-nome", text: r.nome }));
      intestazione.appendChild(
        el("span", { class: "checklists-codice", text: `Cod. ${r.codice}` }),
      );

      const dettagli = el("dl", { class: "checklists-dettagli" });
      const coppia = (etichetta, valore) => {
        dettagli.appendChild(el("dt", { text: etichetta }));
        dettagli.appendChild(el("dd", { text: valore }));
      };
      coppia("Giacenza armadi", String(r.giacenza));
      coppia("Soglia minima armadi", String(r.giacenza_minima_armadi));

      const li = el("li", {
        class: "checklists-item checklists-item--armadi",
        children: [intestazione, dettagli],
      });
      ul.appendChild(li);
    }
  }

  /** (C) Prossima scadenza — per lotto, nessuna spunta (R13.3). */
  function renderScadenza() {
    const pannello = pannelli.get("scadenza");
    const righe = stato.scadenza;
    const ul = preparaPannello(pannello, "Prossima scadenza", righe.length);
    if (!ul) return;

    for (const r of righe) {
      const intestazione = el("div", { class: "checklists-riga-intestazione" });
      intestazione.appendChild(el("span", { class: "checklists-nome", text: r.nome }));
      intestazione.appendChild(
        el("span", { class: "checklists-codice", text: `Cod. ${r.codice}` }),
      );

      const dettagli = el("dl", { class: "checklists-dettagli" });
      const coppia = (etichetta, valore) => {
        dettagli.appendChild(el("dt", { text: etichetta }));
        dettagli.appendChild(el("dd", { text: valore }));
      };
      coppia("Lotto", etichettaLotto(r.lotto));
      coppia("Scadenza", r.data_scadenza_effettiva || "—");
      coppia("Giacenza lotto", String(r.giacenza_lotto));

      const li = el("li", {
        class: "checklists-item checklists-item--scadenza",
        children: [intestazione, dettagli],
      });
      ul.appendChild(li);
    }
  }

  /** Ridisegna tutti e tre i pannelli dallo stato corrente. */
  function renderTutto() {
    renderCarenzaCu();
    renderCarenzaArmadi();
    renderScadenza();
  }

  // ---- Persistenza spunta ordine (R11.2) ----------------------------------

  /**
   * Gestisce il cambio della checkbox "ordine effettuato": persiste lo stato
   * tramite l'API e aggiorna lo stato locale. La riga NON viene rimossa dalla
   * spunta (R11.3): resta visibile finché la giacenza non rientra sopra soglia.
   * @param {Object} riga riga della carenza CU
   * @param {HTMLInputElement} check la checkbox
   */
  async function onToggleOrdine(riga, check) {
    const nuovo = check.checked;
    check.disabled = true;
    const res = await impostaOrdinato(riga.prodotto_id, nuovo);
    check.disabled = false;
    if (!res.ok) {
      // Ripristina lo stato visivo precedente e segnala l'errore.
      check.checked = !nuovo;
      mostraMessaggio(
        area,
        res.error || "Impossibile aggiornare lo stato dell'ordine.",
        "errore",
      );
      return;
    }
    riga.ordinato = nuovo;
    mostraMessaggio(
      area,
      nuovo
        ? `Ordine segnato come effettuato per ${riga.nome}.`
        : `Spunta ordine rimossa per ${riga.nome}.`,
      "successo",
    );
  }

  // ---- Caricamento dati ----------------------------------------------------

  /** Ricarica tutte e tre le liste dalle viste del DB. */
  async function ricaricaTutto() {
    if (stato.caricamento) return;
    stato.caricamento = true;
    btnRefresh.disabled = true;
    mostraMessaggio(area, "Aggiornamento in corso…", "info");

    const [resCu, resArmadi, resScad] = await Promise.all([
      listaCarenzaCu(),
      listaCarenzaArmadi(),
      listaScadenza(),
    ]);

    const errori = [];
    stato.carenzaCu = resCu.ok ? resCu.data || [] : [];
    if (!resCu.ok) errori.push(resCu.error || "carenza CU");
    stato.carenzaArmadi = resArmadi.ok ? resArmadi.data || [] : [];
    if (!resArmadi.ok) errori.push(resArmadi.error || "carenza armadi");
    stato.scadenza = resScad.ok ? resScad.data || [] : [];
    if (!resScad.ok) errori.push(resScad.error || "scadenza");

    renderTutto();

    if (errori.length > 0) {
      mostraMessaggio(
        area,
        `Errore nel caricamento: ${errori.join("; ")}.`,
        "errore",
      );
    } else {
      mostraMessaggio(area, "", "info");
    }

    stato.caricamento = false;
    btnRefresh.disabled = false;
  }

  // ---- Avvio ---------------------------------------------------------------
  renderTutto(); // stato iniziale (liste vuote) prima del primo fetch
  ricaricaTutto();

  return {
    destroy() {
      svuota(container);
    },
  };
}

export default { mount };
