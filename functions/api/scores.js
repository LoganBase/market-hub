/**
 * Market Hub \u2014 Scores API
 * Cloudflare Pages Function: GET /api/scores
 *
 * Returns scored JSON for all 9 cards. Sources:
 *   1. Cloudflare D1 (historical + today's indicators if seeded)
 *   2. Yahoo Finance v8 chart API (live fallback)
 *
 * Response shape: { timestamp, source, aggregate, horizons, cards[] }
 *
 * `horizons` isolates three execution timeframes so incompatible signals are
 * never blended: speedometer (2–3 wk), compass (2–3 mo), anchor (2–3 yr risk
 * budget), plus a speedometer×compass interaction matrix.
 */

const YF = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept': 'application/json',
  'Referer': 'https://finance.yahoo.com/',
};

// ── ALL SYMBOLS NEEDED ACROSS 11 CARDS ───────────────────────────────────────
const ALL_SYMBOLS = [
  'SPY','QQQ','RSP','QQEW','IVW','IVE',          // Regime + Leadership
  'RSPD',                                          // Breadth proxy
  '^TYX','^TNX','^IRX','SHY',                     // Yield
  'UUP','FXE','FXY',                               // Currency
  'HYG','LQD','EMB',                               // Credit
  'ACWI','FEZ','AIA','ILF','EEM',                  // Global Flows \u2014 regional
  '^GSPTSE','EWU','EWG','EWQ','EWL','EWN','EWI','EWP',  // Global Flows \u2014 Europe countries
  'EWJ','MCHI','EWT','EWY','INDA','EWA','EWH',   // Global Flows \u2014 Asia countries
  'EWW','EWZ','ECH',                              // Global Flows \u2014 LatAm countries
  'XLI','XLK','XLF','XLE','XLU','XLRE','XLP',    // Sectors (7 existing)
  'XLV','XLC','XLY','XLB',                        // Sectors (4 added for breadth)
  'XME','GDX','COPX','KBE',
  'USCI','CPER','GLD','SLV','IXC','DBA','SLX','URA',   // Commodities
  'IWM','NVDA','JPM','CAT','XOM','FCX',                          // Equities
  '^VIX9D','^VIX','^VIX3M','^VIX6M',                            // VIX term structure
];

// ── MATH ─────────────────────────────────────────────────────────────────────
function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al += -d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function vsMA(price, ma) {
  if (!price || !ma) return null;
  return ((price - ma) / ma) * 100;
}

