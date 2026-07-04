/**
 * Market Hub — Macro Brief API
 * GET /api/macro-brief
 *
 * Synthesizes the 10-card structural scorecard with today's Briefing.com
 * Close Update into a single paragraph that explicitly reconciles both
 * time horizons (medium-term structural vs. near-term tactical).
 *
 * Data sources (both server-side):
 *   - KV  card-statuses:current  → today's per-card signal statuses
 *   - D1  daily_briefs           → today's Briefing.com Close Update bullets
 *
 * Caches in KV (macro-brief:YYYY-MM-DD) for 24 h to avoid calling Claude
 * on every page load. The next trading day always generates a fresh narrative.
 *
 * Requires: ANTHROPIC_API_KEY env var, SUMMARIES KV binding, DB D1 binding.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5-20251001';

function getMondayStr(d) {
  const day  = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

function getWeekLabel(mondayStr) {
  const d = new Date(mondayStr + 'T12:00:00Z');
  return 'Week of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const SIGNAL_CATEGORIES = [
  { key: 'trend',         label: 'Trend / Momentum',  ids: ['regime', 'leadership', 'sectors', 'equities'], weight: 0.4 },
  { key: 'participation', label: 'Participation',      ids: ['breadth', 'globalflows', 'commodities'],       weight: 0.3 },
  { key: 'macro',         label: 'Macro Conditions',   ids: ['valuations', 'yield', 'credit'],               weight: 0.3 },
];

const CARD_LABELS = {
  regime:      'Market Regime (SPY vs 200d SMA)',
  leadership:  'Market Leadership (equal-weight vs cap-weight)',
  sectors:     'Sector Rotation (cyclicals vs defensives)',
  equities:    'Equities (SPY, QQQ, IWM)',
  breadth:     'Market Breadth (% stocks above 200d)',
  globalflows: 'Global Flows (international ETFs)',
  commodities: 'Commodities (USCI)',
  valuations:  'Valuations (CAPE, forward P/E)',
  yield:       'Treasury Yields (10-year)',
  credit:      'Credit Conditions (HYG)',
};

function buildAggFromStatuses(statuses) {
  let weightedPct = 0;
  const categories = SIGNAL_CATEGORIES.map(cat => {
    const catStatuses = cat.ids.map(id => statuses[id]).filter(Boolean);
    if (!catStatuses.length) return null;
    const bull = catStatuses.filter(s => s === 'bullish').length;
    const neu  = catStatuses.filter(s => s === 'neutral').length;
    const bear = catStatuses.filter(s => s === 'bearish').length;
    const pct  = (bull + neu * 0.5) / catStatuses.length;
    weightedPct += pct * cat.weight;
    const glow = pct >= 0.70 ? 'green' : pct >= 0.40 ? 'yellow' : 'red';
    const summary = `${bull > 0 ? bull + ' bullish' : ''}${neu > 0 ? (bull > 0 ? ', ' : '') + neu + ' neutral' : ''}${bear > 0 ? (bull + neu > 0 ? ', ' : '') + bear + ' bearish' : ''}`.trim();
    return {
      key: cat.key, label: cat.label, weight: cat.weight,
      bull, neu, bear, glow, pct, summary,
      cards: cat.ids.map(id => ({ id, label: CARD_LABELS[id] || id, status: statuses[id] || 'unknown' })),
    };
  }).filter(Boolean);

  const score = (weightedPct * 10).toFixed(1);
  const label = weightedPct >= 0.70 ? 'Risk-On — Broad Participation'
              : weightedPct >= 0.40 ? 'Mixed Signals — Selective'
              : 'Risk-Off — Reduce Exposure';
  const regimeBearish = statuses['regime'] === 'bearish';

  return { score, label, weightedPct, categories, regimeBearish };
}

function buildScorecardBlock(agg) {
  const catLines = agg.categories.map(cat => {
    const glowWord = cat.glow === 'green' ? 'constructive' : cat.glow === 'red' ? 'restrictive' : 'mixed';
    const cardDetail = cat.cards.map(c => `${c.label} [${c.status}]`).join(', ');
    return `  ${cat.label} (${Math.round(cat.weight * 100)}% weight) — ${cat.summary}, ${glowWord}\n    ${cardDetail}`;
  }).join('\n');
  const regimeLine = agg.regimeBearish
    ? '\n  ⚠ REGIME WARNING: SPY is below its 200-day SMA — primary trend is bearish.'
    : '';
  return `STRUCTURAL SCORECARD (medium-term, 4–12 week horizon):\nScore: ${agg.score}/10 — ${agg.label}\n${catLines}${regimeLine}`;
}

// Daily prompt: reconcile one day's action with the structural scorecard.
function buildDailyPrompt(agg, brief, crowdSummary) {
  const bulletLines = brief.bullets.map(b => `  • ${b}`).join('\n');
  const briefDate   = new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const crowdBlock  = crowdSummary
    ? `\nCROWD PREDICTION MARKETS (Kalshi + Polymarket synthesis):\n  ${crowdSummary}\n`
    : '';
  return `You are a senior portfolio manager writing a concise daily macro brief for institutional clients.

${buildScorecardBlock(agg)}
${crowdBlock}
TODAY'S MARKET ACTION — Briefing.com Close Update, ${briefDate}:
${bulletLines}

Write one tight paragraph (5–7 sentences) reconciling all horizons. Requirements:
1. Open with today's price action and its clearest implication.
2. Explicitly state whether today's action CONFIRMS or CONTRADICTS the structural scorecard — use those words.
3. Name the one or two structural signals most relevant to interpreting today's move.${crowdSummary ? '\n4. If crowd prediction markets are included, weave in what they imply about the forward path — do they align with or diverge from the structural signals?' : ''}
${crowdSummary ? '5.' : '4.'} If the regime warning is active, acknowledge the tension between any near-term strength and the broken primary trend.
${crowdSummary ? '6.' : '5.'} Close with a specific, actionable positioning implication for the next 2–4 weeks.
Rules: No hedging phrases. No "it's worth noting." No bullet points. No headers. Flowing institutional prose only.`;
}

// Weekly prompt: synthesize a full week of action with the structural scorecard.
function buildWeeklyPrompt(agg, briefs, weekLabel, crowdSummary) {
  const dayLines = briefs.map(b => {
    const dl = new Date(b.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const bullets = b.bullets.slice(0, 4).map(x => `    • ${x}`).join('\n');
    return `  ${dl} (sentiment ${b.sentiment > 0 ? '+' : ''}${b.sentiment}, sector: ${b.sector}):\n${bullets}`;
  }).join('\n');
  const crowdBlock = crowdSummary
    ? `\nCROWD PREDICTION MARKETS (Kalshi + Polymarket synthesis):\n  ${crowdSummary}\n`
    : '';
  return `You are a senior portfolio manager writing a concise weekly macro brief for institutional clients.

${buildScorecardBlock(agg)}
${crowdBlock}
THIS WEEK'S MARKET ACTION — Briefing.com Close Updates, ${weekLabel}:
${dayLines}

Write one tight paragraph (6–8 sentences) synthesizing the week's market action against the structural scorecard. Requirements:
1. Open with the week's dominant theme and its net result for equity markets.
2. Explicitly state whether the week's action CONFIRMS or CONTRADICTS the structural scorecard — use those words.
3. Name the most important structural signals that either explained or were challenged by the week's moves.${crowdSummary ? '\n4. Incorporate what prediction markets are pricing for the Fed and risk outlook — does it support or complicate the week\'s narrative?' : ''}
${crowdSummary ? '5.' : '4.'} If the regime warning is active, address the tension between any weekly strength and the bearish primary trend.
${crowdSummary ? '6.' : '5.'} Close with a specific positioning implication heading into the following week.
Rules: No hedging phrases. No "it's worth noting." No bullet points. No headers. Flowing institutional prose only.`;
}

export async function onRequest(context) {
  try {
    return await _onRequest(context);
  } catch (topErr) {
    return new Response(JSON.stringify({ error: 'Unhandled: ' + (topErr?.message ?? String(topErr)) }), { status: 500, headers: CORS });
  }
}

async function _onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  const db  = context.env.DB;
  const kv  = context.env.SUMMARIES;
  const key = context.env.ANTHROPIC_API_KEY;

  if (!key) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: CORS });
  }

  // Use America/New_York for all date logic — US market convention.
  // sv-SE locale produces YYYY-MM-DD natively; avoids UTC date bleeding into next day after 8pm ET.
  const etFmt    = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' });
  const todayStr = etFmt.format(new Date());
  const etDay    = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date());
  const DOW_IDX  = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow      = DOW_IDX[etDay] ?? 1;
  const isWeekend = dow === 0 || dow === 6;

  // Query up to the next calendar day (ET+1) to catch emails stored in UTC that
  // crossed midnight UTC while still being the same ET business day.
  const nextDay    = new Date(todayStr + 'T12:00:00Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);

  const nowUtc   = new Date();
  const monStr   = isWeekend ? getMondayStr(nowUtc) : null;
  const wLabel   = isWeekend ? getWeekLabel(monStr) : null;
  const cacheKey = isWeekend ? `macro-brief-weekly:${monStr}` : `macro-brief:${todayStr}`;

  // Return cached narrative if available
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, 'json');
      if (cached) {
        return new Response(JSON.stringify({ ...cached, cached: true }), {
          headers: { ...CORS, 'Cache-Control': 'private, no-store' },
        });
      }
    } catch { /* non-fatal */ }
  }

  // Read card statuses and (optional) crowd signals summary from KV
  let statuses     = null;
  let crowdSummary = null;
  if (kv) {
    try {
      const [current, crowd] = await Promise.all([
        kv.get('card-statuses:current', 'json'),
        kv.get(`crowd-signals-summary:${todayStr}`),
      ]);
      if (current?.statuses) statuses = current.statuses;
      crowdSummary = crowd ?? null;
    } catch { /* non-fatal */ }
  }

  if (!statuses) {
    // KV binding missing or key not yet written — fall back to fetching scores directly
    try {
      const scoresUrl = new URL(context.request.url);
      scoresUrl.pathname = '/api/scores';
      scoresUrl.search   = '';
      const res = await fetch(scoresUrl.toString());
      if (res.ok) {
        const data = await res.json();
        if (data.cards?.length) {
          statuses = {};
          data.cards.forEach(c => { statuses[c.id] = c.status; });
        }
      }
    } catch { /* non-fatal */ }
  }

  if (!statuses) {
    return new Response(JSON.stringify({ error: 'No scorecard data available — market data may still be loading.' }), {
      status: 404, headers: CORS,
    });
  }

  // Read brief(s) from D1 — last 5 for weekends, today only for weekdays
  let brief  = null;   // single day (weekday)
  let briefs = null;   // week array (weekend)

  if (db) {
    try {
      if (isWeekend) {
        const { results } = await db.prepare(
          'SELECT date, bullets, sentiment, sector FROM daily_briefs WHERE date < ? ORDER BY date DESC LIMIT 5'
        ).bind(todayStr).all();
        if (results?.length) {
          briefs = results.map(r => ({
            date: r.date, bullets: JSON.parse(r.bullets), sentiment: r.sentiment, sector: r.sector,
          }));
        }
      } else {
        // Query up to nextDayStr to catch emails whose UTC date crossed midnight while still being today ET
        const row = await db.prepare(
          'SELECT date, bullets, sentiment, sector FROM daily_briefs WHERE date <= ? ORDER BY date DESC LIMIT 1'
        ).bind(nextDayStr).first();
        if (row) brief = { date: row.date, bullets: JSON.parse(row.bullets), sentiment: row.sentiment, sector: row.sector };
      }
    } catch { /* non-fatal */ }
  }

  if (!brief && !briefs) {
    return new Response(JSON.stringify({
      error: isWeekend
        ? 'No briefs found for this week. Synthesis requires at least one Close Update.'
        : 'No Briefing.com Close Update available yet. Brief arrives after market close.',
    }), { status: 404, headers: CORS });
  }

  // Build prompt and call Claude
  const agg    = buildAggFromStatuses(statuses);
  const prompt = isWeekend
    ? buildWeeklyPrompt(agg, briefs, wLabel, crowdSummary)
    : buildDailyPrompt(agg, brief, crowdSummary);

  let narrative;
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
        max_tokens: 700,
        system:     'You are a senior portfolio manager. Write only a single paragraph of flowing institutional prose. No markdown. No headers. No titles. No dates. No bullet points. Begin directly with the market action.',
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    narrative  = data.content?.[0]?.text?.trim() ?? '';
    if (!narrative) throw new Error('Empty response from Claude');
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: CORS });
  }

  const result = {
    narrative,
    date:       todayStr,
    briefDate:  isWeekend ? briefs[0].date : brief.date,
    isWeekly:   isWeekend,
    weekLabel:  wLabel ?? null,
    score:      agg.score,
    model:      MODEL,
    cached:     false,
  };

  // Cache for 24 h
  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86_400 });
    } catch { /* non-fatal */ }
  }

  return new Response(JSON.stringify(result), {
    headers: { ...CORS, 'Cache-Control': 'private, no-store' },
  });
}
