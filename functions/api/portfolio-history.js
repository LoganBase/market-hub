/**
 * Market Hub — Portfolio history API (Portfolio Engine, Phase 5)
 * GET /api/portfolio-history?symbol=NVDA  → per-symbol signal/recommendation series
 * GET /api/portfolio-history               → account NAV series
 * Public read; feeds the position detail pane and the account chart.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });
  const symbol = new URL(context.request.url).searchParams.get('symbol');

  try {
    if (symbol) {
      const { results = [] } = await db.prepare(
        `SELECT date, tech_score, fund_score, sent_score, agg_score, recommendation, market_gate
         FROM stock_signals WHERE symbol = ? ORDER BY date ASC LIMIT 500`
      ).bind(symbol).all();
      return new Response(JSON.stringify({
        symbol,
        dates: results.map(r => r.date),
        tech: results.map(r => r.tech_score),
        fund: results.map(r => r.fund_score),
        sent: results.map(r => r.sent_score),
        agg: results.map(r => r.agg_score),
        recommendations: results.map(r => r.recommendation),
        gates: results.map(r => r.market_gate),
      }), { headers: CORS });
    }
    const { results = [] } = await db.prepare(
      `SELECT date, nav, cash FROM portfolio_snapshots WHERE symbol = '_ACCOUNT' AND nav IS NOT NULL ORDER BY date ASC LIMIT 1000`
    ).all();
    return new Response(JSON.stringify({
      dates: results.map(r => r.date),
      nav: results.map(r => r.nav),
      cash: results.map(r => r.cash),
    }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, dates: [] }), { headers: CORS });
  }
}
