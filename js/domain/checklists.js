// js/domain/checklists.js
//
// Logica di dominio PURA per la derivazione delle tre check-list operative:
//   - carenza Centro Unitario (CU)  -> mirror di check_list_carenza_cu
//   - carenza Armadi di Ripristino  -> mirror di check_list_carenza_armadi
//   - prossima scadenza per LOTTO   -> mirror di check_list_scadenza
//
// Questo modulo replica lato client, con funzioni pure sui dati di giacenza e
// anagrafica, la stessa logica delle viste Postgres del backend, così che client
// e DB concordino sempre sull'appartenenza alle liste.
//
// Mirroring delle migrazioni backend:
//   - 0010_viste_carenza.sql  -> check_list_carenza_cu, check_list_carenza_armadi
//   - 0011_vista_scadenza.sql -> check_list_scadenza (per lotto)
//
// Requisiti coperti: 11.1, 11.3, 12.1, 12.2, 13.1, 13.2, 13.3.
//
// PRINCIPIO (design.md): la fonte di verità unica sono i registri di
// movimentazione; giacenze e check-list sono DERIVATE. La rimozione di un
// elemento dalle liste è "data-driven" (giacenza vs soglia, o giacenza del lotto
// > 0), MAI guidata da spunte manuali (R11.3, R12.2, R13.3).
//
// NOTA: modulo PURO. Nessun accesso a DOM, rete o Supabase.
// Le giacenze sono calcolate riusando js/domain/giacenze.js e le date
// riusando js/domain/dates.js, per restare allineati alle rispettive viste.

import { giacenzaCu, giacenzaArmadi, giacenzaLotto } from "./giacenze.js";
import { diffGiorni } from "./dates.js";

// -----------------------------------------------------------------------------
// Helper interni
// -----------------------------------------------------------------------------

/**
 * Filtra i movimenti CU appartenenti a un singolo prodotto.
 * I movimenti possono riguardare più prodotti: le viste calcolano la giacenza
 * per `prodotto_id`, quindi qui si restringe il set prima di sommare.
 *
 * @param {Array<{prodotto_id?: string}>} movimentiCu movimenti CU (eterogenei)
 * @param {string} prodottoId id del prodotto di interesse
 * @returns {Array} sottoinsieme dei movimenti di quel prodotto
 */
function movimentiDelProdotto(movimenti, prodottoId) {
  return movimenti.filter((m) => m.prodotto_id === prodottoId);
}

// -----------------------------------------------------------------------------
// API pubblica
// -----------------------------------------------------------------------------

/**
 * Check-list di carenza del Centro Unitario.
 *
 * Mirror della vista Postgres `check_list_carenza_cu` (migrazione 0010):
 *   SELECT ... FROM prodotti p
 *   JOIN giacenza_cu g ON g.prodotto_id = p.id
 *   LEFT JOIN punti_di_prelievo pp ON pp.id = p.punto_di_prelievo_id
 *   LEFT JOIN stato_ordini_carenza_cu s ON s.prodotto_id = p.id
 *   WHERE p.attivo AND g.giacenza < p.giacenza_minima_cu;
 *
 * Semantica (R11.1): elenca i prodotti ATTIVI la cui giacenza CU è
 * STRETTAMENTE inferiore alla giacenza minima CU. Include le informazioni del
 * punto di prelievo associato (quando presente, come il LEFT JOIN) e il flag
 * `ordinato` dalla spunta "ordine effettuato". La rimozione dalla lista è
 * guidata dalla giacenza (R11.3): quando giacenza_cu >= giacenza_minima_cu il
 * prodotto non compare più, indipendentemente dalla spunta registrata.
 *
 * La giacenza è calcolata con `giacenzaCu` (mirror di giacenza_cu, 0009),
 * restringendo i movimenti al prodotto corrente.
 *
 * @param {Array<Object>} prodotti anagrafica: { id, nome, codice, attivo,
 *        giacenza_minima_cu, punto_di_prelievo_id?,
 *        punto_di_prelievo_nome? }
 * @param {Array<{prodotto_id: string, tipo: string, quantita_base: number, lotto?: string|null}>} movimentiCu
 *        movimenti del Centro Unitario (di tutti i prodotti)
 * @param {Array<{prodotto_id: string, ordinato: boolean}>} [statoOrdini=[]]
 *        stato della spunta "ordine effettuato" per prodotto
 * @returns {Array<{prodotto_id: string, nome: string, codice: string,
 *        giacenza: number, giacenza_minima_cu: number,
 *        punto_di_prelievo_id: string|null, punto_di_prelievo_nome: string|null,
 *        ordinato: boolean}>} righe della check-list, una per prodotto in carenza
 */
