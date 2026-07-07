/**
 * Market Hub — Score History API
 * Cloudflare Pages Function: GET /api/score-history?range=3m|6m|1y|2y|all
 *
 * Serves the daily horizon-score series + quadrant-transition annotations for the
 * Historical Scorecard chart, from the D1 `score_history` table (populated nightly
 * by /api/score-snapshot and backfilled by seed/seed_score_history.py).
 */

const RANGE_DAYS = { '3m': 92, '6m': 183, '1y': 366, '2y': 731, 'all': 100000 };

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };
  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: cors });

  const range  = new URL(context.request.url).searchParams.get('range') || '1y';
  const days   = RANGE_DAYS[range] ?? RANGE_DAYS['1y'];
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  let results = [];
  try {
    ({ results = [] } = await db.prepare(
      `SELECT date, speedometer, compass, anchor, quadrant, sizing_factor,
              brief_sentiment, brief_sector, brief_theme
       FROM score_history WHERE date >= ? ORDER BY date ASC`
    ).bind(cutoff).all());
  } catch (e) {
    return new Response(JSON.stringify({ error: 'query failed: ' + e.message }), { status: 500, headers: cors });
  }

  // Annotations: quadrant transitions (regime changes) — the narrative markers.
  // Only keep transitions where the NEW regime persists >= MIN_RUN trading days, so
  // 1-2 day flickers don't clutter the chart.
  const MIN_RUN = 4;
  const annotations = [];
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.quadrant && r.quadrant !== results[i - 1].quadrant) {
      let run = 1;
      while (i + run < results.length && results[i + run].quadrant === r.quadrant) run++;
      if (run >= MIN_RUN) {
        annotations.push({
          i, date: r.date, kind: 'regime', quadrant: r.quadrant,
          theme: r.brief_theme || null,
          scores: [r.speedometer, r.compass, r.anchor],
        });
      }
    }
  }

  return new Response(JSON.stringify({
    range,
    dates:       results.map(r => r.date),
    speedometer: results.map(r => r.speedometer),
    compass:     results.map(r => r.compass),
    anchor:      results.map(r => r.anchor),
    quadrants:   results.map(r => r.quadrant),
    sizing:      results.map(r => r.sizing_factor),
    briefSentiment: results.map(r => r.brief_sentiment),
    briefSector:    results.map(r => r.brief_sector),
    themes:         results.map(r => r.brief_theme),
    annotations,
    latest: results[results.length - 1] || null,
  }), { headers: cors });
}
