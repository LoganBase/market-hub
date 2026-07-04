/**
 * Market Hub — Leadership Deep Dive API
 * GET /api/leadership?range=5y
 *
 * Returns cumulative relative performance of RSP vs SPY (breadth quality),
 * QQEW vs QQQ (tech breadth), and IVW vs IVE (growth/value style bias), plus
 * the raw close-price series for all 6 symbols (for the price history chart).
 *
 * Primary: Cloudflare D1. Fallback: Yahoo Finance v8 HTTP API.
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept':     'application/json',
  'Referer':    'https://finance.yahoo.com/',
};

const RANGE_MAP = {
  '10y': { range: '10y', interval: '1d', days: 3650 },
  '5y':  { range: '5y',  interval: '1d', days: 1825 },
  '1y':  { range: '1y',  interval: '1d', days: 365  },
  '6mo': { range: '6mo', interval: '1d', days: 183  },
  '3mo': { range: '3mo', interval: '1d', days: 92   },
  '1mo': { range: '1mo', interval: '1d', days: 31   },
  '1wk': { range: '5d',  interval: '1d', days: 7    },
};

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── D1 SOURCE ─────────────────────────────────────────────────────────────────
async function fromD1(db, days) {
  const startDate = startDateFor(days);
  const { results } = await db.prepare(
    `SELECT symbol, date, close FROM daily_prices
     WHERE symbol IN ('SPY','RSP','QQQ','QQEW','IVW','IVE') AND date >= ?
     ORDER BY date ASC, symbol ASC`
  ).bind(startDate).all();
  return results || [];
}

// ── YAHOO FINANCE FALLBACK ────────────────────────────────────────────────────
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
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    const map = {};
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        map[date] = closes[i];
      }
    }
    return map;
  } catch { return {}; }
}

// ── COMPUTE ───────────────────────────────────────────────────────────────────
function compute(rows) {
  // Group closes by symbol → date map
  const maps = { SPY: {}, RSP: {}, QQQ: {}, QQEW: {}, IVW: {}, IVE: {} };
  for (const row of rows) {
    if (maps[row.symbol]) maps[row.symbol][row.date] = row.close;
  }

  // Dates where both SPY and RSP have data
  const dates = Object.keys(maps.SPY)
    .filter(d => maps.RSP[d])
    .sort();
  if (dates.length === 0) return null;

  const spy0  = maps.SPY[dates[0]];
  const rsp0  = maps.RSP[dates[0]];
  const qqq0  = maps.QQQ[dates[0]];
  const qqew0 = maps.QQEW[dates[0]];
  const ivw0  = maps.IVW[dates[0]];
  const ive0  = maps.IVE[dates[0]];

  const rspVsSpy  = [];
  const qqewVsQqq = [];
  const ivwVsIve  = [];

  for (const date of dates) {
    const spyRet = (maps.SPY[date] / spy0 - 1) * 100;
    const rspRet = (maps.RSP[date] / rsp0 - 1) * 100;
    rspVsSpy.push(rspRet - spyRet);

    if (maps.QQQ[date] && maps.QQEW[date] && qqq0 && qqew0) {
      const qqqRet  = (maps.QQQ[date]  / qqq0  - 1) * 100;
      const qqewRet = (maps.QQEW[date] / qqew0 - 1) * 100;
      qqewVsQqq.push(qqewRet - qqqRet);
    } else {
      qqewVsQqq.push(null);
    }

    if (maps.IVW[date] && maps.IVE[date] && ivw0 && ive0) {
      const ivwRet = (maps.IVW[date] / ivw0 - 1) * 100;
      const iveRet = (maps.IVE[date] / ive0 - 1) * 100;
      ivwVsIve.push(ivwRet - iveRet);
    } else {
      ivwVsIve.push(null);
    }
  }

  // Consecutive days RSP beat/lagged SPY (daily return comparison)
  // Ties (rspDay === spyDay) are neutral — they end the streak but don't reverse it
  let streak = 0;
  for (let i = dates.length - 1; i >= 1; i--) {
    const rspDay = maps.RSP[dates[i]] / maps.RSP[dates[i - 1]] - 1;
    const spyDay = maps.SPY[dates[i]] / maps.SPY[dates[i - 1]] - 1;
    if (rspDay === spyDay) break;
    const leading = rspDay > spyDay;
    if (streak === 0) {
      streak = leading ? 1 : -1;
    } else if (leading && streak > 0) {
      streak++;
    } else if (!leading && streak < 0) {
      streak--;
    } else {
      break;
    }
  }

  const prices = {
    SPY:  dates.map(d => maps.SPY[d]  ?? null),
    RSP:  dates.map(d => maps.RSP[d]  ?? null),
    QQQ:  dates.map(d => maps.QQQ[d]  ?? null),
    QQEW: dates.map(d => maps.QQEW[d] ?? null),
    IVW:  dates.map(d => maps.IVW[d]  ?? null),
    IVE:  dates.map(d => maps.IVE[d]  ?? null),
  };

  const n = dates.length;
  return {
    dates,
    rspVsSpy,
    qqewVsQqq,
    ivwVsIve,
    prices,
    summary: {
      currentRspVsSpy:  rspVsSpy[n - 1],
      currentQqewVsQqq: qqewVsQqq[n - 1],
      currentIvwVsIve:  ivwVsIve[n - 1],
      streak,
      rspLeading: streak > 0,
    },
  };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
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
      const [spyMap, rspMap, qqqMap, qqewMap, ivwMap, iveMap] = await Promise.all([
        fetchYF('SPY',  cfg),
        fetchYF('RSP',  cfg),
        fetchYF('QQQ',  cfg),
        fetchYF('QQEW', cfg),
        fetchYF('IVW',  cfg),
        fetchYF('IVE',  cfg),
      ]);
      rows = [];
      const allDates = new Set([
        ...Object.keys(spyMap), ...Object.keys(rspMap),
        ...Object.keys(qqqMap), ...Object.keys(qqewMap),
        ...Object.keys(ivwMap), ...Object.keys(iveMap),
      ]);
      for (const date of [...allDates].sort()) {
        if (spyMap[date])  rows.push({ symbol: 'SPY',  date, close: spyMap[date] });
        if (rspMap[date])  rows.push({ symbol: 'RSP',  date, close: rspMap[date] });
        if (qqqMap[date])  rows.push({ symbol: 'QQQ',  date, close: qqqMap[date] });
        if (qqewMap[date]) rows.push({ symbol: 'QQEW', date, close: qqewMap[date] });
        if (ivwMap[date])  rows.push({ symbol: 'IVW',  date, close: ivwMap[date] });
        if (iveMap[date])  rows.push({ symbol: 'IVE',  date, close: iveMap[date] });
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
