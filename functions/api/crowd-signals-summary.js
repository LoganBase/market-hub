/**
 * Market Hub — Crowd Signals Summary API
 * POST /api/crowd-signals-summary
 * Body: { kalshi: { events: [...] }, poly: { signals: [...] } }
 *
 * Synthesizes Kalshi prediction market data (Fed action, CPI crowd) and
 * Polymarket macro signals into a 2–3 sentence actionable summary using
 * Claude Haiku. Result is cached in KV by date so only one Claude call
 * is made per trading day regardless of how many times the deep-dive opens.
 *
 * Requires: ANTHROPIC_API_KEY env var, SUMMARIES KV binding.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5-20251001';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST' } });
  }
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: CORS });
  }

  const key = context.env.ANTHROPIC_API_KEY;
  const kv  = context.env.SUMMARIES;

  if (!key) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: CORS });
  }

  const today    = new Date().toISOString().slice(0, 10);
  const cacheKey = `crowd-signals-summary:${today}`;

  // Return cached summary if available
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ summary: cached, cached: true }), { headers: CORS });
      }
    } catch { /* non-fatal */ }
  }

  let kalshi, poly;
  try {
    ({ kalshi, poly } = await context.request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const events  = kalshi?.events  || [];
  const signals = poly?.signals   || [];
  const fomc    = events.find(e => e.type === 'fomc');
  const cpi     = events.find(e => e.type === 'cpi');

  if (!fomc && !cpi && !signals.length) {
    return new Response(JSON.stringify({ error: 'No crowd signal data provided' }), { status: 400, headers: CORS });
  }

  // ── Build prompt ───────────────────────────────────────────────────────────
  const kalshiLines = [];
  if (fomc) {
    const from = fomc.currentRate != null ? `${fomc.currentRate.toFixed(2)}% → ` : '';
    kalshiLines.push(`  Fed Action: ${fomc.action || '?'} — ${from}${fomc.consensus || '?'} — ${fomc.confidence ?? '?'}% market confidence`);
  }
  if (cpi) {
    const la = cpi.lastActual ? `, last actual ${cpi.lastActual.value >= 0 ? '+' : ''}${cpi.lastActual.value?.toFixed(1)}% (${cpi.lastActual.month})` : '';
    kalshiLines.push(`  CPI Crowd: consensus ${cpi.consensus || '?'}, ${cpi.confidence ?? '?'}% confidence${la}`);
  }

  const top5       = signals.slice(0, 5);
  const polyLines  = top5.map((s, i) => {
    const pp = s.weekChange != null ? ` ${s.weekChange >= 0 ? '+' : ''}${(s.weekChange * 100).toFixed(1)}pp/7d` : '';
    return `  ${i + 1}. ${s.label} — ${s.sentiment} — ${(s.probability * 100).toFixed(1)}%${pp}`;
  });

  const bulls   = top5.filter(s => s.sentiment === 'bullish').length;
  const bears   = top5.filter(s => s.sentiment === 'bearish').length;
  const n       = top5.length;
  const skewStr = bulls > bears ? `${bulls}/${n} bullish skew`
                : bears > bulls ? `${bears}/${n} bearish skew`
                : 'mixed (no clear directional skew)';

  const prompt = `You are a concise institutional macro analyst. Synthesize the following crowd signal data into an actionable summary.

KALSHI PREDICTION MARKETS:
${kalshiLines.length ? kalshiLines.join('\n') : '  No data'}

POLYMARKET MACRO SIGNALS (top 5 by volume):
${polyLines.length ? polyLines.join('\n') : '  No data'}
Overall Polymarket skew: ${skewStr}

Write 2–3 sentences. Requirements:
1. State what prediction markets collectively expect from the Fed and (if available) from inflation.
2. State whether Polymarket confirms, contradicts, or is ambiguous relative to the Kalshi signals — be explicit.
3. Close with one specific, actionable positioning implication for the next 4–6 weeks.
Rules: No hedging phrases. No "it's worth noting." No bullet points. No headers. Flowing institutional prose only.`;

  // ── Call Claude ────────────────────────────────────────────────────────────
  let summary;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 220,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    summary    = data.content?.[0]?.text?.trim() ?? '';
    if (!summary) throw new Error('Empty response from Claude');
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: CORS });
  }

  // ── Cache for 24 h ─────────────────────────────────────────────────────────
  if (kv && summary) {
    try { await kv.put(cacheKey, summary, { expirationTtl: 86_400 }); } catch { /* non-fatal */ }
  }

  return new Response(JSON.stringify({ summary, cached: false }), { headers: CORS });
}
