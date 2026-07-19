/**
 * Market Hub — Per-Stock Signal Engine (Portfolio Engine, Phases 2+5)
 * Cloudflare Pages Function: GET /api/portfolio-signals
 *
 * For every holding in portfolio_positions, computes the three
 * timeframe-isolated signals and the aggregated recommendation:
 *   A. Technical (daily, 0–10)   — from daily_prices/indicators (q[sym] shape)
 *   B. Fundamental (quarterly)   — from stock_fundamentals → structural bias band
 *   C. Sentiment (daily)         — from stock_sentiment (Haiku over headlines)
 *   D. Aggregate                 — weighted blend with fundamental BANDS (they
 *      size the ceiling/floor, never time), an acute-news VETO, and the
 *      market-level directive GATE (context flows down); then a 5-state
 *      hysteresis machine (±0.5 bands, 3-session persistence) — the same
 *      philosophy as the market matrix.
 *
 * House rules: missing data → explicit 'unavailable'/'no-news' with weight
 * renormalization, never silent substitution. Every day's row is upserted into
 * stock_signals — the per-stock receipts ledger.
 *
 * Auth: X-Hub-Token. Env: DB. Runs nightly from data-refresh after
 * portfolio-sync + portfolio-refresh.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

const clamp01 = (x) => (x == null || Number.isNaN(x) ? null : x < 0 ? 0 : x > 1 ? 1 : x);
const round1 = (x) => Math.round(x * 10) / 10;

// ── A. TECHNICAL (0–10) ───────────────────────────────────────────────────────
// Components skipped when inputs are missing (R14 rules); <2 available → unavailable.
export function computeTechSignal(q, sym) {
  const s = q[sym], spy = q['SPY'];
  if (!s) return { score: null, status: 'unavailable', parts: [] };
  const ret20 = (x) => (x?.price && x?.price20d ? (x.price / x.price20d - 1) * 100 : null);
  const rel20 = (ret20(s) != null && ret20(spy) != null) ? ret20(s) - ret20(spy) : null;
  const parts = [
    ['trend', s.vs200 != null ? clamp01(0.5 + s.vs200 / 20) : null],
    ['inter', s.vs50 != null ? clamp01(0.5 + s.vs50 / 10) : null],
    ['mom',   s.rsi14 != null ? clamp01((s.rsi14 - 30) / 40) : null],
    ['rel',   rel20 != null ? clamp01(0.5 + rel20 / 8) : null],
  ].filter(p => p[1] != null);
  if (parts.length < 2) return { score: null, status: 'unavailable', parts };
  const score = round1(parts.reduce((a, p) => a + p[1], 0) / parts.length * 10);
  return { score, status: 'ok', parts };
}

// ── B. FUNDAMENTAL (0–10 → structural bias) ──────────────────────────────────
// Legible thresholds; ETFs and stale data (>120d) are honestly 'unavailable'.
const FUND_STALE_DAYS = 120;
export function computeFundSignal(f, assetClass, today) {
  if (assetClass && assetClass !== 'STK') return { score: null, bias: 'unavailable', asOf: null, why: `fundamentals N/A (${assetClass})` };
  if (!f) return { score: null, bias: 'unavailable', asOf: null, why: 'no fundamental data yet' };
  const ageDays = today && f.fetched_at ? (new Date(today) - new Date(f.fetched_at.slice(0, 10))) / 864e5 : 0;
  if (ageDays > FUND_STALE_DAYS) return { score: null, bias: 'unavailable', asOf: f.as_of, why: `fundamental data stale (${Math.round(ageDays)}d)` };

  const pe = f.forward_pe ?? f.pe;
  const parts = [
    ['val',    pe == null ? null : pe <= 0 ? 0.15 : pe < 15 ? 1 : pe < 25 ? 0.7 : pe < 40 ? 0.4 : 0.15],
    ['lev',    f.debt_to_equity == null ? null : f.debt_to_equity < 0.5 ? 1 : f.debt_to_equity < 1.5 ? 0.6 : 0.2],
    ['growth', f.eps_growth_yoy == null ? null : f.eps_growth_yoy > 15 ? 1 : f.eps_growth_yoy > 5 ? 0.7 : f.eps_growth_yoy > 0 ? 0.5 : 0.2],
    ['margin', f.net_margin == null ? null : f.net_margin > 15 ? 1 : f.net_margin > 5 ? 0.6 : f.net_margin > 0 ? 0.4 : 0.1],
    ['fcf',    f.fcf_yield == null ? null : f.fcf_yield > 5 ? 1 : f.fcf_yield > 2 ? 0.7 : f.fcf_yield > 0 ? 0.4 : 0.1],
  ].filter(p => p[1] != null);
  if (parts.length < 3) return { score: null, bias: 'unavailable', asOf: f.as_of, why: `only ${parts.length} fundamental metrics available` };
  const score = round1(parts.reduce((a, p) => a + p[1], 0) / parts.length * 10);
  const bias = score >= 6.5 ? 'add' : score >= 4 ? 'hold' : 'reduce';
  return { score, bias, asOf: f.as_of, parts };
}

// ── C. SENTIMENT (0–10) ───────────────────────────────────────────────────────
export function computeSentSignal(row) {
  if (!row) return { score: null, status: 'no-news', confidence: null };
  if (row.n_articles === 0 || row.score == null) return { score: null, status: 'no-news', confidence: null };
  const score10 = round1(Math.max(0, Math.min(10, row.score + 5)));
  const status = row.score >= 1.5 ? 'bullish' : row.score <= -1.5 ? 'bearish' : 'neutral';
  return { score: score10, status, confidence: row.confidence ?? null, raw: row.score };
}

// ── D. AGGREGATION ────────────────────────────────────────────────────────────
const W = { tech: 0.55, fund: 0.25, sent: 0.20 };
export function aggregate(tech, fund, sent, marketVerb) {
  const avail = [];
  if (tech.score != null) avail.push(['tech', tech.score]);
  if (fund.score != null) avail.push(['fund', fund.score]);
  if (sent.score != null) avail.push(['sent', sent.score]);
  if (!avail.length) return { agg: null, notes: ['no signals available'] };

  const wSum = avail.reduce((a, [k]) => a + W[k], 0);
  let agg = avail.reduce((a, [k, v]) => a + (W[k] / wSum) * v, 0);
  const notes = [];
  if (avail.length < 3) notes.push(`weights renormalized (${avail.map(([k]) => k).join('+')})`);

  // Structural band from fundamental bias — sizes, never times.
  if (fund.bias === 'reduce' && agg > 5.5) { agg = 5.5; notes.push('capped 5.5 — fundamentals read reduce'); }
  if (fund.bias === 'add'    && agg < 3.0) { agg = 3.0; notes.push('floored 3.0 — fundamentals read add'); }

  // Acute-news veto.
  if (sent.raw != null && sent.raw <= -3.5 && (sent.confidence ?? 0) >= 0.6 && agg > 4.0) {
    agg = 4.0; notes.push('capped 4.0 — acute negative news');
  }

  // Market gate — context flows down from the market directive.
  if ((marketVerb === 'TRIM' || marketVerb === 'REDUCE') && agg > 6.0) { agg = 6.0; notes.push(`capped 6.0 — market directive ${marketVerb}`); }
  if (marketVerb === 'HOLD' && agg > 7.0) { agg = 7.0; notes.push('capped 7.0 — market directive HOLD (stretched)'); }

  return { agg: round1(agg), notes };
}

// ── 5-state hysteresis machine ────────────────────────────────────────────────
// States ordered sell(0) → strong-buy(4); TH[i] = lower bound of state i.
export const REC_STATES = ['sell', 'reduce', 'hold', 'accumulate', 'strong-buy'];
const TH = [-Infinity, 2.5, 4.0, 6.0, 7.5];
const BAND = 0.5, PERSIST = 3;

export function rawRec(agg) {
  if (agg == null) return null;
  let s = 0;
  for (let i = 1; i < TH.length; i++) if (agg >= TH[i]) s = i;
  return REC_STATES[s];
}

// Replay over [history aggs..., today agg]; returns effective state + pending.
export function replayRecState(aggs) {
  let eff = null, pend = null, pc = 0, days = 0;
  for (const agg of aggs) {
    if (agg == null) continue;
    if (eff == null) { eff = REC_STATES.indexOf(rawRec(agg)); days = 1; continue; }
    let cand = eff;
    while (cand < 4 && agg >= TH[cand + 1] + BAND) cand++;
    while (cand > 0 && agg < TH[cand] - BAND) cand--;
    if (cand === eff) { pend = null; pc = 0; days++; }
    else if (cand === pend) {
      pc++;
      if (pc >= PERSIST) { eff = cand; pend = null; pc = 0; days = 1; } else days++;
    } else { pend = cand; pc = 1; days++; }
  }
  return {
    recommendation: eff != null ? REC_STATES[eff] : null,
    pending: pend != null ? { rec: REC_STATES[pend], daysConfirmed: pc, daysRequired: PERSIST } : null,
    daysInState: days,
  };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.headers.get('X-Hub-Token') !== env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const db = env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });

  try {
    const { results: holdings = [] } = await db.prepare(
      `SELECT symbol, asset_class FROM portfolio_positions`
    ).all();
    if (!holdings.length) return new Response(JSON.stringify({ skipped: true, reason: 'no positions synced' }), { headers: CORS });
    const syms = holdings.map(h => h.symbol);

    // q-lite for holdings + SPY (lean duplicate of scores.js loadFromD1 — Pages
    // Functions can't share module code across endpoint files).
    const all = [...new Set([...syms, 'SPY'])];
    const ph = all.map(() => '?').join(',');
    const { results: priceRows = [] } = await db.prepare(
      `SELECT symbol, date, close FROM daily_prices
       WHERE symbol IN (${ph}) AND date >= DATE('now', '-40 days') ORDER BY symbol, date DESC`
    ).bind(...all).all();
    const { results: indRows = [] } = await db.prepare(
      `SELECT i.symbol, i.sma50, i.sma200, i.rsi14 FROM indicators i
       INNER JOIN (SELECT symbol, MAX(date) AS d FROM indicators WHERE symbol IN (${ph}) GROUP BY symbol) m
         ON i.symbol = m.symbol AND i.date = m.d`
    ).bind(...all).all();
    const closes = {};
    let dataDate = null;
    for (const r of priceRows) {
      (closes[r.symbol] ??= []).push(r.close);
      if (r.symbol === 'SPY' && !dataDate) dataDate = r.date;
    }
    const q = {};
    for (const r of indRows) {
      const c = closes[r.symbol] ?? [];
      const price = c[0];
      if (price == null) continue;
      q[r.symbol] = {
        price, price20d: c[20] ?? null,
        sma50: r.sma50, sma200: r.sma200, rsi14: r.rsi14,
        vs50: r.sma50 ? (price - r.sma50) / r.sma50 * 100 : null,
        vs200: r.sma200 ? (price - r.sma200) / r.sma200 * 100 : null,
      };
    }
    if (!dataDate) return new Response(JSON.stringify({ error: 'no SPY price data' }), { status: 500, headers: CORS });

    // Latest fundamentals + today's sentiment (tables may not exist until P3/P4)
    let fundMap = {}, sentMap = {};
    try {
      const { results: fr = [] } = await db.prepare(
        `SELECT f.* FROM stock_fundamentals f
         INNER JOIN (SELECT symbol, MAX(as_of) AS a FROM stock_fundamentals GROUP BY symbol) m
           ON f.symbol = m.symbol AND f.as_of = m.a`
      ).all();
      for (const r of fr) fundMap[r.symbol] = r;
    } catch { /* P3 not landed */ }
    try {
      const { results: sr = [] } = await db.prepare(
        `SELECT s.* FROM stock_sentiment s
         INNER JOIN (SELECT symbol, MAX(date) AS d FROM stock_sentiment GROUP BY symbol) m
           ON s.symbol = m.symbol AND s.date = m.d
         WHERE s.date >= DATE('now', '-3 days')`
      ).all();
      for (const r of sr) sentMap[r.symbol] = r;
    } catch { /* P4 not landed */ }

    // Market gate from the live directive (same-origin fetch, cache-busted)
    let marketVerb = null;
    try {
      const u = new URL('/api/scores?_pf=' + Date.now(), request.url);
      const scores = await (await fetch(u.toString(), { headers: { Accept: 'application/json' } })).json();
      marketVerb = scores?.horizons?.directive?.verb ?? null;
    } catch { /* gate simply not applied — recorded as null */ }

    await db.prepare(
      `CREATE TABLE IF NOT EXISTS stock_signals (
         date TEXT NOT NULL, symbol TEXT NOT NULL,
         tech_score REAL, tech_status TEXT,
         fund_score REAL, fund_bias TEXT, fund_as_of TEXT,
         sent_score REAL, sent_status TEXT,
         agg_score REAL, recommendation TEXT NOT NULL,
         raw_recommendation TEXT, days_in_state INTEGER,
         market_gate TEXT, note TEXT, PRIMARY KEY (date, symbol))`
    ).run();

    const stmts = [];
    const out = [];
    for (const h of holdings) {
      const tech = computeTechSignal(q, h.symbol);
      const fund = computeFundSignal(fundMap[h.symbol] ?? null, h.asset_class, dataDate);
      const sent = computeSentSignal(sentMap[h.symbol] ?? null);
      const { agg, notes } = aggregate(tech, fund, sent, marketVerb);

      // Hysteresis replay over this symbol's stored agg history + today
      let hist = [];
      try {
        const { results: hr = [] } = await db.prepare(
          `SELECT agg_score FROM stock_signals WHERE symbol = ? AND date < ? ORDER BY date DESC LIMIT 30`
        ).bind(h.symbol, dataDate).all();
        hist = hr.map(r => r.agg_score).reverse();
      } catch { /* first run */ }
      const st = replayRecState([...hist, agg]);
      const rec = st.recommendation ?? 'hold';

      const noteParts = [
        tech.score != null ? `Tech ${tech.score.toFixed(1)}` : `Tech ${tech.status}`,
        fund.score != null ? `Fund ${fund.score.toFixed(1)} (${fund.bias}${fund.asOf ? ', as of ' + fund.asOf : ''})` : `Fund ${fund.why ?? fund.bias}`,
        sent.score != null ? `Sent ${sent.score.toFixed(1)} (${sent.status})` : 'Sent no-news',
        ...notes,
      ];
      if (st.pending) noteParts.push(`shifting → ${st.pending.rec} (${st.pending.daysConfirmed}/${st.pending.daysRequired})`);

      stmts.push(db.prepare(
        `INSERT OR REPLACE INTO stock_signals
         (date, symbol, tech_score, tech_status, fund_score, fund_bias, fund_as_of,
          sent_score, sent_status, agg_score, recommendation, raw_recommendation,
          days_in_state, market_gate, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(dataDate, h.symbol, tech.score, tech.status, fund.score, fund.bias, fund.asOf,
        sent.score, sent.status, agg, rec, rawRec(agg), st.daysInState, marketVerb, noteParts.join(' · ')));
      out.push({ symbol: h.symbol, agg, recommendation: rec, pending: st.pending });
    }
    if (stmts.length) await db.batch(stmts);

    return new Response(JSON.stringify({ date: dataDate, marketGate: marketVerb, computed: out.length, signals: out }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
