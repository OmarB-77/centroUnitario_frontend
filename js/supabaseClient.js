// Client Supabase (singleton) usato da tutto il frontend.
//
// Perché import ESM da CDN e non da node_modules/bundler?
//   Il progetto è una webapp statica (HTML/CSS/JS a moduli ES) ospitata su
//   GitHub Pages, SENZA bundler né step di build. Importare la build ESM di
//   supabase-js direttamente da CDN (esm.sh) è coerente con questo vincolo:
//   nessuna toolchain, il browser carica il modulo così com'è.
//
//   VERSIONE PINNATA ESATTA (2.45.4) — non usare "@2".
//   Motivo: su esm.sh le build recenti di supabase-js (>= 2.57) iniettano uno
//   shim Node (/node/process.mjs e affini) che viene valutato al top-level del
//   modulo e, nel browser su GitHub Pages, faceva fallire l'avvio (eccezione in
//   fase di import, schermata "Errore di avvio"). La 2.45.4 ha una catena di
//   dipendenze pulita, senza shim node top-level, ed è stabile per browser.
//   Se si aggiorna, verificare che l'header esm.sh NON contenga "/node/process.mjs".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Singleton del client Supabase, costruito con URL progetto + anon key (chiave pubblica).
// La sicurezza reale è garantita dalle policy RLS lato DB, non da questa chiave.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Mantiene la sessione tra i reload (localStorage) — utile per la PWA.
    persistSession: true,
    // Rinnova automaticamente il token prima della scadenza.
    autoRefreshToken: true,
    // Chiave di storage dedicata all'app, per non collidere con altri progetti
    // serviti dallo stesso dominio *.github.io.
    storageKey: "centro-unitario-auth",
    // Nessun parsing dell'URL: usiamo routing hash-based, non redirect OAuth.
    detectSessionInUrl: false,
  },
});

export default supabase;
