/**
 * GET /api/treasury-2y?range=5y
 *
 * Returns 2-Year Treasury Constant Maturity Rate from the US Treasury's
 * official daily yield-curve XML feed — no API key required.
 *
 * Source: https://home.treasury.gov/resource-center/data-chart-center/
 *         interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=YYYY
 *
 * Response: { symbol: 'BC_2YEAR', dates: string[], closes: number[] }
 * (same shape as /api/history so the frontend can treat them identically)
 */

const RANGE_DAYS = {
  '10y': 3650, '5y': 1825, '1y': 365, '6mo': 183,
  '3mo': 92,   '1mo': 31,  '20d': 20, '1wk': 7,
};

const TREASURY_URL = (year) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;

function startDateFor(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function yearsForDays(days) {
  const now   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const years = [];
  for (let y = start.getFullYear(); y <= now.getFullYear(); y++) years.push(y);
  return years;
}

function parseTreasuryXml(xml, startDate) {
  const rows   = [];
  // Each trading day is wrapped in <m:properties>…</m:properties>
  const propRe = /<m:properties>([\s\S]*?)<\/m:properties>/g;
  let match;
  while ((match = propRe.exec(xml)) !== null) {
    const block  = match[1];
    const dateM  = block.match(/<d:NEW_DATE[^>]*>([\d-]+)/);
    const valM   = block.match(/<d:BC_2YEAR[^>]*>([\d.]+)/);
    if (!dateM || !valM) continue;
    const date = dateM[1].slice(0, 10);
    if (startDate && date < startDate) continue;
    const val = parseFloat(valM[1]);
    if (isNaN(val)) continue;
    rows.push({ date, close: val });
  }
  return rows;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const url       = new URL(context.request.url);
  const range     = url.searchParams.get('range') || '5y';
  const days      = RANGE_DAYS[range] ?? RANGE_DAYS['5y'];
  const startDate = startDateFor(days);
  const db        = context.env.DB;

  const respHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };

  try {
    // ── D1 first (if DGS2 is ever seeded) ──────────────────────────────
    if (db) {
      const { results } = await db.prepare(
        `SELECT p.date, p.close FROM daily_prices p
         WHERE p.symbol = 'DGS2' AND p.date >= ?
         ORDER BY p.date ASC`
      ).bind(startDate).all();
      if (results?.length >= 5) {
        return new Response(JSON.stringify({
          symbol: 'BC_2YEAR',
          dates:  results.map(r => r.date),
          closes: results.map(r => r.close),
        }), { headers: respHeaders });
      }
    }

    // ── US Treasury XML (official, no auth required) ────────────────────
    const years   = yearsForDays(days);
    const xmlDocs = await Promise.all(
      years.map(y =>
        fetch(TREASURY_URL(y), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MarketHub/1.0)',
            'Accept': 'application/xml, text/xml, */*',
          },
        }).then(r => r.ok ? r.text() : '')
      )
    );

    const allRows = xmlDocs.flatMap(xml => parseTreasuryXml(xml, startDate));
    allRows.sort((a, b) => a.date.localeCompare(b.date));

    // Deduplicate (shouldn't be needed but safe)
    const seen = new Set();
    const rows = allRows.filter(r => { if (seen.has(r.date)) return false; seen.add(r.date); return true; });

    if (!rows.length) throw new Error('No 2Y Treasury data returned');

    return new Response(JSON.stringify({
      symbol: 'BC_2YEAR',
      dates:  rows.map(r => r.date),
      closes: rows.map(r => r.close),
    }), { headers: respHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, dates: [], closes: [] }), {
      status: 500,
      headers: respHeaders,
    });
  }
}
