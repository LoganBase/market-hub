// Market Hub mobile — Glance view.
// Structural cards (regime…equities) + Crowd Signals rendered via CardRow.
// Daily Brief and Macro Brief rendered via dedicated card rows and deep-dives.
const { useState, useEffect, useRef } = React;

// ── Data hooks ────────────────────────────────────────────────────────────────
function useGlance() {
  const [D, setD] = useState(window.GLANCE);
  useEffect(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadGlance()
        .then((live) => { if (alive && live) setD(live); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  return D;
}

function useDailyBrief() {
  const [brief, setBrief] = useState(null);
  useEffect(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadDailyBrief()
        .then((d) => { if (alive && d && !d.error) setBrief(d); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  return brief;
}

function useMacroBrief() {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadMacroBrief()
        .then((d) => { if (alive) { if (d && !d.error) setBrief(d); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { alive = false; };
  }, []);
  return { brief, loading };
}

// ── Shared constants ──────────────────────────────────────────────────────────
const SIG = {
  bullish: { c: '#22c55e', glow: 'rgba(34,197,94,.35)', fill: 'rgba(34,197,94,.12)', line: 'rgba(34,197,94,.25)', word: 'BULLISH' },
  neutral: { c: '#f59e0b', glow: 'rgba(245,158,11,.35)', fill: 'rgba(245,158,11,.10)', line: 'rgba(245,158,11,.20)', word: 'NEUTRAL' },
  bearish: { c: '#ef4444', glow: 'rgba(239,68,68,.35)',  fill: 'rgba(239,68,68,.10)',  line: 'rgba(239,68,68,.20)',  word: 'BEARISH' },
};
const MONO = "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,Menlo,Consolas,monospace";
const SANS = "'Inter',-apple-system,system-ui,sans-serif";

function postureColor(label) { return /off/i.test(label) ? '#ef4444' : /on/i.test(label) ? '#22c55e' : '#f59e0b'; }
function sentimentColor(s) {
  if (s == null) return '#f59e0b';
  return s >= 2 ? '#22c55e' : s <= -2 ? '#ef4444' : '#f59e0b';
}
function _tc(st) { return st === 'bullish' ? '#22c55e' : st === 'bearish' ? '#ef4444' : '#f59e0b'; }

// ── Market Diagnostics (pure functions — same logic as desktop-parts.jsx) ────
function buildRegimeDiagnostics(card) {
  const rows = card.rows || [], stats = card.stats || [];
  const r1 = rows[0], r2 = rows[1], r3 = rows[2];
  const findStat = (l) => stats.find((s) => s[0] === l);
  const pctStat = findStat('Percentile Rank'), durStat = findStat('Regime Duration'), velStat = findStat('Extension Velocity');
  const tS = (st) => st === 'bullish' ? '#22c55e' : st === 'bearish' ? '#ef4444' : '#f59e0b';
  const tT = (t)  => t  === 'pos'     ? '#22c55e' : t  === 'neg'     ? '#ef4444' : '#f59e0b';
  const pN = pctStat ? parseInt(pctStat[1], 10) : null;
  const dN = durStat ? parseInt(durStat[1], 10) : null;
  const vN = velStat ? parseFloat(velStat[1])   : null;
  const pA = pN == null ? null : pN >= 90 ? 'Reduce Exposure' : pN >= 70 ? 'Monitor for Reversion' : pN <= 10 ? 'Watch for Bounce' : pN <= 30 ? 'Watch for Reversal' : 'No Action';
  const dA = dN == null ? null : dN > 250 ? 'Trail Stops' : dN > 60 ? 'Hold Core' : dN < 10 ? 'Await Confirmation' : 'Monitor';
  const vA = vN == null ? null : vN > 0.05 ? 'Monitor Stretch' : vN < -0.05 ? 'Pressure Easing' : 'No Signal Change';
  return [
    { label: 'SPY Regime',         a: r1 ? r1[2] : '—', c: r1 ? tS(r1[3]) : '#94a3b8' },
    { label: 'Stretch Risk',       a: r2 ? r2[2] : '—', c: r2 ? tS(r2[3]) : '#94a3b8' },
    { label: 'Trend Cross',        a: r3 ? r3[2] : '—', c: r3 ? tS(r3[3]) : '#94a3b8' },
    { label: 'Percentile Rank',    a: pctStat ? `${pctStat[1]} percentile — ${pA}` : '—', c: pctStat ? tT(pctStat[3]) : '#94a3b8' },
    { label: 'Regime Duration',    a: durStat ? `${durStat[1]} ${durStat[2]} — ${dA}` : '—', c: durStat ? tT(durStat[3]) : '#94a3b8' },
    { label: 'Extension Velocity', a: velStat ? `${velStat[1]} (${velStat[2]}) — ${vA}` : '—', c: velStat ? tT(velStat[3]) : '#94a3b8' },
  ];
}
function buildLeadershipDiagnostics(card) {
  const rows = card.rows || [], stats = card.stats || [];
  const tS = (st) => st === 'bullish' ? '#22c55e' : st === 'bearish' ? '#ef4444' : '#f59e0b';
  const tT = (t)  => t  === 'pos'     ? '#22c55e' : t  === 'neg'     ? '#ef4444' : '#f59e0b';
  const r0 = rows[0], r1 = rows[1], r2 = rows[2];
  const mktSt = stats.find(s => { const l = (s[0]||'').toLowerCase(); return !l.includes('streak') && !l.includes('tech') && !l.includes('qqew') && !l.includes('qqq') && !l.includes('growth') && !l.includes('style'); });
  const strSt = stats.find(s => (s[0]||'').toLowerCase().includes('streak'));
  const techSt = stats.find(s => { const l = (s[0]||'').toLowerCase(); return l.includes('tech') || l.includes('qqew') || l.includes('qqq'); });
  return [
    { label: 'Market Breadth', a: r0 ? (r0[2] || '—') : '—', c: r0 ? tS(r0[3]) : '#94a3b8' },
    { label: 'Tech Breadth',   a: r1 ? (r1[2] || '—') : '—', c: r1 ? tS(r1[3]) : '#94a3b8' },
    { label: 'Style Bias',     a: r2 ? (r2[2] || '—') : '—', c: r2 ? tS(r2[3]) : '#94a3b8' },
    { label: 'Market Spread',  a: mktSt  ? `${mktSt[1]}  —  ${mktSt[2]}`  : '—', c: mktSt  ? tT(mktSt[3])  : '#94a3b8' },
    { label: 'Tech Spread',    a: techSt ? `${techSt[1]}  —  ${techSt[2]}` : '—', c: techSt ? tT(techSt[3]) : '#94a3b8' },
    { label: 'Daily Streak',   a: strSt  ? `${strSt[1]} ${strSt[2]}`       : '—', c: strSt  ? tT(strSt[3])  : '#94a3b8' },
  ];
}
function buildBreadthDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const p0 = r0 ? parseFloat(r0[1]) : null, p1 = r1 ? parseFloat(r1[1]) : null;
  const zone = p0 == null ? 'No data'
    : p0 >= 70 ? `Bull Zone — ${p0.toFixed(1)}% above 200d; broad participation confirmed`
    : p0 >= 40 ? `Mixed Zone — ${p0.toFixed(1)}% above 200d; market is bifurcating`
    : `Bear Zone — ${p0.toFixed(1)}% above 200d; broad exposure carries elevated risk`;
  const zoneC = p0 == null ? '#94a3b8' : p0 >= 70 ? '#22c55e' : p0 >= 40 ? '#f59e0b' : '#ef4444';
  const align = p0 != null && p1 != null
    ? (p0 >= 60 && p1 >= 60 ? 'Bullishly Aligned — both 50d and 200d breadth confirm the uptrend; durable setup'
      : p0 < 40 && p1 < 40 ? 'Bearishly Aligned — both measures confirm deterioration; no near-term floor visible'
      : Math.abs(p0 - p1) > 20 ? 'Diverging — watch the faster 50d SMA for an early-turn signal'
      : 'Neutral Mix — no strong alignment; monitor for convergence') : '—';
  const alignC = p0 != null && p1 != null ? (p0 >= 60 && p1 >= 60 ? '#22c55e' : p0 < 40 && p1 < 40 ? '#ef4444' : '#f59e0b') : '#94a3b8';
  return [
    { label: 'NYSE 200d Breadth',     a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'NYSE 50d Breadth',      a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'Sector Breadth',        a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'Consumer Health Check', a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'Breadth Zone',          a: zone,              c: zoneC },
    { label: '50d vs 200d Alignment', a: align,             c: alignC },
  ];
}
function buildValuationsDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const cv = r1 ? parseFloat(r1[1]) : null;
  const capeImpl = cv == null ? '—'
    : cv > 35 ? `At ${cv.toFixed(1)}× — 10-year real returns historically 0–2% p.a.; favour cash flow over growth`
    : cv > 25 ? `At ${cv.toFixed(1)}× — expected 10-year real returns below the ~6% historical average; quality bias is prudent`
    : `At ${cv.toFixed(1)}× — near long-run average; forward return expectations are more normal`;
  const capeC = cv == null ? '#94a3b8' : cv > 35 ? '#ef4444' : cv > 25 ? '#f59e0b' : '#22c55e';
  const sts = rows.slice(0, 3).map(r => r ? r[3] : null).filter(Boolean);
  const allBear = sts.length > 0 && sts.every(s => s === 'bearish');
  const allBull = sts.length > 0 && sts.every(s => s === 'bullish');
  const cons = allBear ? 'All Three Signals Bearish — valuation risk is broad-based; multiples are uniformly elevated'
    : allBull ? 'All Three Signals Constructive — valuation metrics near average; near-normal expected returns'
    : 'Mixed Signals — weight CAPE and Buffett Indicator over Trailing P/E for long-run return outlook';
  return [
    { label: 'Trailing P/E (S&P 500)', a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'CAPE (Shiller)',          a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'Buffett Indicator',       a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'Japan vs US Valuation',   a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'CAPE Return Implication', a: capeImpl,          c: capeC },
    { label: 'Signal Consistency',      a: cons, c: allBear ? '#ef4444' : allBull ? '#22c55e' : '#f59e0b' },
  ];
}
function buildYieldDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const y30 = r0 ? parseFloat(r0[1]) : null;
  const thresh = y30 == null ? '—'
    : y30 >= 5 ? `${y30.toFixed(2)}% — ABOVE the 5% critical level; equity multiple compression historically confirmed`
    : y30 > 4.5 ? `${y30.toFixed(2)}% — approaching 5%; elevated but not yet at the critical threshold`
    : `${y30.toFixed(2)}% — below 5%; long-duration assets and growth equities are supported`;
  const threshC = y30 == null ? '#94a3b8' : y30 >= 5 ? '#ef4444' : y30 > 4.5 ? '#f59e0b' : '#22c55e';
  const actionA = r0 && r2
    ? (r0[3]==='bearish'&&r2[3]==='bearish' ? 'Both 30Y yield and curve are bearish — shorten duration aggressively, hold cash, avoid rate-sensitive sectors'
      : r0[3]==='bullish'&&r2[3]==='bullish' ? 'Both 30Y yield and curve are constructive — maintain equity and bond exposure; duration is not a drag'
      : 'Mixed signals — reduce new rate-sensitive adds; wait for yield level and curve to align') : '—';
  const actionC = r0 && r2 ? (r0[3]==='bearish'&&r2[3]==='bearish' ? '#ef4444' : r0[3]==='bullish'&&r2[3]==='bullish' ? '#22c55e' : '#f59e0b') : '#94a3b8';
  return [
    { label: '30Y Yield (^TYX)',      a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: '10Y Yield (^TNX)',      a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'Yield Curve (3m–10Y)',  a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: '2Y Trend (SHY)',        a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: '5% Threshold Check',    a: thresh,            c: threshC },
    { label: 'Combined Rate Action',  a: actionA,           c: actionC },
  ];
}
function buildCreditDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const leadA = r0 == null ? '—' : r0[3]==='bearish'
    ? 'Active — HYG is below its 200d SMA; historically leads equity drawdowns by 4–6 weeks'
    : 'Not Active — HYG is above its 200d SMA; no leading credit stress signal at this time';
  const leadC = r0 == null ? '#94a3b8' : r0[3]==='bearish' ? '#ef4444' : '#22c55e';
  const bc = rows.filter(r => r && r[3]==='bullish').length;
  const actionA = bc >= 3 ? 'Credit is broadly constructive — maintain equity and HY exposure; watch HYG as the early warning system'
    : bc >= 2 ? 'Mixed signals — stay selective; favour IG over HY and reduce EM bond duration'
    : 'Credit risk is elevated — reduce HY exposure, shorten duration, shift toward IG or cash';
  return [
    { label: 'HYG — Risk Appetite',      a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'Spread Signal (HY vs IG)', a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'LQD — Investment Grade',   a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'EMB — EM Debt',            a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'Leading Signal Status',    a: leadA, c: leadC },
    { label: 'Portfolio Action',         a: actionA, c: bc >= 3 ? '#22c55e' : bc >= 2 ? '#f59e0b' : '#ef4444' },
  ];
}
function buildGlobalFlowsDiagnostics(card) {
  const rows = card.rows || [];
  const byR = (lbl) => rows.find(r => (r[0]||'').toLowerCase() === lbl.toLowerCase());
  const rG = byR('Global'), rU = byR('USA'), rE = byR('Europe'), rEm = byR('Emerging');
  const bc = rows.filter(r => r[3]==='bullish').length;
  const usVs = rU ? (rU[3]==='bullish'
    ? 'US is above its 200d SMA — domestic leadership intact; a US-first allocation bias is justified until international breadth improves'
    : 'US is below its 200d SMA — domestic leadership broken; consider reallocating toward regions still above their 200d SMA') : '—';
  const globalAct = bc >= 6 ? 'Broad global expansion — maintain full international allocation; equal-weight regional exposure'
    : bc >= 4 ? 'Partial expansion — favour the strongest regions; underweight those below their 200d SMA'
    : bc >= 2 ? 'Global weakness — raise cash and shift toward the few regions with intact trends'
    : 'Broad global weakness — underweight international equity; favour domestic or cash';
  return [
    { label: 'ACWI — Global Benchmark', a: rG  ? rG[2]  : '—', c: rG  ? _tc(rG[3])  : '#94a3b8' },
    { label: 'USA (S&P 500)',            a: rU  ? rU[2]  : '—', c: rU  ? _tc(rU[3])  : '#94a3b8' },
    { label: 'Europe (Euro STOXX)',      a: rE  ? rE[2]  : '—', c: rE  ? _tc(rE[3])  : '#94a3b8' },
    { label: 'Emerging Markets (EEM)',   a: rEm ? rEm[2] : '—', c: rEm ? _tc(rEm[3]) : '#94a3b8' },
    { label: 'US vs International',      a: usVs, c: rU ? _tc(rU[3]) : '#94a3b8' },
    { label: 'Global Allocation Action', a: globalAct, c: bc >= 6 ? '#22c55e' : bc >= 4 ? '#f59e0b' : '#ef4444' },
  ];
}
function buildSectorsDiagnostics(card) {
  const rows = card.rows || [], stats = card.stats || [];
  const sCyc = stats.find(s => (s[0]||'').toLowerCase().includes('cyclical vs') || (s[0]||'').toLowerCase().includes('cyc vs'));
  const sCycs = stats.find(s => (s[0]||'').toLowerCase() === 'cyclicals');
  const sDefs = stats.find(s => (s[0]||'').toLowerCase() === 'defensives');
  const sv = sCyc ? parseFloat(sCyc[1]) : null;
  const rW = rows.filter(r => r[5] != null && r[6] != null);
  const abv = rW.filter(r => r[6] > r[5]).length;
  const tot = rows.length || 11;
  const bA = `${abv} of ${tot} sectors above their 200d SMA — ${abv >= 9 ? 'near-universal participation; regime is broadly supported' : abv >= 7 ? 'broad sector health; rally is well-supported — stay long' : abv >= 5 ? 'mixed participation; rally narrowing — concentrate in leaders' : abv >= 3 ? 'thin breadth; most sectors below trend — defensive posture warranted' : 'sector breakdown — raise cash and wait for breadth to recover'}`;
  const bC = abv >= 7 ? '#22c55e' : abv >= 5 ? '#f59e0b' : '#ef4444';
  const cyP = sCycs ? sCycs[1].split('/') : null;
  const cyB = cyP ? parseInt(cyP[0].trim()) : null, cyT = cyP ? parseInt(cyP[1].trim()) : 7;
  const cyC = sCycs ? (sCycs[3]==='pos' ? '#22c55e' : sCycs[3]==='neg' ? '#ef4444' : '#f59e0b') : '#94a3b8';
  const cyA = cyB == null ? '—' : `${cyB} of ${cyT} cyclical sectors above 200d SMA — ${cyB >= 6 ? 'broad cyclical strength; overweight with high conviction' : cyB >= 4 ? 'majority in trend; selective cyclical exposure is warranted' : cyB === 3 ? 'mixed cyclical breadth; pick individual leaders only' : 'cyclicals breaking down; avoid broad cyclical ETFs'}`;
  const deP = sDefs ? sDefs[1].split('/') : null;
  const deB = deP ? parseInt(deP[0].trim()) : null, deT = deP ? parseInt(deP[1].trim()) : 4;
  const deC = sDefs ? (sDefs[3]==='pos' ? '#22c55e' : sDefs[3]==='neg' ? '#ef4444' : '#f59e0b') : '#94a3b8';
  const deA = deB == null ? '—' : `${deB} of ${deT} defensive sectors above 200d SMA — ${deB >= 4 ? 'full safe-haven bid; risk-off tilt is warranted' : deB === 3 ? 'strong defensive bid; lean defensive until cyclicals recapture 200d' : deB === 2 ? 'mixed defensive posture; stay balanced' : 'defensives not in trend; no safe-haven demand — risk-on supported'}`;
  const top3 = rows.slice(0, 3);
  const ldA = top3.length ? top3.map(r => `${r[0]} (${r[4] || '—'}): ${r[2]}`).join(' · ') : '—';
  const stCyc = cyB != null && cyB >= 5, stDef = deB != null && deB >= 3;
  const acA = sv == null ? '—' : sv > 3 && stCyc ? 'Strong Risk-On — overweight cyclicals; reduce defensives to minimum' : sv > 1 ? 'Risk-On Lean — favor cyclicals outpacing SPY; hold diversified core' : sv < -3 && stDef ? 'Strong Risk-Off — shift to defensives; reduce cyclicals; raise cash' : sv < -1 ? 'Defensive Lean — reduce cyclical overweight; let defensives anchor portfolio' : 'Neutral — no dominant rotation signal; stay diversified';
  return [
    { label: 'Rotation Signal',   a: sv == null ? '—' : `${(sv >= 0 ? '+' : '') + sv.toFixed(1)}% cyclical vs defensive spread — ${sv > 1 ? 'cyclicals leading; risk-on rotation confirmed' : sv < -1 ? 'defensives leading; risk-off rotation confirmed' : 'near parity; no clear rotation signal yet'}`, c: sv == null ? '#94a3b8' : sv > 1 ? '#22c55e' : sv < -1 ? '#ef4444' : '#f59e0b' },
    { label: 'Sector Breadth',    a: bA, c: bC },
    { label: 'Cyclical Health',   a: cyA, c: cyC },
    { label: 'Defensive Posture', a: deA, c: deC },
    { label: 'Sector Leaders',    a: ldA, c: '#22c55e' },
    { label: 'Portfolio Action',  a: acA, c: sv == null ? '#94a3b8' : sv > 1 ? '#22c55e' : sv < -1 ? '#ef4444' : '#f59e0b' },
  ];
}
function buildCommoditiesDiagnostics(card) {
  const rows = card.rows || [], stats = card.stats || [];
  const byL = (l) => rows.find(r => (r[0]||'').toLowerCase() === l.toLowerCase());
  const rCu = byL('Copper'), rAu = byL('Gold'), rEn = byL('Energy'), rAg = byL('Agriculture');
  const sBull = stats.find(s => (s[0]||'').toLowerCase().includes('bull'));
  const bc = sBull ? parseInt(sBull[1]) : rows.filter(r => r[3]==='bullish').length;
  const cgA = rCu && rAu
    ? (rCu[3]==='bullish'&&rAu[3]!=='bullish' ? 'Copper leading gold — industrial demand exceeds safe-haven demand; risk-on regime confirmed'
      : rAu[3]==='bullish'&&rCu[3]!=='bullish' ? 'Gold leading copper — safe-haven demand exceeds industrial growth; risk-off tilt warranted'
      : rCu[3]==='bullish'&&rAu[3]==='bullish' ? 'Both above 200d — growth and uncertainty simultaneously elevated; stagflation environment'
      : 'Both below 200d — neither growth nor safety is bid; cautious positioning appropriate') : '—';
  const cgC = rCu && rAu ? (rCu[3]==='bullish'&&rAu[3]!=='bullish' ? '#22c55e' : rAu[3]==='bullish'&&rCu[3]!=='bullish' ? '#f59e0b' : rCu[3]==='bullish'&&rAu[3]==='bullish' ? '#f59e0b' : '#ef4444') : '#94a3b8';
  const acA = bc >= 6 ? 'Broadly risk-on — overweight copper, energy, and industrial metals'
    : bc >= 4 ? 'Mixed signals — selectively overweight commodity themes above 200d; avoid broad ETF exposure'
    : 'Broadly weak — underweight real assets; wait for copper or energy to reclaim their 200d SMA';
  return [
    { label: 'Copper (CPER)',             a: rCu ? rCu[2] : '—', c: rCu ? _tc(rCu[3]) : '#94a3b8' },
    { label: 'Gold (GLD)',                a: rAu ? rAu[2] : '—', c: rAu ? _tc(rAu[3]) : '#94a3b8' },
    { label: 'Energy (IXC)',              a: rEn ? rEn[2] : '—', c: rEn ? _tc(rEn[3]) : '#94a3b8' },
    { label: 'Agriculture (DBA)',         a: rAg ? rAg[2] : '—', c: rAg ? _tc(rAg[3]) : '#94a3b8' },
    { label: 'Copper vs Gold (Key Read)', a: cgA, c: cgC },
    { label: 'Portfolio Action',          a: acA, c: bc >= 6 ? '#22c55e' : bc >= 4 ? '#f59e0b' : '#ef4444' },
  ];
}
function buildEquitiesDiagnostics(card) {
  const rows = card.rows || [], stats = card.stats || [];
  const bySym = (sym) => rows.find(r => (r[4]||'') === sym);
  const rIwm = bySym('IWM'), rFcx = bySym('FCX'), rGdx = bySym('GDX');
  const sBull = stats.find(s => (s[0]||'').toLowerCase().includes('names'));
  const bc = sBull ? parseInt(sBull[1]) : rows.filter(r => r[3]==='bullish').length;
  const tot = rows.length;
  const execE = bc >= 7 ? 'Favourable — broad participation; execute longs with normal sizing across active themes'
    : bc >= 5 ? 'Selective — majority of themes intact; add only on dips to 50d in names above 200d'
    : bc >= 3 ? 'Cautious — fewer than half the themes intact; hold only high-conviction names with tight stops'
    : 'Unfavourable — most names below their MAs; stand aside and wait for MA recapture';
  const execC = bc >= 7 ? '#22c55e' : bc >= 5 ? '#f59e0b' : '#ef4444';
  const riskA = rIwm && rFcx
    ? (rIwm[3]==='bullish'&&rFcx[3]==='bullish' ? 'High — small caps and copper both active; risk appetite is broad and global growth is confirmed'
      : (rIwm[3]==='bullish'||rFcx[3]==='bullish') ? 'Moderate — one of the two growth signals is intact; selective exposure is appropriate'
      : 'Low — IWM and FCX both below 200d; risk appetite is closed; stand aside until both recover') : '—';
  const riskC = rIwm && rFcx ? (rIwm[3]==='bullish'&&rFcx[3]==='bullish' ? '#22c55e' : (rIwm[3]==='bullish'||rFcx[3]==='bullish') ? '#f59e0b' : '#ef4444') : '#94a3b8';
  return [
    { label: 'Russell 2000 (IWM)',    a: rIwm ? rIwm[2] : '—', c: rIwm ? _tc(rIwm[3]) : '#94a3b8' },
    { label: 'Freeport (FCX)',        a: rFcx ? rFcx[2] : '—', c: rFcx ? _tc(rFcx[3]) : '#94a3b8' },
    { label: 'Gold Miners (GDX)',     a: rGdx ? rGdx[2] : '—', c: rGdx ? _tc(rGdx[3]) : '#94a3b8' },
    { label: 'Watchlist Health',      a: `${bc} / ${tot} names above both MAs`, c: execC },
    { label: 'Execution Environment', a: execE, c: execC },
    { label: 'Risk Appetite Check',   a: riskA, c: riskC },
  ];
}
function buildCurrencyDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const crA = r2 == null ? '—' : r2[3]==='bearish'
    ? 'Active — FXY has risen sharply above its 200d SMA; prior carry-unwind episodes (Aug 2024, 2022) triggered equity de-risking within days'
    : 'Not Active — FXY is below its 200d spike threshold; carry trade is intact, no emergency hedging required';
  const crC = r2 == null ? '#94a3b8' : r2[3]==='bearish' ? '#ef4444' : '#22c55e';
  const bc = rows.filter(r => r && r[3]==='bullish').length;
  const beC = rows.filter(r => r && r[3]==='bearish').length;
  const cBear = r2 && r2[3]==='bearish';
  const acA = cBear ? 'Carry unwind risk is active — reduce risk assets and leveraged positions immediately; rotate to cash and defensives'
    : bc >= 2 ? 'FX conditions are supportive — maintain equity and EM exposure; USD weakness is a macro tailwind'
    : beC >= 2 ? 'FX headwinds are building — reduce EM and international exposure; favour USD cash and domestic large-caps'
    : 'FX signals are mixed — no dominant directional pressure; follow earnings and sector rotation';
  return [
    { label: 'USD Trend (UUP)',   a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'EUR/USD (FXE)',     a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'JPY Carry (FXY)',   a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'FX Regime',        a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'Carry Risk Status', a: crA, c: crC },
    { label: 'Portfolio Action',  a: acA, c: cBear ? '#ef4444' : bc >= 2 ? '#22c55e' : beC >= 2 ? '#ef4444' : '#f59e0b' },
  ];
}
function getDiagnostics(cardId, card) {
  switch (cardId) {
    case 'regime':      return buildRegimeDiagnostics(card);
    case 'leadership':  return buildLeadershipDiagnostics(card);
    case 'breadth':     return buildBreadthDiagnostics(card);
    case 'valuations':  return buildValuationsDiagnostics(card);
    case 'yield':       return buildYieldDiagnostics(card);
    case 'credit':      return buildCreditDiagnostics(card);
    case 'globalflows': return buildGlobalFlowsDiagnostics(card);
    case 'sectors':     return buildSectorsDiagnostics(card);
    case 'commodities': return buildCommoditiesDiagnostics(card);
    case 'equities':    return buildEquitiesDiagnostics(card);
    case 'currency':    return buildCurrencyDiagnostics(card);
    default:            return null;
  }
}
function DiagnosticsSection({ cardId, card }) {
  const items = getDiagnostics(cardId, card);
  if (cardId === 'crowdsignals') return null;
  return (
    <div>
      <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 8 }}>Market Diagnostics</div>
      {items && items.length > 0 ? (
        <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '2px 14px' }}>
          {items.map((item, i) => (
            <div key={i} style={{ padding: '12px 0', borderBottom: i < items.length - 1 ? '1px solid #16202e' : 'none' }}>
              <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: item.c, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: SANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{item.a}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '14px' }}>
          <span style={{ fontFamily: SANS, fontSize: 12, color: '#64748b' }}>—</span>
        </div>
      )}
    </div>
  );
}

