/**
 * Market Hub — Daily Brief Generator (Briefing.com replacement)
 * Cloudflare Pages Function: GET /api/daily-brief-generate
 *
 * Replaces the broken Briefing.com email pipeline. Grounds a Sonnet 5 call in
 * four REAL data sources — never asks the model to invent numbers:
 *   1. Today's own D1 price data (indices, sectors, yields, VIX, commodities,
 *      currency, breadth) — zero hallucination risk, already flowing nightly.
 *   2. Finnhub general market news (/news?category=general) — structured,
 *      sourced, dated articles for the "why" behind the numbers.
 *   3. analyst_grades (FMP, via analyst-grades-refresh) — today's real
 *      analyst upgrade/downgrade actions.
 *   4. econ_calendar (FRED + Kalshi, via econ-calendar-refresh) — real
 *      scheduled US releases for the near-term catalyst line.
 *
 * Output matches daily_briefs' existing shape (bullets/sentiment/sector), so
 * /api/macro-brief and everything downstream needs no changes.
 *
 * Auth: X-Hub-Token. Env: DB, FINNHUB_API_KEY, ANTHROPIC_API_KEY.
 * Runs nightly from data-refresh, after /api/refresh has written today's prices,
 * and after econ-calendar-refresh + analyst-grades-refresh.
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

const SYSTEM_PROMPT = `You are a financial market analyst writing a daily market close summary in the style of an institutional wire service. Briefing.com's "Closing Market Summary" is the reference style: dry, numbers-first, no hedging, no speculation beyond what the data and news support. Every real Briefing.com close update opens the same way — index moves plus the single clearest immediate cause, in one sentence — before working down through sectors, rates, and the day's news catalysts.

You will be given (1) today's real closing price data pulled directly from the site's own database, (2) today's real general market news headlines from Finnhub, (3) today's real analyst upgrade/downgrade actions, and (4) real scheduled US economic releases for the days ahead. Use ONLY these four sources — never invent a price, a percentage, a news event, an analyst action, or a scheduled release date that isn't in the provided data. If a news article isn't clearly relevant to explaining today's market action, ignore it rather than forcing it into a bullet. If the news doesn't clearly explain a price move, describe the move without inventing a cause.

Return ONLY a valid JSON object. No markdown. No code fences. No explanation.

Required format:
{
  "bullets": ["string", "string"],
  "sentiment": 0,
  "sector": "string"
}

Structure, in order of priority:
1. Open with the major index moves (SPY, QQQ, IWM) and the single clearest immediate cause — this is always bullet #1.
2. If SPY (cap-weighted) and RSP (equal-weighted) diverge by 0.3% or more, say so explicitly — it signals whether the move was broad-based or narrow/concentrated in a handful of large stocks. This is one of the most important signals in the data; don't bury it.
3. Name the 2-3 sectors that most explain the day's story (not an exhaustive 11-sector list), with their % change.
4. Weave in specific stock or catalyst stories from the Finnhub news that explain those sector moves, when the news actually supports it — don't force a connection that isn't there.
5. If any analyst grade actions are provided, mention one only if it's a well-known, widely-held name (large/mega-cap, the kind of company a general market audience would recognize) and it's notable enough to matter — a multi-notch move, or a name relevant to the day's sector story. Ignore obscure, illiquid, or unfamiliar tickers even if graded. It's fine to omit this entirely if nothing qualifies.
6. Include Treasury yield moves (10-year, and 2-year if it moved notably differently) in basis points when relevant to the session's narrative — rate moves are frequently the actual driver of the day, not just background color.
7. Close with the single most market-relevant item from the SCHEDULED ECONOMIC EVENTS block (a Fed decision, CPI, jobs report, GDP, PCE, retail sales, industrial production, or existing home sales) as the near-term catalyst to watch — every item in that block is a major release by construction, so pick whichever is soonest or clearly most relevant to today's session. Use a specific stock earnings date from the news only if no such scheduled release qualifies. Omit entirely rather than padding if nothing in the window matters.

Rules:
- bullets: array of 5-8 strings, ordered by market significance (highest first). Each is one complete sentence under 25 words. No redundancy between bullets.
- sentiment: single integer from -5 to +5 reflecting the net impact on US equity markets for this session. Weight the cap-weighted indices (SPY/QQQ/DJIA) most heavily since that's the conventional "market" read, but let clearly negative breadth (RSP notably lagging, most of the 11 sectors red) pull the number down even when headline indices look flat or slightly positive — a narrow, concentrated "up" day is not the same as a healthy one.
  -5 = extreme panic/crash day
  -3 = clearly bearish (meaningful losses, risk-off)
  -1 = slightly bearish (modest declines, mild caution) — OR a headline-flat/positive day where breadth was clearly negative
   0 = flat or genuinely mixed
  +1 = slightly bullish (modest gains, risk-on lean)
  +3 = clearly bullish (solid rally, broad participation across most sectors)
  +5 = extreme euphoria/surge day
- sector: the single dominant theme driving today's session. Must be EXACTLY one of:
  ${SECTOR_VOCAB.join(' | ')}
  Disambiguation: use Fed/Policy only when a specific Fed official's remarks or an FOMC-related action is the proximate driver that day. Use Macro/Data when a scheduled economic release (jobs, inflation, PMI, GDP) is the driver. Use Rates when Treasury-market moves themselves are the story without a clear same-day policy or data trigger. Use Equities when the day is driven by company-specific earnings or news rather than any macro theme. Use Geopolitics for conflict- or trade-tension-driven days, even when the transmission mechanism into markets is oil prices.

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

async function fetchYtd(db, symbols, dataDate) {
  const year = dataDate.slice(0, 4);
  const ph = symbols.map(() => '?').join(',');
  // First trading day on/after Jan 1 for each symbol this year.
  const { results = [] } = await db.prepare(
    `SELECT dp.symbol, dp.close
     FROM daily_prices dp
     INNER JOIN (
       SELECT symbol, MIN(date) AS d FROM daily_prices
       WHERE symbol IN (${ph}) AND date >= ? AND date < ?
       GROUP BY symbol
     ) f ON dp.symbol = f.symbol AND dp.date = f.d`
  ).bind(...symbols, `${year}-01-01`, `${year}-02-01`).all();
  return Object.fromEntries(results.map(r => [r.symbol, r.close]));
}

function fmtPct(x) { return x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + '%'; }
function fmtLevel(x) { return x == null ? '—' : x.toFixed(2); }

function buildDataBlock(idx, sec, yld, vix, cmd, fx, breadth, ytdStart, dataDate) {
  const lines = [];
  lines.push(`DATA DATE: ${dataDate}`);
  lines.push('');
  lines.push('INDICES (level, % change from prior close, YTD % change):');
  for (const s of INDEX_SYMS) {
    const ytdPct = pctChange(idx[s].close, ytdStart[s]);
    lines.push(`  ${s}: ${fmtLevel(idx[s].close)} (${fmtPct(idx[s].pct)}, YTD ${fmtPct(ytdPct)})`);
  }
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

async function fetchGrades(db) {
  // analyst-grades-refresh runs immediately before this in the nightly cron
  // and stores ~10 rows per run — grab the latest batch by our own fetched_at
  // rather than FMP's published_date, which doesn't reliably align to the
  // trading-date boundary (can land just after UTC midnight into "tomorrow").
  const { results = [] } = await db.prepare(
    `SELECT symbol, grading_company, previous_grade, new_grade, action
     FROM analyst_grades ORDER BY fetched_at DESC LIMIT 10`
  ).all();
  return results;
}

function buildGradesBlock(grades) {
  if (!grades.length) return 'ANALYST GRADES: none today.';
  const lines = grades.map(g =>
    `  ${g.symbol}: ${g.action ?? '—'} — ${g.previous_grade ?? '?'} → ${g.new_grade ?? '?'} (${g.grading_company ?? 'unknown firm'})`
  );
  return `ANALYST GRADES (today's upgrades/downgrades — mention only if the ticker is a well-known, widely held name; ignore obscure/illiquid symbols):\n${lines.join('\n')}`;
}

async function fetchEconCalendar(db, dataDate) {
  // econ-calendar-refresh runs earlier in the same nightly cron and keeps
  // this table forward-looking only — query from today's data date onward.
  const { results = [] } = await db.prepare(
    `SELECT event_date, event, source, detail
     FROM econ_calendar WHERE event_date >= ? ORDER BY event_date ASC LIMIT 15`
  ).bind(dataDate).all();
  return results;
}

function buildEconBlock(events) {
  if (!events.length) return 'SCHEDULED ECONOMIC EVENTS: none available.';
  const lines = events.map(e =>
    `  ${e.event_date}: ${e.event}${e.detail ? ' — ' + e.detail : ''} [${e.source}]`
  );
  return `SCHEDULED ECONOMIC EVENTS (upcoming major US releases — use for the near-term catalyst line):\n${lines.join('\n')}`;
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

  const ytdStart = await fetchYtd(db, INDEX_SYMS, dataDate);

  const dataBlock = buildDataBlock(idx, sec, yld, vix, cmd, fx, breadth, ytdStart, dataDate);

  // 2. Pull today's real news.
  let articles = [];
  try { articles = await fetchFinnhubGeneralNews(env.FINNHUB_API_KEY); }
  catch (e) { /* non-fatal — proceed with data-only bullets */ }
  const newsBlock = buildNewsBlock(articles);

  // 2b. Pull today's real analyst grade actions (non-fatal — table may be empty/missing).
  let grades = [];
  try { grades = await fetchGrades(db); }
  catch (e) { /* non-fatal — proceed without grades */ }
  const gradesBlock = buildGradesBlock(grades);

  // 2c. Pull upcoming scheduled econ releases (non-fatal — table may be empty/missing).
  let econEvents = [];
  try { econEvents = await fetchEconCalendar(db, dataDate); }
  catch (e) { /* non-fatal — proceed without econ calendar */ }
  const econBlock = buildEconBlock(econEvents);

  // 3. Synthesize with Sonnet 5. One retry — this runs once nightly, and a
  // single slow/failed response shouldn't cost a whole day's brief.
  const userPrompt = `${dataBlock}\n\n${newsBlock}\n\n${gradesBlock}\n\n${econBlock}`;
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
    newsArticleCount: articles.length, gradesCount: grades.length, econEventsCount: econEvents.length, model: MODEL,
  }), { headers: CORS });
}
