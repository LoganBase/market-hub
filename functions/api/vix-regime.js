/**
 * GET /api/vix-regime
 *
 * Returns month-by-month VIX regime classification for the Equities History timeline.
 *
 * Rules (applied to daily ^VIX closes within each calendar month):
 *   ≥ 5 days with VIX ≥ 30        → bearish  (Fear)
 *   ≥ 5 days with VIX ≥ 20 < 30   → neutral  (Elevated)
 *   otherwise                       → bullish  (Calm)
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
    return new Response(JSON.stringify({ error: 'D1 binding missing' }), { status: 500, headers: CORS });
  }

  const months = parseInt(new URL(context.request.url).searchParams.get('months') || '24', 10);

  const { results } = await db.prepare(`
    WITH month_ends AS (
      SELECT strftime('%Y-%m', date) AS month, MAX(date) AS last_date
      FROM daily_prices WHERE symbol = '^VIX'
      GROUP BY strftime('%Y-%m', date)
    ),
    monthly_counts AS (
      SELECT
        strftime('%Y-%m', date) AS month,
        SUM(CASE WHEN close >= 30 THEN 1 ELSE 0 END)              AS fear_days,
        SUM(CASE WHEN close >= 20 AND close < 30 THEN 1 ELSE 0 END) AS elevated_days
      FROM daily_prices
      WHERE symbol = '^VIX'
      GROUP BY strftime('%Y-%m', date)
    )
    SELECT me.last_date, mc.fear_days, mc.elevated_days
    FROM month_ends me
    JOIN monthly_counts mc ON me.month = mc.month
    ORDER BY me.last_date DESC
    LIMIT ?
  `).bind(months).all();

  const rows = [...results].reverse();

  const dates    = rows.map(r => r.last_date);
  const statuses = rows.map(r => {
    if ((r.fear_days ?? 0) >= 5)     return 'bearish';
    if ((r.elevated_days ?? 0) >= 5) return 'neutral';
    return 'bullish';
  });

  return new Response(JSON.stringify({ dates, statuses }), {
    headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
  });
}
