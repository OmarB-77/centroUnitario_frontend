// js/ui/utenti.js
//
// Schermata "Gestione utenti" (R6), riservata ESCLUSIVAMENTE all'Admin.
//
// Funzionalità:
//   - elenco degli utenti applicativi (id, nome visualizzato, ruolo) letti da
//     `listaUtenti()` (R6 — la RLS consente all'Admin di leggere tutti i profili);
//   - form di creazione account (email, password 8..72, ruolo, nome opzionale)
//     via `creaUtente(...)` → Edge Function `gestione-utenti` (R6.1);
//   - cambio ruolo per riga tramite select nativa → `cambiaRuolo(id, ruolo)` (R6.4);
//   - eliminazione per riga con conferma → `eliminaUtente(id)` (R6.4);
//   - messaggio dedicato e chiaro per il vincolo ultimo-Admin, mappato dal layer
//     API dallo status 409 ("deve esistere almeno un Admin", R6.5).
//
// CONFINI E SICUREZZA (steering):
//   - Questa schermata è "solo Admin" dal punto di vista della UI (il router la
//     protegge con le guard di roles.js), ma l'ENFORCEMENT reale è duplice e
//     lato server: le policy RLS sulla tabella `users` e il controllo del ruolo
//     Admin dentro la Edge Function `gestione-utenti` con service role (R6.6).
//     La UI non è mai l'unica difesa.
//   - Tutti i valori provenienti dal DB (display_name, id, ...) sono inseriti
//     via textContent / helper `el` (mai innerHTML con dati grezzi): anti-XSS.
//   - Il campo password usa type="password"; i controlli a sola icona hanno
//     aria-label; select e checkbox restano native.

import {
  listaUtenti,
  creaUtente,
  cambiaRuolo,
  eliminaUtente,
} from "../api/utenti.js";
import { RUOLI } from "../roles.js";
import {
  el,
  svuota,
  bottoneIcona,
  areaMessaggi,
  mostraMessaggio,
} from "./_dom.js";

// Etichette italiane dei ruoli per select ed elenco. Allineate ai valori enum
// canonici di `RUOLI` (admin | power_user | user).
const ETICHETTE_RUOLO = Object.freeze({
  [RUOLI.ADMIN]: "Admin",
  [RUOLI.POWER_USER]: "Power-user",
  [RUOLI.USER]: "User",
});

// Ordine di presentazione dei ruoli nelle select (dal più al meno privilegiato).
const RUOLI_ORDINATI = Object.freeze([
  RUOLI.ADMIN,
  RUOLI.POWER_USER,
  RUOLI.USER,
]);

const PWD_MIN = 8;
const PWD_MAX = 72;

/**
 * Restituisce l'etichetta leggibile di un ruolo, con fallback al valore grezzo.
 * @param {string} ruolo valore enum del ruolo
 * @returns {string}
 */
function etichettaRuolo(ruolo) {
  return ETICHETTE_RUOLO[ruolo] ?? String(ruolo ?? "");
}

/**
 * Costruisce una select nativa dei ruoli, con il valore corrente selezionato.
 * @param {object} opzioni
 * @param {string} [opzioni.valore] ruolo attualmente selezionato
 * @param {string} [opzioni.ariaLabel] etichetta accessibile della select
 * @param {Object<string,Function>} [opzioni.on] listener (es. { change })
 * @returns {HTMLSelectElement}
 */
function selectRuolo({ valore, ariaLabel, on } = {}) {
  const opzioni = RUOLI_ORDINATI.map((r) =>
    el("option", {
      value: r,
      text: etichettaRuolo(r),
      attrs: { value: r },
    }),
  );
  const sel = el(
    "select",
    {
      class: "ut-ruolo",
      attrs: ariaLabel ? { "aria-label": ariaLabel } : {},
      on: on || {},
    },
    opzioni,
  );
  if (valore != null) sel.value = valore;
  return sel;
}

/**
 * Monta la schermata "Gestione utenti" nel contenitore indicato.
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {Promise<void>}
 */
