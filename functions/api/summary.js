/**
 * Market Hub — AI Summary API
 * POST /api/summary
 *
 * Accepts a card object (from /api/scores) and deep dive context,
 * returns a 2-3 sentence analyst summary from Claude Haiku.
 *
 * Summaries are cached in KV (binding: SUMMARIES) keyed by
 * summary:{cardId}:{range}:{YYYY-MM-DD} — same card+range on the same
 * day returns instantly; each day's entry is kept indefinitely for
 * future monthly history views.
 *
 * Requires env vars: ANTHROPIC_API_KEY
 * Requires KV binding: SUMMARIES
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5-20251001';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST' },
    });
  }

  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'ANTHROPIC_API_KEY not set. Add it in Cloudflare Pages → Settings → Environment variables.',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const { card, deepDive, allCards, aggregate } = await context.request.json();

    const today    = new Date().toISOString().slice(0, 10);
    const isAggregate = card.id === 'aggregate';
    const range    = deepDive?.['Range shown'] || 'unknown';
    const cacheKey = isAggregate
      ? `summary:aggregate:all:${today}`
      : `summary:${card.id}:${range}:${today}`;
    const kv       = context.env.SUMMARIES;

    // Return cached summary if available
    if (kv) {
      const cached = await kv.get(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ summary: cached, cached: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    let prompt;

    if (isAggregate && allCards && aggregate) {
      const cardLines = allCards.map(c => {
        const topRows = (c.rows || []).slice(0, 2)
          .map(r => `${r.label}: ${r.value} (${r.status})`)
          .join(', ');
        return `  ${c.number}. ${c.title} [${c.status.toUpperCase()}] — ${topRows}`;
      }).join('\n');

      prompt =
        `You are a concise institutional macro analyst. Write a 3-4 sentence plain-English executive ` +
        `summary of this market dashboard. Cover the overall posture, which areas are most constructive ` +
        `or concerning, and what the combination of signals means for portfolio positioning. ` +
        `Be specific about the numbers. No bullet points. No headers.\n\n` +
        `Overall Score: ${aggregate.score} — ${aggregate.label}\n` +
        `Posture: ${aggregate.posture}\n` +
        `Breakdown: ${aggregate.bullish} Bullish | ${aggregate.neutral} Neutral | ${aggregate.bearish} Bearish\n\n` +
        `Card Signals:\n${cardLines}\n\n` +
        `Start with "The market dashboard is currently showing" and give your assessment.`;
    } else {
      const indicatorLines = (card.rows || [])
        .map(r => `  - ${r.label}: ${r.value} — ${r.condition} (${r.status})`)
        .join('\n');

      const deepDiveLines = deepDive && Object.keys(deepDive).length
        ? '\nDeep Dive Metrics:\n' + Object.entries(deepDive)
            .map(([k, v]) => `  - ${k}: ${v}`)
            .join('\n')
        : '';

      prompt =
        `You are a concise institutional market analyst. Write a 2-3 sentence plain-English summary ` +
        `of the following dashboard card. Be specific about the numbers. Explain what the combination ` +
        `of signals means for investors. No bullet points. No headers.\n\n` +
        `Card: ${card.title} — ${card.subtitle}\n` +
        `Overall Status: ${card.status.toUpperCase()}\n\n` +
        `Indicators:\n${indicatorLines}` +
        `${deepDiveLines}\n\n` +
        `Start with "${card.title} is ${card.status}" and explain why based on the data.`;
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: isAggregate ? 350 : 250,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 200)}`);
    }

    const result  = await response.json();
    const summary = result.content?.[0]?.text ?? '';

    // Persist to KV (no TTL — kept indefinitely for historical reference)
    if (kv && summary) {
      await kv.put(cacheKey, summary, { expirationTtl: 31_536_000 }); // 365 days
    }

    return new Response(JSON.stringify({ summary, cached: false }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
