/**
 * Market Hub — Per-Stock Receipts (Portfolio Engine)
 * Cloudflare Pages Function: GET /api/portfolio-receipts
 *
 * The engine grading itself per holding: each stock's OWN forward price
 * returns (20 / 60 sessions) conditioned on the recommendation the engine
 * held that day, vs an all-days baseline for that stock. Same philosophy as
 * the market-level receipts: overlapping windows, small samples flagged,
 * provenance noted (history before 2026-07-17 is the tech-only backfill).
 *
 * Public read; KV-cached per UTC day (SUMMARIES, key portfolio-receipts:v1).
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' };
const REC_KEYS = ['strong-buy', 'accumulate', 'hold', 'reduce', 'sell'];

// Pure: rows = [{date, recommendation, close}] ascending for one symbol.
export function computeStockReceipts(rows) {
  if (!rows || rows.length < 40) return null;
  const fwd = (i, n) => (i + n < rows.length ? (rows[i + n].close / rows[i].close - 1) * 100 : null);
  const buckets = { baseline: [] };
  for (const k of REC_KEYS) buckets[k] = [];
  for (let i = 0; i < rows.length; i++) {
    const rec = { f20: fwd(i, 20), f60: fwd(i, 60) };
    if (rec.f20 == null) continue;                       // too recent to grade
    buckets.baseline.push(rec);
    if (buckets[rows[i].recommendation]) buckets[rows[i].recommendation].push(rec);
  }
  const stat = (arr, key) => {
    const v = arr.map(r => r[key]).filter(x => x != null).sort((a, b) => a - b);
    if (v.length < 5) return null;
    return { median: +v[Math.floor(v.length / 2)].toFixed(1), hit: Math.round(v.filter(x => x > 0).length / v.length * 100), n: v.length };
  };
  return {
    spanStart: rows[0].date, spanEnd: rows[rows.length - 1].date, days: rows.length,
    buckets: [...REC_KEYS, 'baseline']
      .map(k => ({ key: k, n: buckets[k].length, fwd20: stat(buckets[k], 'f20'), fwd60: stat(buckets[k], 'f60') }))
      .filter(b => b.key === 'baseline' || b.n > 0),
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  const db = env.DB, kv = env.SUMMARIES;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });

  const todayUTC = new Date().toISOString().slice(0, 10);
  try {
    if (kv) {
      const cached = await kv.get('portfolio-receipts:v1', 'json');
      if (cached && cached.computed === todayUTC) return new Response(JSON.stringify(cached.payload), { headers: CORS });
    }
  } catch { /* cache miss is fine */ }

  try {
    let positions = [];
    try {
      ({ results: positions = [] } = await db.prepare(`SELECT symbol, currency FROM portfolio_positions`).all());
    } catch { /* not synced yet */ }
    if (!positions.length) return new Response(JSON.stringify({ symbols: {}, state: 'no-sync' }), { headers: CORS });

    const dataSymOf = (p) => p.currency === 'CAD' ? p.symbol.replace(/\./g, '-') + '.TO' : p.symbol;
    const symbols = {};
    for (const p of positions) {
      const { results: rows = [] } = await db.prepare(
        `SELECT s.date, s.recommendation, dp.close
         FROM stock_signals s
         JOIN daily_prices dp ON dp.symbol = ? AND dp.date = s.date
         WHERE s.symbol = ? AND s.recommendation != 'no-signal'
         ORDER BY s.date ASC`
      ).bind(dataSymOf(p), p.symbol).all();
      const r = computeStockReceipts(rows);
      if (r) symbols[p.symbol] = r;
    }

    const payload = {
      computedAt: new Date().toISOString(),
      symbols,
      note: "Forward price return of the stock itself over 20/60 trading sessions from each day the engine held that state (overlapping windows). History before 2026-07-17 is the tech-only backfill — fundamentals/news signals did not exist then. Samples under 30 are quoted but flagged.",
    };
    try { if (kv) await kv.put('portfolio-receipts:v1', JSON.stringify({ computed: todayUTC, payload }), { expirationTtl: 172800 }); } catch { /* non-fatal */ }
    return new Response(JSON.stringify(payload), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
