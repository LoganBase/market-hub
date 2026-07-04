/**
 * Market Hub — FRED Refresh API
 * Cloudflare Pages Function: GET /api/fred-refresh
 *
 * Appends the most recent observations of a small set of FRED macro series into
 * the D1 `fred_series` table. These feed the horizon scores in /api/scores:
 *   DFII10          — 10y TIPS real yield        → Macro Anchor
 *   BAMLH0A0HYM2 — US High-Yield OAS spread    → Trend Compass credit
 *   DFEDTARU        — Fed funds target upper bound → Macro Anchor (rate direction)
 *
 * Called nightly by workers/data-refresh after the price batches. Self-creates
 * the table (CREATE TABLE IF NOT EXISTS) so no separate migration is required.
 *
 * Auth: X-Hub-Token header must match env.HUB_TOKEN (same as /api/refresh).
 * Requires env: HUB_TOKEN, DB (D1 binding), FRED_API_KEY.
 */

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// Fetch the latest N observations (most recent first) for a FRED series.
async function fetchFredRecent(seriesId, apiKey, limit = 15) {
  try {
    const url = new URL(FRED_BASE);
    url.searchParams.set('series_id',  seriesId);
    url.searchParams.set('api_key',    apiKey);
    url.searchParams.set('file_type',  'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit',      String(limit));
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const { observations = [] } = await res.json();
    // Keep only real numeric observations (FRED uses '.' for missing days).
    const rows = observations
      .filter(o => o.value !== '.' && o.value !== '')
      .map(o => ({ date: o.date, value: parseFloat(o.value) }))
      .filter(o => Number.isFinite(o.value));
    return { rows };
  } catch (err) {
    return { error: err.message };
  }
}

async function upsertSeries(db, seriesId, rows) {
  let added = 0;
  for (const { date, value } of rows) {
    await db.prepare(
      `INSERT OR REPLACE INTO fred_series (series_id, date, value) VALUES (?, ?, ?)`
    ).bind(seriesId, date, value).run();
    added++;
  }
  return added;
}

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

  const db     = context.env.DB;
  const apiKey = context.env.FRED_API_KEY;
  if (!db) {
    return new Response(JSON.stringify({ error: 'D1 binding (DB) not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'FRED_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Self-initialize the table so the first nightly call works without a migration.
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS fred_series (
       series_id TEXT NOT NULL, date TEXT NOT NULL, value REAL,
       PRIMARY KEY (series_id, date)
     )`
  ).run();

  const SERIES = ['DFII10', 'BAMLH0A0HYM2', 'DFEDTARU'];
  const saved = {};
  for (const seriesId of SERIES) {
    const r = await fetchFredRecent(seriesId, apiKey);
    if (r.error) { saved[seriesId] = { error: r.error }; continue; }
    const added = await upsertSeries(db, seriesId, r.rows);
    saved[seriesId] = { added, latest: r.rows[0] ?? null };
  }

  return new Response(JSON.stringify({ timestamp: new Date().toISOString(), saved }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
