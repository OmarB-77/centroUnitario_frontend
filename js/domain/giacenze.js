// js/domain/giacenze.js
//
// Modello di dominio PURO delle giacenze (Centro Unitario e Armadi di Ripristino).
//
// Scopo: replicare lato client, con riduzioni pure sui movimenti, la stessa
// logica delle viste Postgres del backend, così che client e DB concordino
// sempre sul calcolo delle giacenze. Questo modulo è la "fonte di riferimento"
// JS delle viste (model-based testing) e alimenta la UI (es. selezione lotto in
// scarico, giacenza armadi visibile in prelievo).
//
// Mirroring delle migrazioni backend:
//   - 0009_viste_giacenza.sql  -> giacenza_cu, giacenza_armadi
//   - 0011_vista_scadenza.sql  -> giacenza residua per LOTTO (carichi - scarichi),
//                                 con confronto del lotto null-safe (IS NOT DISTINCT FROM).
//
// Principio (design.md, R10.5): la fonte di verità unica sono i registri di
// movimentazione (append-only). Le giacenze sono SOMME ALGEBRICHE derivate, mai
// uno stato memorizzato a parte. Una lista vuota di movimenti dà giacenza 0
// (R10.4): i prodotti senza movimenti risultano quindi a giacenza 0.
//
// Forma dei movimenti attesi (campi come nel registro Postgres):
//   movimento CU:     { prodotto_id, tipo: 'carico' | 'scarico', quantita_base, lotto }
//   movimento armadi: { prodotto_id, tipo: 'carico_automatico' | 'prelievo' | 'segnalazione', quantita_base }
//
// NOTA: modulo PURO. Nessun accesso al DOM, alla rete o a Supabase.
// Convenzioni: `quantita_base` è già in unità base (la conversione avviene in
// js/domain/units.js al momento del carico).

// -----------------------------------------------------------------------------
// Helper interni
// -----------------------------------------------------------------------------

/**
 * Normalizza una quantità in unità base a numero intero sicuro.
 * I movimenti di sola segnalazione possono avere quantita_base null/0: trattati
 * come 0 (non alterano la giacenza), coerentemente con il CHECK del backend.
 *
 * @param {unknown} q valore grezzo di quantita_base
 * @returns {number} quantità numerica (0 se null/undefined/NaN)
 */
