/**
 * Market Hub — VIX Term Structure History
 * GET /api/vix-history?range=1y
 *
 * Returns historical VIX levels for all four CBOE maturities plus the
 * VIX9D − VIX3M spread (the "shape signal" — positive = backwardation,
 * negative = contango).
 *
 * Requires ^VIX9D, ^VIX, ^VIX3M, ^VIX6M to be seeded in D1 via /api/refresh.
 */

const SYMS = [
  { sym: '^VIX9D', label: 'VIX9D', color: '#f59e0b' },
  { sym: '^VIX',   label: 'VIX',   color: '#22d3ee' },
  { sym: '^VIX3M', label: 'VIX3M', color: '#22c55e' },
  { sym: '^VIX6M', label: 'VIX6M', color: '#a855f7' },
];

const RANGE_DAYS = { '1y': 365, '3y': 1095, '5y': 1825 };
const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  const url   = new URL(context.request.url);
  const range = url.searchParams.get('range') || '1y';
  const days  = RANGE_DAYS[range] ?? RANGE_DAYS['1y'];
  const db    = context.env.DB;

  if (!db) return new Response(JSON.stringify({ error: 'D1 not available' }), { status: 500, headers: CORS });

  try {
    const start = new Date();
    start.setDate(start.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);

    const placeholders = SYMS.map(() => '?').join(',');

    // Use SPY as the date spine to get clean trading-day alignment
    const { results } = await db.prepare(`
      SELECT dp.date, dp.symbol, dp.close
      FROM daily_prices dp
      INNER JOIN (
        SELECT DISTINCT date FROM daily_prices WHERE symbol = 'SPY' AND date >= ?
      ) d ON dp.date = d.date
      WHERE dp.symbol IN (${placeholders})
      ORDER BY dp.date ASC
    `).bind(startStr, ...SYMS.map(s => s.sym)).all();

    const byDate = {};
    for (const row of results) {
      if (!byDate[row.date]) byDate[row.date] = {};
      byDate[row.date][row.symbol] = row.close;
    }
    const dates = Object.keys(byDate).sort();

    // Build one series per VIX maturity; skip maturities with no data at all
    const series = SYMS.map(({ sym, label, color }) => {
      const values = dates.map(d => byDate[d]?.[sym] ?? null);
      if (values.every(v => v == null)) return null;
      return { sym, label, color, values };
    }).filter(Boolean);

    // Spread: VIX9D − VIX3M (the shape signal)
    const v9dSeries = series.find(s => s.sym === '^VIX9D');
    const v3mSeries = series.find(s => s.sym === '^VIX3M');
    const spread = (v9dSeries && v3mSeries) ? {
      values: dates.map((_, i) => {
        const v9 = v9dSeries.values[i], v3 = v3mSeries.values[i];
        return (v9 != null && v3 != null) ? +(v9 - v3).toFixed(2) : null;
      }),
    } : null;

    return new Response(JSON.stringify({ range, dates, series, spread }), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
