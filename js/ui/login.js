// js/ui/login.js
//
// Schermata di LOGIN (R4.1/R4.2/R4.3, R17.3).
//
// Responsabilità:
//   - presentare un form di accesso con email e password;
//   - invocare auth.login(email, password) alla sottomissione;
//   - in caso di errore mostrare il messaggio GENERICO restituito da auth.js
//     (non rivela mai quale credenziale sia errata, R4.3), via textContent;
//   - in caso di successo NON naviga direttamente: ci pensa il router, che è
//     sottoscritto a onCambioStatoAuth e su SIGNED_IN monta la home. Il
//     contesto `{ naviga }` passato dal router è comunque accettato come
//     fallback, ma la navigazione naturale avviene tramite l'evento auth.
//
// SICUREZZA / A11Y (steering)
//   - Costruzione DOM esplicita via helper `el` (_dom.js): nessun innerHTML con
//     dati dinamici (anti-XSS). I messaggi sono inseriti con textContent.
//   - Campo password con type="password"; controlli etichettati (label + for,
//     aria-label) e area messaggi con aria-live per gli screen reader.
//   - Il pulsante viene disabilitato durante la richiesta per evitare doppi
//     invii; testi tutti in italiano.
//
// Footer con la versione semantica `v{VERSION}` (unico punto di verità, R17.3).

import { VERSION } from "../version.js";
import { login as authLogin } from "../auth.js";
import { el, svuota, areaMessaggi, mostraMessaggio } from "./_dom.js";

/**
 * Monta la schermata di login nel container indicato.
 *
 * Firma compatibile sia con l'handler del router (`(container, { naviga })`)
 * sia con un uso diretto (`(container, { onNaviga })`).
 *
 * @param {HTMLElement} container nodo in cui montare il login (verrà svuotato)
 * @param {object} [ctx] contesto opzionale
 * @param {(schermata?: string) => void} [ctx.naviga] navigazione del router
 * @param {(schermata?: string) => void} [ctx.onNaviga] alias di `naviga`
 * @returns {HTMLElement} il nodo radice montato
 */
export function mount(container, { naviga, onNaviga } = {}) {
  if (!container) {
    throw new Error("mount(login): container mancante");
  }
  const vaiAllaHome = typeof naviga === "function" ? naviga : onNaviga;

  svuota(container);

  const sezione = el("section", {
    class: "login",
    attrs: { "aria-label": "Accesso" },
  });

  const titolo = el("h2", {
    class: "login-titolo",
    text: "Accedi",
  });

  // Area messaggi di errore (aria-live): riempita solo via textContent.
  const messaggio = areaMessaggi();

  // --- Campo email ---
  const idEmail = "login-email";
  const labelEmail = el("label", {
    class: "login-label",
    attrs: { for: idEmail },
    text: "Email",
  });
  const inputEmail = el("input", {
    class: "login-input",
    id: idEmail,
    type: "email",
    name: "email",
    required: true,
    autocomplete: "username",
    attrs: { "aria-label": "Email", autocapitalize: "none", spellcheck: "false" },
  });

  // --- Campo password ---
  const idPassword = "login-password";
  const labelPassword = el("label", {
    class: "login-label",
    attrs: { for: idPassword },
    text: "Password",
  });
  const inputPassword = el("input", {
    class: "login-input",
    id: idPassword,
    type: "password",
    name: "password",
    required: true,
    autocomplete: "current-password",
    attrs: { "aria-label": "Password" },
  });

  // --- Pulsante di invio ---
  const bottone = el("button", {
    class: "login-invia",
    type: "submit",
    text: "Accedi",
  });

  const form = el(
    "form",
    {
      class: "login-form",
      attrs: { novalidate: "novalidate" },
      on: {
        submit: async (ev) => {
          ev.preventDefault();

          const email = inputEmail.value;
          const password = inputPassword.value;

          // Reset eventuali messaggi precedenti.
          mostraMessaggio(messaggio, "", "info");

          // Blocca la UI durante la richiesta (anti doppio invio).
          bottone.disabled = true;
          const testoOriginale = bottone.textContent;
          bottone.textContent = "Accesso in corso…";

          try {
            const esito = await authLogin(email, password);
            if (!esito || !esito.ok) {
              // Messaggio generico (R4.3), già localizzato da auth.js.
              mostraMessaggio(
                messaggio,
                esito?.error || "Impossibile completare l'accesso. Riprova.",
                "errore",
              );
              return;
            }
            // Successo: il router reagirà a SIGNED_IN montando la home.
            // Fallback difensivo se per qualche motivo l'evento non scatta.
            if (typeof vaiAllaHome === "function") {
              vaiAllaHome();
            }
          } catch (_e) {
            mostraMessaggio(
              messaggio,
              "Impossibile completare l'accesso. Riprova.",
              "errore",
            );
          } finally {
            bottone.disabled = false;
            bottone.textContent = testoOriginale;
          }
        },
      },
    },
    [
      el("div", { class: "login-campo" }, [labelEmail, inputEmail]),
      el("div", { class: "login-campo" }, [labelPassword, inputPassword]),
      bottone,
    ],
  );

  // Footer con la versione (unico punto di verità, R17.3).
  const footer = el("footer", { class: "login-footer" }, [
    el("span", {
      class: "login-versione",
      attrs: { "data-versione": "" },
      text: `v${VERSION}`,
    }),
  ]);

  sezione.append(titolo, messaggio, form, footer);
  container.append(sezione);

  // A11y: porta il focus sul primo campo per agevolare l'inserimento.
  inputEmail.focus?.();

  return sezione;
}

export default { mount };
