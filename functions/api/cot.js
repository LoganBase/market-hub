/**
 * GET /api/cot
 *
 * Returns the last 3 years of CFTC Commitment of Traders data for three
 * contracts: S&P 500 e-mini (ES), Gold (GC), WTI Crude (CL).
 *
 * For each contract, returns:
 *   - weekly net speculative positioning history
 *   - current percentile vs the trailing 3-year range
 *   - crowding classification (crowded_long / crowded_short / neutral)
 */

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
};

const CONTRACTS = ['ES', 'GC', 'CL'];
const CONTRACT_LABELS = { ES: 'S&P 500 Futures', GC: 'Gold', CL: 'WTI Crude' };

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET' } });
  }

  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not available' }), { status: 500, headers: CORS });

  try {
    const { results } = await db.prepare(`
      SELECT report_date, contract, noncomm_net, open_interest, net_pct_oi
      FROM cot_data
      WHERE contract IN ('ES', 'GC', 'CL')
      ORDER BY contract, report_date ASC
    `).all();

    const byContract = {};
    for (const row of results) {
      if (!byContract[row.contract]) byContract[row.contract] = [];
      byContract[row.contract].push(row);
    }

    const contracts = CONTRACTS.map(key => {
      const rows = byContract[key] || [];
      if (!rows.length) return { key, label: CONTRACT_LABELS[key], empty: true };

      const dates   = rows.map(r => r.report_date);
      const netPcts = rows.map(r => r.net_pct_oi);
      const current = netPcts[netPcts.length - 1];

      // Percentile of current vs all history
      const sorted = [...netPcts].sort((a, b) => a - b);
      const rank   = sorted.filter(v => v <= current).length;
      const pctile = Math.round((rank / sorted.length) * 100);

      const crowding = pctile >= 80 ? 'crowded_long'
                     : pctile <= 20 ? 'crowded_short'
                     : 'neutral';

      const latest = rows[rows.length - 1];

      return {
        key,
        label:        CONTRACT_LABELS[key],
        reportDate:   latest.report_date,
        noncommNet:   latest.noncomm_net,
        openInterest: latest.open_interest,
        netPctOi:     current,
        pctile,
        crowding,
        dates,
        netPcts,
      };
    });

    return new Response(JSON.stringify({ contracts }), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
