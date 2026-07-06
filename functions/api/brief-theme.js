/**
 * Market Hub — Weekly Brief Theme
 * Cloudflare Pages Function: GET /api/brief-theme
 *
 * Distills the dominant market driver of the trailing week from `daily_briefs` into
 * a 2-4 word theme (via Anthropic) and writes it into `score_history.brief_theme`
 * for that week's dates — the "keyword" context for the Historical Scorecard.
 *
 * Called nightly by workers/data-refresh, but gated to actually call Anthropic only
 * once per week (skips if a theme was set within the last 5 days). ?force=1 overrides
 * the gate; ?weeks=N backfills the last N trailing 7-day windows.
 *
 * Auth: X-Hub-Token = env.HUB_TOKEN. Requires: HUB_TOKEN, DB (D1), ANTHROPIC_API_KEY.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const CORS  = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function parseBullets(b) {
  try { const p = JSON.parse(b); return Array.isArray(p) ? p : []; } catch { return b ? [String(b)] : []; }
}
function shiftDate(d, days) {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
}

async function extractTheme(key, briefs) {
  const lines = briefs.map(b =>
    `${b.date} (${b.sector || '—'}, sentiment ${b.sentiment >= 0 ? '+' : ''}${b.sentiment}): ${parseBullets(b.bullets).join(' ')}`
  ).join('\n');
  const prompt =
    `Below are this week's daily market briefs. In 2 to 4 words, name the single dominant ` +
    `market driver or narrative of the week — the phrase a strategist would use as a chart ` +
    `annotation (e.g. "AI-capex euphoria", "tariff shock", "broadening breadth", "Fed pivot hopes"). ` +
    `Reply with ONLY the phrase — no punctuation, no quotes, no explanation.\n\n${lines}`;
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 24,
      system: 'You are a market strategist. Reply with only a 2-4 word theme phrase, lowercase unless a proper noun, no punctuation, no quotes.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const data = await res.json();
  let theme = (data.content?.[0]?.text || '').trim().replace(/^["']+|["']+$/g, '').replace(/[.]+$/, '').trim();
  const words = theme.split(/\s+/);
  if (words.length > 6) theme = words.slice(0, 6).join(' ');
  return theme || null;
}

async function processWindow(db, key, start, end) {
  const { results = [] } = await db.prepare(
    `SELECT date, sentiment, sector, bullets FROM daily_briefs WHERE date >= ? AND date <= ? ORDER BY date ASC`
  ).bind(start, end).all();
  if (!results.length) return { window: [start, end], skipped: 'no briefs' };
  const theme = await extractTheme(key, results);
  if (!theme) return { window: [start, end], skipped: 'no theme' };
  const upd = await db.prepare(
    `UPDATE score_history SET brief_theme = ? WHERE date >= ? AND date <= ?`
  ).bind(theme, start, end).run();
  return { window: [start, end], theme, updated: upd.meta?.changes ?? null };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.headers.get('X-Hub-Token') !== env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const db = env.DB, key = env.ANTHROPIC_API_KEY;
  if (!db)  return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500, headers: CORS });
  if (!key) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: CORS });

  const url   = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  const weeks = parseInt(url.searchParams.get('weeks') || '0', 10);

  const latestRow = await db.prepare(`SELECT MAX(date) AS d FROM score_history`).first();
  const latest = latestRow?.d;
  if (!latest) return new Response(JSON.stringify({ error: 'score_history empty' }), { status: 400, headers: CORS });

  try {
    // Backfill: process the last N trailing 7-day windows (each gets its own theme).
    if (weeks > 0) {
      const windows = [];
      for (let i = 0; i < weeks; i++) {
        const end = shiftDate(latest, -i * 7);
        windows.push(await processWindow(db, key, shiftDate(end, -6), end));
      }
      return new Response(JSON.stringify({ mode: 'backfill', windows }), { headers: CORS });
    }

    // Nightly gate: only call Anthropic if no theme was set within the last 5 days.
    if (!force) {
      const lt = await db.prepare(`SELECT MAX(date) AS d FROM score_history WHERE brief_theme IS NOT NULL`).first();
      if (lt?.d && daysBetween(lt.d, latest) < 5) {
        return new Response(JSON.stringify({ skipped: 'theme fresh', lastTheme: lt.d }), { headers: CORS });
      }
    }

    const result = await processWindow(db, key, shiftDate(latest, -6), latest);
    return new Response(JSON.stringify({ mode: 'weekly', ...result }), { headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: CORS });
  }
}
