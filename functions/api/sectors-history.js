/**
 * Market Hub — Sectors History
 * GET /api/sectors-history?range=5y
 *
 * Returns normalized price series (rebased to 100) for all 11 GICS sector ETFs,
 * grouped by type (cyclical / defensive). SPY used as date spine.
 */

const SECTORS = [
  { sym: 'XLK',  label: 'Technology',       type: 'cyclical'  },
  { sym: 'XLY',  label: 'Consumer Disc.',    type: 'cyclical'  },
  { sym: 'XLC',  label: 'Comm. Services',    type: 'cyclical'  },
  { sym: 'XLI',  label: 'Industrials',       type: 'cyclical'  },
  { sym: 'XLF',  label: 'Financials',        type: 'cyclical'  },
  { sym: 'XLE',  label: 'Energy',            type: 'cyclical'  },
  { sym: 'XLB',  label: 'Materials',         type: 'cyclical'  },
  { sym: 'XLV',  label: 'Health Care',       type: 'defensive' },
  { sym: 'XLP',  label: 'Consumer Staples',  type: 'defensive' },
  { sym: 'XLU',  label: 'Utilities',         type: 'defensive' },
  { sym: 'XLRE', label: 'Real Estate',       type: 'defensive' },
];

const RANGE_DAYS = { '10y': 3650, '5y': 1825, '3y': 1095, '1y': 365, '6mo': 182, '3mo': 91 };

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalize(prices) {
  const first = prices.find(p => p != null);
  if (!first) return prices;
  return prices.map(p => p != null ? Math.round((p / first) * 10000) / 100 : null);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const url      = new URL(context.request.url);
  const range    = url.searchParams.get('range') || '5y';
  const days     = RANGE_DAYS[range] ?? RANGE_DAYS['5y'];
  const startDate = startDateFor(days);
  const db       = context.env.DB;

  try {
    if (!db) throw new Error('D1 not available');

    const allSyms    = SECTORS.map(s => s.sym);
    const placeholders = allSyms.map(() => '?').join(',');

    const { results } = await db.prepare(`
      SELECT dp.date, dp.symbol, dp.close
      FROM daily_prices dp
      INNER JOIN (
        SELECT DISTINCT date FROM daily_prices WHERE symbol = 'SPY' AND date >= ?
      ) d ON dp.date = d.date
      WHERE dp.symbol IN (${placeholders})
      ORDER BY dp.date ASC
    `).bind(startDate, ...allSyms).all();

    const dateSet  = new Set();
    const bySymbol = {};
    allSyms.forEach(s => { bySymbol[s] = {}; });

    for (const row of results) {
      dateSet.add(row.date);
      if (bySymbol[row.symbol]) bySymbol[row.symbol][row.date] = row.close;
    }
    const dates = [...dateSet].sort();

    const buildSeries = sym => normalize(dates.map(d => bySymbol[sym]?.[d] ?? null));

    return new Response(JSON.stringify({
      dates,
      sectors: SECTORS.map(({ sym, label, type }) => ({ sym, label, type, prices: buildSeries(sym) })),
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
