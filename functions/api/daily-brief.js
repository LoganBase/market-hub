/**
 * Market Hub — Daily Brief API
 * GET /api/daily-brief
 * GET /api/daily-brief?date=YYYY-MM-DD
 * GET /api/daily-brief?search=fed+rates     (FTS5 full-text search)
 * GET /api/daily-brief?range=5              (last N days, for weekly rollup)
 *
 * Weekend behaviour (Sat/Sun, no query params):
 *   Returns a weekly summary of the last 5 trading days instead of
 *   "no brief found." Saturday and Sunday return the same response.
 *   Shape: { isWeekly, weekLabel, weekStart, briefs, avgSentiment, dominantSector }
 */

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function formatRow(row) {
  let bullets;
  try { bullets = JSON.parse(row.bullets); } catch { bullets = []; }
  return {
    date:       row.date,
    bullets,
    sentiment:  row.sentiment,
    sector:     row.sector,
    model:      row.model,
    created_at: row.created_at,
    source:     'briefing.com',
  };
}

// Returns the ISO date string for Monday of the week containing `d` (UTC).
function getMondayStr(d) {
  const day  = d.getUTCDay(); // 0=Sun, 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

function getWeekLabel(mondayStr) {
  const d = new Date(mondayStr + 'T12:00:00Z');
  return 'Week of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not available' }), { status: 503, headers: CORS });
  }

  const url    = new URL(context.request.url);
  const date   = url.searchParams.get('date');    // YYYY-MM-DD exact lookup
  const search = url.searchParams.get('search');  // FTS query string
  const range  = parseInt(url.searchParams.get('range') ?? '0', 10); // last N days

  try {
    // ── Full-text search ──────────────────────────────────────────────────────
    if (search) {
      // Sanitize: FTS5 MATCH syntax errors leak schema details; strip special chars
      const safeSearch = search.replace(/["'*():^]/g, ' ').trim();
      if (!safeSearch) {
        return new Response(JSON.stringify({ results: [] }), { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } });
      }
      const { results } = await db.prepare(`
        SELECT b.* FROM daily_briefs b
        JOIN daily_briefs_fts f ON b.id = f.rowid
        WHERE daily_briefs_fts MATCH ?
        ORDER BY b.date DESC
        LIMIT 20
      `).bind(safeSearch).all();

      return new Response(JSON.stringify({ results: (results ?? []).map(formatRow) }), {
        headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
      });
    }

    // ── Last N days (weekly rollup feed, explicit) ────────────────────────────
    if (range >= 2) {
      const { results } = await db.prepare(`
        SELECT * FROM daily_briefs
        ORDER BY date DESC
        LIMIT ?
      `).bind(Math.min(range, 30)).all();

      return new Response(JSON.stringify({ results: (results ?? []).map(formatRow) }), {
        headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
      });
    }

    // ── Weekend: return weekly summary of last 5 trading days ─────────────────
    // Weekend detection uses America/New_York (US market convention). Using UTC
    // flipped the weekday Daily Brief into the weekend Weekly rollup ~4h early —
    // from 8pm ET Friday, when UTC rolls into Saturday. Matches macro-brief.js.
    const etFmt    = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' });
    const todayStr = etFmt.format(new Date()); // YYYY-MM-DD in ET
    const etDay    = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date());
    const DOW_IDX  = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow      = DOW_IDX[etDay] ?? 1; // 0=Sun, 6=Sat

    if ((dow === 0 || dow === 6) && !date) {
      const monStr  = getMondayStr(new Date(todayStr + 'T12:00:00Z'));
      const wLabel  = getWeekLabel(monStr);

      const { results } = await db.prepare(`
        SELECT * FROM daily_briefs
        WHERE date < ?
        ORDER BY date DESC
        LIMIT 5
      `).bind(todayStr).all();

      if (!results || !results.length) {
        return new Response(JSON.stringify({ error: 'No briefs found for this week', isWeekly: true }), {
          status: 404, headers: CORS,
        });
      }

      const briefs = results.map(r => {
        let bullets;
        try { bullets = JSON.parse(r.bullets); } catch { bullets = []; }
        return { date: r.date, bullets, sentiment: r.sentiment, sector: r.sector };
      });

      const sentiments    = briefs.map(b => b.sentiment);
      const avgSentiment  = Math.round((sentiments.reduce((a, b) => a + b, 0) / sentiments.length) * 10) / 10;
      const sectorCounts  = {};
      briefs.forEach(b => { sectorCounts[b.sector] = (sectorCounts[b.sector] || 0) + 1; });
      const dominantSector = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])[0][0];

      return new Response(JSON.stringify({
        isWeekly:       true,
        weekLabel:      wLabel,
        weekStart:      monStr,
        briefs,
        avgSentiment,
        dominantSector,
        source:         'briefing.com',
      }), {
        headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // ── Single day lookup (or most recent) ───────────────────────────────────
    const row = date
      ? await db.prepare('SELECT * FROM daily_briefs WHERE date = ?').bind(date).first()
      : await db.prepare('SELECT * FROM daily_briefs ORDER BY date DESC LIMIT 1').first();

    if (!row) {
      return new Response(JSON.stringify({ error: 'No brief found', date: date ?? null }), {
        status: 404, headers: CORS,
      });
    }

    return new Response(JSON.stringify(formatRow(row)), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
