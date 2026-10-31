// js/ui/home.js
//
// Home filtrata per ruolo (task 13.3, R4.1, R5.2/5.3/5.4, R17.3).
//
// Mostra una home composta da:
//   - un titolo e un eventuale saluto all'utente;
//   - una griglia di pulsanti, UNO per ciascuna schermata consentita al ruolo
//     corrente (derivata da `schermatePerRuolo(ruolo)` di roles.js), ciascuno
//     che naviga alla rotta della schermata;
//   - un pulsante di disconnessione;
//   - un footer con la versione semantica (`v{VERSION}`), unico punto di verità
//     condiviso con il service worker e il tag git (R17.1/R17.3).
//
// CONFINI E SICUREZZA
//   - Il filtro per ruolo è una GUARD LATO UI: migliora l'esperienza mostrando
//     solo ciò che ha senso, ma la sicurezza reale è data dalle policy RLS lato
//     DB (vedi roles.js). Questa home non deve MAI essere l'unica barriera.
//   - Nessuna interpolazione di dati non sanificati: tutto ciò che viene dal
//     profilo utente (es. `display_name`) è inserito con `textContent`, mai con
//     `innerHTML`. La costruzione del DOM è esplicita e sicura (anti-XSS).
//
// ACCESSIBILITÀ
//   - Ogni pulsante di navigazione ha un'etichetta testuale leggibile e un
//     `aria-label` esplicito; l'icona (emoji) è marcata `aria-hidden` così da
//     non essere letta due volte dagli screen reader.
//   - Dopo il montaggio il focus viene portato sul primo pulsante azionabile,
//     per agevolare la navigazione da tastiera.
//
// Questo modulo NON conosce il router direttamente: riceve una callback
// `onNaviga(schermata)` e una `onLogout()` così da restare disaccoppiato e
// facilmente testabile. Il wiring con il router avviene in router.js / main.js.

import { VERSION } from "../version.js";
import { schermatePerRuolo, SCHERMATE } from "../roles.js";

/**
 * Etichette in italiano per ciascuna schermata, con una breve descrizione e
 * un'icona (emoji decorativa). Le chiavi sono gli identificatori di `SCHERMATE`.
 * @type {Readonly<Record<string, { titolo: string, descrizione: string, icona: string }>>}
 */
export const ETICHETTE_SCHERMATE = Object.freeze({
  [SCHERMATE.GESTIONE_UTENTI]: {
    titolo: "Gestione utenti",
    descrizione: "Crea account, assegna ruoli, elimina utenti",
    icona: "👤",
  },
  [SCHERMATE.GESTIONE_PRODOTTI]: {
    titolo: "Gestione prodotti",
    descrizione: "Anagrafica prodotti del Centro Unitario",
    icona: "📦",
  },
  [SCHERMATE.PUNTI_PRELIEVO]: {
    titolo: "Punti di prelievo",
    descrizione: "Anagrafica dei punti di prelievo per gli ordini",
    icona: "🏷️",
  },
  [SCHERMATE.ASSOCIAZIONI]: {
    titolo: "Associazioni",
    descrizione: "Anagrafica delle associazioni convenzionate",
    icona: "🤝",
  },
  [SCHERMATE.CARICO_CU]: {
    titolo: "Carico Centro Unitario",
    descrizione: "Registra il carico di materiale nel Centro Unitario",
    icona: "⬇️",
  },
  [SCHERMATE.SCARICO_CU]: {
    titolo: "Scarico Centro Unitario",
    descrizione: "Scarica materiale verso armadi, associazioni o altro",
    icona: "⬆️",
  },
  [SCHERMATE.CHECK_LIST]: {
    titolo: "Check-list",
    descrizione: "Carenze Centro Unitario e armadi, prossime scadenze",
    icona: "📋",
  },
  [SCHERMATE.SCARICO_ARMADI]: {
    titolo: "Prelievo dagli armadi",
    descrizione: "Registra un prelievo di materiale dagli armadi",
    icona: "🗄️",
  },
  [SCHERMATE.SEGNALAZIONE_ARMADI]: {
    titolo: "Segnalazione armadi",
    descrizione: "Segnala un prodotto carente negli armadi",
    icona: "⚠️",
  },
  [SCHERMATE.IMPOSTAZIONI]: {
    titolo: "Impostazioni",
    descrizione: "Cambio password e scelta fotocamera",
    icona: "⚙️",
  },
});

/**
 * Restituisce l'etichetta associata a una schermata, con un fallback robusto
 * nel caso (non previsto) di una schermata priva di etichetta dichiarata.
 * @param {string} schermata identificatore di `SCHERMATE`
 * @returns {{ titolo: string, descrizione: string, icona: string }}
 */
export function etichettaSchermata(schermata) {
  return (
    ETICHETTE_SCHERMATE[schermata] ?? {
      titolo: String(schermata ?? "Schermata"),
      descrizione: "",
      icona: "•",
    }
  );
}

