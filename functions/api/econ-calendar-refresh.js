/**
 * Market Hub — Economic Calendar Refresh
 * Cloudflare Pages Function: GET /api/econ-calendar-refresh
 *
 * Pulls the next scheduled date for a curated set of major US macro
 * releases (CPI, PPI, jobs report, GDP, PCE, retail sales, industrial
 * production, existing home sales) from FRED's release-calendar API, plus
 * the next FOMC decision from the site's own live Kalshi integration
 * (/api/kalshi). Feeds daily-brief-generate's "what's next" catalyst line
 * with real scheduled dates instead of depending on Finnhub news happening
 * to mention one.
 *
 * Originally built against FMP's /stable/economic-calendar, which returns
 * HTTP 402 on the current FMP plan tier (needs Starter or higher) — this
 * FRED+Kalshi version is free and uses secrets already configured for
 * other endpoints (FRED_API_KEY, and /api/kalshi's own Kalshi access).
 *
 * FRED release_id 101 ("FOMC Press Release") was tried first for the FOMC
 * date but verified (2026-09-10) to fire literally every single day — not
 * a meeting calendar — so it's deliberately excluded; the Kalshi KXFED
 * market's close_time is used instead, which is the real next-meeting date.
 * FRED release_id 180 (weekly jobless claims) is also excluded: real, but
 * too frequent to be a useful "next big catalyst" line.
 *
 * Auth: X-Hub-Token. Env: DB, FRED_API_KEY.
 * Runs nightly from data-refresh, before daily-brief-generate.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const FRED_RELEASE_DATES = 'https://api.stlouisfed.org/fred/release/dates';

// Curated allowlist of major, market-moving recurring US macro releases —
// every entry here is inherently high-impact by construction, so no
// separate impact tier is stored.
const RELEASES = [
  { id: 10,  name: 'Consumer Price Index (CPI)' },
  { id: 46,  name: 'Producer Price Index (PPI)' },
  { id: 50,  name: 'Employment Situation (jobs report)' },
  { id: 53,  name: 'Gross Domestic Product (GDP)' },
  { id: 54,  name: 'Personal Income and Outlays (PCE)' },
  { id: 9,   name: 'Advance Retail Sales' },
  { id: 13,  name: 'Industrial Production' },
  { id: 291, name: 'Existing Home Sales' },
];

function fmtDate(d) { return d.toISOString().slice(0, 10); }

async function fetchNextReleaseDate(release, apiKey, from, to) {
  const url = new URL(FRED_RELEASE_DATES);
  url.searchParams.set('release_id', release.id);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('realtime_start', from);
  url.searchParams.set('realtime_end', to);
  url.searchParams.set('include_release_dates_with_no_data', 'true');
  url.searchParams.set('sort_order', 'asc');
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} for release_id ${release.id}`);
  const { release_dates = [] } = await res.json();
  return release_dates[0]?.date ?? null;
}

async function fetchNextFomc(origin) {
  const res = await fetch(`${origin}/api/kalshi`);
  if (!res.ok) return null;
  const { events = [] } = await res.json();
  const fed = events.find(e => e.type === 'fomc');
  if (!fed || !fed.closeTime) return null;
  return {
    date: fed.closeTime.slice(0, 10),
    detail: `Kalshi-implied ${fed.action} to ${fed.consensus} (${fed.confidence}% confidence)`,
  };
}

export async function onRequest(context) {
  try {
    return await _onRequest(context);
  } catch (topErr) {
    return new Response(JSON.stringify({ error: 'Unhandled: ' + (topErr?.message ?? String(topErr)) }), { status: 500, headers: CORS });
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
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });
  if (!env.FRED_API_KEY) return new Response(JSON.stringify({ error: 'FRED_API_KEY not set' }), { status: 500, headers: CORS });

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS econ_calendar (
      event_date TEXT NOT NULL,
      event      TEXT NOT NULL,
      source     TEXT NOT NULL,
      detail     TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (event_date, event)
    )
  `).run();

  const today = new Date();
  const from = fmtDate(today);
  const toDate = new Date(today);
  toDate.setUTCDate(toDate.getUTCDate() + 45);
  const to = fmtDate(toDate);

  // Keep the table a clean forward-looking calendar.
  await db.prepare(`DELETE FROM econ_calendar WHERE event_date < ?`).bind(from).run();

  const results = [];
  for (const release of RELEASES) {
    try {
      const date = await fetchNextReleaseDate(release, env.FRED_API_KEY, from, to);
      results.push({ event: release.name, source: 'FRED', date, detail: null });
    } catch (e) {
      results.push({ event: release.name, source: 'FRED', date: null, error: e.message });
    }
  }

  try {
    const origin = new URL(request.url).origin;
    const fomc = await fetchNextFomc(origin);
    if (fomc) results.push({ event: 'FOMC Rate Decision', source: 'Kalshi', date: fomc.date, detail: fomc.detail });
  } catch (e) {
    results.push({ event: 'FOMC Rate Decision', source: 'Kalshi', date: null, error: e.message });
  }

  const now = new Date().toISOString();
  const stored = results.filter(r => r.date);
  const stmts = stored.map(r => db.prepare(`
    INSERT INTO econ_calendar (event_date, event, source, detail, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_date, event) DO UPDATE SET
      source = excluded.source, detail = excluded.detail, fetched_at = excluded.fetched_at
  `).bind(r.date, r.event, r.source, r.detail, now));

  if (stmts.length) await db.batch(stmts);

  return new Response(JSON.stringify({
    windowFrom: from, windowTo: to,
    eventsStored: stored.length, results,
  }), { headers: CORS });
}
