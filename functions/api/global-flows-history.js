/**
 * Market Hub — Global Flows History
 * GET /api/global-flows-history?range=5y
 *
 * Returns normalized price series (rebased to 100) for:
 *   regional — ACWI + 6 regional ETFs (card-level view)
 *   countries — 19 country ETFs grouped by region (deep-dive view)
 */

const REGIONAL = [
  { sym: 'ACWI',    label: 'MSCI ACWI'    },
  { sym: 'SPY',     label: 'S&P 500'       },
  { sym: '^GSPTSE', label: 'Canada'        },
  { sym: 'FEZ',     label: 'Europe'        },
  { sym: 'AIA',     label: 'Asia'          },
  { sym: 'ILF',     label: 'LatAm'         },
  { sym: 'EEM',     label: 'Emerging'      },
];

const COUNTRIES = [
  { sym: 'SPY',     label: 'S&P 500',    group: 'North America' },
  { sym: '^GSPTSE', label: 'Canada',      group: 'North America' },
  { sym: 'EWU',     label: 'UK',          group: 'Europe'        },
  { sym: 'EWG',     label: 'Germany',     group: 'Europe'        },
  { sym: 'EWQ',     label: 'France',      group: 'Europe'        },
  { sym: 'EWL',     label: 'Switzerland', group: 'Europe'        },
  { sym: 'EWN',     label: 'Netherlands', group: 'Europe'        },
  { sym: 'EWI',     label: 'Italy',       group: 'Europe'        },
  { sym: 'EWP',     label: 'Spain',       group: 'Europe'        },
  { sym: 'EWJ',     label: 'Japan',       group: 'Asia Pacific'  },
  { sym: 'MCHI',    label: 'China',       group: 'Asia Pacific'  },
  { sym: 'EWT',     label: 'Taiwan',      group: 'Asia Pacific'  },
  { sym: 'EWY',     label: 'S. Korea',    group: 'Asia Pacific'  },
  { sym: 'INDA',    label: 'India',       group: 'Asia Pacific'  },
  { sym: 'EWA',     label: 'Australia',   group: 'Asia Pacific'  },
  { sym: 'EWH',     label: 'Hong Kong',   group: 'Asia Pacific'  },
  { sym: 'EWZ',     label: 'Brazil',      group: 'Latin America' },
  { sym: 'EWW',     label: 'Mexico',      group: 'Latin America' },
  { sym: 'ECH',     label: 'Chile',       group: 'Latin America' },
];

const RANGE_DAYS = { '10y': 3650, '5y': 1825, '3y': 1095, '1y': 365, '6mo': 182, '3mo': 91, '1mo': 31, '20d': 20, '1wk': 7 };

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function forwardFill(prices) {
  let last = null;
  return prices.map(p => { if (p != null) last = p; return last; });
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

    const allSyms = [...new Set([...REGIONAL.map(r => r.sym), ...COUNTRIES.map(c => c.sym)])];
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

    // Date spine from SPY
    const dateSet = new Set();
    const bySymbol = {};
    allSyms.forEach(s => { bySymbol[s] = {}; });

    for (const row of results) {
      if (row.symbol === 'SPY') dateSet.add(row.date);
      if (bySymbol[row.symbol]) bySymbol[row.symbol][row.date] = row.close;
    }
    const dates = [...dateSet].sort();

    const buildSeries = sym => normalize(forwardFill(dates.map(d => bySymbol[sym]?.[d] ?? null)));

    return new Response(JSON.stringify({
      dates,
      regional:  REGIONAL.map(({ sym, label }) => ({ sym, label, prices: buildSeries(sym) })),
      countries: COUNTRIES.map(({ sym, label, group }) => ({ sym, label, group, prices: buildSeries(sym) })),
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