export function carenzaCu(prodotti = [], movimentiCu = [], statoOrdini = []) {
  // Indice dello stato ordini per prodotto (equivalente del LEFT JOIN su s).
  const ordiniPerProdotto = new Map();
  for (const s of statoOrdini) {
    ordiniPerProdotto.set(s.prodotto_id, s);
  }

  const righe = [];
  for (const p of prodotti) {
    // WHERE p.attivo: solo prodotti attivi.
    if (!p.attivo) continue;

    // JOIN giacenza_cu g ON g.prodotto_id = p.id: giacenza CU del prodotto.
    const { totale: giacenza } = giacenzaCu(movimentiDelProdotto(movimentiCu, p.id));

    // WHERE g.giacenza < p.giacenza_minima_cu: carenza stretta.
    if (!(giacenza < p.giacenza_minima_cu)) continue;

    // LEFT JOIN stato_ordini_carenza_cu s: flag `ordinato` (false se assente).
    const stato = ordiniPerProdotto.get(p.id);
    const ordinato = stato ? Boolean(stato.ordinato) : false;

    // LEFT JOIN punti_di_prelievo pp: info punto di prelievo (null se assente).
    righe.push({
      prodotto_id: p.id,
      nome: p.nome,
      codice: p.codice,
      giacenza,
      giacenza_minima_cu: p.giacenza_minima_cu,
      punto_di_prelievo_id: p.punto_di_prelievo_id ?? null,
      punto_di_prelievo_nome: p.punto_di_prelievo_nome ?? null,
      ordinato,
    });
  }
  return righe;
}

/**
 * Check-list di carenza degli Armadi di Ripristino.
 *
 * Mirror della vista Postgres `check_list_carenza_armadi` (migrazione 0010):
 *   SELECT ... FROM prodotti p
 *   JOIN giacenza_armadi g ON g.prodotto_id = p.id
 *   WHERE p.attivo AND g.giacenza < p.giacenza_minima_armadi;
 *
 * Semantica (R12.1): elenca i prodotti ATTIVI la cui giacenza negli armadi è
 * STRETTAMENTE inferiore alla giacenza minima armadi. Nessuna spunta manuale
 * (R12.2/R12.3): la vista espone solo i dati; la rimozione dalla lista avviene
 * automaticamente quando la giacenza raggiunge/supera la soglia (tipicamente per
 * il carico automatico conseguente a uno scarico CU verso gli armadi).
 *
 * La giacenza è calcolata con `giacenzaArmadi` (mirror di giacenza_armadi, 0009),
 * restringendo i movimenti al prodotto corrente.
 *
 * @param {Array<Object>} prodotti anagrafica: { id, nome, codice, attivo,
 *        giacenza_minima_armadi }
 * @param {Array<{prodotto_id: string, tipo: string, quantita_base: number}>} movimentiArmadi
 *        movimenti degli armadi (di tutti i prodotti)
 * @returns {Array<{prodotto_id: string, nome: string, codice: string,
 *        giacenza: number, giacenza_minima_armadi: number}>} righe della
 *        check-list, una per prodotto in carenza negli armadi
 */
export function carenzaArmadi(prodotti = [], movimentiArmadi = []) {
  const righe = [];
  for (const p of prodotti) {
    // WHERE p.attivo: solo prodotti attivi.
    if (!p.attivo) continue;

    // JOIN giacenza_armadi g ON g.prodotto_id = p.id: giacenza armadi del prodotto.
    const giacenza = giacenzaArmadi(movimentiDelProdotto(movimentiArmadi, p.id));

    // WHERE g.giacenza < p.giacenza_minima_armadi: carenza stretta.
    if (!(giacenza < p.giacenza_minima_armadi)) continue;

    // Nessun flag/spunta (R12.3): solo i dati, come la vista.
    righe.push({
      prodotto_id: p.id,
      nome: p.nome,
      codice: p.codice,
      giacenza,
      giacenza_minima_armadi: p.giacenza_minima_armadi,
    });
  }
  return righe;
}

