/**
 * Market Hub — InterMarket Regime Ratios
 * Cloudflare Pages Function: GET /api/regime-ratios
 *
 * Cross-asset relative-strength ratios for the InterMarket card. For each curated
 * pair it computes the ratio (num/den), its 50/200-day SMAs, the current regime
 * (50 vs 200), the last 50/200 cross (direction + trading days ago), whether that
 * turn is CONFIRMED (>= 5 days held) and FRESH (<= 30 days), and a compact series
 * for the deep-dive charts. Returns the top-3 (card face) + a `callout` object when
 * a top-3 pair has a confirmed, fresh turn (the Exec Summary banner).
 *
 * Diagnostic only — never feeds the composite or horizons. Read-only, no auth.
 * Pair ranking validated against 18yr history (persistence + SPY forward-return lead).
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };

// Oriented so RISING = risk-on / numerator-leading. Tiers re-ordered by the 18yr
// scoring (leading & clean first; coincident cross-asset confirmation last).
const PAIRS = [
  // Tier 1 — leading risk-appetite (clean + forward-meaningful). Top 3 = card face + callout-eligible.
  { key: 'soxx_spy', label: 'SOXX / SPY', num: 'SOXX', den: 'SPY', tier: 1, up: 'Semis vs market — risk appetite', callUp: 'semiconductors are outperforming the broad market — risk appetite is expanding from its leading edge', callDown: 'semiconductors are ceding to the broad market — risk appetite is cooling at the leading edge, often an early warning' },
  { key: 'eem_spy',  label: 'EEM / SPY',  num: 'EEM',  den: 'SPY', tier: 1, up: 'EM vs US — global risk / dollar', callUp: 'emerging markets are leading the US — global risk-on, typically alongside a softer dollar', callDown: 'emerging markets are lagging the US — global risk-off and/or a firmer dollar' },
  { key: 'xly_xlp',  label: 'XLY / XLP',  num: 'XLY',  den: 'XLP', tier: 1, up: 'Discretionary vs Staples — offense/defense', callUp: 'Consumer Discretionary is leading Staples — consumers on offense, a growth / risk-on tilt', callDown: 'Consumer Discretionary is lagging Staples — consumers turning defensive, a caution on growth' },
  { key: 'xlk_xlv',  label: 'XLK / XLV',  num: 'XLK',  den: 'XLV', tier: 1, up: 'Tech vs Health — growth/defensive', callUp: 'Technology is leading Health Care — the market favours growth over defensives, a risk-on posture', callDown: 'Technology is lagging Health Care — money is rotating into defensives, a risk-off posture' },
  // Tier 2 — cyclical rotation
  { key: 'xli_xlu',  label: 'XLI / XLU',  num: 'XLI',  den: 'XLU', tier: 2, up: 'Industrials vs Utilities — cyclical', callUp: 'Industrials are leading Utilities — cyclical strength consistent with expectations of stronger growth', callDown: 'Industrials are lagging Utilities — a defensive rotation into rate-sensitive Utilities, a growth caution' },
  { key: 'xlf_xlu',  label: 'XLF / XLU',  num: 'XLF',  den: 'XLU', tier: 2, up: 'Financials vs Utilities — rates/cyclical', callUp: 'Financials are leading Utilities — a cyclical, rising-rate tilt that favours risk', callDown: 'Financials are lagging Utilities — a defensive, falling-rate tilt that warns on growth' },
  // Tier 3 — breadth & style (clean but non-timing)
  { key: 'rsp_spy',  label: 'RSP / SPY',  num: 'RSP',  den: 'SPY', tier: 3, up: 'Equal vs Cap weight — breadth', callUp: 'the equal-weight index is leading the cap-weighted — broadening participation, a healthier advance', callDown: 'the equal-weight index is lagging the cap-weighted — narrowing leadership concentrated in mega-caps' },
  { key: 'iwm_spy',  label: 'IWM / SPY',  num: 'IWM',  den: 'SPY', tier: 3, up: 'Small vs Large — risk appetite', callUp: 'small-caps are leading large-caps — expanding risk appetite and confidence in the domestic economy', callDown: 'small-caps are lagging large-caps — shrinking risk appetite and a flight to size and quality' },
  { key: 'ivw_ive',  label: 'IVW / IVE',  num: 'IVW',  den: 'IVE', tier: 3, up: 'Growth vs Value — style', callUp: 'Growth is leading Value — a style shift toward long-duration, higher-multiple equities', callDown: 'Growth is lagging Value — a style shift toward Value, often with rising rates or late-cycle caution' },
  // Tier 4 — cross-asset confirmation (coincident / contrarian on forward returns)
  { key: 'spy_gld',  label: 'SPY / Gold', num: 'SPY',  den: 'GLD', tier: 4, up: 'Stocks vs Gold — risk vs fear', callUp: 'stocks are leading gold — risk appetite is winning over safe-haven demand', callDown: 'stocks are lagging gold — safe-haven demand is winning, a defensive, fearful tone' },
  { key: 'copx_gld', label: 'Copper / Gold', num: 'COPX', den: 'GLD', tier: 4, up: 'Copper vs Gold — reflation', callUp: 'copper is leading gold — a reflationary, pro-growth signal from the metals', callDown: 'copper is lagging gold — a deflationary, risk-off signal from the metals' },
  { key: 'hyg_lqd',  label: 'HYG / LQD',  num: 'HYG',  den: 'LQD', tier: 4, up: 'Junk vs Quality — credit risk', callUp: 'high-yield is leading investment-grade credit — spreads tightening, a risk-on credit backdrop', callDown: 'high-yield is lagging investment-grade credit — spreads widening, a risk-off credit warning' },
  { key: 'xle_xlk',  label: 'XLE / XLK',  num: 'XLE',  den: 'XLK', tier: 4, up: 'Energy vs Tech — inflation/value', callUp: 'Energy is leading Technology — an inflationary, value-over-growth rotation', callDown: 'Energy is lagging Technology — a disinflationary, growth-over-value rotation' },
];
const TOP = ['soxx_spy', 'eem_spy', 'xly_xlp'];
const CONFIRM_DAYS = 5;   // must hold this many trading days to be "confirmed"
const FRESH_DAYS   = 30;  // still "news" for this many trading days
const CHART_LEN    = 130; // points returned for the deep-dive mini charts

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  const db = context.env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });

  const syms = [...new Set(PAIRS.flatMap(p => [p.num, p.den]))];
  let rows = [];
  try {
    const ph = syms.map(() => '?').join(',');
    ({ results: rows = [] } = await db.prepare(
      `SELECT symbol, date, close FROM daily_prices WHERE symbol IN (${ph}) AND date >= DATE('now','-560 days') ORDER BY symbol, date`
    ).bind(...syms).all());
  } catch (e) {
    return new Response(JSON.stringify({ error: 'query failed: ' + e.message }), { status: 500, headers: CORS });
  }

  const bySym = {};
  for (const r of rows) (bySym[r.symbol] ||= []).push(r);

  let asOf = null;
  const pairs = [];
  let callout = null;

  for (const p of PAIRS) {
    const A = bySym[p.num], B = bySym[p.den];
    if (!A || !B) continue;
    const mb = new Map(B.map(r => [r.date, r.close]));
    const ser = [];
    for (const r of A) { const bc = mb.get(r.date); if (bc > 0) ser.push({ date: r.date, v: r.close / bc }); }
    if (ser.length < 210) continue;

    const s50 = [], s200 = [];
    let a50 = 0, a200 = 0;
    for (let i = 0; i < ser.length; i++) {
      a50 += ser[i].v; a200 += ser[i].v;
      if (i >= 50)  a50  -= ser[i - 50].v;
      if (i >= 200) a200 -= ser[i - 200].v;
      s50[i]  = i >= 49  ? a50 / 50   : null;
      s200[i] = i >= 199 ? a200 / 200 : null;
    }
    const reg = (i) => (s50[i] != null && s200[i] != null) ? Math.sign(s50[i] - s200[i]) : null;
    const last = ser.length - 1;
    const curReg = reg(last) || 1;
    if (!asOf || ser[last].date > asOf) asOf = ser[last].date;

    // most recent 50/200 cross
    let daysAgo = null;
    for (let i = last; i >= 200; i--) { if (reg(i) !== curReg) { daysAgo = last - i; break; } }
    if (daysAgo == null) daysAgo = last - 199; // no cross inside the loaded window
    const dir = curReg > 0 ? 'golden' : 'death';
    const confirmed = daysAgo >= CONFIRM_DAYS;
    const fresh = daysAgo <= FRESH_DAYS;

    const value = ser[last].v, sma200 = s200[last];
    const vs200 = sma200 ? (value / sma200 - 1) * 100 : null;

    const start = Math.max(0, ser.length - CHART_LEN);
    const series = ser.slice(start).map((r, k) => ({
      d: r.date, v: +r.v.toFixed(4),
      s50:  s50[start + k]  != null ? +s50[start + k].toFixed(4)  : null,
      s200: s200[start + k] != null ? +s200[start + k].toFixed(4) : null,
    }));

    pairs.push({
      key: p.key, label: p.label, num: p.num, den: p.den, tier: p.tier, up: p.up,
      regime: curReg > 0 ? 'up' : 'down',
      vs200: vs200 != null ? +vs200.toFixed(1) : null,
      lastCross: { dir, daysAgo }, confirmed, fresh, series,
    });

    // Exec-Summary callout: only a TOP pair with a confirmed, fresh turn.
    if (TOP.includes(p.key) && confirmed && fresh) {
      const cand = {
        key: p.key, label: p.label, dir, daysAgo,
        riskDir: curReg > 0 ? 'risk-on' : 'risk-off',
        message: `${p.label} ${dir === 'golden' ? 'turned up' : 'turned down'} ${daysAgo} trading days ago and has held — ${dir === 'golden' ? (p.callUp || 'risk-on') : (p.callDown || 'risk-off')}.`,
      };
      if (!callout || cand.daysAgo < callout.daysAgo) callout = cand; // freshest confirmed turn wins
    }
  }

  // Historical confirmed turns of the top-3 — for the Score History timeline overlay.
  const topPairs = PAIRS;   // all four tiers now
  const topSyms = [...new Set(topPairs.flatMap(p => [p.num, p.den]))];
  const topTurns = [];
  try {
    const ph2 = topSyms.map(() => '?').join(',');
    const { results: rows2 = [] } = await db.prepare(
      `SELECT symbol, date, close FROM daily_prices WHERE symbol IN (${ph2}) AND date >= DATE('now','-1100 days') ORDER BY symbol, date`
    ).bind(...topSyms).all();
    const bySym2 = {};
    for (const r of rows2) (bySym2[r.symbol] ||= []).push(r);
    for (const p of topPairs) {
      const A = bySym2[p.num], B = bySym2[p.den];
      if (!A || !B) continue;
      const mb = new Map(B.map(r => [r.date, r.close]));
      const ser = [];
      for (const r of A) { const bc = mb.get(r.date); if (bc > 0) ser.push({ date: r.date, v: r.close / bc }); }
      if (ser.length < 210) continue;
      const s50 = [], s200 = [];
      let a50 = 0, a200 = 0;
      for (let i = 0; i < ser.length; i++) {
        a50 += ser[i].v; a200 += ser[i].v;
        if (i >= 50)  a50  -= ser[i - 50].v;
        if (i >= 200) a200 -= ser[i - 200].v;
        s50[i]  = i >= 49  ? a50 / 50   : null;
        s200[i] = i >= 199 ? a200 / 200 : null;
      }
      const reg = (i) => (s50[i] != null && s200[i] != null) ? Math.sign(s50[i] - s200[i]) : null;
      let prev = null;
      for (let i = 199; i < ser.length; i++) {
        const rg = reg(i);
        if (prev === null) { prev = rg; continue; }
        if (rg !== prev) {
          let run = 1; while (i + run < ser.length && reg(i + run) === rg) run++;
          if (run >= CONFIRM_DAYS) {   // only persistent turns
            const dir = rg > 0 ? 'golden' : 'death';
            topTurns.push({
              key: p.key, label: p.label, num: p.num, tier: p.tier, top: TOP.includes(p.key), date: ser[i].date, dir,
              riskDir: rg > 0 ? 'risk-on' : 'risk-off',
              desc: dir === 'golden' ? (p.callUp || 'risk appetite improving at this pair') : (p.callDown || 'risk appetite deteriorating at this pair'),
            });
          }
          prev = rg;
        }
      }
    }
    topTurns.sort((x, y) => (x.date < y.date ? -1 : 1));
  } catch (e) { /* topTurns are optional context */ }

  return new Response(JSON.stringify({ asOf, top: TOP, pairs, callout, topTurns }), { headers: CORS });
}
