/**
 * Market Hub — Health Check API
 * GET /api/health
 *
 * Returns data freshness status for all symbols in D1.
 * Uses SPY as the trading-calendar anchor — the last date SPY has a row
 * IS the last expected trading day for all other symbols.
 *
 * No auth required. Safe to monitor with external uptime services.
 */

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET' } });
  }

  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ status: 'error', error: 'D1 binding missing' }), {
      status: 500, headers: CORS,
    });
  }

  // ── Trading-calendar anchor ───────────────────────────────────────────────
  // SPY trades every US market day without exception — its MAX(date) IS the
  // last expected trading day for all other symbols.
  const { results: [spy] } = await db
    .prepare('SELECT MAX(date) as data_date FROM daily_prices WHERE symbol = ?')
    .bind('SPY').all();

  const dataDate = spy?.data_date ?? null;
  if (!dataDate) {
    return new Response(JSON.stringify({ status: 'error', error: 'No SPY data in D1' }), {
      status: 500, headers: CORS,
    });
  }

  // ── Stale symbols ─────────────────────────────────────────────────────────
  // Any symbol whose most recent row is older than SPY's watermark.
  const { results: staleSymbols } = await db
    .prepare(`
      SELECT symbol, MAX(date) AS last_date
      FROM daily_prices
      GROUP BY symbol
      HAVING last_date < ?
      ORDER BY last_date, symbol
    `)
    .bind(dataDate).all();

  // ── Symbol count on the reference date ───────────────────────────────────
  const { results: [ref] } = await db
    .prepare('SELECT COUNT(DISTINCT symbol) AS total FROM daily_prices WHERE date = ?')
    .bind(dataDate).all();
  const expectedCount = ref?.total ?? 0;

  // ── Gap scan — last 30 days ───────────────────────────────────────────────
  // Dates where the symbol count dropped below the reference-date count.
  const { results: gapDates } = await db
    .prepare(`
      SELECT date, COUNT(DISTINCT symbol) AS sym_count
      FROM daily_prices
      WHERE date >= date(?, '-30 days')
      GROUP BY date
      HAVING sym_count < ?
      ORDER BY date
    `)
    .bind(dataDate, expectedCount).all();

  // ── Indicator lag ────────────────────────────────────────────────────────
  // Symbols where indicators are behind prices — compared via separate
  // aggregates (avoids a full cross-table JOIN on 400K+ rows).
  const { results: priceMax }  = await db.prepare(`SELECT symbol, MAX(date) AS last FROM daily_prices GROUP BY symbol`).all();
  const { results: indMax }    = await db.prepare(`SELECT symbol, MAX(date) AS last FROM indicators    GROUP BY symbol`).all();
  const indMap = Object.fromEntries(indMax.map(r => [r.symbol, r.last]));
  const indLag = priceMax
    .filter(r => !indMap[r.symbol] || indMap[r.symbol] < r.last)
    .map(r => ({ symbol: r.symbol, price_date: r.last, ind_date: indMap[r.symbol] ?? null }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // ── Status verdict ────────────────────────────────────────────────────────
  const status =
    staleSymbols.length === 0 && gapDates.length === 0
      ? 'ok'
      : staleSymbols.length > 0
      ? 'error'
      : 'warning';

  return new Response(JSON.stringify({
    status,
    data_date:      dataDate,
    checked_at:     new Date().toISOString(),
    summary: {
      expected_symbols: expectedCount,
      stale_count:      staleSymbols.length,
      gap_date_count:   gapDates.length,
      indicator_lag:    indLag.length,
    },
    stale_symbols:  staleSymbols,
    gap_dates:      gapDates,
    indicator_lag:  indLag,
  }, null, 2), { headers: CORS });
}