// ── Seeded sparkline ──────────────────────────────────────────────────────────
function Spark({ seed, trend, color, w = 64, h = 24 }) {
  const pts = [];
  let v = 0.5, s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const N = 22;
  for (let i = 0; i < N; i++) { v += (rnd() - 0.5) * 0.22 + trend * 0.018; v = Math.max(0.08, Math.min(0.92, v)); pts.push(v); }
  const dx = w / (N - 1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * dx).toFixed(1)},${(h - p * h).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = `g${seed}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Hero breadth ring ─────────────────────────────────────────────────────────
function HeroGauge({ exec }) {
  const total = exec.bull + exec.neutral + exec.bear;
  const color = postureColor(exec.label);
  const R = 78, C = 2 * Math.PI * R, gap = 7;
  const segDefs = [['bullish', exec.bull], ['neutral', exec.neutral], ['bearish', exec.bear]].filter((s) => s[1] > 0);
  let acc = 0;
  const arcs = segDefs.map(([k, n]) => { const len = (n / total) * C; const off = acc; acc += len; return { k, len, off, c: SIG[k].c, glow: SIG[k].glow }; });
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 120); return () => clearTimeout(t); }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 4px' }}>
      <div style={{ position: 'relative', width: 196, height: 196 }}>
        <div style={{ position: 'absolute', inset: 18, borderRadius: '50%', boxShadow: `0 0 56px ${color}44`, opacity: mounted ? 1 : 0, transition: 'opacity 1s ease' }} />
        <svg width="196" height="196" viewBox="0 0 196 196" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="98" cy="98" r={R} fill="none" stroke="#16202e" strokeWidth="10" />
          {arcs.map((a) => (
            <circle key={a.k} cx="98" cy="98" r={R} fill="none" stroke={a.c} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${Math.max(mounted ? a.len - gap : 0, 0)} ${C}`} strokeDashoffset={-(a.off + gap / 2)}
              style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.22,.61,.36,1)', filter: `drop-shadow(0 0 4px ${a.glow})` }} />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, color: '#e8edf5', letterSpacing: '-0.02em', lineHeight: 1 }}>
            <span style={{ fontSize: 46 }}>{total > 0 ? Math.round((exec.bull + exec.neutral * 0.5) / total * 100) : 0}</span><span style={{ fontSize: 22, color: '#8295a9' }}>%</span>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 11, color: '#64748b', marginTop: 5, letterSpacing: '.06em', textTransform: 'uppercase' }}>bullish</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ fontFamily: SANS, fontSize: 19, fontWeight: 700, color: '#e8edf5', letterSpacing: '0.01em' }}>{exec.label}</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: '#94a3b8', marginTop: 5, textAlign: 'center', maxWidth: 260, lineHeight: 1.45 }}>{exec.posture}</div>
      <div style={{ display: 'flex', gap: 7, marginTop: 14 }}>
        {[['bullish', exec.bull], ['neutral', exec.neutral], ['bearish', exec.bear]].map(([k, n]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 8, background: SIG[k].fill, border: `1px solid ${SIG[k].line}` }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: SIG[k].c }} />
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: SIG[k].c }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Category breadth dots ─────────────────────────────────────────────────────
// ── Three-horizon hero (mobile) ──────────────────────────────────────────────
function hzColor(score) { return score >= 7 ? '#22c55e' : score >= 4 ? '#f59e0b' : '#ef4444'; }
function hzZoneColor(zone) { return zone === 'green' ? '#22c55e' : zone === 'amber' ? '#f59e0b' : '#ef4444'; }

