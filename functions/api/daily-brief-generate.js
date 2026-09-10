/**
 * Market Hub — Daily Brief Generator (Briefing.com replacement)
 * Cloudflare Pages Function: GET /api/daily-brief-generate
 *
 * Replaces the broken Briefing.com email pipeline. Grounds a Sonnet 5 call in
 * two REAL data sources — never asks the model to invent numbers:
 *   1. Today's own D1 price data (indices, sectors, yields, VIX, commodities,
 *      currency, breadth) — zero hallucination risk, already flowing nightly.
 *   2. Finnhub general market news (/news?category=general) — structured,
 *      sourced, dated articles for the "why" behind the numbers.
 *
 * Output matches daily_briefs' existing shape (bullets/sentiment/sector), so
 * /api/macro-brief and everything downstream needs no changes.
 *
 * NOTE: the prompt below is a DRAFT — the data-pull and write path are the
 * real deliverable here; wording gets refined separately.
 *
 * Auth: X-Hub-Token. Env: DB, FINNHUB_API_KEY, ANTHROPIC_API_KEY.
 * Runs nightly from data-refresh, after /api/refresh has written today's prices.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const FINNHUB = 'https://finnhub.io/api/v1';

const INDEX_SYMS    = ['SPY', 'QQQ', 'IWM', 'RSP'];
const SECTOR_SYMS   = ['XLK', 'XLY', 'XLC', 'XLI', 'XLF', 'XLE', 'XLB', 'XLV', 'XLP', 'XLU', 'XLRE'];
const YIELD_SYMS    = ['^TNX', '^TYX', '^IRX'];
const VOL_SYMS      = ['^VIX'];
const COMMODITY_SYMS = ['GLD', 'SLV', 'USCI', 'CPER'];
const CURRENCY_SYMS  = ['UUP', 'FXE', 'FXY'];
const ALL_SYMS = [...INDEX_SYMS, ...SECTOR_SYMS, ...YIELD_SYMS, ...VOL_SYMS, ...COMMODITY_SYMS, ...CURRENCY_SYMS];

const SECTOR_VOCAB = [
  'Equities', 'Rates', 'Fed/Policy', 'Energy', 'Financials',
  'Commodities', 'Credit', 'FX/Dollar', 'Macro/Data', 'Geopolitics',
];

const SYSTEM_PROMPT = `You are a financial market analyst writing a daily market close summary in the style of an institutional wire service (Briefing.com's "Close Update" is the reference style: dry, numbers-first, no hedging, no speculation beyond what the data and news support).

You will be given (1) today's real closing price data pulled directly from the site's own database, and (2) today's real general market news headlines from Finnhub. Use ONLY these two sources — never invent a price, a percentage, or a news event that isn't in the provided data. If the news doesn't clearly explain a price move, describe the move without inventing a cause.

Return ONLY a valid JSON object. No markdown. No code fences. No explanation.

Required format:
{
  "bullets": ["string", "string"],
  "sentiment": 0,
  "sector": "string"
}

Rules:
- bullets: array of 5-8 strings, ordered by market significance (highest first). Each is one complete sentence under 25 words. Cover: index performance (cap-weight vs equal-weight if they diverge), the sector(s) that moved most and why (per the news, if available), yields/VIX if notable, and the day's clearest news catalyst.
- sentiment: single integer from -5 to +5 reflecting the net impact on US equity markets for this session, consistent with the actual index % moves provided.
- sector: the single dominant theme driving today's session. Must be EXACTLY one of:
  ${SECTOR_VOCAB.join(' | ')}

Return ONLY the JSON object. Nothing else.`;

function pctChange(latest, prior) {
  if (latest == null || prior == null || prior === 0) return null;
  return ((latest - prior) / prior) * 100;
}

async function fetchTodayVsPrior(db, symbols) {
  const ph = symbols.map(() => '?').join(',');
  const { results = [] } = await db.prepare(
    `SELECT symbol, date, close FROM daily_prices
     WHERE symbol IN (${ph}) AND date >= date('now', '-8 days')
     ORDER BY symbol, date DESC`
  ).bind(...symbols).all();

  const bySym = {};
  for (const r of results) (bySym[r.symbol] ??= []).push(r);

  const out = {};
  for (const sym of symbols) {
    const rows = bySym[sym] ?? [];
    const latest = rows[0]?.close ?? null;
    const prior  = rows[1]?.close ?? null;
    out[sym] = { date: rows[0]?.date ?? null, close: latest, prior, pct: pctChange(latest, prior) };
  }
  return out;
}

function fmtPct(x) { return x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + '%'; }
function fmtLevel(x) { return x == null ? '—' : x.toFixed(2); }

function buildDataBlock(idx, sec, yld, vix, cmd, fx, breadth, dataDate) {
  const lines = [];
  lines.push(`DATA DATE: ${dataDate}`);
  lines.push('');
  lines.push('INDICES (level, % change from prior close):');
  for (const s of INDEX_SYMS) lines.push(`  ${s}: ${fmtLevel(idx[s].close)} (${fmtPct(idx[s].pct)})`);
  lines.push('');
  lines.push('SECTORS (% change):');
  for (const s of SECTOR_SYMS) lines.push(`  ${s}: ${fmtPct(sec[s].pct)}`);
  lines.push('');
  lines.push('YIELDS (level %, change in bps from prior close):');
  for (const s of YIELD_SYMS) {
    const bps = yld[s].close != null && yld[s].prior != null ? Math.round((yld[s].close - yld[s].prior) * 100) : null;
    lines.push(`  ${s}: ${fmtLevel(yld[s].close)}% (${bps == null ? '—' : (bps >= 0 ? '+' : '') + bps + 'bps'})`);
  }
  lines.push('');
  lines.push(`VIX: ${fmtLevel(vix['^VIX'].close)} (${fmtPct(vix['^VIX'].pct)})`);
  lines.push('');
  lines.push('COMMODITIES (% change):');
  for (const s of COMMODITY_SYMS) lines.push(`  ${s}: ${fmtPct(cmd[s].pct)}`);
  lines.push('');
  lines.push('CURRENCY (% change):');
  for (const s of CURRENCY_SYMS) lines.push(`  ${s}: ${fmtPct(fx[s].pct)}`);
  if (breadth) {
    lines.push('');
    lines.push('BREADTH:');
    lines.push(`  % stocks above 200d SMA: ${breadth.pct_above_200d ?? '—'}`);
    lines.push(`  % stocks above 50d SMA: ${breadth.pct_above_50d ?? '—'}`);
    lines.push(`  NYSE A/D issues: ${breadth.adid_nyse ?? '—'}`);
    lines.push(`  Nasdaq A/D issues: ${breadth.adid_nasdaq ?? '—'}`);
  }
  return lines.join('\n');
}

async function fetchFinnhubGeneralNews(apiKey) {
  const res = await fetch(`${FINNHUB}/news?category=general&token=${apiKey}`);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  // Keep only items from roughly the last 20 hours, newest first, top 12.
  const cutoff = Date.now() / 1000 - 20 * 3600;
  return items
    .filter(a => a.datetime >= cutoff && a.headline)
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 12);
}

function buildNewsBlock(articles) {
  if (!articles.length) return 'NEWS: none available in the lookback window.';
  const lines = articles.map(a => {
    const t = new Date(a.datetime * 1000).toISOString().slice(11, 16);
    return `  [${t} UTC, ${a.source}] ${a.headline}${a.summary ? ' — ' + a.summary.slice(0, 200) : ''}`;
  });
  return `NEWS (most recent first):\n${lines.join('\n')}`;
}

async function callAnthropic(userPrompt, apiKey) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawText = data.content?.[0]?.text ?? '';
  try { return JSON.parse(rawText); }
  catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in response: ' + rawText.slice(0, 200));
    return JSON.parse(match[0]);
  }
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
  if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: CORS });
  if (!env.FINNHUB_API_KEY) return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not set' }), { status: 500, headers: CORS });

  // 1. Pull today's real data — one bounded query per symbol group.
  const allData = await fetchTodayVsPrior(db, ALL_SYMS);
  const dataDate = allData['SPY']?.date;
  if (!dataDate) {
    return new Response(JSON.stringify({ error: 'No SPY price data — refresh may not have run yet today' }), { status: 404, headers: CORS });
  }

  const pick = (syms) => Object.fromEntries(syms.map(s => [s, allData[s]]));
  const idx = pick(INDEX_SYMS), sec = pick(SECTOR_SYMS), yld = pick(YIELD_SYMS),
        vix = pick(VOL_SYMS), cmd = pick(COMMODITY_SYMS), fx = pick(CURRENCY_SYMS);

  const breadth = await db.prepare(
    `SELECT pct_above_200d, pct_above_50d, adid_nyse, adid_nasdaq FROM market_breadth WHERE date = ?`
  ).bind(dataDate).first();

  const dataBlock = buildDataBlock(idx, sec, yld, vix, cmd, fx, breadth, dataDate);

  // 2. Pull today's real news.
  let articles = [];
  try { articles = await fetchFinnhubGeneralNews(env.FINNHUB_API_KEY); }
  catch (e) { /* non-fatal — proceed with data-only bullets */ }
  const newsBlock = buildNewsBlock(articles);

  // 3. Synthesize with Sonnet 5. One retry — this runs once nightly, and a
  // single slow/failed response shouldn't cost a whole day's brief.
  const userPrompt = `${dataBlock}\n\n${newsBlock}`;
  let result, lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      result = await callAnthropic(userPrompt, env.ANTHROPIC_API_KEY);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) {
    return new Response(JSON.stringify({ error: lastErr.message }), { status: 502, headers: CORS });
  }

  // 4. Validate.
  const { bullets, sentiment, sector } = result;
  if (!Array.isArray(bullets) || bullets.length < 1 || bullets.length > 8) {
    return new Response(JSON.stringify({ error: 'Invalid bullets array', got: bullets }), { status: 502, headers: CORS });
  }
  if (!Number.isInteger(sentiment) || sentiment < -5 || sentiment > 5) {
    return new Response(JSON.stringify({ error: 'Invalid sentiment', got: sentiment }), { status: 502, headers: CORS });
  }
  if (!SECTOR_VOCAB.includes(sector)) {
    return new Response(JSON.stringify({ error: 'Invalid sector', got: sector, expected: SECTOR_VOCAB }), { status: 502, headers: CORS });
  }

  // 5. Upsert into daily_briefs — same shape the (now-defunct) email worker wrote.
  await db.prepare(`
    INSERT INTO daily_briefs (date, bullets, sentiment, sector, raw_source, model)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      bullets    = excluded.bullets,
      sentiment  = excluded.sentiment,
      sector     = excluded.sector,
      raw_source = excluded.raw_source,
      model      = excluded.model,
      created_at = datetime('now')
  `).bind(dataDate, JSON.stringify(bullets), sentiment, sector, userPrompt.slice(0, 50_000), MODEL).run();

  return new Response(JSON.stringify({
    date: dataDate, bullets, sentiment, sector,
    newsArticleCount: articles.length, model: MODEL,
  }), { headers: CORS });
}
