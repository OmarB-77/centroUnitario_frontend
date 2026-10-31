// js/ui/puntiPrelievo.js
//
// Schermata di gestione dell'anagrafica PUNTI DI PRELIEVO (R2), riservata ad
// Admin e Power-user (l'autorizzazione reale è nelle policy RLS; qui è solo UX).
//
// Funzionalità:
//   - elenco dei punti di prelievo (R2.3);
//   - form di creazione/modifica con nome obbligatorio (1..200) e contatti
//     opzionali (R2.1, R2.2, R2.4);
//   - eliminazione con conferma (R2.5): se il punto di prelievo è referenziato
//     da un prodotto, il DB blocca l'operazione (ON DELETE RESTRICT) e il layer
//     API traduce l'errore FK in un messaggio "in uso", mostrato all'utente.
//
// Convenzioni:
//   - tutti i valori provenienti dal DB sono inseriti via textContent (anti-XSS),
//     il DOM è costruito con createElement (mai innerHTML con dati grezzi);
//   - validazione del nome lato client PRIMA dell'invio (feedback immediato),
//     la validazione reale resta comunque lato DB;
//   - testi in italiano, aria-label sui bottoni a sola icona.

import {
  listaPuntiDiPrelievo,
  creaPuntoDiPrelievo,
  aggiornaPuntoDiPrelievo,
  eliminaPuntoDiPrelievo,
} from "../api/puntiPrelievo.js";
import { validaNome } from "../domain/validation.js";
import {
  el,
  svuota,
  bottoneIcona,
  areaMessaggi,
  mostraMessaggio,
} from "./_dom.js";

/**
 * Monta la schermata "Punti di prelievo" nel contenitore indicato.
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {Promise<void>}
 */