function MobileDial({ title, horizon, score, level, trigger, veto, vixRatio, isAnchor, sizePct, note, zone }) {
  const c = isAnchor ? hzZoneColor(zone) : hzColor(score);
  const w = Math.max(0, Math.min(100, score * 10));
  return (
    <div style={{ background: '#0a1119', border: '1px solid #1e2d3d', borderRadius: 14, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 700, color: '#e8edf5' }}>{title}</span>
        <span style={{ fontFamily: SANS, fontSize: 10.5, color: '#64748b', letterSpacing: '.04em' }}>{horizon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 32, fontWeight: 700, color: c, lineHeight: 1 }}>{score.toFixed(1)}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: '#64748b', marginBottom: 3 }}>/10</span>
        <span style={{ marginLeft: 'auto', fontFamily: isAnchor ? MONO : SANS, fontSize: isAnchor ? 12 : 10, fontWeight: 700, letterSpacing: isAnchor ? '0' : '.06em', textTransform: isAnchor ? 'none' : 'uppercase', color: c, border: `1px solid ${c}55`, borderRadius: 6, padding: isAnchor ? '3px 8px' : '2px 7px' }}>{isAnchor ? `SIZE ${sizePct}%` : level}</span>
      </div>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: isAnchor ? 'transparent' : '#16202e', overflow: 'visible' }}>
        {isAnchor
          ? <React.Fragment>
              <div style={{ position: 'absolute', inset: 0, borderRadius: 3, background: 'linear-gradient(90deg,#ef4444 0%,#f59e0b 45%,#22c55e 100%)', opacity: .28 }} />
              <div style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${w}% - 1px)`, width: 2, background: c, boxShadow: `0 0 6px ${c}` }} />
            </React.Fragment>
          : <React.Fragment>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${w}%`, background: c, boxShadow: `0 0 8px ${c}88`, borderRadius: 3 }} />
              <div style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${w}% - 1px)`, width: 2, background: '#e8edf5', boxShadow: `0 0 6px ${c}` }} />
            </React.Fragment>
        }
      </div>
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>{isAnchor ? note : trigger}</span>
      {veto && <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: '#ef4444' }}>⚠ VIX BACKWARDATION{vixRatio != null ? ` (${vixRatio})` : ''} — TACTICAL CAPPED</span>}
    </div>
  );
}

function MobileMatrix({ matrix }) {
  const QMETA = {
    'add-risk':   { label: 'Add Risk',   color: '#22c55e' },
    'bear-rally': { label: 'Bear Rally', color: '#f59e0b' },
    'accumulate': { label: 'Accumulate', color: '#60a5fa' },
    'risk-off':   { label: 'Risk-Off',   color: '#ef4444' },
  };
  const rows = [['add-risk', 'bear-rally'], ['accumulate', 'risk-off']];
  const cell = (q) => {
    const active = q === matrix.quadrant, m = QMETA[q];
    return (
      <div key={q} style={{ background: active ? `${m.color}1a` : '#0a1119', border: `1px solid ${active ? m.color : '#1e2d3d'}`, borderRadius: 10, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 46, justifyContent: 'center', boxShadow: active ? `0 0 14px ${m.color}33` : 'none' }}>
        <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: active ? m.color : '#64748b' }}>{m.label}</span>
        {active && <span style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: m.color }}>◄ CURRENT</span>}
      </div>
    );
  };
  const colHead = (t) => <span style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#475569', textAlign: 'center' }}>{t}</span>;
  const rowHead = (t) => <span style={{ fontFamily: SANS, fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#475569', writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', alignSelf: 'center' }}>{t}</span>;
  return (
    <div style={{ background: '#0a1119', border: '1px solid #1e2d3d', borderRadius: 14, padding: '13px 15px' }}>
      <div style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 11 }}>Speedometer × Compass</div>
      <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 1fr', gridTemplateRows: 'auto auto auto', gap: 5, alignItems: 'stretch' }}>
        <div />{colHead('Cmp High')}{colHead('Cmp Low')}
        {rowHead('Spd High')}{cell(rows[0][0])}{cell(rows[0][1])}
        {rowHead('Spd Low')}{cell(rows[1][0])}{cell(rows[1][1])}
      </div>
      <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid #16202e', fontFamily: SANS, fontSize: 12, color: '#cbd5e1', lineHeight: 1.45 }}>
        <span style={{ color: QMETA[matrix.quadrant].color, fontWeight: 700 }}>{matrix.label}: </span>{matrix.guidance}
        {` Size any positions at ${Math.round((matrix.sizingFactor ?? 1) * 100)}% of normal.`}
      </div>
    </div>
  );
}

function HorizonHeroMobile({ horizons, exec }) {
  if (!horizons) return null;
  const { speedometer: s, compass: c, anchor: a, matrix: m } = horizons;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8' }}>Three Horizons</span>
        <div style={{ flex: 1, height: 1, background: '#1e2d3d' }} />
        <span style={{ fontFamily: SANS, fontSize: 10, color: '#64748b' }}>tactical · trend · structural</span>
      </div>
      <MobileDial title="Tactical Speedometer" horizon={s.horizon || '2–3 wk'} score={s.score} level={s.level} trigger={s.trigger} veto={s.veto} vixRatio={s.vixRatio} />
      <MobileDial title="Trend Compass" horizon={c.horizon || '2–3 mo'} score={c.score} level={c.level} trigger={c.trigger} />
      <MobileDial title="Macro Anchor" horizon={a.horizon || '2–3 yr'} score={a.score} isAnchor zone={a.zone} sizePct={Math.round((a.sizingFactor ?? 1) * 100)} note={a.note} />
      <MobileMatrix matrix={m} />
      {exec && exec.regimeBearish && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: '#1a1200', border: '1px solid #2d1a00', borderRadius: 10 }}>
          <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em', flexShrink: 0 }}>⚠ REGIME</span>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>SPY below its 200-day SMA — primary trend bearish. Size positions accordingly.</span>
        </div>
      )}
    </div>
  );
}

function CategoryBreadth({ cats }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13, padding: '4px 4px 0' }}>
      {cats.map((c) => {
        const bull = c.cards.filter((s) => s === 'bullish').length;
        return (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 126, flexShrink: 0, fontFamily: SANS, fontSize: 12, color: '#cbd5e1', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
            <div style={{ flex: 1, display: 'flex', gap: 7, alignItems: 'center', paddingLeft: 6 }}>
              {c.cards.map((s, i) => (
                <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: SIG[s].c, boxShadow: `0 0 7px ${SIG[s].glow}` }} />
              ))}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{bull}/{c.cards.length}<span style={{ color: '#8295a9' }}> bull</span></span>
          </div>
        );
      })}
    </div>
  );
}

// ── Structural card row (regime, leadership, … equities, crowdsignals) ────────
function CardRow({ card, onTap }) {
  const sig = SIG[card.status] || SIG.neutral;
  const [press, setPress] = useState(false);
  const kpis = card.rows.slice(0, 3);
  return (
    <button onClick={onTap} onPointerDown={() => setPress(true)} onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 11, padding: '12px 14px',
        borderRadius: 14, background: '#111827', border: '1px solid #1e2d3d',
        boxShadow: press ? 'none' : '0 1px 2px rgba(0,0,0,.3)', transform: press ? 'scale(0.99)' : 'scale(1)',
        transition: 'transform .12s ease', borderLeft: `3px solid ${sig.c}`, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, color: '#e8edf5', flex: 1, minWidth: 0 }}>{card.title}</span>
        <svg width="7" height="12" viewBox="0 0 7 12" style={{ flexShrink: 0 }}><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {kpis.map((r, i) => {
          const rs = SIG[r[3]] || SIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, paddingLeft: i ? 9 : 0, borderLeft: i ? '1px solid #1b2736' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{r[1]}</span>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 9.5, color: '#64748b', marginTop: 3, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[0]}</div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

// ── Yield card row — 3rd KPI is live 2Y from /api/treasury-2y (matches Desktop) ──
function YieldCardRow({ card, onTap }) {
  const sig = SIG[card.status] || SIG.neutral;
  const [press, setPress] = useState(false);
  const [twoY, setTwoY] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/treasury-2y?range=20d').then(r => r.json()).then(d => {
      if (!alive) return;
      const c = (d.closes || []).map(v => v == null ? null : Number(v)).filter(v => v != null && !isNaN(v));
      if (c.length) setTwoY(c[c.length - 1]);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1];
  const twoYTone = twoY != null ? (twoY >= 4.5 ? 'bearish' : twoY >= 3.5 ? 'neutral' : 'bullish') : 'neutral';
  const kpis = [
    r0 ? { label: r0[0], val: r0[1].split('\n')[0], tone: r0[3] } : { label: '30Y Yield', val: '—', tone: 'neutral' },
    r1 ? { label: r1[0], val: r1[1].split('\n')[0], tone: r1[3] } : { label: '10Y Yield', val: '—', tone: 'neutral' },
    { label: '2Y Yield', val: twoY != null ? twoY.toFixed(2) + '%' : '—', tone: twoYTone },
  ];
  return (
    <button onClick={onTap} onPointerDown={() => setPress(true)} onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 11, padding: '12px 14px',
        borderRadius: 14, background: '#111827', border: '1px solid #1e2d3d',
        boxShadow: press ? 'none' : '0 1px 2px rgba(0,0,0,.3)', transform: press ? 'scale(0.99)' : 'scale(1)',
        transition: 'transform .12s ease', borderLeft: `3px solid ${sig.c}`, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, color: '#e8edf5', flex: 1, minWidth: 0 }}>{card.title}</span>
        <svg width="7" height="12" viewBox="0 0 7 12" style={{ flexShrink: 0 }}><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {kpis.map(({ label, val, tone }, i) => {
          const rs = SIG[tone] || SIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, paddingLeft: i ? 9 : 0, borderLeft: i ? '1px solid #1b2736' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 9.5, color: '#64748b', marginTop: 3, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

// ── Crowd Signals card row — live Fed Action / CPI / Rate from /api/kalshi ───
function CrowdSignalsCardRow({ card, onTap }) {
  const sig = SIG[card.status] || SIG.neutral;
  const [press, setPress] = useState(false);
  const [kpis, setKpis] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/kalshi').then(r => r.json()).catch(() => ({ events: [] }))
      .then(k => {
        if (!alive) return;
        const fomc = (k.events || []).find(e => e.type === 'fomc');
        const cpi  = (k.events || []).find(e => e.type === 'cpi');
        const actionTone = fomc?.action === 'Cut' ? 'bullish' : fomc?.action === 'Hike' ? 'bearish' : 'neutral';
        const cpiVal  = cpi ? parseFloat((cpi.consensus || '').replace(/[~%]/g, '')) : null;
        const cpiTone = cpiVal == null ? 'neutral' : cpiVal <= 0 ? 'bullish' : cpiVal > 0.2 ? 'bearish' : 'neutral';
        setKpis([
          { label: 'Fed Action',  val: fomc?.action    || '—', tone: actionTone },
          { label: 'CPI Crowd',   val: cpi?.consensus  || '—', tone: cpiTone    },
          { label: 'Rate Target', val: fomc?.consensus || '—', tone: actionTone },
        ]);
      });
    return () => { alive = false; };
  }, []);
  const items = kpis || [
    { label: 'Fed Action',  val: '—', tone: 'neutral' },
    { label: 'CPI Crowd',   val: '—', tone: 'neutral' },
    { label: 'Rate Target', val: '—', tone: 'neutral' },
  ];
  return (
    <button onClick={onTap} onPointerDown={() => setPress(true)} onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 11, padding: '12px 14px',
        borderRadius: 14, background: '#111827', border: '1px solid #1e2d3d',
        boxShadow: press ? 'none' : '0 1px 2px rgba(0,0,0,.3)', transform: press ? 'scale(0.99)' : 'scale(1)',
        transition: 'transform .12s ease', borderLeft: `3px solid ${sig.c}`, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, color: '#e8edf5', flex: 1, minWidth: 0 }}>{card.title}</span>
        <svg width="7" height="12" viewBox="0 0 7 12" style={{ flexShrink: 0 }}><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {items.map(({ label, val, tone }, i) => {
          const rs = SIG[tone] || SIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, paddingLeft: i ? 9 : 0, borderLeft: i ? '1px solid #1b2736' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 9.5, color: '#64748b', marginTop: 3, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            </div>
          );
        })}
      </div>
    </button>
  );
}

// ── Daily Brief card row ──────────────────────────────────────────────────────
function DailyBriefRow({ brief, onTap }) {
  const [press, setPress] = useState(false);
  const sc = brief
    ? sentimentColor(brief.isWeekly ? (brief.avgSentiment ?? 0) : (brief.sentiment ?? 0))
    : '#475569';
  const title     = !brief ? 'Daily Brief' : brief.isWeekly ? 'Weekly Brief' : 'Daily Brief';
  const dateLabel = !brief ? 'Loading…'
    : brief.isWeekly ? brief.weekLabel
    : new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const preview = brief?.isWeekly
    ? brief.briefs?.[0]?.bullets?.[0]
    : brief?.bullets?.[0];
  return (
    <button onClick={onTap} onPointerDown={() => setPress(true)} onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 9, padding: '12px 14px',
        borderRadius: 14, background: '#111827', border: '1px solid #1e2d3d',
        transform: press ? 'scale(0.99)' : 'scale(1)', transition: 'transform .12s ease',
        borderLeft: `3px solid ${sc}`, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, color: '#e8edf5' }}>{title}</div>
          <div style={{ fontFamily: SANS, fontSize: 10.5, color: '#64748b', marginTop: 2 }}>{dateLabel} · Briefing.com</div>
        </div>
        <svg width="7" height="12" viewBox="0 0 7 12" style={{ flexShrink: 0 }}><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      {preview && (
        <p style={{ fontFamily: SANS, fontSize: 12.5, color: '#94a3b8', margin: 0, lineHeight: 1.5,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {preview}
        </p>
      )}
      {!brief && <span style={{ fontFamily: SANS, fontSize: 12, color: '#475569' }}>Close Update loads after market close</span>}
    </button>
  );
}

// ── Macro Brief card row ──────────────────────────────────────────────────────
function MacroBriefRow({ brief, loading, onTap }) {
  const [press, setPress] = useState(false);
  const dateLabel = brief?.isWeekly ? brief.weekLabel
    : brief?.date ? new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Claude · Haiku';
  const preview = brief?.narrative
    ? brief.narrative.slice(0, 130) + (brief.narrative.length > 130 ? '…' : '')
    : null;
  return (
    <button onClick={onTap} onPointerDown={() => setPress(true)} onPointerUp={() => setPress(false)} onPointerLeave={() => setPress(false)}
      style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 9, padding: '12px 14px',
        borderRadius: 14, background: '#111827', border: '1px solid #1e2d3d',
        transform: press ? 'scale(0.99)' : 'scale(1)', transition: 'transform .12s ease',
        borderLeft: `3px solid ${brief ? '#60a5fa' : '#1e2d3d'}`, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SANS, fontSize: 14.5, fontWeight: 600, color: '#e8edf5' }}>Macro Brief</div>
          <div style={{ fontFamily: SANS, fontSize: 10.5, color: '#64748b', marginTop: 2 }}>{dateLabel}</div>
        </div>
        <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, color: '#60a5fa', padding: '2px 7px', borderRadius: 4, background: '#0d1e35', border: '1px solid #1a3a5c', flexShrink: 0 }}>✦</span>
        <svg width="7" height="12" viewBox="0 0 7 12" style={{ flexShrink: 0 }}><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      {loading && <span style={{ fontFamily: SANS, fontSize: 12, color: '#475569' }}>Synthesizing…</span>}
      {!loading && !brief && <span style={{ fontFamily: SANS, fontSize: 12, color: '#475569' }}>Unavailable — updates after market close</span>}
      {preview && <p style={{ fontFamily: SANS, fontSize: 12.5, color: '#94a3b8', margin: 0, lineHeight: 1.5,
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{preview}</p>}
    </button>
  );
}

// ── Deep-dive chart with range toggle ─────────────────────────────────────────
function DeepChart({ card, cardId, color }) {
  const ranges = ['1M', '3M', '6M', '1Y', '5Y'];
  const [range, setRange] = useState('1Y');
  const [live, setLive] = useState(null);
  useEffect(() => {
    let alive = true;
    setLive(null);
    if (window.MarketHubData && cardId) {
      window.MarketHubData.loadHistory(cardId, range)
        .then((r) => { if (alive && r && r.values.length > 1) setLive(r); });
    }
    return () => { alive = false; };
  }, [cardId, range]);
  const W = 332, H = 150, top = 10, bot = 22;
  const conf = { '1M': [24, 0.16], '3M': [40, 0.135], '6M': [52, 0.115], '1Y': [60, 0.10], '5Y': [60, 0.08] };
  let arr;
  if (live && live.values.length > 1) {
    const vals = live.values, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    arr = vals.map((x) => 0.08 + ((x - lo) / span) * 0.85);
  } else {
    const [n0, vol] = conf[range];
    let s = card.seed * 9301 + 49297 + range.length * 1733;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    let v = 0.4; arr = [];
    for (let i = 0; i < n0; i++) { v += (rnd() - 0.5) * vol + card.trend * 0.013; v = Math.max(0.08, Math.min(0.93, v)); arr.push(v); }
  }
  const n = arr.length;
  const dx = W / (n - 1), yy = (p) => top + (1 - p) * (H - top - bot);
  const line = arr.map((p, i) => `${i ? 'L' : 'M'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H - bot} L0,${H - bot} Z`;
  const id = `dc${card.seed}`;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.3" /><stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient></defs>
        {[0.25, 0.5, 0.75].map((g) => (<line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="3 4" />))}
        <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={(n - 1) * dx} cy={yy(arr[n - 1])} r="3.5" fill={color} />
        <circle cx={(n - 1) * dx} cy={yy(arr[n - 1])} r="6.5" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        {ranges.map((r) => (
          <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 8,
            fontFamily: MONO, fontSize: 12, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
            background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: live ? '#22c55e' : '#64748b', boxShadow: live ? '0 0 6px #22c55e' : 'none' }} />
        <span style={{ fontFamily: SANS, fontSize: 10, color: '#8295a9' }}>{live ? 'Live data' : 'Sample data'}</span>
      </div>
    </div>
  );
}

// ── Error boundary for diagnostics ───────────────────────────────────────────
class DiagBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e ? (e.message || String(e)) : 'unknown' }; }
  render() {
    if (this.state.err) return (
      <div style={{ background: '#1a0a0a', border: '1px solid #ef4444', borderRadius: 12, padding: '10px 14px', fontFamily: MONO, fontSize: 11, color: '#ef4444', wordBreak: 'break-all' }}>
        Diagnostics error: {this.state.err}
      </div>
    );
    return this.props.children;
  }
}

// ── Structural card deep-dive — shared content from desktop-parts.jsx ─────────
function DeepDive({ card, cardId, onBack }) {
  const sig = SIG[card.status] || SIG.neutral;
  const SharedContent = window.DeepDiveContent;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#080c14', display: 'flex', flexDirection: 'column' }}>
      <div style={{ paddingTop: 54, background: 'linear-gradient(#080c14 80%, rgba(8,12,20,0))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 14px 12px' }}>
          <button onClick={onBack} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: '#0d1520', border: '1px solid #1e2d3d' }}>
            <svg width="9" height="15" viewBox="0 0 9 15"><path d="M7.5 1L1.5 7.5l6 6.5" stroke="#94a3b8" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: sig.c, boxShadow: `0 0 8px ${sig.c}` }} />
          <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: '#e8edf5' }}>{card.title}</span>
          <div style={{ marginLeft: 'auto', display: 'inline-flex', padding: '4px 10px', borderRadius: 6, background: sig.fill, border: `1px solid ${sig.line}` }}>
            <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: sig.c }}>{sig.word}</span>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px calc(34px + 22px)' }}>
        {SharedContent && <SharedContent card={card} cardId={cardId} />}
      </div>
    </div>
  );
}

// ── Daily Brief deep-dive ─────────────────────────────────────────────────────
function DailyBriefDive({ brief, onBack }) {
  const BackBtn = () => (
    <button onClick={onBack} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: '#0d1520', border: '1px solid #1e2d3d' }}>
      <svg width="9" height="15" viewBox="0 0 9 15"><path d="M7.5 1L1.5 7.5l6 6.5" stroke="#94a3b8" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
  if (!brief) {
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#080c14', display: 'flex', flexDirection: 'column' }}>
        <div style={{ paddingTop: 54 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 14px 12px' }}>
            <BackBtn />
            <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: '#e8edf5' }}>Daily Brief</span>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: SANS, fontSize: 13, color: '#475569' }}>Loading…</span>
        </div>
      </div>
    );
  }
  const sc = sentimentColor(brief.isWeekly ? (brief.avgSentiment ?? 0) : (brief.sentiment ?? 0));
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#080c14', display: 'flex', flexDirection: 'column' }}>
      <div style={{ paddingTop: 54, background: 'linear-gradient(#080c14 80%, rgba(8,12,20,0))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 14px 12px' }}>
          <BackBtn />
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: sc, boxShadow: `0 0 8px ${sc}` }} />
          <div>
            <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: '#e8edf5' }}>
              {brief.isWeekly ? 'Weekly Brief' : 'Daily Brief'}
            </div>
            <div style={{ fontFamily: SANS, fontSize: 11, color: '#64748b' }}>
              {brief.isWeekly ? brief.weekLabel
                : new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px calc(34px + 22px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {brief.isWeekly ? brief.briefs.map((d) => {
          const dc = sentimentColor(d.sentiment);
          const dl = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          return (
            <div key={d.date} style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderLeft: `3px solid ${dc}`, borderRadius: 13, padding: '13px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>{dl}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: dc }}>{d.sentiment > 0 ? '+' : ''}{d.sentiment}</span>
                <span style={{ fontFamily: SANS, fontSize: 10, color: '#64748b', padding: '1px 6px', borderRadius: 4, background: '#16202e' }}>{d.sector}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.bullets.map((b, i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: dc, flexShrink: 0, marginTop: 6 }} />
                    <span style={{ fontFamily: SANS, fontSize: 13, color: '#94a3b8', lineHeight: 1.55 }}>{b}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }) : (
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sc}`, borderRadius: 13, padding: '14px 14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {brief.bullets.map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc, flexShrink: 0, marginTop: 6 }} />
                  <span style={{ fontFamily: SANS, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6 }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: '#475569', textAlign: 'center', paddingBottom: 4 }}>
          Source: Briefing.com Close Update
        </div>
      </div>
    </div>
  );
}

