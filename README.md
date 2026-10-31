# Centro Unitario — Frontend

Webapp **PWA statica** (HTML/CSS/JS a moduli ES, senza framework né bundler) per la
gestione del **Centro Unitario** e degli **Armadi di Ripristino**. L'app è pensata
mobile-first per gli utenti operativi, con adattamento desktop per Admin e Power-user,
ed è installabile come Progressive Web App.

Il backend (database, autenticazione, logica server-side) vive in un repository
separato basato su Supabase (Postgres + RLS + Edge Functions). Questo repository
contiene **solo** il frontend. La chiave usata dal client è esclusivamente la
**anon/publishable key** di Supabase: nessun segreto server va versionato qui.

## Requisiti

- [Node.js](https://nodejs.org/) 18, 20 o 22 (richiesto solo per eseguire i test;
  l'app a runtime è puro HTML/CSS/JS statico).

> Nota (ambiente): se il Node di sistema non è disponibile o è problematico, usare
> un gestore di versioni (nvm/fnm) o un binario dedicato. Verificare sempre
> `node --version` prima di lanciare test o build.

## Installazione dipendenze

```bash
npm install
```

## Esecuzione dei test

Runner: **Vitest** (con **fast-check** per i property test). Eseguire in modalità
single-run (non watch):

```bash
npm test          # equivalente a: npx vitest run
npm run test:watch  # modalità watch durante lo sviluppo
```

## Struttura

```
/
├── index.html              # shell PWA, <script type="module">
├── manifest.webmanifest    # PWA installabile (display standalone, icone)
├── sw.js                   # service worker (network-first, CACHE_NAME da VERSION)
├── icons/                  # (DA AGGIUNGERE) icone PWA referenziate dal manifest
├── css/
│   └── styles.css          # mobile-first + media query desktop
└── js/
    ├── version.js          # export const VERSION — UNICO punto di definizione
    ├── main.js             # entry point (bootstrap + registrazione SW)
    ├── pwa.js              # registrazione del service worker (scope da BASE_PATH)
    ├── config.js           # BASE_PATH, SUPABASE_URL, ANON_KEY, withBase()
    ├── domain/             # (task successivi) logica di dominio pura, testata
    ├── api/                # (task successivi) client → backend
    └── ui/                 # (task successivi) schermate per ruolo
```

### Icone PWA (da aggiungere)

Il `manifest.webmanifest` referenzia icone nella cartella `icons/` (via base path):

- `icons/icon-192.png` — 192×192, `purpose: any`
- `icons/icon-512.png` — 512×512, `purpose: any`
- `icons/icon-maskable-512.png` — 512×512, `purpose: maskable`

I file immagine **non sono ancora presenti**: vanno aggiunti prima del rilascio
per rendere la PWA pienamente installabile con icona. Finché mancano, il
service worker ignora senza errori i download falliti dell'app shell e l'app
resta funzionante.

### Service worker e versione (R16.5 / R17)

Il `CACHE_NAME` del service worker è derivato dalla versione
(`centro-unitario-cache-v{VERSION}`). Poiché `sw.js` non importa i moduli ES, la
versione è ripetuta come costante `APP_VERSION` in `sw.js`: ad ogni bump di
`js/version.js` va aggiornato **anche** `APP_VERSION` in `sw.js`, così la cache
vecchia viene invalidata sui client. Mantenere allineati sempre:
`js/version.js`, `package.json`, `APP_VERSION` di `sw.js` e il tag git `vX.Y.Z`.

## Versionamento e rilascio

La versione semantica è definita **in un unico punto**: `js/version.js`
(`export const VERSION = "x.y.z"`). Da lì derivano la versione mostrata in UI
(home + footer login) e il `CACHE_NAME` del service worker (`cache-v{VERSION}`).

Ad ogni modifica funzionale: fare bump di `VERSION`, aggiornare il `CACHE_NAME` del
service worker, committare, creare il tag git `vX.Y.Z` e fare push con i tag:

```bash
git push --follow-tags
```

Mantenere sempre allineati: `js/version.js`, `package.json`, `CACHE_NAME` del
service worker e tag git.

## Deploy su GitHub Pages — nota sul base path

Il sito è servito da GitHub Pages sotto il percorso `/centroUnitario_frontend/`,
**non** alla root del dominio. L'URL pubblico è:

<https://OmarB-77.github.io/centroUnitario_frontend/>

Tutti i percorsi di asset, routing e registrazione del service worker devono
quindi tenere conto di un **base path** configurato centralmente
(`js/config.js`, `BASE_PATH = "/centroUnitario_frontend/"`), evitando percorsi
assoluti hardcoded tipo `/...`.

La propagazione del deploy e la cache della CDN possono richiedere alcuni minuti:
un ritardo non indica un errore di build. Un hard refresh lato client aiuta a
vedere subito l'ultima versione.
