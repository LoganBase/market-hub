/**
 * Market Hub — Historical Data API
 * GET /api/history?symbol=SPY&range=5y
 *
 * Returns daily closes, SMA200, vs200 extension, and computed analytics:
 *   - Percentile rank of current extension vs full history
 *   - Consecutive days in current extension zone
 *   - 10-day ROC of the extension itself (velocity of the move)
 *
 * Primary source: Cloudflare D1 (daily_prices JOIN indicators).
 * Fallback: Yahoo Finance v8 HTTP API (when D1 binding absent or empty).
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json',
  'Referer': 'https://finance.yahoo.com/',
};

const RANGE_MAP = {
  '20y': { range: 'max', interval: '1d', days: 7300 },
  '10y': { range: '10y', interval: '1d', days: 3650 },
  '5y':  { range: '5y',  interval: '1d', days: 1825 },
  '1y':  { range: '1y',  interval: '1d', days: 365  },
  '6mo': { range: '6mo', interval: '1d', days: 183  },
  '3mo': { range: '3mo', interval: '1d', days: 92   },
  '1mo': { range: '1mo', interval: '1d', days: 31   },
  '20d': { range: '1mo', interval: '1d', days: 20   },
  '1wk': { range: '5d',  interval: '1d', days: 7    },
};

function zoneOf(v) {
  if (v == null) return null;
  if (v > 15)  return 'extreme-bull';
  if (v > 10)  return 'extended-bull';
  if (v > 5)   return 'normal-bull';
  if (v > 0)   return 'mild-bull';
  if (v > -5)  return 'mild-bear';
  if (v > -10) return 'normal-bear';
  return 'extended-bear';
}

// ── D1 SOURCE ─────────────────────────────────────────────────────────────────
function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fromD1(db, symbol, days) {
  const startDate = startDateFor(days);
  const { results } = await db.prepare(
    `SELECT p.date, p.close, i.sma50, i.sma200, i.vs200_pct, i.roc10, i.rsi14, i.percentile
     FROM daily_prices p
     LEFT JOIN indicators i ON p.symbol = i.symbol AND p.date = i.date
     WHERE p.symbol = ? AND p.date >= ?
     ORDER BY p.date ASC`
  ).bind(symbol, startDate).all();
  return results || [];
}

// Counts consecutive days on the same side of the 200d SMA using full D1 history,
// independent of the chart range window.
async function computeRegimeDuration(db, symbol) {
  const { results } = await db.prepare(
    `SELECT vs200_pct FROM indicators WHERE symbol = ? AND vs200_pct IS NOT NULL ORDER BY date DESC LIMIT 500`
  ).bind(symbol).all();
  if (!results?.length) return 0;
  const aboveMa = results[0].vs200_pct >= 0;
  let count = 0;
  for (const row of results) {
    if ((row.vs200_pct >= 0) !== aboveMa) break;
    count++;
  }
  return count;
}

function buildFromD1Rows(symbol, range, rows, regimeDays = null) {
  const n      = rows.length;
  const dates  = rows.map(r => r.date);
  const closes = rows.map(r => r.close);
  const sma50  = rows.map(r => r.sma50     ?? null);
  const sma200 = rows.map(r => r.sma200    ?? null);
  const vs200  = rows.map(r => r.vs200_pct ?? null);
  const roc10  = rows.map(r => r.roc10     ?? null);
  const rsi14  = rows.map(r => r.rsi14     ?? null);

  const currentVs200 = vs200[n - 1];
  const currentRoc10 = roc10[n - 1];
  const percentile   = rows[n - 1]?.percentile ?? null;

  // Use full-history regime duration from dedicated query if available;
  // fall back to counting within the range window.
  let daysInZone = regimeDays ?? 0;
  if (regimeDays == null && currentVs200 != null) {
    const aboveMa = currentVs200 >= 0;
    for (let i = n - 1; i >= 0; i--) {
      if (vs200[i] == null || (vs200[i] >= 0) !== aboveMa) break;
      daysInZone++;
    }
  }

  return {
    symbol, range, dates, closes, sma50, sma200, vs200, roc10, rsi14,
    summary: {
      currentClose:  closes[n - 1],
      currentSma50:  sma50[n - 1],
      currentSma200: sma200[n - 1],
      currentVs200,
      currentRoc10,
      percentile,
      daysInZone,
      zone: zoneOf(currentVs200),
    },
  };
}

// ── MATH ──────────────────────────────────────────────────────────────────────
function calcRsi(closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0))  / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

// ── YAHOO FINANCE FALLBACK ────────────────────────────────────────────────────
async function fromYahoo(symbol, range, cfg) {
  // Always fetch at least 5y so percentile is computed against meaningful history.
  // Short-range chart requests (1mo, 1wk, etc.) will be trimmed after stats are computed.
  const fetchRange = cfg.days >= 3650 ? cfg.range : '10y';
  const res = await fetch(
    `${YF}/${encodeURIComponent(symbol)}?interval=1d&range=${fetchRange}`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No data returned for symbol');

  const timestamps = result.timestamp || [];
  const rawCloses  = result.indicators?.quote?.[0]?.close || [];

  const allPoints = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (rawCloses[i] != null) {
      allPoints.push({
        date:  new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: rawCloses[i],
      });
    }
  }

  const N          = allPoints.length;
  const allCloses  = allPoints.map(p => p.close);
  const allDates   = allPoints.map(p => p.date);

  const allSma50 = allCloses.map((_, i) => {
    if (i < 49) return null;
    return allCloses.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50;
  });
  const allSma200 = allCloses.map((_, i) => {
    if (i < 199) return null;
    return allCloses.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200;
  });
  const allVs200 = allCloses.map((c, i) => {
    if (allSma200[i] == null) return null;
    return ((c - allSma200[i]) / allSma200[i]) * 100;
  });
  const allRoc10 = allVs200.map((v, i) => {
    if (v == null || i < 10 || allVs200[i - 10] == null) return null;
    return v - allVs200[i - 10];
  });

  // Stats computed from full fetched history (always >= 5y)
  const currentVs200 = allVs200[N - 1];
  const currentRoc10 = allRoc10[N - 1];
  const validVs200   = allVs200.filter(v => v != null);
  const percentile   = currentVs200 != null && validVs200.length > 0
    ? (validVs200.filter(v => v <= currentVs200).length / validVs200.length) * 100
    : null;

  // Regime duration: consecutive days on same side of 200d SMA (binary)
  let daysInZone = 0;
  if (currentVs200 != null) {
    const aboveMa = currentVs200 >= 0;
    for (let i = N - 1; i >= 0; i--) {
      if (allVs200[i] == null || (allVs200[i] >= 0) !== aboveMa) break;
      daysInZone++;
    }
  }

  // Trim chart arrays to requested range
  const trimStart  = Math.max(0, N - cfg.days);
  const allRsi14   = calcRsi(allCloses);

  return {
    symbol, range,
    dates:  allDates.slice(trimStart),
    closes: allCloses.slice(trimStart),
    sma50:  allSma50.slice(trimStart),
    sma200: allSma200.slice(trimStart),
    vs200:  allVs200.slice(trimStart),
    roc10:  allRoc10.slice(trimStart),
    rsi14:  allRsi14.slice(trimStart),
    summary: {
      currentClose:  allCloses[N - 1],
      currentSma50:  allSma50[N - 1],
      currentSma200: allSma200[N - 1],
      currentVs200,
      currentRoc10,
      percentile,
      daysInZone,
      zone: zoneOf(currentVs200),
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

  const url    = new URL(context.request.url);
  const symbolRaw = url.searchParams.get('symbol') || 'SPY';
  const symbol = symbolRaw.toUpperCase();
  if (!/^[A-Z0-9^=.\-]{1,20}$/.test(symbol)) {
    return new Response(JSON.stringify({ error: 'Invalid symbol' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  const range  = url.searchParams.get('range')  || '5y';
  const cfg    = RANGE_MAP[range] || RANGE_MAP['5y'];
  const db     = context.env.DB;

  try {
    if (db) {
      const [rows, regimeDays] = await Promise.all([
        fromD1(db, symbol, cfg.days),
        computeRegimeDuration(db, symbol),
      ]);
      if (rows.length >= 2 && rows.some(r => r.sma200 != null)) {
        return new Response(JSON.stringify(buildFromD1Rows(symbol, range, rows, regimeDays)), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300',
          },
        });
      }
    }

    const payload = await fromYahoo(symbol, range, cfg);
    return new Response(JSON.stringify(payload), {
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
