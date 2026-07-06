/**
 * Market Hub — Score Snapshot API
 * Cloudflare Pages Function: GET /api/score-snapshot
 *
 * Persists one daily row of the three horizon scores + matrix quadrant into the D1
 * `score_history` table — the data layer for the Historical Scorecard chart. Called
 * nightly by workers/data-refresh after the refresh + fred-refresh batches.
 *
 * Reads freshly-computed scores from same-origin /api/scores (cache-busted), the
 * snapshot date from MAX(date) in daily_prices (the market data date the scores
 * reflect), and that day's sentiment/sector from daily_briefs. Self-creates the
 * table. Only stores when source === 'd1' (skips degraded Yahoo-fallback runs).
 *
 * Auth: X-Hub-Token must match env.HUB_TOKEN. Requires env: HUB_TOKEN, DB (D1).
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.headers.get('X-Hub-Token') !== env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'D1 binding (DB) not configured' }), { status: 500, headers: CORS });
  }

  // Self-initialize the table so the first nightly call works without a migration.
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS score_history (
       date TEXT PRIMARY KEY,
       speedometer REAL, compass REAL, anchor REAL,
       quadrant TEXT, sizing_factor REAL,
       brief_sentiment INTEGER, brief_sector TEXT, brief_theme TEXT
     )`
  ).run();

  // Fresh scores — cache-bust so we capture the post-refresh values, not a stale CDN copy.
  let scores;
  try {
    const url = new URL('/api/scores?_snap=' + Date.now(), request.url);
    scores = await (await fetch(url.toString(), { headers: { Accept: 'application/json' } })).json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'scores fetch failed: ' + err.message }), { status: 502, headers: CORS });
  }

  const h = scores?.horizons;
  if (!h || scores.source !== 'd1') {
    return new Response(JSON.stringify({ skipped: true, reason: `no horizons or source=${scores?.source ?? 'none'}` }), { headers: CORS });
  }

  // Snapshot date = latest market data date the scores reflect.
  const dRow = await db.prepare(`SELECT MAX(date) AS d FROM daily_prices`).first();
  const date = dRow?.d || new Date().toISOString().slice(0, 10);

  // Brief context (optional — daily_briefs may be sparse or absent).
  let brief = {};
  try {
    brief = (await db.prepare(`SELECT sentiment, sector FROM daily_briefs ORDER BY date DESC LIMIT 1`).first()) || {};
  } catch (e) { /* table may not exist yet */ }

  const round1 = (x) => (x == null || isNaN(x) ? null : Math.round(x * 10) / 10);

  // UPSERT on date. brief_theme is intentionally left out of the UPDATE set so a
  // weekly-set theme (Phase 5) is preserved across nightly score refreshes.
  await db.prepare(
    `INSERT INTO score_history
       (date, speedometer, compass, anchor, quadrant, sizing_factor, brief_sentiment, brief_sector)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       speedometer = excluded.speedometer, compass = excluded.compass, anchor = excluded.anchor,
       quadrant = excluded.quadrant, sizing_factor = excluded.sizing_factor,
       brief_sentiment = excluded.brief_sentiment, brief_sector = excluded.brief_sector`
  ).bind(
    date,
    round1(h.speedometer?.score), round1(h.compass?.score), round1(h.anchor?.score),
    h.matrix?.quadrant ?? null, h.matrix?.sizingFactor ?? null,
    brief.sentiment ?? null, brief.sector ?? null
  ).run();

  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    stored: {
      date,
      speedometer: round1(h.speedometer?.score),
      compass:     round1(h.compass?.score),
      anchor:      round1(h.anchor?.score),
      quadrant:    h.matrix?.quadrant ?? null,
      sizing_factor: h.matrix?.sizingFactor ?? null,
      brief_sentiment: brief.sentiment ?? null,
      brief_sector:    brief.sector ?? null,
    },
  }), { headers: CORS });
}
