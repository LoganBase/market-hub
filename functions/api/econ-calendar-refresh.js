/**
 * Market Hub — Economic Calendar Refresh
 * Cloudflare Pages Function: GET /api/econ-calendar-refresh
 *
 * Pulls the next 7 days of US economic releases from FMP (Fed meetings, CPI,
 * jobs reports, PMI, etc.) into D1. Feeds daily-brief-generate's "what's
 * next" catalyst line with real scheduled dates instead of depending on
 * Finnhub news happening to mention one.
 *
 * Auth: X-Hub-Token. Env: DB, FMP_API_KEY.
 * Runs nightly from data-refresh, before daily-brief-generate.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const FMP_BASE = 'https://financialmodelingprep.com/stable';

function fmtDate(d) { return d.toISOString().slice(0, 10); }

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
  if (!env.FMP_API_KEY) return new Response(JSON.stringify({ error: 'FMP_API_KEY not set' }), { status: 500, headers: CORS });

  const today = new Date();
  const from = fmtDate(today);
  const toDate = new Date(today);
  toDate.setUTCDate(toDate.getUTCDate() + 7);
  const to = fmtDate(toDate);

  const url = `${FMP_BASE}/economic-calendar?from=${from}&to=${to}&apikey=${env.FMP_API_KEY}`;
  let events;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `FMP ${res.status}: ${text.slice(0, 300)}`, urlTried: url.replace(env.FMP_API_KEY, 'REDACTED') }), { status: 502, headers: CORS });
    }
    events = await res.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'FMP fetch failed: ' + e.message }), { status: 502, headers: CORS });
  }

  if (!Array.isArray(events)) {
    return new Response(JSON.stringify({ error: 'Unexpected FMP response shape', got: typeof events, sample: JSON.stringify(events).slice(0, 500) }), { status: 502, headers: CORS });
  }

  // Keep US events only — this is what matters for a US equity market brief.
  const usEvents = events.filter(e => e.country === 'US' || e.currency === 'USD');

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS econ_calendar (
      event_date TEXT NOT NULL,
      event_time TEXT,
      country    TEXT,
      event      TEXT NOT NULL,
      actual     TEXT,
      previous   TEXT,
      estimate   TEXT,
      impact     TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (event_date, event, country)
    )
  `).run();

  const now = new Date().toISOString();
  const stmts = usEvents.map(e => {
    const dt = (e.date ?? '').split(' ');
    const eventDate = dt[0] ?? e.date ?? null;
    const eventTime = dt[1] ?? null;
    return db.prepare(`
      INSERT INTO econ_calendar (event_date, event_time, country, event, actual, previous, estimate, impact, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_date, event, country) DO UPDATE SET
        event_time = excluded.event_time, actual = excluded.actual,
        previous = excluded.previous, estimate = excluded.estimate,
        impact = excluded.impact, fetched_at = excluded.fetched_at
    `).bind(
      eventDate, eventTime, e.country ?? null, e.event ?? 'Unknown',
      e.actual != null ? String(e.actual) : null,
      e.previous != null ? String(e.previous) : null,
      e.estimate != null ? String(e.estimate) : null,
      e.impact ?? null, now,
    );
  });

  if (stmts.length) await db.batch(stmts);

  return new Response(JSON.stringify({
    windowFrom: from, windowTo: to,
    totalFetched: events.length, usEventsStored: usEvents.length,
    sample: usEvents.slice(0, 3),
  }), { headers: CORS });
}
