// Versione semantica UNICA del progetto (unico punto di definizione).
// Da qui derivano: la versione mostrata in UI (home + footer login),
// il CACHE_NAME del service worker (cache-v{VERSION}) e il tag git vX.Y.Z.
// Ad ogni modifica funzionale: bump qui -> aggiorna CACHE_NAME -> commit -> tag -> push --follow-tags.
export const VERSION = "0.1.10";
