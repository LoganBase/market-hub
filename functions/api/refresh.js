/**
 * Market Hub — Delta Refresh API
 * GET /api/refresh
 *
 * For each symbol, checks the last date stored in D1 and fetches only
 * the missing trading days from Yahoo Finance. Inserts new price rows
 * and recomputes indicators. Typically adds 1-2 rows per symbol per day.
 *
 * Requires D1 binding: variable name "DB" → market-hub-db
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept':     'application/json',
  'Referer':    'https://finance.yahoo.com/',
};

const ALL_SYMBOLS = [
  // Regime + Leadership
  'SPY', 'QQQ', 'RSP', 'QQEW', 'IVW', 'IVE',
  // Breadth
  'RSPD',
  // Yield + Currency
  '^TYX', '^TNX', '^IRX', 'SHY', 'UUP', 'FXE', 'FXY',
  // Credit
  'HYG', 'LQD', 'EMB',
  // Global Flows — regional
  'ACWI', 'FEZ', 'AIA', 'ILF', 'EEM',
  // Global Flows — countries
  '^GSPTSE',
  'EWU', 'EWG', 'EWQ', 'EWL', 'EWN', 'EWI', 'EWP',
  'EWJ', 'MCHI', 'EWT', 'EWY', 'INDA', 'EWA', 'EWH',
  'EWW', 'EWZ', 'ECH',
  // Sectors
  'XLI', 'XLK', 'XLF', 'XLE', 'XLU', 'XLRE', 'XLP',
  'XLV', 'XLC', 'XLY', 'XLB',
  'XME', 'GDX', 'COPX', 'KBE',
  // Commodities
  'USCI', 'CPER', 'GLD', 'SLV', 'IXC', 'DBA', 'SLX', 'URA',
  // Equities
  'IWM', 'NVDA', 'JPM', 'CAT', 'XOM', 'FCX', 'CCJ',
  // VIX term structure
  '^VIX9D', '^VIX', '^VIX3M', '^VIX6M',
  // Extended — deep-dive / supplemental
  'SOXX', 'LRCX', 'SITM',
  'AEM',
  'GRID', 'GEV',
  'RIO', 'SU',
];

// ── MATH ──────────────────────────────────────────────────────────────────────
function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al += -d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0))  / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

// ── D1 HELPERS ────────────────────────────────────────────────────────────────
function query(db, sql, params = []) {
  return params.length
    ? db.prepare(sql).bind(...params).all()
    : db.prepare(sql).all();
}

function run(db, sql, params = []) {
  return params.length
    ? db.prepare(sql).bind(...params).run()
    : db.prepare(sql).run();
}

// ── FULL BACKFILL FOR NEVER-SEEDED SYMBOLS ───────────────────────────────────
// Uses db.batch() to bulk-insert in chunks of 100, keeping total subrequests
// well under Cloudflare's per-invocation limit even for 3,000+ row histories.
// Percentile is skipped (null) — scores.js computes it dynamically at query time.
async function refreshSymbolFull(db, symbol) {
  const res = await fetch(
    `${YF}/${encodeURIComponent(symbol)}?interval=1d&range=5y`,
    { headers: YF_HEADERS }
  );
  if (!res.ok) return { symbol, added: 0, status: `Yahoo ${res.status}` };

  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result)  return { symbol, added: 0, status: 'no data' };

  const timestamps = result.timestamp || [];
  const q          = result.indicators?.quote?.[0] || {};

  const allRows = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (q.close?.[i] == null) continue;
    allRows.push({
      date:   new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open:   q.open?.[i]   ?? null,
      high:   q.high?.[i]   ?? null,
      low:    q.low?.[i]    ?? null,
      close:  q.close[i],
      volume: q.volume?.[i] ?? null,
    });
  }

  if (allRows.length === 0) return { symbol, added: 0, status: 'no data' };

  // Bulk-insert prices in chunks to stay within D1 batch statement limits
  const CHUNK = 100;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    await db.batch(allRows.slice(i, i + CHUNK).map(row =>
      db.prepare('INSERT OR REPLACE INTO daily_prices (symbol,date,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)')
        .bind(symbol, row.date, row.open, row.high, row.low, row.close, row.volume)
    ));
  }

  // Compute all indicators in memory — no per-row D1 queries needed
  const closes  = allRows.map(r => r.close);
  const dates   = allRows.map(r => r.date);
  const n       = closes.length;
  const indRows = [];

  for (let i = 14; i < n; i++) {
    const price  = closes[i];
    const sma50  = i >= 49  ? closes.slice(i - 49,  i + 1).reduce((a, b) => a + b, 0) / 50  : null;
    const sma200 = i >= 199 ? closes.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200 : null;
    const vs200  = sma200 ? ((price - sma200) / sma200) * 100 : null;
    const rsi14  = rsi(closes.slice(0, i + 1), 14);
    const roc10  = i >= 10 ? ((price / closes[i - 10]) - 1) * 100 : null;
    indRows.push([symbol, dates[i], sma50, sma200, rsi14, roc10, vs200, null]);
  }

  for (let i = 0; i < indRows.length; i += CHUNK) {
    await db.batch(indRows.slice(i, i + CHUNK).map(row =>
      db.prepare('INSERT OR REPLACE INTO indicators (symbol,date,sma50,sma200,rsi14,roc10,vs200_pct,percentile) VALUES (?,?,?,?,?,?,?,?)')
        .bind(...row)
    ));
  }

  return { symbol, added: allRows.length, status: 'full backfill' };
}

// ── REFRESH ONE SYMBOL ────────────────────────────────────────────────────────
async function refreshSymbol(db, symbol) {
  // Find the last date we have for this symbol
  const { results: lastRes } = await query(db,
    'SELECT MAX(date) as last_date FROM daily_prices WHERE symbol = ?', [symbol]
  );
  const lastDate = lastRes?.[0]?.last_date ?? null;
  const today    = new Date().toISOString().slice(0, 10);

  if (lastDate === today) return { symbol, added: 0, status: 'up to date' };

  // Use a wider window when stale (>5 days behind) to catch up
  if (!lastDate) return refreshSymbolFull(db, symbol);

  const daysSinceLast = Math.ceil((Date.now() - new Date(lastDate).getTime()) / 86400000);
  const fetchRange = daysSinceLast > 5 ? '1mo' : '5d';

  const res = await fetch(
    `${YF}/${encodeURIComponent(symbol)}?interval=1d&range=${fetchRange}`,
    { headers: YF_HEADERS }
  );
  if (!res.ok) return { symbol, added: 0, status: `Yahoo ${res.status}` };

  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result)  return { symbol, added: 0, status: 'no data' };

  const timestamps = result.timestamp || [];
  const q          = result.indicators?.quote?.[0] || {};

  // Filter to only dates newer than what we have in D1
  const newRows = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (q.close?.[i] == null) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (!lastDate || date > lastDate) {
      newRows.push({
        date,
        open:   q.open?.[i]   ?? null,
        high:   q.high?.[i]   ?? null,
        low:    q.low?.[i]    ?? null,
        close:  q.close[i],
        volume: q.volume?.[i] ?? null,
      });
    }
  }

  if (newRows.length === 0) return { symbol, added: 0, status: 'no new dates' };

  // Insert new price rows
  for (const row of newRows) {
    await run(db,
      'INSERT OR REPLACE INTO daily_prices (symbol,date,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)',
      [symbol, row.date, row.open, row.high, row.low, row.close, row.volume]
    );
  }

  // Fetch last 500 rows for indicator context (200 for SMA200 + ample buffer for gaps and RSI convergence)
  const { results: ctx } = await query(db,
    'SELECT date, close FROM daily_prices WHERE symbol = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 500',
    [symbol]
  );
  const ctxRows   = ctx.reverse(); // oldest first
  const ctxDates  = ctxRows.map(r => r.date);
  const ctxCloses = ctxRows.map(r => r.close);
  const n         = ctxCloses.length;
  const newDates  = new Set(newRows.map(r => r.date));

  for (let i = 14; i < n; i++) {
    if (!newDates.has(ctxDates[i])) continue;

    const price    = ctxCloses[i];
    const sma50    = i >= 49  ? ctxCloses.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50  : null;
    const sma200   = i >= 199 ? ctxCloses.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200 : null;
    const vs200    = sma200 ? ((price - sma200) / sma200) * 100 : null;
    const rsi14    = rsi(ctxCloses.slice(0, i + 1), 14);
    const roc10    = i >= 10 ? ((price / ctxCloses[i - 10]) - 1) * 100 : null;

    // Percentile rank: count rows in D1 where vs200_pct <= current
    let percentile = null;
    if (vs200 != null) {
      const { results: pr } = await query(db,
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN vs200_pct <= ? THEN 1 ELSE 0 END) as below_eq
         FROM indicators WHERE symbol = ?`,
        [vs200, symbol]
      );
      const row = pr?.[0];
      if (row?.total > 0) percentile = (row.below_eq / row.total) * 100;
    }

    await run(db,
      `INSERT OR REPLACE INTO indicators
       (symbol,date,sma50,sma200,rsi14,roc10,vs200_pct,percentile)
       VALUES (?,?,?,?,?,?,?,?)`,
      [symbol, ctxDates[i], sma50, sma200, rsi14, roc10, vs200, percentile]
    );
  }

  return { symbol, added: newRows.length, status: 'updated' };
}

// ── SECTOR WEIGHTS (Yahoo Finance ETF AUM → S&P 500 proxy weights) ───────────
const SECTOR_WEIGHT_SYMS = ['XLK', 'XLF', 'XLV', 'XLC', 'XLY', 'XLI', 'XLP', 'XLE', 'XLB', 'XLRE', 'XLU'];

async function refreshSectorWeights(kv) {
  const settled = await Promise.allSettled(SECTOR_WEIGHT_SYMS.map(async sym => {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=summaryDetail`,
      { headers: YF_HEADERS }
    );
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    const data = await res.json();
    const ta = data?.quoteSummary?.result?.[0]?.summaryDetail?.totalAssets?.raw;
    if (!ta || ta <= 0) throw new Error('no totalAssets');
    return { sym, assets: ta };
  }));

  const assets = {};
  for (const r of settled) {
    if (r.status === 'fulfilled') assets[r.value.sym] = r.value.assets;
  }

  const fetched = Object.keys(assets).length;
  const total   = Object.values(assets).reduce((s, v) => s + v, 0);
  if (total === 0 || fetched < 8) return { status: 'insufficient data', fetched };

  const weights = {};
  for (const [sym, val] of Object.entries(assets)) {
    weights[sym] = +(val / total).toFixed(4);
  }

  await kv.put('sector-weights:current', JSON.stringify({
    updated: new Date().toISOString(),
    weights,
  }));

  return { status: 'ok', fetched, weights };
}

// ── COT — CFTC Commitment of Traders (weekly, via Socrata public API) ─────────
// TFF dataset (financial futures) for ES; Disaggregated for GC + CL.
const COT_CONTRACTS = [
  {
    key:     'ES',
    dataset: 'yw9f-hn96',  // TFF — Traders in Financial Futures
    filter:  'E-MINI S&P 500',
    longFld: 'lev_money_positions_long',
    shrtFld: 'lev_money_positions_short',
  },
  {
    key:     'GC',
    dataset: 'jun7-fc8e',  // Legacy Futures-Only
    filter:  'GOLD - COMMODITY EXCHANGE INC.',
    longFld: 'noncomm_positions_long_all',
    shrtFld: 'noncomm_positions_short_all',
  },
  {
    key:     'CL',
    dataset: 'jun7-fc8e',
    filter:  'CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE',
    longFld: 'noncomm_positions_long_all',
    shrtFld: 'noncomm_positions_short_all',
  },
];

async function refreshCOT(db) {
  const CFTC = 'https://publicreporting.cftc.gov/resource';
  const results = {};

  for (const c of COT_CONTRACTS) {
    try {
      // Find the latest date we already have so we only backfill what's missing
      const { results: latest } = await db.prepare(
        `SELECT MAX(report_date) AS last FROM cot_data WHERE contract = ?`
      ).bind(c.key).all();
      const since = latest[0]?.last ?? '2022-01-01';

      const qs = new URLSearchParams({
        '$where':  `market_and_exchange_names like '%${c.filter.split(' - ')[0]}%' AND report_date_as_yyyy_mm_dd > '${since}'`,
        '$order':  'report_date_as_yyyy_mm_dd ASC',
        '$limit':  '200',
        '$select': `report_date_as_yyyy_mm_dd,open_interest_all,${c.longFld},${c.shrtFld}`,
      });
      const res = await fetch(`${CFTC}/${c.dataset}.json?${qs}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) { results[c.key] = { status: 'http_error', code: res.status }; continue; }

      const rows = await res.json();
      if (!rows.length) { results[c.key] = { status: 'up_to_date' }; continue; }

      let inserted = 0;
      for (const row of rows) {
        const date = row.report_date_as_yyyy_mm_dd?.slice(0, 10);
        const oi   = parseInt(row.open_interest_all, 10) || null;
        const lng  = parseInt(row[c.longFld], 10) || null;
        const sht  = parseInt(row[c.shrtFld], 10) || null;
        if (!date || lng == null || sht == null) continue;
        const net    = lng - sht;
        const netPct = oi ? +(net / oi).toFixed(4) : null;
        await db.prepare(
          `INSERT OR REPLACE INTO cot_data (report_date, contract, noncomm_long, noncomm_short, noncomm_net, open_interest, net_pct_oi)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(date, c.key, lng, sht, net, oi, netPct).run();
        inserted++;
      }
      results[c.key] = { status: 'ok', inserted };
    } catch (err) {
      results[c.key] = { status: 'error', error: err.message };
    }
  }
  return results;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const token = context.request.headers.get('X-Hub-Token');
  if (!token || token !== context.env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const url = new URL(context.request.url);
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({
      error: 'D1 binding missing. Add variable "DB" → market-hub-db in Cloudflare Pages → Settings → Functions → D1 bindings.',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ?start=N lets callers split the 70-symbol list into batches to stay
  // under Cloudflare's 50 subrequest-per-invocation limit (each symbol
  // makes at least one Yahoo Finance fetch).
  const startIdx = Math.max(0, parseInt(url.searchParams.get('start') || '0', 10));

  // Portfolio Engine: holdings from the IBKR mirror join the refresh universe
  // automatically — a dynamic union, so the symbol list has one source of truth
  // for portfolio names and buying a new stock needs no code change.
  let symbols = ALL_SYMBOLS;
  try {
    const { results: pf = [] } = await db.prepare(
      `SELECT DISTINCT symbol FROM portfolio_positions WHERE asset_class IN ('STK','ETF')`
    ).all();
    const extra = pf.map(r => r.symbol).filter(s => s && !ALL_SYMBOLS.includes(s));
    if (extra.length) symbols = [...ALL_SYMBOLS, ...extra];
  } catch { /* portfolio tables not created yet — static list only */ }

  const batch    = symbols.slice(startIdx);

  const results   = [];
  let totalAdded  = 0;

  for (const symbol of batch) {
    try {
      const r  = await refreshSymbol(db, symbol);
      results.push(r);
      totalAdded += r.added;
    } catch (err) {
      results.push({ symbol, added: 0, status: 'error', error: err.message });
      // continue — don't let one symbol failure stop the rest of the batch
    }
  }

  let sectorWeights = { status: 'skipped' };
  if (context.env.SUMMARIES) {
    try {
      sectorWeights = await refreshSectorWeights(context.env.SUMMARIES);
    } catch (err) {
      sectorWeights = { status: 'error', error: err.message };
    }
  }

  let cot = { status: 'skipped' };
  if (startIdx === 0 || url.searchParams.has('cot')) {
    try {
      cot = await refreshCOT(db);
    } catch (err) {
      cot = { status: 'error', error: err.message };
    }
  }

  return new Response(JSON.stringify({
    timestamp:     new Date().toISOString(),
    totalAdded,
    symbols:       results,
    sectorWeights,
    cot,
  }), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
