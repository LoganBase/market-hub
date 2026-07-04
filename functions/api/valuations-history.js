/**
 * Market Hub — Valuations History API
 * GET /api/valuations-history?range=30y
 *
 * Returns Shiller CAPE and trailing P/E history from D1 shiller_data table
 * for charting in the Valuations deep dive.
 *
 * Ranges: 100y, 50y, 30y, 20y, 10y, 5y
 * Data source: Robert Shiller's Yale dataset, seeded via seed/seed_shiller.py
 */

const RANGE_DAYS = {
  '100y': 36500,
  '50y':  18250,
  '30y':  10950,
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
    return new Response(JSON.stringify({ error: 'D1 binding not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().slice(0, 10);

    const { results } = await db.prepare(
      `SELECT date, price, earnings, cape
       FROM shiller_data
       WHERE date >= ? AND cape IS NOT NULL
       ORDER BY date ASC`
    ).bind(startStr).all();

    if (!results?.length) {
      return new Response(JSON.stringify({ error: 'No Shiller data in D1. Run seed/seed_shiller.py first.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const n       = results.length;
    const dates   = results.map(r => r.date);
    const capes   = results.map(r => r.cape);
    const peRatios = results.map(r =>
      r.price && r.earnings && r.earnings > 0 ? Math.round((r.price / r.earnings) * 10) / 10 : null
    );

    const validCapes  = capes.filter(c => c != null);
    const currentCape = capes[n - 1];
    const avgCape     = validCapes.length
      ? Math.round((validCapes.reduce((a, b) => a + b, 0) / validCapes.length) * 10) / 10
      : null;
    const percentile  = currentCape != null && validCapes.length
      ? Math.round((validCapes.filter(c => c <= currentCape).length / validCapes.length) * 100)
      : null;

    return new Response(JSON.stringify({
      range,
      dates,
      capes,
      peRatios,
      summary: {
        currentCape,
        currentPe: peRatios[n - 1],
        avgCape,
        percentile,
        latestDate: dates[n - 1],
        totalMonths: n,
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