function quantita(q) {
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Segno algebrico di un movimento CU sulla giacenza del Centro Unitario.
 * Mirror di giacenza_cu (0009): carico -> +, qualunque altro tipo (scarico) -> -.
 * Coerente con lo SQL `CASE WHEN tipo = 'carico' THEN + ELSE - END`.
 *
 * @param {{tipo: string}} mov movimento CU
 * @returns {number} contributo con segno alla giacenza CU
 */
function contributoCu(mov) {
  return mov.tipo === "carico" ? quantita(mov.quantita_base) : -quantita(mov.quantita_base);
}

/**
 * Segno algebrico di un movimento armadi sulla giacenza degli armadi.
 * Mirror di giacenza_armadi (0009): carico_automatico -> +, prelievo -> -,
 * segnalazione (o altro) -> 0 (non altera la giacenza).
 *
 * @param {{tipo: string}} mov movimento armadi
 * @returns {number} contributo con segno alla giacenza armadi
 */
function contributoArmadi(mov) {
  if (mov.tipo === "carico_automatico") return quantita(mov.quantita_base);
  if (mov.tipo === "prelievo") return -quantita(mov.quantita_base);
  return 0; // segnalazione o tipo ignoto: nessun effetto sulla giacenza
}

/**
 * Chiave di raggruppamento per lotto, null-safe.
 * Replica la semantica di `IS NOT DISTINCT FROM` di Postgres: il lotto NULL è un
 * gruppo a sé stante e NULL corrisponde solo a NULL. Normalizza null/undefined/""
 * (stringa vuota) al medesimo gruppo "senza lotto", così da non frammentarlo.
 *
 * @param {unknown} lotto valore del campo lotto
 * @returns {string} chiave stabile per Map (gruppo distinto per il lotto NULL)
 */
function chiaveLotto(lotto) {
  if (lotto === null || lotto === undefined || lotto === "") return "\u0000__NULL__";
  return `s:${String(lotto)}`;
}

/**
 * Confronto di due valori di lotto con semantica null-safe (IS NOT DISTINCT FROM):
 * NULL == NULL -> true; NULL == "x" -> false; "x" == "x" -> true. Stringa vuota,
 * null e undefined sono trattati come "nessun lotto" (equivalenti tra loro).
 *
 * @param {unknown} a primo lotto
 * @param {unknown} b secondo lotto
 * @returns {boolean} true se i due lotti coincidono (null-safe)
 */
function lottiUguali(a, b) {
  return chiaveLotto(a) === chiaveLotto(b);
}

// -----------------------------------------------------------------------------
// API pubblica
// -----------------------------------------------------------------------------

/**
 * Giacenza del Centro Unitario a partire dai movimenti CU di UN prodotto.
 *
 * Mirror della vista Postgres `giacenza_cu` (migrazione 0009): somma algebrica
 * con `carico` positivo e `scarico` negativo. Fornisce sia il totale sia la
 * ripartizione per lotto (necessaria alla selezione del lotto in fase di
 * scarico). Una lista vuota -> totale 0 e nessun lotto (R10.1, R10.2, R10.4).
 *
 * @param {Array<{prodotto_id?: string, tipo: string, quantita_base: number, lotto?: string|null}>} [movimentiCu=[]]
 *        movimenti del Centro Unitario (idealmente di un singolo prodotto)
 * @returns {{ totale: number, perLotto: Array<{lotto: string|null, giacenza: number}> }}
 *          totale = somma algebrica; perLotto = giacenza residua per ciascun lotto
 */
export function giacenzaCu(movimentiCu = []) {
  const perLottoMap = new Map(); // chiaveLotto -> { lotto, giacenza }
  let totale = 0;

  for (const mov of movimentiCu) {
    const contributo = contributoCu(mov);
    totale += contributo;

    const chiave = chiaveLotto(mov.lotto);
    const esistente = perLottoMap.get(chiave);
    if (esistente) {
      esistente.giacenza += contributo;
    } else {
      // Conserva il valore di lotto "canonico": null per il gruppo senza lotto.
      const lottoCanonico =
        mov.lotto === undefined || mov.lotto === "" ? null : mov.lotto ?? null;
      perLottoMap.set(chiave, { lotto: lottoCanonico, giacenza: contributo });
    }
  }

  return { totale, perLotto: Array.from(perLottoMap.values()) };
}

/**
 * Giacenza degli armadi di ripristino a partire dai movimenti armadi di UN prodotto.
 *
 * Mirror della vista Postgres `giacenza_armadi` (migrazione 0009):
 * carico_automatico (+), prelievo (-), segnalazione (0). Gli armadi non hanno
 * giacenza per lotto: solo il totale. Lista vuota -> 0 (R10.3, R10.4).
 *
 * @param {Array<{prodotto_id?: string, tipo: string, quantita_base: number}>} [movimentiArmadi=[]]
 *        movimenti degli armadi (idealmente di un singolo prodotto)
 * @returns {number} giacenza totale degli armadi per il prodotto
 */
export function giacenzaArmadi(movimentiArmadi = []) {
  let totale = 0;
  for (const mov of movimentiArmadi) {
    totale += contributoArmadi(mov);
  }
  return totale;
}

/**
 * Giacenza residua di un singolo LOTTO di un prodotto nel Centro Unitario.
 *
 * Serve alla selezione del lotto in fase di scarico (R8.x): per il lotto scelto
 * la giacenza residua è `carichi - scarichi` dei movimenti di quel prodotto e di
 * quel lotto. Mirror della logica di `check_list_scadenza` (migrazione 0011),
 * dove il confronto sul lotto è null-safe (`IS NOT DISTINCT FROM`).
 *
 * @param {Array<{prodotto_id?: string, tipo: string, quantita_base: number, lotto?: string|null}>} movimentiCu
 *        movimenti CU (possono riguardare più prodotti/lotti: vengono filtrati)
 * @param {string} prodottoId id del prodotto di interesse
 * @param {string|null} lotto lotto di interesse (null = lotto "senza lotto")
 * @returns {number} giacenza residua del lotto (carichi - scarichi), può essere 0
 */
export function giacenzaLotto(movimentiCu = [], prodottoId, lotto) {
  let residuo = 0;
  for (const mov of movimentiCu) {
    if (mov.prodotto_id !== prodottoId) continue;
    if (!lottiUguali(mov.lotto, lotto)) continue;
    residuo += contributoCu(mov);
  }
  return residuo;
}