function clamp01(x) {
  if (x == null || Number.isNaN(x)) return null;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function pct(n, dec = 2) {
  if (n == null) return '\u2014';
  return (n >= 0 ? '+' : '') + n.toFixed(dec) + '%';
}

function usd(n) { return n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u2014'; }
function num(n, d = 1) { return n != null ? n.toFixed(d) : '\u2014'; }

// ── D1 SOURCE ─────────────────────────────────────────────────────────────────
async function loadFromD1(db, asOf = null) {
  try {
    // Last 35 calendar days covers ~25 trading days \u2014 enough for 20-day return + changePct
    const anchor = asOf ? `'${asOf}'` : `'now'`;
    const { results: priceRows } = await db.prepare(
      `SELECT symbol, date, close FROM daily_prices
       WHERE date >= DATE(${anchor}, '-35 days')${asOf ? ` AND date <= '${asOf}'` : ''}
       ORDER BY symbol, date DESC`
    ).all();

    // Latest indicator row per symbol (as-of asOf when set)
    const { results: indRows } = await db.prepare(
      `SELECT i.symbol, i.sma50, i.sma200, i.rsi14, i.vs200_pct
       FROM indicators i
       INNER JOIN (
         SELECT symbol, MAX(date) as max_date FROM indicators${asOf ? ` WHERE date <= '${asOf}'` : ''} GROUP BY symbol
       ) latest ON i.symbol = latest.symbol AND i.date = latest.max_date`
    ).all();

    // Group closes by symbol (already DESC), keep up to 22 for 20-day return
    const bySymbol = {};
    const latestDate = {};
    for (const row of priceRows) {
      if (!bySymbol[row.symbol]) {
        bySymbol[row.symbol] = [];
        latestDate[row.symbol] = row.date; // first occurrence = most recent (DESC order)
      }
      if (bySymbol[row.symbol].length < 27) bySymbol[row.symbol].push(row.close);
    }

    const indMap = {};
    for (const row of indRows) indMap[row.symbol] = row;

    const q = {};
    for (const [sym, closes] of Object.entries(bySymbol)) {
      const ind = indMap[sym];
      if (!ind || closes.length === 0) continue;
      const price = closes[0];
      const prev  = closes[1] ?? price;
      q[sym] = {
        symbol: sym,
        price,
        changePct: ((price - prev) / prev) * 100,
        price5d:   closes[5]  ?? null,
        price20d:  closes[20] ?? null,
        price25d:  closes[25] ?? null,
        sma50:  ind.sma50,
        sma200: ind.sma200,
        rsi14:  ind.rsi14,
        vs50:   ind.sma50  ? ((price - ind.sma50)  / ind.sma50)  * 100 : null,
        vs200:  ind.vs200_pct,
        latestDate: latestDate[sym],
      };
    }
    return q;
  } catch { return {}; }
}

// ── YAHOO FINANCE FETCH ───────────────────────────────────────────────────────
async function fetchSymbol(symbol) {
  try {
    const encoded = encodeURIComponent(symbol);
    // Single call with 300d \u2014 gives price + enough history for SMA200 + RSI
    const res = await fetch(`${YF}/${encoded}?interval=1d&range=300d`, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta   = result.meta;
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null);
    const price  = meta.regularMarketPrice;
    const prev   = meta.previousClose ?? meta.chartPreviousClose ?? closes[closes.length - 2];
    const s50    = sma(closes, 50);
    const s200   = sma(closes, 200);
    const r14    = rsi(closes, 14);
    return {
      symbol,
      price,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      price5d:  closes.length >= 6  ? closes[closes.length - 6]  : null,
      price20d: closes.length >= 21 ? closes[closes.length - 21] : null,
      price25d: closes.length >= 26 ? closes[closes.length - 26] : null,
      sma50:  s50,
      sma200: s200,
      rsi14:  r14,
      vs50:   vsMA(price, s50),
      vs200:  vsMA(price, s200),
    };
  } catch { return null; }
}

async function fetchAll(symbols) {
  const results = await Promise.all(symbols.map(fetchSymbol));
  const map = {};
  results.forEach(r => { if (r) map[r.symbol] = r; });
  return map;
}

// ── SCORING HELPERS ───────────────────────────────────────────────────────────
// Each returns 'bullish' | 'neutral' | 'bearish'
function aboveBelow(price, ma) {
  if (!price || !ma) return 'neutral';
  return price > ma ? 'bullish' : 'bearish';
}

function cardStatus(rows) {
  const counts = { bullish: 0, neutral: 0, bearish: 0 };
  rows.forEach(r => counts[r.status]++);
  if (counts.bearish > counts.bullish) return 'bearish';
  if (counts.bullish > 0 && counts.bearish === 0) return 'bullish';
  return 'neutral';
}

function ordinalSuffix(n) {
  const s = Math.round(n), t = s % 100, u = s % 10;
  return s + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}

// ── REGIME HISTORICAL CONTEXT (D1 queries) ────────────────────────────────────
async function loadRegimeContext(db) {
  try {
    // Fetch last 6 trading days for current values + 5-day deltas
    const { results: histRows } = await db.prepare(
      `SELECT vs200_pct, roc10, sma50, sma200 FROM indicators WHERE symbol='SPY' ORDER BY date DESC LIMIT 6`
    ).all();
    if (!histRows.length || histRows[0].vs200_pct == null) return null;

    const r0 = histRows[0];                              // today
    const r5 = histRows[Math.min(5, histRows.length - 1)]; // 5 trading days ago (or earliest)
    const v    = r0.vs200_pct;
    const bull = v >= 0;

    const [pctRow, durRow] = await Promise.all([
      db.prepare(
        `SELECT ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM indicators WHERE symbol='SPY')) AS pct
         FROM indicators WHERE symbol='SPY' AND vs200_pct <= ?`
      ).bind(v).first(),
      db.prepare(bull
        ? `SELECT COUNT(*) AS days FROM indicators WHERE symbol='SPY' AND vs200_pct >= 0
           AND date > COALESCE((SELECT MAX(date) FROM indicators WHERE symbol='SPY' AND vs200_pct < 0), '1900-01-01')`
        : `SELECT COUNT(*) AS days FROM indicators WHERE symbol='SPY' AND vs200_pct < 0
           AND date > COALESCE((SELECT MAX(date) FROM indicators WHERE symbol='SPY' AND vs200_pct >= 0), '1900-01-01')`
      ).first(),
    ]);

    // 5-day deltas \u2014 direction helper: >threshold='up', <-threshold='down', else='flat'
    const dir = (d, thr = 0.1) => d == null ? null : d > thr ? 'up' : d < -thr ? 'down' : 'flat';
    const have5 = histRows.length >= 6;

    const v200Delta    = have5 && r5.vs200_pct != null ? v - r5.vs200_pct : null;
    const crossToday   = r0.sma50 && r0.sma200 ? (r0.sma50 - r0.sma200) / r0.sma200 * 100 : null;
    const cross5d      = r5.sma50 && r5.sma200 ? (r5.sma50 - r5.sma200) / r5.sma200 * 100 : null;
    const crossDelta   = crossToday != null && cross5d != null ? crossToday - cross5d : null;
    const velDelta     = have5 && r0.roc10 != null && r5.roc10 != null ? r0.roc10 - r5.roc10 : null;
    // Duration always increments while in same regime; flip = regime just changed
    const durationDir  = have5 && r5.vs200_pct != null
      ? ((v >= 0) === (r5.vs200_pct >= 0) ? 'up' : 'down')
      : 'up';

    return {
      percentile: pctRow?.pct ?? null,
      duration:   durRow?.days ?? null,
      velocity:   r0.roc10 ?? null,
      bull,
      deltas: {
        v200:        dir(v200Delta, 0.3),    // SPY Regime / Stretch Risk / Percentile Rank
        crossSpread: dir(crossDelta, 0.05),  // Trend Cross
        duration:    durationDir,            // Regime Duration
        velocity:    dir(velDelta, 0.05),    // Extension Velocity
      },
    };
  } catch (e) {
    return null;
  }
}

async function loadCommoditiesContext(db) {
  try {
    const { results: rows } = await db.prepare(
      `SELECT vs200_pct, roc10 FROM indicators WHERE symbol='USCI' ORDER BY date DESC LIMIT 6`
    ).all();
    if (!rows.length || rows[0].vs200_pct == null) return null;

    const r0 = rows[0], r5 = rows[Math.min(5, rows.length - 1)];
    const v = r0.vs200_pct, bull = v >= 0;

    const [pctRow, durRow] = await Promise.all([
      db.prepare(
        `SELECT ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM indicators WHERE symbol='USCI' AND vs200_pct IS NOT NULL)) AS pct
         FROM indicators WHERE symbol='USCI' AND vs200_pct <= ?`
      ).bind(v).first(),
      db.prepare(bull
        ? `SELECT COUNT(*) AS days FROM indicators WHERE symbol='USCI' AND vs200_pct >= 0
           AND date > COALESCE((SELECT MAX(date) FROM indicators WHERE symbol='USCI' AND vs200_pct < 0), '1900-01-01')`
        : `SELECT COUNT(*) AS days FROM indicators WHERE symbol='USCI' AND vs200_pct < 0
           AND date > COALESCE((SELECT MAX(date) FROM indicators WHERE symbol='USCI' AND vs200_pct >= 0), '1900-01-01')`
      ).first(),
    ]);

    const dir = (d, thr) => d == null ? null : d > thr ? 'up' : d < -thr ? 'down' : null;
    const have5 = rows.length >= 6;
    const v200Delta = have5 && r5.vs200_pct != null ? v - r5.vs200_pct : null;
    const velDelta  = have5 && r0.roc10 != null && r5.roc10 != null ? r0.roc10 - r5.roc10 : null;

    return {
      percentile: pctRow?.pct ?? null,
      duration:   durRow?.days ?? null,
      velocity:   r0.roc10 ?? null,
      deltas: {
        v200:     dir(v200Delta, 0.3),
        duration: 'up',
        velocity: dir(velDelta, 0.05),
      },
    };
  } catch (e) {
    return null;
  }
}

async function loadCreditContext(db) {
  try {
    const syms = ['HYG', 'LQD', 'EMB'];
    const rows = await Promise.all(syms.map(sym =>
      db.prepare(`SELECT vs200_pct, roc10 FROM indicators WHERE symbol=? ORDER BY date DESC LIMIT 1`)
        .bind(sym).first()
    ));
    const durs = await Promise.all(syms.map((sym, i) => {
      const r = rows[i];
      if (!r || r.vs200_pct == null) return Promise.resolve(null);
      const bull = r.vs200_pct >= 0;
      return db.prepare(bull
        ? `SELECT COUNT(*) AS days FROM indicators WHERE symbol=? AND vs200_pct >= 0 AND date > COALESCE((SELECT MAX(date) FROM indicators WHERE symbol=? AND vs200_pct < 0), '1900-01-01')`
        : `SELECT COUNT(*) AS days FROM indicators WHERE symbol=? AND vs200_pct < 0 AND date > COALESCE((SELECT MAX(date) FROM indicators WHERE symbol=? AND vs200_pct >= 0), '1900-01-01')`
      ).bind(sym, sym).first();
    }));
    const ctx = {};
    syms.forEach((sym, i) => {
      const r = rows[i];
      ctx[sym] = {
        daysInZone: durs[i]?.days ?? null,
        velocity:   r?.roc10 ?? null,
        bull:       r?.vs200_pct != null ? r.vs200_pct >= 0 : null,
      };
    });
    return ctx;
  } catch { return null; }
}

async function loadSectorWeights(kv) {
  try {
    if (!kv) return null;
    const data = await kv.get('sector-weights:current', 'json');
    return data?.weights ?? null;
  } catch { return null; }
}

// ── CARD BUILDERS ─────────────────────────────────────────────────────────────

function buildRegime(q, ctx) {
  const spy = q['SPY'];
  if (!spy) return placeholderCard(1, 'Regime', 'The Anchor');

  // Row 1: SPY Regime \u2014 structural anchor
  const isBull = spy.price > spy.sma200;
  const r1 = {
    label: 'SPY Regime',
    indicator: 'SPY vs 200d SMA',
    value: usd(spy.price),
    condition: isBull ? 'Secular Bull \u2014 Long Bias' : 'Secular Bear \u2014 Defensive Bias',
    status: isBull ? 'bullish' : 'bearish',
  };

  // Row 2: Stretch Risk \u2014 4-band aligned with history.js zones
  const v200 = spy.vs200;
  let stretchStatus, stretchCondition;
  if (v200 == null)     { stretchStatus = 'neutral'; stretchCondition = '\u2014'; }
  else if (v200 > 14)   { stretchStatus = 'bearish'; stretchCondition = 'Overextended \u2014 Pullback Risk'; }
  else if (v200 > 10)   { stretchStatus = 'neutral'; stretchCondition = 'Extended \u2014 Late to Add'; }
  else if (v200 >= 0)   { stretchStatus = 'bullish'; stretchCondition = 'Normal Bull \u2014 Risk-On'; }
  else if (v200 >= -10) { stretchStatus = 'neutral'; stretchCondition = 'Bearish Retest \u2014 Neutral'; }
  else                  { stretchStatus = 'bearish'; stretchCondition = 'Deeply Oversold \u2014 Washed Out'; }
  const r2 = {
    label: 'Stretch Risk',
    indicator: 'Distance from 200d SMA',
    value: pct(v200),
    condition: stretchCondition,
    status: stretchStatus,
  };

  // Row 3: Trend Cross \u2014 Golden Cross / Death Cross, classified by spread strength.
  // A spread under +/-8% is too close to call a confirmed cross, so it reads
  // neutral rather than forcing bull/bear.
  const s50 = spy.sma50, s200 = spy.sma200;
  const crossSpread = s50 != null && s200 != null ? ((s50 - s200) / s200) * 100 : null;
  let crossStatus, crossCondition;
  if (crossSpread == null)    { crossStatus = 'neutral'; crossCondition = '\u2014'; }
  else if (crossSpread > 8)   { crossStatus = 'bullish'; crossCondition = 'Golden Cross \u2014 Confirmed'; }
  else if (crossSpread >= -8) { crossStatus = 'neutral'; crossCondition = 'Cross Forming \u2014 Awaiting Confirmation'; }
  else                        { crossStatus = 'bearish'; crossCondition = 'Death Cross \u2014 Bearish Trend'; }
  const r3 = {
    label: 'Trend Cross',
    indicator: '50d SMA vs 200d SMA',
    value: pct(crossSpread, 1),
    condition: crossCondition,
    status: crossStatus,
  };

  const rows = [r1, r2, r3];
  // Card is bearish only when SPY is in a secular bear (below 200d SMA)
  const status = isBull ? cardStatus(rows) : 'bearish';
  const regimeNote = (() => {
    const crossStr = crossSpread == null ? ''
      : crossStatus === 'bullish'
      ? `Golden Cross in place (50d ${pct(crossSpread, 1)} above 200d) \u2014 trend confirmed.`
      : crossStatus === 'bearish'
      ? `Death Cross in effect (50d ${pct(Math.abs(crossSpread), 1)} below 200d) \u2014 trend broken.`
      : `50d/200d cross still forming (spread ${pct(crossSpread, 1)}) \u2014 trend not yet confirmed either way.`;
    const stretchStr = v200 == null ? ''
      : v200 > 14 ? ` SPY ${pct(v200)} above 200d \u2014 overextended, pullback risk elevated.`
      : v200 >= 0 ? ` SPY ${pct(v200)} above 200d \u2014 normal bull range.`
      : ` SPY ${pct(v200)} below 200d \u2014 bear regime active; read all cards defensively.`;

    let ctxStr = '';
    if (ctx) {
      const { percentile, duration, velocity } = ctx;
      if (percentile != null) {
        ctxStr += ` Current stretch sits in the ${ordinalSuffix(percentile)} percentile of all historical readings`;
        ctxStr += percentile >= 90 ? ' \u2014 among the most extended readings on record.'
          : percentile >= 70 ? ', a historically elevated level.'
          : percentile <= 10 ? ' \u2014 among the most oversold readings on record.'
          : percentile <= 30 ? ', a historically depressed level.'
          : '.';
      }
      if (duration != null) {
        ctxStr += ` The current regime has held for ${duration} trading day${duration === 1 ? '' : 's'}`;
        ctxStr += duration > 250 ? ' \u2014 a mature, well-established trend.'
          : duration > 60 ? ', an established trend.'
          : duration < 10 ? ' \u2014 a freshly formed regime, not yet confirmed.'
          : '.';
      }
      if (velocity != null && Math.abs(velocity) > 0.05) {
        ctxStr += ` Extension is ${velocity > 0 ? 'accelerating' : 'decelerating'} (10d Rate of Change ${velocity >= 0 ? '+' : ''}${velocity.toFixed(1)}%).`;
      }
    }

    return crossStr + stretchStr + ctxStr;
  })();
  const stats = ctx ? (() => {
    const { percentile, duration, velocity, bull: ctxBull } = ctx;
    const velStr  = velocity != null ? (velocity >= 0 ? '+' : '') + velocity.toFixed(1) + '%' : '\u2014';
    const velTone = velocity == null ? null : velocity > 0.05 ? 'pos' : velocity < -0.05 ? 'neg' : null;
    return [
      ['Percentile Rank',    percentile != null ? ordinalSuffix(percentile) : '\u2014',  'of all historical days',                  percentile != null && percentile >= 70 ? 'pos' : percentile != null && percentile <= 30 ? 'neg' : null],
      ['Regime Duration',    duration   != null ? String(duration) : '\u2014',           ctxBull ? 'days above 200d SMA' : 'days below 200d SMA', null],
      ['Extension Velocity', velStr,                                                 '10d Rate of Change of stretch',           velTone],
    ];
  })() : null;
  return { id: 'regime', number: 1, title: 'Regime', subtitle: 'The Anchor', status, rows, stats, hideIndicator: true, note: regimeNote, deltas: ctx?.deltas ?? null };
}

function buildLeadership(q, ctx) {
  const spy  = q['SPY'],  rsp  = q['RSP'];
  const qqq  = q['QQQ'],  qqew = q['QQEW'];
  const ivw  = q['IVW'],  ive  = q['IVE'];
  if (!spy || !rsp) return placeholderCard(2, 'Leadership', 'The Quality Check');

  // 20-day return \u2014 falls back to daily changePct when price20d unavailable
  function ret20(s) {
    return s?.price20d ? (s.price / s.price20d - 1) * 100 : s?.changePct ?? null;
  }
  // 20-day return as of 5 trading days ago \u2014 for spread delta computation
  function ret20at5(s) {
    return (s?.price5d && s?.price25d) ? (s.price5d / s.price25d - 1) * 100 : null;
  }

  const rsp20 = ret20(rsp), spy20  = ret20(spy);
  const qqew20 = ret20(qqew), qqq20 = ret20(qqq);
  const ivw20  = ret20(ivw),  ive20 = ret20(ive);

  const rspLead    = rsp20 != null && spy20  != null ? rsp20  > spy20  : rsp.changePct > spy.changePct;
  const qqewLead   = qqew20 != null && qqq20 != null ? qqew20 > qqq20  : (qqew && qqq ? qqew.changePct > qqq.changePct : null);
  const growthLead = ivw20  != null && ive20  != null ? ivw20  > ive20  : (ivw && ive ? ivw.changePct > ive.changePct : null);

  const rspSpread   = rsp20  != null && spy20  != null ? rsp20  - spy20  : null;
  const qqewSpread  = qqew20 != null && qqq20  != null ? qqew20 - qqq20  : null;
  const styleSpread = ivw20  != null && ive20  != null ? ivw20  - ive20  : null;

  const rspSpreadStr   = rspSpread   != null ? ` (${pct(rspSpread, 1)})` : '';
  const qqewSpreadStr  = qqewSpread  != null ? ` (${pct(qqewSpread, 1)})` : '';
  const styleSpreadStr = styleSpread != null ? ` (${pct(styleSpread, 1)})` : '';

  // 5-day momentum deltas: compare today's 20d spread vs 5 trading days ago
  const rspSpread5d   = (ret20at5(rsp)  != null && ret20at5(spy)  != null) ? ret20at5(rsp)  - ret20at5(spy)  : null;
  const qqewSpread5d  = (ret20at5(qqew) != null && ret20at5(qqq)  != null) ? ret20at5(qqew) - ret20at5(qqq)  : null;
  const styleSpread5d = (ret20at5(ivw)  != null && ret20at5(ive)  != null) ? ret20at5(ivw)  - ret20at5(ive)  : null;
  const rspDelta   = rspSpread   != null && rspSpread5d   != null ? rspSpread   - rspSpread5d   : null;
  const qqewDelta  = qqewSpread  != null && qqewSpread5d  != null ? qqewSpread  - qqewSpread5d  : null;
  const styleDelta = styleSpread != null && styleSpread5d != null ? styleSpread - styleSpread5d : null;
  const _lDir = (d) => d == null ? null : d > 0.3 ? 'up' : d < -0.3 ? 'down' : null;
  const deltas = { rsp: _lDir(rspDelta), qqew: _lDir(qqewDelta), style: _lDir(styleDelta) };

  const rows = [
    {
      label: 'Market Breadth',
      indicator: 'RSP vs SPY \u2014 20d Return',
      value: rspSpread != null
        ? `${pct(rspSpread, 1)}\nRSP\u00a0${pct(rsp20, 1)}\u2003SPY\u00a0${pct(spy20, 1)}`
        : (rsp20 != null ? `RSP\u00a0${pct(rsp20, 1)}` : '\u2014'),
      condition: rspLead ? 'Breadth Expanding \u2014 Broad Bias' : 'Rally Narrowing \u2014 Concentration Risk',
      status: rspLead ? 'bullish' : 'bearish',
    },
    {
      label: 'Tech Breadth',
      indicator: 'QQEW vs QQQ \u2014 20d Return',
      value: qqewSpread != null
        ? `${pct(qqewSpread, 1)}\nQQEW\u00a0${pct(qqew20, 1)}\u2003QQQ\u00a0${pct(qqq20, 1)}`
        : (qqew20 != null ? `QQEW\u00a0${pct(qqew20, 1)}` : '\u2014'),
      condition: qqewLead == null ? '\u2014' : (qqewLead ? 'Tech Broadening \u2014 Tech Healthy' : 'Mega-Cap Driven \u2014 Favour Large Cap'),
      status: qqewLead == null ? 'neutral' : (qqewLead ? 'bullish' : 'bearish'),
    },
    {
      label: 'Style Bias',
      indicator: 'IVW vs IVE \u2014 20d Return',
      value: styleSpread != null
        ? `${pct(styleSpread, 1)}\nIVW\u00a0${pct(ivw20, 1)}\u2003IVE\u00a0${pct(ive20, 1)}`
        : (ivw20 != null ? `IVW\u00a0${pct(ivw20, 1)}` : '\u2014'),
      condition: growthLead == null ? '\u2014' : (growthLead ? 'Growth Leading \u2014 Risk-On Tilt (context only)' : 'Value Leading \u2014 Defensive Tilt (context only)'),
      // Style tilt is descriptive context, not a directional vote: growth-leading
      // in a mega-cap regime is often the same concentration the breadth rows
      // penalize, and value-leading is regime-ambiguous. Always neutral.
      status: 'neutral',
    },
  ];
  const leaderNote = (() => {
    // Sentence 1: Market Breadth \u2014 direction only; specific spread shown in Metrics box (close-based)
    const breadthStr = rspLead
      ? `Equal-weight RSP is outperforming cap-weight SPY \u2014 broad market participation is healthy.`
      : `Cap-weight SPY is outperforming equal-weight RSP \u2014 the rally is narrowing; concentration risk is rising.`;

    // Sentence 2: Tech Breadth \u2014 confirming or diverging
    const techStr = qqewLead == null ? ''
      : qqewLead
      ? ` Technology breadth confirms: QQEW outperforming QQQ \u2014 gains are not confined to mega-cap names.`
      : ` Technology breadth is diverging: QQQ outperforming QQEW \u2014 gains remain concentrated in large-cap tech.`;

    // Sentence 3: Style Bias \u2014 direction only
    const styleStr = growthLead == null ? ''
      : growthLead
      ? ` On style, growth (IVW) is leading value (IVE) \u2014 a risk-on tilt, shown for context only (not scored).`
      : ` On style, value (IVE) is leading growth (IVW) \u2014 a defensive/rotational tilt, shown for context only (not scored).`;

    // Sentence 4: Daily streak persistence (ctx only)
    let streakStr = '';
    if (ctx && ctx.streak != null && ctx.streak !== 0) {
      const n = Math.abs(ctx.streak);
      const s = n === 1 ? '' : 's';
      streakStr = ctx.streak > 0
        ? ` RSP has outperformed SPY on a daily basis for ${n} consecutive session${s}${n > 7 ? ' \u2014 breadth persistence confirmed' : ''}.`
        : ` SPY has outperformed RSP on a daily basis for ${n} consecutive session${s}${n > 7 ? ' \u2014 concentration is confirmed and persistent' : ''}.`;
    }

    // Sentence 5: 5Y structural spread context (ctx only)
    let ctxStr = '';
    if (ctx && ctx.spreadRsp != null) {
      ctxStr = ` The 5-year cumulative RSP vs SPY spread stands at ${pct(ctx.spreadRsp, 1)}`;
      ctxStr += ctx.spreadRsp > 5  ? ' \u2014 a structurally broad, participation-healthy market.'
        : ctx.spreadRsp > 0  ? ', a slight long-run edge for equal-weight participation.'
        : ctx.spreadRsp > -5 ? ' \u2014 the market has structurally favoured large-cap concentration.'
        : ' \u2014 a structurally mega-cap-led market over the medium term.';
    }

    return breadthStr + techStr + styleStr + streakStr + ctxStr;
  })();
  const stats = ctx ? [
    ['5Y Spread',      ctx.spreadRsp  != null ? (ctx.spreadRsp  >= 0 ? '+' : '') + ctx.spreadRsp.toFixed(1)  + '%' : '\u2014', 'RSP vs SPY cumulative',  ctx.spreadRsp  != null ? (ctx.spreadRsp  > 0 ? 'pos' : 'neg') : null],
    ['Daily Streak',   ctx.streak     != null ? String(Math.abs(ctx.streak)) : '\u2014', ctx.streak > 0 ? 'days RSP leading daily' : 'days RSP losing daily', ctx.streak > 0 ? 'pos' : ctx.streak < 0 ? 'neg' : null],
    ['5Y Tech Spread', ctx.spreadQqew != null ? (ctx.spreadQqew >= 0 ? '+' : '') + ctx.spreadQqew.toFixed(1) + '%' : '\u2014', 'QQEW vs QQQ cumulative', ctx.spreadQqew != null ? (ctx.spreadQqew > 0 ? 'pos' : 'neg') : null],
  ] : [
    ['RSP vs SPY',      rspSpread   != null ? (rspSpread   >= 0 ? '+' : '') + rspSpread.toFixed(1)   + '%' : '\u2014', '20d breadth spread', rspSpread   != null ? (rspSpread   > 0 ? 'pos' : 'neg') : null],
    ['QQEW vs QQQ',    qqewSpread  != null ? (qqewSpread  >= 0 ? '+' : '') + qqewSpread.toFixed(1)  + '%' : '\u2014', '20d tech breadth',   qqewSpread  != null ? (qqewSpread  > 0 ? 'pos' : 'neg') : null],
    ['Growth vs Value', styleSpread != null ? (styleSpread >= 0 ? '+' : '') + styleSpread.toFixed(1) + '%' : '\u2014', '20d style spread (context)',  null],
  ];
  return { id: 'leadership', number: 2, title: 'Leadership', subtitle: 'The Quality Check', status: cardStatus(rows), rows, stats, hideIndicator: true, note: leaderNote, deltas };
}

function buildBreadth(q, breadthData, breadthCtx, adidCtx) {
  // Primary signals: $MMTH (200d) and $MMFI (50d) from D1 market_breadth table
  const mmth = breadthData?.pct_above_200d;
  const mmfi = breadthData?.pct_above_50d;

  // ADID divergence — same-day flow breadth vs the index move. A "hollow" day
  // (index up but net decliners) warns that the average stock is lagging the
  // headline; the reverse (index down but net advancers) is a positive
  // divergence. Deep-dive context only — does not change the card's status.
  const spyChg = q['SPY']?.changePct ?? null;
  let adidState = null, adidLabel = null;
  if (adidCtx?.latest != null && spyChg != null) {
    const a = adidCtx.latest;
    if (spyChg > 0.1 && a < 0)       { adidState = 'hollow';    adidLabel = 'Hollow advance — index up but net decliners; breadth is not confirming the gain'; }
    else if (spyChg < -0.1 && a > 0) { adidState = 'positive';  adidLabel = 'Positive divergence — index down but net advancers; breadth is firmer than price'; }
    else if (Math.sign(spyChg) === Math.sign(a)) { adidState = 'confirm'; adidLabel = 'Breadth confirms the move — advancers/decliners agree with the index'; }
    else                             { adidState = 'flat';      adidLabel = 'Neutral — small move, no meaningful breadth divergence'; }
  }

  // NYSE vs Nasdaq breadth split — the two exchanges disagreeing is a
  // risk-appetite tell: NYSE is the broad market, Nasdaq skews growth/speculative.
  const adidNasdaq = adidCtx?.nasdaq ?? null;
  let splitState = null, splitLabel = null;
  if (adidCtx?.latest != null && adidNasdaq != null) {
    const n = adidCtx.latest;
    if (n > 0 && adidNasdaq > 0)      { splitState = 'broad-pos'; splitLabel = 'both NYSE and Nasdaq advancing — broad, healthy participation'; }
    else if (n < 0 && adidNasdaq < 0) { splitState = 'broad-neg'; splitLabel = 'both NYSE and Nasdaq declining — broad selling, risk-off'; }
    else if (n > 0 && adidNasdaq < 0) { splitState = 'risk-fade'; splitLabel = 'NYSE advancing but Nasdaq declining — the broad market is up while growth/speculative names lag; risk appetite is cooling'; }
    else                              { splitState = 'narrow';    splitLabel = 'Nasdaq advancing but NYSE declining — narrow, speculative leadership carrying a weak broad market'; }
  }

  // Validation: coarser sector ETF breadth
  const SECTORS = ['XLK','XLV','XLF','XLI','XLC','XLY','XLP','XLE','XLU','XLRE','XLB'];
  const SECTOR_NAMES = {
    XLK: 'Technology', XLV: 'Health Care', XLF: 'Financials', XLI: 'Industrials',
    XLC: 'Comm. Services', XLY: 'Consumer Disc.', XLP: 'Consumer Staples',
    XLE: 'Energy', XLU: 'Utilities', XLRE: 'Real Estate', XLB: 'Materials',
  };
  const valid200 = SECTORS.filter(s => q[s]?.price && q[s]?.sma200);
  const bull200  = valid200.filter(s => q[s].price > q[s].sma200).length;
  const n200     = valid200.length;

  const rspd     = q['RSPD'];
  const rspdBull = rspd?.price && rspd?.sma200 ? rspd.price > rspd.sma200 : null;

  // Row 1: NYSE 200d ($MMTH)
  const mmthStatus = mmth == null ? 'neutral' : mmth >= 70 ? 'bullish' : mmth >= 40 ? 'neutral' : 'bearish';
  const mmthCond   = mmth == null ? 'Awaiting Data'
    : mmth >= 70 ? 'Broad Participation \u2014 Rally Has Legs'
    : mmth >= 40 ? 'Mixed Breadth \u2014 Bifurcated Market'
    :               'Breadth Breakdown \u2014 Risk Off';

  // Row 2: NYSE 50d ($MMFI)
  const mmfiStatus = mmfi == null ? 'neutral' : mmfi >= 70 ? 'bullish' : mmfi >= 40 ? 'neutral' : 'bearish';
  const mmfiCond   = mmfi == null ? 'Awaiting Data'
    : mmfi >= 70 ? 'Momentum Expanding \u2014 Risk-On Bias'
    : mmfi >= 40 ? 'Mixed Momentum \u2014 Watch Leaders'
    :               'Momentum Fading \u2014 Reduce-Risk Bias';

  // Row 3: Sector Check (coarser validation)
  const sectStatus = n200 < 7 ? 'neutral' : bull200 >= 8 ? 'bullish' : bull200 >= 5 ? 'neutral' : 'bearish';
  const sectCond   = n200 < 7 ? 'Insufficient Data'
    : bull200 >= 8 ? 'Broad Participation \u2014 Long Bias'
    : bull200 >= 5 ? 'Mixed Breadth \u2014 Be Selective'
    :                'Sector Breakdown \u2014 Defensive Bias';

  const rows = [
    {
      label: 'NYSE 200d',
      indicator: '$MMTH \u2014 % NYSE Stocks Above 200d SMA',
      value: mmth != null ? `${mmth.toFixed(1)}%` : '\u2014',
      condition: mmthCond,
      status: mmthStatus,
    },
    {
      label: 'NYSE 50d',
      indicator: '$MMFI \u2014 % NYSE Stocks Above 50d SMA',
      value: mmfi != null ? `${mmfi.toFixed(1)}%` : '\u2014',
      condition: mmfiCond,
      status: mmfiStatus,
    },
    {
      label: 'Sector Check',
      indicator: 'SPDR Sectors Above 200d SMA (11)',
      value: n200 > 0 ? `${bull200} / ${n200}` : '\u2014',
      condition: sectCond,
      status: sectStatus,
    },
    {
      label: 'Consumer Signal',
      indicator: 'RSPD (Equal-Weight Consumer Disc.)',
      value: rspd ? usd(rspd.price) : '\u2014',
      condition: rspdBull == null ? '\u2014' : (rspdBull ? 'Above 200d \u2014 Consumer Healthy' : 'Below 200d \u2014 Risk Rising'),
      status: rspdBull == null ? 'neutral' : (rspdBull ? 'bullish' : 'bearish'),
    },
  ];

  const breadthNote = (() => {
    if (mmth != null) {
      const longStr = mmth >= 70
        ? `${mmth.toFixed(1)}% of NYSE stocks are above their 200-day SMA \u2014 broad market participation confirmed; the rally has structural support.`
        : mmth >= 40
        ? `${mmth.toFixed(1)}% of NYSE stocks are above their 200-day SMA \u2014 mixed breadth; the market is bifurcating, stay with proven leaders.`
        : `${mmth.toFixed(1)}% of NYSE stocks are above their 200-day SMA \u2014 breadth is breaking down; broad exposure carries elevated risk.`;
      const shortStr = mmfi != null
        ? ` Short-term momentum: ${mmfi.toFixed(1)}% of NYSE above 50d SMA${mmfi >= 70 ? ' \u2014 momentum is expanding across the board' : mmfi >= 40 ? ' \u2014 momentum is mixed' : ' \u2014 momentum is fading rapidly'}.`
        : '';
      const alignStr = mmfi != null
        ? (mmth >= 60 && mmfi >= 60
          ? ' Both long and short-term breadth are aligned bullishly \u2014 a durable, confirmed setup.'
          : mmth < 40 && mmfi < 40
          ? ' Both long and short-term breadth are aligned bearishly \u2014 no near-term floor visible.'
          : Math.abs(mmth - mmfi) > 20
          ? ' Long and short-term breadth are diverging \u2014 watch the faster 50d signal for an early turn.'
          : '')
        : '';
      const sectStr = n200 >= 7
        ? ` Sector cross-check: ${bull200} of ${n200} SPDR sector ETFs above their 200d SMA${bull200 >= 8 ? ', confirming broad participation' : bull200 >= 5 ? ', a mixed but not alarming picture' : ' \u2014 sector breadth is thin'}.`
        : '';
      const consStr = rspdBull != null
        ? ` Consumer Discretionary equal-weight (RSPD) is ${rspdBull ? 'above' : 'below'} its 200d SMA \u2014 ${rspdBull ? 'consumer health supports the bull case' : 'consumer stress is a late-cycle warning sign'}.`
        : '';
      const adidStr = adidLabel
        ? ` Daily flow: NYSE advance-decline ${adidCtx.latest >= 0 ? '+' : ''}${adidCtx.latest} (5d net ${adidCtx.cum5 >= 0 ? '+' : ''}${adidCtx.cum5}) \u2014 ${adidLabel}.`
        : '';
      const splitStr = splitLabel
        ? ` NYSE vs Nasdaq: ${splitLabel} (NYSE ${adidCtx.latest >= 0 ? '+' : ''}${adidCtx.latest} vs Nasdaq ${adidNasdaq >= 0 ? '+' : ''}${adidNasdaq}).`
        : '';
      return longStr + shortStr + alignStr + sectStr + consStr + adidStr + splitStr;
    }
    if (n200 < 7) return 'Breadth data loading \u2014 check back shortly.';
    const signal = bull200 >= 8 ? 'broad support across sectors \u2014 rally is healthy.'
      : bull200 >= 5 ? 'mixed sector participation \u2014 rally narrowing, stay with leaders.'
      : 'sector breadth breaking down \u2014 reduce broad exposure.';
    return `${bull200} of ${n200} S&P 500 sectors above 200d SMA \u2014 ${signal}`;
  })();

  const sectorTable = SECTORS.map(s => {
    const d = q[s];
    if (!d?.price || !d?.sma200) return null;
    const vs200 = d.vs200 ?? ((d.price - d.sma200) / d.sma200 * 100);
    const vs50  = d.vs50  ?? (d.sma50 ? ((d.price - d.sma50) / d.sma50) * 100 : null);
    return { ticker: s, name: SECTOR_NAMES[s], vs200: +vs200.toFixed(2), vs50: vs50 != null ? +vs50.toFixed(2) : null, bull: d.price > d.sma200 };
  }).filter(Boolean);

  const adidTone = adidState === 'hollow' ? 'neg' : adidState === 'positive' ? 'pos'
    : adidState === 'confirm' ? (adidCtx?.latest > 0 ? 'pos' : 'neg') : null;
  const stats = [
    ['NYSE 200d',    mmth   != null ? mmth.toFixed(1)   + '%' : '\u2014', '% stocks above 200d SMA',   mmth   != null ? (mmth   >= 70 ? 'pos' : mmth   < 40 ? 'neg' : null) : null],
    ['NYSE 50d',     mmfi   != null ? mmfi.toFixed(1)   + '%' : '\u2014', '% stocks above 50d SMA',    mmfi   != null ? (mmfi   >= 70 ? 'pos' : mmfi   < 40 ? 'neg' : null) : null],
    ['Sector Count', n200   >  0    ? `${bull200} / ${n200}` : '\u2014',  'SPDR sectors above 200d',   n200   >  0    ? (bull200 >= 8  ? 'pos' : bull200 <  5  ? 'neg' : null) : null],
    ['NYSE A/D (ADID)', adidCtx?.latest != null ? (adidCtx.latest >= 0 ? '+' : '') + adidCtx.latest : '\u2014',
      adidCtx?.cum5 != null ? `${adidCtx.cum5 >= 0 ? '+' : ''}${adidCtx.cum5} over 5d` : 'net advancers \u2212 decliners', adidTone],
    ['Nasdaq A/D (ADID)', adidNasdaq != null ? (adidNasdaq >= 0 ? '+' : '') + adidNasdaq : '\u2014',
      adidCtx?.nasdaqCum5 != null ? `${adidCtx.nasdaqCum5 >= 0 ? '+' : ''}${adidCtx.nasdaqCum5} over 5d` : 'growth/speculative flow', adidNasdaq != null ? (adidNasdaq >= 0 ? 'pos' : 'neg') : null],
  ];
  const deltas = breadthCtx ? { mmth: breadthCtx.mmthDir, mmfi: breadthCtx.mmfiDir } : null;
  return { id: 'breadth', number: 3, title: 'Breadth', subtitle: 'The Early Warning', status: cardStatus(rows), rows, stats, hideIndicator: true, note: breadthNote, sectorTable, deltas };
}

// ── SHILLER D1 SOURCE ─────────────────────────────────────────────────────────
async function loadShillerLatest(db) {
  try {
    const [capeRes, peRes] = await Promise.all([
      db.prepare(`SELECT date, price, earnings, cape FROM shiller_data
                  WHERE cape IS NOT NULL ORDER BY date DESC LIMIT 1`).all(),
      db.prepare(`SELECT price, earnings FROM shiller_data
                  WHERE earnings > 0 AND price > 0 ORDER BY date DESC LIMIT 1`).all(),
    ]);
    const row = capeRes.results?.[0] ?? null;
    if (!row) return null;
    // Latest CAPE row may not have earnings yet \u2014 attach latest valid P/E separately
    if ((!row.earnings || row.earnings <= 0) && peRes.results?.[0]) {
      row.pePrice    = peRes.results[0].price;
      row.peEarnings = peRes.results[0].earnings;
    }
    return row;
  } catch { return null; }
}

// ── FORWARD P/E D1 SOURCE ────────────────────────────────────────────────────
async function loadForwardPeLatest(db) {
  try {
    const { results } = await db.prepare(
      `SELECT date, pe FROM forward_pe_data ORDER BY date DESC LIMIT 1`
    ).all();
    return results?.[0] ?? null;
  } catch { return null; }
}

// ── JAPAN P/E D1 SOURCE ───────────────────────────────────────────────────────
async function loadJapanPeLatest(db) {
  try {
    const { results } = await db.prepare(
      `SELECT date, pe FROM japan_pe_data ORDER BY date DESC LIMIT 1`
    ).all();
    return results?.[0] ?? null;
  } catch { return null; }
}

// ── BREADTH D1 SOURCE ─────────────────────────────────────────────────────────
async function loadBreadthLatest(db, asOf = null) {
  try {
    const { results } = await db.prepare(
      `SELECT date, pct_above_200d, pct_above_50d FROM market_breadth
       WHERE pct_above_200d IS NOT NULL AND pct_above_50d IS NOT NULL${asOf ? ` AND date <= '${asOf}'` : ''}
       ORDER BY date DESC LIMIT 1`
    ).all();
    return results?.[0] ?? null;
  } catch { return null; }
}

// ── BREADTH CONTEXT (5-day delta) ─────────────────────────────────────────────
async function loadBreadthContext(db) {
  try {
    const { results } = await db.prepare(
      `SELECT pct_above_200d, pct_above_50d FROM market_breadth
       WHERE pct_above_200d IS NOT NULL AND pct_above_50d IS NOT NULL
       ORDER BY date DESC LIMIT 7`
    ).all();
    if (!results || results.length < 6) return null;
    const today = results[0], ago5 = results[5];
    const mmthDelta = today.pct_above_200d - ago5.pct_above_200d;
    const mmfiDelta = today.pct_above_50d  - ago5.pct_above_50d;
    const dirOf = (d) => d > 1 ? 'up' : d < -1 ? 'down' : 'flat';
    return { mmthDir: dirOf(mmthDelta), mmfiDir: dirOf(mmfiDelta) };
  } catch { return null; }
}

// ── ADID (advance-decline difference) — daily flow breadth ────────────────────
// Same-day net advancers − decliners (NYSE, INDEX:ADDN). Complements the
// position-based MMTH/MMFI: it catches "hollow" days (index up, breadth down)
// immediately. Returns the latest reading plus short cumulative sums (A/D line
// slope). Deep-dive context only — not a scored card row.
async function loadBreadthAdid(db) {
  try {
    const { results } = await db.prepare(
      `SELECT date, adid_nyse, adid_nasdaq FROM market_breadth
       WHERE adid_nyse IS NOT NULL OR adid_nasdaq IS NOT NULL
       ORDER BY date DESC LIMIT 10`
    ).all();
    if (!results || !results.length) return null;
    const firstNonNull = (key) => { const r = results.find(x => x[key] != null); return r ? r[key] : null; };
    const sumN = (key, n) => results.slice(0, n).reduce((s, r) => s + (r[key] ?? 0), 0);
    return {
      latest:      firstNonNull('adid_nyse'),  latestDate: results[0].date,
      cum5:        sumN('adid_nyse', 5),        cum10:      sumN('adid_nyse', 10),
      nasdaq:      firstNonNull('adid_nasdaq'), nasdaqCum5: sumN('adid_nasdaq', 5),
    };
  } catch { return null; }
}

// ── LEADERSHIP D1 SOURCE ──────────────────────────────────────────────────────
async function loadLeadershipContext(db) {
  try {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    const startDate = d.toISOString().slice(0, 10);
    const { results } = await db.prepare(
      `SELECT symbol, date, close FROM daily_prices
       WHERE symbol IN ('SPY','RSP','QQQ','QQEW') AND date >= ?
       ORDER BY date ASC`
    ).bind(startDate).all();
    if (!results || results.length < 20) return null;

    const maps = { SPY: {}, RSP: {}, QQQ: {}, QQEW: {} };
    for (const row of results) { if (maps[row.symbol]) maps[row.symbol][row.date] = row.close; }

    const dates = Object.keys(maps.SPY).filter(d => maps.RSP[d]).sort();
    if (dates.length < 2) return null;
    const d0 = dates[0], dN = dates[dates.length - 1];

    const spreadRsp = (maps.RSP[dN] / maps.RSP[d0] - 1) * 100 - (maps.SPY[dN] / maps.SPY[d0] - 1) * 100;
    let spreadQqew = null;
    if (maps.QQQ[d0] && maps.QQEW[d0] && maps.QQQ[dN] && maps.QQEW[dN]) {
      spreadQqew = (maps.QQEW[dN] / maps.QQEW[d0] - 1) * 100 - (maps.QQQ[dN] / maps.QQQ[d0] - 1) * 100;
    }

    let streak = 0;
    for (let i = dates.length - 1; i >= 1; i--) {
      const rspDay = maps.RSP[dates[i]] / maps.RSP[dates[i - 1]] - 1;
      const spyDay = maps.SPY[dates[i]] / maps.SPY[dates[i - 1]] - 1;
      if (rspDay === spyDay) break;
      const leading = rspDay > spyDay;
      if (streak === 0)               { streak = leading ? 1 : -1; }
      else if (leading  && streak > 0) { streak++; }
      else if (!leading && streak < 0) { streak--; }
      else                             { break; }
    }

    return { spreadRsp, spreadQqew, streak };
  } catch { return null; }
}

// ── BUFFETT D1 SOURCE ─────────────────────────────────────────────────────────
async function loadBuffettLatest(db) {
  try {
    const { results } = await db.prepare(
      `SELECT date, ratio FROM buffett_data ORDER BY date DESC LIMIT 1`
    ).all();
    return results?.[0] ?? null;
  } catch { return null; }
}

// ── S&P 500 EARNINGS MOMENTUM ─────────────────────────────────────────────────
// Trailing-12m EPS from sp500_eps (Multpl via TV webhook). Direction, not level:
// 6-month and YoY rate of change answer "are earnings actually growing under the
// multiple?" — a timing-relevant signal, unlike valuation level.
async function loadEpsMomentum(db, asOf = null) {
  try {
    const { results } = await db.prepare(
      `SELECT date, eps FROM sp500_eps WHERE eps IS NOT NULL${asOf ? ` AND date <= '${asOf}'` : ''} ORDER BY date DESC LIMIT 14`
    ).all();
    if (!results || results.length < 7) return null;
    const latest     = results[0].eps;
    const latestDate = results[0].date;
    const eps6  = results[6]?.eps  ?? null;   // ~6 months ago (monthly rows)
    const eps12 = results[12]?.eps ?? null;   // ~12 months ago
    const yoy = eps12 ? (latest / eps12 - 1) * 100 : null;
    const g6  = eps6  ? (latest / eps6  - 1) * 100 : null;
    return { latest, latestDate, yoy, g6 };
  } catch { return null; }
}

// ── HORIZON: HISTORICAL PERCENTILE ────────────────────────────────────────────
// Returns { value, pct } where pct (0–1) is the fraction of history <= current.
// table/col are internal constants (never user input) — safe to interpolate.
async function loadPercentile(db, table, col, asOf = null) {
  try {
    const cut = asOf ? ` AND date <= '${asOf}'` : '';
    const cur = `(SELECT ${col} FROM ${table} WHERE ${col} IS NOT NULL${cut} ORDER BY date DESC LIMIT 1)`;
    const sql =
      `SELECT
         ${cur} AS current,
         CAST((SELECT COUNT(*) FROM ${table} WHERE ${col} IS NOT NULL${cut} AND ${col} <= ${cur}) AS REAL)
           / (SELECT COUNT(*) FROM ${table} WHERE ${col} IS NOT NULL${cut}) AS pct`;
    const { results } = await db.prepare(sql).all();
    const r = results?.[0];
    if (!r || r.current == null) return null;
    return { value: r.current, pct: r.pct };
  } catch { return null; }
}

// ── HORIZON: FRED SERIES ──────────────────────────────────────────────────────
// Most-recent-first observations for a FRED series stored in D1 (Phase 2 table).
// Returns [] if the table does not yet exist so Phase 1 degrades gracefully.
async function loadFredSeries(db, seriesId, limit = 250, asOf = null) {
  try {
    const { results } = await db.prepare(
      `SELECT date, value FROM fred_series WHERE series_id = ?${asOf ? ` AND date <= '${asOf}'` : ''} ORDER BY date DESC LIMIT ?`
    ).bind(seriesId, limit).all();
    return results ?? [];
  } catch { return []; }
}


function buildValuations(shiller, buffett, forwardPe, japanPe, epsMom) {
  // CAPE and trailing P/E come from D1 (shiller_data) when available.
  // Buffett Indicator comes from D1 (buffett_data) when available.
  // Forward P/E and Japan P/E come from D1 (nightly cron) when available.
  const cape         = shiller?.cape;
  const price        = shiller?.pePrice    ?? shiller?.price;
  const earnings     = shiller?.peEarnings ?? shiller?.earnings;
  const latestDate   = shiller?.date;
  const buffettRatio = buffett?.ratio ?? null;

  // Stale if stored month is 2+ months behind today (1-month lag is normal publish delay)
  const capeStale = (() => {
    if (!latestDate) return true;
    const d = new Date(latestDate);
    const now = new Date();
    return (now.getFullYear() * 12 + now.getMonth()) - (d.getFullYear() * 12 + d.getMonth()) > 1;
  })();

  const capeStr  = cape    ? `${cape.toFixed(1)}×${capeStale ? ' *' : ''}` : '~37×';
  const peVal    = price && earnings && earnings > 0 ? price / earnings : null;
  const peStr    = peVal != null ? `${peVal.toFixed(1)}×` : '~28×';
  const peStatus = peVal == null ? 'neutral' : peVal > 22 ? 'bearish' : peVal > 16 ? 'neutral' : 'bullish';
  const peCond   = peVal == null ? 'Elevated \u2014 Monitor (hist avg ~16×)'
    : peVal > 22 ? 'Elevated \u2014 Favour Value Over Growth'
    : peVal > 18 ? 'Above Average \u2014 Quality Bias'
    : peVal > 16 ? 'Near Average \u2014 Fully Valued'
    :              'Below Average \u2014 Add on Weakness';
  const dateLabel = latestDate
    ? new Date(latestDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Jun 2026';

  const capeStatus = cape
    ? (cape > 35 ? 'bearish' : cape > 20 ? 'neutral' : 'bullish')
    : 'bearish';
  const capeCond = cape
    ? (cape > 40 ? 'Extreme \u2014 Near 2000 Peak, Limit Exposure'
      : cape > 35 ? 'Very High \u2014 Reduce Equity Allocation'
      : cape > 25 ? 'Elevated \u2014 Quality Bias'
      :             'Normal Range \u2014 Average Expected Returns')
    : 'Very High \u2014 Limit New Exposure';

  const japanPeVal  = japanPe?.pe ?? null;
  const japanPeStr  = japanPeVal != null ? `${japanPeVal.toFixed(1)}×` : '~15×';
  const trailPe  = price && earnings && earnings > 0 ? price / earnings : null;
  const liveUsPe = forwardPe?.pe ?? trailPe;  // live SPY trailing P/E preferred over stale Shiller
  const japanStatus = japanPeVal != null && liveUsPe != null
    ? (japanPeVal < liveUsPe * 0.8 ? 'bullish' : japanPeVal < liveUsPe ? 'neutral' : 'bearish')
    : 'bullish';
  const japanCond = japanPeVal != null && liveUsPe != null
    ? (japanPeVal < liveUsPe
        ? `Compressed vs US (${liveUsPe.toFixed(0)}×) \u2014 Favour International`
        : `In Line with US (${liveUsPe.toFixed(0)}×) \u2014 No Valuation Edge`)
    : 'Compressed vs US \u2014 Favour International';

  const rows = [
    { label: 'Trailing P/E',  indicator: 'S&P 500 Trailing P/E (Shiller, 1-2mo lag)', value: peStr, condition: peCond, status: peStatus },
    { label: 'CAPE',          indicator: 'Shiller CAPE (10yr)',          value: capeStr,  condition: capeCond,                   status: capeStatus   },
    { label: 'Buffett Ind.',  indicator: 'Mkt Cap / GDP (Buffett)',
      value:     buffettRatio != null ? `${buffettRatio.toFixed(0)}%` : '~230%',
      condition: buffettRatio != null
        ? (buffettRatio > 160 ? 'Extreme \u2014 Near Peak, Limit Exposure'
          : buffettRatio > 115 ? 'Overvalued \u2014 Reduce Allocation'
          : buffettRatio > 80  ? 'Fairly Valued \u2014 Neutral Allocation'
          :                      'Undervalued \u2014 Accumulate on Dips')
        : 'Extreme \u2014 Near Peak, Limit Exposure',
      status: buffettRatio != null
        ? (buffettRatio > 115 ? 'bearish' : buffettRatio > 80 ? 'neutral' : 'bullish')
        : 'bearish' },
    // Row 5 \u2014 deep-dive context only; excluded from card status
    { label: 'Japan P/E',     indicator: 'EWJ (Japan ETF) vs S&P 500', value: japanPeStr, condition: japanCond, status: japanStatus },
    // Row 6 \u2014 earnings DIRECTION (not level); the timing-relevant part of valuation.
    // Displayed here for context; scored in the Trend Compass horizon, not this card.
    { label: 'Earnings Trend', indicator: 'S&P 500 TTM EPS \u2014 YoY Change (Multpl)',
      value:     epsMom?.yoy != null ? `${epsMom.yoy >= 0 ? '+' : ''}${epsMom.yoy.toFixed(1)}%` : '\u2014',
      condition: epsMom?.yoy == null ? 'Awaiting Data'
        : epsMom.yoy > 5    ? 'Earnings Expanding \u2014 Fundamentals Support'
        : epsMom.yoy >= -2  ? 'Earnings Flat \u2014 Watch for a Turn'
        :                     'Earnings Contracting \u2014 Earnings Recession',
      status:    epsMom?.yoy == null ? 'neutral' : epsMom.yoy > 2 ? 'bullish' : epsMom.yoy < -2 ? 'bearish' : 'neutral' },
  ];

  const stats = [
    ['CAPE',         capeStr,                                                             'avg ~17× (100yr)',  capeStatus  === 'bearish' ? 'neg' : capeStatus  === 'bullish' ? 'pos' : null],
    ['Trailing P/E', peStr,                                                               'avg ~16×',          peStatus    === 'bearish' ? 'neg' : peStatus    === 'bullish' ? 'pos' : null],
    ['Buffett Ind.',  buffettRatio != null ? buffettRatio.toFixed(0) + '%' : '~230%',    'Mkt Cap / GDP',     buffettRatio != null ? (buffettRatio > 115 ? 'neg' : buffettRatio <= 80 ? 'pos' : null) : 'neg'],
  ];
  return {
    id: 'valuations', number: 4, title: 'Valuations', subtitle: 'The Rubber Band',
    status: cardStatus(rows.slice(0, 3)),  // Japan P/E is deep-dive context only
    rows, stats, hideIndicator: true,
    note: [
      'Valuations set return expectations over a 5–10 year horizon, not near-term entry points — always combine with Regime and Credit before acting.',
      cape != null ? `CAPE ${cape.toFixed(1)}× (${dateLabel}) — ${cape > 35 ? 'top historical decile; 10-year real returns have historically been 0–2% per year from this level' : cape > 25 ? 'elevated vs the ~17× long-run average; expected long-run returns compress from here' : 'near long-run average; expected returns are normal'}.` : null,
      buffettRatio != null ? `Buffett Indicator (total market cap / GDP) at ${buffettRatio.toFixed(0)}% — ${buffettRatio > 160 ? 'extreme overvaluation; the ratio has only been higher at the 2000 dot-com peak' : buffettRatio > 115 ? 'overvalued vs GDP; historically signals sub-average forward returns' : 'within a fair-value range for this metric'}.` : null,
      epsMom?.yoy != null ? `S&P 500 trailing EPS is ${epsMom.yoy >= 0 ? 'up' : 'down'} ${Math.abs(epsMom.yoy).toFixed(1)}% year-over-year — ${epsMom.yoy > 5 ? 'earnings are expanding, giving the multiple genuine fundamental support' : epsMom.yoy >= -2 ? 'earnings are broadly flat; the multiple is doing the work here, not earnings' : 'earnings are contracting (an earnings recession) — multiples expanding on falling earnings is a classic late-cycle warning'}.` : null,
      japanPeVal != null && liveUsPe != null ? `Japan (EWJ) trades at ${japanPeVal.toFixed(1)}× vs US ${liveUsPe.toFixed(0)}× — ${japanPeVal < liveUsPe ? `a ${((1 - japanPeVal / liveUsPe) * 100).toFixed(0)}% valuation discount; international equities retain a structural valuation edge` : 'the valuation gap has closed; no clear international valuation premium at this time'}.` : null,
      'At current multiples, portfolio construction should favour quality over quantity: earnings visibility, strong balance sheets, and reasonable P/E relative to growth (PEG ≤ 1).',
    ].filter(Boolean).join(' '),
  };
}

function buildYield(q, realYield) {
  const tyx = q['^TYX'], tnx = q['^TNX'], irx = q['^IRX'], shy = q['SHY'];

  const yieldVal   = tyx?.price;
  const yieldRnd   = yieldVal != null ? Math.round(yieldVal * 100) / 100 : null;
  const yieldStat  = yieldRnd == null ? 'neutral' : yieldRnd >= 5 ? 'bearish' : yieldRnd > 4.5 ? 'neutral' : 'bullish';

  // Real yield (10Y TIPS, DFII10) is the cleaner restrictiveness gauge than the
  // nominal level: it strips out inflation and neutral-rate drift, so a fixed
  // threshold actually means the same thing across regimes. Falls back to the
  // nominal 10Y when the FRED series is unavailable.
  const hasReal  = realYield != null && !Number.isNaN(realYield);
  const realStat = !hasReal ? null
    : realYield >= 2.5 ? 'bearish'
    : realYield >= 1.0 ? 'neutral'
    : 'bullish';
  const realCond = !hasReal ? null
    : realYield >= 2.5 ? 'Highly Restrictive — Multiple Compression'
    : realYield >= 1.0 ? 'Restrictive — Valuation Headwind'
    : realYield >= 0.0 ? 'Low Real Rates — Multiples Supported'
    :                    'Negative Real Rates — Strong Tailwind';

  const curveSpread  = tnx?.price != null && irx?.price != null ? tnx.price - irx.price : null;
  const curveStatus  = curveSpread == null ? 'neutral' : curveSpread < 0 ? 'bearish' : curveSpread < 1 ? 'neutral' : 'bullish';
  const curveCond    = curveSpread == null ? '\u2014'
    : curveSpread < -0.5 ? 'Deeply Inverted \u2014 Recession Risk Elevated'
    : curveSpread < 0    ? 'Inverted \u2014 Recession Warning'
    : curveSpread < 1    ? 'Flat \u2014 Watch for Steepening'
    :                      'Steepening \u2014 Growth Expectations Returning';

  const rows = [
    {
      label: '30Y Yield',
      indicator: 'US 30-Year Yield (^TYX)',
      value: yieldVal ? yieldVal.toFixed(2) + '%' : '\u2014',
      condition: yieldRnd == null ? '\u2014' : yieldRnd >= 5 ? 'At/Above 5% \u2014 Equity Multiple Compression' : yieldRnd > 4.5 ? 'Approaching 5% \u2014 Reduce Duration Risk' : 'Below 5% \u2014 Multiples Supported',
      status: yieldStat,
    },
    hasReal ? {
      label: '10Y Real Yield',
      indicator: '10Y TIPS Real Yield (DFII10)',
      value: `${realYield.toFixed(2)}%`,
      condition: realCond,
      status: realStat,
    } : {
      label: '10Y Yield',
      indicator: 'US 10-Year Yield (^TNX)',
      value: tnx?.price ? tnx.price.toFixed(2) + '%' : '\u2014',
      condition: tnx?.price == null ? '\u2014'
        : tnx.price >= 4.5 ? 'Restrictive \u2014 Compressing Equity Multiples'
        : tnx.price >= 3.5 ? 'Elevated \u2014 Headwind for Growth'
        : tnx.price >= 2.5 ? 'Neutral'
        :                    'Accommodative \u2014 Tailwind for Equities',
      status: tnx?.price == null ? 'neutral'
        : tnx.price >= 4.5 ? 'bearish'
        : tnx.price >= 3.5 ? 'neutral'
        : 'bullish',
    },
    {
      label: 'Yield Curve',
      indicator: '3m–10Y Spread (Recession Signal)',
      value: curveSpread != null ? (curveSpread >= 0 ? '+' : '') + curveSpread.toFixed(2) + '%' : '\u2014',
      condition: curveCond,
      status: curveStatus,
    },
    {
      label: '2Y Trend',
      indicator: 'SHY \u2014 1-3yr Treasury ETF vs 200d SMA',
      value: shy?.price != null ? usd(shy.price) : '\u2014',
      condition: shy?.vs200 == null ? '\u2014'
        : shy.vs200 > 0 ? 'Above 200d \u2014 Short Rates Easing \u00b7 Fed Dovish'
        : 'Below 200d \u2014 Short Rates Rising \u00b7 Fed Hawkish',
      status: shy?.vs200 == null ? 'neutral' : shy.vs200 > 0 ? 'bullish' : 'bearish',
    },
  ];
  const status = yieldStat === 'bearish' ? 'bearish' : cardStatus(rows);
  const yieldNote = (() => {
    const s30 = yieldRnd == null ? 'The 30-year yield is unavailable.'
      : yieldRnd >= 5 ? `The 30-year yield is at ${yieldRnd}% — above the critical 5% threshold where equity multiple compression historically accelerates.`
      : yieldRnd > 4.5 ? `The 30-year yield is at ${yieldRnd}% — approaching the 5% danger zone; rate-sensitive sectors are under pressure.`
      : `The 30-year yield is at ${yieldRnd}% — below the 5% threshold; long-duration assets and growth equities are supported.`;
    const s10 = hasReal
      ? ` The 10-year real yield (TIPS) is ${realYield.toFixed(2)}%${tnx?.price != null ? ` (nominal ${tnx.price.toFixed(2)}%)` : ''} — ${realYield >= 2.5 ? 'firmly restrictive; positive real rates this high compress equity multiples and make cash competitive' : realYield >= 1.0 ? 'moderately restrictive; a valuation headwind for long-duration and growth equities' : realYield >= 0 ? 'low and supportive of equity multiples' : 'negative in real terms — a strong tailwind for risk assets and long-duration growth'}.`
      : (tnx?.price != null
        ? ` The 10-year yield at ${tnx.price.toFixed(2)}% is ${tnx.price >= 4.5 ? 'in restrictive territory — real borrowing costs are elevated and consumer credit is tightening' : tnx.price >= 3.5 ? 'elevated but not restrictive — a headwind for rate-sensitive stocks' : 'accommodative — supporting housing and consumer spending'}.`
        : '');
    const sCurve = curveSpread == null ? ''
      : curveSpread < 0 ? ` The yield curve is inverted (${pct(curveSpread, 2)}) — historically, inversions precede recessions by 12–18 months; a hard landing remains a risk.`
      : curveSpread < 1 ? ` The yield curve is flat (${pct(curveSpread, 2)}) — transitioning from inversion; steepening would signal a recovery outlook.`
      : ` The yield curve is steepening (${pct(curveSpread, 2)}) — growth expectations are rebuilding; cyclicals historically outperform in this phase.`;
    const sShy = shy?.vs200 != null
      ? ` SHY (2yr Treasury ETF) is ${shy.vs200 > 0 ? 'above its 200d SMA — the short end is in an uptrend; the market is pricing Fed rate cuts or a pause' : 'below its 200d SMA — the short end is under pressure; the Fed remains in tightening mode'}.`
      : '';
    const sAction = yieldRnd != null
      ? (yieldRnd >= 5 ? ' Action: shorten duration, tilt to value, hold cash as a real asset.' : yieldRnd > 4.5 ? ' Action: reduce duration risk; favour short-dated bonds and dividend growers.' : ' Action: rates are supportive — maintain equity exposure and consider adding duration on dips.')
      : '';
    return s30 + s10 + sCurve + sShy + sAction;
  })();
  const stats = [
    ['30Y Yield',    yieldVal   != null ? yieldVal.toFixed(2)          + '%' : '\u2014', '5% = equity headwind',    yieldStat    === 'bearish' ? 'neg' : yieldStat   === 'bullish' ? 'pos' : null],
    hasReal
      ? ['10Y Real',  realYield.toFixed(2) + '%', '2.5%+ = restrictive', realStat === 'bearish' ? 'neg' : realStat === 'bullish' ? 'pos' : null]
      : ['10Y Yield', tnx?.price != null ? tnx.price.toFixed(2) + '%' : '\u2014', '4.5%+ = restrictive', tnx?.price != null ? (tnx.price >= 4.5 ? 'neg' : tnx.price < 3.5 ? 'pos' : null) : null],
    ['Curve 3m–10Y', curveSpread != null ? (curveSpread >= 0 ? '+' : '') + curveSpread.toFixed(2) + '%' : '\u2014', 'inversion = recession risk', curveStatus === 'bearish' ? 'neg' : curveStatus === 'bullish' ? 'pos' : null],
  ];
  return { id: 'yield', number: 5, title: 'Yield', subtitle: 'The Cost of Capital', status, rows, stats, hideIndicator: true, note: yieldNote };
}

function buildGlobalFlows(q) {
  // ── Card-level regional ETFs (no flag emojis) ─────────────────────────────
  const cardSyms = [
    { sym: 'ACWI',    label: 'MSCI ACWI',      region: 'Global'   },
    { sym: 'SPY',     label: 'S&P 500',         region: 'USA'      },
    { sym: '^GSPTSE', label: 'S&P/TSX',         region: 'Canada'   },
    { sym: 'FEZ',     label: 'Euro STOXX 50',   region: 'Europe'   },
    { sym: 'AIA',     label: 'Asia 50',         region: 'Asia'     },
    { sym: 'ILF',     label: 'LatAm 40',        region: 'LatAm'    },
    { sym: 'EEM',     label: 'Emerging Mkts',   region: 'Emerging' },
  ];

  // ── Country deep-dive (geographic order, flags rendered in frontend) ───────
  const countrySyms = [
    { sym: 'SPY',     label: 'S&P 500',     group: 'North America' },
    { sym: '^GSPTSE', label: 'Canada',       group: 'North America' },
    { sym: 'EWU',     label: 'UK',           group: 'Europe'        },
    { sym: 'EWG',     label: 'Germany',      group: 'Europe'        },
    { sym: 'EWQ',     label: 'France',       group: 'Europe'        },
    { sym: 'EWL',     label: 'Switzerland',  group: 'Europe'        },
    { sym: 'EWN',     label: 'Netherlands',  group: 'Europe'        },
    { sym: 'EWI',     label: 'Italy',        group: 'Europe'        },
    { sym: 'EWP',     label: 'Spain',        group: 'Europe'        },
    { sym: 'EWJ',     label: 'Japan',        group: 'Asia Pacific'  },
    { sym: 'MCHI',    label: 'China',        group: 'Asia Pacific'  },
    { sym: 'EWT',     label: 'Taiwan',       group: 'Asia Pacific'  },
    { sym: 'EWY',     label: 'S. Korea',     group: 'Asia Pacific'  },
    { sym: 'INDA',    label: 'India',        group: 'Asia Pacific'  },
    { sym: 'EWA',     label: 'Australia',    group: 'Asia Pacific'  },
    { sym: 'EWH',     label: 'Hong Kong',    group: 'Asia Pacific'  },
    { sym: 'EWZ',     label: 'Brazil',       group: 'Latin America' },
    { sym: 'EWW',     label: 'Mexico',       group: 'Latin America' },
    { sym: 'ECH',     label: 'Chile',        group: 'Latin America' },
  ];

  // ── Build card rows ────────────────────────────────────────────────────────
  let bull = 0;
  const cardDetails = cardSyms.map(({ sym, label, region }) => {
    const d = q[sym];
    const above = !!(d?.price && d?.sma200 && d.price > d.sma200);
    if (above) bull++;
    const vs200 = d?.vs200;
    return { sym, label, region, above, vs200Str: vs200 != null ? pct(vs200) : '\u2014', value: d ? usd(d.price) : '\u2014' };
  });

  const total = cardSyms.length;
  const gStatus = bull >= 6 ? 'bullish' : bull >= 4 ? 'neutral' : 'bearish';

  // Helper: build one regional row (ACWI and EEM get vs200 as lead value for card tile)
  const makeRow = (sym, label, region) => {
    const cd = cardDetails.find(d => d.sym === sym);
    if (!cd) return null;
    const { above, vs200Str, value } = cd;
    const condition = sym === 'ACWI'
      ? (above ? `Bull Market Intact (${vs200Str}) \u2014 Long Bias`      : `Bear Market Signal (${vs200Str}) \u2014 Defensive Bias`)
      : sym === 'EEM'
      ? (above ? `EM Risk-On (${vs200Str}) \u2014 EM Overweight Bias`     : `EM Risk-Off (${vs200Str}) \u2014 EM Underweight`)
      : (above ? `Uptrend (${vs200Str}) \u2014 Overweight`                : `Downtrend (${vs200Str}) \u2014 Underweight`);
    const displayValue = (sym === 'ACWI' || sym === 'EEM') && vs200Str !== '\u2014'
      ? `${vs200Str}<br>${value}`
      : value;
    return { label: region, indicator: `${label} (${sym})`, value: displayValue, condition, status: above ? 'bullish' : 'bearish' };
  };

  const rows = [
    // rows[0-2]: KPI rows shown on card tile
    {
      label: 'Regional Bull',
      indicator: `${bull}/${total} indexes above 200d SMA`,
      value: `${bull} / ${total}`,
      condition: bull >= 6 ? 'Synchronized Expansion \u2014 Risk-On'
        : bull >= 4 ? 'Partial Expansion \u2014 Favour Leaders'
        : 'Global Weakness \u2014 Defensive Bias',
      status: gStatus,
    },
    makeRow('ACWI',    'MSCI ACWI',      'Global'),
    makeRow('EEM',     'Emerging Mkts',  'Emerging'),
    // rows[3-7]: remaining regional rows (shown in deep dive Indicators table)
    makeRow('SPY',     'S&P 500',        'USA'),
    makeRow('^GSPTSE', 'S&P/TSX',        'Canada'),
    makeRow('FEZ',     'Euro STOXX 50',  'Europe'),
    makeRow('AIA',     'Asia 50',        'Asia'),
    makeRow('ILF',     'LatAm 40',       'LatAm'),
  ].filter(Boolean);

  // ── Country deep-dive details ──────────────────────────────────────────────
  const details = countrySyms.map(({ sym, label, group }) => {
    const d = q[sym];
    const above = !!(d?.price && d?.sma200 && d.price > d.sma200);
    const vs200 = d?.vs200;
    return { group, label, sym, value: d ? usd(d.price) : '\u2014', vs200: vs200 != null ? pct(vs200) : '\u2014', above };
  });

  // ── Note ──────────────────────────────────────────────────────────────────
  const acwi = cardDetails.find(d => d.sym === 'ACWI');
  const flowNote = (() => {
    const sCount = bull >= 6
      ? `${bull}/${total} regional indexes are above their 200d SMA — synchronized global expansion; broad risk-on conditions prevail.`
      : bull >= 4
      ? `${bull}/${total} regional indexes are above their 200d SMA — partial global expansion; favour the strongest regional trends.`
      : `Only ${bull}/${total} regional indexes are above their 200d SMA — broad global weakness; raise cash and underweight international equity.`;
    const sAcwi = acwi
      ? ` ACWI is ${acwi.above ? `above its 200d SMA (${acwi.vs200Str}) — the global bull market is structurally intact` : `below its 200d SMA (${acwi.vs200Str}) — the global bull market has broken down; reduce broad equity exposure`}.`
      : '';
    const usaD = cardDetails.find(d => d.sym === 'SPY');
    const sUsa = usaD
      ? (usaD.above
        ? ` The US (S&P 500) is above its 200d SMA (${usaD.vs200Str}) — domestic leadership is intact; a US-first allocation bias is justified until international breadth improves.`
        : ` The US (S&P 500) is below its 200d SMA (${usaD.vs200Str}) — domestic leadership has broken; reallocate toward regions holding their 200d SMA.`)
      : '';
    const emD = cardDetails.find(d => d.sym === 'EEM');
    const sEm = emD
      ? ` EM equities (EEM) are ${emD.above ? `above their 200d SMA (${emD.vs200Str}) — EM risk appetite is open; EM exposure is tactically justified` : `below their 200d SMA (${emD.vs200Str}) — EM risk is off; avoid unhedged EM exposure`}.`
      : '';
    return sCount + sAcwi + sUsa + sEm;
  })();

  const acwiDetail = cardDetails.find((d) => d.sym === 'ACWI');
  const eemDetail  = cardDetails.find((d) => d.sym === 'EEM');
  const stats = [
    ['Regional Bull', `${bull} / ${total}`,          'indexes above 200d SMA', bull >= 6 ? 'pos' : bull < 4 ? 'neg' : null],
    ['ACWI vs 200d',  acwiDetail?.vs200Str || '\u2014',   'global market proxy',    acwiDetail?.above ? 'pos' : 'neg'],
    ['Emerg. Mkts',   eemDetail?.vs200Str  || '\u2014',   'EM risk appetite',       eemDetail?.above  ? 'pos' : 'neg'],
  ];
  return { id: 'globalflows', number: 8, title: 'Global Flows', subtitle: 'The Tide', status: gStatus, rows, stats, details, hideIndicator: true, note: flowNote };
}

function buildSectors(q, sectorWeights) {
  // Full 11-sector GICS universe (SPDR ETFs)
  const SECTOR_META = {
    XLK:  { name: 'Technology',            type: 'cyclical'  },
    XLY:  { name: 'Consumer Disc.',        type: 'cyclical'  },
    XLC:  { name: 'Comm. Services',        type: 'cyclical'  },
    XLI:  { name: 'Industrials',           type: 'cyclical'  },
    XLF:  { name: 'Financials',            type: 'cyclical'  },
    XLE:  { name: 'Energy',                type: 'cyclical'  },
    XLB:  { name: 'Materials',             type: 'cyclical'  },
    XLV:  { name: 'Health Care',           type: 'defensive' },
    XLP:  { name: 'Consumer Staples',      type: 'defensive' },
    XLU:  { name: 'Utilities',             type: 'defensive' },
    XLRE: { name: 'Real Estate',           type: 'defensive' },
  };

  const SECTOR_WEIGHTS = sectorWeights ?? {
    XLK: 0.31, XLF: 0.13, XLV: 0.12, XLC: 0.09, XLY: 0.10,
    XLI: 0.09, XLP: 0.06, XLE: 0.04, XLB: 0.02, XLRE: 0.02, XLU: 0.02,
  };

  const spy   = q['SPY'];
  const ret20 = s => s?.price20d ? (s.price / s.price20d - 1) * 100 : s?.changePct ?? null;
  const spy20 = ret20(spy);

  const allSectors = Object.entries(SECTOR_META).map(([sym, meta]) => {
    const d = q[sym];
    if (!d || !spy) return null;
    const relPerf = (ret20(d) ?? 0) - (spy20 ?? 0);
    const abv200  = !!(d.price && d.sma200 && d.price > d.sma200);
    let condition, status;
    if (meta.type === 'cyclical') {
      if (abv200 && relPerf > 0) {
        condition = `Leader (${pct(relPerf, 1)} vs SPY) \u2014 Overweight`;
        status    = 'bullish';
      } else if (abv200) {
        condition = `In Trend, Lagging (${pct(relPerf, 1)} vs SPY) \u2014 Hold`;
        status    = 'neutral';
      } else if (relPerf > 0) {
        condition = `Below 200d, Outpacing SPY (${pct(relPerf, 1)}) \u2014 Reduce`;
        status    = 'bearish';
      } else {
        condition = `Trend Broken (${pct(relPerf, 1)} vs SPY) \u2014 Underweight`;
        status    = 'bearish';
      }
    } else {
      if (abv200 && relPerf > 0) {
        condition = `Safe Haven Bid (${pct(relPerf, 1)} vs SPY) \u2014 Risk-Off Signal`;
        status    = 'bearish';
      } else if (abv200) {
        condition = `Quiet Defensive (${pct(relPerf, 1)} vs SPY) \u2014 Risk-On Lean`;
        status    = 'neutral';
      } else {
        condition = `No Safe Haven Bid (${pct(relPerf, 1)} vs SPY) \u2014 Risk-On`;
        status    = 'bullish';
      }
    }
    return { sym, ...meta, abv200, relPerf, condition, status, value: usd(d.price), price: d.price, sma200: d.sma200 ?? null };
  }).filter(Boolean);

  const cycRows  = allSectors.filter(r => r.type === 'cyclical');
  const defRows  = allSectors.filter(r => r.type === 'defensive');
  const cycBull  = cycRows.filter(r => r.abv200).length;
  const defBull  = defRows.filter(r => r.abv200).length;
  const offenseLeading = cycBull > defBull;

  // Card status: avg 20d relative performance (vs SPY) \u2014 cyclicals vs defensives
  const avg   = arr => arr.length ? arr.reduce((s, r) => s + r.relPerf, 0) / arr.length : 0;
  const spread = avg(cycRows) - avg(defRows);   // positive = cyclicals leading
  const sectStatus = spread > 1 ? 'bullish' : spread < -1 ? 'bearish' : 'neutral';

  // Top 3 leaders + bottom 3 laggards, best→worst order, no duplicates
  const sortedAll = [...allSectors].sort((a, b) => b.relPerf - a.relPerf);
  const top3   = sortedAll.slice(0, 3);
  const bot3   = sortedAll.slice(-3);
  const seen   = new Set();
  const curated = [...top3, ...bot3].filter(r => r && !seen.has(r.sym) && seen.add(r.sym));

  const top3Syms = new Set(top3.map(r => r.sym));
  const bot3Syms = new Set(bot3.map(r => r.sym));

  const mapRow = r => ({
    label: r.name,
    indicator: r.sym,
    value: r.value,
    condition: r.condition,
    status: top3Syms.has(r.sym) ? 'bullish' : bot3Syms.has(r.sym) ? 'bearish' : 'neutral',
    price: r.price,
    sma200: r.sma200,
    weight: SECTOR_WEIGHTS[r.sym] ?? null,
    relPerf: r.relPerf,
  });

  const rows    = curated.map(mapRow);
  const allRows = sortedAll.map(mapRow);

  const spreadStr = (spread >= 0 ? '+' : '') + spread.toFixed(1) + '%';
  const sectNote = (() => {
    const sRotation = spread > 1
      ? `Cyclicals are leading defensives by ${spreadStr} (20d avg vs SPY) — a clear risk-on rotation signal.`
      : spread < -1
      ? `Defensives are outpacing cyclicals by ${Math.abs(spread).toFixed(1)}% (20d avg vs SPY) — flight-to-safety rotation; risk-off conditions prevailing.`
      : `Cyclicals and defensives near parity (${spreadStr} spread, 20d avg vs SPY) — no clear directional rotation signal; the market is digesting.`;
    const sCounts = ` ${cycBull}/${cycRows.length} cyclical and ${defBull}/${defRows.length} defensive sectors are above their 200d SMA.`;
    // Only cyclicals in trend are overweight candidates — a defensive sector
    // leading the tape is a safe-haven bid (risk-off warning), never a buy call.
    const cycLeaders = top3.filter(r => r.type === 'cyclical' && r.abv200);
    const defLeaders = top3.filter(r => r.type === 'defensive');
    const sLeaders = cycLeaders.length
      ? ` Leading cyclicals: ${cycLeaders.map(r => r.name).join(', ')} — overweight these in a risk-on environment.`
      : '';
    const sDefBid = defLeaders.length
      ? ` ${defLeaders.map(r => r.name).join(', ')} leading the tape is a safe-haven bid — a risk-off warning, not a buy signal.`
      : '';
    const sLaggards = bot3.length
      ? ` Lagging sectors: ${bot3.map(r => r.name).join(', ')} — underweight until they recapture their 200d SMA.`
      : '';
    const sAction = spread > 0
      ? ' Action: tilt toward cyclicals and sectors with positive 200d + relative-performance alignment.'
      : ' Action: shift toward defensive sectors and quality; wait for cyclical breadth to recover before adding risk.';
    return sRotation + sCounts + sLeaders + sDefBid + sLaggards + sAction;
  })();

  const stats = [
    ['Cyclical vs Defensive', (spread >= 0 ? '+' : '') + spread.toFixed(1) + '%', '20d avg rel perf vs SPY', spread > 1 ? 'pos' : spread < -1 ? 'neg' : null],
    ['Cyclicals',  `${cycBull} / ${cycRows.length}`,  'above 200d SMA',  cycBull >= 5 ? 'pos' : cycBull < 3 ? 'neg' : null],
    ['Defensives', `${defBull} / ${defRows.length}`, 'above 200d SMA',  defBull >= 3 ? 'neg' : defBull <= 1 ? 'pos' : null],
  ];
  // Overweight/underweight candidates for the Action Directive: only cyclicals
  // qualify either way (defensive leadership is a risk signal, not a buy call).
  // R6 will upgrade this to RRG-quadrant persistence.
  const overweights = allSectors.filter(r => r.type === 'cyclical' && r.abv200 && r.relPerf > 0)
    .sort((a, b) => b.relPerf - a.relPerf)
    .map(r => ({ sym: r.sym, name: r.name, relPerf: +r.relPerf.toFixed(1) }));
  const underweights = allSectors.filter(r => r.type === 'cyclical' && !r.abv200)
    .sort((a, b) => a.relPerf - b.relPerf)
    .map(r => ({ sym: r.sym, name: r.name, relPerf: +r.relPerf.toFixed(1) }));
  return { id: 'sectors', number: 9, title: 'Sectors', subtitle: 'The Rotation', status: sectStatus, rows, stats, allRows, hideIndicator: true, note: sectNote, overweights, underweights };
}

function buildCommodities(q, commCtx) {
  const COM_META = [
    { sym: 'USCI',  label: 'USCI',         role: 'benchmark'   },
    { sym: 'CPER',  label: 'Copper',       role: 'growth'      },
    { sym: 'GLD',   label: 'Gold',         role: 'safehaven'   },
    { sym: 'SLV',   label: 'Silver',       role: 'silver'      },
    { sym: 'IXC',   label: 'Energy',       role: 'energy'      },
    { sym: 'DBA',   label: 'Agriculture',  role: 'agriculture' },
    { sym: 'SLX',   label: 'Steel',        role: 'industrial'  },
    { sym: 'URA',   label: 'Uranium',      role: 'uranium'     },
  ];

  let bull = 0;
  const rows = COM_META.map(({ sym, label, role }) => {
    const d = q[sym];
    const above   = !!(d?.price && d?.sma200 && d.price > d.sma200);
    const abv50   = !!(d?.price && d?.sma50  && d.price > d.sma50);
    const abvBoth = above && abv50;
    const v200  = d?.vs200 ?? null;
    const v200s = v200 != null ? pct(v200, 1) : null;
    const val   = d ? usd(d.price) : '\u2014';
    let condition, rowStatus;

    if (!d || v200s == null) {
      condition = '\u2014'; rowStatus = 'neutral';
    } else if (role === 'safehaven') {
      // Gold: macro signal is INVERTED \u2014 leading = risk-off warning, fading = risk-on confirmed
      if (above && v200 > 5) {
        condition  = `Safe Haven Bid (${v200s} vs 200d) \u2014 Risk-Off Warning`;
        rowStatus  = 'bearish';
      } else if (above) {
        condition  = `Gold Holding (${v200s} vs 200d) \u2014 Watch`;
        rowStatus  = 'neutral';
      } else {
        condition  = `Safe Haven Fading (${v200s} vs 200d) \u2014 Risk-On Confirmed`;
        rowStatus  = 'bullish';
      }
    } else if (role === 'silver') {
      // Silver: leads copper when industrial demand > fear; leads gold when growth > safety
      // Needs >2% above 200d to confirm industrial bid (same threshold as agriculture)
      if (above && v200 > 2) {
        condition = `Industrial Metals Bid (${v200s} vs 200d) \u2014 Growth > Fear`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Silver Holding (${v200s} vs 200d) \u2014 Neutral`;
        rowStatus = 'neutral';
      } else {
        condition = `Silver Weak (${v200s} vs 200d) \u2014 Fear > Growth`;
        rowStatus = 'bearish';
      }
    } else if (role === 'growth') {
      if (abvBoth) {
        condition = `Growth Confirmed (${v200s} vs 200d) \u2014 Risk-On`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Copper Pulling Back (${v200s} vs 200d) \u2014 Wait for 50d Recapture`;
        rowStatus = 'neutral';
      } else {
        condition = `Growth Warning (${v200s} vs 200d) \u2014 Caution`;
        rowStatus = 'bearish';
      }
    } else if (role === 'energy') {
      if (abvBoth) {
        condition = `Energy Trending (${v200s} vs 200d) \u2014 Overweight Energy`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Energy Pulling Back (${v200s} vs 200d) \u2014 Wait for 50d Recapture`;
        rowStatus = 'neutral';
      } else {
        condition = `Energy Weak (${v200s} vs 200d) \u2014 Underweight Energy`;
        rowStatus = 'bearish';
      }
    } else if (role === 'agriculture') {
      // Needs >2% above 200d to qualify as trending
      if (above && v200 > 2) {
        condition = `Ag Trending (${v200s} vs 200d) \u2014 Food Inflation Watch`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Ag At 200d (${v200s} vs 200d) \u2014 Neutral`;
        rowStatus = 'neutral';
      } else {
        condition = `Ag Weak (${v200s} vs 200d) \u2014 Benign Food Prices`;
        rowStatus = 'bearish';
      }
    } else if (role === 'industrial') {
      if (abvBoth) {
        condition = `Capex Cycle Active (${v200s} vs 200d) \u2014 Overweight Industrials`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Capex Slowing (${v200s} vs 200d) \u2014 Wait for 50d Recapture`;
        rowStatus = 'neutral';
      } else {
        condition = `Capex Weak (${v200s} vs 200d) \u2014 Reduce Industrial Exposure`;
        rowStatus = 'bearish';
      }
    } else if (role === 'uranium') {
      if (above && v200 > 5) {
        condition = `Nuclear Demand Active (${v200s} vs 200d) \u2014 Energy Transition Bid`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Uranium Holding (${v200s} vs 200d) \u2014 Neutral`;
        rowStatus = 'neutral';
      } else {
        condition = `Uranium Weak (${v200s} vs 200d) \u2014 Nuclear Demand Fading`;
        rowStatus = 'bearish';
      }
    } else {
      // benchmark (USCI)
      if (abvBoth) {
        condition = `Trend Intact (${v200s} vs 200d) \u2014 Real Assets Favourable`;
        rowStatus = 'bullish';
      } else if (above) {
        condition = `Pulling Back (${v200s} vs 200d) \u2014 Watch 50d`;
        rowStatus = 'neutral';
      } else {
        condition = `Below 200d (${v200s}) \u2014 Real Assets Under Pressure`;
        rowStatus = 'bearish';
      }
    }

    // Count bullish signals \u2014 benchmark (USCI) is a filter, not an independent signal
    if (role !== 'benchmark' && rowStatus === 'bullish') bull++;
    return { label, indicator: sym, value: val, condition, status: rowStatus };
  });

  const sigTotal = COM_META.filter(m => m.role !== 'benchmark').length; // 7 independent signals
  const status = bull >= 5 ? 'bullish' : bull >= 3 ? 'neutral' : 'bearish';
  const copper = q['CPER'], gold = q['GLD'], silver = q['SLV'];
  const copperAbove = !!(copper?.price && copper?.sma200 && copper.price > copper.sma200);
  const goldAbove   = !!(gold?.price   && gold?.sma200   && gold.price   > gold.sma200);
  const commNote = (() => {
    const sCount = `${bull}/${sigTotal} commodity signals are macro-positive — ${bull >= 5 ? 'real assets are broadly trending; commodities are supporting the growth narrative' : bull >= 3 ? 'mixed signals; select commodity themes active but breadth is not confirmed' : 'commodities are broadly weak; the macro growth signal is absent'}.`;
    const sCopper = copper
      ? ` Copper is ${copperAbove ? 'above' : 'below'} its 200d SMA${copper.vs200 != null ? ' (' + (copper.vs200 >= 0 ? '+' : '') + copper.vs200.toFixed(1) + '%)' : ''} — ${copperAbove ? 'industrial growth is confirmed; global manufacturing demand is intact' : 'a growth warning; industrial demand is fading'}.`
      : '';
    const sCopGold = copper && gold
      ? (copperAbove && !goldAbove
        ? ' Copper is leading gold — industrial growth is outweighing safe-haven demand; risk-on regime confirmed.'
        : !copperAbove && goldAbove
        ? ' Gold is leading copper — safe-haven demand is outweighing growth; a risk-off tilt is warranted.'
        : copperAbove && goldAbove
        ? ' Both copper and gold are above their 200d SMA — consistent with an uncertainty or stagflation environment.'
        : ' Both copper and gold are below their 200d SMA — neither growth nor safety is bid; cautious positioning appropriate.')
      : '';
    const energyD = q['IXC'];
    const energyAbove = !!(energyD?.price && energyD?.sma200 && energyD.price > energyD.sma200);
    const sEnergy = energyD
      ? ` Energy (IXC) is ${energyAbove ? 'above its 200d SMA — energy is trending; inflation and geopolitical risk premium priced in' : 'below its 200d SMA — energy demand is softening; disinflationary for the broader economy'}.`
      : '';
    const sAction = bull >= 5
      ? ' Action: commodity signals broadly support risk-on positioning; overweight copper, energy, and industrial metals.'
      : bull >= 3
      ? ' Action: selectively overweight commodity themes above their 200d SMA; avoid broad commodity ETF exposure.'
      : ' Action: commodity signals are broadly weak — underweight real assets and wait for copper or energy to reclaim their 200d SMA.';
    return sCount + sCopper + sCopGold + sEnergy + sAction;
  })();

  const copperVs200 = copper?.vs200 != null ? (copper.vs200 >= 0 ? '+' : '') + copper.vs200.toFixed(1) + '%' : '\u2014';
  const goldVs200   = gold?.vs200   != null ? (gold.vs200   >= 0 ? '+' : '') + gold.vs200.toFixed(1)   + '%' : '\u2014';
  const stats = [
    ['Bull Signals',  `${bull} / ${sigTotal}`, 'macro-positive signals',   bull >= 5 ? 'pos' : bull < 3 ? 'neg' : null],
    ['Copper vs 200d', copperVs200,                    'industrial / growth proxy', copperAbove ? 'pos' : 'neg'],
    ['Gold vs 200d',   goldVs200,                      'safe haven demand',         goldAbove   ? 'neg' : 'pos'],
  ];
  if (commCtx) {
    const { percentile, duration, velocity } = commCtx;
    const velStr  = velocity != null ? (velocity >= 0 ? '+' : '') + velocity.toFixed(1) + '%' : '—';
    const pctTone = percentile == null ? null : (percentile >= 80 || percentile <= 20) ? 'neg' : null;
    const velTone = velocity  == null ? null : velocity > 0.05 ? 'pos' : velocity < -0.05 ? 'neg' : null;
    stats.push(
      ['USCI Percentile Rank',    percentile != null ? ordinalSuffix(percentile) : '—', 'of all historical days', pctTone],
      ['USCI Days in Zone',       duration   != null ? String(duration) : '—',          'consecutive days here',  null],
      ['USCI Extension Velocity', velStr,                                                     '10d ROC of stretch',     velTone],
    );
  }
  return { id: 'commodities', number: 10, title: 'Commodities', subtitle: 'The Growth Engine',
    status, rows, stats, hideIndicator: true, note: commNote, commDeltas: commCtx?.deltas ?? null };
}

function buildEquities(q) {
  const watchList = [
    { sym: 'IWM',  label: 'Russell 2000',    theme: 'risk'       },
    { sym: 'FCX',  label: 'Freeport',        theme: 'copper'     },
    { sym: 'GDX',  label: 'Gold Miners',     theme: 'gold'       },
    { sym: 'SPY',  label: 'S&P 500',         theme: 'market'     },
    { sym: 'NVDA', label: 'Nvidia',          theme: 'tech'       },
    { sym: 'JPM',  label: 'JPMorgan',        theme: 'financials' },
    { sym: 'CAT',  label: 'Caterpillar',     theme: 'capex'      },
    { sym: 'XOM',  label: 'Exxon Mobil',     theme: 'energy'     },
    { sym: 'EEM',  label: 'Emerging Markets',theme: 'global'     },
  ];

  let bull = 0;
  const rows = watchList.map(({ sym, label, theme }) => {
    const d = q[sym];
    const abv200  = !!(d?.price && d?.sma200 && d.price > d.sma200);
    const abv50   = !!(d?.price && d?.sma50  && d.price > d.sma50);
    const abvBoth = abv200 && abv50;
    const v200s   = d?.vs200 != null ? pct(d.vs200, 1) : null;

    let condition, status;
    if (!d || v200s == null) {
      condition = '\u2014'; status = 'neutral';
    } else if (abvBoth) {
      condition = `Trend Intact (${v200s} vs 200d) \u2014 Long Bias`;
      status = 'bullish';
      bull++;
    } else if (abv200) {
      condition = `Pulling Back (${v200s} vs 200d) \u2014 Await 50d Recapture`;
      status = 'neutral';
    } else {
      condition = `Below 200d (${v200s} vs 200d) \u2014 Trend Broken`;
      status = 'bearish';
    }

    return { label, indicator: sym, value: d ? usd(d.price) : '\u2014', condition, status };
  });

  const total = watchList.length;
  const status = bull >= 7 ? 'bullish' : bull >= 5 ? 'neutral' : 'bearish';

  // Thematic read for note
  const themeCount = {};
  watchList.forEach(({ sym, theme }) => {
    const d = q[sym];
    const abvBoth = !!(d?.price && d?.sma50 && d?.sma200 && d.price > d.sma50 && d.price > d.sma200);
    if (abvBoth) themeCount[theme] = (themeCount[theme] || 0) + 1;
  });
  const themeSizes = { market: 1, risk: 1, tech: 1, financials: 1, capex: 1, energy: 1, copper: 1, gold: 1, global: 1 };
  const firingThemes  = Object.entries(themeCount).filter(([t, n]) => n === themeSizes[t]).map(([t]) => t);
  const stalledThemes = Object.keys(themeSizes).filter(t => !themeCount[t]);

  const equityNote = (() => {
    const sHealth = `${bull}/${total} names in the watchlist are above both their 50d and 200d SMA — ${bull >= 7 ? 'broad execution environment confirmed; positions can be sized normally' : bull >= 5 ? 'majority of themes intact; selective positioning, favouring names above both MAs' : 'most names below their MAs; wait for MA recapture before initiating new longs'}.`;
    const iwmD = q['IWM'];
    const sIwm = iwmD
      ? ` Russell 2000 (IWM) is ${iwmD.price > (iwmD.sma200 || Infinity) ? 'above its 200d SMA — small-cap risk appetite is open; the rally is broadening beyond mega-caps' : 'below its 200d SMA — small-caps are lagging; the rally is narrow and concentrated'}.`
      : '';
    const fcxD = q['FCX'];
    const sFcx = fcxD
      ? ` Freeport (FCX) is ${fcxD.price > (fcxD.sma200 || Infinity) ? 'above its 200d SMA — copper / global growth is signalling expansion; cyclical exposure is supported' : 'below its 200d SMA — copper is weakening; global growth concerns are elevated, reduce cyclical risk'}.`
      : '';
    const sThemes = firingThemes.length || stalledThemes.length
      ? ` Themes active: ${firingThemes.length ? firingThemes.join(', ') : 'none'} | Stalled: ${stalledThemes.length ? stalledThemes.join(', ') : 'none'}.`
      : '';
    const sAction = bull >= 7
      ? ' Execution: full positioning is warranted — all themes are active and risk is confirmed on.'
      : bull >= 5
      ? ' Execution: selective longs only — add on dips to 50d in names above 200d; avoid names that have broken the 200d.'
      : ' Execution: stand aside — wait for a majority of names to recapture their MAs before adding exposure.';
    return sHealth + sIwm + sFcx + sThemes + sAction;
  })();

  const iwm  = q['IWM'],  fcx = q['FCX'];
  const iwmAbove  = !!(iwm?.price && iwm?.sma200 && iwm.price > iwm.sma200);
  const fcxAbove  = !!(fcx?.price && fcx?.sma200 && fcx.price > fcx.sma200);
  const iwmVs200  = iwm?.vs200 != null ? (iwm.vs200 >= 0 ? '+' : '') + iwm.vs200.toFixed(1) + '%' : '\u2014';
  const fcxVs200  = fcx?.vs200 != null ? (fcx.vs200 >= 0 ? '+' : '') + fcx.vs200.toFixed(1) + '%' : '\u2014';
  const stats = [
    ['Names Above MAs', `${bull} / ${total}`, 'above both 50d & 200d',  bull >= 7 ? 'pos' : bull < 5 ? 'neg' : null],
    ['Russell 2000',    iwmVs200,              'small-cap risk appetite', iwm?.vs200 != null ? (iwmAbove ? 'pos' : 'neg') : null],
    ['Freeport (FCX)',  fcxVs200,              'copper / global growth',  fcx?.vs200 != null ? (fcxAbove ? 'pos' : 'neg') : null],
  ];

  // VIX term structure (spot values only \u2014 no MA scoring)
  const v9d = q['^VIX9D']?.price ?? null;
  const v30 = q['^VIX']?.price   ?? null;
  const v3m = q['^VIX3M']?.price ?? null;
  const v6m = q['^VIX6M']?.price ?? null;
  const vixShape = (() => {
    const front = v9d, back = v3m ?? v30;
    if (front == null || back == null) return null;
    return front > back + 0.5 ? 'backwardation' : front < back - 0.5 ? 'contango' : 'flat';
  })();
  const vix = (v9d != null || v30 != null || v3m != null)
    ? { v9d, v30, v3m, v6m, shape: vixShape }
    : null;

  return { id: 'equities', number: 11, title: 'Equities', subtitle: 'The Execution Layer',
    status, rows, stats, hideIndicator: true, note: equityNote, vix };
}

function buildCredit(q, creditCtx) {
  const hyg = q['HYG'];
  const lqd = q['LQD'];
  const emb = q['EMB'];

  const hygBull = hyg && hyg.price && hyg.sma200 ? hyg.price > hyg.sma200 : null;
  const lqdBull = lqd && lqd.price && lqd.sma200 ? lqd.price > lqd.sma200 : null;
  const embBull = emb && emb.price && emb.sma200 ? emb.price > emb.sma200 : null;

  // Compare vs200 distance: HY closer to/above 200d than IG = tightening
  // Avoids duration-noise from daily changePct (LQD has ~2× HYG's duration)
  const spreadTightening = hyg?.vs200 != null && lqd?.vs200 != null
    ? hyg.vs200 > lqd.vs200
    : hyg && lqd ? hyg.changePct > lqd.changePct : null;

  const rows = [
    {
      label: 'Risk Appetite',
      indicator: 'HYG \u2014 High Yield Corp Bond ETF',
      value: hyg?.vs200 != null
        ? `${pct(hyg.vs200)}<br>${usd(hyg.price)}`
        : hyg ? usd(hyg.price) : '\u2014',
      condition: hygBull == null ? '\u2014' : hygBull ? 'Above 200d \u2014 Appetite Healthy' : 'Below 200d \u2014 Risk Signal',
      status: hygBull == null ? 'neutral' : hygBull ? 'bullish' : 'bearish',
    },
    {
      label: 'Credit Quality',
      indicator: 'LQD \u2014 Investment Grade Bond ETF',
      value: lqd?.vs200 != null
        ? `${pct(lqd.vs200)}<br>${usd(lqd.price)}`
        : lqd ? usd(lqd.price) : '\u2014',
      condition: lqdBull == null ? '\u2014' : lqdBull ? 'Above 200d \u2014 Credit Quality Firm' : 'Below 200d \u2014 Credit Quality Weak',
      status: lqdBull == null ? 'neutral' : lqdBull ? 'bullish' : 'bearish',
    },
    {
      label: 'Global Credit',
      indicator: 'EMB \u2014 EM USD Bond ETF (JP Morgan)',
      value: emb?.vs200 != null
        ? `${pct(emb.vs200)}<br>${usd(emb.price)}`
        : emb ? usd(emb.price) : '\u2014',
      condition: embBull == null ? '\u2014' : embBull
        ? 'Above 200d \u2014 EM Credit Stable'
        : emb.vs200 >= -2
          ? 'Below 200d \u2014 Monitor EM Risk'
          : emb.vs200 >= -5
            ? 'Below 200d \u2014 Stress Spreading'
            : 'Below 200d \u2014 Contagion Risk',
      status: embBull == null ? 'neutral' : embBull ? 'bullish' : 'bearish',
    },
    {
      label: 'Spread Signal',
      indicator: 'HYG vs LQD \u2014 HY vs IG (200d basis)',
      value: hyg?.vs200 != null && lqd?.vs200 != null
        ? `${pct(hyg.vs200)}<br>${pct(lqd.vs200)}`
        : '\u2014',
      condition: spreadTightening == null ? '\u2014' : spreadTightening ? 'HY Outperforming IG \u2014 Rate-Driven' : 'IG Outperforming HY \u2014 Credit-Driven',
      status: spreadTightening == null ? 'neutral' : spreadTightening ? 'bullish' : 'bearish',
    },
  ];

  const bull = rows.filter(r => r.status === 'bullish').length;
  const status = bull >= 3 ? 'bullish' : bull >= 2 ? 'neutral' : 'bearish';
  const creditNote = (() => {
    const sHyg = hygBull == null ? 'Credit data unavailable.'
      : hygBull
      ? `HYG (High-Yield ETF) is above its 200d SMA — credit markets are not signalling stress; historically leads equity drawdowns by 4–6 weeks when it breaks down.`
      : `HYG has broken below its 200d SMA — a leading credit stress signal; prior episodes have preceded equity drawdowns by 4–6 weeks.`;
    const sSpread = spreadTightening != null
      ? (spreadTightening
        ? ' The spread move appears rate-driven (HY outperforming IG) — credit quality is intact; this is a rate sensitivity story, not a default-risk story.'
        : ' The spread move is credit-driven (IG outperforming HY) — true deterioration in credit quality; this carries a more severe outlook for equities.')
      : '';
    const sLqd = lqd
      ? ` LQD (Investment-Grade ETF) is ${lqdBull ? 'above' : 'below'} its 200d SMA — ${lqdBull ? 'systemic credit risk is contained; investment-grade issuers retain market access' : 'investment-grade credit is stressed; systemic risk is elevated'}.`
      : '';
    const sEmb = emb
      ? ` EMB (EM Bond ETF) is ${embBull ? 'above' : 'below'} its 200d SMA — ${embBull ? 'no EM contagion risk currently' : emb.vs200 != null && emb.vs200 < -2 ? 'EM credit stress is active; watch for contagion into EM equities' : 'EM debt under mild pressure; monitor for deterioration'}.`
      : '';
    const sAction = hygBull == null ? ''
      : hygBull ? ' Portfolio action: credit is benign — maintain equity exposure and watch HYG as an early warning system.'
      : ' Portfolio action: credit risk is elevated — reduce high-yield exposure, shorten duration, and shift toward investment-grade or cash.';
    return sHyg + sSpread + sLqd + sEmb + sAction;
  })();
  const hygVs200 = hyg?.vs200 != null ? (hyg.vs200 >= 0 ? '+' : '') + hyg.vs200.toFixed(1) + '%' : '\u2014';
  const lqdVs200 = lqd?.vs200 != null ? (lqd.vs200 >= 0 ? '+' : '') + lqd.vs200.toFixed(1) + '%' : '\u2014';
  const embVs200 = emb?.vs200 != null ? (emb.vs200 >= 0 ? '+' : '') + emb.vs200.toFixed(1) + '%' : '\u2014';

  const cc = creditCtx || {};
  const hc = cc['HYG'] || {}, lc = cc['LQD'] || {}, ec = cc['EMB'] || {};
  const fmtDays = (c) => c.daysInZone != null ? `${c.daysInZone}d` : '\u2014';
  const fmtVel  = (c) => c.velocity   != null ? (c.velocity >= 0 ? '+' : '') + c.velocity.toFixed(2) + '%' : '\u2014';
  const daysTone = (c, bull) => bull != null ? (bull ? 'pos' : 'neg') : null;
  const velTone  = (c) => c.velocity != null ? (c.velocity > 0.01 ? 'pos' : c.velocity < -0.01 ? 'neg' : null) : null;
  const velDir   = (c) => c.velocity != null ? (c.velocity > 0.01 ? 'up' : c.velocity < -0.01 ? 'down' : null) : null;
  const zoneDesc = (c, bull) => bull == null ? '200d SMA' : bull ? 'above 200d SMA' : 'below 200d SMA';

  const daysT = [
    { label: '< 20d',    text: 'Early regime \u2014 signal fresh; may still be a head-fake; wait for confirmation', color: '#f59e0b' },
    { label: '20\u201360d',  text: 'Established regime \u2014 trend has legs; position sizing appropriate',           color: '#22c55e' },
    { label: '60\u2013120d', text: 'Mature regime \u2014 mean-reversion risk rising; tighten stops on weakness',      color: '#f59e0b' },
    { label: '> 120d',   text: 'Extended regime \u2014 elevated reversion risk; reduce exposure on any crack',       color: '#ef4444' },
  ];
  const velT = [
    { label: '> +0.5%',    text: 'Accelerating away \u2014 momentum building; trend likely to continue near-term',  color: '#22c55e' },
    { label: '0 to +0.5%', text: 'Slowly expanding \u2014 healthy drift; maintain current positioning',             color: '#22c55e' },
    { label: '-0.5 to 0',  text: 'Decelerating \u2014 momentum fading; monitor closely for reversal signals',       color: '#f59e0b' },
    { label: '< -0.5%',   text: 'Collapsing \u2014 extension reversing rapidly; act defensively',                  color: '#ef4444' },
  ];

  const stats = [
    ['HYG vs 200d', hygVs200, 'high yield health',   hygBull == null ? null : hygBull ? 'pos' : 'neg'],
    ['LQD vs 200d', lqdVs200, 'investment grade',    lqdBull == null ? null : lqdBull ? 'pos' : 'neg'],
    ['EMB vs 200d', embVs200, 'EM credit risk',      embBull == null ? null : embBull ? 'pos' : 'neg'],
    // Days in Zone: consecutive trading days on current side of 200d SMA
    ['HYG \u2014 Days in Zone', fmtDays(hc), zoneDesc(hc, hygBull), daysTone(hc, hygBull), null, daysT],
    ['LQD \u2014 Days in Zone', fmtDays(lc), zoneDesc(lc, lqdBull), daysTone(lc, lqdBull), null, daysT],
    ['EMB \u2014 Days in Zone', fmtDays(ec), zoneDesc(ec, embBull), daysTone(ec, embBull), null, daysT],
    // Extension Velocity: 10-day rate of change of the vs200 extension
    ['HYG \u2014 Ext. Velocity', fmtVel(hc), '10d rate of change', velTone(hc), null, velT, velDir(hc)],
    ['LQD \u2014 Ext. Velocity', fmtVel(lc), '10d rate of change', velTone(lc), null, velT, velDir(lc)],
    ['EMB \u2014 Ext. Velocity', fmtVel(ec), '10d rate of change', velTone(ec), null, velT, velDir(ec)],
  ];
  return {
    id: 'credit', number: 6, title: 'Credit', subtitle: 'The Risk Canary', status, rows, stats, hideIndicator: true,
    note: creditNote,
  };
}

function buildCurrency(q) {
  const uup = q['UUP'];
  const fxe = q['FXE'];
  const fxy = q['FXY'];

  // UUP above 200d = strong dollar = bearish (tightens global conditions)
  // FXE above 200d = strong EUR    = bullish (global risk-on)
  // FXY >+3% above 200d = sharp Yen rise = bearish (carry unwind risk); otherwise neutral
  const uupStatus = uup?.vs200 == null ? 'neutral' : uup.vs200 > 0 ? 'bearish' : 'bullish';
  const fxeStatus = fxe?.vs200 == null ? 'neutral' : fxe.vs200 > 0 ? 'bullish' : 'bearish';
  const fxyStatus = fxy?.vs200 == null ? 'neutral' : fxy.vs200 > 3 ? 'bearish' : 'neutral';

  const bulls = [uupStatus, fxeStatus, fxyStatus].filter(s => s === 'bullish').length;
  const bears = [uupStatus, fxeStatus, fxyStatus].filter(s => s === 'bearish').length;
  // JPY carry unwind overrides — single dominant risk signal that trumps USD/EUR balance
  const status = fxyStatus === 'bearish' ? 'bearish'
               : bulls >= 2 ? 'bullish'
               : bears >= 2 ? 'bearish'
               : 'neutral';

  // FX Regime composite label
  const uupAbove = uup?.vs200 != null && uup.vs200 > 0;
  const fxeAbove = fxe?.vs200 != null && fxe.vs200 > 0;
  const fxyAbove = fxy?.vs200 != null && fxy.vs200 > 3;
  let regimeLabel, regimeCond, regimeStatus;
  if (fxyAbove) {
    regimeLabel  = 'Carry Unwind';
    regimeCond   = 'JPY strengthening — carry unwind risk; watch for equity de-risk';
    regimeStatus = 'bearish';
  } else if (!uupAbove && fxeAbove) {
    regimeLabel  = 'Risk-On';
    regimeCond   = 'USD soft · EUR firm — supportive for EM and international equities';
    regimeStatus = 'bullish';
  } else if (uupAbove && !fxeAbove) {
    regimeLabel  = 'Risk-Off';
    regimeCond   = 'USD firm · EUR soft — tightening conditions; favour defensives';
    regimeStatus = 'bearish';
  } else if (!uupAbove && !fxeAbove) {
    regimeLabel  = 'Soft Dollar';
    regimeCond   = 'USD and EUR both soft — watch for regime clarity before positioning';
    regimeStatus = 'neutral';
  } else {
    regimeLabel  = 'Mixed';
    regimeCond   = 'USD and EUR both firm — no dominant FX trend; selective approach';
    regimeStatus = 'neutral';
  }

  const rows = [
    {
      label: 'USD Trend',
      indicator: 'UUP — US Dollar ETF (DXY proxy) vs 200d SMA',
      value: pct(uup?.vs200),
      condition: uup?.vs200 == null ? '—'
        : uup.vs200 > 2  ? 'Above 200d — Dollar Strengthening · Tightening Conditions'
        : uup.vs200 > 0  ? 'Above 200d — Dollar Firm · Mild Headwind'
        : uup.vs200 > -2 ? 'Below 200d — Dollar Soft · Conditions Easing'
        :                  'Below 200d — Dollar Weak · EM & Commodity Tailwind',
      status: uupStatus,
    },
    {
      label: 'EUR/USD',
      indicator: 'FXE — Euro Currency ETF vs 200d SMA',
      value: pct(fxe?.vs200),
      condition: fxe?.vs200 == null ? '—'
        : fxe.vs200 > 2  ? 'Above 200d — EUR Firm · European Risk-On'
        : fxe.vs200 > 0  ? 'Above 200d — EUR Stable · Risk Appetite Intact'
        : fxe.vs200 > -2 ? 'Below 200d — EUR Soft · Risk Appetite Fading'
        :                  'Below 200d — EUR Weak · Global Risk Appetite Low',
      status: fxeStatus,
    },
    {
      label: 'JPY Carry',
      indicator: 'FXY — Japanese Yen ETF vs 200d SMA',
      value: pct(fxy?.vs200),
      condition: fxy?.vs200 == null ? '—'
        : fxy.vs200 > 3  ? 'Above 200d — Yen Rising · Carry Unwind Risk'
        : fxy.vs200 > 0  ? 'Above 200d — Yen Firm · Monitor Carry Positions'
        :                  'Below 200d — Yen Weak · Carry Trade Intact',
      status: fxyStatus,
    },
    {
      label: 'FX Regime',
      indicator: 'USD · EUR · JPY composite signal',
      value: regimeLabel,
      condition: regimeCond,
      status: regimeStatus,
    },
  ];

  const currNote = (() => {
    const sUup = uup?.vs200 == null ? 'The US Dollar (UUP) data is unavailable.'
      : uup.vs200 > 0
        ? `The US Dollar (UUP) is ${pct(uup.vs200)} above its 200d SMA — a strengthening dollar tightens global financial conditions, pressures EM debt, and creates an earnings headwind for US multinationals.`
        : `The US Dollar (UUP) is ${pct(uup.vs200)} below its 200d SMA — a weakening dollar eases global conditions, supports EM assets and commodities, and is a tailwind for US exporters.`;
    const sFxe = fxe?.vs200 != null
      ? ` The Euro (FXE) is ${fxe.vs200 > 0 ? 'above' : 'below'} its 200d SMA (${pct(fxe.vs200)}) — ${fxe.vs200 > 0 ? 'EUR strength confirms global risk appetite is intact and European growth conditions are constructive' : 'EUR weakness signals reduced global risk appetite and a relative flight toward US dollar assets'}.`
      : '';
    const sFxy = fxy?.vs200 != null
      ? fxy.vs200 > 3
        ? ` The Yen (FXY) is ${pct(fxy.vs200)} above its 200d SMA — a sharply rising Yen is the key carry-trade unwind signal; prior episodes (Aug 2024, 2022) have caused sudden equity de-risking within days.`
        : ` The Yen (FXY) is ${pct(fxy.vs200)} vs its 200d SMA — ${fxy.vs200 > 0 ? 'Yen is firming but the carry trade is not yet unwinding' : 'Yen is weak, confirming the carry trade is intact and providing a global liquidity tailwind'}.`
      : '';
    const sAction = status === 'bullish'
      ? ' Action: FX conditions are supportive — favour EM and international equity exposure alongside domestic risk.'
      : status === 'bearish'
      ? ' Action: FX conditions are restrictive — reduce EM and international exposure, shorten duration, and monitor carry positions closely.'
      : ' Action: mixed FX signals — maintain diversified exposure and watch UUP for trend confirmation.';
    return sUup + sFxe + sFxy + sAction;
  })();

  const stats = [
    ['UUP vs 200d', pct(uup?.vs200), 'USD vs 200d SMA',  uupStatus === 'bullish' ? 'pos' : uupStatus === 'bearish' ? 'neg' : null],
    ['FXE vs 200d', pct(fxe?.vs200), 'EUR vs 200d SMA',  fxeStatus === 'bullish' ? 'pos' : fxeStatus === 'bearish' ? 'neg' : null],
    ['FXY vs 200d', pct(fxy?.vs200), 'JPY carry signal',  fxyStatus === 'bearish' ? 'neg' : null],
  ];

  return { id: 'currency', number: 7, title: 'Currency', subtitle: 'The FX Regime',
    status, rows, stats, hideIndicator: true, note: currNote };
}

function placeholderCard(num, title, subtitle) {
  return { id: title.toLowerCase(), number: num, title, subtitle, status: 'neutral',
    rows: [{ label: '\u2014', indicator: 'Data unavailable', value: '\u2014', condition: '\u2014', status: 'neutral' }] };
}

// ── DELTA ─────────────────────────────────────────────────────────────────────

// Reconstruct weighted composite pct (0–1) from a stored {id: status} map,
// using the same SIGNAL_CATEGORIES weights as buildAggregate.
function computeWeightedPct(statuses) {
  let pct = 0;
  for (const cat of SIGNAL_CATEGORIES) {
    const catStatuses = cat.ids.map(id => statuses[id]).filter(Boolean);
    if (!catStatuses.length) continue;
    const bull = catStatuses.filter(s => s === 'bullish').length;
    const neu  = catStatuses.filter(s => s === 'neutral').length;
    pct += (bull + neu * 0.5) / catStatuses.length * cat.weight;
  }
  return pct;
}

function computeDeltas(current, previous) {
  const rank = { bullish: 2, neutral: 1, bearish: 0 };
  const out = {};
  for (const [id, status] of Object.entries(current)) {
    const prev = previous?.[id];
    if (!prev) { out[id] = 'same'; continue; }
    const diff = rank[status] - rank[prev];
    out[id] = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  }
  return out;
}

// ── SCORE HISTORY (for matrix hysteresis replay) ──────────────────────────────
// Recent daily speedometer/compass scores, ascending. The matrix state machine
// replays these on every request so quadrant hysteresis/persistence is stateless.
// `asOf` is regex-validated in the handler before reaching here.
async function loadScoreHistoryRecent(db, asOf = null, limit = 40) {
  try {
    const { results } = await db.prepare(
      `SELECT date, speedometer, compass FROM score_history
       WHERE speedometer IS NOT NULL AND compass IS NOT NULL${asOf ? ` AND date < '${asOf}'` : ''}
       ORDER BY date DESC LIMIT ${limit}`
    ).all();
    return (results ?? []).reverse();
  } catch { return []; }
}

// ── MATRIX DYNAMICS: hysteresis + persistence + Entry Window ──────────────────
// The raw quadrant (score >= 5 on each axis) flips on noise: 5.1 vs 4.9 is not a
// regime change, and the Speedometer leads the Compass by only ~2 trading days,
// so boundary crossings are mostly the same signal disagreeing with itself.
// Instead: each axis enters 'high' at >= HYST.enter, exits at < HYST.exit, and a
// new quadrant must hold HYST.persist consecutive sessions before the headline
// changes. The Entry Window is the validated contrarian signal: an oversold
// Speedometer (< EW_THRESHOLD) while the Compass trend state holds 'high'.
const HYST = { enter: 6.0, exit: 4.5, persist: 3 };
const EW_THRESHOLD = 3.5;
// Validated Jul 2026 on backfilled score history: oversold Speedometer readings
// preceded positive forward SPY returns ~69% of the time, ~3× the baseline rate.
// Re-validate as live history accrues.
const ENTRY_WINDOW_STATS = '~69% positive follow-through, ~3× baseline (validated Jul 2026)';

function stepHystState(prev, score) {
  if (prev == null) return score >= 5 ? 'high' : 'low';   // no history: seed at midpoint
  if (prev === 'high') return score < HYST.exit ? 'low' : 'high';
  return score >= HYST.enter ? 'high' : 'low';
}

function quadrantOf(speedHigh, compassHigh) {
  return speedHigh && compassHigh ? 'add-risk'
    : speedHigh && !compassHigh ? 'bear-rally'
    : !speedHigh && compassHigh ? 'accumulate'
    : 'risk-off';
}

// Replay the state machine over [history..., today]. Pure + deterministic, so the
// live handler and the as-of backfill produce identical states for the same data.
function replayMatrixState(series) {
  let sState = null, cState = null;
  let effective = null, pendingQ = null, pendingCount = 0;
  let ewDays = 0;
  for (const r of series) {
    if (r.speedometer == null || r.compass == null) continue;
    sState = stepHystState(sState, r.speedometer);
    cState = stepHystState(cState, r.compass);
    const candidate = quadrantOf(sState === 'high', cState === 'high');
    if (effective == null || candidate === effective) {
      if (effective == null) effective = candidate;
      pendingQ = null; pendingCount = 0;
    } else if (candidate === pendingQ) {
      pendingCount++;
      if (pendingCount >= HYST.persist) { effective = candidate; pendingQ = null; pendingCount = 0; }
    } else {
      pendingQ = candidate; pendingCount = 1;
      if (pendingCount >= HYST.persist) { effective = candidate; pendingQ = null; pendingCount = 0; }
    }
    ewDays = (r.speedometer < EW_THRESHOLD && cState === 'high') ? ewDays + 1 : 0;
  }
  return { sState, cState, effective, pendingQ, pendingCount, ewDays };
}

// ── HORIZON SCORES (timeframe-isolated) ───────────────────────────────────────
// Three independent scores, each aligned to a real execution horizon, so that a
// 2-week momentum reading is never blended with a 10-year valuation reading.
//   A. Tactical Speedometer (2–3 wk)  — directional 0–10
//   B. Trend Compass       (2–3 mo)  — directional 0–10
//   C. Macro Anchor        (2–3 yr)  — Structural Risk Budget (sizing, not direction)
const CYCLICALS  = ['XLK', 'XLF', 'XLI', 'XLY', 'XLB', 'XLE'];
const DEFENSIVES = ['XLP', 'XLV', 'XLU', 'XLRE'];
const SECTORS_11 = ['XLK', 'XLF', 'XLV', 'XLC', 'XLY', 'XLI', 'XLP', 'XLE', 'XLB', 'XLRE', 'XLU'];

// 20-day return for a symbol (falls back to daily changePct)
function horizonRet20(s) {
  if (!s) return null;
  return s.price20d ? (s.price / s.price20d - 1) * 100 : (s.changePct ?? null);
}
function horizonAvgRet20(q, syms) {
  const vals = syms.map(s => horizonRet20(q[s])).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
const round1 = (x) => Math.round(x * 10) / 10;

function buildHorizons(q, breadthData, valn, fred, histRows = []) {
  const spy = q['SPY'];

  // ── A. TACTICAL SPEEDOMETER (2–3 wk) ──────────────────────────────────────
  const sComps = [];
  const sPush = (key, label, v01, detail) => { if (v01 != null) sComps.push({ key, label, value: v01, detail }); };

  const rsp20 = horizonRet20(q['RSP']), spy20 = horizonRet20(q['SPY']);
  const rspSpread = (rsp20 != null && spy20 != null) ? rsp20 - spy20 : null;
  sPush('rsp', 'RSP vs SPY 20d', rspSpread != null ? clamp01(0.5 + rspSpread / 4) : null, rspSpread != null ? pct(rspSpread, 1) : null);

  const qqew20 = horizonRet20(q['QQEW']), qqq20 = horizonRet20(q['QQQ']);
  const techSpread = (qqew20 != null && qqq20 != null) ? qqew20 - qqq20 : null;
  sPush('tech', 'QQEW vs QQQ 20d', techSpread != null ? clamp01(0.5 + techSpread / 4) : null, techSpread != null ? pct(techSpread, 1) : null);

  const cyc = horizonAvgRet20(q, CYCLICALS), def = horizonAvgRet20(q, DEFENSIVES);
  const cycSpread = (cyc != null && def != null) ? cyc - def : null;
  sPush('cyc', 'Cyclicals vs Defensives 20d', cycSpread != null ? clamp01(0.5 + cycSpread / 4) : null, cycSpread != null ? pct(cycSpread, 1) : null);

  const mmfi = breadthData?.pct_above_50d;
  sPush('mmfi', 'Stocks > 50d SMA', mmfi != null ? clamp01(mmfi / 100) : null, mmfi != null ? `${mmfi.toFixed(0)}%` : null);

  const rsi14 = spy?.rsi14;
  sPush('rsi', 'SPY RSI-14', rsi14 != null ? clamp01((rsi14 - 30) / 40) : null, rsi14 != null ? rsi14.toFixed(0) : null);

  let speedScore = sComps.length ? (sComps.reduce((a, c) => a + c.value, 0) / sComps.length) * 10 : 5;

  // VIX/VIX3M term-structure veto: backwardation (ratio > 1) = acute stress,
  // suppress the tactical score regardless of the underlying momentum reading.
  const vix = q['^VIX']?.price, vix3m = q['^VIX3M']?.price;
  const vixRatio = (vix != null && vix3m != null && vix3m > 0) ? vix / vix3m : null;
  const veto = vixRatio != null && vixRatio > 1.0;
  if (veto) speedScore = Math.min(speedScore, 3.5);
  speedScore = round1(speedScore);

  const speedHigh = speedScore >= 5;   // raw (legacy) level — matrix uses hysteresis states below

  // ── B. TREND COMPASS (2–3 mo) ─────────────────────────────────────────────
  const cComps = [];
  const cPush = (key, label, v01, detail) => { if (v01 != null) cComps.push({ key, label, value: v01, detail }); };

  cPush('regime', 'SPY vs 200d', spy?.vs200 != null ? clamp01(0.5 + spy.vs200 / 10) : null, spy?.vs200 != null ? pct(spy.vs200, 1) : null);

  const gc = (spy?.sma50 && spy?.sma200) ? (spy.sma50 - spy.sma200) / spy.sma200 * 100 : null;
  cPush('golden', 'Golden Cross spread', gc != null ? clamp01(0.5 + gc / 5) : null, gc != null ? pct(gc, 1) : null);

  const mmth = breadthData?.pct_above_200d;
  cPush('mmth', 'Stocks > 200d SMA', mmth != null ? clamp01(mmth / 100) : null, mmth != null ? `${mmth.toFixed(0)}%` : null);

  const partCount = SECTORS_11.filter(s => q[s]?.price && q[s]?.sma200 && q[s].price > q[s].sma200).length;
  const partTotal = SECTORS_11.filter(s => q[s]?.price && q[s]?.sma200).length;
  cPush('sectors', 'Sectors > 200d', partTotal ? partCount / partTotal : null, partTotal ? `${partCount}/${partTotal}` : null);

  // Credit: prefer real HY OAS vs its own 50d/200d SMA (Phase 2); fall back to
  // HYG & EMB vs their 200d SMA when the FRED OAS series is not yet seeded.
  let creditVal = null, creditDetail = null;
  if (fred?.oas && fred.oas.length >= 200) {
    const oas = fred.oas.map(o => o.value);
    const cur = oas[0];
    const oasSma50  = oas.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const oasSma200 = oas.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
    creditVal = ((cur < oasSma50 ? 1 : 0) + (cur < oasSma200 ? 1 : 0)) / 2; // tightening = bullish
    creditDetail = `OAS ${cur.toFixed(2)} vs 50/200d`;
  } else {
    const hyg = q['HYG'], emb = q['EMB'];
    const flags = [hyg?.vs200, emb?.vs200].filter(v => v != null);
    creditVal = flags.length ? flags.filter(v => v > 0).length / flags.length : null;
    creditDetail = 'HYG/EMB vs 200d';
  }
  cPush('credit', 'Credit', creditVal, creditDetail);

  const globFlags = [q['ACWI']?.vs200, q['EEM']?.vs200].filter(v => v != null);
  const globAbove = globFlags.filter(v => v > 0).length;
  cPush('global', 'ACWI & EEM vs 200d', globFlags.length ? globAbove / globFlags.length : null, globFlags.length ? `${globAbove}/${globFlags.length} above` : null);

  // Earnings direction (S&P 500 TTM EPS, YoY) — fundamentals confirming or
  // diverging from the trend. ±10% YoY maps to the 0/1 bounds.
  cPush('earnings', 'S&P 500 EPS YoY', valn?.epsYoy != null ? clamp01(0.5 + valn.epsYoy / 20) : null, valn?.epsYoy != null ? `${valn.epsYoy >= 0 ? '+' : ''}${valn.epsYoy.toFixed(1)}%` : null);

  const compassScore = round1((cComps.length ? cComps.reduce((a, c) => a + c.value, 0) / cComps.length : 0.5) * 10);
  const compassHigh = compassScore >= 5;
  // Base text is category-level only; the handler upgrades the healthy branch
  // with the live RRG playbook's named leaders (W2 fix — no hard-coded sectors).
  const compassTrigger = compassScore > 7.0 ? 'The 2–3 month trend is healthy — favour economically-sensitive sectors over defensives.'
    : compassScore < 4.0 ? 'The 2–3 month trend is weakening — shift toward defensive sectors and raise cash.'
    : 'The trend is mixed — hold your current mix; no strong reason to add or cut risk right now.';

  // ── C. MACRO ANCHOR (2–3 yr) — Structural Risk Budget ─────────────────────
  // Each input is a historical percentile (higher = more structural risk).
  // Score = 10 × (1 − avgRisk): high score = low structural risk = room to extend.
  const riskPcts = [];
  const rPush = (key, label, risk01, detail) => { if (risk01 != null) riskPcts.push({ key, label, value: risk01, detail }); };
  rPush('cape', 'Shiller CAPE', valn?.capePct, valn?.cape != null ? valn.cape.toFixed(1) : null);
  rPush('buffett', 'Buffett Indicator', valn?.buffettPct, valn?.buffett != null ? `${valn.buffett.toFixed(0)}%` : null);
  rPush('fwdpe', 'Forward P/E', valn?.fwdPePct, valn?.fwdPe != null ? valn.fwdPe.toFixed(1) : null);
  if (fred?.realYield != null) rPush('realyield', '10Y Real Yield', clamp01(fred.realYield / 3), `${fred.realYield.toFixed(2)}%`);
  if (fred?.fedFundsRisk != null) rPush('fedfunds', 'Fed Funds Direction', fred.fedFundsRisk, fred.fedFundsDir ?? null);

  const avgRisk = riskPcts.length ? riskPcts.reduce((a, c) => a + c.value, 0) / riskPcts.length : 0.5;
  const anchorScore = round1(10 * (1 - avgRisk));
  const zone = anchorScore >= 6 ? 'green' : anchorScore >= 3.5 ? 'amber' : 'red';
  const sizingFactor = zone === 'green' ? 1.0 : zone === 'amber' ? 0.85 : 0.70;
  const capePctile = valn?.capePct != null ? Math.round(valn.capePct * 100) : null;
  const sizePctTxt = Math.round(sizingFactor * 100);
  const anchorNote = capePctile != null
    ? `Stocks are more expensive than ${capePctile}% of history. That's not a signal to sell — but there's less cushion if things go wrong, so keep positions near ${sizePctTxt}% of normal size rather than changing direction.`
    : 'Long-run valuations set how much cushion you have — use this to scale position size, not to time entries and exits.';
  const anchorTrigger = anchorScore > 8.0 ? 'Valuations are historically cheap — you can size up and extend risk with a wide margin of safety.'
    : anchorScore < 3.0 ? 'Valuations are historically expensive — keep positions smaller than normal and hold extra cash as a buffer.'
    : 'Valuations are around historical averages — no sizing adjustment needed.';

  // ── INTERACTION MATRIX (Speedometer × Compass; Anchor sizes the position) ──
  // Hysteresis + persistence: replay the state machine over recent score history
  // plus today, so the effective quadrant only changes after HYST.persist
  // consecutive sessions. The raw (instantaneous) quadrant is kept for reference.
  const rawQuadrant = quadrantOf(speedHigh, compassHigh);
  const series = [
    ...histRows.map(r => ({ speedometer: r.speedometer, compass: r.compass })),
    { speedometer: speedScore, compass: compassScore },
  ];
  const st = replayMatrixState(series);
  const quadrant = st.effective ?? rawQuadrant;
  const speedState = st.sState ?? (speedHigh ? 'high' : 'low');
  const compassState = st.cState ?? (compassHigh ? 'high' : 'low');

  // ── ENTRY WINDOW — the validated contrarian add signal ─────────────────────
  // Oversold Speedometer while the Compass trend state holds: historically the
  // strongest conditions to deploy. The Speedometer mean-reverts, so this — not
  // strength-chasing — is the tool's flagship BUY timing signal.
  const entryOpen = speedScore < EW_THRESHOLD && compassState === 'high';
  const entryWindow = {
    open: entryOpen,
    daysOpen: st.ewDays,
    threshold: EW_THRESHOLD,
    stats: ENTRY_WINDOW_STATS,
    note: entryOpen
      ? `Speedometer ${speedScore.toFixed(1)} < ${EW_THRESHOLD} with the 2–3 month trend intact — historically the strongest add point (${ENTRY_WINDOW_STATS}).`
      : `Opens when the Speedometer drops below ${EW_THRESHOLD} while the Compass trend state holds — the validated pullback-entry signal.`,
  };

  // Speedometer trigger — mean-reversion-aware (computed after the Compass state
  // so oversold readings can be framed as Entry Windows, not just as weakness).
  const speedTrigger = entryOpen
    ? `Entry Window: oversold with the 2–3 month trend intact — historically the strongest add point (${ENTRY_WINDOW_STATS}).`
    : speedScore > 7.5 ? 'Short-term momentum is strong — but this gauge mean-reverts; let winners run and wait for the next Entry Window rather than chasing.'
    : speedScore < 3.0 ? 'Short-term momentum is weak and the trend is not confirming — consider protection or trimming until either recovers.'
    : 'No clear short-term edge — hold steady and wait for a cleaner signal before trading around positions.';

  const QLABEL = { 'add-risk': 'Add Positions', 'bear-rally': "Don't Add New Positions", 'accumulate': 'Add Positions on Dips', 'risk-off': 'Reduce Positions' };
  const stretched = spy?.vs200 != null && spy.vs200 > 10;   // Regime card's "Extended — Late to Add" band
  const GUIDANCE = {
    'add-risk': stretched
      ? `Both timeframes point up but SPY is extended (${pct(spy.vs200, 1)} vs its 200d) — hold rather than chase; the next Entry Window is the higher-odds add point.`
      : 'Both the short-term and 2–3 month trends point up — you can add exposure, but the Speedometer mean-reverts: pullback entries (Entry Windows) have historically beaten adds into strength.',
    'bear-rally': 'The short-term is bouncing but the 2–3 month trend is broken — hold off on new positions and use strength to trim, not to chase.',
    'accumulate': 'The 2–3 month trend is intact while the short-term has pulled back — the highest-conviction add zone. Deploy on Entry Windows (Speedometer < ' + EW_THRESHOLD + ').',
    'risk-off':   'Both timeframes point down — cut overall exposure and favour defensive positions and cash.',
  };

  return {
    speedometer: { score: speedScore, level: speedState, rawLevel: speedHigh ? 'high' : 'low', components: sComps, veto, vixRatio: vixRatio != null ? Math.round(vixRatio * 100) / 100 : null, trigger: speedTrigger, horizon: '2–3 weeks' },
    compass:     { score: compassScore, level: compassState, rawLevel: compassHigh ? 'high' : 'low', components: cComps, trigger: compassTrigger, horizon: '2–3 months' },
    anchor:      { score: anchorScore, zone, sizingFactor, percentiles: riskPcts, note: anchorNote, trigger: anchorTrigger, horizon: '2–3 years' },
    matrix:      {
      quadrant, label: QLABEL[quadrant], guidance: GUIDANCE[quadrant], sizingFactor,
      speedLevel: speedState, compassLevel: compassState,
      raw: { quadrant: rawQuadrant },
      pending: st.pendingQ ? { quadrant: st.pendingQ, label: QLABEL[st.pendingQ], daysConfirmed: st.pendingCount, daysRequired: HYST.persist } : null,
      hysteresis: { enter: HYST.enter, exit: HYST.exit, persistDays: HYST.persist, basis: histRows.length ? 'history' : 'today-only' },
    },
    entryWindow,
  };
}

// ── AGGREGATE SCORE ───────────────────────────────────────────────────────────
// The composite is a directional (timing) read. Two cards are intentionally
// displayed but NOT scored here:
//   • currency    — context, not a directional equity signal
//   • valuations  — a *level* signal, not a timing signal. CAPE/Buffett have been
//     "expensive" for years, so scoring it directionally pins the composite
//     permanently bearish. Valuation now governs position SIZING via the Macro
//     Anchor horizon (sizingFactor), not market-timing direction.
const SIGNAL_CATEGORIES = [
  { key: 'trend',         label: 'Trend / Momentum',  ids: ['regime', 'leadership', 'sectors', 'equities'], weight: 0.4 },
  { key: 'participation', label: 'Participation',      ids: ['breadth', 'globalflows', 'commodities'],       weight: 0.3 },
  { key: 'macro',         label: 'Macro Conditions',   ids: ['yield', 'credit'],                             weight: 0.3 },
];

function buildAggregate(cards) {
  const scoredIds = new Set(SIGNAL_CATEGORIES.flatMap(cat => cat.ids));
  const counts = { bullish: 0, neutral: 0, bearish: 0 };
  cards.forEach(c => { if (scoredIds.has(c.id)) counts[c.status]++; });

  const byId = {};
  cards.forEach(c => { byId[c.id] = c; });

  // Build per-category sub-scores (normalized to 0–1 within each category)
  const categories = SIGNAL_CATEGORIES.map(cat => {
    const catCards = cat.ids.map(id => byId[id]).filter(Boolean);
    const cc = { bullish: 0, neutral: 0, bearish: 0 };
    catCards.forEach(c => cc[c.status]++);
    const catRaw     = cc.bullish + cc.neutral * 0.5;
    const catTotal   = catCards.length;
    const catPct     = catTotal > 0 ? catRaw / catTotal : 0;          // 0–1
    const catGlow    = catPct >= 0.70 ? 'green' : catPct >= 0.40 ? 'yellow' : 'red';
    const catDisplay = Number.isInteger(catRaw) ? `${catRaw}/${catTotal}` : `${catRaw.toFixed(1)}/${catTotal}`;
    return {
      key: cat.key, label: cat.label, ...cc, weight: cat.weight,
      score: catDisplay, glow: catGlow, pct: catPct,
      cards: catCards.map(c => ({ id: c.id, status: c.status })),
    };
  });

  // Weighted composite: Trend 40% + Participation 30% + Macro 30%
  const byKey = {};
  categories.forEach(c => { byKey[c.key] = c; });
  const weightedPct = (byKey.trend?.pct         ?? 0) * 0.4
                    + (byKey.participation?.pct  ?? 0) * 0.3
                    + (byKey.macro?.pct          ?? 0) * 0.3;

  const glow    = weightedPct >= 0.70 ? 'green' : weightedPct >= 0.40 ? 'yellow' : 'red';
  const label   = weightedPct >= 0.70 ? 'Risk-On \u2014 Broad Participation' : weightedPct >= 0.40 ? 'Mixed Signals \u2014 Selective' : 'Risk-Off \u2014 Defensive';
  const posture = weightedPct >= 0.70 ? 'Risk-On, Not Complacent' : weightedPct >= 0.40 ? 'Selective, Not Aggressive' : 'Defensive, Reduce Risk';

  const regimeBearish = byId['regime']?.status === 'bearish';

  // Divergence: fire when any two categories are ≥2 glow levels apart (green=2, yellow=1, red=0).
  // That means one category is fully green AND another is fully red — a rare, meaningful split.
  // Priority: trend vs macro > trend vs participation > participation vs macro.
  const glowLevel = { green: 2, yellow: 1, red: 0 };
  const DIV_MSG = {
    'trend-macro':           ['Trend intact but macro conditions are restrictive — upside may be capped.',
                              'Macro conditions improving but the primary trend is broken — wait for confirmation.'],
    'trend-participation':   ['Narrow rally — breadth is not confirming trend strength. Historically fragile.',
                              'Broad participation without a confirmed trend — potential early-recovery signal.'],
    'participation-macro':   ['Broad participation but macro headwinds remain — be selective on duration.',
                              'Macro is constructive but breadth is absent — sector selection is critical.'],
  };
  let divergence = null;
  for (const [a, b] of [['trend','macro'],['trend','participation'],['participation','macro']]) {
    const la = glowLevel[byKey[a]?.glow ?? 'yellow'];
    const lb = glowLevel[byKey[b]?.glow ?? 'yellow'];
    if (Math.abs(la - lb) >= 2) {
      const msgs = DIV_MSG[`${a}-${b}`];
      divergence = {
        high: byKey[la > lb ? a : b]?.label,
        low:  byKey[la > lb ? b : a]?.label,
        message: la > lb ? msgs[0] : msgs[1],
      };
      break;
    }
  }

  return { bullish: counts.bullish, neutral: counts.neutral, bearish: counts.bearish,
    score: `${(weightedPct * 10).toFixed(1)}/10`, label, posture, glow, categories, regimeBearish, divergence };
}

// ── SECTOR RRG + PLAYBOOK (R6/R8) ────────────────────────────────────────────
// Weekly JdK RS-Ratio / RS-Momentum per sector vs SPY — the same methodology
// (and numbers) as /api/sector-cycle, so the playbook always matches the RRG
// chart the user sees. The expensive trail computation is KV-cached per UTC
// day; the calls themselves are recomputed fresh from live quotes each request.
const RRG_SECTORS = [
  { sym: 'XLK',  name: 'Technology',       type: 'cyclical'  },
  { sym: 'XLY',  name: 'Consumer Disc.',   type: 'cyclical'  },
  { sym: 'XLC',  name: 'Comm. Services',   type: 'cyclical'  },
  { sym: 'XLI',  name: 'Industrials',      type: 'cyclical'  },
  { sym: 'XLF',  name: 'Financials',       type: 'cyclical'  },
  { sym: 'XLE',  name: 'Energy',           type: 'cyclical'  },
  { sym: 'XLB',  name: 'Materials',        type: 'cyclical'  },
  { sym: 'XLV',  name: 'Health Care',      type: 'defensive' },
  { sym: 'XLP',  name: 'Consumer Staples', type: 'defensive' },
  { sym: 'XLU',  name: 'Utilities',        type: 'defensive' },
  { sym: 'XLRE', name: 'Real Estate',      type: 'defensive' },
];

// Duplicated from sector-cycle.js (source of truth for the methodology) — Pages
// Functions can't share module code across endpoint files.
function rrgEwm(values, span) {
  const alpha = 2 / (span + 1);
  let s = null;
  return values.map(v => {
    if (v == null) return null;
    s = s == null ? v : alpha * v + (1 - alpha) * s;
    return s;
  });
}
function rrgWeekStart(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  return new Date(d.getTime() - offset * 86400000).toISOString().slice(0, 10);
}

// Compute (or fetch from KV) the weekly RRG trails + 60d relative strength.
async function loadSectorRRG(db, kv) {
  if (!db) return null;
  const todayUTC = new Date().toISOString().slice(0, 10);
  try {
    if (kv) {
      const cached = await kv.get('rrg-playbook:v1', 'json');
      if (cached && cached.computed === todayUTC) return cached.sectors;
    }
  } catch { /* cache miss is fine */ }

  try {
    const start = new Date();
    start.setDate(start.getDate() - 730);   // EWM(26) warm-up, same as sector-cycle.js
    const startStr = start.toISOString().slice(0, 10);
    const allSyms = ['SPY', ...RRG_SECTORS.map(s => s.sym)];
    const placeholders = allSyms.map(() => '?').join(',');
    const { results } = await db.prepare(`
      SELECT dp.date, dp.symbol, dp.close
      FROM daily_prices dp
      INNER JOIN (
        SELECT DISTINCT date FROM daily_prices WHERE symbol = 'SPY' AND date >= ?
      ) d ON dp.date = d.date
      WHERE dp.symbol IN (${placeholders})
      ORDER BY dp.date ASC
    `).bind(startStr, ...allSyms).all();

    const byDate = {};
    for (const row of results) {
      if (!byDate[row.date]) byDate[row.date] = {};
      byDate[row.date][row.symbol] = row.close;
    }
    const allDates = Object.keys(byDate).sort();
    if (allDates.length < 100) return null;

    const weekMap = {};
    for (const date of allDates) {
      const wk = rrgWeekStart(date);
      if (!weekMap[wk]) weekMap[wk] = {};
      weekMap[wk].lastDate = date;
    }
    const weekKeys = Object.keys(weekMap).sort();

    const sectors = RRG_SECTORS.map(sec => {
      const rsLine = allDates.map(d => {
        const s = byDate[d]?.[sec.sym], spy = byDate[d]?.SPY;
        return (s != null && spy != null && spy !== 0) ? s / spy : null;
      });
      const e10 = rrgEwm(rsLine, 10), e26 = rrgEwm(rsLine, 26);
      const rsRatioByDate = {};
      for (let i = 0; i < allDates.length; i++) {
        if (e10[i] != null && e26[i] != null && e26[i] !== 0) rsRatioByDate[allDates[i]] = (e10[i] / e26[i]) * 100;
      }
      const weeklyRSRatio = weekKeys.map(wk => rsRatioByDate[weekMap[wk].lastDate] ?? null);
      const e5mom = rrgEwm(weeklyRSRatio, 5);
      const rsMom = weeklyRSRatio.map((v, i) =>
        (v != null && e5mom[i] != null && e5mom[i] !== 0) ? (v / e5mom[i]) * 100 : null);

      const TRAIL = 13;
      const from = Math.max(0, weekKeys.length - TRAIL);
      const trail = weekKeys.slice(from).map((wk, i) => ({
        week: wk,
        rsRatio: weeklyRSRatio[from + i] != null ? +weeklyRSRatio[from + i].toFixed(3) : null,
        rsMom:   rsMom[from + i] != null ? +rsMom[from + i].toFixed(3) : null,
      }));

      // 60-trading-day relative strength vs SPY (R6 uses this, not the 20d spread)
      let rs60 = null;
      if (allDates.length >= 61) {
        const dN = allDates[allDates.length - 1], d60 = allDates[allDates.length - 61];
        const s0 = byDate[d60]?.[sec.sym], sN = byDate[dN]?.[sec.sym];
        const p0 = byDate[d60]?.SPY,       pN = byDate[dN]?.SPY;
        if (s0 && sN && p0 && pN) rs60 = +(((sN / s0 - 1) - (pN / p0 - 1)) * 100).toFixed(1);
      }
      return { sym: sec.sym, name: sec.name, type: sec.type, trail, rs60 };
    });

    try { if (kv) await kv.put('rrg-playbook:v1', JSON.stringify({ computed: todayUTC, sectors }), { expirationTtl: 172800 }); } catch { /* non-fatal */ }
    return sectors;
  } catch { return null; }
}

// R6+R8: turn RRG trails into calls with multi-week persistence.
//   Overweight   = cyclical + RRG leading/improving + above 200d + positive 60d RS,
//                  held >= PERSIST_WKS consecutive weeks (R8) — carries its age.
//   Building     = qualifies but hasn't persisted yet (shown, not yet a call).
//   Underweight  = RRG weakening/lagging + below 200d, held >= PERSIST_WKS weeks.
//   Defensive leadership is never an overweight — it's a risk signal (see W3 fix).
const PERSIST_WKS = 3;
function buildSectorPlaybook(rrg, q) {
  if (!rrg) return null;
  const quadOf = (r, m) => r >= 100 ? (m >= 100 ? 'leading' : 'weakening') : (m >= 100 ? 'improving' : 'lagging');
  const groupOf = (qd) => (qd === 'leading' || qd === 'improving') ? 'strong' : 'weak';
  const out = rrg.map(sec => {
    const t = (sec.trail || []).filter(p => p.rsRatio != null && p.rsMom != null);
    if (!t.length) return null;
    const cur = t[t.length - 1];
    const rrgQuad = quadOf(cur.rsRatio, cur.rsMom);
    const curGroup = groupOf(rrgQuad);
    let weeks = 0;
    for (let i = t.length - 1; i >= 0 && groupOf(quadOf(t[i].rsRatio, t[i].rsMom)) === curGroup; i--) weeks++;

    const d = q[sec.sym];
    const abv200 = !!(d?.price && d?.sma200 && d.price > d.sma200);
    const rs60 = sec.rs60;
    const rsStr = rs60 != null ? (rs60 >= 0 ? '+' : '') + rs60 + '%' : '—';

    let call, why;
    const owQualified = sec.type === 'cyclical' && curGroup === 'strong' && abv200 && rs60 != null && rs60 > 0;
    const uwQualified = curGroup === 'weak' && !abv200;
    if (owQualified && weeks >= PERSIST_WKS) {
      call = 'overweight';
      why = `RRG ${rrgQuad} ${weeks}wk · >200d · 60d RS ${rsStr}`;
    } else if (owQualified) {
      call = 'building';
      why = `RRG ${rrgQuad} ${weeks}/${PERSIST_WKS}wk — confirms at ${PERSIST_WKS}`;
    } else if (uwQualified && weeks >= PERSIST_WKS) {
      call = 'underweight';
      why = `RRG ${rrgQuad} ${weeks}wk · <200d`;
    } else if (sec.type === 'defensive' && curGroup === 'strong') {
      call = 'neutral';
      why = `Defensive in RRG ${rrgQuad} — risk-off signal, never a buy call`;
    } else {
      call = 'neutral';
      why = `RRG ${rrgQuad} ${weeks}wk · ${abv200 ? '>200d' : '<200d'} · 60d RS ${rsStr}`;
    }
    return { sym: sec.sym, name: sec.name, type: sec.type, call, rrg: rrgQuad, weeks, rs60, abv200, why };
  }).filter(Boolean);
  const rank = { overweight: 0, building: 1, neutral: 2, underweight: 3 };
  out.sort((a, b) => (rank[a.call] - rank[b.call]) || ((b.rs60 ?? -99) - (a.rs60 ?? -99)));
  return out;
}

// ── ACTION DIRECTIVE (R1) — the single reconciled instruction ─────────────────
// Composes the quadrant, Entry Window, Anchor sizing, sector leaders and hard
// invalidation levels (R5) into one answer-first output. Pure composition of
// data already computed — every other surface defers to this. Live handler only
// (the as-of backfill stores horizon scores, not directives).
function buildDirective(q, horizons, sectorsCard, breadthData, oasSeries) {
  const { matrix, entryWindow, anchor, speedometer, compass } = horizons;
  const spy = q['SPY'];
  const quadrant = matrix.quadrant;
  const stretched = spy?.vs200 != null && spy.vs200 > 10;
  const defensive = quadrant === 'risk-off' || quadrant === 'bear-rally';

  // ── ACTION ──────────────────────────────────────────────────────────────────
  let verb, headline;
  if (quadrant === 'add-risk') {
    if (stretched) {
      verb = 'HOLD';
      headline = `Trend aligned but SPY is extended (${pct(spy.vs200, 1)} vs 200d) — wait for the next Entry Window rather than chasing.`;
    } else if (entryWindow.open) {
      verb = 'ADD';
      headline = `Entry Window open (day ${entryWindow.daysOpen}) with both trends up — deploy a tranche now.`;
    } else {
      verb = 'ADD';
      headline = 'Both trends up — adds are permitted; pullback entries (Entry Windows) carry the better odds.';
    }
  } else if (quadrant === 'accumulate') {
    verb = entryWindow.open ? 'ADD' : 'WAIT';
    headline = entryWindow.open
      ? `Entry Window open (day ${entryWindow.daysOpen}) — the validated add point: trend intact, tactical oversold.`
      : `Trend intact but tactical is soft — hold fire until the Entry Window opens (Speedometer < ${entryWindow.threshold}).`;
  } else if (quadrant === 'bear-rally') {
    verb = 'TRIM';
    headline = 'Short-term bounce inside a broken trend — no new positions; use strength to reduce, not to chase.';
  } else {
    verb = 'REDUCE';
    headline = 'Both timeframes point down — cut exposure toward defensives and cash.';
  }

  // ── WHERE — RRG-confirmed leaders (R6/R8) when the playbook is available; ───
  // falls back to the sector card's 20d leaders when it isn't.
  const pb = sectorsCard?.playbook ?? null;
  let over, under, whereNote;
  if (pb) {
    const rsStr = (v) => v != null ? (v >= 0 ? '+' : '') + v + '%' : '—';
    const pbOver  = pb.filter(p => p.call === 'overweight');
    const pbBuild = pb.filter(p => p.call === 'building');
    const pbUnder = pb.filter(p => p.call === 'underweight');
    over  = pbOver.map(p => ({ sym: p.sym, name: p.name, relPerf: p.rs60, weeks: p.weeks }));
    under = pbUnder.map(p => ({ sym: p.sym, name: p.name, relPerf: p.rs60, weeks: p.weeks }));
    const buildStr = pbBuild.length
      ? ` Building (not yet confirmed): ${pbBuild.map(p => `${p.name} (${p.weeks}/${PERSIST_WKS}wk)`).join(', ')}.`
      : '';
    whereNote = over.length
      ? `Adds go to RRG-confirmed leaders: ${pbOver.map(p => `${p.name} (${p.sym} — ${p.rrg} ${p.weeks}wk, 60d RS ${rsStr(p.rs60)})`).join(', ')}.` + buildStr
      : `No sector holds RRG-confirmed leadership (${PERSIST_WKS}wk persistence required) — add via the broad index or wait.` + buildStr;
  } else {
    over  = sectorsCard?.overweights  ?? [];
    under = sectorsCard?.underweights ?? [];
    whereNote = over.length
      ? `Adds go to cyclical leaders in trend: ${over.map(s => `${s.name} (${s.sym} ${s.relPerf >= 0 ? '+' : ''}${s.relPerf}% vs SPY)`).join(', ')}.`
      : 'No cyclical sector currently qualifies (in trend + outperforming) — add via the broad index or wait.';
  }
  const where = defensive
    ? { overweights: [], underweights: under,
        note: 'Sector overweights suspended — favour defensives, quality and cash until the trend repairs.' }
    : { overweights: over, underweights: under, note: whereNote };

  // ── SIZE — the Anchor is the budget, tranches are the schedule ──────────────
  const sizePct = Math.round((matrix.sizingFactor ?? 1) * 100);
  const size = {
    factor: matrix.sizingFactor ?? 1, pctOfNormal: sizePct, zone: anchor.zone,
    note: `Deploy in thirds: each tranche ≈ 1/3 of a ${sizePct}%-of-normal position (Macro Anchor ${anchor.zone}${anchor.zone !== 'green' ? ' — valuations leave less cushion' : ''}).`,
  };

  // ── TRIGGER — what green-lights the next add ────────────────────────────────
  const trigger = entryWindow.open
    ? `Active now: Speedometer ${speedometer.score.toFixed(1)} is below ${entryWindow.threshold} with the Compass trend intact (${entryWindow.stats}).`
    : `Next add on Entry Window: Speedometer < ${entryWindow.threshold} while the Compass state holds high (currently ${speedometer.score.toFixed(1)} / ${compass.score.toFixed(1)}).`;

  // ── INVALIDATIONS (R5) — hard levels that kill (or, when defensive, re-arm)
  // the risk-on stance. Every level is a number already computed elsewhere.
  const invalidations = [];
  if (spy?.price && spy?.sma200) {
    invalidations.push({
      key: 'spy200', label: 'SPY 200d SMA', level: usd(spy.sma200), current: usd(spy.price),
      breached: spy.price < spy.sma200,
      note: defensive
        ? `Re-risk signal: SPY closing back above ${usd(spy.sma200)}.`
        : `Stance dies on a SPY close below ${usd(spy.sma200)} (${pct(spy.vs200, 1)} above it now).`,
    });
  }
  const vix = q['^VIX']?.price, vix3m = q['^VIX3M']?.price;
  if (vix != null && vix3m != null && vix3m > 0) {
    const ratio = vix / vix3m;
    invalidations.push({
      key: 'vixveto', label: 'VIX/VIX3M veto', level: '1.00', current: ratio.toFixed(2),
      breached: ratio > 1,
      note: ratio > 1 ? 'BREACHED — volatility term structure inverted; all adds vetoed.'
        : `All adds veto if the ratio closes above 1.00 (now ${ratio.toFixed(2)}).`,
    });
  }
  const mmth = breadthData?.pct_above_200d;
  if (mmth != null) {
    invalidations.push({
      key: 'mmth', label: 'NYSE breadth floor', level: '40%', current: `${mmth.toFixed(1)}%`,
      breached: mmth < 40,
      note: mmth < 40 ? 'BREACHED — breadth breakdown; broad exposure carries elevated risk.'
        : `Breadth breakdown if fewer than 40% of NYSE stocks hold their 200d (now ${mmth.toFixed(1)}%).`,
    });
  }
  if (oasSeries && oasSeries.length >= 50) {
    const oasCur = oasSeries[0].value;
    const oasSma50 = oasSeries.slice(0, 50).reduce((a, b) => a + b.value, 0) / 50;
    invalidations.push({
      key: 'oas', label: 'HY OAS vs 50d avg', level: oasSma50.toFixed(2) + '%', current: oasCur.toFixed(2) + '%',
      breached: oasCur > oasSma50,
      note: oasCur > oasSma50 ? 'BREACHED — credit spreads widening above trend; credit is not confirming.'
        : `Credit warning if HY spreads rise above their 50d average (${oasSma50.toFixed(2)}%).`,
    });
  }

  return {
    verb, headline, quadrant,
    mode: defensive ? 'reentry' : 'exit',   // how the levels block should be titled
    pending: matrix.pending ?? null,
    where, size, trigger, invalidations,
  };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
// Assemble the valn/fred bundles from raw loader outputs and compute the horizons.
// Shared by the live handler and the as-of backfill so they stay identical.
function computeHorizons(q, breadthData, capeP, buffettP, fwdPeP, epsMom, oasSeries, realYieldSeries, fedFundsSeries, histRows = []) {
  const valn = {
    cape:    capeP?.value,    capePct:    capeP?.pct,
    buffett: buffettP?.value, buffettPct: buffettP?.pct,
    fwdPe:   fwdPeP?.value,   fwdPePct:   fwdPeP?.pct,
    epsYoy:  epsMom?.yoy ?? null,
  };
  // Fed funds direction from DFEDTARU: hiking = tightening = more structural risk.
  let fedFundsRisk = null, fedFundsDir = null;
  if (fedFundsSeries && fedFundsSeries.length >= 2) {
    const cur = fedFundsSeries[0].value;
    const prev = fedFundsSeries[fedFundsSeries.length - 1].value;
    if (cur > prev)      { fedFundsRisk = 0.75; fedFundsDir = 'Hiking'; }
    else if (cur < prev) { fedFundsRisk = 0.25; fedFundsDir = 'Cutting'; }
    else                 { fedFundsRisk = 0.5;  fedFundsDir = 'On Hold'; }
  }
  const fred = { oas: oasSeries, realYield: realYieldSeries?.[0]?.value ?? null, fedFundsRisk, fedFundsDir };
  return buildHorizons(q, breadthData, valn, fred, histRows);
}

// Horizons-only, as-of a past date, for the Historical Scorecard backfill.
// Token-gated in the handler. Pure D1 (no Yahoo fallback).
async function horizonsAsOf(db, asOf) {
  const [q, breadthData, capeP, buffettP, fwdPeP, epsMom, oasSeries, realYieldSeries, fedFundsSeries, histRows] = await Promise.all([
    loadFromD1(db, asOf),
    loadBreadthLatest(db, asOf),
    loadPercentile(db, 'shiller_data', 'cape', asOf),
    loadPercentile(db, 'buffett_data', 'ratio', asOf),
    loadPercentile(db, 'forward_pe_data', 'pe', asOf),
    loadEpsMomentum(db, asOf),
    loadFredSeries(db, 'BAMLH0A0HYM2', 250, asOf),
    loadFredSeries(db, 'DFII10', 5, asOf),
    loadFredSeries(db, 'DFEDTARU', 60, asOf),
    loadScoreHistoryRecent(db, asOf),
  ]);
  const horizons = computeHorizons(q, breadthData, capeP, buffettP, fwdPeP, epsMom, oasSeries, realYieldSeries, fedFundsSeries, histRows);
  return new Response(JSON.stringify({ asOf, source: 'd1', horizons }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  // Historical Scorecard backfill: ?asOf=YYYY-MM-DD returns horizons computed as-of
  // that date (token-gated). Live scoring (no asOf) is unaffected below.
  const asOfParam = new URL(context.request.url).searchParams.get('asOf');
  if (asOfParam) {
    const jerr = (m, s) => new Response(JSON.stringify({ error: m }), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfParam)) return jerr('bad asOf (expect YYYY-MM-DD)', 400);
    if (context.request.headers.get('X-Hub-Token') !== context.env.HUB_TOKEN) return jerr('Unauthorized', 401);
    if (!context.env.DB) return jerr('D1 not configured', 500);
    return horizonsAsOf(context.env.DB, asOfParam);
  }

  // Try D1 first; fall back to Yahoo Finance for any symbol not found in D1 or stale
  const db  = context.env.DB;
  const kv = context.env.SUMMARIES;
  const [d1, shiller, buffett, forwardPe, japanPe, breadthData, leaderCtx, breadthCtx, kvWeights,
         capeP, buffettP, fwdPeP, oasSeries, realYieldSeries, fedFundsSeries, adidCtx] = await Promise.all([
    db ? loadFromD1(db) : Promise.resolve({}),
    db ? loadShillerLatest(db) : Promise.resolve(null),
    db ? loadBuffettLatest(db) : Promise.resolve(null),
    db ? loadForwardPeLatest(db) : Promise.resolve(null),
    db ? loadJapanPeLatest(db) : Promise.resolve(null),
    db ? loadBreadthLatest(db) : Promise.resolve(null),
    db ? loadLeadershipContext(db) : Promise.resolve(null),
    db ? loadBreadthContext(db) : Promise.resolve(null),
    loadSectorWeights(kv),
    db ? loadPercentile(db, 'shiller_data', 'cape') : Promise.resolve(null),
    db ? loadPercentile(db, 'buffett_data', 'ratio') : Promise.resolve(null),
    db ? loadPercentile(db, 'forward_pe_data', 'pe') : Promise.resolve(null),
    db ? loadFredSeries(db, 'BAMLH0A0HYM2', 250) : Promise.resolve([]),
    db ? loadFredSeries(db, 'DFII10', 5) : Promise.resolve([]),
    db ? loadFredSeries(db, 'DFEDTARU', 60) : Promise.resolve([]),
    db ? loadBreadthAdid(db) : Promise.resolve(null),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  // Treat D1 data as stale only if >3 calendar days old \u2014 handles weekends + pre-seeder Monday
  const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const missing = ALL_SYMBOLS.filter(s => !d1[s] || d1[s].latestDate < staleDate);

  const q = { ...d1 };
  if (missing.length > 0) {
    const batches = [];
    for (let i = 0; i < missing.length; i += 20)
      batches.push(missing.slice(i, i + 20));
    for (const batch of batches) {
      const batchData = await fetchAll(batch);
      for (const [sym, yfData] of Object.entries(batchData)) {
        const prior = d1[sym];
        if (prior?.sma200) {
          // Blend: live price from YF, SMA anchor from D1, recompute vs
          q[sym] = {
            ...prior,
            price:    yfData.price,
            changePct: yfData.changePct,
            price5d:  yfData.price5d  ?? prior.price5d,
            price20d: yfData.price20d ?? prior.price20d,
            price25d: yfData.price25d ?? prior.price25d,
            vs50:  prior.sma50  ? ((yfData.price - prior.sma50)  / prior.sma50)  * 100 : yfData.vs50,
            vs200: prior.sma200 ? ((yfData.price - prior.sma200) / prior.sma200) * 100 : yfData.vs200,
          };
        } else {
          q[sym] = yfData;
        }
      }
    }
  }

  const [regimeCtx, commCtx, creditCtx, epsMom, scoreHistRaw] = await Promise.all([
    db ? loadRegimeContext(db) : Promise.resolve(null),
    db ? loadCommoditiesContext(db) : Promise.resolve(null),
    db ? loadCreditContext(db) : Promise.resolve(null),
    db ? loadEpsMomentum(db) : Promise.resolve(null),
    db ? loadScoreHistoryRecent(db) : Promise.resolve([]),
  ]);
  // Drop any history row for the current data date — after the nightly snapshot
  // runs, today's row exists in score_history and would otherwise be replayed
  // twice (once from history, once as the live value appended by buildHorizons).
  const dataDate = q['SPY']?.latestDate ?? null;
  const scoreHist = dataDate ? scoreHistRaw.filter(r => r.date < dataDate) : scoreHistRaw;

  const realYield = realYieldSeries?.[0]?.value ?? null;

  const cards = [
    buildRegime(q, regimeCtx),
    buildLeadership(q, leaderCtx),
    buildBreadth(q, breadthData, breadthCtx, adidCtx),
    buildValuations(shiller, buffett, forwardPe, japanPe, epsMom),
    buildYield(q, realYield),
    buildCurrency(q),
    buildGlobalFlows(q),
    buildSectors(q, kvWeights),
    buildCommodities(q, commCtx),
    buildEquities(q),
    buildCredit(q, creditCtx),
  ];

  // ── DELTA: compare today vs previous trading day ───────────────────────────
  let scoreDirection = 'same';
  if (kv) {
    try {
      const [current, previous] = await Promise.all([
        kv.get('card-statuses:current', 'json'),
        kv.get('card-statuses:previous', 'json'),
      ]);

      const todayStatuses = {};
      cards.forEach(c => { todayStatuses[c.id] = c.status; });

      let deltas = {};
      let prevStatuses = null;
      if (!current || current.date < today) {
        prevStatuses = current?.statuses ?? null;
        if (current) await kv.put('card-statuses:previous', JSON.stringify(current));
        await kv.put('card-statuses:current', JSON.stringify({ date: today, statuses: todayStatuses }));
        if (current) deltas = computeDeltas(todayStatuses, current.statuses);
      } else {
        prevStatuses = previous?.statuses ?? null;
        if (previous) deltas = computeDeltas(todayStatuses, previous.statuses);
      }

      cards.forEach(c => { c.delta = deltas[c.id] || 'same'; });

      if (prevStatuses) {
        const todayPct = computeWeightedPct(todayStatuses);
        const prevPct  = computeWeightedPct(prevStatuses);
        scoreDirection = todayPct > prevPct + 0.049 ? 'up'
                       : todayPct < prevPct - 0.049 ? 'down'
                       : 'same';
      }
    } catch { /* non-fatal */ }
  }

  const source = !db || missing.length === ALL_SYMBOLS.length ? 'yahoo'
    : missing.length === 0 ? 'd1'
    : 'd1+yahoo';

  const agg = buildAggregate(cards);
  agg.scoreDirection = scoreDirection;

  // ── HORIZON SCORES ─────────────────────────────────────────────────────────
  const horizons = computeHorizons(q, breadthData, capeP, buffettP, fwdPeP, epsMom, oasSeries, realYieldSeries, fedFundsSeries, scoreHist);

  // R6/R8: RRG playbook — attach to the sectors card so the deep dive can render
  // it and the directive's WHERE reads from it.
  const sectorsCard = cards.find(c => c.id === 'sectors');
  const rrg = await loadSectorRRG(db, kv);
  const playbook = buildSectorPlaybook(rrg, q);
  if (sectorsCard && playbook) sectorsCard.playbook = playbook;

  // W2 fix: when the Compass reads healthy, name the actual RRG-confirmed
  // leaders instead of a hard-coded sector list.
  if (playbook && horizons.compass.score > 7.0) {
    const ow = playbook.filter(p => p.call === 'overweight');
    horizons.compass.trigger = ow.length
      ? `The 2–3 month trend is healthy — favour the RRG-confirmed leaders: ${ow.map(p => `${p.name} (${p.sym})`).join(', ')}.`
      : `The 2–3 month trend is healthy, but no sector holds RRG-confirmed leadership yet — broad-index exposure over sector bets.`;
  }

  // R1: the reconciled Action Directive — composed after horizons + cards so it
  // can reference the effective quadrant, Entry Window and live sector leaders.
  horizons.directive = buildDirective(q, horizons, sectorsCard, breadthData, oasSeries);

  const body = JSON.stringify({
    timestamp: new Date().toISOString(),
    source,
    aggregate: agg,
    horizons,
    cards,
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
