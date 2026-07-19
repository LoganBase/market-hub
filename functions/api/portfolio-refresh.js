/**
 * Market Hub — Portfolio Data Refresh (Portfolio Engine, Phases 3+4)
 * Cloudflare Pages Function: GET /api/portfolio-refresh?start=N
 *
 * For each holding (batches of 8 — subrequest budget, refresh.js pattern):
 *   1. Fundamentals (Finnhub /stock/metric + earnings calendar) — refetched only
 *      when missing, >90 days old, or an earnings date has passed since the last
 *      fetch. Raw payload stored for audit. STK only; ETFs are honestly skipped.
 *   2. News (Finnhub /company-news, last 48h, newest 15) → stock_news.
 *   3. Sentiment — ONE Claude Haiku call per symbol per day over the batched
 *      headlines (email-ingest pattern: structured-JSON contract + validation).
 *      No articles → a no-news row (n_articles=0), no LLM call.
 *
 * Auth: X-Hub-Token. Env: DB, FINNHUB_API_KEY, ANTHROPIC_API_KEY.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const FINNHUB = 'https://finnhub.io/api/v1';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const BATCH = 8;
const FUND_REFRESH_DAYS = 90;

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Finnhub metric keys vary by company — try candidates in order (honest null when absent).
export function mapFinnhubMetrics(m) {
  const pick = (...keys) => { for (const k of keys) if (m?.[k] != null) return num(m[k]); return null; };
  const pfcf = pick('pfcfShareTTM', 'pfcfShareAnnual');
  return {
    pe:              pick('peTTM', 'peBasicExclExtraTTM', 'peAnnual'),
    forward_pe:      pick('forwardPE', 'peForward'),
    pb:              pick('pb', 'pbQuarterly', 'pbAnnual'),
    debt_to_equity:  pick('totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual', 'longTermDebt/equityQuarterly'),
    eps_growth_yoy:  pick('epsGrowthTTMYoy', 'epsGrowthQuarterlyYoy'),
    revenue_growth_yoy: pick('revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy'),
    gross_margin:    pick('grossMarginTTM', 'grossMarginAnnual'),
    net_margin:      pick('netProfitMarginTTM', 'netProfitMarginAnnual'),
    roe:             pick('roeTTM', 'roeRfy'),
    fcf_yield:       pfcf && pfcf > 0 ? +(100 / pfcf).toFixed(2) : null,   // price/FCF → yield %
  };
}

// Validate the Haiku sentiment contract (email-ingest pattern).
export function validateSentiment(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const s = Number(parsed.sentiment);
  if (!Number.isFinite(s) || s < -5 || s > 5) return null;
  let c = Number(parsed.confidence);
  if (!Number.isFinite(c)) c = 0.5;
  c = Math.max(0, Math.min(1, c));
  const drivers = Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 3).map(d => String(d).slice(0, 120)) : [];
  return { sentiment: Math.round(s), confidence: c, drivers };
}

const SENT_SYSTEM = `You are a financial news sentiment analyst. Given recent headlines about one company, output ONLY raw JSON (no markdown, no prose):
{"sentiment": <integer -5 to 5, -5 = severely negative for the stock, 0 = neutral/mixed, 5 = strongly positive>, "confidence": <0 to 1, how clear the signal is>, "drivers": [<up to 3 short phrases naming the key stories>]}
Judge investment relevance, not tone: routine coverage and minor moves are near 0. Reserve |4-5| for genuinely material news (earnings surprises, guidance changes, regulatory action, M&A).`;

async function haikuSentiment(env, symbol, description, articles) {
  const lines = articles.map(a => `- [${(a.published_at || '').slice(0, 10)}] ${a.headline}${a.summary ? ' — ' + a.summary.slice(0, 200) : ''}`);
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 200, system: SENT_SYSTEM,
      messages: [{ role: 'user', content: `${symbol} (${description || 'company'}) — last 48h headlines:\n${lines.join('\n')}` }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return validateSentiment(jsonMatch ? JSON.parse(jsonMatch[0]) : null);
}

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
  if (!env.FINNHUB_API_KEY) return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }), { status: 500, headers: CORS });

  const start = Math.max(0, parseInt(new URL(request.url).searchParams.get('start') || '0', 10));
  const today = new Date().toISOString().slice(0, 10);
  const fh = (path) => fetch(`${FINNHUB}${path}${path.includes('?') ? '&' : '?'}token=${env.FINNHUB_API_KEY}`).then(r => r.ok ? r.json() : null).catch(() => null);

  try {
    // Self-create schema
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS stock_fundamentals (
         symbol TEXT NOT NULL, as_of TEXT NOT NULL, fetched_at TEXT NOT NULL,
         provider TEXT DEFAULT 'finnhub',
         pe REAL, forward_pe REAL, pb REAL, debt_to_equity REAL,
         eps_ttm REAL, eps_growth_yoy REAL, revenue_growth_yoy REAL,
         gross_margin REAL, net_margin REAL, fcf_ttm REAL, fcf_yield REAL, roe REAL,
         next_earnings TEXT, raw TEXT, PRIMARY KEY (symbol, as_of))`
    ).run();
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS stock_news (
         id TEXT PRIMARY KEY, symbol TEXT NOT NULL, published_at TEXT NOT NULL,
         headline TEXT, source TEXT, url TEXT, summary TEXT)`
    ).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_news_sym ON stock_news (symbol, published_at DESC)`).run();
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS stock_sentiment (
         symbol TEXT NOT NULL, date TEXT NOT NULL,
         score REAL, confidence REAL, n_articles INTEGER,
         drivers TEXT, model TEXT, created_at TEXT, PRIMARY KEY (symbol, date))`
    ).run();

    const { results: holdings = [] } = await db.prepare(
      `SELECT symbol, description, asset_class FROM portfolio_positions ORDER BY symbol`
    ).all();
    const slice = holdings.slice(start, start + BATCH);
    if (!slice.length) return new Response(JSON.stringify({ done: true, total: holdings.length, start }), { headers: CORS });

    const report = [];
    for (const h of slice) {
      const r = { symbol: h.symbol };

      // ── Fundamentals (STK only; earnings-triggered or 90d staleness) ──
      if (h.asset_class === 'STK') {
        let last = null;
        try {
          last = await db.prepare(`SELECT fetched_at, next_earnings FROM stock_fundamentals WHERE symbol = ? ORDER BY as_of DESC LIMIT 1`).bind(h.symbol).first();
        } catch { /* first run */ }
        const ageDays = last ? (Date.now() - Date.parse(last.fetched_at)) / 864e5 : Infinity;
        const earningsPassed = last?.next_earnings && last.next_earnings <= today && last.fetched_at.slice(0, 10) <= last.next_earnings;
        if (!last || ageDays > FUND_REFRESH_DAYS || earningsPassed) {
          const [metricRes, calRes] = await Promise.all([
            fh(`/stock/metric?symbol=${h.symbol}&metric=all`),
            fh(`/calendar/earnings?from=${today}&to=${new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10)}&symbol=${h.symbol}`),
          ]);
          if (metricRes?.metric && Object.keys(metricRes.metric).length) {
            const f = mapFinnhubMetrics(metricRes.metric);
            const nextEarnings = calRes?.earningsCalendar?.[0]?.date ?? null;
            const asOf = metricRes.metric.lastUpdated?.slice?.(0, 10) ?? today;
            await db.prepare(
              `INSERT OR REPLACE INTO stock_fundamentals
               (symbol, as_of, fetched_at, provider, pe, forward_pe, pb, debt_to_equity,
                eps_growth_yoy, revenue_growth_yoy, gross_margin, net_margin, fcf_yield, roe, next_earnings, raw)
               VALUES (?, ?, ?, 'finnhub', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(h.symbol, asOf, new Date().toISOString(), f.pe, f.forward_pe, f.pb, f.debt_to_equity,
              f.eps_growth_yoy, f.revenue_growth_yoy, f.gross_margin, f.net_margin, f.fcf_yield, f.roe,
              nextEarnings, JSON.stringify(metricRes.metric).slice(0, 20000)).run();
            r.fundamentals = 'refreshed';
          } else r.fundamentals = 'no-data';
        } else r.fundamentals = 'fresh';
      } else r.fundamentals = 'skipped (' + h.asset_class + ')';

      // ── News (last 48h) + one-per-day sentiment ──
      let sentExists = null;
      try { sentExists = await db.prepare(`SELECT 1 AS x FROM stock_sentiment WHERE symbol = ? AND date = ?`).bind(h.symbol, today).first(); }
      catch { /* first run */ }
      if (sentExists) { r.sentiment = 'already-computed'; report.push(r); continue; }

      const from = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
      const newsRes = await fh(`/company-news?symbol=${h.symbol}&from=${from}&to=${today}`);
      const articles = (Array.isArray(newsRes) ? newsRes : [])
        .filter(a => a.headline)
        .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
        .slice(0, 15)
        .map(a => ({
          id: String(a.id ?? `${h.symbol}:${a.url ?? a.headline}`).slice(0, 200),
          symbol: h.symbol,
          published_at: a.datetime ? new Date(a.datetime * 1000).toISOString() : today,
          headline: String(a.headline).slice(0, 300),
          source: a.source ?? null, url: a.url ?? null,
          summary: a.summary ? String(a.summary).slice(0, 500) : null,
        }));
      if (articles.length) {
        await db.batch(articles.map(a => db.prepare(
          `INSERT OR REPLACE INTO stock_news (id, symbol, published_at, headline, source, url, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(a.id, a.symbol, a.published_at, a.headline, a.source, a.url, a.summary)));
      }

      if (!articles.length) {
        await db.prepare(
          `INSERT OR REPLACE INTO stock_sentiment (symbol, date, score, confidence, n_articles, drivers, model, created_at)
           VALUES (?, ?, NULL, NULL, 0, NULL, NULL, ?)`
        ).bind(h.symbol, today, new Date().toISOString()).run();
        r.sentiment = 'no-news';
      } else if (env.ANTHROPIC_API_KEY) {
        try {
          const v = await haikuSentiment(env, h.symbol, h.description, articles);
          if (v) {
            await db.prepare(
              `INSERT OR REPLACE INTO stock_sentiment (symbol, date, score, confidence, n_articles, drivers, model, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(h.symbol, today, v.sentiment, v.confidence, articles.length, JSON.stringify(v.drivers), MODEL, new Date().toISOString()).run();
            r.sentiment = `scored ${v.sentiment >= 0 ? '+' : ''}${v.sentiment} (${articles.length} articles)`;
          } else r.sentiment = 'invalid-llm-json (skipped)';
        } catch (e) { r.sentiment = 'llm-error: ' + e.message; }
      } else r.sentiment = 'no ANTHROPIC_API_KEY';

      report.push(r);
    }

    return new Response(JSON.stringify({
      start, batch: slice.length, total: holdings.length,
      next: start + BATCH < holdings.length ? start + BATCH : null,
      report,
    }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
