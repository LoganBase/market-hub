/**
 * Market Hub — Per-stock detail (Portfolio Engine, detail-pane polish)
 * GET /api/stock-detail?symbol=NVDA
 *
 * Everything the position detail pane needs beyond the signals row:
 *   fundamentals — latest stock_fundamentals snapshot (metrics, as-of, next earnings)
 *   sentiment    — latest stock_sentiment row (score, confidence, drivers)
 *   news         — last 7 days of stock_news (newest 10)
 * Public read; every section is null-honest when data doesn't exist.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });
  const symbol = new URL(context.request.url).searchParams.get('symbol');
  if (!symbol) return new Response(JSON.stringify({ error: 'symbol required' }), { status: 400, headers: CORS });

  const out = { symbol, fundamentals: null, sentiment: null, news: [] };
  try {
    try {
      const f = await db.prepare(
        `SELECT as_of, fetched_at, provider, pe, forward_pe, pb, debt_to_equity,
                eps_growth_yoy, revenue_growth_yoy, gross_margin, net_margin, fcf_yield, roe, next_earnings
         FROM stock_fundamentals WHERE symbol = ? ORDER BY as_of DESC LIMIT 1`
      ).bind(symbol).first();
      if (f) out.fundamentals = f;
    } catch { /* table absent */ }

    try {
      const s = await db.prepare(
        `SELECT date, score, confidence, n_articles, drivers FROM stock_sentiment
         WHERE symbol = ? ORDER BY date DESC LIMIT 1`
      ).bind(symbol).first();
      if (s) {
        let drivers = [];
        try { drivers = s.drivers ? JSON.parse(s.drivers) : []; } catch { /* keep [] */ }
        out.sentiment = { date: s.date, score: s.score, confidence: s.confidence, nArticles: s.n_articles, drivers };
      }
    } catch { /* table absent */ }

    try {
      const { results = [] } = await db.prepare(
        `SELECT published_at, headline, source, url FROM stock_news
         WHERE symbol = ? AND published_at >= DATETIME('now', '-7 days')
         ORDER BY published_at DESC LIMIT 10`
      ).bind(symbol).all();
      out.news = results;
    } catch { /* table absent */ }

    return new Response(JSON.stringify(out), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
