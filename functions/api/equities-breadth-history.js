/**
 * GET /api/equities-breadth-history
 *
 * Returns month-by-month watchlist breadth: how many of the 9 names
 * were above their 200-day SMA at each month-end. Used to power the
 * Equities History regime timeline with real data instead of seeded random.
 *
 * Thresholds (mirrors Watchlist Summary — MA Position boxes):
 *   >= 7 above  → bullish
 *   5–6 above   → neutral
 *   <= 4 above  → bearish
 */

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

const SYMBOLS = ['SPY', 'IWM', 'NVDA', 'JPM', 'CAT', 'XOM', 'FCX', 'GDX', 'EEM'];

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET' } });
  }

  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'D1 binding missing' }), { status: 500, headers: CORS });
  }

  const syms   = SYMBOLS.map(() => '?').join(',');
  const months = parseInt(new URL(context.request.url).searchParams.get('months') || '24', 10);

  const { results } = await db.prepare(`
    WITH month_ends AS (
      SELECT strftime('%Y-%m', date) AS month, MAX(date) AS last_date
      FROM indicators
      WHERE symbol = 'SPY'
      GROUP BY strftime('%Y-%m', date)
    )
    SELECT
      me.month,
      me.last_date,
      COUNT(CASE WHEN i.vs200_pct > 0 THEN 1 END) AS above_200,
      COUNT(i.symbol) AS total
    FROM month_ends me
    JOIN indicators i ON i.date = me.last_date
    WHERE i.symbol IN (${syms})
    GROUP BY me.month
    ORDER BY me.month DESC
    LIMIT ?
  `).bind(...SYMBOLS, months).all();

  // Reverse to chronological order for the timeline
  const rows = [...results].reverse();

  const dates    = rows.map(r => r.last_date);
  const statuses = rows.map(r => {
    const above = r.above_200 ?? 0;
    return above >= 7 ? 'bullish' : above >= 5 ? 'neutral' : 'bearish';
  });
  const counts = rows.map(r => ({ above: r.above_200 ?? 0, total: r.total ?? 0 }));

  return new Response(JSON.stringify({ dates, statuses, counts }), { headers: CORS });
}
