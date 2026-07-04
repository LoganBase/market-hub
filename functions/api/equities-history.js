/**
 * Market Hub — Equities History
 * GET /api/equities-history?range=5y
 *
 * Returns normalized price series (rebased to 100) for the 10 macro watchlist names.
 * SPY used as date spine.
 */

const EQUITIES = [
  { sym: 'SPY',  label: 'S&P 500',        group: 'market'     },
  { sym: 'IWM',  label: 'Russell 2000',   group: 'risk'       },
  { sym: 'NVDA', label: 'Nvidia',         group: 'tech'       },
  { sym: 'JPM',  label: 'JPMorgan',       group: 'financials' },
  { sym: 'CAT',  label: 'Caterpillar',    group: 'capex'      },
  { sym: 'XOM',  label: 'Exxon Mobil',    group: 'energy'     },
  { sym: 'FCX',  label: 'Freeport-Mc.',   group: 'copper'     },
  { sym: 'GDX',  label: 'Gold Miners',    group: 'gold'       },
  { sym: 'EEM',  label: 'Emerging Markets', group: 'global'     },
];

const RANGE_DAYS = { '10y': 3650, '5y': 1825, '3y': 1095, '1y': 365, '6mo': 182, '3mo': 91, '1mo': 31, '20d': 20, '1wk': 7 };

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

  const url       = new URL(context.request.url);
  const range     = url.searchParams.get('range') || '5y';
  const days      = RANGE_DAYS[range] ?? RANGE_DAYS['5y'];
  const startDate = startDateFor(days);
  const db        = context.env.DB;

  try {
    if (!db) throw new Error('D1 not available');

    const allSyms      = EQUITIES.map(e => e.sym);
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
      equities: EQUITIES.map(({ sym, label, group }) => ({ sym, label, group, prices: buildSeries(sym) })),
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