/**
 * Costruisce (in modo sicuro, solo via DOM API) il pulsante di navigazione per
 * una singola schermata consentita.
 * @param {string} schermata identificatore di `SCHERMATE`
 * @param {(schermata: string) => void} onNaviga callback di navigazione
 * @returns {HTMLButtonElement}
 */
function creaPulsanteSchermata(schermata, onNaviga) {
  const { titolo, descrizione, icona } = etichettaSchermata(schermata);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "home-tasto";
  btn.dataset.schermata = schermata;
  // L'etichetta accessibile coincide con il titolo leggibile della schermata.
  btn.setAttribute("aria-label", titolo);

  // Icona decorativa: nascosta agli screen reader per non duplicare la lettura.
  const spanIcona = document.createElement("span");
  spanIcona.className = "home-tasto__icona";
  spanIcona.setAttribute("aria-hidden", "true");
  spanIcona.textContent = icona;

  const spanTitolo = document.createElement("span");
  spanTitolo.className = "home-tasto__titolo";
  spanTitolo.textContent = titolo;

  btn.append(spanIcona, spanTitolo);

  if (descrizione) {
    const spanDesc = document.createElement("span");
    spanDesc.className = "home-tasto__descrizione";
    spanDesc.textContent = descrizione;
    btn.append(spanDesc);
  }

  btn.addEventListener("click", () => {
    if (typeof onNaviga === "function") {
      onNaviga(schermata);
    }
  });

  return btn;
}

/**
 * Monta la home filtrata per ruolo nel container indicato.
 *
 * @param {HTMLElement} container nodo in cui montare la home (verrà svuotato)
 * @param {object} opzioni
 * @param {string} opzioni.ruolo ruolo corrente ('admin' | 'power_user' | 'user')
 * @param {string|null} [opzioni.displayName] nome da mostrare nel saluto (opzionale)
 * @param {(schermata: string) => void} [opzioni.onNaviga] callback invocata alla
 *   selezione di una schermata; riceve l'identificatore di `SCHERMATE`
 * @param {() => void} [opzioni.onLogout] callback invocata al click su "Esci"
 * @returns {HTMLElement} il nodo radice della home montata
 */
export function mount(container, { ruolo, displayName = null, onNaviga, onLogout } = {}) {
  if (!container) {
    throw new Error("mount(home): container mancante");
  }

  // Svuota il container in modo sicuro (nessun innerHTML).
  container.replaceChildren();

  const radice = document.createElement("section");
  radice.className = "home";
  radice.setAttribute("aria-label", "Home");

  // Intestazione con titolo ed eventuale saluto (display_name via textContent).
  const intestazione = document.createElement("div");
  intestazione.className = "home-intestazione";

  const titolo = document.createElement("h2");
  titolo.className = "home-titolo";
  titolo.textContent = "Operazioni disponibili";
  intestazione.append(titolo);

  if (displayName) {
    const saluto = document.createElement("p");
    saluto.className = "home-saluto";
    saluto.textContent = `Ciao, ${displayName}`;
    intestazione.append(saluto);
  }

  radice.append(intestazione);

  // Griglia dei tasti consentiti per il ruolo.
  const schermate = schermatePerRuolo(ruolo);

  const griglia = document.createElement("div");
  griglia.className = "home-griglia";
  griglia.setAttribute("role", "list");

  if (schermate.length === 0) {
    // Ruolo non valido / nessuna schermata consentita: messaggio esplicito.
    const vuoto = document.createElement("p");
    vuoto.className = "home-vuoto";
    vuoto.textContent =
      "Nessuna operazione disponibile per il tuo profilo.";
    griglia.append(vuoto);
  } else {
    for (const schermata of schermate) {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("role", "listitem");
      wrapper.append(creaPulsanteSchermata(schermata, onNaviga));
      griglia.append(wrapper);
    }
  }

  radice.append(griglia);

  // Pulsante di disconnessione.
  const barraAzioni = document.createElement("div");
  barraAzioni.className = "home-azioni";

  const btnLogout = document.createElement("button");
  btnLogout.type = "button";
  btnLogout.className = "home-logout";
  btnLogout.textContent = "Esci";
  btnLogout.setAttribute("aria-label", "Esci e disconnetti");
  btnLogout.addEventListener("click", () => {
    if (typeof onLogout === "function") {
      onLogout();
    }
  });
  barraAzioni.append(btnLogout);
  radice.append(barraAzioni);

  // Footer con la versione (unico punto di verità, R17.3).
  const footer = document.createElement("footer");
  footer.className = "home-footer";
  const versione = document.createElement("span");
  versione.className = "home-versione";
  versione.setAttribute("data-versione", "");
  versione.textContent = `v${VERSION}`;
  footer.append(versione);
  radice.append(footer);

  container.append(radice);

  // Accessibilità: porta il focus sul primo elemento azionabile (primo tasto,
  // altrimenti il pulsante di logout) così la navigazione da tastiera parte da qui.
  const primoTasto = griglia.querySelector("button.home-tasto");
  (primoTasto ?? btnLogout).focus?.();

  return radice;
}

export default { mount, etichettaSchermata, ETICHETTE_SCHERMATE };
