/**
 * Market Hub — Sectors Deep Dive API
 * GET /api/sectors?range=5y
 *
 * Returns cumulative relative performance of cyclical vs defensive sectors.
 * Cyclicals:  XLI, XLK, XME, XLF
 * Defensives: XLU, XLRE, XLP
 *
 * Primary: Cloudflare D1. Fallback: Yahoo Finance v8 HTTP API.
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept':     'application/json',
  'Referer':    'https://finance.yahoo.com/',
};

const CYCLICALS  = ['XLK', 'XLY', 'XLC', 'XLI', 'XLF', 'XLE', 'XLB'];
const DEFENSIVES = ['XLV', 'XLP', 'XLU', 'XLRE'];
const ALL_SYMS   = [...CYCLICALS, ...DEFENSIVES];

const RANGE_MAP = {
  '10y': { range: '10y', interval: '1d', days: 3650 },
  '5y':  { range: '5y',  interval: '1d', days: 1825 },
  '1y':  { range: '1y',  interval: '1d', days: 365  },
  '6mo': { range: '6mo', interval: '1d', days: 183  },
  '3mo': { range: '3mo', interval: '1d', days: 92   },
  '1mo': { range: '1mo', interval: '1d', days: 31   },
  '20d': { range: '1mo', interval: '1d', days: 20   },
  '1wk': { range: '5d',  interval: '1d', days: 7    },
};

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fromD1(db, days) {
  const startDate = startDateFor(days);
  const placeholders = ALL_SYMS.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT symbol, date, close FROM daily_prices
     WHERE symbol IN (${placeholders}) AND date >= ?
     ORDER BY date ASC, symbol ASC`
  ).bind(...ALL_SYMS, startDate).all();
  return results || [];
}

async function fetchYF(symbol, cfg) {
  try {
    const res = await fetch(
      `${YF}/${encodeURIComponent(symbol)}?interval=${cfg.interval}&range=${cfg.range}`,
      { headers: YF_HEADERS }
    );
    if (!res.ok) return {};
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return {};
    const ts  = result.timestamp || [];
    const cls = result.indicators?.quote?.[0]?.close || [];
    const map = {};
    for (let i = 0; i < ts.length; i++) {
      if (cls[i] != null) map[new Date(ts[i] * 1000).toISOString().slice(0, 10)] = cls[i];
    }
    return map;
  } catch { return {}; }
}

function compute(rows) {
  // Group by symbol
  const maps = {};
  for (const sym of ALL_SYMS) maps[sym] = {};
  for (const row of rows) {
    if (maps[row.symbol]) maps[row.symbol][row.date] = row.close;
  }

  // Dates where at least one cyclical and one defensive have data
  const dates = Object.keys(maps[CYCLICALS[0]])
    .filter(d => DEFENSIVES.some(s => maps[s][d]))
    .sort();
  if (dates.length === 0) return null;

  // Normalize each symbol to start = 100
  const normed = {};
  for (const sym of ALL_SYMS) {
    const start = maps[sym][dates[0]];
    if (!start) { normed[sym] = {}; continue; }
    normed[sym] = {};
    for (const d of dates) {
      if (maps[sym][d]) normed[sym][d] = (maps[sym][d] / start - 1) * 100;
    }
  }

  const cycVsDef     = [];
  const cycAvgSeries = [];
  const defAvgSeries = [];
  const cycReturns   = {};
  const defReturns   = {};
  for (const sym of ALL_SYMS) cycReturns[sym] = null;

  for (const date of dates) {
    const cycVals = CYCLICALS.map(s => normed[s][date]).filter(v => v != null);
    const defVals = DEFENSIVES.map(s => normed[s][date]).filter(v => v != null);
    const cycAvg  = cycVals.length ? cycVals.reduce((a, b) => a + b, 0) / cycVals.length : null;
    const defAvg  = defVals.length ? defVals.reduce((a, b) => a + b, 0) / defVals.length : null;
    cycVsDef.push(cycAvg != null && defAvg != null ? cycAvg - defAvg : null);
    cycAvgSeries.push(cycAvg);
    defAvgSeries.push(defAvg);
  }

  // Per-symbol returns at end of period (for best/worst sector)
  for (const sym of ALL_SYMS) {
    const last = dates.findLast(d => normed[sym][d] != null);
    cycReturns[sym] = last ? normed[sym][last] : null;
  }

  // Streak: consecutive days cyclicals daily return > defensives daily return
  let streak = 0;
  for (let i = dates.length - 1; i >= 1; i--) {
    const cycD = CYCLICALS.map(s => maps[s][dates[i]] && maps[s][dates[i-1]]
      ? maps[s][dates[i]] / maps[s][dates[i-1]] - 1 : null).filter(v => v != null);
    const defD = DEFENSIVES.map(s => maps[s][dates[i]] && maps[s][dates[i-1]]
      ? maps[s][dates[i]] / maps[s][dates[i-1]] - 1 : null).filter(v => v != null);
    if (!cycD.length || !defD.length) break;
    const cycAvgD = cycD.reduce((a, b) => a + b, 0) / cycD.length;
    const defAvgD = defD.reduce((a, b) => a + b, 0) / defD.length;
    const leading = cycAvgD > defAvgD;
    if (streak === 0) { streak = leading ? 1 : -1; }
    else if (leading && streak > 0) { streak++; }
    else if (!leading && streak < 0) { streak--; }
    else break;
  }

  // Best performing cyclical sector
  const bestCyc = CYCLICALS.reduce((best, sym) =>
    (cycReturns[sym] ?? -Infinity) > (cycReturns[best] ?? -Infinity) ? sym : best
  , CYCLICALS[0]);
  const bestDef = DEFENSIVES.reduce((best, sym) =>
    (cycReturns[sym] ?? -Infinity) > (cycReturns[best] ?? -Infinity) ? sym : best
  , DEFENSIVES[0]);

  const n = cycVsDef.length;
  const current = cycVsDef[n - 1];
  return {
    dates, cycVsDef, cycAvgSeries, defAvgSeries,
    summary: {
      current,
      streak,
      cyclicalsLeading: current > 0,
      bestCyc,
      bestCycReturn: cycReturns[bestCyc],
      bestDef,
      bestDefReturn: cycReturns[bestDef],
    },
  };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const url   = new URL(context.request.url);
  const range = url.searchParams.get('range') || '5y';
  const cfg   = RANGE_MAP[range] || RANGE_MAP['5y'];
  const db    = context.env.DB;

  try {
    let rows = db ? await fromD1(db, cfg.days) : [];

    if (rows.length < 10) {
      const maps = await Promise.all(ALL_SYMS.map(s => fetchYF(s, cfg)));
      rows = [];
      const allDates = new Set(maps.flatMap(m => Object.keys(m)));
      for (const date of [...allDates].sort()) {
        ALL_SYMS.forEach((sym, i) => {
          if (maps[i][date]) rows.push({ symbol: sym, date, close: maps[i][date] });
        });
      }
    }

    const payload = compute(rows);
    if (!payload) throw new Error('Insufficient data');

    return new Response(JSON.stringify({ range, ...payload }), {
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