export async function mount(container) {
  if (!container) throw new Error("Container mancante per la schermata punti di prelievo.");
  svuota(container);

  // Stato locale della schermata.
  const stato = {
    elementi: /** @type {any[]} */ ([]),
    inModifica: /** @type {string|null} */ (null), // id del record in modifica
  };

  // --- Struttura statica -----------------------------------------------------
  const titolo = el("h2", { text: "Punti di prelievo" });
  const areaForm = el("div", { class: "pp-form" });
  const areaElenco = el("div", { class: "pp-elenco" });
  const messaggi = areaMessaggi();

  container.appendChild(titolo);
  container.appendChild(messaggi);
  container.appendChild(areaForm);
  container.appendChild(areaElenco);

  // --- Form di creazione/modifica -------------------------------------------
  function costruisciForm() {
    svuota(areaForm);

    const inNome = el("input", {
      type: "text",
      class: "pp-nome",
      attrs: {
        maxlength: "200",
        placeholder: "Nome (obbligatorio)",
        "aria-label": "Nome del punto di prelievo",
        required: "required",
      },
    });
    const inContatti = el("input", {
      type: "text",
      class: "pp-contatti",
      attrs: {
        placeholder: "Contatti (facoltativo)",
        "aria-label": "Contatti del punto di prelievo",
      },
    });

    // Precompila i campi se si sta modificando un record esistente.
    const corrente = stato.inModifica
      ? stato.elementi.find((p) => p.id === stato.inModifica)
      : null;
    if (corrente) {
      inNome.value = corrente.nome || "";
      inContatti.value = corrente.contatti || "";
    }

    const btnSalva = el("button", {
      type: "submit",
      class: "btn-primario",
      text: stato.inModifica ? "Salva modifiche" : "Aggiungi punto di prelievo",
    });

    const azioni = [btnSalva];
    if (stato.inModifica) {
      azioni.push(
        el("button", {
          type: "button",
          class: "btn-secondario",
          text: "Annulla",
          on: {
            click: () => {
              stato.inModifica = null;
              costruisciForm();
              mostraMessaggio(messaggi, "", "info");
            },
          },
        }),
      );
    }

    const form = el(
      "form",
      {
        class: "pp-form-inner",
        attrs: { novalidate: "novalidate" },
        on: {
          submit: async (ev) => {
            ev.preventDefault();
            await invia(inNome.value, inContatti.value);
          },
        },
      },
      [
        el("div", { class: "campo" }, [
          el("label", { attrs: {}, text: "Nome" }),
          inNome,
        ]),
        el("div", { class: "campo" }, [
          el("label", { attrs: {}, text: "Contatti" }),
          inContatti,
        ]),
        el("div", { class: "azioni" }, azioni),
      ],
    );

    areaForm.appendChild(form);
    inNome.focus();
  }

  // --- Invio (create/update) -------------------------------------------------
  async function invia(nome, contatti) {
    // Validazione client del nome PRIMA dell'invio (R2.2).
    const v = validaNome(nome);
    if (!v.ok) {
      mostraMessaggio(messaggi, v.errors[0], "errore");
      return;
    }

    const dati = { nome: String(nome).trim(), contatti };
    const risultato = stato.inModifica
      ? await aggiornaPuntoDiPrelievo(stato.inModifica, dati)
      : await creaPuntoDiPrelievo(dati);

    if (!risultato.ok) {
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }

    const eraModifica = Boolean(stato.inModifica);
    stato.inModifica = null;
    mostraMessaggio(
      messaggi,
      eraModifica ? "Punto di prelievo aggiornato." : "Punto di prelievo creato.",
      "successo",
    );
    await ricarica();
  }

  // --- Eliminazione con conferma --------------------------------------------
  async function elimina(punto) {
    const conferma = window.confirm(
      `Eliminare il punto di prelievo "${punto.nome}"?`,
    );
    if (!conferma) return;

    const risultato = await eliminaPuntoDiPrelievo(punto.id);
    if (!risultato.ok) {
      // Errore FK (ON DELETE RESTRICT) → messaggio "in uso" mappato dal layer API.
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }
    if (stato.inModifica === punto.id) stato.inModifica = null;
    mostraMessaggio(messaggi, "Punto di prelievo eliminato.", "successo");
    await ricarica();
  }

  // --- Rendering dell'elenco -------------------------------------------------
  function renderizzaElenco() {
    svuota(areaElenco);

    if (stato.elementi.length === 0) {
      areaElenco.appendChild(
        el("p", { class: "vuoto", text: "Nessun punto di prelievo presente." }),
      );
      return;
    }

    const righe = stato.elementi.map((p) => {
      const btnModifica = bottoneIcona({
        etichetta: `Modifica ${p.nome}`,
        icona: "✏️",
        className: "btn-modifica",
        onClick: () => {
          stato.inModifica = p.id;
          costruisciForm();
          mostraMessaggio(messaggi, "", "info");
        },
      });
      const btnElimina = bottoneIcona({
        etichetta: `Elimina ${p.nome}`,
        icona: "🗑",
        className: "btn-elimina",
        onClick: () => elimina(p),
      });

      return el("li", { class: "pp-item" }, [
        el("div", { class: "pp-item-dati" }, [
          // Valori dal DB inseriti come testo (anti-XSS).
          el("span", { class: "pp-item-nome", text: p.nome }),
          p.contatti
            ? el("span", { class: "pp-item-contatti", text: p.contatti })
            : el("span", {
                class: "pp-item-contatti pp-item-contatti--assenti",
                text: "—",
              }),
        ]),
        el("div", { class: "pp-item-azioni" }, [btnModifica, btnElimina]),
      ]);
    });

    areaElenco.appendChild(el("ul", { class: "pp-lista" }, righe));
  }

  // --- Caricamento dati ------------------------------------------------------
  async function ricarica() {
    const risultato = await listaPuntiDiPrelievo();
    if (!risultato.ok) {
      stato.elementi = [];
      renderizzaElenco();
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }
    stato.elementi = Array.isArray(risultato.data) ? risultato.data : [];
    renderizzaElenco();
    costruisciForm();
  }

  // Avvio.
  costruisciForm();
  await ricarica();
}

export default { mount };