export async function mount(container) {
  if (!container) throw new Error("Container mancante per la schermata utenti.");
  svuota(container);

  // Stato locale della schermata.
  const stato = {
    elementi: /** @type {any[]} */ ([]),
  };

  // --- Struttura statica -----------------------------------------------------
  const titolo = el("h2", { text: "Gestione utenti" });
  const messaggi = areaMessaggi();
  const areaForm = el("div", { class: "ut-form" });
  const areaElenco = el("div", { class: "ut-elenco" });

  container.appendChild(titolo);
  container.appendChild(messaggi);
  container.appendChild(areaForm);
  container.appendChild(areaElenco);

  // --- Form di creazione nuovo utente ---------------------------------------
  function costruisciForm() {
    svuota(areaForm);

    const inEmail = el("input", {
      type: "email",
      class: "ut-email",
      attrs: {
        name: "email",
        autocomplete: "off",
        placeholder: "Email (obbligatoria)",
        "aria-label": "Email del nuovo utente",
        required: "required",
      },
    });

    const inPassword = el("input", {
      type: "password",
      class: "ut-password",
      attrs: {
        name: "password",
        autocomplete: "new-password",
        minlength: String(PWD_MIN),
        maxlength: String(PWD_MAX),
        placeholder: `Password (${PWD_MIN}..${PWD_MAX} caratteri)`,
        "aria-label": "Password del nuovo utente",
        required: "required",
      },
    });

    const inNome = el("input", {
      type: "text",
      class: "ut-nome",
      attrs: {
        name: "display_name",
        maxlength: "200",
        placeholder: "Nome visualizzato (facoltativo)",
        "aria-label": "Nome visualizzato del nuovo utente",
      },
    });

    const selRuolo = selectRuolo({
      valore: RUOLI.USER,
      ariaLabel: "Ruolo del nuovo utente",
    });

    const btnSalva = el("button", {
      type: "submit",
      class: "btn-primario",
      text: "Crea utente",
    });

    const form = el(
      "form",
      {
        class: "ut-form-inner",
        attrs: { novalidate: "novalidate" },
        on: {
          submit: async (ev) => {
            ev.preventDefault();
            await inviaCreazione(
              {
                email: inEmail.value,
                password: inPassword.value,
                ruolo: selRuolo.value,
                displayName: inNome.value,
              },
              { inEmail, inPassword, inNome, selRuolo },
            );
          },
        },
      },
      [
        el("div", { class: "campo" }, [
          el("label", { text: "Email" }),
          inEmail,
        ]),
        el("div", { class: "campo" }, [
          el("label", { text: "Password" }),
          inPassword,
        ]),
        el("div", { class: "campo" }, [
          el("label", { text: "Ruolo" }),
          selRuolo,
        ]),
        el("div", { class: "campo" }, [
          el("label", { text: "Nome visualizzato" }),
          inNome,
        ]),
        el("div", { class: "azioni" }, [btnSalva]),
      ],
    );

    areaForm.appendChild(form);
    inEmail.focus();
  }

  // --- Creazione account -----------------------------------------------------
  async function inviaCreazione(dati, controlli) {
    // Validazione client PRIMA dell'invio (UX). La difesa reale è lato server
    // (Edge Function + Auth): la validazione client NON è l'unica barriera.
    const email = typeof dati.email === "string" ? dati.email.trim() : "";
    const password = typeof dati.password === "string" ? dati.password : "";

    if (email === "") {
      mostraMessaggio(messaggi, "L'email è obbligatoria.", "errore");
      return;
    }
    if (password.length < PWD_MIN || password.length > PWD_MAX) {
      mostraMessaggio(
        messaggi,
        `La password deve essere lunga da ${PWD_MIN} a ${PWD_MAX} caratteri.`,
        "errore",
      );
      return;
    }

    const risultato = await creaUtente({
      email,
      password,
      ruolo: dati.ruolo,
      displayName: dati.displayName,
    });

    if (!risultato.ok) {
      // Include l'eventuale vincolo ultimo-Admin (non atteso in creazione) e gli
      // altri errori mappati dal layer API (409/403/401/400...) in italiano.
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }

    mostraMessaggio(messaggi, "Utente creato.", "successo");
    // Ripulisce il form riportandolo allo stato iniziale.
    if (controlli) {
      controlli.inEmail.value = "";
      controlli.inPassword.value = "";
      controlli.inNome.value = "";
      controlli.selRuolo.value = RUOLI.USER;
    }
    await ricarica();
  }

  // --- Cambio ruolo per riga -------------------------------------------------
  async function onCambiaRuolo(utente, nuovoRuolo, selezione) {
    if (nuovoRuolo === utente.ruolo) return;

    const risultato = await cambiaRuolo(utente.id, nuovoRuolo);
    if (!risultato.ok) {
      // Vincolo ultimo-Admin (409 → "deve esistere almeno un Admin", R6.5) e
      // altri errori: mostra il messaggio e ripristina la select al valore
      // precedente per riflettere lo stato effettivo sul server.
      mostraMessaggio(messaggi, risultato.error, "errore");
      if (selezione) selezione.value = utente.ruolo;
      return;
    }

    mostraMessaggio(
      messaggi,
      `Ruolo aggiornato a "${etichettaRuolo(nuovoRuolo)}".`,
      "successo",
    );
    await ricarica();
  }

  // --- Eliminazione con conferma --------------------------------------------
  async function onElimina(utente) {
    const nome = utente.display_name || utente.id;
    const conferma = window.confirm(`Eliminare l'utente "${nome}"?`);
    if (!conferma) return;

    const risultato = await eliminaUtente(utente.id);
    if (!risultato.ok) {
      // Vincolo ultimo-Admin (R6.5) o altri errori mappati dal layer API.
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }

    mostraMessaggio(messaggi, "Utente eliminato.", "successo");
    await ricarica();
  }

  // --- Rendering dell'elenco -------------------------------------------------
  function renderizzaElenco() {
    svuota(areaElenco);

    const intestazione = el("h3", {
      text: `Utenti (${stato.elementi.length})`,
    });
    areaElenco.appendChild(intestazione);

    if (stato.elementi.length === 0) {
      areaElenco.appendChild(
        el("p", { class: "vuoto", text: "Nessun utente presente." }),
      );
      return;
    }

    const righe = stato.elementi.map((u) => {
      // Nome visualizzato (via textContent): fallback all'id se assente.
      const etichettaNome = u.display_name
        ? el("span", { class: "ut-item-nome", text: u.display_name })
        : el("span", {
            class: "ut-item-nome ut-item-nome--assente",
            text: "(senza nome)",
          });

      const etichettaId = el("span", {
        class: "ut-item-id",
        text: u.id,
      });

      // Select cambio ruolo per riga (R6.4). Il change invia la richiesta e, in
      // caso di rifiuto, ripristina il valore precedente.
      const sel = selectRuolo({
        valore: u.ruolo,
        ariaLabel: `Ruolo di ${u.display_name || u.id}`,
      });
      sel.addEventListener("change", () => onCambiaRuolo(u, sel.value, sel));

      const btnElimina = bottoneIcona({
        etichetta: `Elimina ${u.display_name || u.id}`,
        icona: "🗑",
        className: "btn-elimina",
        onClick: () => onElimina(u),
      });

      return el("li", { class: "ut-item" }, [
        el("div", { class: "ut-item-dati" }, [etichettaNome, etichettaId]),
        el("div", { class: "ut-item-azioni" }, [
          el("label", { class: "ut-item-ruolo" }, [
            el("span", { class: "ut-item-ruolo-label", text: "Ruolo" }),
            sel,
          ]),
          btnElimina,
        ]),
      ]);
    });

    areaElenco.appendChild(el("ul", { class: "ut-lista" }, righe));
  }

  // --- Caricamento dati ------------------------------------------------------
  async function ricarica() {
    const risultato = await listaUtenti();
    if (!risultato.ok) {
      stato.elementi = [];
      renderizzaElenco();
      mostraMessaggio(messaggi, risultato.error, "errore");
      return;
    }
    stato.elementi = Array.isArray(risultato.data) ? risultato.data : [];
    renderizzaElenco();
  }

  // Avvio.
  costruisciForm();
  await ricarica();
}

export default { mount };
