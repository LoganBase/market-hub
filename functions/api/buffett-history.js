/**
 * Market Hub — Buffett Indicator History API
 * GET /api/buffett-history?range=30y
 *
 * Returns quarterly US Market Cap / GDP ratio from D1 buffett_data table.
 * Data source: FRED NCBEILQ027S (nonfinancial equities) + GDP, seeded via seed/seed_buffett.py
 *
 * Note: ratio is nonfinancial equities only — runs ~20-30pp below commonly cited
 * Buffett Indicator values which include financial-sector equities.
 *
 * Ranges: all, 30y, 20y, 10y, 5y
 */

const RANGE_DAYS = {
  all:   36500,
  '30y': 10950,
  '20y':  7300,
  '10y':  3650,
  '5y':   1825,
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const url   = new URL(context.request.url);
  const range = url.searchParams.get('range') || '30y';
  const days  = RANGE_DAYS[range] ?? RANGE_DAYS['30y'];
  const db    = context.env.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: 'D1 not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr  = startDate.toISOString().slice(0, 10);

    const { results } = await db.prepare(
      `SELECT date, ratio FROM buffett_data WHERE date >= ? ORDER BY date ASC`
    ).bind(startStr).all();

    if (!results?.length) {
      return new Response(JSON.stringify({ error: 'No data. Run seed/seed_buffett.py first.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const n      = results.length;
    const dates  = results.map(r => r.date);
    const ratios = results.map(r => r.ratio);
    const valid  = ratios.filter(r => r != null);
    const current = ratios[n - 1];
    const avg    = valid.length
      ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
      : null;
    const percentile = current != null && valid.length
      ? Math.round((valid.filter(r => r <= current).length / valid.length) * 100)
      : null;

    return new Response(JSON.stringify({
      range,
      dates,
      ratios,
      summary: {
        current,
        avg,
        percentile,
        latestDate: dates[n - 1],
        quarters:   n,
      },
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