/**
 * Check-list di prossima scadenza, per LOTTO.
 *
 * Mirror della vista Postgres `check_list_scadenza` (migrazione 0011):
 *   WITH carichi AS (SELECT prodotto_id, lotto, data_scadenza_effettiva,
 *                           SUM(quantita_base) AS caricata
 *                      FROM registro_movimentazioni_cu WHERE tipo = 'carico'
 *                     GROUP BY prodotto_id, lotto, data_scadenza_effettiva),
 *        scarichi AS (...)
 *   SELECT ...
 *     FROM carichi c JOIN prodotti p ON p.id = c.prodotto_id
 *     LEFT JOIN scarichi s ON s.prodotto_id = c.prodotto_id
 *       AND s.lotto IS NOT DISTINCT FROM c.lotto
 *    WHERE p.attivo
 *      AND (c.caricata - COALESCE(s.scaricata, 0)) > 0
 *      AND (c.data_scadenza_effettiva - CURRENT_DATE) < p.intervallo_allerta_scadenza;
 *
 * Semantica (R13.1): elenca, per LOTTO, i lotti dei prodotti ATTIVI con giacenza
 * residua del lotto > 0 e la cui differenza (data_scadenza_effettiva - oggi) è
 * STRETTAMENTE inferiore all'intervallo di allerta del prodotto. La granularità
 * è il LOTTO (più lotti/scadenze -> più righe). Il lotto NULL è un gruppo a sé
 * stante (null-safe), coerente con `giacenzaLotto` e con l'uso di
 * IS NOT DISTINCT FROM nella vista.
 *
 * Rimozione automatica (R13.2/R13.3): nessuna spunta; un lotto esce dalla lista
 * quando la sua giacenza residua scende a 0 per effetto degli scarichi, con
 * QUALSIASI destinazione (condizione giacenza_lotto > 0 non più soddisfatta).
 *
 * La chiave di raggruppamento del carico è (prodotto_id, lotto,
 * data_scadenza_effettiva): lotti con scadenze diverse sono righe distinte. La
 * giacenza residua del lotto è però calcolata su (prodotto_id, lotto) — gli
 * scarichi non sono vincolati a una specifica scadenza — riusando `giacenzaLotto`
 * (mirror della stessa logica della vista 0011).
 *
 * @param {Array<Object>} prodotti anagrafica: { id, nome, codice, attivo,
 *        intervallo_allerta_scadenza }
 * @param {Array<{prodotto_id: string, tipo: string, quantita_base: number,
 *        lotto?: string|null, data_scadenza_effettiva?: string}>} movimentiCu
 *        movimenti del Centro Unitario (di tutti i prodotti)
 * @param {string} oggi data odierna civile 'YYYY-MM-DD' (es. da oggiYmd())
 * @returns {Array<{prodotto_id: string, nome: string, codice: string,
 *        lotto: string|null, data_scadenza_effettiva: string,
 *        giacenza_lotto: number}>} righe della check-list, una per lotto in
 *        prossima scadenza
 */
export function scadenzaPerLotto(prodotti = [], movimentiCu = [], oggi) {
  // Indice dell'anagrafica per id, per il "JOIN prodotti p ON p.id = c.prodotto_id".
  const prodottoPerId = new Map();
  for (const p of prodotti) {
    prodottoPerId.set(p.id, p);
  }

  // CTE `carichi`: raggruppa i carichi per (prodotto_id, lotto,
  // data_scadenza_effettiva). La chiave distingue lotti con scadenze diverse.
  // Si normalizza il lotto null/undefined/"" a null (gruppo "senza lotto",
  // coerente con giacenzaLotto / IS NOT DISTINCT FROM).
  const carichi = new Map(); // chiave -> { prodotto_id, lotto, data_scadenza_effettiva }
  for (const mov of movimentiCu) {
    if (mov.tipo !== "carico") continue;
    const lottoCanonico =
      mov.lotto === undefined || mov.lotto === null || mov.lotto === ""
        ? null
        : mov.lotto;
    const scadenza = mov.data_scadenza_effettiva ?? null;
    // Chiave stabile: prodotto + lotto (con marcatore NULL) + scadenza.
    const chiaveLotto = lottoCanonico === null ? "\u0000__NULL__" : `s:${lottoCanonico}`;
    const chiave = `${mov.prodotto_id}|${chiaveLotto}|${scadenza}`;
    if (!carichi.has(chiave)) {
      carichi.set(chiave, {
        prodotto_id: mov.prodotto_id,
        lotto: lottoCanonico,
        data_scadenza_effettiva: scadenza,
      });
    }
  }

  const righe = [];
  for (const c of carichi.values()) {
    // JOIN prodotti p: il prodotto deve esistere ed essere attivo (WHERE p.attivo).
    const p = prodottoPerId.get(c.prodotto_id);
    if (!p || !p.attivo) continue;

    // data_scadenza_effettiva assente: non valutabile come scadenza, si salta.
    if (c.data_scadenza_effettiva == null) continue;

    // giacenza residua del lotto = carichi - scarichi su (prodotto_id, lotto),
    // null-safe sul lotto (mirror di giacenzaLotto / vista 0011).
    const giacenzaLottoResiduo = giacenzaLotto(movimentiCu, c.prodotto_id, c.lotto);

    // WHERE (c.caricata - COALESCE(s.scaricata, 0)) > 0: lotto non esaurito.
    if (!(giacenzaLottoResiduo > 0)) continue;

    // WHERE (c.data_scadenza_effettiva - CURRENT_DATE) < p.intervallo_allerta_scadenza:
    // differenza in giorni STRETTAMENTE inferiore alla soglia (R13.1).
    const giorniAllaScadenza = diffGiorni(c.data_scadenza_effettiva, oggi);
    if (!(giorniAllaScadenza < p.intervallo_allerta_scadenza)) continue;

    righe.push({
      prodotto_id: c.prodotto_id,
      nome: p.nome,
      codice: p.codice,
      lotto: c.lotto,
      data_scadenza_effettiva: c.data_scadenza_effettiva,
      giacenza_lotto: giacenzaLottoResiduo,
    });
  }
  return righe;
}
