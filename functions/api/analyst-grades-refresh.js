/**
 * Market Hub — Analyst Upgrades/Downgrades Refresh
 * Cloudflare Pages Function: GET /api/analyst-grades-refresh
 *
 * Pulls the latest market-wide analyst grade actions (upgrades/downgrades)
 * from FMP — restores the "Up/Downgrades" table Briefing.com's emails used
 * to carry, which nothing else in the pipeline replicates. Free FMP tier;
 * capped at limit=10 (higher values 402 under the free plan).
 *
 * Auth: X-Hub-Token. Env: DB, FMP_API_KEY.
 * Runs nightly from data-refresh.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const FMP_BASE = 'https://financialmodelingprep.com/stable';

export async function onRequest(context) {
  try {
    return await _onRequest(context);
  } catch (topErr) {
    return new Response(JSON.stringify({ error: 'Unhandled: ' + (topErr?.message ?? String(topErr)) }), { status: 200, headers: CORS });
  }
}

async function _onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.headers.get('X-Hub-Token') !== env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const db = env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 200, headers: CORS });
  if (!env.FMP_API_KEY) return new Response(JSON.stringify({ error: 'FMP_API_KEY not set' }), { status: 200, headers: CORS });

  const url = `${FMP_BASE}/grades-latest-news?page=0&limit=10&apikey=${env.FMP_API_KEY}`;
  let grades;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `FMP ${res.status}: ${text.slice(0, 300)}` }), { status: 200, headers: CORS });
    }
    grades = await res.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'FMP fetch failed: ' + e.message }), { status: 200, headers: CORS });
  }

  if (!Array.isArray(grades)) {
    return new Response(JSON.stringify({ error: 'Unexpected FMP response shape', got: typeof grades }), { status: 200, headers: CORS });
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS analyst_grades (
      symbol             TEXT NOT NULL,
      published_date     TEXT NOT NULL,
      grading_company    TEXT,
      previous_grade     TEXT,
      new_grade          TEXT,
      action             TEXT,
      price_when_posted  REAL,
      news_title         TEXT,
      news_url           TEXT,
      fetched_at         TEXT NOT NULL,
      PRIMARY KEY (symbol, published_date, grading_company)
    )
  `).run();

  const now = new Date().toISOString();
  const stmts = grades.map(g => db.prepare(`
    INSERT INTO analyst_grades (symbol, published_date, grading_company, previous_grade, new_grade, action, price_when_posted, news_title, news_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, published_date, grading_company) DO UPDATE SET
      previous_grade = excluded.previous_grade, new_grade = excluded.new_grade,
      action = excluded.action, price_when_posted = excluded.price_when_posted,
      news_title = excluded.news_title, news_url = excluded.news_url, fetched_at = excluded.fetched_at
  `).bind(
    g.symbol ?? 'UNKNOWN', g.publishedDate ?? now, g.gradingCompany ?? null,
    g.previousGrade ?? null, g.newGrade ?? null, g.action ?? null,
    g.priceWhenPosted ?? null, g.newsTitle ?? null, g.newsURL ?? null, now,
  ));

  if (stmts.length) await db.batch(stmts);

  return new Response(JSON.stringify({
    gradesStored: grades.length,
    sample: grades.slice(0, 3).map(g => ({ symbol: g.symbol, action: g.action, from: g.previousGrade, to: g.newGrade, by: g.gradingCompany })),
  }), { headers: CORS });
}
