/**
 * Market Hub — Currency Signal API
 * GET /api/currency
 *
 * Returns the latest vs200_pct for UUP (USD), FXE (EUR), FXY (JPY) from D1.
 * Used by CurrencyGlanceKpis to derive live tone and card status.
 */

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: 'D1 not bound', source: 'currency' }), { headers: { ...CORS, 'Cache-Control': 'no-store' } });
    }

    const { results } = await db.prepare(
      `SELECT symbol, vs200_pct, percentile, date
       FROM indicators
       WHERE symbol IN ('UUP', 'FXE', 'FXY') AND vs200_pct IS NOT NULL
       GROUP BY symbol
       HAVING date = MAX(date)
       ORDER BY symbol`
    ).all();

    const bySymbol = {};
    for (const r of (results || [])) {
      bySymbol[r.symbol.toLowerCase()] = {
        vs200:      parseFloat(r.vs200_pct?.toFixed(2)),
        percentile: r.percentile != null ? Math.round(r.percentile) : null,
        date:       r.date,
      };
    }

    return new Response(JSON.stringify({ ...bySymbol, source: 'currency', timestamp: new Date().toISOString() }), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, source: 'currency' }), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=60' },
    });
  }
}