// ── Macro Brief deep-dive ─────────────────────────────────────────────────────
function MacroBriefDive({ brief, loading, onBack }) {
  const dateLabel = brief?.isWeekly ? brief.weekLabel
    : brief?.date ? new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#080c14', display: 'flex', flexDirection: 'column' }}>
      <div style={{ paddingTop: 54, background: 'linear-gradient(#080c14 80%, rgba(8,12,20,0))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 14px 12px' }}>
          <button onClick={onBack} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: '#0d1520', border: '1px solid #1e2d3d' }}>
            <svg width="9" height="15" viewBox="0 0 9 15"><path d="M7.5 1L1.5 7.5l6 6.5" stroke="#94a3b8" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#60a5fa', boxShadow: '0 0 8px #60a5fa' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: '#e8edf5' }}>Macro Brief</div>
            {dateLabel && <div style={{ fontFamily: SANS, fontSize: 11, color: '#64748b' }}>{dateLabel}</div>}
          </div>
          <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, color: '#60a5fa', padding: '3px 8px', borderRadius: 5, background: '#0d1e35', border: '1px solid #1a3a5c', flexShrink: 0 }}>✦ CLAUDE</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px calc(34px + 22px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loading && (
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 13, padding: '18px 16px' }}>
            <span style={{ fontFamily: SANS, fontSize: 13, color: '#475569' }}>Synthesizing structural signals with recent market action…</span>
          </div>
        )}
        {!loading && !brief && (
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 13, padding: '18px 16px' }}>
            <span style={{ fontFamily: SANS, fontSize: 13, color: '#475569' }}>Unavailable — synthesis runs after market close when today's brief and scorecard are ready.</span>
          </div>
        )}
        {brief?.narrative && (
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderLeft: '3px solid #60a5fa', borderRadius: 13, padding: '18px 16px' }}>
            <p style={{ fontFamily: SANS, fontSize: 14.5, color: '#94a3b8', lineHeight: 1.72, margin: 0 }}>{brief.narrative}</p>
          </div>
        )}
        {brief?.score && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 12, padding: '11px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: '#e8edf5' }}>{brief.score}/10</div>
              <div style={{ fontFamily: SANS, fontSize: 10, color: '#94a3b8', marginTop: 3 }}>Scorecard</div>
            </div>
            <div style={{ flex: 1, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 12, padding: '11px 12px' }}>
              <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: '#60a5fa' }}>Haiku</div>
              <div style={{ fontFamily: SANS, fontSize: 10, color: '#94a3b8', marginTop: 3 }}>Claude model</div>
            </div>
          </div>
        )}
        <div style={{ fontFamily: SANS, fontSize: 10.5, color: '#475569', textAlign: 'center', paddingBottom: 4 }}>
          Synthesized by Claude Haiku · Briefing.com × Scorecard
        </div>
      </div>
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────
function Home({ D, dailyBrief, macroBrief, macroBriefLoading, onOpen }) {
  const SL = {
    fontFamily: SANS, fontSize: 10, fontWeight: 700,
    letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', paddingLeft: 4,
  };
  return (
    <div style={{ minHeight: '100%', background: '#080c14', paddingTop: 54 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px 12px', position: 'sticky', top: 0, zIndex: 30,
        background: 'linear-gradient(#080c14 70%, rgba(8,12,20,0))' }}>
        <svg width="22" height="19" viewBox="0 0 30 26"><rect x="0" y="14" width="7" height="12" rx="1.5" fill="#ef4444" /><rect x="11.5" y="7" width="7" height="19" rx="1.5" fill="#f59e0b" /><rect x="23" y="0" width="7" height="26" rx="1.5" fill="#22c55e" /></svg>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: '#e8edf5', lineHeight: 1.1 }}>Market Hub</span>
          <span style={{ fontFamily: SANS, fontSize: 10.5, color: '#64748b' }}>Macro Framework</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: '#0d1520', border: '1px solid #1e2d3d' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ fontFamily: MONO, fontSize: 11, color: '#94a3b8' }}>As of {D.asOf}</span>
        </div>
      </div>

      <div style={{ padding: '0 16px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {D.horizons ? <HorizonHeroMobile horizons={D.horizons} exec={D.exec} /> : <HeroGauge exec={D.exec} />}
        <div style={{ height: 1, background: '#16202e' }} />
        <CategoryBreadth cats={D.categories} />
        <div style={{ height: 1, background: '#16202e' }} />

        {/* Structural + Crowd card groups */}
        {D.groups.map((g) => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={SL}>{g.label}</div>
            {g.ids.map((id) => D.cards[id]
              ? id === 'yield'
                ? <YieldCardRow key={id} card={D.cards[id]} onTap={() => onOpen(id)} />
                : id === 'crowdsignals'
                ? <CrowdSignalsCardRow key={id} card={D.cards[id]} onTap={() => onOpen(id)} />
                : <CardRow key={id} card={D.cards[id]} onTap={() => onOpen(id)} />
              : null
            )}
          </div>
        ))}

        {/* Daily Context — Daily Brief + Macro Brief */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={SL}>Daily Context</div>
          <DailyBriefRow brief={dailyBrief} onTap={() => onOpen('dailybrief')} />
          <MacroBriefRow brief={macroBrief} loading={macroBriefLoading} onTap={() => onOpen('macrobrief')} />
        </div>

        {/* Disclaimer */}
        <div style={{ borderTop: '1px solid #16202e', paddingTop: 14 }}>
          <p style={{ fontFamily: SANS, fontSize: 10, color: '#475569', lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: '#64748b', fontWeight: 600 }}>Disclaimer:</strong> Market Hub is for informational and educational purposes only. Nothing on this site constitutes investment advice, a solicitation, or a recommendation to buy or sell any security, commodity, or financial instrument. Market Hub is not a registered investment adviser, broker-dealer, or commodity trading adviser. Data may be delayed, incomplete, or inaccurate — verify independently before acting. Past performance does not guarantee future results. Prediction market probabilities reflect crowd sentiment and are not guaranteed outcomes. Always consult a qualified financial professional before making investment decisions.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
function Glance() {
  const D                              = useGlance();
  const dailyBrief                     = useDailyBrief();
  const { brief: macroBrief, loading: macroBriefLoading } = useMacroBrief();
  const [active, setActive] = useState(() => {
    try { const v = localStorage.getItem('mh-active'); return v ? v : null; } catch { return null; }
  });
  const open  = (id) => { setActive(id);  try { localStorage.setItem('mh-active', id); } catch {} };
  const close = ()   => { setActive(null); try { localStorage.removeItem('mh-active'); } catch {} };
  const wrapRef = useRef(null);
  useEffect(() => {
    let el = wrapRef.current;
    while (el) { if (typeof el.scrollTop === 'number') el.scrollTop = 0; el = el.parentElement; }
  }, [active]);

  let screen;
  if (active === 'dailybrief') {
    screen = <DailyBriefDive brief={dailyBrief} onBack={close} />;
  } else if (active === 'macrobrief') {
    screen = <MacroBriefDive brief={macroBrief} loading={macroBriefLoading} onBack={close} />;
  } else if (active && D.cards[active]) {
    screen = <DeepDive key={active} card={D.cards[active]} cardId={active} onBack={close} />;
  } else {
    screen = (
      <Home D={D}
        dailyBrief={dailyBrief}
        macroBrief={macroBrief}
        macroBriefLoading={macroBriefLoading}
        onOpen={open}
      />
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', height: '100%', background: '#080c14' }}>
      {screen}
    </div>
  );
}

window.Glance = Glance;
