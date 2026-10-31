// js/ui/impostazioni.js
//
// Schermata IMPOSTAZIONI personali, accessibile a tutti gli utenti autenticati
// (R4.5, R15.5, R15.6). Due sezioni indipendenti:
//
//   1. CAMBIO PASSWORD (R4.5/R4.6)
//      - due campi password (nuova + conferma);
//      - validazione lato client della lunghezza (PASSWORD_MIN..PASSWORD_MAX)
//        e della coincidenza tra i due campi, PRIMA della chiamata di rete
//        (feedback immediato; la validazione reale resta comunque lato Supabase);
//      - esito mostrato in italiano via area messaggi dedicata.
//
//   2. FOTOCAMERA PER LO SCANNER (R15.5/R15.6)
//      - enumerazione dei device tramite scanner.enumeraCamere(): richiede il
//        permesso fotocamera, quindi è avviata SOLO su gesto utente ("Rileva
//        fotocamere") e avvolta in try/catch per mostrare un messaggio chiaro
//        in caso di permesso negato / nessuna camera / libreria non caricabile;
//      - select nativa per scegliere la fotocamera; la preferenza è persistita
//        in localStorage con salvaCameraPreferita(id);
//      - la preselezione usa l'euristica pura scegliCameraPredefinita(cameras,
//        cameraPreferita()) così da onorare la preferenza salvata o, in sua
//        assenza, la camera posteriore (R15.6).
//
// CONVENZIONI
//   - DOM costruito via el()/createElement; i valori dal device (label camera)
//     sono inseriti SEMPRE via textContent (anti-XSS);
//   - testi in italiano, aria-label sui controlli;
//   - select native (nessun componente custom);
//   - mount(container) restituisce una funzione di CLEANUP (rimozione del DOM
//     montato) per coerenza con il resto della shell.

import { cambioPassword, PASSWORD_MIN, PASSWORD_MAX } from "../auth.js";
import {
  enumeraCamere,
  cameraPreferita,
  salvaCameraPreferita,
  scegliCameraPredefinita,
} from "../scanner.js";
import { el, svuota, areaMessaggi, mostraMessaggio } from "./_dom.js";

/**
 * Monta la schermata "Impostazioni" nel contenitore indicato.
 *
 * @param {HTMLElement} container elemento in cui montare la UI
 * @returns {() => void} funzione di cleanup che smonta il DOM della schermata
 */
