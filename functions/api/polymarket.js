/**
 * Market Hub — Polymarket Crowd Signals API
 * GET /api/polymarket
 *
 * Fetches curated macro prediction markets from Polymarket's Gamma API.
 * Unauthenticated read-only. Returns signals for the executive summary strip.
 *
 * Tags queried:
 *   101250 — Macro Single (Fed hike, recession, GDP)
 *   102000 — Macro Indicators (inflation, CPI)
 *
 * Response: { signals[], timestamp, source }
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const TAG_MACRO_SINGLE    = 101250;
const TAG_MACRO_INDICATOR = 102000;

const YIELD_KEYWORDS = ['fed', 'rate hike', 'rate cut', 'inflation', 'recession', 'cpi', 'negative gdp'];

function isYieldRelevant(question) {
  const q = question.toLowerCase();
  return YIELD_KEYWORDS.some(k => q.includes(k));
}

function getSentiment(question, probability) {
  const q = question.toLowerCase();
  if (q.includes('rate hike') || q.includes('inflation') || q.includes('recession') || q.includes('negative gdp')) {
    return probability >= 0.55 ? 'bearish' : probability >= 0.25 ? 'neutral' : 'bullish';
  }
  if (q.includes('rate cut')) {
    return probability >= 0.55 ? 'bullish' : probability >= 0.25 ? 'neutral' : 'bearish';
  }
  return 'neutral';
}

function parseField(val) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

function formatSignal(market) {
  const outcomes  = parseField(market.outcomes);
  const prices    = parseField(market.outcomePrices);
  const yesIdx    = outcomes.findIndex(o => String(o).toLowerCase() === 'yes');
  const raw       = parseFloat(yesIdx >= 0 ? prices[yesIdx] : prices[0]);
  if (isNaN(raw)) return null;

  return {
    label:      market.question,
    slug:       market.slug,
    probability: raw,
    weekChange:  market.oneWeekPriceChange != null ? parseFloat(market.oneWeekPriceChange) : null,
    dayChange:   market.oneDayPriceChange  != null ? parseFloat(market.oneDayPriceChange)  : null,
    volume:      parseFloat(market.volume  ?? 0),
    liquidity:   parseFloat(market.liquidity ?? 0),
    endDate:     market.endDate ?? null,
    sentiment:   getSentiment(market.question, raw),
  };
}

async function fetchTag(tagId) {
  try {
    const res = await fetch(
      `${GAMMA}/markets?active=true&closed=false&tag_id=${tagId}&limit=100&order=volume&ascending=false`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  try {
    const [single, indicators] = await Promise.all([
      fetchTag(TAG_MACRO_SINGLE),
      fetchTag(TAG_MACRO_INDICATOR),
    ]);

    const seen = new Set();
    const signals = [...single, ...indicators]
      .filter(m => m.question && !seen.has(m.slug) && seen.add(m.slug) && isYieldRelevant(m.question))
      .map(formatSignal)
      .filter(Boolean)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    return new Response(JSON.stringify({ signals, timestamp: new Date().toISOString(), source: 'polymarket' }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ signals: [], error: err.message, source: 'polymarket' }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
}
