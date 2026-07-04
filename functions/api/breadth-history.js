/**
 * Market Hub — NYSE Breadth History
 * GET /api/breadth-history?range=5y
 *
 * Returns $MMTH (% NYSE above 200d SMA) and $MMFI (% NYSE above 50d SMA)
 * time series from the D1 market_breadth table.
 */

const RANGE_DAYS = {
  '10y': 3650,
  '5y':  1825,
  '3y':  1095,
  '1y':  365,
  '6mo': 183,
  '3mo': 92,
  '1mo': 31,
  '20d': 20,
  '1wk': 7,
};

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function zoneOf(v) {
  if (v == null) return null;
  return v >= 70 ? 'bull' : v >= 40 ? 'neutral' : 'bear';
}

function computeDaysInZone(rows, field = 'pct_above_200d') {
  if (!rows.length) return 0;
  const current = rows[0][field];
  if (current == null) return 0;
  const zone = zoneOf(current);
  let count = 0;
  for (const row of rows) {
    if (row[field] == null) break;
    if (zoneOf(row[field]) !== zone) break;
    count++;
  }
  return count;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const url   = new URL(context.request.url);
  const range = url.searchParams.get('range') || '5y';
  const days  = RANGE_DAYS[range] ?? RANGE_DAYS['5y'];
  const db    = context.env.DB;

  try {
    if (!db) throw new Error('D1 not available');
    const startDate = startDateFor(days);

    const [chartRes, zoneRes] = await Promise.all([
      db.prepare(
        `SELECT date, pct_above_200d, pct_above_50d, adid_nyse, adid_nasdaq
         FROM market_breadth
         WHERE date >= ?
           AND (pct_above_200d IS NOT NULL OR pct_above_50d IS NOT NULL
                OR adid_nyse IS NOT NULL OR adid_nasdaq IS NOT NULL)
         ORDER BY date ASC`
      ).bind(startDate).all(),
      db.prepare(
        `SELECT pct_above_200d, pct_above_50d FROM market_breadth
         WHERE pct_above_200d IS NOT NULL AND pct_above_50d IS NOT NULL
         ORDER BY date DESC LIMIT 500`
      ).all(),
    ]);

    const rows     = chartRes.results || [];
    const current  = rows[rows.length - 1] ?? {};
    const zoneRows = zoneRes.results || [];
    const mmthDelta = zoneRows.length >= 6 ? zoneRows[0].pct_above_200d - zoneRows[5].pct_above_200d : null;
    const mmfiDelta = zoneRows.length >= 6 ? zoneRows[0].pct_above_50d  - zoneRows[5].pct_above_50d  : null;
    const dirOf = (d) => d == null ? null : d > 1 ? 'up' : d < -1 ? 'down' : 'flat';

    return new Response(JSON.stringify({
      dates: rows.map(r => r.date),
      mmth:  rows.map(r => r.pct_above_200d ?? null),
      mmfi:  rows.map(r => r.pct_above_50d  ?? null),
      adid_nyse:   rows.map(r => r.adid_nyse   ?? null),
      adid_nasdaq: rows.map(r => r.adid_nasdaq ?? null),
      summary: {
        currentMmth:   current.pct_above_200d ?? null,
        currentMmfi:   current.pct_above_50d  ?? null,
        daysInZone:    computeDaysInZone(zoneRows, 'pct_above_200d'),
        daysInZone50d: computeDaysInZone(zoneRows, 'pct_above_50d'),
        mmthDir: dirOf(mmthDelta),
        mmfiDir: dirOf(mmfiDelta),
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
