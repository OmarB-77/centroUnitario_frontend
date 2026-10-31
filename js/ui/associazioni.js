// js/ui/associazioni.js
//
// Schermata di gestione dell'anagrafica ASSOCIAZIONI (R3), riservata ad Admin e
// Power-user (l'autorizzazione reale è nelle policy RLS; qui è solo UX).
//
// Funzionalità:
//   - elenco delle associazioni (R3.3);
//   - form di creazione/modifica con nome obbligatorio (1..200) e note
//     opzionali (R3.1, R3.2, R3.4);
//   - eliminazione con conferma (R3.5): se l'associazione è referenziata da un
//     movimento di scarico, il DB blocca l'operazione (ON DELETE RESTRICT) e il
//     layer API traduce l'errore FK in un messaggio "in uso", mostrato all'utente.
//
// Convenzioni:
//   - tutti i valori provenienti dal DB sono inseriti via textContent (anti-XSS),
//     il DOM è costruito con createElement (mai innerHTML con dati grezzi);
//   - validazione del nome lato client PRIMA dell'invio (feedback immediato),
//     la validazione reale resta comunque lato DB;
//   - testi in italiano, aria-label sui bottoni a sola icona.

import {
  listaAssociazioni,
  creaAssociazione,
  aggiornaAssociazione,
  eliminaAssociazione,
} from "../api/associazioni.js";
import { validaNome } from "../domain/validation.js";
import {
  el,
  svuota,
  bottoneIcona,
  areaMessaggi,
  mostraMessaggio,
} from "./_dom.js";

/**
 * Monta la schermata "Associazioni" nel contenitore indicato.
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {Promise<void>}
 */
export async function mount(container) {
  if (!container) throw new Error("Container mancante per la schermata associazioni.");
  svuota(container);

  // Stato locale della schermata.
  const stato = {
    elementi: /** @type {any[]} */ ([]),
    inModifica: /** @type {string|null} */ (null), // id del record in modifica
  };

  // --- Struttura statica -----------------------------------------------------
  const titolo = el("h2", { text: "Associazioni" });
  const areaForm = el("div", { class: "as-form" });
  const areaElenco = el("div", { class: "as-elenco" });
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
      class: "as-nome",
      attrs: {
        maxlength: "200",
        placeholder: "Nome (obbligatorio)",
        "aria-label": "Nome dell'associazione",
        required: "required",
      },
    });
    const inNote = el("textarea", {
      class: "as-note",
      attrs: {
        rows: "2",
        placeholder: "Note (facoltative)",
        "aria-label": "Note dell'associazione",
      },
    });

    // Precompila i campi se si sta modificando un record esistente.
    const corrente = stato.inModifica
      ? stato.elementi.find((a) => a.id === stato.inModifica)
      : null;
    if (corrente) {
      inNome.value = corrente.nome || "";
      inNote.value = corrente.note || "";
    }

    const btnSalva = el("button", {
      type: "submit",
      class: "btn-primario",
      text: stato.inModifica ? "Salva modifiche" : "Aggiungi associazione",
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
        class: "as-form-inner",
        attrs: { novalidate: "novalidate" },
        on: {
          submit: async (ev) => {
            ev.preventDefault();
            await invia(inNome.value, inNote.value);
          },
        },
      },
      [
        el("div", { class: "campo" }, [
          el("label", { attrs: {}, text: "Nome" }),
          inNome,
        ]),
        el("div", { class: "campo" }, [
          el("label", { attrs: {}, text: "Note" }),
          inNote,
        ]),
        el("div", { class: "azioni" }, azioni),
      ],
    );

    areaForm.appendChild(form);
    inNome.focus();
  }

  // --- Invio (create/update) -------------------------------------------------
  async function invia(nome, note) {
    // Validazione client del nome PRIMA dell'invio (R3.2).
    const v = validaNome(nome);
    if (!v.ok) {
      mostraMessaggio(messaggi, v.errors[0], "errore");
      return;
    }

    const dati = { nome: String(nome).trim(), note };
    const risultato = stato.inModifica
      ? await aggiornaAssociazione(stato.inModifica, dati)
      : await creaAssociazione(dati);

    if (!risultato.ok) {
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }

    const eraModifica = Boolean(stato.inModifica);
    stato.inModifica = null;
    mostraMessaggio(
      messaggi,
      eraModifica ? "Associazione aggiornata." : "Associazione creata.",
      "successo",
    );
    await ricarica();
  }

  // --- Eliminazione con conferma --------------------------------------------
  async function elimina(associazione) {
    const conferma = window.confirm(
      `Eliminare l'associazione "${associazione.nome}"?`,
    );
    if (!conferma) return;

    const risultato = await eliminaAssociazione(associazione.id);
    if (!risultato.ok) {
      // Errore FK (ON DELETE RESTRICT) → messaggio "in uso" mappato dal layer API.
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }
    if (stato.inModifica === associazione.id) stato.inModifica = null;
    mostraMessaggio(messaggi, "Associazione eliminata.", "successo");
    await ricarica();
  }

  // --- Rendering dell'elenco -------------------------------------------------
  function renderizzaElenco() {
    svuota(areaElenco);

    if (stato.elementi.length === 0) {
      areaElenco.appendChild(
        el("p", { class: "vuoto", text: "Nessuna associazione presente." }),
      );
      return;
    }

    const righe = stato.elementi.map((a) => {
      const btnModifica = bottoneIcona({
        etichetta: `Modifica ${a.nome}`,
        icona: "✏️",
        className: "btn-modifica",
        onClick: () => {
          stato.inModifica = a.id;
          costruisciForm();
          mostraMessaggio(messaggi, "", "info");
        },
      });
      const btnElimina = bottoneIcona({
        etichetta: `Elimina ${a.nome}`,
        icona: "🗑",
        className: "btn-elimina",
        onClick: () => elimina(a),
      });

      return el("li", { class: "as-item" }, [
        el("div", { class: "as-item-dati" }, [
          // Valori dal DB inseriti come testo (anti-XSS).
          el("span", { class: "as-item-nome", text: a.nome }),
          a.note
            ? el("span", { class: "as-item-note", text: a.note })
            : el("span", {
                class: "as-item-note as-item-note--assenti",
                text: "—",
              }),
        ]),
        el("div", { class: "as-item-azioni" }, [btnModifica, btnElimina]),
      ]);
    });

    areaElenco.appendChild(el("ul", { class: "as-lista" }, righe));
  }

  // --- Caricamento dati ------------------------------------------------------
  async function ricarica() {
    const risultato = await listaAssociazioni();
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
