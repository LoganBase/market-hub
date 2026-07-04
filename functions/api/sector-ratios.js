/**
 * Market Hub — Sector Cycle Ratio Charts
 * GET /api/sector-ratios?range=1y
 *
 * Returns 4 ratio series (each rebased to 100) for cycle-signal pairs.
 * All symbols are already stored in D1 daily_prices via /api/refresh.
 *
 * Pairs:
 *   XLY / XLP  — Consumer Disc. vs Staples  (risk appetite / economic cycle)
 *   XLE / XLK  — Energy vs Technology       (inflation vs growth cycle)
 *   XLF / XLU  — Financials vs Utilities    (rate sensitivity / regime)
 *   USCI / QQQ — Commodities vs Nasdaq      (macro cycle timing)
 */

const PAIRS = [
  {
    id: 'xly_xlp', num: 'XLY', den: 'XLP',
    title: 'XLY / XLP', label: 'Consumer Disc. / Staples',
    rising: 'Expansion — risk appetite building, mid-cycle',
    falling: 'Contraction — defensive rotation, risk-off',
  },
  {
    id: 'xle_xlk', num: 'XLE', den: 'XLK',
    title: 'XLE / XLK', label: 'Energy / Technology',
    rising: 'Late cycle — inflation bid, real assets lead',
    falling: 'Early cycle — disinflation, tech/growth regime',
  },
  {
    id: 'xlf_xlu', num: 'XLF', den: 'XLU',
    title: 'XLF / XLU', label: 'Financials / Utilities',
    rising: 'Rising rates — growth regime, banks bid',
    falling: 'Falling rates — safety bid, risk-off',
  },
  {
    id: 'usci_qqq', num: 'USCI', den: 'QQQ',
    title: 'USCI / QQQ', label: 'Commodities / Nasdaq',
    rising: 'Late-cycle — commodity super-cycle, inflation regime',
    falling: 'Tech/growth dominance — disinflation, early cycle',
  },
];

const RANGE_DAYS = { '1y': 365, '3y': 1095, '5y': 1825, '10y': 3650 };

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
    const allSyms = [...new Set(PAIRS.flatMap(p => [p.num, p.den]))];

    const start = new Date();
    start.setDate(start.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);

    const placeholders = allSyms.map(() => '?').join(',');
    const { results } = await db.prepare(`
      SELECT dp.date, dp.symbol, dp.close
      FROM daily_prices dp
      INNER JOIN (
        SELECT DISTINCT date FROM daily_prices WHERE symbol = 'SPY' AND date >= ?
      ) d ON dp.date = d.date
      WHERE dp.symbol IN (${placeholders})
      ORDER BY dp.date ASC
    `).bind(startStr, ...allSyms).all();

    const byDate = {};
    for (const row of results) {
      if (!byDate[row.date]) byDate[row.date] = {};
      byDate[row.date][row.symbol] = row.close;
    }
    const dates = Object.keys(byDate).sort();

    const pairs = PAIRS.map(pair => {
      const raw = dates.map(d => {
        const n = byDate[d]?.[pair.num];
        const dn = byDate[d]?.[pair.den];
        return (n != null && dn != null && dn !== 0) ? n / dn : null;
      });

      const base = raw.find(v => v != null);
      const values = base ? raw.map(v => v != null ? +((v / base) * 100).toFixed(3) : null) : raw;

      // 20-day slope for trend direction
      const recent = values.filter(v => v != null).slice(-20);
      const change = recent.length >= 5 ? recent[recent.length - 1] - recent[0] : 0;
      const trend  = change > 1 ? 'up' : change < -1 ? 'down' : 'flat';

      const current = values.filter(v => v != null).at(-1) ?? null;

      return { id: pair.id, title: pair.title, label: pair.label, rising: pair.rising, falling: pair.falling, values, trend, current };
    });

    return new Response(JSON.stringify({ range, dates, pairs }), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