export function mount(container) {
  if (!container) {
    throw new Error("Container mancante per la schermata impostazioni.");
  }
  svuota(container);

  // Radice della schermata: il cleanup rimuove solo ciò che montiamo noi.
  const radice = el("div", { class: "impostazioni" });

  // ---------------------------------------------------------------------------
  // Sezione 1 — Cambio password
  // ---------------------------------------------------------------------------
  const msgPassword = areaMessaggi();

  const inNuova = el("input", {
    type: "password",
    class: "imp-password-nuova",
    attrs: {
      autocomplete: "new-password",
      minlength: String(PASSWORD_MIN),
      maxlength: String(PASSWORD_MAX),
      placeholder: "Nuova password",
      "aria-label": "Nuova password",
      required: "required",
    },
  });
  const inConferma = el("input", {
    type: "password",
    class: "imp-password-conferma",
    attrs: {
      autocomplete: "new-password",
      minlength: String(PASSWORD_MIN),
      maxlength: String(PASSWORD_MAX),
      placeholder: "Conferma nuova password",
      "aria-label": "Conferma nuova password",
      required: "required",
    },
  });

  const btnSalvaPassword = el("button", {
    type: "submit",
    class: "btn-primario",
    text: "Cambia password",
  });

  const formPassword = el(
    "form",
    {
      class: "imp-form-password",
      attrs: { novalidate: "novalidate" },
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          await inviaCambioPassword();
        },
      },
    },
    [
      el("div", { class: "campo" }, [
        el("label", { attrs: { for: "imp-pwd-nuova" }, text: "Nuova password" }),
        ((inNuova.id = "imp-pwd-nuova"), inNuova),
      ]),
      el("div", { class: "campo" }, [
        el("label", {
          attrs: { for: "imp-pwd-conferma" },
          text: "Conferma nuova password",
        }),
        ((inConferma.id = "imp-pwd-conferma"), inConferma),
      ]),
      el("div", { class: "azioni" }, [btnSalvaPassword]),
    ],
  );

  const sezionePassword = el("section", { class: "imp-sezione imp-sezione--password" }, [
    el("h3", { text: "Cambio password" }),
    el("p", {
      class: "imp-hint",
      text: `La nuova password deve avere da ${PASSWORD_MIN} a ${PASSWORD_MAX} caratteri.`,
    }),
    msgPassword,
    formPassword,
  ]);

  /**
   * Valida i due campi password e, se validi, invoca cambioPassword(nuova).
   * Nessuna chiamata di rete se la validazione client fallisce (R4.5).
   */
  async function inviaCambioPassword() {
    const nuova = String(inNuova.value ?? "");
    const conferma = String(inConferma.value ?? "");

    if (nuova.length < PASSWORD_MIN || nuova.length > PASSWORD_MAX) {
      mostraMessaggio(
        msgPassword,
        `La nuova password deve avere da ${PASSWORD_MIN} a ${PASSWORD_MAX} caratteri.`,
        "errore",
      );
      inNuova.focus();
      return;
    }
    if (nuova !== conferma) {
      mostraMessaggio(
        msgPassword,
        "Le due password non coincidono.",
        "errore",
      );
      inConferma.focus();
      return;
    }

    btnSalvaPassword.disabled = true;
    try {
      const risultato = await cambioPassword(nuova);
      if (!risultato.ok) {
        mostraMessaggio(msgPassword, risultato.error, "errore");
        return;
      }
      // Successo: azzeriamo i campi per evitare di lasciare la password a video.
      inNuova.value = "";
      inConferma.value = "";
      mostraMessaggio(msgPassword, "Password aggiornata correttamente.", "successo");
    } catch (_e) {
      mostraMessaggio(
        msgPassword,
        "Impossibile aggiornare la password. Riprova.",
        "errore",
      );
    } finally {
      btnSalvaPassword.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Sezione 2 — Fotocamera per lo scanner
  // ---------------------------------------------------------------------------
  const msgCamera = areaMessaggi();

  // Select nativa delle fotocamere: disabilitata finché non si enumerano i device.
  const selectCamera = el("select", {
    class: "imp-camera-select",
    attrs: { "aria-label": "Fotocamera per la scansione" },
    disabled: true,
  });

  const btnRileva = el("button", {
    type: "button",
    class: "btn-secondario imp-camera-rileva",
    text: "Rileva fotocamere",
    on: { click: () => rilevaFotocamere() },
  });

  // Alla selezione, persiste subito la preferenza (R15.5).
  selectCamera.addEventListener("change", () => {
    const id = selectCamera.value;
    if (typeof id === "string" && id !== "") {
      salvaCameraPreferita(id);
      mostraMessaggio(msgCamera, "Fotocamera preferita salvata.", "successo");
    }
  });

  const sezioneCamera = el("section", { class: "imp-sezione imp-sezione--camera" }, [
    el("h3", { text: "Fotocamera per lo scanner" }),
    el("p", {
      class: "imp-hint",
      text: "Scegli la fotocamera da usare per la scansione dei codici. Il rilevamento richiede il permesso di accesso alla fotocamera.",
    }),
    msgCamera,
    el("div", { class: "campo" }, [
      el("label", {
        attrs: { for: "imp-camera-select" },
        text: "Fotocamera",
      }),
      ((selectCamera.id = "imp-camera-select"), selectCamera),
    ]),
    el("div", { class: "azioni" }, [btnRileva]),
  ]);

  /**
   * Popola la select con l'elenco di fotocamere e preseleziona quella
   * preferita (o la posteriore in sua assenza), via euristica pura.
   * @param {Array<{id: string, label: string}>} cameras
   */
  function popolaSelect(cameras) {
    svuota(selectCamera);
    for (const cam of cameras) {
      const opt = el("option", { value: cam.id });
      // Label dal device → sempre via textContent (anti-XSS).
      opt.textContent = cam.label && cam.label !== "" ? cam.label : "Fotocamera senza nome";
      selectCamera.appendChild(opt);
    }
    selectCamera.disabled = cameras.length === 0;

    const scelta = scegliCameraPredefinita(cameras, cameraPreferita());
    if (scelta) selectCamera.value = scelta;
  }

  /**
   * Enumera le fotocamere su gesto utente, gestendo con grazia i casi di
   * permesso negato / nessuna camera / libreria non caricabile (R15.7-adiacente):
   * mostra un messaggio chiaro e lascia il bottone per riprovare.
   */
  async function rilevaFotocamere() {
    btnRileva.disabled = true;
    mostraMessaggio(msgCamera, "Rilevamento fotocamere in corso…", "info");
    try {
      const cameras = await enumeraCamere();
      popolaSelect(cameras);
      mostraMessaggio(
        msgCamera,
        "Fotocamere rilevate. Seleziona quella da usare.",
        "successo",
      );
    } catch (err) {
      // ScannerError porta messaggi in italiano già adatti alla UI; per
      // qualsiasi altro errore usiamo un fallback generico.
      const testo =
        err && typeof err.message === "string" && err.message !== ""
          ? err.message
          : "Impossibile rilevare le fotocamere. Riprova.";
      mostraMessaggio(msgCamera, testo, "errore");
    } finally {
      btnRileva.disabled = false;
    }
  }

  // Montaggio.
  radice.appendChild(el("h2", { text: "Impostazioni" }));
  radice.appendChild(sezionePassword);
  radice.appendChild(sezioneCamera);
  container.appendChild(radice);

  inNuova.focus();

  // Cleanup: rimuove il DOM montato dalla schermata.
  return function cleanup() {
    if (radice.parentNode) {
      radice.parentNode.removeChild(radice);
    }
  };
}

export default { mount };
