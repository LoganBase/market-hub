/**
 * Market Hub — Portfolio read API (Portfolio Engine, Phase 1)
 * Cloudflare Pages Function: GET /api/portfolio
 *
 * The UI payload for the Portfolio tab: live positions joined with each
 * symbol's latest stock_signals row (null until Phase 2+ computes them),
 * plus the latest account snapshot (NAV / cash) and honest sync metadata.
 * Public read (same as /api/scores).
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });

  try {
    let posRows = [];
    try {
      ({ results: posRows = [] } = await db.prepare(
        `SELECT * FROM portfolio_positions ORDER BY quantity * COALESCE(mark_price, avg_cost, 0) DESC`
      ).all());
    } catch { /* table not created yet — first run before any sync */ }

    // Latest signal row per symbol (LEFT-join semantics; absent until Phase 2)
    let sigMap = {};
    try {
      const { results: sigRows = [] } = await db.prepare(
        `SELECT s.* FROM stock_signals s
         INNER JOIN (SELECT symbol, MAX(date) AS d FROM stock_signals GROUP BY symbol) m
           ON s.symbol = m.symbol AND s.date = m.d`
      ).all();
      for (const r of sigRows) sigMap[r.symbol] = r;
    } catch { /* signals table not created yet */ }

    // Latest account snapshot + previous NAV for day delta
    let account = null;
    try {
      const { results: acct = [] } = await db.prepare(
        `SELECT date, nav, cash FROM portfolio_snapshots WHERE symbol = '_ACCOUNT' ORDER BY date DESC LIMIT 2`
      ).all();
      if (acct.length) {
        account = {
          date: acct[0].date, nav: acct[0].nav, cash: acct[0].cash,
          navPrev: acct[1]?.nav ?? null,
          navChangePct: acct[1]?.nav ? +(((acct[0].nav ?? 0) / acct[1].nav - 1) * 100).toFixed(2) : null,
        };
      }
    } catch { /* no snapshots yet */ }

    const positions = posRows.map(p => {
      const mv = p.mark_price != null && p.quantity != null ? p.mark_price * p.quantity : null;
      const cost = p.avg_cost != null && p.quantity != null ? p.avg_cost * p.quantity : null;
      const s = sigMap[p.symbol] ?? null;
      return {
        symbol: p.symbol, description: p.description,
        quantity: p.quantity, avgCost: p.avg_cost, markPrice: p.mark_price,
        marketValue: mv != null ? +mv.toFixed(2) : null,
        unrealizedPnl: p.unrealized_pnl,
        pnlPct: (mv != null && cost) ? +((mv / cost - 1) * 100).toFixed(2) : null,
        currency: p.currency, assetClass: p.asset_class, conId: p.con_id,
        signals: s ? {
          date: s.date,
          tech: { score: s.tech_score, status: s.tech_status },
          fund: { score: s.fund_score, bias: s.fund_bias, asOf: s.fund_as_of },
          sent: { score: s.sent_score, status: s.sent_status },
          agg: s.agg_score, recommendation: s.recommendation,
          rawRecommendation: s.raw_recommendation, daysInState: s.days_in_state,
          marketGate: s.market_gate, note: s.note,
        } : null,
      };
    });

    const syncedAt = posRows[0]?.synced_at ?? null;
    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      account, positions,
      meta: {
        syncedAt, reportDate: posRows[0]?.report_date ?? null,
        count: positions.length,
        signalsDate: Object.values(sigMap)[0]?.date ?? null,
        // Honest degradation: the UI shows these states explicitly
        state: !posRows.length ? 'no-sync' : (Object.keys(sigMap).length ? 'ok' : 'positions-only'),
      },
    }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
