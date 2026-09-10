/**
 * Market Hub — Analyst Upgrades/Downgrades Refresh
 * Cloudflare Pages Function: GET /api/analyst-grades-refresh
 *
 * Pulls today's market-wide analyst grade actions (upgrades/downgrades) from
 * FMP — restores the "Up/Downgrades" table Briefing.com's emails used to
 * carry, which nothing in the current pipeline replicates.
 *
 * NOTE: endpoint path is a best guess at FMP's current API (their docs site
 * blocks automated fetches) — first deploy is to verify live against the
 * real key/plan tier, same as econ-calendar-refresh.
 *
 * Auth: X-Hub-Token. Env: DB, FMP_API_KEY.
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
  if (!env.FMP_API_KEY) return new Response(JSON.stringify({ error: 'FMP_API_KEY not set' }), { status: 200, headers: CORS });

  const url = `${FMP_BASE}/grades-latest-news?page=0&limit=20&apikey=${env.FMP_API_KEY}`;
  const res = await fetch(url);
  const bodyText = await res.text();

  return new Response(JSON.stringify({
    httpStatus: res.status,
    urlTried: url.replace(env.FMP_API_KEY, 'REDACTED'),
    bodySample: bodyText.slice(0, 1000),
  }), { status: 200, headers: CORS });
}
