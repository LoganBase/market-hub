/**
 * Market Hub — Sector Breadth History
 * GET /api/sector-breadth-history?range=5y
 *
 * Queries D1 indicators table for 11 SPDR sector ETFs and returns a daily
 * time series of how many were trading above their 200d SMA.
 */

const SECTORS = ['XLK','XLV','XLF','XLI','XLC','XLY','XLP','XLE','XLU','XLRE','XLB'];

const RANGE_DAYS = {
  '10y': 3650,
  '5y':  1825,
  '3y':  1095,
  '1y':  365,
  '6mo': 183,
  '3mo': 92,
  '1mo': 31,
  '1wk': 7,
};

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const url       = new URL(context.request.url);
  const range     = url.searchParams.get('range') || '5y';
  const days      = RANGE_DAYS[range] ?? RANGE_DAYS['5y'];
  const db        = context.env.DB;
  const startDate = startDateFor(days);

  try {
    if (!db) throw new Error('D1 not available');

    const placeholders = SECTORS.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT date,
         SUM(CASE WHEN vs200_pct > 0 THEN 1 ELSE 0 END) AS above_200,
         COUNT(*) AS total
       FROM indicators
       WHERE symbol IN (${placeholders})
         AND vs200_pct IS NOT NULL
         AND sma200 IS NOT NULL
         AND date >= ?
       GROUP BY date
       HAVING COUNT(*) >= 7
       ORDER BY date ASC`
    ).bind(...SECTORS, startDate).all();

    return new Response(JSON.stringify({
      dates:  results.map(r => r.date),
      above:  results.map(r => r.above_200),
      totals: results.map(r => r.total),
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
