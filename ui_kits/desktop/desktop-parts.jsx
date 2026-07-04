// Market Hub — desktop shared parts. Reuses window.GLANCE data.
// Atoms + deep-dive content (incl. the historical regime timeline) shared by all 3 layout options.
// v20260626
const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

const DSIG = {
  bullish: { c: '#22c55e', glow: 'rgba(34,197,94,.35)', fill: 'rgba(34,197,94,.12)', line: 'rgba(34,197,94,.25)', word: 'BULLISH' },
  neutral: { c: '#f59e0b', glow: 'rgba(245,158,11,.35)', fill: 'rgba(245,158,11,.10)', line: 'rgba(245,158,11,.20)', word: 'NEUTRAL' },
  bearish: { c: '#ef4444', glow: 'rgba(239,68,68,.35)', fill: 'rgba(239,68,68,.10)', line: 'rgba(239,68,68,.20)', word: 'BEARISH' },
};
const DMONO = "'SF Mono','JetBrains Mono','Fira Code',ui-monospace,Menlo,Consolas,monospace";
const DSANS = "'Inter',-apple-system,system-ui,sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function postureColorD(label) { return /off/i.test(label) ? '#ef4444' : /on/i.test(label) ? '#22c55e' : '#f59e0b'; }

// ── Seeded regime history — months of bull/neutral/bear, ending at the card's current status ──
function regimeHistory(seed, status, months) {
  let s = seed * 7919 + 104729;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const order = ['bearish', 'neutral', 'bullish'];
  const target = order.indexOf(status);
  let idx = Math.max(0, Math.min(2, target + (rnd() < 0.5 ? -1 : 1)));
  const out = [];
  for (let i = 0; i < months; i++) {
    // drift toward the current status as we approach the present
    const pull = (i / months) > 0.55 && rnd() < 0.45;
    if (pull) idx += Math.sign(target - idx) || 0;
    else if (rnd() < 0.28) idx += rnd() < 0.5 ? -1 : 1;
    idx = Math.max(0, Math.min(2, idx));
    out.push(order[idx]);
  }
  out[months - 1] = status;
  if (months > 1) out[months - 2] = rnd() < 0.6 ? status : out[months - 2];
  return out;
}
function monthLabels(endLabel, n) {
  const ei = MONTHS.indexOf((endLabel || 'Mar').slice(0, 3));
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(MONTHS[((ei - i) % 12 + 12) % 12]);
  return out;
}

// ── Line/area chart (desktop) — plots real history when the adapter has it, else synthetic ──
function DeepChartLg({ card, cardId, color: colorProp, height = 230, range, setRange, live, ranges: rangesProp, logScale = false, showDelta = false, hoverExtras = null }) {
  const color = live?.lineColor || colorProp;
  const ranges = rangesProp || ['1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [hidden, setHidden] = useStateD({});
  const [hover, setHover] = useStateD(null);
  const svgRef = useRefD(null);

  const W = 720, H = height, top = 12, bot = 26, padR = 4;
  const conf = { '20D': [20, 0.18], '1W': [7, 0.09], '1M': [24, 0.16], '3M': [44, 0.135], '6M': [56, 0.115], '1Y': [64, 0.10], '5Y': [70, 0.082], '10Y': [80, 0.07], '20Y': [90, 0.06] };

  // ── Normalise all series into the same 0..1 plot space ──
  let primaryArr = [], overlayArrs = [], zeroY = null, normThresholds = [];
  if (live && live.values.length > 1) {
    const allVals = [
      ...live.values,
      ...(live.overlays || []).flatMap((o) => o.values || []),
      ...(live.thresholds || []).map((t) => t.y),
    ].filter((v) => v != null && !isNaN(v));
    const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
    const logLo = Math.log(Math.max(lo, 1e-9)), logSpan = Math.log(Math.max(hi, 1e-9)) - logLo || 1;
    const norm = logScale && lo > 0
      ? (v) => (v != null && !isNaN(v) && v > 0) ? 0.07 + ((Math.log(v) - logLo) / logSpan) * 0.86 : null
      : (v) => (v != null && !isNaN(v)) ? 0.07 + ((v - lo) / span) * 0.86 : null;
    primaryArr = live.values.map(norm);
    overlayArrs = (live.overlays || []).map((o) => ({ ...o, arr: (o.values || []).map(norm) }));
    if (live.format === 'pct' && lo <= 0 && hi >= 0) zeroY = norm(0);
    normThresholds = (live.thresholds || []).map((t) => ({ ...t, yNorm: norm(t.y) }));
  } else {
    const [n, vol] = conf[range] || [64, 0.10];
    let s = card.seed * 9301 + 49297 + range.length * 1733;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    let v = 0.4;
    for (let i = 0; i < n; i++) { v += (rnd() - 0.5) * vol + card.trend * 0.012; v = Math.max(0.07, Math.min(0.94, v)); primaryArr.push(v); }
  }

  const n = primaryArr.length;
  const dx = (W - padR) / Math.max(n - 1, 1);
  const yy = (p) => p != null ? top + (1 - p) * (H - top - bot) : null;
  const buildPath = (arr) => {
    let d = '';
    arr.forEach((p, i) => { if (p != null) d += `${(i === 0 || arr[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`; });
    return d;
  };
  const mainLine = buildPath(primaryArr);
  const mainArea = `${mainLine} L${((n - 1) * dx).toFixed(1)},${H - bot} L0,${H - bot} Z`;
  const gradId = `dlg${card.seed}`;

  const hasLegend = overlayArrs.length > 0;
  const mainLabel = live?.label || 'SPY';
  const mainHidden = hasLegend && hidden[mainLabel];

  // ── Colour-coded SPY segments (when colorBy present) ──
  const colorSegs = (live?.colorBy && !mainHidden) ? (() => {
    const segs = []; let start = 0, cur = null;
    const defaultCfn = (v) => (v == null || isNaN(v)) ? '#3b82f6' : v > 14 ? '#ef4444' : v < 0 ? '#f97316' : '#3b82f6';
    const cfn = live.colorByFn || defaultCfn;
    primaryArr.forEach((p, i) => {
      const c = cfn(live.colorBy[i]);
      if (c !== cur) { if (cur !== null) segs.push({ from: start, to: i, c: cur }); start = i; cur = c; }
    });
    if (cur) segs.push({ from: start, to: n - 1, c: cur });
    return segs;
  })() : null;

  // ── RSI panel ──
  const rsiData = live?.rsi?.length > 1 ? live.rsi : null;
  const RSI_H = 64;
  const rsiCol = (v) => v > 70 ? '#ef4444' : v > 50 ? '#22c55e' : v > 40 ? '#64748b' : v > 30 ? '#f97316' : '#a855f7';

  // ── Legend items ──
  const legendItems = hasLegend ? [
    { label: live?.label || 'SPY', color, dash: null },
    ...overlayArrs.map((o) => ({ label: o.label, color: o.color, dash: o.dash })),
  ] : null;

  // ── Hover / tooltip ──
  const isPrice = live?.format !== 'pct' && live?.format !== 'pct_abs' && overlayArrs.length > 0;
  const fmtVal = (v) => live?.format === 'pct'
    ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
    : live?.format === 'pct_abs'
    ? v.toFixed(1) + '%'
    : live?.format === 'count'
    ? String(Math.round(v))
    : isPrice ? `$${v.toFixed(2)}` : v.toFixed(3);
  const handleMouseMove = (e) => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)))));
  };

  return (
    <div>
      {/* ── Chart area (relative wrapper for tooltip) ── */}
      <div style={{ position: 'relative' }} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
        {/* ── Main chart ── */}
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.2, 0.4, 0.6, 0.8].map((g) => (<line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="2 5" />))}
          <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
          {zeroY != null && <line x1="0" x2={W} y1={yy(zeroY).toFixed(1)} y2={yy(zeroY).toFixed(1)} stroke="#475569" strokeWidth="1" strokeDasharray="4 3" />}
          {normThresholds.map((t) => <line key={t.y} x1="0" x2={W} y1={yy(t.yNorm).toFixed(1)} y2={yy(t.yNorm).toFixed(1)} stroke={t.color} strokeWidth="1" strokeDasharray="4 4" strokeOpacity="0.5" />)}
          {!mainHidden && <path d={mainArea} fill={`url(#${gradId})`} />}
          {overlayArrs.map((o) => !hidden[o.label] && (
            <path key={o.label} d={buildPath(o.arr)} fill="none" stroke={o.color} strokeWidth="1.5"
              strokeDasharray={o.dash ? o.dash.join(' ') : undefined}
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {!mainHidden && (colorSegs
            ? colorSegs.map((seg, si) => {
                const pts = primaryArr.slice(seg.from, seg.to + 1);
                const d = pts.map((p, i) => p == null ? '' : `${(i === 0 || pts[i - 1] == null) ? 'M' : 'L'}${((seg.from + i) * dx).toFixed(1)},${yy(p).toFixed(1)}`).join('');
                return <path key={si} d={d} fill="none" stroke={seg.c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
              })
            : <path d={mainLine} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
          {/* Crosshair + hover dots */}
          {hover != null && (
            <line x1={(hover * dx).toFixed(1)} x2={(hover * dx).toFixed(1)} y1={top} y2={H - bot}
              stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />
          )}
          {hover != null && !mainHidden && primaryArr[hover] != null && (() => {
            const hc = colorSegs ? (colorSegs.find((s) => hover >= s.from && hover <= s.to)?.c || color) : color;
            return <circle cx={(hover * dx).toFixed(1)} cy={yy(primaryArr[hover]).toFixed(1)} r="4" fill={hc} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />;
          })()}
          {hover != null && overlayArrs.map((o) => !hidden[o.label] && o.arr[hover] != null && (
            <circle key={o.label} cx={(hover * dx).toFixed(1)} cy={yy(o.arr[hover]).toFixed(1)}
              r="3.5" fill={o.color} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />
          ))}
          {/* Latest-point dot (hidden while hovering) */}
          {hover == null && !mainHidden && primaryArr[n - 1] != null && (() => {
            const lx = ((n - 1) * dx).toFixed(1), ly = yy(primaryArr[n - 1]).toFixed(1);
            const dc = colorSegs ? colorSegs[colorSegs.length - 1]?.c || color : color;
            return (<><circle cx={lx} cy={ly} r="3.5" fill={dc} /><circle cx={lx} cy={ly} r="7" fill="none" stroke={dc} strokeOpacity="0.35" strokeWidth="2" /></>);
          })()}
        </svg>

        {/* ── RSI panel ── */}
        {rsiData && (
          <svg width="100%" viewBox={`0 0 ${W} ${RSI_H}`} preserveAspectRatio="none" style={{ display: 'block', height: RSI_H, marginTop: 3 }}>
            {[30, 70].map((v) => { const y = ((1 - v / 100) * RSI_H).toFixed(1); return <line key={v} x1="0" x2={W} y1={y} y2={y} stroke="rgba(245,158,11,.4)" strokeWidth="1" strokeDasharray="3 4" />; })}
            {rsiData.map((v, i) => {
              if (v == null || isNaN(v)) return null;
              const bw = (W / rsiData.length).toFixed(2), bh = ((v / 100) * RSI_H).toFixed(2);
              return <rect key={i} x={(i * W / rsiData.length).toFixed(2)} y={(RSI_H - Number(bh)).toFixed(2)} width={bw} height={bh} fill={rsiCol(v)} opacity="0.7" />;
            })}
            <text x="4" y="11" fill="#64748b" fontSize="9" fontFamily="monospace">RSI 14</text>
            <text x={W - 4} y={((1 - 70 / 100) * RSI_H - 2).toFixed(1)} fill="#64748b" fontSize="8" fontFamily="monospace" textAnchor="end">70</text>
            <text x={W - 4} y={((1 - 30 / 100) * RSI_H - 2).toFixed(1)} fill="#64748b" fontSize="8" fontFamily="monospace" textAnchor="end">30</text>
          </svg>
        )}

        {/* ── Oscillator histogram panel (e.g. spread, MACD-style) ── */}
        {live?.histogram && (() => {
          const hist    = live.histogram;
          const hVals   = hist.values || [];
          const HIST_H  = hist.height || 54;
          const absMax  = hist.absMax || Math.max(...hVals.filter(v => v != null && !isNaN(v)).map(Math.abs), 0.01);
          const midY    = HIST_H / 2;
          const bw      = Math.max(1, W / Math.max(hVals.length, 1) - 0.5).toFixed(2);
          const threshY = (v) => v >= 0
            ? midY - Math.min(Math.abs(v) / absMax, 1) * (midY - 3)
            : midY + Math.min(Math.abs(v) / absMax, 1) * (midY - 3);
          const posThr  = (hist.thresholds || []).filter(t => t.y > 0).map(t => t.y);
          return (
            <svg width="100%" viewBox={`0 0 ${W} ${HIST_H}`} preserveAspectRatio="none" style={{ display: 'block', height: HIST_H, marginTop: 2 }}>
              {/* zero line */}
              <line x1="0" x2={W} y1={midY} y2={midY} stroke="#334155" strokeWidth="1" />
              {/* threshold reference lines */}
              {(hist.thresholds || []).map((t, ti) => {
                const ly = threshY(t.y).toFixed(1);
                return (
                  <g key={ti}>
                    <line x1="0" x2={W} y1={ly} y2={ly} stroke={t.color} strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
                    {t.label && <text x="6" y={Number(ly) - 3} fill={t.color} fontSize="8.5" fontFamily="monospace" opacity="0.85">{t.label}</text>}
                  </g>
                );
              })}
              {/* bars — red above positive threshold, amber below zero, green otherwise */}
              {hVals.map((v, i) => {
                if (v == null || isNaN(v)) return null;
                const ratio = Math.min(Math.abs(v) / absMax, 1);
                const bh    = Math.max(1, ratio * (midY - 3)).toFixed(1);
                const isPos = v >= 0;
                const fill  = !isPos ? '#f59e0b' : posThr.some(t => v > t) ? '#ef4444' : '#22c55e';
                return (
                  <rect key={i}
                    x={(i * W / hVals.length).toFixed(2)}
                    y={isPos ? (midY - Number(bh)).toFixed(1) : midY.toFixed(1)}
                    width={bw} height={bh}
                    fill={fill} opacity="0.8" />
                );
              })}
              {hover != null && (
                <line x1={(hover * dx).toFixed(1)} x2={(hover * dx).toFixed(1)} y1="0" y2={HIST_H}
                  stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />
              )}
              {hover != null && hVals[hover] != null && !isNaN(hVals[hover]) && (() => {
                const v = hVals[hover];
                const c = !v || v < 0 ? '#f59e0b' : posThr.some(t => v > t) ? '#ef4444' : '#22c55e';
                return <text x={W - 4} y={HIST_H - 4} fill={c} fontSize="9" fontFamily="monospace" textAnchor="end">{(v >= 0 ? '+' : '') + v.toFixed(2) + '%'}</text>;
              })()}
            </svg>
          );
        })()}

        {/* ── Tooltip ── */}
        {hover != null && live?.dates?.[hover] && (
          <div style={{
            position: 'absolute', top: 10, pointerEvents: 'none', zIndex: 10,
            ...(hover / Math.max(n - 1, 1) > 0.55
              ? { right: `calc(${(1 - hover / Math.max(n - 1, 1)) * 100}% + 14px)` }
              : { left: `calc(${(hover / Math.max(n - 1, 1)) * 100}% + 14px)` }),
            background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 10,
            padding: '10px 14px', minWidth: 175,
            boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
            <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{live.dates[hover]}</div>
            {[
              { label: live?.label || 'SPY', value: live.values[hover], color },
              ...(live.overlays || []).map((o) => ({ label: o.label, value: (o.values || [])[hover], color: o.color })),
            ].filter(({ value }) => value != null && !isNaN(value)).map(({ label, value, color: tc }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 5 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: tc, flexShrink: 0 }} />
                  <span style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8' }}>{label}</span>
                </span>
                <span style={{ fontFamily: DMONO, fontSize: 12.5, color: '#e8edf5', fontWeight: 600 }}>{fmtVal(value)}</span>
              </div>
            ))}
            {showDelta && live?.overlays?.length > 0 && (() => {
              const pv = live.values[hover];
              const ov = (live.overlays[0].values || [])[hover];
              if (pv == null || ov == null || isNaN(pv) || isNaN(ov)) return null;
              const delta = pv - ov;
              const dc = delta > 0.01 ? '#22c55e' : delta < -0.01 ? '#ef4444' : '#f59e0b';
              return (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e2d3d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
                  <span style={{ fontFamily: DSANS, fontSize: 12, color: '#64748b' }}>Spread</span>
                  <span style={{ fontFamily: DMONO, fontSize: 12.5, fontWeight: 700, color: dc }}>{(delta >= 0 ? '+' : '') + delta.toFixed(2) + '%'}</span>
                </div>
              );
            })()}
            {hoverExtras && (() => {
              const rows = hoverExtras.map(ex => ({ ...ex, value: (ex.values || [])[hover] })).filter(ex => ex.value != null && !isNaN(ex.value));
              if (!rows.length) return null;
              const fmtEx = (v, fmt) => fmt === 'pct_abs' ? v.toFixed(1) + '%' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
              return (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e2d3d' }}>
                  {rows.map(ex => (
                    <div key={ex.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 4 }}>
                      <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>{ex.label}</span>
                      <span style={{ fontFamily: DMONO, fontSize: 12, color: ex.color || '#94a3b8', fontWeight: 600 }}>{fmtEx(ex.value, ex.format)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {(live?.vs200 || live?.vs50) && (() => {
              // % above 200d mirrors the Stretch Risk bands from /api/scores.
              const stretchTone = (v) => v > 14 ? 'bearish' : v > 10 ? 'neutral' : v >= 0 ? 'bullish' : v >= -10 ? 'neutral' : 'bearish';
              // % above 50d: the 50d is a faster, noisier average, so bands are tighter than the 200d's.
              const vs50Tone    = (v) => v > 8 ? 'bearish' : v > 5 ? 'neutral' : v >= 0 ? 'bullish' : v >= -5 ? 'neutral' : 'bearish';
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e2d3d' }}>
                  {[
                    { label: '% above 200d', value: live?.vs200?.[hover], tone: stretchTone },
                    { label: '% above 50d',  value: live?.vs50?.[hover],  tone: vs50Tone },
                  ].filter(({ value }) => value != null && !isNaN(value)).map(({ label, value, tone }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 5 }}>
                      <span style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8' }}>{label}</span>
                      <span style={{ fontFamily: DMONO, fontSize: 12.5, fontWeight: 600, color: DSIG[tone(value)].c }}>
                        {(value >= 0 ? '+' : '') + value.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {rsiData && rsiData[hover] != null && !isNaN(rsiData[hover]) && (() => {
              const rv = rsiData[hover];
              const rc = rsiCol(rv);
              const rl = rv > 70 ? 'Overbought' : rv > 50 ? 'Bullish Momentum' : rv > 40 ? 'Neutral' : rv > 30 ? 'Bearish Momentum' : 'Oversold';
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e2d3d', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: rc, flexShrink: 0 }} />
                  <span style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8' }}>
                    RSI: <span style={{ color: rc, fontWeight: 600 }}>{rv.toFixed(1)}</span> — {rl}
                  </span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Range buttons + live indicator ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 12, flexWrap: 'wrap' }}>
        {ranges.map((r) => (
          <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
            fontFamily: DMONO, fontSize: 11.5, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
            background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
        ))}
        {(() => {
          const lastDate = live?.dates?.[live.dates.length - 1];
          const todayStr = (() => { const d = new Date(), dw = d.getDay(); d.setDate(d.getDate() - (dw === 1 ? 3 : dw >= 2 ? 1 : 0)); return d.toISOString().slice(0, 10); })();
          const dow      = new Date().getDay(); // 0=Sun, 6=Sat
          const isStale  = live && lastDate && lastDate < todayStr && dow !== 0 && dow !== 6;
          const dotColor = !live ? '#64748b' : isStale ? '#f59e0b' : '#22c55e';
          const dotGlow  = !live ? 'none'    : isStale ? '0 0 6px rgba(245,158,11,.6)' : '0 0 6px #22c55e';
          const label    = !live ? 'Sample'  : isStale ? `Stale · ${lastDate}` : 'Live';
          const title    = !live
            ? 'Sample data — connect /api for live history'
            : isStale
            ? `Data last updated ${lastDate} — nightly refresh may have failed`
            : 'Live data from /api';
          return (
            <span title={title} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontFamily: DSANS, fontSize: 10.5, color: '#8295a9' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
              {label}
            </span>
          );
        })()}
      </div>

      {/* ── Legend (regime card only — click to toggle series) ── */}
      {legendItems && (
        <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {legendItems.map(({ label, color: lc, dash }, li) => {
            const isHidden = hidden[label];
            return (
              <button key={label} onClick={() => setHidden((h) => ({ ...h, [label]: !h[label] }))}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, opacity: isHidden ? 0.3 : 1, transition: 'opacity .15s' }}>
                <svg width="24" height="12" viewBox="0 0 24 12" style={{ flexShrink: 0 }}>
                  {li === 0
                    ? <rect x="0" y="2" width="24" height="8" rx="2" fill={lc} opacity="0.85" />
                    : <line x1="0" y1="6" x2="24" y2="6" stroke={lc} strokeWidth={dash ? 1.5 : 2} strokeDasharray={dash ? dash.join(' ') : undefined} />}
                </svg>
                <span style={{ fontFamily: DSANS, fontSize: 11.5, color: isHidden ? '#64748b' : '#94a3b8' }}>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const HISTORY_CAPTION = {
  regime:      ['SPY ', ['above', 'bullish'], ' or ', ['below', 'bearish'], ' its 200-day moving average each month'],
  leadership:  ['RSP cumulative return ', ['ahead of', 'bullish'], ' or ', ['behind', 'bearish'], ' SPY, sampled at each month-end'],
  breadth:     ['NYSE stocks ', ['above', 'bullish'], ' or ', ['below', 'bearish'], ' their 200-day average'],
  valuations:  'CAPE ratio signal vs. long-run historical norms',
  yield:       ['10Y yield ', ['below', 'bullish'], ' or ', ['above', 'bearish'], ' its 200-day average — easing vs. tightening conditions'],
  credit:      'HYG credit-spread health vs. 200-day average',
  currency:    ['USD (UUP) ', ['below', 'bullish'], ' or ', ['above', 'bearish'], ' its 200-day average — easing vs. tightening financial conditions'],
  globalflows: ['Global markets ', ['above', 'bullish'], ' or ', ['below', 'bearish'], ' their 200-day average'],
  sectors:     [['Cyclical', 'bullish'], ' vs. ', ['defensive', 'bearish'], ' sector leadership each month'],
  commodities: 'Commodity complex trend vs. 200-day average',
  equities:    'VIX regime each month — red: fear (VIX ≥ 30 for 5+ days), orange: elevated (VIX ≥ 20 for 5+ days), green: calm',
};
const renderCaption = (cap) => {
  if (!cap) return null;
  if (typeof cap === 'string') return cap;
  return cap.map((seg, i) => Array.isArray(seg)
    ? <span key={i} style={{ color: DSIG[seg[1]].c, fontStyle: 'italic' }}>{seg[0]}</span>
    : <span key={i}>{seg}</span>
  );
};

// ── Historical regime timeline — how the card's status changed month over month ──
function RegimeTimeline({ card, cardId, asOf, months = 12, compact = false, liveData }) {
  const mo = months;

  let hist, labels;
  const colorSrc = liveData?.colorBy?.length ? liveData.colorBy : liveData?.values?.length ? liveData.values : null;
  if (liveData?.statuses?.length && liveData?.dates?.length) {
    // Pre-computed status strings path (equities breadth history)
    const monthMap = {};
    liveData.dates.forEach((d, i) => {
      const m = String(d).slice(0, 7);
      if (m) monthMap[m] = liveData.statuses[i];
    });
    const sorted = Object.keys(monthMap).sort();
    hist   = sorted.slice(-mo).map(m => monthMap[m] || 'neutral');
    labels = sorted.slice(-mo).map(m => MONTHS[parseInt(m.slice(5, 7), 10) - 1]);
    while (hist.length < mo) { hist.unshift(hist[0] || card.status); labels.unshift(''); }
  } else if (colorSrc && liveData?.dates?.length) {
    const monthMap = {};
    liveData.dates.forEach((d, i) => {
      const m = String(d).slice(0, 7);
      if (m) monthMap[m] = colorSrc[i];
    });
    const sorted = Object.keys(monthMap).sort();
    const allStatuses = sorted.map((m) => {
      const v = monthMap[m];
      return (v == null || isNaN(v)) ? 'neutral' : v > 0 ? 'bullish' : 'bearish';
    });
    hist = allStatuses.slice(-mo);
    labels = sorted.slice(-mo).map((m) => MONTHS[parseInt(m.slice(5, 7), 10) - 1]);
    while (hist.length < mo) { hist.unshift(hist[0] || card.status); labels.unshift(''); }
  } else {
    hist = regimeHistory(card.seed, card.status, mo);
    labels = monthLabels(asOf, mo);
  }

  let transitions = 0;
  for (let i = 1; i < hist.length; i++) if (hist[i] !== hist[i - 1]) transitions++;
  const barH = compact ? 26 : 38;
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
        {hist.map((st, i) => {
          const sg = DSIG[st], changed = i > 0 && hist[i - 1] !== st, last = i === hist.length - 1;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', width: '100%', height: barH, borderRadius: 5, background: sg.c,
                boxShadow: last ? `0 0 12px ${sg.glow}` : 'none', opacity: last ? 1 : 0.62 + (i / mo) * 0.3,
                borderLeft: changed ? '2px solid rgba(232,237,245,.55)' : 'none' }}>
                {last && <div style={{ position: 'absolute', inset: 0, borderRadius: 5, border: '1.5px solid rgba(232,237,245,.6)' }} />}
              </div>
              <span style={{ fontFamily: DMONO, fontSize: 9.5, color: last ? '#cbd5e1' : '#8295a9', fontWeight: last ? 700 : 400 }}>{labels[i]}</span>
            </div>
          );
        })}
      </div>
      {!compact && (
        <div style={{ display: 'flex', gap: 18, marginTop: 16, alignItems: 'center' }}>
          {[['bullish', 'Bullish'], ['neutral', 'Neutral'], ['bearish', 'Bearish']].map(([k, lab]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: DSIG[k].c }} />
              <span style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8' }}>{lab}</span>
            </div>
          ))}
          {HISTORY_CAPTION[cardId] && (
            <span style={{ marginLeft: 'auto', fontFamily: DSANS, fontSize: 11, color: '#8295a9', fontStyle: 'italic' }}>
              {renderCaption(HISTORY_CAPTION[cardId])}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Status pill ──
function StatusPill({ status, size = 'md' }) {
  const sg = DSIG[status];
  const pad = size === 'sm' ? '3px 8px' : '5px 12px';
  const fs = size === 'sm' ? 9.5 : 11;
  return (
    <div style={{ display: 'inline-flex', padding: pad, borderRadius: 6, background: sg.fill, border: `1px solid ${sg.line}` }}>
      <span style={{ fontFamily: DSANS, fontSize: fs, fontWeight: 700, letterSpacing: '.08em', color: sg.c }}>{sg.word}</span>
    </div>
  );
}

// ── Mini sparkline (desktop) ──
function SparkD({ seed, trend, color, w = 72, h = 26 }) {
  const pts = []; let v = 0.5, s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const N = 24;
  for (let i = 0; i < N; i++) { v += (rnd() - 0.5) * 0.2 + trend * 0.016; v = Math.max(0.08, Math.min(0.92, v)); pts.push(v); }
  const dx = w / (N - 1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * dx).toFixed(1)},${(h - p * h).toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = `sd${seed}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.26" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#${id})`} /><path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Stat boxes row ──
// 4-field tuple [label, value, desc, tone]: renders value / label / desc (original format)
// 5-field tuple [label, value, indicator, tone, condition]: renders value / label / — indicator / — condition
// 6-field tuple [..., triggers]: triggers = [{label, text, color}] shown on hover
// 8-field tuple [..., direction, warn]: direction = 'up'|'down'|null, warn = bool
// 9-field tuple [..., positiveDir]: positiveDir = false inverts arrow colour (up=red▲, down=green▼)
//   Use positiveDir=false for counters where a rising count is bad (e.g. "Below 200d")
function StatBoxes({ stats }) {
  if (!stats || !stats.length) return null;
  const [hoveredIdx, setHoveredIdx] = useStateD(null);
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 10 }}>
      {stats.map((st, i) => {
        const tone        = st[3] === 'pos' ? '#22c55e' : st[3] === 'neg' ? '#ef4444' : '#f59e0b';
        const extended    = st[4] != null;
        const triggers    = st[5] || null;
        const direction   = st[6] || null;
        const warn        = st[7] || false;
        const positiveDir = st[8] !== false; // default true; false = rising count is bad
        const dirColor    = direction === 'up'
          ? (positiveDir ? '#22c55e' : '#ef4444')
          : direction === 'down'
          ? (positiveDir ? '#ef4444' : '#22c55e')
          : '#64748b';
        const showTriggers = triggers && hoveredIdx === i;
        return (
          <div key={i}
            style={{ background: '#0d1520', border: `1px solid ${showTriggers ? '#2a3f57' : warn ? '#78350f' : '#1e2d3d'}`, borderRadius: 12, padding: '14px 14px', position: 'relative', transition: 'border-color .15s' }}
            onMouseEnter={() => triggers && setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}>
            {(direction || warn) && !showTriggers && (
              <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
                {warn && <span style={{ fontSize: 10, color: '#f59e0b' }}>⚠</span>}
                {direction && <span style={{ fontSize: 10, color: dirColor }}>{direction === 'up' ? '▲' : '▼'}</span>}
              </div>
            )}
            {showTriggers ? (
              <div>
                <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 10 }}>Triggers</div>
                {triggers.map((t, j) => (
                  <div key={j} style={{ marginBottom: j < triggers.length - 1 ? (triggers.length > 6 ? 4 : 8) : 0 }}>
                    <span style={{ fontFamily: DSANS, fontSize: triggers.length > 6 ? 10 : 11, fontWeight: 700, color: t.color }}>{t.label}: </span>
                    <span style={{ fontFamily: DMONO, fontSize: triggers.length > 6 ? 10 : 11, color: t.color }}>{t.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div style={{ fontFamily: DMONO, fontSize: 20, fontWeight: 700, color: tone, whiteSpace: 'pre-line', lineHeight: 1.3 }}>{st[1]}</div>
                <div style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8', marginTop: 5 }}>{st[0]}</div>
                {extended ? (
                  <>
                    <div style={{ fontFamily: DSANS, fontSize: 10.5, color: tone, marginTop: 4 }}>— {cap(st[2])}</div>
                    <div style={{ fontFamily: DSANS, fontSize: 10.5, color: tone, marginTop: 2 }}>— {cap(st[4])}</div>
                  </>
                ) : (
                  <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#8295a9', marginTop: 2 }}>{st[2]}</div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Indicator table ──
function IndicatorTable({ rows, indicatorWidth = 285, signalDescriptions = null, hoverDescriptions = null, icons = null, showSectorWeights = false }) {
  if (!rows || !rows.length) return null;
  const [hoveredIdx, setHoveredIdx] = useStateD(null);
  // suppress 200d column for sectors — replaced by S&P Wt. + Wtd Impact columns
  const has200d = !showSectorWeights && rows.some(r => r[5] != null);
  const hdrS = { fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9' };
  const iconSlot = icons ? 20 : 9;
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '4px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 7px', borderBottom: '1px solid #1e2d3d' }}>
        <span style={{ width: iconSlot, flexShrink: 0 }} />
        <span style={{ ...hdrS, width: 175, flexShrink: 0 }}>Signal</span>
        <span style={{ ...hdrS, flex: 1 }}>Condition</span>
        <span style={{ ...hdrS, width: 80, textAlign: 'right', flexShrink: 0 }}>{showSectorWeights ? 'Rel Perf' : 'Value'}</span>
        {has200d && <span style={{ ...hdrS, width: 80, textAlign: 'right', flexShrink: 0 }}>200d</span>}
        {showSectorWeights && <span style={{ ...hdrS, width: 60, textAlign: 'right', flexShrink: 0 }}>S&P Wt.</span>}
        {showSectorWeights && <span style={{ ...hdrS, width: 84, textAlign: 'right', flexShrink: 0 }}>Wtd Impact</span>}
      </div>
      {rows.map((r, i) => {
        const rs        = DSIG[r[3]] || DSIG.neutral;
        const desc      = signalDescriptions ? signalDescriptions[r[4]] : null;
        const whyText   = hoverDescriptions  ? hoverDescriptions[r[4]]  : null;
        const isHovered = whyText && hoveredIdx === i;
        const sma200El  = has200d ? (r[5] != null && r[6] != null ? (() => {
          const proximity = Math.abs((r[6] - r[5]) / r[5]) * 100;
          const smaColor  = proximity < 0.5 ? '#f59e0b' : r[6] > r[5] ? '#22c55e' : '#ef4444';
          return <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: smaColor, width: 80, textAlign: 'right', flexShrink: 0 }}>${r[5].toFixed(2)}</span>;
        })() : <span style={{ width: 80, flexShrink: 0 }} />) : null;
        const sectorWtEl = showSectorWeights ? (() => {
          const wt  = r[7];
          const rp  = r[8];
          const wtd = wt != null && rp != null ? wt * rp : null;
          const wtdColor = wtd == null ? '#64748b' : wtd >= 0.1 ? '#22c55e' : wtd <= -0.1 ? '#ef4444' : '#f59e0b';
          return (
            <>
              <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: '#64748b', width: 60, textAlign: 'right', flexShrink: 0 }}>
                {wt != null ? Math.round(wt * 100) + '%' : '—'}
              </span>
              <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: wtdColor, width: 84, textAlign: 'right', flexShrink: 0 }}>
                {wtd != null ? (wtd >= 0 ? '+' : '') + wtd.toFixed(2) + '%' : '—'}
              </span>
            </>
          );
        })() : null;
        // For sectors: show relPerf from r[8] in the value slot (cleaner than ETF price)
        const valueDisplay = showSectorWeights && r[8] != null
          ? (r[8] >= 0 ? '+' : '') + r[8].toFixed(1) + '%'
          : r[1];
        return (
          <div key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: i < rows.length - 1 ? '1px solid #16202e' : 'none', cursor: whyText ? 'default' : undefined, transition: 'background .15s', borderRadius: 6, margin: '0 -4px', padding: isHovered ? '13px 4px' : '13px 4px', background: isHovered ? 'rgba(42,63,87,0.25)' : 'transparent' }}
            onMouseEnter={() => whyText && setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}>
            {icons && icons[i]
              ? <span style={{ width: 20, flexShrink: 0, fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icons[i]}</span>
              : <span style={{ width: 9, height: 9, borderRadius: '50%', background: rs.c, boxShadow: `0 0 6px ${rs.glow}`, flexShrink: 0 }} />
            }
            {isHovered ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 7 }}>Why this signal</div>
                <div style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>{whyText}</div>
              </div>
            ) : (
              <>
                <div style={{ width: 175, flexShrink: 0 }}>
                  <div style={{ fontFamily: DSANS, fontSize: 14, fontWeight: 600, color: '#e8edf5' }}>{r[0]}</div>
                  {r[4] && <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginTop: 2 }}>{r[4]}</div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8' }}>{r[2]}</div>
                  {desc && <div style={{ fontFamily: DSANS, fontSize: 11, color: '#4a5f73', marginTop: 3 }}>{desc}</div>}
                </div>
                <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: rs.c, width: 80, textAlign: 'right', flexShrink: 0, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{valueDisplay}</span>
                {sma200El}
                {sectorWtEl}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sector Cycle Ratio Charts (Idea 03B) ─────────────────────────────────────
// Four ratio line charts, each mapping to an economic cycle phase signal.
const RATIO_COLORS = { xly_xlp: '#f59e0b', xle_xlk: '#f97316', xlf_xlu: '#3b82f6', usci_qqq: '#22d3ee' };
const RATIO_RANGES = ['1Y', '3Y', '5Y', '10Y'];
const RATIO_RMAP   = { '1Y': '1y', '3Y': '3y', '5Y': '5y', '10Y': '10y' };

function SectorRatioCharts() {
  const [range, setRange] = useStateD('1Y');
  const [data,  setData]  = useStateD(null);
  const [hover, setHover] = useStateD({ id: null, idx: null });

  useEffectD(() => {
    let alive = true;
    setData(null);
    fetch(`/api/sector-ratios?range=${RATIO_RMAP[range]}`)
      .then(r => r.json())
      .then(d => { if (alive && d.pairs) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const hdrS = { fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#64748b' };

  // Render a single ratio mini-chart
  function RatioPanelSVG({ pair, dates }) {
    if (!pair) return null;
    const color   = RATIO_COLORS[pair.id] || '#818cf8';
    const vals    = pair.values || [];
    const W = 320, H = 130, top = 8, bot = 22, padR = 6;
    const n  = dates.length;
    if (n < 2) return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DSANS, fontSize: 12, color: '#475569' }}>Loading…</div>;

    const valid = vals.filter(v => v != null);
    const gMin  = valid.length ? Math.min(...valid) : 95;
    const gMax  = valid.length ? Math.max(...valid) : 105;
    const span  = gMax - gMin || 1;
    const norm  = v => v != null ? 0.06 + ((v - gMin) / span) * 0.88 : null;
    const dx    = (W - padR) / (n - 1);
    const yy    = p => p != null ? top + (1 - p) * (H - top - bot) : null;
    const base100 = norm(100);
    const base100y = base100 != null ? yy(base100) : null;

    let d = '';
    vals.forEach((v, i) => {
      const p = norm(v);
      if (p != null) d += `${(i === 0 || norm(vals[i - 1]) == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`;
    });

    const isHov = hover.id === pair.id;
    const hIdx  = isHov ? hover.idx : null;

    const onMove = e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const idx  = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1))));
      setHover({ id: pair.id, idx });
    };

    // Determine current trend color
    const lineColor = pair.trend === 'up' ? '#22c55e' : pair.trend === 'down' ? '#ef4444' : color;

    return (
      <div style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover({ id: null, idx: null })}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
          {[0.25, 0.5, 0.75].map(g => <line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="2 4" />)}
          {base100y != null && <line x1="0" x2={W} y1={base100y.toFixed(1)} y2={base100y.toFixed(1)} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />}
          <path d={d} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hIdx != null && <line x1={(hIdx * dx).toFixed(1)} x2={(hIdx * dx).toFixed(1)} y1={top} y2={H - bot} stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />}
          {hIdx != null && norm(vals[hIdx]) != null && <circle cx={(hIdx * dx).toFixed(1)} cy={yy(norm(vals[hIdx])).toFixed(1)} r="3.5" fill={lineColor} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />}
          {hIdx == null && norm(vals[n - 1]) != null && <circle cx={((n - 1) * dx).toFixed(1)} cy={yy(norm(vals[n - 1])).toFixed(1)} r="3" fill={lineColor} />}
          <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
          {/* Date label at hover or at end */}
          {(() => {
            const labelIdx = hIdx != null ? hIdx : n - 1;
            const lx = (labelIdx * dx).toFixed(1);
            const label = dates[labelIdx] ? dates[labelIdx].slice(5) : '';
            return <text x={lx} y={H - 6} textAnchor="middle" fontSize="9" fill="#475569" fontFamily="monospace">{label}</text>;
          })()}
        </svg>
        {/* Hover value tooltip */}
        {hIdx != null && vals[hIdx] != null && (
          <div style={{ position: 'absolute', top: 4, right: 6, fontFamily: DMONO, fontSize: 12, fontWeight: 700, color: lineColor, background: '#0a0f17', padding: '2px 6px', borderRadius: 5, pointerEvents: 'none' }}>
            {vals[hIdx].toFixed(1)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Cycle-Signal Ratios</div>
          <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Relative price ratios — rising or falling tells you which economic regime is in play. Rebased to 100 at period open.</div>
        </div>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginTop: 2 }}>
          {RATIO_RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '4px 9px', borderRadius: 7,
              fontFamily: DMONO, fontSize: 11, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
              background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {(data?.pairs || Array(4).fill(null)).map((pair, i) => {
          const color = pair ? (RATIO_COLORS[pair.id] || '#818cf8') : '#64748b';
          const lineColor = pair?.trend === 'up' ? '#22c55e' : pair?.trend === 'down' ? '#ef4444' : color;
          const interp = pair ? (pair.trend === 'up' ? pair.rising : pair.trend === 'down' ? pair.falling : 'No clear trend — transition zone') : null;
          return (
            <div key={pair?.id || i} style={{ background: '#0a0f17', border: '1px solid #1e2d3d', borderRadius: 12, padding: '12px 14px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: color }}>{pair?.title || '— / —'}</div>
                  <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 2 }}>{pair?.label || ''}</div>
                </div>
                {pair?.current != null && (
                  <div style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: lineColor, textAlign: 'right' }}>
                    {pair.current.toFixed(1)}
                    <div style={{ fontFamily: DSANS, fontSize: 9, fontWeight: 600, color: lineColor, textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 1 }}>
                      {pair.trend === 'up' ? '▲ Rising' : pair.trend === 'down' ? '▼ Falling' : '— Flat'}
                    </div>
                  </div>
                )}
              </div>
              {pair && data ? <RatioPanelSVG pair={pair} dates={data.dates} /> : (
                <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DSANS, fontSize: 12, color: '#334155' }}>Loading…</div>
              )}
              {interp && (
                <div style={{ fontFamily: DSANS, fontSize: 11, color: lineColor === '#22c55e' ? '#4ade80' : lineColor === '#ef4444' ? '#f87171' : '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
                  {interp}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Horizon Hero — three timeframe-isolated scores + interaction matrix ───────
// Replaces the single blended composite. Speedometer (2–3wk) and Compass (2–3mo)
// are directional 0–10; Anchor (2–3yr) is a Structural Risk Budget that sizes,
// not directs. The 2×2 matrix reads Speedometer × Compass; Anchor sets sizing.
function horizonColorH(score) {
  return score >= 7 ? '#22c55e' : score >= 4 ? '#f59e0b' : '#ef4444';
}
function zoneColorH(zone) {
  return zone === 'green' ? '#22c55e' : zone === 'amber' ? '#f59e0b' : '#ef4444';
}

// Two-line title (e.g. "Tactical" / "Speedometer") so all three dial headers
// occupy the same vertical space and align.
function HorizonTitle({ title }) {
  const parts = title.split(' ');
  return (
    <span style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 700, color: '#e8edf5', lineHeight: 1.2 }}>
      {parts[0]}<br />{parts.slice(1).join(' ')}
    </span>
  );
}

function HorizonDial({ title, horizon, score, level, trigger, veto, vixRatio }) {
  const c = horizonColorH(score);
  const w = Math.max(0, Math.min(100, score * 10));
  return (
    <div style={{ background: '#0a1119', border: '1px solid #1e2d3d', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <HorizonTitle title={title} />
        <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', letterSpacing: '.04em', textAlign: 'right' }}>{horizon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
        <span style={{ fontFamily: DMONO, fontSize: 30, fontWeight: 700, color: c, lineHeight: 1 }}>{score.toFixed(1)}</span>
        <span style={{ fontFamily: DMONO, fontSize: 12, color: '#64748b', marginBottom: 3 }}>/10</span>
        <span style={{ marginLeft: 'auto', fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: c, border: `1px solid ${c}55`, borderRadius: 6, padding: '2px 7px' }}>{level}</span>
      </div>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: '#16202e', overflow: 'visible' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${w}%`, background: c, boxShadow: `0 0 8px ${c}88`, borderRadius: 3 }} />
        <div style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${w}% - 1px)`, width: 2, background: '#e8edf5', boxShadow: `0 0 6px ${c}` }} />
      </div>
      <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.35, minHeight: 30 }}>{trigger}</span>
      {veto && <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: '#ef4444' }}>⚠ VIX BACKWARDATION{vixRatio != null ? ` (${vixRatio})` : ''} — TACTICAL CAPPED</span>}
    </div>
  );
}

function AnchorDial({ anchor }) {
  const c = zoneColorH(anchor.zone);
  const sizePct = Math.round((anchor.sizingFactor ?? 1) * 100);
  return (
    <div style={{ background: '#0a1119', border: '1px solid #1e2d3d', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <HorizonTitle title="Macro Anchor" />
        <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', letterSpacing: '.04em', textAlign: 'right' }}>{anchor.horizon || '2–3 years'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7 }}>
        <span style={{ fontFamily: DMONO, fontSize: 30, fontWeight: 700, color: c, lineHeight: 1 }}>{anchor.score.toFixed(1)}</span>
        <span style={{ fontFamily: DMONO, fontSize: 12, color: '#64748b', marginBottom: 3 }}>/10</span>
        <span style={{ marginLeft: 'auto', fontFamily: DMONO, fontSize: 12, fontWeight: 700, color: c, border: `1px solid ${c}55`, borderRadius: 6, padding: '3px 8px' }}>SIZE {sizePct}%</span>
      </div>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, overflow: 'visible' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 3, background: 'linear-gradient(90deg,#ef4444 0%,#f59e0b 45%,#22c55e 100%)', opacity: .25 }} />
        <div style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${Math.max(0, Math.min(100, anchor.score * 10))}% - 1px)`, width: 2, background: c, boxShadow: `0 0 6px ${c}` }} />
      </div>
      <span style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', lineHeight: 1.35, minHeight: 30 }}>{anchor.note}</span>
    </div>
  );
}

function InteractionMatrix({ matrix }) {
  const QMETA = {
    'add-risk':   { label: 'Add Risk',   color: '#22c55e' },
    'bear-rally': { label: 'Bear Rally', color: '#f59e0b' },
    'accumulate': { label: 'Accumulate', color: '#60a5fa' },
    'risk-off':   { label: 'Risk-Off',   color: '#ef4444' },
  };
  // rows: Speed HIGH (top), Speed LOW (bottom); cols: Compass HIGH (left), Compass LOW (right)
  const rows = [['add-risk', 'bear-rally'], ['accumulate', 'risk-off']];
  const cell = (q) => {
    const active = q === matrix.quadrant;
    const m = QMETA[q];
    return (
      <div key={q} style={{
        background: active ? `${m.color}1a` : '#0a1119',
        border: `1px solid ${active ? m.color : '#1e2d3d'}`,
        borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3,
        boxShadow: active ? `0 0 16px ${m.color}33` : 'none', minHeight: 52, justifyContent: 'center',
      }}>
        <span style={{ fontFamily: DSANS, fontSize: 12.5, fontWeight: 700, color: active ? m.color : '#64748b' }}>{m.label}</span>
        {active && <span style={{ fontFamily: DSANS, fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', color: m.color }}>◄ CURRENT</span>}
      </div>
    );
  };
  const colHead = (t) => <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#475569', textAlign: 'center' }}>{t}</span>;
  const rowHead = (t) => <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#475569', writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', alignSelf: 'center' }}>{t}</span>;
  return (
    <div style={{ background: '#0a1119', border: '1px solid #1e2d3d', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#94a3b8' }}>Speedometer × Compass</span>
        <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>— the primary read</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 1fr', gridTemplateRows: 'auto auto auto', gap: 6, alignItems: 'stretch' }}>
        <div />
        {colHead('Compass High')}
        {colHead('Compass Low')}
        {rowHead('Speed High')}
        {cell(rows[0][0])}
        {cell(rows[0][1])}
        {rowHead('Speed Low')}
        {cell(rows[1][0])}
        {cell(rows[1][1])}
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #16202e', fontFamily: DSANS, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.45 }}>
        <span style={{ color: QMETA[matrix.quadrant].color, fontWeight: 700 }}>{matrix.label}: </span>
        {matrix.guidance}
        {` The Macro Anchor suggests sizing any positions at ${Math.round((matrix.sizingFactor ?? 1) * 100)}% of normal.`}
      </div>
    </div>
  );
}

function HorizonHero({ horizons, exec }) {
  if (!horizons) return null;
  const { speedometer, compass, anchor, matrix } = horizons;
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 18, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#94a3b8' }}>Market Regime — Three Horizons</span>
        <div style={{ flex: 1, height: 1, background: '#1e2d3d' }} />
        <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>tactical · trend · structural</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <HorizonDial title="Tactical Speedometer" horizon={speedometer.horizon || '2–3 weeks'} score={speedometer.score} level={speedometer.level} trigger={speedometer.trigger} veto={speedometer.veto} vixRatio={speedometer.vixRatio} />
        <HorizonDial title="Trend Compass" horizon={compass.horizon || '2–3 months'} score={compass.score} level={compass.level} trigger={compass.trigger} />
        <AnchorDial anchor={anchor} />
      </div>
      <InteractionMatrix matrix={matrix} />
      {exec && exec.regimeBearish && (
        <div style={{ borderTop: '1px solid #2d1a00', paddingTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0b', flexShrink: 0 }} />
          <span style={{ fontFamily: DSANS, fontSize: 11.5, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em', flexShrink: 0 }}>REGIME WARNING</span>
          <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>SPY is below its 200-day SMA — the primary trend is bearish. Size positions accordingly.</span>
        </div>
      )}
      {exec && exec.divergence && (
        <div style={{ borderTop: '1px solid #0d1e35', paddingTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#60a5fa', boxShadow: '0 0 6px #60a5fa', flexShrink: 0 }} />
          <span style={{ fontFamily: DSANS, fontSize: 11.5, fontWeight: 700, color: '#60a5fa', letterSpacing: '.04em', flexShrink: 0 }}>DIVERGENCE</span>
          <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>{exec.divergence.high}</span>
            {' is positive while '}
            <span style={{ color: '#ef4444', fontWeight: 600 }}>{exec.divergence.low}</span>
            {' is restrictive — '}
            {exec.divergence.message}
          </span>
        </div>
      )}
    </div>
  );
}

// Compact horizon strip for the 340px workspace rail.
function HorizonRailMini({ horizons }) {
  if (!horizons) return null;
  const { speedometer, compass, anchor, matrix } = horizons;
  const QC = { 'add-risk': '#22c55e', 'bear-rally': '#f59e0b', 'accumulate': '#60a5fa', 'risk-off': '#ef4444' };
  const row = (label, score, color) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#94a3b8', width: 34, flexShrink: 0 }}>{label}</span>
      <div style={{ position: 'relative', flex: 1, height: 5, borderRadius: 3, background: '#16202e', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(0, Math.min(100, score * 10))}%`, background: color }} />
      </div>
      <span style={{ fontFamily: DMONO, fontSize: 12, fontWeight: 700, color, width: 26, textAlign: 'right', flexShrink: 0 }}>{score.toFixed(1)}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
      {row('SPD', speedometer.score, horizonColorH(speedometer.score))}
      {row('CMP', compass.score, horizonColorH(compass.score))}
      {row('ANC', anchor.score, zoneColorH(anchor.zone))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: QC[matrix.quadrant], boxShadow: `0 0 6px ${QC[matrix.quadrant]}`, flexShrink: 0 }} />
        <span style={{ fontFamily: DSANS, fontSize: 11.5, fontWeight: 700, color: QC[matrix.quadrant] }}>{matrix.label}</span>
        <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>{`· size ${Math.round((matrix.sizingFactor ?? 1) * 100)}%`}</span>
      </div>
    </div>
  );
}

// ── Relative Rotation Graph (Idea 03A) ───────────────────────────────────────
// 4-quadrant scatter: RS-Ratio (x) vs RS-Momentum (y), 12-week trails per sector.
function SectorRRG() {
  const [data,      setData]      = useStateD(null);
  const [hidden,    setHidden]    = useStateD({});
  const [hovLegend, setHovLegend] = useStateD(null);
  const svgRef = useRefD(null);

  useEffectD(() => {
    let alive = true;
    fetch('/api/sector-cycle')
      .then(r => r.json())
      .then(d => { if (alive && d.sectors) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const W = 640, H = 500;
  const PAD = { t: 36, r: 36, b: 44, l: 52 };
  const PW = W - PAD.l - PAD.r;
  const PH = H - PAD.t - PAD.b;

  // Compute data extents across all sectors' trails
  let xMin = 97, xMax = 103, yMin = 97, yMax = 103;
  if (data?.sectors) {
    for (const sec of data.sectors) {
      for (const pt of sec.trail) {
        if (pt.rsRatio != null) { xMin = Math.min(xMin, pt.rsRatio); xMax = Math.max(xMax, pt.rsRatio); }
        if (pt.rsMom   != null) { yMin = Math.min(yMin, pt.rsMom);   yMax = Math.max(yMax, pt.rsMom);   }
      }
    }
    // Ensure 100 is always in view and add 15% margin
    const xSpan = Math.max(xMax - xMin, 6), ySpan = Math.max(yMax - yMin, 6);
    const xPad = xSpan * 0.18, yPad = ySpan * 0.18;
    xMin = Math.min(xMin - xPad, 99); xMax = Math.max(xMax + xPad, 101);
    yMin = Math.min(yMin - yPad, 99); yMax = Math.max(yMax + yPad, 101);
  }

  // Map data coords to SVG plot-area coords
  const toX = v => PAD.l + ((v - xMin) / (xMax - xMin)) * PW;
  const toY = v => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * PH;
  const cx100 = toX(100), cy100 = toY(100);

  // Quadrant label positions
  const qLabels = [
    { label: 'Improving', x: PAD.l + PW * 0.04, y: PAD.t + PH * 0.08, color: '#60a5fa' },
    { label: 'Leading',   x: PAD.l + PW * 0.96, y: PAD.t + PH * 0.08, color: '#4ade80', anchor: 'end' },
    { label: 'Lagging',   x: PAD.l + PW * 0.04, y: PAD.t + PH * 0.96, color: '#f87171' },
    { label: 'Weakening', x: PAD.l + PW * 0.96, y: PAD.t + PH * 0.96, color: '#fb923c', anchor: 'end' },
  ];

  // Determine quadrant label for a sector's current position
  function quadrant(rsRatio, rsMom) {
    if (rsRatio >= 100 && rsMom >= 100) return { label: 'Leading',   color: '#4ade80' };
    if (rsRatio >= 100 && rsMom < 100)  return { label: 'Weakening', color: '#fb923c' };
    if (rsRatio < 100  && rsMom >= 100) return { label: 'Improving', color: '#60a5fa' };
    return { label: 'Lagging', color: '#f87171' };
  }

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Relative Rotation Graph</div>
        <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>
          All 11 sectors vs SPY · weekly · <span style={{ color: '#475569' }}>○ hollow = 12 weeks ago</span> · <span style={{ color: '#475569' }}>● filled + arrow = now</span> · clockwise = typical cycle
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', height: H }}>
          {/* Quadrant fills */}
          <rect x={PAD.l} y={PAD.t} width={cx100 - PAD.l} height={cy100 - PAD.t} fill="rgba(96,165,250,0.04)" />
          <rect x={cx100} y={PAD.t} width={PAD.l + PW - cx100} height={cy100 - PAD.t} fill="rgba(74,222,128,0.04)" />
          <rect x={PAD.l} y={cy100} width={cx100 - PAD.l} height={PAD.t + PH - cy100} fill="rgba(248,113,113,0.04)" />
          <rect x={cx100} y={cy100} width={PAD.l + PW - cx100} height={PAD.t + PH - cy100} fill="rgba(251,146,60,0.04)" />

          {/* Axes */}
          <line x1={PAD.l} x2={PAD.l + PW} y1={cy100} y2={cy100} stroke="#243446" strokeWidth="1.5" />
          <line x1={cx100} x2={cx100} y1={PAD.t} y2={PAD.t + PH} stroke="#243446" strokeWidth="1.5" />

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(g => (
            <g key={g}>
              <line x1={PAD.l + g * PW} x2={PAD.l + g * PW} y1={PAD.t} y2={PAD.t + PH} stroke="#16202e" strokeWidth="1" strokeDasharray="2 4" />
              <line x1={PAD.l} x2={PAD.l + PW} y1={PAD.t + g * PH} y2={PAD.t + g * PH} stroke="#16202e" strokeWidth="1" strokeDasharray="2 4" />
            </g>
          ))}

          {/* Axis labels */}
          <text x={PAD.l + PW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="Inter,sans-serif">RS-Ratio →  (outperforming SPY)</text>
          <text x={12} y={PAD.t + PH / 2} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="Inter,sans-serif" transform={`rotate(-90, 12, ${PAD.t + PH / 2})`}>RS-Momentum ↑</text>

          {/* Axis value ticks */}
          <text x={cx100 - 3} y={PAD.t - 6} textAnchor="middle" fontSize="9" fill="#475569" fontFamily="monospace">100</text>
          <text x={PAD.l - 4} y={cy100 + 3} textAnchor="end" fontSize="9" fill="#475569" fontFamily="monospace">100</text>

          {/* Quadrant labels */}
          {qLabels.map(q => (
            <text key={q.label} x={q.x} y={q.y} textAnchor={q.anchor || 'start'} fontSize="11" fontWeight="700"
              fill={q.color} fontFamily="Inter,sans-serif" opacity="0.6">{q.label}</text>
          ))}

          {/* Sector trails */}
          {data?.sectors && data.sectors.map(sec => {
            if (hidden[sec.sym]) return null;
            const pts = sec.trail.filter(p => p.rsRatio != null && p.rsMom != null);
            if (pts.length < 2) return null;
            const isHov = hovLegend === sec.sym;
            const opacity = hovLegend ? (isHov ? 1 : 0.25) : 0.75;

            const trailPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.rsRatio).toFixed(1)},${toY(p.rsMom).toFixed(1)}`).join('');
            const first = pts[0];
            const last  = pts[pts.length - 1];

            // Arrowhead pointing from second-to-last → last point
            const prev  = pts[pts.length - 2];
            const ax = toX(last.rsRatio), ay = toY(last.rsMom);
            const bx = toX(prev.rsRatio), by = toY(prev.rsMom);
            const angle  = Math.atan2(ay - by, ax - bx) * (180 / Math.PI);
            const arrLen = 9, arrW = 5;
            // Arrow polygon in local coords (tip at origin, pointing right), rotated
            const arrowPts = (cx, cy, angleDeg) => {
              const r = angleDeg * Math.PI / 180;
              const cos = Math.cos(r), sin = Math.sin(r);
              const rotate = (x, y) => [cx + x * cos - y * sin, cy + x * sin + y * cos];
              const tip = rotate(0, 0);
              const bl  = rotate(-arrLen, -arrW);
              const br  = rotate(-arrLen,  arrW);
              return `${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${bl[0].toFixed(1)},${bl[1].toFixed(1)} ${br[0].toFixed(1)},${br[1].toFixed(1)}`;
            };

            return (
              <g key={sec.sym} opacity={opacity}>
                {/* Trail line */}
                <path d={trailPath} fill="none" stroke={sec.color} strokeWidth={isHov ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
                {/* Trail intermediate dots (fade with age — oldest dim, newest bright) */}
                {pts.slice(1, -1).map((p, i) => (
                  <circle key={i} cx={toX(p.rsRatio).toFixed(1)} cy={toY(p.rsMom).toFixed(1)} r={1.5}
                    fill={sec.color} opacity={0.15 + ((i + 1) / pts.length) * 0.55} />
                ))}
                {/* Start marker — hollow circle at oldest point (12 weeks ago) */}
                <circle cx={toX(first.rsRatio).toFixed(1)} cy={toY(first.rsMom).toFixed(1)} r="3.5"
                  fill="#080c14" stroke={sec.color} strokeWidth="1.5" opacity="0.7" />
                {/* Arrowhead near current end showing direction of travel */}
                <polygon points={arrowPts(ax, ay, angle)} fill={sec.color} opacity="0.9" />
                {/* Current position dot */}
                <circle cx={ax.toFixed(1)} cy={ay.toFixed(1)} r={isHov ? 7 : 5}
                  fill={sec.color} stroke="#080c14" strokeWidth="1.5" />
                {/* Ticker label */}
                <text x={(toX(last.rsRatio) + 8).toFixed(1)} y={(toY(last.rsMom) + 4).toFixed(1)}
                  fontSize={isHov ? 12 : 10} fontWeight="700" fill={sec.color} fontFamily="Inter,sans-serif">
                  {sec.sym}
                </text>
              </g>
            );
          })}

          {/* Border */}
          <rect x={PAD.l} y={PAD.t} width={PW} height={PH} fill="none" stroke="#1e2d3d" strokeWidth="1" />
        </svg>

      </div>

      {/* Legend — click to toggle, hover to see full sector name */}
      {data?.sectors && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginTop: 14 }}>
          {data.sectors.map(sec => {
            const last     = sec.trail.at(-1);
            const q        = last?.rsRatio != null && last?.rsMom != null ? quadrant(last.rsRatio, last.rsMom) : null;
            const isHidden = !!hidden[sec.sym];
            const isHovL   = hovLegend === sec.sym;
            return (
              <div key={sec.sym} style={{ position: 'relative' }}>
                <button onClick={() => setHidden(h => ({ ...h, [sec.sym]: !h[sec.sym] }))}
                  onMouseEnter={() => setHovLegend(sec.sym)}
                  onMouseLeave={() => setHovLegend(null)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    opacity: isHidden ? 0.3 : 1, transition: 'opacity .15s' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: isHidden ? '#334155' : sec.color, flexShrink: 0, transition: 'background .15s' }} />
                  <span style={{ fontFamily: DSANS, fontSize: 11, color: isHidden ? '#475569' : '#94a3b8', textDecoration: isHidden ? 'line-through' : 'none' }}>{sec.sym}</span>
                  {q && !isHidden && <span style={{ fontFamily: DSANS, fontSize: 10, color: q.color, fontWeight: 600 }}>{q.label}</span>}
                </button>
                {isHovL && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 20, pointerEvents: 'none',
                    background: '#0d1520', border: `1px solid ${sec.color}55`, borderRadius: 10,
                    padding: '10px 14px', minWidth: 190, whiteSpace: 'nowrap',
                    boxShadow: '0 8px 24px rgba(0,0,0,.6)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: sec.color, flexShrink: 0 }} />
                      <span style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 700, color: '#e8edf5' }}>{sec.label}</span>
                      <span style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em' }}>{sec.sym}</span>
                    </div>
                    {last?.rsRatio != null && (
                      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontFamily: DSANS, fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>RS-Ratio</div>
                          <div style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: last.rsRatio >= 100 ? '#4ade80' : '#f87171' }}>{last.rsRatio.toFixed(2)}</div>
                        </div>
                        <div>
                          <div style={{ fontFamily: DSANS, fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>RS-Mom</div>
                          <div style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: last.rsMom >= 100 ? '#4ade80' : '#f87171' }}>{last.rsMom?.toFixed(2)}</div>
                        </div>
                      </div>
                    )}
                    {q && (
                      <div style={{ padding: '4px 8px', borderRadius: 6, background: `${q.color}18`, border: `1px solid ${q.color}33` }}>
                        <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, color: q.color }}>{q.label}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sector breakdown table (breadth card — sectorTable from /api/scores) ──
function SectorBreakdown({ sectorTable }) {
  if (!sectorTable || !sectorTable.length) return null;
  const [hoveredIdx, setHoveredIdx] = useStateD(null);
  const sorted = [...sectorTable].sort((a, b) => b.vs200 - a.vs200);
  const hdr = { fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9' };
  const fmt = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '4px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 7px', borderBottom: '1px solid #1e2d3d' }}>
        <span style={{ width: 8, flexShrink: 0 }} />
        <span style={{ ...hdr, flex: 1 }}>Sector</span>
        <span style={{ ...hdr, width: 44, textAlign: 'right', flexShrink: 0 }}>ETF</span>
        <span style={{ ...hdr, width: 72, textAlign: 'right', flexShrink: 0 }}>vs 50d</span>
        <span style={{ ...hdr, width: 72, textAlign: 'right', flexShrink: 0 }}>vs 200d</span>
      </div>
      {sorted.map((s, i) => {
        const c200      = s.bull ? '#22c55e' : '#ef4444';
        const glow      = s.bull ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)';
        const c50       = s.vs50 == null ? '#8295a9' : s.vs50 > 0 ? '#22c55e' : '#ef4444';
        const whyText   = SECT_WHY[s.ticker] || null;
        const isHovered = whyText && hoveredIdx === i;
        return (
          <div key={s.ticker}
            onMouseEnter={() => whyText && setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: isHovered ? '13px 4px' : '10px 0', margin: '0 -4px', borderBottom: i < sorted.length - 1 ? '1px solid #16202e' : 'none', borderRadius: 6, background: isHovered ? 'rgba(42,63,87,0.25)' : 'transparent', transition: 'background .15s' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c200, boxShadow: `0 0 5px ${glow}`, flexShrink: 0 }} />
            {isHovered ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 7 }}>Why this signal</div>
                <div style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>{whyText}</div>
              </div>
            ) : (
              <>
                <span style={{ fontFamily: DSANS, fontSize: 13.5, color: '#e8edf5', flex: 1 }}>{s.name}</span>
                <span style={{ fontFamily: DMONO, fontSize: 11, color: '#64748b', width: 44, textAlign: 'right', flexShrink: 0 }}>{s.ticker}</span>
                <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: c50,  width: 72, textAlign: 'right', flexShrink: 0 }}>{fmt(s.vs50)}</span>
                <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: c200, width: 72, textAlign: 'right', flexShrink: 0 }}>{fmt(s.vs200)}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Country breakdown table (global flows card — details from /api/scores) ──
const CT_FLAG = {
  'SPY': 'us', '^GSPTSE': 'ca', 'EWU': 'gb', 'EWG': 'de', 'EWQ': 'fr', 'EWL': 'ch',
  'EWJ': 'jp', 'MCHI': 'cn', 'INDA': 'in', 'EWZ': 'br', 'EWA': 'au', 'EWY': 'kr',
  'EWH': 'hk', 'EWW': 'mx', 'EWT': 'tw', 'EWP': 'es', 'EWI': 'it', 'EWN': 'nl', 'ECH': 'cl',
};
function CountryTable({ details }) {
  if (!details || !details.length) return null;
  const groupOrder = [];
  const groupMap = {};
  details.forEach((d) => {
    if (!groupMap[d.group]) { groupMap[d.group] = []; groupOrder.push(d.group); }
    groupMap[d.group].push(d);
  });
  const groups = groupOrder.map((g) => ({ group: g, items: groupMap[g] }));
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '0 18px' }}>
      {groups.map(({ group, items }, gi) => (
        <div key={group}>
          <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#94a3b8', padding: '10px 0 4px' }}>{group}</div>
          {items.map((d, i) => {
            const c = d.above ? '#22c55e' : '#ef4444';
            const glow = d.above ? 'rgba(34,197,94,.35)' : 'rgba(239,68,68,.35)';
            const isLast = gi === groups.length - 1 && i === items.length - 1;
            const flagCode = CT_FLAG[d.sym];
            return (
              <div key={d.sym} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 0', borderBottom: isLast ? 'none' : '1px solid #16202e' }}>
                {flagCode
                  ? <img src={`/assets/flags/${flagCode}.svg`} alt={flagCode} style={{ width: 24, height: 16, borderRadius: 2, objectFit: 'cover', border: `1px solid ${c}44`, flexShrink: 0, boxShadow: `0 0 4px ${glow}` }} />
                  : <span style={{ width: 24, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${glow}` }} /></span>
                }
                <span style={{ fontFamily: DSANS, fontSize: 13.5, color: '#e8edf5', flex: 1 }}>{d.label}</span>
                <span style={{ fontFamily: DMONO, fontSize: 11, color: '#64748b', width: 56, textAlign: 'right', flexShrink: 0 }}>{d.sym}</span>
                <span style={{ fontFamily: DMONO, fontSize: 12, color: '#94a3b8', width: 72, textAlign: 'right', flexShrink: 0 }}>{d.value}</span>
                <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: c, width: 72, textAlign: 'right', flexShrink: 0 }}>{d.vs200}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Breadth card unified stat boxes (2 rows × 3 boxes) ──
// Row 1: $MMTH | $MMFI | Sector Breadth
// Row 2: Days in 200d Zone | Days in 50d Zone | Consumer Signal
function BreadthStatBoxes({ sectorCount = null, sectorTotal = 11, consumerRow = null }) {
  const [nyse, setNyse] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    const cb = new Date().toISOString().slice(0, 10);
    fetch(`/api/breadth-history?range=1y&_cb=${cb}`).then(r => r.json())
      .then(j => { if (alive && j?.summary) setNyse(j.summary); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const curMmth  = nyse?.currentMmth;
  const curMmfi  = nyse?.currentMmfi;
  const days200  = nyse?.daysInZone    ?? null;
  const days50   = nyse?.daysInZone50d ?? null;
  const mmthTone = curMmth == null ? null : curMmth >= 70 ? 'pos' : curMmth < 40 ? 'neg' : null;
  const mmfiTone = curMmfi == null ? null : curMmfi >= 70 ? 'pos' : curMmfi < 40 ? 'neg' : null;
  const secTone  = sectorCount == null ? null : sectorCount >= 8 ? 'pos' : sectorCount <= 5 ? 'neg' : null;
  const csTone   = consumerRow ? (consumerRow[3] === 'bullish' ? 'pos' : consumerRow[3] === 'bearish' ? 'neg' : null) : null;
  const _bDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _fDir = (d, fallback) => (d === 'up' || d === 'down') ? d : fallback;
  const mmthDir  = _fDir(nyse?.mmthDir, curMmth == null ? null : curMmth >= 50 ? 'up' : 'down');
  const mmfiDir  = _fDir(nyse?.mmfiDir, curMmfi == null ? null : curMmfi >= 50 ? 'up' : 'down');
  const mmthWarn = curMmth != null && (Math.abs(curMmth - 70) <= 4 || Math.abs(curMmth - 40) <= 4);
  const mmfiWarn = curMmfi != null && (Math.abs(curMmfi - 70) <= 4 || Math.abs(curMmfi - 40) <= 4);
  const secWarn  = sectorCount != null && sectorCount >= 6 && sectorCount <= 7;

  const daysCond = (days, tone) => days == null ? '—'
    : tone === 'pos' ? days + ' days above threshold — participation sustained'
    : tone === 'neg' ? days + ' days below threshold — breadth deteriorating'
    : days + ' days in mixed zone — directional bias unclear';

  const row1 = [
    [
      'NYSE 200d Breadth',
      curMmth != null ? curMmth.toFixed(1) + '%' : '—',
      '% NYSE above 200d SMA',
      mmthTone,
      curMmth == null ? '—' : curMmth >= 70 ? 'Broad Participation — Risk On' : curMmth >= 40 ? 'Mixed Breadth — Stay Selective' : 'Breadth Breakdown — Raise Cash',
      [
        { label: 'Risk On',  text: '≥ 70%  Broad participation confirmed',              color: '#22c55e' },
        { label: 'Mixed',    text: '40–70%  Market bifurcating — stay with leaders',    color: '#f59e0b' },
        { label: 'Risk Off', text: '< 40%  Breakdown — reduce broad exposure',          color: '#ef4444' },
      ],
      mmthDir, mmthWarn,
    ],
    [
      'NYSE 50d Breadth',
      curMmfi != null ? curMmfi.toFixed(1) + '%' : '—',
      '% NYSE above 50d SMA',
      mmfiTone,
      curMmfi == null ? '—' : curMmfi >= 70 ? 'Momentum Expanding — Full Risk-On' : curMmfi >= 40 ? 'Mixed Momentum — Be Selective' : 'Momentum Fading — Risk-Off Signal',
      [
        { label: 'Risk On',  text: '≥ 70%  Momentum expanding broadly',                color: '#22c55e' },
        { label: 'Mixed',    text: '40–70%  Mixed — near-term caution',                color: '#f59e0b' },
        { label: 'Risk Off', text: '< 40%  Momentum fading — risk-off signal',         color: '#ef4444' },
      ],
      mmfiDir, mmfiWarn,
    ],
    [
      'Sector Breadth',
      sectorCount != null ? sectorCount + ' / ' + sectorTotal : '—',
      sectorTotal + ' SPDR Sector ETFs vs 200d SMA',
      secTone,
      sectorCount == null ? '—' : sectorCount >= 8 ? 'Broad Support — Risk On' : sectorCount > 5 ? 'Mixed — Watch Leaders' : 'Thin Breadth — Risk Off',
      [
        { label: 'Bullish', text: '≥ 8 sectors  Broad participation confirmed',        color: '#22c55e' },
        { label: 'Mixed',   text: '6–7 sectors  Mixed but not alarming',               color: '#f59e0b' },
        { label: 'Bearish', text: '≤ 5 sectors  Breadth thin — reduce exposure',       color: '#ef4444' },
      ],
      _bDir(secTone), secWarn,
    ],
  ];

  const row2 = [
    [
      'Days in 200d Zone',
      days200 != null ? String(days200) : '—',
      'Consecutive days $MMTH in current zone',
      mmthTone,
      daysCond(days200, mmthTone),
      [
        { label: 'Bull Run',  text: 'Extended time ≥ 70% — participation confirmed sustained', color: '#22c55e' },
        { label: 'Mixed Run', text: 'Extended time 40–70% — waiting for resolution',           color: '#f59e0b' },
        { label: 'Bear Run',  text: 'Extended time < 40% — breadth breakdown persisting',      color: '#ef4444' },
      ],
      mmthDir, false,
    ],
    [
      'Days in 50d Zone',
      days50 != null ? String(days50) : '—',
      'Consecutive days $MMFI in current zone',
      mmfiTone,
      daysCond(days50, mmfiTone),
      [
        { label: 'Bull Run',  text: 'Extended time ≥ 70% — momentum confirmed sustained',     color: '#22c55e' },
        { label: 'Mixed Run', text: 'Extended time 40–70% — momentum directionless',           color: '#f59e0b' },
        { label: 'Bear Run',  text: 'Extended time < 40% — momentum fading persisting',        color: '#ef4444' },
      ],
      mmfiDir, false,
    ],
    consumerRow ? [
      consumerRow[0],
      consumerRow[1],
      consumerRow[4],
      csTone,
      consumerRow[2],
      [
        { label: 'Healthy', text: 'RSPD above 200d SMA — consumer demand intact',             color: '#22c55e' },
        { label: 'Stress',  text: 'RSPD below 200d SMA — late-cycle warning sign',            color: '#ef4444' },
      ],
      _bDir(csTone), false,
    ] : ['Consumer Signal', '—', 'RSPD vs 200d SMA', null, '—', [], null, false],
  ];

  return (
    <div>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={row1} /></div>
      <StatBoxes stats={row2} />
    </div>
  );
}

// ── NYSE Breadth — $MMTH & $MMFI V2-style chart (breadth card only) ──
const NYSE_BREADTH_RANGES = ['20D', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
function NyseBreadthChart() {
  const RMAP = { '20D': '20d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const [range, setRange] = useStateD('20D');
  const [live, setLive] = useStateD(null);
  const [summary, setSummary] = useStateD(null);
  const [noData, setNoData] = useStateD(false);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    setNoData(false);
    fetch(`/api/breadth-history?range=${RMAP[range]}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (Array.isArray(j.mmth) && j.mmth.length) {
          setLive({
            values: j.mmth,
            dates:  j.dates || [],
            label:  '$MMTH (200d)',
            format: 'pct_abs',
            lineColor: '#a855f7',
            overlays: [{ label: '$MMFI (50d)', values: j.mmfi || [], color: '#22d3ee', dash: null }],
            thresholds: [{ y: 70, color: '#22c55e' }, { y: 40, color: '#ef4444' }],
          });
        } else {
          setNoData(true);
        }
        if (j.summary) setSummary(j.summary);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const col = (v) => v >= 70 ? '#22c55e' : v >= 40 ? '#f59e0b' : '#ef4444';
  const curMmth  = summary?.currentMmth;
  const fakeCard = { seed: 3, trend: 0, metric: 'NYSE Breadth — $MMTH & $MMFI', metricUnit: '% NYSE stocks above key moving averages', metricVal: '' };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>NYSE Breadth — $MMTH &amp; $MMFI</div>
          <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Percentage NYSE stocks above key moving averages</div>
        </div>
        {noData
        ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 230, gap: 8 }}>
            <div style={{ fontFamily: DSANS, fontSize: 13, color: '#8295a9' }}>No data for {range} range</div>
            <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8' }}>$MMTH / $MMFI data needs a TradingView CSV refresh</div>
          </div>
        )
        : <DeepChartLg card={fakeCard} cardId="breadth" color="#a855f7" height={230} range={range} setRange={setRange} live={live} ranges={NYSE_BREADTH_RANGES} />
      }
      {/* range buttons still show so user can switch away from the empty range */}
      {noData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 12, flexWrap: 'wrap' }}>
          {NYSE_BREADTH_RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
              background: r === range ? '#1e2d3d' : 'transparent',
              color: r === range ? '#e8edf5' : '#64748b',
              fontFamily: DSANS, fontSize: 12, fontWeight: r === range ? 600 : 400,
            }}>{r}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Advance-Decline Line (ADID) — NYSE & Nasdaq cumulative breadth ────────────
// Plots the cumulative A/D line (running sum of daily net advancers − decliners,
// rebased to 0 at the range start). The classic breadth chart: rising = broad
// participation; a fall/flattening while the index rises is the divergence warning.
const ADID_RANGES = ['1M', '3M', '6M', '1Y', '5Y'];
function NyseAdidChart() {
  const RMAP = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y' };
  const [range, setRange] = useStateD('6M');
  const [live, setLive]   = useStateD(null);
  const [noData, setNoData] = useStateD(false);

  useEffectD(() => {
    let alive = true;
    setLive(null); setNoData(false);
    fetch(`/api/breadth-history?range=${RMAP[range]}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        const nyseRaw = j.adid_nyse || [], nasdaqRaw = j.adid_nasdaq || [];
        if (!nyseRaw.some(v => v != null) && !nasdaqRaw.some(v => v != null)) { setNoData(true); return; }
        // Cumulative sum, rebased to 0 at range start; nulls carry the prior level.
        const cum = (arr) => { let s = 0; return arr.map(v => { if (v != null) s += v; return s; }); };
        setLive({
          values:    cum(nyseRaw),
          dates:     j.dates || [],
          label:     'NYSE A/D Line',
          format:    'count',
          lineColor: '#22d3ee',
          overlays:  [{ label: 'Nasdaq A/D Line', values: cum(nasdaqRaw), color: '#f59e0b', dash: null }],
          thresholds: [{ y: 0, color: '#475569' }],
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const fakeCard = { seed: 3, trend: 0, metric: 'Advance-Decline Line (ADID)', metricUnit: 'cumulative net advancers − decliners', metricVal: '' };
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Advance-Decline Line — NYSE &amp; Nasdaq</div>
        <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Cumulative net advancers − decliners (ADID); rising = broad participation, a fall while the index climbs warns of a narrowing market</div>
      </div>
      {noData
        ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 230, gap: 8 }}>
            <div style={{ fontFamily: DSANS, fontSize: 13, color: '#8295a9' }}>No ADID data for {range} range</div>
            <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8' }}>ADID needs a TradingView alert (INDEX:ADDN / INDEX:ADDQ)</div>
          </div>
        )
        : <DeepChartLg card={fakeCard} cardId="breadth-adid" color="#22d3ee" height={230} range={range} setRange={setRange} live={live} ranges={ADID_RANGES} />
      }
    </div>
  );
}

// ── Sector ETF Breadth historical chart — V2 style via DeepChartLg (breadth card only) ──
// liveSectorCount: passed from DeepDiveContent via card.sectorTable (live scores); injected as
// today's final data point so the chart end matches the Sector Breakdown table (D1 history can lag).
function SectorBreadthChart({ liveSectorCount = null }) {
  const RMAP = { '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const [range, setRange] = useStateD('5Y');
  const [rawData, setRawData] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setRawData(null);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/sector-breadth-history?range=${RMAP[range]}&d=${today}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !Array.isArray(j.above) || !j.above.length) return;
        setRawData({ dates: j.dates || [], above: j.above });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const col = (v) => v >= 8 ? '#22c55e' : v > 5 ? '#f59e0b' : '#ef4444';
  const fakeCard = { seed: 4, trend: 0, metric: 'Sector ETF Breadth — Historical', metricUnit: '# of 11 SPDR sectors above their 200d MA', metricVal: '' };

  // Build live obj at render time so liveSectorCount prop changes update immediately without re-fetch
  let live = null;
  let curVal = null;
  if (rawData) {
    let { dates, above } = rawData;
    if (liveSectorCount != null) {
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = dates[dates.length - 1];
      if (!lastDate || lastDate < today) {
        dates = [...dates, today];
        above = [...above, liveSectorCount];
      } else {
        above = [...above.slice(0, -1), liveSectorCount];
      }
    }
    curVal = above[above.length - 1];
    live = {
      values: above, dates,
      label: 'Sectors above 200d MA', format: 'count',
      lineColor: col(curVal), colorBy: above, colorByFn: col,
      thresholds: [{ y: 8, color: '#22c55e' }, { y: 5, color: '#ef4444' }],
    };
  }

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Sector ETF Breadth — Historical</div>
          <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}># of 11 SPDR sectors above their 200d MA</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: DMONO, fontSize: 11, color: '#94a3b8' }}>Sectors</span>
          <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: curVal != null ? col(curVal) : '#64748b' }}>
            {curVal != null ? `${curVal} / 11` : '—'}
          </span>
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId="breadth-etf" color={curVal != null ? col(curVal) : '#f59e0b'} height={200} range={range} setRange={setRange} live={live} />
    </div>
  );
}

// ── Leadership price history chart — pair selector (Market/Tech/Style) + 20/50/200d range ──
const LP_PAIRS = {
  market: { label: 'Market Breadth', primary: 'RSP',  pColor: '#a855f7', overlay: 'SPY',  oColor: '#22d3ee', note: 'RSP vs SPY',
    desc: 'Market: The equal-weighted RSP versus the cap-weighted SPY, 20/50/200 day percentage return window' },
  tech:   { label: 'Tech Breadth',   primary: 'QQEW', pColor: '#818cf8', overlay: 'QQQ',  oColor: '#22c55e', note: 'QQEW vs QQQ',
    desc: 'Technology: The equal-weighted QQEW versus the cap-weighted QQQ, 20/50/200 day percentage return window' },
  style:  { label: 'Style Bias',     primary: 'IVW',  pColor: '#ef4444', overlay: 'IVE',  oColor: '#f59e0b', note: 'IVW vs IVE',
    desc: 'Style: High Value IVE (low P/E, high dividend yield, asset-heavy) versus high Growth IVW (high P/E, revenue and price momentum), 20/50/200 day percentage return window' },
};

function LeadershipPriceChart() {
  const [range, setRange] = useStateD('20D');
  const [pair,  setPair]  = useStateD('market');
  const [rawData, setRawData] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    fetch('/api/leadership?range=1y')
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.prices || !Array.isArray(j.dates) || !j.dates.length) return;
        setRawData({ dates: j.dates, prices: j.prices });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const DAYS = { '20D': 21, '50D': 51, '200D': 201 };

  const live = (() => {
    if (!rawData) return null;
    const cfg = LP_PAIRS[pair];
    const n   = Math.min(DAYS[range] || 21, rawData.dates.length);
    const rebase = (sym) => {
      const sliced = (rawData.prices[sym] || []).slice(-n);
      const first  = sliced.find(v => v != null && v > 0);
      if (!first) return sliced;
      return sliced.map(v => v == null ? null : ((v - first) / first) * 100);
    };
    return {
      values:     rebase(cfg.primary),
      dates:      rawData.dates.slice(-n),
      label:      cfg.primary,
      format:     'pct',
      lineColor:  cfg.pColor,
      overlays:   [{ label: cfg.overlay, values: rebase(cfg.overlay), color: cfg.oColor, dash: null }],
      thresholds: [{ y: 0, color: '#475569' }],
    };
  })();

  const cfg = LP_PAIRS[pair];
  const fakeCard = { seed: 6, trend: 0, metric: cfg.label, metricUnit: '% return from window open', metricVal: '' };
  const btnStyle = (active) => ({
    all: 'unset', cursor: 'pointer', padding: '4px 11px', borderRadius: 7,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>{cfg.label}</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2, lineHeight: 1.45 }}>{cfg.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[['market','Market'],['tech','Tech'],['style','Style']].map(([key, lbl]) => (
            <button key={key} style={btnStyle(pair === key)} onClick={() => setPair(key)}>{lbl}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`leadership-prices-${pair}`} color={cfg.pColor} height={230} range={range} setRange={setRange} live={live} ranges={['20D', '50D', '200D']} showDelta={true} />
    </div>
  );
}

// ── Equities MA position summary (3 boxes: above both / above 200d only / below 200d) ──
function EquitiesMASummary({ rows }) {
  if (!rows || !rows.length) return null;
  const aboveBoth = rows.filter(r => r[3] === 'bullish').length;
  const above200  = rows.filter(r => r[3] === 'neutral').length;
  const below200  = rows.filter(r => r[3] === 'bearish').length;
  const total     = rows.length;

  const aboveBothCond = aboveBoth >= 7 ? 'Execution Green — Normal Sizing'
    : aboveBoth >= 5 ? 'Selective — Add on Dips to 50d Only'
    : aboveBoth >= 3 ? 'Cautious — Hold High-Conviction Only'
    : 'Stand Aside — Await MA Recapture';

  const above200Cond = above200 === 0 ? 'Clean — All Names Above Both MAs'
    : above200 <= 2 ? 'Normal — A Few Names Lagging 50d'
    : above200 <= 4 ? 'Watch — Momentum Fading in Multiple Names'
    : 'Warning — Majority Lagging 50d SMA';

  const below200Cond = below200 === 0 ? 'Full Participation — All Names in Uptrend'
    : below200 <= 2 ? 'Isolated — One or Two Names Broken'
    : below200 <= 4 ? 'Deteriorating — Reduce New Exposure'
    : 'Bear Territory — Stand Aside';

  const stats = [
    [
      'Above Both MAs',
      String(aboveBoth),
      '50d & 200d SMA',
      aboveBoth >= 7 ? 'pos' : aboveBoth >= 5 ? null : 'neg',
      aboveBothCond,
      [
        { label: 'Execution Green', text: `≥ 7 / ${total}  Broad participation — normal sizing`,         color: '#22c55e' },
        { label: 'Selective',       text: `5–6 / ${total}  Majority intact — add on dips to 50d only`,   color: '#22c55e' },
        { label: 'Cautious',        text: `3–4 / ${total}  Fewer than half — hold high-conviction only`, color: '#f59e0b' },
        { label: 'Stand Aside',     text: `0–2 / ${total}  Most names weak — await MA recapture`,        color: '#ef4444' },
      ],
      aboveBoth >= 5 ? 'up' : 'down',
      aboveBoth === 6 || aboveBoth === 7,
    ],
    [
      'Above 200d Only',
      String(above200),
      'Lagging 50d SMA',
      above200 === 0 ? 'pos' : above200 <= 2 ? null : 'neg',
      above200Cond,
      [
        { label: 'Clean',   text: `0 / ${total}  All names above both MAs — no laggards`,              color: '#22c55e' },
        { label: 'Normal',  text: `1–2 / ${total}  A few names lagging their 50d — monitor closely`,   color: '#22c55e' },
        { label: 'Watch',   text: `3–4 / ${total}  Momentum fading — watch for 50d breakdowns`,        color: '#f59e0b' },
        { label: 'Warning', text: `5+ / ${total}  Many lagging 50d — breadth softening`,               color: '#ef4444' },
      ],
      above200 <= 2 ? 'down' : 'up',  // inverted: fewer laggards = ▼ green
      above200 === 3 || above200 === 4,
      false,
    ],
    [
      'Below 200d',
      String(below200),
      'In bear territory',
      below200 === 0 ? 'pos' : below200 <= 2 ? null : 'neg',
      below200Cond,
      [
        { label: 'Full Participation', text: `0 / ${total}  All names in uptrend — execute freely`,     color: '#22c55e' },
        { label: 'Isolated',           text: `1–2 / ${total}  One or two names broken — hold others`,  color: '#22c55e' },
        { label: 'Deteriorating',      text: `3–4 / ${total}  Multiple names broken — reduce exposure`, color: '#f59e0b' },
        { label: 'Bear Territory',     text: `5+ / ${total}  Majority below 200d — stand aside`,        color: '#ef4444' },
      ],
      below200 <= 1 ? 'down' : 'up',  // inverted: fewer below 200d = ▼ green
      below200 === 2 || below200 === 3,
      false,
    ],
  ];

  return <StatBoxes stats={stats} />;
}

// ── Equities Focus Chart — IWM / FCX / GDX, rebased to % return from window open ──
const EQ_FOCUS = [
  { sym: 'IWM', label: 'Russell 2000', color: '#818cf8' },
  { sym: 'FCX', label: 'Freeport',     color: '#22d3ee' },
  { sym: 'GDX', label: 'Gold Miners',  color: '#f59e0b' },
];

function EquitiesFocusChart() {
  const [range, setRange] = useStateD('20D');
  const [rawData, setRawData] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    fetch('/api/equities-history?range=3mo')
      .then(r => r.json())
      .then(j => { if (alive && j.dates?.length) setRawData(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const DAYS = { '20D': 20, '50D': 50, '100D': 100 };

  const live = (() => {
    if (!rawData) return null;
    const n = Math.min(DAYS[range] || 20, rawData.dates.length);
    const rebase = (sym) => {
      const eq = rawData.equities.find(e => e.sym === sym);
      const sliced = (eq?.prices || []).slice(-n);
      const first  = sliced.find(v => v != null && v > 0);
      if (!first) return sliced;
      return sliced.map(v => v == null ? null : ((v / first - 1) * 100));
    };
    const [primary, ...rest] = EQ_FOCUS;
    return {
      values:     rebase(primary.sym),
      dates:      rawData.dates.slice(-n),
      label:      primary.label,
      format:     'pct',
      lineColor:  primary.color,
      overlays:   rest.map(f => ({ label: f.label, values: rebase(f.sym), color: f.color, dash: null })),
      thresholds: [{ y: 0, color: '#475569' }],
    };
  })();

  const fakeCard = { seed: 11, trend: 0, metric: 'Focus Names', metricUnit: '% return from window open', metricVal: '' };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Focus: Russell 2000 · Freeport · Gold Miners</div>
        <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2, lineHeight: 1.45 }}>Rebased to 0% at window open — small-cap breadth (IWM), copper/growth (FCX), risk-off signal (GDX)</div>
      </div>
      <DeepChartLg card={fakeCard} cardId="equities-focus" color={EQ_FOCUS[0].color} height={230} range={range} setRange={setRange} live={live} ranges={['20D', '50D', '100D']} showDelta={false} />
    </div>
  );
}

// ── Equities multi-series normalized performance chart ──
const EQ_META = [
  ['SPY',  'S&P 500',          '#94a3b8'],
  ['IWM',  'Russell 2000',     '#64748b'],
  ['NVDA', 'Nvidia',           '#818cf8'],
  ['JPM',  'JPMorgan',         '#22c55e'],
  ['CAT',  'Caterpillar',      '#f97316'],
  ['XOM',  'Exxon Mobil',      '#ef4444'],
  ['FCX',  'Freeport-Mc.',     '#d97706'],
  ['GDX',  'Gold Miners',      '#eab308'],
  ['EEM',  'Emerging Markets', '#a855f7'],
];
const EQ_COLOR = Object.fromEntries(EQ_META.map(([s, , c]) => [s, c]));

const EQ_DESCRIPTIONS = {
  'SPY':  'The baseline — everything else is compared to this',
  'IWM':  'Small-cap health; divergence from SPY = breadth warning',
  'NVDA': 'AI/tech leadership proxy',
  'JPM':  'Financial sector / credit cycle',
  'CAT':  'Industrial / global capex cycle',
  'XOM':  'Energy / inflation proxy',
  'FCX':  'Copper / commodity cycle',
  'GDX':  'Risk-off / real rates signal',
  'EEM':  'Global risk appetite / USD sensitivity',
};

const EQ_WHY = {
  'SPY':  'The anchor for everything else. SPY above its 200d means the primary trend is intact — all other signals are read in that context. Below the 200d, the default stance shifts to defensive.',
  'IWM':  'The most important breadth check on the list. IWM tracking SPY means the rally is broad and healthy. IWM lagging or breaking down while SPY holds is the earliest warning of a narrow, top-heavy market that is historically fragile.',
  'NVDA': 'Tech and AI leadership proxy for the current cycle. NVDA above its 200d signals the AI trade is intact and mega-cap technology is leading. When NVDA breaks down, it tends to drag the broader tech complex with it.',
  'JPM':  'Financial sector and credit cycle proxy. Banks outperform when the credit cycle is healthy, lending is expanding, and rates are constructive. JPM breaking its 200d is often an early signal of credit stress before it shows up in spreads.',
  'CAT':  'Industrial and global capex cycle. Caterpillar reflects infrastructure spending, construction activity, and global manufacturing demand. A strong CAT confirms the real economy is growing, not just financial assets.',
  'XOM':  'Energy sector and inflation proxy. XOM above its 200d signals energy demand is intact and commodity-driven inflation is a factor. Energy leadership often coincides with late-cycle dynamics.',
  'FCX':  'Copper and global growth barometer — the most differentiated signal on the list. Copper leads the economic cycle because it is consumed in every stage of construction and manufacturing. FCX breaking out signals global growth is accelerating, particularly China. It tends to lead, not lag.',
  'GDX':  'Risk-off and real rates signal. Gold miners rising alongside equities is a warning — it means safe-haven demand is competing with risk appetite. GDX weak and falling while equities rise is the cleanest confirmation that the risk-on environment is genuine.',
  'EEM':  'Global risk appetite and USD sensitivity. EM equities above their 200d signal that global growth is intact and the US dollar is not a headwind. EEM breaking down while SPY holds is a warning that the rally is purely domestic and global conditions are deteriorating.',
};

const COMM_WL_META = [
  ['CPER', 'Copper',      '#22d3ee'],
  ['GLD',  'Gold',        '#f59e0b'],
  ['SLV',  'Silver',      '#94a3b8'],
  ['IXC',  'Energy',      '#ef4444'],
  ['DBA',  'Agriculture', '#22c55e'],
  ['SLX',  'Steel',       '#f97316'],
  ['URA',  'Uranium',     '#a855f7'],
];
const COMM_WL_COLOR = Object.fromEntries(COMM_WL_META.map(([s, , c]) => [s, c]));

const SECT_WL_META = [
  ['XLK',  'Technology',       '#818cf8'],
  ['XLY',  'Consumer Disc.',   '#f59e0b'],
  ['XLC',  'Comm. Services',   '#22d3ee'],
  ['XLI',  'Industrials',      '#a855f7'],
  ['XLF',  'Financials',       '#3b82f6'],
  ['XLE',  'Energy',           '#f97316'],
  ['XLB',  'Materials',        '#84cc16'],
  ['XLV',  'Health Care',      '#ef4444'],
  ['XLP',  'Consumer Staples', '#94a3b8'],
  ['XLU',  'Utilities',        '#fbbf24'],
  ['XLRE', 'Real Estate',      '#34d399'],
];
const SECT_WL_COLOR = Object.fromEntries(SECT_WL_META.map(([s, , c]) => [s, c]));

// ── Commodities signal descriptions + hover explanations ──
const COMM_DESCRIPTIONS = {
  'USCI': 'Broad commodity benchmark — real assets broadly in or out of favour',
  'CPER': 'The most important signal — copper leads the global growth cycle by 2–4 months',
  'GLD':  'Inverted signal — fading below 200d = risk-on confirmed; surging above = risk-off warning',
  'SLV':  'Gold/copper hybrid — outperforms gold when industrial demand > safe-haven fear',
  'IXC':  'Energy demand proxy — above 200d confirms growth and inflation tailwinds',
  'DBA':  'Food inflation monitor — needs >2% above 200d to confirm a trending signal',
  'SLX':  'Global capex cycle — steel demand mirrors construction and manufacturing activity',
  'URA':  'Energy transition proxy — nuclear demand driven by AI power and decarbonisation',
};

const COMM_WHY = {
  'USCI': 'USCI (United States Commodity Index ETF) tracks a diversified basket of commodities weighted toward energy and metals. When USCI is above its 200-day SMA, real assets are broadly trending — commodity prices are a tailwind for growth and inflation. When USCI is below its 200d, the commodity complex is deflationary and any individual commodity strength should be treated as a theme-specific outlier rather than a macro signal.',
  'CPER': 'CPER (United States Copper Index Fund) tracks copper futures prices, providing direct exposure to physical copper without the roll-cost idiosyncrasies of individual futures contracts. Copper is consumed in every stage of industrial activity: construction, manufacturing, wiring, plumbing, and electrification. Procurement decisions are made months before delivery, so rising copper demand reflects growth expectations 2–4 months out. CPER above its 200d SMA confirms that global industrial demand is expanding. CPER below its 200d is a warning that the manufacturing cycle is slowing — often before GDP data reflects it.',
  'GLD':  'Gold (GLD) is an inverted signal in this card. When GLD surges above its 200-day SMA with more than a 5% extension, investors are seeking safe-haven protection — a risk-off warning for equities. When GLD fades below its 200d, safe-haven demand is absent — this is risk-on confirmation. Do not interpret GLD below the 200d as a bearish signal for the portfolio; it confirms that the equity rally is genuine rather than driven by fear. Exception: if both copper and gold are above their 200d SMAs simultaneously, the read is stagflation — growth and fear coexist.',
  'SLV':  'Silver (SLV) is both an industrial metal and a safe-haven asset, making it a nuanced signal. When silver outperforms gold, industrial demand is winning over fear — a growth-positive read. When gold outperforms silver, fear is winning — a risk-off lean. Silver above its 200d SMA with >2% extension is a clean industrial bid signal, distinct from the safe-haven gold bid. The 2% threshold filters out noise since silver is more volatile than gold.',
  'IXC':  'IXC (iShares Global Energy ETF) tracks global integrated oil and gas producers. Energy above its 200-day SMA reflects sustained demand — consistent with economic expansion and conditions where energy costs are rising. This has implications beyond just buying energy stocks: it signals commodity-driven inflation, which affects central bank policy and bond yields. Energy below its 200d reflects softening demand — typically disinflationary, often coinciding with slowdowns in global manufacturing and transportation.',
  'DBA':  'DBA (Invesco DB Agriculture Fund) tracks agricultural commodities: corn, soybeans, wheat, sugar, and coffee. DBA trending above its 200d SMA with >2% extension signals food price pressure — a component of headline CPI that the Fed cannot easily control through rate policy (supply-side, not demand-side). DBA below its 200d is benign: food prices are not adding to inflation. The 2% threshold is higher than for most signals because agricultural commodities have high seasonal and weather-driven volatility.',
  'SLX':  'SLX (VanEck Steel ETF) tracks global steel producers. Steel is consumed in construction, automotive production, shipbuilding, and infrastructure. SLX above its 200d SMA signals that the global capex cycle is active — infrastructure and construction spending is intact, primarily driven by China, emerging markets, and the US infrastructure cycle. SLX below its 200d is a capex warning, often coinciding with slowdowns in Chinese construction activity, which is the primary driver of global steel demand.',
  'URA':  'URA (Sprott Uranium Miners ETF) tracks uranium mining companies. Uranium has entered a structural supply-demand imbalance driven by AI data centre power demand, energy security concerns, and clean energy transition policy. URA above its 200d SMA with >5% extension signals that nuclear demand expectations are rising and the sector is being re-rated. This is a long-cycle, structural theme — uranium prices move slowly compared to copper or oil. URA is the most speculative signal on this card but represents a genuine secular shift in energy demand that is disconnected from the traditional economic cycle.',
};

// ── Sectors signal descriptions + hover explanations ──
const SECT_DESCRIPTIONS = {
  'XLK':  'Largest sector by weight — AI and semis drive leadership when risk is on',
  'XLY':  'Consumer spending health — outperformance signals discretionary spending power',
  'XLI':  'Capex and infrastructure proxy — leads when economic expansion is confirmed',
  'XLF':  'Yield-curve and credit proxy — outperforms when rates steepen and credit is healthy',
  'XLC':  'Digital ad spend and streaming — leads when corporate marketing budgets are expanding',
  'XLB':  'Commodity-linked equities — leads when global growth and input demand are rising',
  'XLE':  'Oil and gas majors — outperforms when energy demand and growth are both aligned',
  'XLP':  'Defensive — outperforming SPY is a risk-off warning; lagging confirms risk appetite',
  'XLU':  'Rate-sensitive defensive — outperforms when yields fall or recession fears rise',
  'XLRE': 'Bond-proxy defensive — most rate-sensitive sector; leads when yields are falling',
  'XLV':  'Defensive with secular tailwinds — outperforming SPY is mild risk-off; lagging = risk-on',
};

const SECT_WHY = {
  'XLK':  'XLK (Technology Select Sector SPDR) is the largest sector by market cap, anchored by Apple, Microsoft, Nvidia, and the broader semiconductor complex. It is classified as cyclical because revenues are driven by corporate IT budgets, digital advertising, and consumer confidence — all of which expand in growth environments. XLK outperforming SPY above its 200d SMA is the strongest possible risk-on signal: the highest-beta, highest-multiple part of the market is being bought with conviction. XLK lagging while above its 200d often marks early rotation into other cyclicals. A break below its 200d is a meaningful caution given its index weight.',
  'XLY':  'XLY (Consumer Discretionary Select Sector SPDR) holds Amazon, Tesla, Home Depot, and McDonald\'s — companies that benefit directly from consumer spending power and confidence. Discretionary spending contracts first when consumers feel financial stress and expands first when they feel secure. XLY outperforming SPY above its 200d SMA signals that consumers are spending freely on non-essential goods — a healthy expansion signal. XLY underperforming or breaking below its 200d is one of the earliest cyclical warning signs, often preceding broader market deterioration by several months.',
  'XLI':  'XLI (Industrials Select Sector SPDR) tracks manufacturers, aerospace, defence, and logistics firms including Caterpillar, Honeywell, Deere, and UPS. Industrials are a proxy for the physical economy: capital expenditure, infrastructure investment, and global trade flows. XLI outperforming SPY above its 200d SMA confirms that the capex cycle is healthy and businesses are investing in plant, equipment, and supply chains — one of the most reliable signals of a durable economic expansion. XLI lagging or breaking below its 200d signals that corporate capex is being deferred, typically the second leg of a cyclical slowdown after consumer discretionary.',
  'XLF':  'XLF (Financials Select Sector SPDR) holds JPMorgan, Berkshire Hathaway, Bank of America, and Goldman Sachs. Financials are a yield-curve and credit-health proxy: they benefit from a steepening yield curve (higher net interest margins), low loan defaults, and robust capital markets activity. XLF outperforming SPY above its 200d SMA signals that credit conditions are healthy and the banking system is functioning well — a positive read for risk assets broadly. XLF weakness or a break below its 200d is a systemic risk signal and often one of the earliest warnings of credit stress.',
  'XLC':  'XLC (Communication Services Select Sector SPDR) includes Meta, Alphabet, Netflix, and Verizon — a blend of high-growth digital advertising platforms and traditional telecom. It behaves more like Technology than a traditional cyclical: revenues are driven by digital advertising spend, which is correlated with corporate marketing budgets and consumer online activity. XLC outperforming SPY above its 200d is a mild risk-on signal — digital ad budgets expand when companies are confident in growth. XLC underperformance is typically a sign that ad budgets are being cut, an early corporate cost-cutting warning.',
  'XLB':  'XLB (Materials Select Sector SPDR) holds mining and chemical companies including Linde, Freeport-McMoRan, and Sherwin-Williams. Materials are directly linked to commodity prices and global construction activity — demand rises when industrial production, construction, and manufacturing are accelerating. XLB outperforming SPY above its 200d SMA is a cyclical confirmation signal, especially when accompanied by copper and steel strength (CPER, SLX on the Commodities card). It signals that global physical demand is being translated into equity pricing. XLB breaking below its 200d often precedes a broader commodities downturn.',
  'XLE':  'XLE (Energy Select Sector SPDR) holds ExxonMobil, Chevron, ConocoPhillips, and the major US integrated oil and gas companies. Energy outperforms in two distinct environments: genuine demand-driven growth (bullish for the macro) and geopolitical supply disruptions (ambiguous). XLE outperforming SPY above its 200d SMA is most meaningful when accompanied by rising global demand signals — not just OPEC supply cuts. Energy lagging while above its 200d can suggest the oil price rally is supply-driven rather than demand-driven. XLE below its 200d signals softening energy demand — typically disinflationary and coinciding with global growth deceleration.',
  'XLP':  'XLP (Consumer Staples Select Sector SPDR) holds Procter & Gamble, Coca-Cola, Costco, and Walmart — companies selling necessities with stable, recession-resistant revenues. Staples are a classic defensive sector: investors rotate into XLP when they expect economic weakness or equity market volatility. The signal is intentionally inverted in this card: XLP outperforming SPY above its 200d is a risk-off warning — investors are buying safety over growth. XLP lagging or below its 200d means staples are being abandoned in favour of higher-beta cyclicals — a confirming risk-on signal. A sudden XLP rotation is one of the clearest early warnings of deteriorating risk appetite.',
  'XLU':  'XLU (Utilities Select Sector SPDR) holds Duke Energy, NextEra Energy, and Dominion — regulated electric and gas utilities with highly predictable, bond-like cash flows. Utilities are uniquely sensitive to interest rates: when yields rise, XLU becomes less attractive relative to bonds; when yields fall, XLU is bid as a yield substitute. XLU outperforming SPY signals either falling yields (bond-rally, risk-off) or genuine recession fear — in either case it is a risk-off read for the portfolio. Exception: AI data centre electricity demand is a genuine secular tailwind that can cause XLU to outperform even in risk-on environments; use XLP and XLRE as confirmation of a true defensive rotation.',
  'XLRE': 'XLRE (Real Estate Select Sector SPDR) holds REITs including Prologis, American Tower, and Simon Property Group. REITs are direct bond proxies: they carry significant debt and distribute most income as dividends, making them extremely sensitive to interest rates. XLRE outperforming SPY above its 200d SMA is almost always a falling-yield, risk-off environment signal — not an economic growth signal. XLRE lagging or below its 200d typically coincides with rising yields and a risk-on, growth-driven market. XLRE\'s relative performance vs SPY is one of the cleanest real-time yield-direction indicators available.',
  'XLV':  'XLV (Health Care Select Sector SPDR) holds Johnson & Johnson, UnitedHealth, Eli Lilly, and AbbVie — pharmaceutical, managed care, and medical device companies. Health care is a defensive sector with genuine secular growth drivers (ageing demographics, GLP-1 drugs, oncology) that can cause it to outperform even in risk-on environments. The primary read remains defensive: XLV outperforming SPY above its 200d SMA is a mild risk-off signal — investors are rotating to non-cyclical earnings. XLV lagging while remaining above its 200d simply confirms capital is flowing toward higher-beta cyclicals. XLV breaking below its 200d is unusual and typically signals a regulatory or earnings shock rather than a macro deterioration.',
};

function EquitiesChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range, setRange] = useStateD('1Y');
  const [data, setData]   = useStateD(null);
  const [hidden, setHidden] = useStateD({});
  const [hover, setHover]   = useStateD(null);
  const svgRef = useRefD(null);

  useEffectD(() => {
    let alive = true;
    setData(null);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/equities-history?range=${RMAP[range]}&d=${today}`)
      .then(r => r.json())
      .then(d => { if (alive && d.equities) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const W = 720, H = 250, top = 12, bot = 26, padR = 4;

  let seriesNorm = null, gMin = 100, gMax = 100;
  if (data) {
    const allVals = data.equities.flatMap(e => e.prices).filter(v => v != null && !isNaN(v));
    if (allVals.length) { gMin = Math.min(...allVals); gMax = Math.max(...allVals); }
    const span = gMax - gMin || 1;
    const norm = v => v != null ? 0.07 + ((v - gMin) / span) * 0.86 : null;
    seriesNorm = data.equities.map(e => ({ sym: e.sym, label: e.label, nrm: e.prices.map(norm), raw: e.prices }));
  }

  const n  = data ? data.dates.length : 0;
  const dx = n > 1 ? (W - padR) / (n - 1) : 1;
  const yy = p => p != null ? top + (1 - p) * (H - top - bot) : null;
  const path = arr => {
    let d = '';
    arr.forEach((p, i) => { if (p != null) d += `${(i === 0 || arr[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`; });
    return d;
  };
  const onMove = e => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)))));
  };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Watchlist Performance</div>
        <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Normalized (100 = period start)</div>
      </div>

      <div style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
          {[0.2, 0.4, 0.6, 0.8].map(g => <line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="2 5" />)}
          <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
          {/* 100 baseline dashed line */}
          {seriesNorm && (() => { const by = top + (1 - (0.07 + ((100 - gMin) / (gMax - gMin || 1)) * 0.86)) * (H - top - bot); return <line x1="0" x2={W} y1={by.toFixed(1)} y2={by.toFixed(1)} stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />; })()}
          {/* Series lines */}
          {seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && (
            <path key={sym} d={path(nrm)} fill="none" stroke={EQ_COLOR[sym] || '#64748b'} strokeWidth="1.8"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {/* Crosshair */}
          {hover != null && <line x1={(hover * dx).toFixed(1)} x2={(hover * dx).toFixed(1)} y1={top} y2={H - bot} stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />}
          {/* Hover dots */}
          {hover != null && seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && nrm[hover] != null && (
            <circle key={sym} cx={(hover * dx).toFixed(1)} cy={yy(nrm[hover]).toFixed(1)} r="3.5" fill={EQ_COLOR[sym] || '#64748b'} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />
          ))}
          {/* Latest-point dots */}
          {hover == null && seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && nrm[n - 1] != null && (
            <circle key={sym} cx={((n - 1) * dx).toFixed(1)} cy={yy(nrm[n - 1]).toFixed(1)} r="3" fill={EQ_COLOR[sym] || '#64748b'} />
          ))}
        </svg>

        {/* Tooltip */}
        {hover != null && data?.dates?.[hover] && seriesNorm && (
          <div style={{
            position: 'absolute', top: 10, pointerEvents: 'none', zIndex: 10,
            ...(hover / Math.max(n - 1, 1) > 0.55
              ? { right: `calc(${(1 - hover / Math.max(n - 1, 1)) * 100}% + 14px)` }
              : { left:  `calc(${(hover / Math.max(n - 1, 1)) * 100}% + 14px)` }),
            background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 10,
            padding: '10px 14px', minWidth: 175, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
            <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{data.dates[hover]}</div>
            {[...seriesNorm]
              .filter(({ sym }) => !hidden[sym])
              .sort((a, b) => (b.raw[hover] ?? 0) - (a.raw[hover] ?? 0))
              .map(({ sym, label, raw }) => raw[hover] != null && (
                <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: EQ_COLOR[sym], flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8' }}>{label}</span>
                  </span>
                  <span style={{ fontFamily: DMONO, fontSize: 12, color: '#e8edf5', fontWeight: 600 }}>{raw[hover].toFixed(1)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Range buttons + Live dot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
              fontFamily: DMONO, fontSize: 11.5, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
              background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
          ))}
        </div>
        {(() => {
          const lastDate = data?.dates?.[data.dates.length - 1];
          const todayStr = (() => { const d = new Date(), dw = d.getDay(); d.setDate(d.getDate() - (dw === 1 ? 3 : dw >= 2 ? 1 : 0)); return d.toISOString().slice(0, 10); })();
          const dow      = new Date().getDay();
          const isStale  = data && lastDate && lastDate < todayStr && dow !== 0 && dow !== 6;
          const dotColor = !data ? '#64748b' : isStale ? '#f59e0b' : '#22c55e';
          const dotGlow  = !data ? 'none'    : isStale ? '0 0 6px rgba(245,158,11,.6)' : '0 0 6px #22c55e';
          const label    = !data ? 'Loading…' : isStale ? `Stale · ${lastDate}` : 'Live';
          const title    = !data ? '' : isStale ? `Data last updated ${lastDate}` : 'Live data from /api';
          return (
            <span title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: DSANS, fontSize: 10.5, color: '#8295a9' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
              {label}
            </span>
          );
        })()}
      </div>

      {/* Legend — wrapping grid, click to toggle */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px', marginTop: 14 }}>
        {EQ_META.map(([sym, label, c]) => {
          const isHidden = hidden[sym];
          return (
            <button key={sym} onClick={() => setHidden(h => ({ ...h, [sym]: !h[sym] }))}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, opacity: isHidden ? 0.3 : 1, transition: 'opacity .15s' }}>
              <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}><rect x="0" y="0" width="18" height="4" rx="2" fill={c} /></svg>
              <span style={{ fontFamily: DSANS, fontSize: 11.5, color: isHidden ? '#64748b' : '#94a3b8' }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Sectors: Cyclicals vs Defensives two-line chart ──
function CycVsDefChart({ range, setRange }) {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [live, setLive]   = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/sectors?range=${RMAP[range]}&d=${today}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.dates?.length || !j.cycAvgSeries?.length) return;
        setLive({
          values:     j.cycAvgSeries.map(Number),
          dates:      j.dates,
          label:      'Cyclicals',
          format:     'pct',
          lineColor:  '#a855f7',
          overlays:   [{ label: 'Defensives', values: j.defAvgSeries.map(Number), color: '#22d3ee', dash: null }],
          thresholds: [{ y: 0, color: '#475569' }],
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const fakeCard = { seed: 5, trend: 0, metric: 'Cyclicals vs Defensives', metricUnit: 'Avg cumulative return from period open', metricVal: '' };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Cyclicals vs Defensives</div>
        <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 3, lineHeight: 1.6 }}>
          <div>Avg cumulative return from period open:</div>
          <div><span style={{ color: '#a855f7', fontWeight: 600 }}>Cyclicals:</span> Technology · Consumer Disc. · Comm. Services · Industrials · Financials · Energy · Materials</div>
          <div><span style={{ color: '#22d3ee', fontWeight: 600 }}>Defensives:</span> Health Care · Consumer Staples · Utilities · Real Estate</div>
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId="sectors-cyc-vs-def" color="#a855f7" height={200}
        range={range} setRange={setRange} live={live} ranges={RANGES} showDelta={true} />
    </div>
  );
}

function SectorsWatchlistChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range, setRange] = useStateD('1Y');
  const [data, setData]   = useStateD(null);
  const [hidden, setHidden] = useStateD({});
  const [hover, setHover]   = useStateD(null);
  const svgRef = useRefD(null);

  useEffectD(() => {
    let alive = true;
    setData(null);
    const today = new Date().toISOString().slice(0, 10);
    const apiRange = RMAP[range] || '5y';
    Promise.all(
      SECT_WL_META.map(([sym]) =>
        fetch(`/api/history?symbol=${encodeURIComponent(sym)}&range=${apiRange}&d=${today}`)
          .then(r => r.json())
          .then(d => {
            const closes = (d.closes || []).map(v => v == null ? null : Number(v));
            const base = closes.find(v => v != null);
            const prices = base ? closes.map(v => v == null ? null : (v / base) * 100) : closes;
            return { sym, dates: d.dates || [], prices };
          })
          .catch(() => null)
      )
    ).then(results => {
      if (!alive) return;
      const valid = results.filter(Boolean);
      if (!valid.length) return;
      const dates = valid.reduce((a, b) => a.dates.length >= b.dates.length ? a : b).dates;
      setData({ dates, series: valid });
    });
    return () => { alive = false; };
  }, [range]);

  const W = 720, H = 250, top = 12, bot = 26, padR = 4;
  let seriesNorm = null, gMin = 90, gMax = 110;
  if (data) {
    const allVals = data.series.flatMap(s => s.prices).filter(v => v != null && !isNaN(v));
    if (allVals.length) { gMin = Math.min(...allVals); gMax = Math.max(...allVals); }
    const span = gMax - gMin || 1;
    const norm = v => v != null ? 0.07 + ((v - gMin) / span) * 0.86 : null;
    seriesNorm = data.series.map(s => ({ sym: s.sym, nrm: s.prices.map(norm), raw: s.prices }));
  }
  const n  = data ? data.dates.length : 0;
  const dx = n > 1 ? (W - padR) / (n - 1) : 1;
  const yy = p => p != null ? top + (1 - p) * (H - top - bot) : null;
  const buildPath = arr => {
    let d = '';
    arr.forEach((p, i) => { if (p != null) d += `${(i === 0 || arr[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`; });
    return d;
  };
  const onMove = e => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)))));
  };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Sector Performance</div>
        <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Normalized (100 = period start)</div>
      </div>
      <div style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
          {[0.2, 0.4, 0.6, 0.8].map(g => <line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="2 5" />)}
          <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
          {seriesNorm && (() => { const by = top + (1 - (0.07 + ((100 - gMin) / (gMax - gMin || 1)) * 0.86)) * (H - top - bot); return <line x1="0" x2={W} y1={by.toFixed(1)} y2={by.toFixed(1)} stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />; })()}
          {seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && (
            <path key={sym} d={buildPath(nrm)} fill="none" stroke={SECT_WL_COLOR[sym] || '#64748b'} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && <line x1={(hover * dx).toFixed(1)} x2={(hover * dx).toFixed(1)} y1={top} y2={H - bot} stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />}
          {hover != null && seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && nrm[hover] != null && (
            <circle key={sym} cx={(hover * dx).toFixed(1)} cy={yy(nrm[hover]).toFixed(1)} r="3.5" fill={SECT_WL_COLOR[sym] || '#64748b'} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />
          ))}
          {hover == null && seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && nrm[n - 1] != null && (
            <circle key={sym} cx={((n - 1) * dx).toFixed(1)} cy={yy(nrm[n - 1]).toFixed(1)} r="3" fill={SECT_WL_COLOR[sym] || '#64748b'} />
          ))}
        </svg>
        {hover != null && data?.dates?.[hover] && seriesNorm && (
          <div style={{
            position: 'absolute', top: 10, pointerEvents: 'none', zIndex: 10,
            ...(hover / Math.max(n - 1, 1) > 0.55 ? { right: `calc(${(1 - hover / Math.max(n - 1, 1)) * 100}% + 14px)` } : { left: `calc(${(hover / Math.max(n - 1, 1)) * 100}% + 14px)` }),
            background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 10, padding: '10px 14px', minWidth: 170, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
            <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{data.dates[hover]}</div>
            {[...seriesNorm]
              .filter(({ sym }) => !hidden[sym])
              .sort((a, b) => (b.raw[hover] ?? 0) - (a.raw[hover] ?? 0))
              .map(({ sym, raw }) => raw[hover] != null && (
                <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: SECT_WL_COLOR[sym], flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8' }}>{SECT_WL_META.find(([s]) => s === sym)?.[1] ?? sym}</span>
                  </span>
                  <span style={{ fontFamily: DMONO, fontSize: 12, color: '#e8edf5', fontWeight: 600 }}>{raw[hover].toFixed(1)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
              fontFamily: DMONO, fontSize: 11.5, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
              background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
          ))}
        </div>
        {(() => {
          const lastDate = data?.dates?.[data.dates.length - 1];
          const todayStr = (() => { const d = new Date(), dw = d.getDay(); d.setDate(d.getDate() - (dw === 1 ? 3 : dw >= 2 ? 1 : 0)); return d.toISOString().slice(0, 10); })();
          const dow = new Date().getDay();
          const isStale = data && lastDate && lastDate < todayStr && dow !== 0 && dow !== 6;
          const dotColor = !data ? '#64748b' : isStale ? '#f59e0b' : '#22c55e';
          const dotGlow  = !data ? 'none' : isStale ? '0 0 6px rgba(245,158,11,.6)' : '0 0 6px #22c55e';
          const label    = !data ? 'Loading…' : isStale ? `Stale · ${lastDate}` : 'Live';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: DSANS, fontSize: 10.5, color: '#8295a9' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
              {label}
            </span>
          );
        })()}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px', marginTop: 14 }}>
        {SECT_WL_META.map(([sym, label, c]) => {
          const isHidden = hidden[sym];
          return (
            <button key={sym} onClick={() => setHidden(h => ({ ...h, [sym]: !h[sym] }))}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, opacity: isHidden ? 0.3 : 1, transition: 'opacity .15s' }}>
              <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}><rect x="0" y="0" width="18" height="4" rx="2" fill={c} /></svg>
              <span style={{ fontFamily: DSANS, fontSize: 11.5, color: isHidden ? '#64748b' : '#94a3b8' }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Global Flows: Country performance watchlist (19 country ETFs, normalized to 100) ──
const COUNTRY_META = [
  { sym: 'SPY',     label: 'S&P 500',    group: 'North America', color: '#3b82f6' },
  { sym: '^GSPTSE', label: 'Canada',      group: 'North America', color: '#f97316' },
  { sym: 'EWU',     label: 'UK',          group: 'Europe',        color: '#a78bfa' },
  { sym: 'EWG',     label: 'Germany',     group: 'Europe',        color: '#f87171' },
  { sym: 'EWQ',     label: 'France',      group: 'Europe',        color: '#fbbf24' },
  { sym: 'EWL',     label: 'Switzerland', group: 'Europe',        color: '#34d399' },
  { sym: 'EWN',     label: 'Netherlands', group: 'Europe',        color: '#22d3ee' },
  { sym: 'EWI',     label: 'Italy',       group: 'Europe',        color: '#fb923c' },
  { sym: 'EWP',     label: 'Spain',       group: 'Europe',        color: '#c084fc' },
  { sym: 'EWJ',     label: 'Japan',       group: 'Asia Pacific',  color: '#ef4444' },
  { sym: 'MCHI',    label: 'China',       group: 'Asia Pacific',  color: '#dc2626' },
  { sym: 'EWT',     label: 'Taiwan',      group: 'Asia Pacific',  color: '#84cc16' },
  { sym: 'EWY',     label: 'S. Korea',    group: 'Asia Pacific',  color: '#06b6d4' },
  { sym: 'INDA',    label: 'India',       group: 'Asia Pacific',  color: '#ec4899' },
  { sym: 'EWA',     label: 'Australia',   group: 'Asia Pacific',  color: '#10b981' },
  { sym: 'EWH',     label: 'Hong Kong',   group: 'Asia Pacific',  color: '#6366f1' },
  { sym: 'EWZ',     label: 'Brazil',      group: 'Latin America', color: '#22c55e' },
  { sym: 'EWW',     label: 'Mexico',      group: 'Latin America', color: '#7c3aed' },
  { sym: 'ECH',     label: 'Chile',       group: 'Latin America', color: '#f43f5e' },
];
const COUNTRY_GROUPS = ['North America', 'Europe', 'Asia Pacific', 'Latin America'];
const REGIONAL_META = [
  { sym: 'ACWI',    label: 'Global',   color: '#22c55e' },
  { sym: 'SPY',     label: 'USA',      color: '#3b82f6' },
  { sym: '^GSPTSE', label: 'Canada',   color: '#f97316' },
  { sym: 'FEZ',     label: 'Europe',   color: '#f59e0b' },
  { sym: 'AIA',     label: 'Asia',     color: '#a855f7' },
  { sym: 'ILF',     label: 'LatAm',   color: '#ec4899' },
  { sym: 'EEM',     label: 'Emerging', color: '#06b6d4' },
];

function CountryWatchlistChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range,  setRange]  = useStateD('1Y');
  const [view,   setView]   = useStateD('country');
  const [data,   setData]   = useStateD(null);
  const [hidden, setHidden] = useStateD({});
  const [hover,  setHover]  = useStateD(null);
  const svgRef = useRefD(null);

  useEffectD(() => {
    let alive = true;
    setData(null);
    fetch(`/api/global-flows-history?range=${RMAP[range]}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.countries?.length) return;
        setData({ dates: j.dates, regional: j.regional || [], countries: j.countries });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const activeSeries = data ? (view === 'region' ? data.regional : data.countries) : [];
  const metaFor = sym => (view === 'region' ? REGIONAL_META : COUNTRY_META).find(m => m.sym === sym);

  const W = 720, H = 260, top = 12, bot = 26, padR = 4;
  let seriesNorm = null, gMin = 90, gMax = 110;
  if (data && activeSeries.length) {
    const allVals = activeSeries.flatMap(s => s.prices).filter(v => v != null && !isNaN(v));
    if (allVals.length) { gMin = Math.min(...allVals); gMax = Math.max(...allVals); }
    const span = gMax - gMin || 1;
    const normFn = v => v != null ? 0.07 + ((v - gMin) / span) * 0.86 : null;
    seriesNorm = activeSeries.map(s => {
      const meta = metaFor(s.sym);
      return { sym: s.sym, label: meta?.label || s.label, color: meta?.color || '#64748b', nrm: s.prices.map(normFn), raw: s.prices };
    });
  }
  const n  = data ? data.dates.length : 0;
  const dx = n > 1 ? (W - padR) / (n - 1) : 1;
  const yy = p => p != null ? top + (1 - p) * (H - top - bot) : null;
  const buildPath = arr => {
    let d = '';
    arr.forEach((p, i) => { if (p != null) d += `${(i === 0 || arr[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`; });
    return d;
  };
  const onMove = e => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)))));
  };
  const viewBtn = active => ({
    all: 'unset', cursor: 'pointer', padding: '3px 10px', borderRadius: 6,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>
            {view === 'region' ? 'Regional Performance' : 'Country Performance'}
          </div>
          <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Normalized (100 = period start) — click legend to show/hide</div>
        </div>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {['Region', 'Country'].map(v => (
            <button key={v} onClick={() => { setView(v.toLowerCase()); setHidden({}); }} style={viewBtn(view === v.toLowerCase())}>{v}</button>
          ))}
        </div>
      </div>
      <div style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
          {[0.2, 0.4, 0.6, 0.8].map(g => <line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="2 5" />)}
          <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
          {seriesNorm && (() => { const by = top + (1 - (0.07 + ((100 - gMin) / (gMax - gMin || 1)) * 0.86)) * (H - top - bot); return <line x1="0" x2={W} y1={by.toFixed(1)} y2={by.toFixed(1)} stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />; })()}
          {seriesNorm && seriesNorm.map(({ sym, nrm, color }) => !hidden[sym] && (
            <path key={sym} d={buildPath(nrm)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && <line x1={(hover * dx).toFixed(1)} x2={(hover * dx).toFixed(1)} y1={top} y2={H - bot} stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />}
          {hover != null && seriesNorm && seriesNorm.map(({ sym, nrm, color }) => !hidden[sym] && nrm[hover] != null && (
            <circle key={sym} cx={(hover * dx).toFixed(1)} cy={yy(nrm[hover]).toFixed(1)} r="3" fill={color} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />
          ))}
          {hover == null && seriesNorm && seriesNorm.map(({ sym, nrm, color }) => !hidden[sym] && nrm[n - 1] != null && (
            <circle key={sym} cx={((n - 1) * dx).toFixed(1)} cy={yy(nrm[n - 1]).toFixed(1)} r="2.5" fill={color} />
          ))}
        </svg>
        {hover != null && data?.dates?.[hover] && seriesNorm && (
          <div style={{
            position: 'absolute', top: 10, pointerEvents: 'none', zIndex: 10,
            ...(hover / Math.max(n - 1, 1) > 0.55
              ? { right: `calc(${(1 - hover / Math.max(n - 1, 1)) * 100}% + 14px)` }
              : { left:  `calc(${(hover  / Math.max(n - 1, 1)) * 100}% + 14px)` }),
            background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 10,
            padding: '10px 14px', minWidth: 160, maxHeight: 320, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
            <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{data.dates[hover]}</div>
            {[...seriesNorm]
              .filter(({ sym }) => !hidden[sym])
              .sort((a, b) => (b.raw[hover] ?? 0) - (a.raw[hover] ?? 0))
              .map(({ sym, label, color, raw }) => raw[hover] != null && (
                <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8' }}>{label}</span>
                  </span>
                  <span style={{ fontFamily: DMONO, fontSize: 11.5, color: '#e8edf5', fontWeight: 600 }}>{raw[hover].toFixed(1)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
              fontFamily: DMONO, fontSize: 11.5, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
              background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
          ))}
        </div>
        {(() => {
          const lastDate = data?.dates?.[data.dates.length - 1];
          const todayStr = (() => { const d = new Date(), dw = d.getDay(); d.setDate(d.getDate() - (dw === 1 ? 3 : dw >= 2 ? 1 : 0)); return d.toISOString().slice(0, 10); })();
          const dow = new Date().getDay();
          const isStale = data && lastDate && lastDate < todayStr && dow !== 0 && dow !== 6;
          const dotColor = !data ? '#64748b' : isStale ? '#f59e0b' : '#22c55e';
          const dotGlow  = !data ? 'none' : isStale ? '0 0 6px rgba(245,158,11,.6)' : '0 0 6px #22c55e';
          const lbl      = !data ? 'Loading…' : isStale ? `Stale · ${lastDate}` : 'Live';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: DSANS, fontSize: 10.5, color: '#8295a9' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
              {lbl}
            </span>
          );
        })()}
      </div>
      {view === 'region'
        ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 18px', marginTop: 12 }}>
            {REGIONAL_META.map(({ sym, label, color }) => (
              <button key={sym} onClick={() => setHidden(h => ({ ...h, [sym]: !h[sym] }))}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: hidden[sym] ? 0.3 : 1, transition: 'opacity .15s' }}>
                <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}><rect x="0" y="0" width="18" height="4" rx="2" fill={color} /></svg>
                <span style={{ fontFamily: DSANS, fontSize: 11, color: hidden[sym] ? '#64748b' : '#94a3b8' }}>{label}</span>
              </button>
            ))}
          </div>
        ) : (
          COUNTRY_GROUPS.map(g => {
            const gItems = COUNTRY_META.filter(m => m.group === g);
            return (
              <div key={g} style={{ marginTop: 10 }}>
                <div style={{ fontFamily: DSANS, fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 5 }}>{g}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 18px' }}>
                  {gItems.map(({ sym, label, color }) => (
                    <button key={sym} onClick={() => setHidden(h => ({ ...h, [sym]: !h[sym] }))}
                      style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: hidden[sym] ? 0.3 : 1, transition: 'opacity .15s' }}>
                      <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}><rect x="0" y="0" width="18" height="4" rx="2" fill={color} /></svg>
                      <span style={{ fontFamily: DSANS, fontSize: 11, color: hidden[sym] ? '#64748b' : '#94a3b8' }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )
      }
    </div>
  );
}

function CommoditiesWatchlistChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range, setRange] = useStateD('1Y');
  const [data, setData]   = useStateD(null);
  const [hidden, setHidden] = useStateD({});
  const [hover, setHover]   = useStateD(null);
  const svgRef = useRefD(null);

  useEffectD(() => {
    let alive = true;
    setData(null);
    const today = new Date().toISOString().slice(0, 10);
    const apiRange = RMAP[range] || '5y';
    Promise.all(
      COMM_WL_META.map(([sym]) =>
        fetch(`/api/history?symbol=${encodeURIComponent(sym)}&range=${apiRange}&d=${today}`)
          .then(r => r.json())
          .then(d => {
            const closes = (d.closes || []).map(v => v == null ? null : Number(v));
            const base = closes.find(v => v != null);
            const prices = base ? closes.map(v => v == null ? null : (v / base) * 100) : closes;
            return { sym, dates: d.dates || [], prices };
          })
          .catch(() => null)
      )
    ).then(results => {
      if (!alive) return;
      const valid = results.filter(Boolean);
      if (!valid.length) return;
      const dates = valid.reduce((a, b) => a.dates.length >= b.dates.length ? a : b).dates;
      setData({ dates, series: valid });
    });
    return () => { alive = false; };
  }, [range]);

  const W = 720, H = 250, top = 12, bot = 26, padR = 4;
  let seriesNorm = null, gMin = 90, gMax = 110;
  if (data) {
    const allVals = data.series.flatMap(s => s.prices).filter(v => v != null && !isNaN(v));
    if (allVals.length) { gMin = Math.min(...allVals); gMax = Math.max(...allVals); }
    const span = gMax - gMin || 1;
    const norm = v => v != null ? 0.07 + ((v - gMin) / span) * 0.86 : null;
    seriesNorm = data.series.map(s => ({ sym: s.sym, nrm: s.prices.map(norm), raw: s.prices }));
  }
  const n  = data ? data.dates.length : 0;
  const dx = n > 1 ? (W - padR) / (n - 1) : 1;
  const yy = p => p != null ? top + (1 - p) * (H - top - bot) : null;
  const buildPath = arr => {
    let d = '';
    arr.forEach((p, i) => { if (p != null) d += `${(i === 0 || arr[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${yy(p).toFixed(1)}`; });
    return d;
  };
  const onMove = e => {
    const el = svgRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)))));
  };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Watchlist Performance</div>
        <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>Normalized (100 = period start)</div>
      </div>
      <div style={{ position: 'relative' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
          {[0.2, 0.4, 0.6, 0.8].map(g => <line key={g} x1="0" x2={W} y1={top + g * (H - top - bot)} y2={top + g * (H - top - bot)} stroke="#16202e" strokeWidth="1" strokeDasharray="2 5" />)}
          <line x1="0" x2={W} y1={H - bot} y2={H - bot} stroke="#1e2d3d" strokeWidth="1" />
          {seriesNorm && (() => { const by = top + (1 - (0.07 + ((100 - gMin) / (gMax - gMin || 1)) * 0.86)) * (H - top - bot); return <line x1="0" x2={W} y1={by.toFixed(1)} y2={by.toFixed(1)} stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />; })()}
          {seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && (
            <path key={sym} d={buildPath(nrm)} fill="none" stroke={COMM_WL_COLOR[sym] || '#64748b'} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {hover != null && <line x1={(hover * dx).toFixed(1)} x2={(hover * dx).toFixed(1)} y1={top} y2={H - bot} stroke="#334155" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />}
          {hover != null && seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && nrm[hover] != null && (
            <circle key={sym} cx={(hover * dx).toFixed(1)} cy={yy(nrm[hover]).toFixed(1)} r="3.5" fill={COMM_WL_COLOR[sym] || '#64748b'} stroke="#080c14" strokeWidth="1.5" pointerEvents="none" />
          ))}
          {hover == null && seriesNorm && seriesNorm.map(({ sym, nrm }) => !hidden[sym] && nrm[n - 1] != null && (
            <circle key={sym} cx={((n - 1) * dx).toFixed(1)} cy={yy(nrm[n - 1]).toFixed(1)} r="3" fill={COMM_WL_COLOR[sym] || '#64748b'} />
          ))}
        </svg>
        {hover != null && data?.dates?.[hover] && seriesNorm && (
          <div style={{
            position: 'absolute', top: 10, pointerEvents: 'none', zIndex: 10,
            ...(hover / Math.max(n - 1, 1) > 0.55 ? { right: `calc(${(1 - hover / Math.max(n - 1, 1)) * 100}% + 14px)` } : { left: `calc(${(hover / Math.max(n - 1, 1)) * 100}% + 14px)` }),
            background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 10, padding: '10px 14px', minWidth: 170, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
            <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{data.dates[hover]}</div>
            {[...seriesNorm]
              .filter(({ sym }) => !hidden[sym])
              .sort((a, b) => (b.raw[hover] ?? 0) - (a.raw[hover] ?? 0))
              .map(({ sym, raw }) => raw[hover] != null && (
                <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 4 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: COMM_WL_COLOR[sym], flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8' }}>{COMM_WL_META.find(([s]) => s === sym)?.[1] ?? sym}</span>
                  </span>
                  <span style={{ fontFamily: DMONO, fontSize: 12, color: '#e8edf5', fontWeight: 600 }}>{raw[hover].toFixed(1)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
              fontFamily: DMONO, fontSize: 11.5, fontWeight: 600, color: r === range ? '#e8edf5' : '#64748b',
              background: r === range ? '#1b2736' : 'transparent', border: `1px solid ${r === range ? '#243446' : 'transparent'}` }}>{r}</button>
          ))}
        </div>
        {(() => {
          const lastDate = data?.dates?.[data.dates.length - 1];
          const todayStr = (() => { const d = new Date(), dw = d.getDay(); d.setDate(d.getDate() - (dw === 1 ? 3 : dw >= 2 ? 1 : 0)); return d.toISOString().slice(0, 10); })();
          const dow = new Date().getDay();
          const isStale = data && lastDate && lastDate < todayStr && dow !== 0 && dow !== 6;
          const dotColor = !data ? '#64748b' : isStale ? '#f59e0b' : '#22c55e';
          const dotGlow  = !data ? 'none' : isStale ? '0 0 6px rgba(245,158,11,.6)' : '0 0 6px #22c55e';
          const label    = !data ? 'Loading…' : isStale ? `Stale · ${lastDate}` : 'Live';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: DSANS, fontSize: 10.5, color: '#8295a9' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, boxShadow: dotGlow }} />
              {label}
            </span>
          );
        })()}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px', marginTop: 14 }}>
        {COMM_WL_META.map(([sym, label, c]) => {
          const isHidden = hidden[sym];
          return (
            <button key={sym} onClick={() => setHidden(h => ({ ...h, [sym]: !h[sym] }))}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, opacity: isHidden ? 0.3 : 1, transition: 'opacity .15s' }}>
              <svg width="18" height="4" viewBox="0 0 18 4" style={{ flexShrink: 0 }}><rect x="0" y="0" width="18" height="4" rx="2" fill={c} /></svg>
              <span style={{ fontFamily: DSANS, fontSize: 11.5, color: isHidden ? '#64748b' : '#94a3b8' }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Shared tone helper ──────────────────────────────────────────────────────
function _tc(st) { return st === 'bullish' ? '#22c55e' : st === 'bearish' ? '#ef4444' : '#f59e0b'; }

// ── Breadth Diagnostics ─────────────────────────────────────────────────────
function buildBreadthDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const p0 = r0 ? parseFloat(r0[1]) : null;
  const p1 = r1 ? parseFloat(r1[1]) : null;
  const zone = p0 == null ? 'No data'
    : p0 >= 70 ? `Bull Zone — ${p0.toFixed(1)}% above 200d; broad participation confirmed`
    : p0 >= 40 ? `Mixed Zone — ${p0.toFixed(1)}% above 200d; market is bifurcating`
    : `Bear Zone — ${p0.toFixed(1)}% above 200d; broad exposure carries elevated risk`;
  const zoneColor = p0 == null ? '#94a3b8' : p0 >= 70 ? '#22c55e' : p0 >= 40 ? '#f59e0b' : '#ef4444';
  const align = p0 != null && p1 != null
    ? (p0 >= 60 && p1 >= 60 ? 'Bullishly Aligned — both 50d and 200d breadth confirm the uptrend; durable setup'
      : p0 < 40 && p1 < 40 ? 'Bearishly Aligned — both measures confirm deterioration; no near-term floor visible'
      : Math.abs(p0 - p1) > 20 ? 'Diverging — watch the faster 50d SMA for an early-turn signal'
      : 'Neutral Mix — no strong alignment; monitor for convergence') : '—';
  const alignColor = p0 != null && p1 != null
    ? (p0 >= 60 && p1 >= 60 ? '#22c55e' : p0 < 40 && p1 < 40 ? '#ef4444' : '#f59e0b')
    : '#94a3b8';
  return [
    { label: 'NYSE 200d Breadth',  q: 'What % of NYSE stocks are above their 200-day SMA?',                          a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'NYSE 50d Breadth',   q: 'What % of NYSE stocks are above their 50-day SMA?',                           a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'SECTOR BREADTH',           q: 'How many S&P 500 sector ETFs are above their 200-day SMA?',                  a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'Consumer Health Check',   q: 'Is the Consumer Discretionary equal-weight ETF (RSPD) above its 200d SMA?',  a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'Breadth Zone',            q: 'What zone is the long-term breadth reading in, and what does it imply?',      a: zone,              c: zoneColor },
    { label: '50d vs 200d Alignment',   q: 'Are short and long-term breadth signals pointing in the same direction?',     a: align,             c: alignColor },
  ];
}

// ── Valuations Diagnostics + Metrics ────────────────────────────────────────
function buildValuationsDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const capeVal = r1 ? parseFloat(r1[1]) : null;
  const capeImpl = capeVal == null ? '—'
    : capeVal > 35 ? `At ${capeVal.toFixed(1)}× — 10-year real returns historically 0–2% p.a.; favour cash flow over growth`
    : capeVal > 25 ? `At ${capeVal.toFixed(1)}× — expected 10-year real returns below the ~6% historical average; quality bias is prudent`
    : `At ${capeVal.toFixed(1)}× — near long-run average; forward return expectations are more normal`;
  const capeImplColor = capeVal == null ? '#94a3b8' : capeVal > 35 ? '#ef4444' : capeVal > 25 ? '#f59e0b' : '#22c55e';
  const statuses = rows.slice(0, 3).map(r => r ? r[3] : null).filter(Boolean);
  const allBear = statuses.length > 0 && statuses.every(s => s === 'bearish');
  const allBull = statuses.length > 0 && statuses.every(s => s === 'bullish');
  const consistency = allBear
    ? 'All Three Signals Bearish — valuation risk is broad-based; multiples are uniformly elevated'
    : allBull
    ? 'All Three Signals Constructive — valuation metrics near average; near-normal expected returns'
    : 'Mixed Signals — weight CAPE and Buffett Indicator over Trailing P/E for long-run return outlook';
  const consistencyColor = allBear ? '#ef4444' : allBull ? '#22c55e' : '#f59e0b';
  return [
    { label: 'Trailing P/E (S&P 500)', q: 'Is the current price-to-earnings ratio elevated vs history?',                      a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'CAPE (Shiller)',          q: 'What does the cyclically adjusted P/E (10-yr earnings) say about long-run value?', a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'Buffett Indicator',       q: 'Is total US market cap elevated relative to GDP?',                                 a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'Japan vs US Valuation',   q: 'Do international equities (Japan/EWJ) offer a valuation advantage over US?',      a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'CAPE Return Implication', q: 'What do current CAPE levels imply for expected 10-year real returns?',             a: capeImpl,          c: capeImplColor },
    { label: 'Signal Consistency',      q: 'Do all three valuation signals agree, or is there a mixed read?',                  a: consistency,       c: consistencyColor },
  ];
}
function buildValuationsMetrics(card) {
  const stats = card.stats || [];
  const cape = stats.find(s => (s[0]||'').toLowerCase().includes('cape'));
  const pe   = stats.find(s => (s[0]||'').toLowerCase().includes('trailing'));
  const buff = stats.find(s => (s[0]||'').toLowerCase().includes('buffett'));

  const capeNum = cape ? parseFloat(cape[1]) : null;
  const peNum   = pe   ? parseFloat(pe[1])   : null;
  const buffNum = buff ? parseFloat(buff[1])  : null;

  const capeCond2 = capeNum == null ? 'No Data'
    : capeNum > 40 ? 'Extreme — Limit Equity Exposure'
    : capeNum > 35 ? 'Very High — Reduce Allocation'
    : capeNum > 25 ? 'Elevated — Quality & Value Bias'
    : 'Near Average — Normal Returns';
  const peCond2 = peNum == null ? 'No Data'
    : peNum > 22 ? 'Elevated — Favour Value Over Growth'
    : peNum > 18 ? 'Above Average — Quality Bias'
    : peNum > 16 ? 'Near Average — Fully Valued'
    : 'Below Average — Add on Weakness';
  const buffCond2 = buffNum == null ? 'No Data'
    : buffNum > 160 ? 'Extreme — Limit Equity Exposure'
    : buffNum > 115 ? 'Overvalued — Reduce Equity Weight'
    : buffNum > 80  ? 'Fair Value — Neutral Allocation'
    : 'Undervalued — Accumulate on Dips';

  const capeTriggers = [
    { label: 'Extreme',    text: '> 40×  Near 2000 peak — limit equity exposure',           color: '#ef4444' },
    { label: 'Very High',  text: '35–40×  Top decile — reduce equity allocation',       color: '#ef4444' },
    { label: 'Elevated',   text: '25–35×  Above ~17× avg — quality and value bias', color: '#f59e0b' },
    { label: 'Fair Value', text: '16–25×  Near long-run average — normal returns',      color: '#22c55e' },
    { label: 'Cheap',      text: '< 16×  Below average — above-avg returns historically',   color: '#22c55e' },
  ];
  const peTriggers = [
    { label: 'Elevated',   text: '> 22×  Above history — favour quality and value',         color: '#ef4444' },
    { label: 'Above Avg',  text: '18–22×  Elevated — be selective in sector adds',      color: '#f59e0b' },
    { label: 'Fair',       text: '16–18×  Near long-run average — no clear signal',     color: '#22c55e' },
    { label: 'Cheap',      text: '< 16×  Below average — add equity on weakness',           color: '#22c55e' },
  ];
  const buffTriggers = [
    { label: 'Extreme',    text: '> 160%  Near dot-com peak — materially limit equity',          color: '#ef4444' },
    { label: 'Overvalued', text: '115–160%  Above GDP — expect below-avg 10yr returns',     color: '#ef4444' },
    { label: 'Fair',       text: '80–115%  Fair-value range for this metric',                    color: '#22c55e' },
    { label: 'Cheap',      text: '< 80%  Undervalued vs GDP — historically above-avg returns',   color: '#22c55e' },
  ];

  const _vNearAny = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const _vDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const capeWarn = _vNearAny(capeNum, [40, 35, 25, 16], 2);
  const peWarn   = _vNearAny(peNum,   [22, 18, 16], 1);
  const buffWarn = _vNearAny(buffNum, [160, 115, 80], 5);
  return [
    ['Trailing P/E', pe ? pe[1] : '—', 'S&P 500 Price / Trailing 12mo EPS  (avg ~16×)', pe ? pe[3] : null, peCond2, peTriggers, _vDir(pe?.[3]), peWarn],
  ];
}

// ── Yield Diagnostics + Metrics ─────────────────────────────────────────────
function buildYieldDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const y30 = r0 ? parseFloat(r0[1]) : null;
  const threshold = y30 == null ? '—'
    : y30 >= 5 ? `${y30.toFixed(2)}% — ABOVE the 5% critical level; equity multiple compression historically confirmed`
    : y30 > 4.5 ? `${y30.toFixed(2)}% — approaching 5%; elevated but not yet at the critical threshold`
    : `${y30.toFixed(2)}% — below 5%; long-duration assets and growth equities are supported`;
  const threshColor = y30 == null ? '#94a3b8' : y30 >= 5 ? '#ef4444' : y30 > 4.5 ? '#f59e0b' : '#22c55e';
  const actionA = r0 && r2
    ? (r0[3] === 'bearish' && r2[3] === 'bearish'
      ? 'Both 30Y yield and curve are bearish — shorten duration aggressively, hold cash, avoid rate-sensitive sectors'
      : r0[3] === 'bullish' && r2[3] === 'bullish'
      ? 'Both 30Y yield and curve are constructive — maintain equity and bond exposure; duration is not a drag'
      : 'Mixed signals — reduce new rate-sensitive adds; wait for yield level and curve to align')
    : '—';
  const actionColor = r0 && r2
    ? (r0[3]==='bearish'&&r2[3]==='bearish' ? '#ef4444' : r0[3]==='bullish'&&r2[3]==='bullish' ? '#22c55e' : '#f59e0b')
    : '#94a3b8';
  return [
    { label: '30Y Yield (^TYX)',      q: 'Is the 30-year yield above the critical 5% threshold for equity multiples?', a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: '10Y Yield (^TNX)',      q: 'Is the 10-year yield in restrictive territory (≥4.5%)?',                    a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'Yield Curve (3m–10Y)',  q: 'Is the yield curve inverted, flat, or steepening?',                         a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: '2Y Trend (SHY)',        q: 'Is the 2yr Treasury ETF above or below its 200-day average — is the short end easing or tightening?', a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: '5% Threshold Check',   q: 'Has the 30-year yield crossed the historically critical 5% level?',          a: threshold,         c: threshColor },
    { label: 'Combined Rate Action', q: 'What is the combined signal from yield level and curve shape?',               a: actionA,           c: actionColor },
  ];
}
function buildYieldMetrics(card) {
  const stats = card.stats || [];
  const s30 = stats.find(s => (s[0]||'').includes('30Y'));
  const s10 = stats.find(s => (s[0]||'').includes('10Y'));
  const sc  = stats.find(s => (s[0]||'').includes('Curve'));
  const y30T = [
    { label: 'Critical Zone',  text: '≥ 5%  Shorten duration; hold cash; avoid REITs and utilities', color: '#ef4444' },
    { label: 'Danger Zone',    text: '4.5–5%  Reduce rate-sensitive exposure; watch for 5% breach',   color: '#ef4444' },
    { label: 'Watch Zone',     text: '3.5–4.5%  Elevated; headwind for growth stocks and housing',    color: '#f59e0b' },
    { label: 'Supportive',     text: '< 3.5%  Low rates support multiples; extend duration on dips',  color: '#22c55e' },
  ];
  const y10T = [
    { label: 'Restrictive',   text: '≥ 4.5%  Compressing multiples; avoid rate-sensitive sectors',    color: '#ef4444' },
    { label: 'Elevated',      text: '3.5–4.5%  Headwind for growth stocks and housing',               color: '#f59e0b' },
    { label: 'Accommodative', text: '< 3.5%  Supports equity multiples; growth and REIT favoured',   color: '#22c55e' },
  ];
  const curT = [
    { label: 'Deep Inversion', text: '< -0.5%  Recession risk elevated; position defensively',        color: '#ef4444' },
    { label: 'Inverted',       text: '-0.5% to 0%  Recession warning; reduce cyclical exposure',      color: '#ef4444' },
    { label: 'Flat',           text: '0 to +1%  Transition zone; monitor for steepening',            color: '#f59e0b' },
    { label: 'Steepening',     text: '> +1%  Growth expectations rebuilding; add cyclicals',          color: '#22c55e' },
  ];
  const cc = (s, pos, neg) => s ? (s[3]==='pos' ? pos : s[3]==='neg' ? neg : 'Monitor') : '—';
  const _yDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _yNear = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const y30val = s30 ? parseFloat(s30[1]) : null;
  const y10val = s10 ? parseFloat(s10[1]) : null;
  const scval  = sc  ? parseFloat(sc[1])  : null;
  const y30warn = _yNear(y30val, [5.0, 4.5, 3.5], 0.2);
  const y10warn = _yNear(y10val, [4.5, 3.5], 0.2);
  const scwarn  = _yNear(scval,  [0, 1.0], 0.2);
  return [
    s30 ? [s30[0],s30[1],s30[2],s30[3],cc(s30,'Supportive — Duration OK',           'Above Threshold — Shorten Duration'),  y30T,_yDir(s30[3]),y30warn] : ['30Y Yield',   '—','5% = headwind',    null,'—',y30T,null,false],
    s10 ? [s10[0],s10[1],s10[2],s10[3],cc(s10,'Accommodative — Stay Positioned',    'Restrictive — Reduce Rate Exposure'),  y10T,_yDir(s10[3]),y10warn] : ['10Y Yield',   '—','4.5%+ restrictive', null,'—',y10T,null,false],
    sc  ? [sc[0], sc[1], sc[2], sc[3], cc(sc, 'Steepening — Risk On',               'Inverted — Recession Warning'),        curT,_yDir(sc[3]), scwarn]  : ['Yield Curve', '—','inversion = risk',  null,'—',curT,null,false],
  ];
}

// ── Yield Metrics: 3×3 grid (current values / days in zone / 10d ROC) ──
function YieldMetricsBoxes({ card }) {
  const [live, setLive] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetch(`/api/history?symbol=%5ETYX&range=1y&d=${today}`).then(r => r.json()),
      fetch(`/api/history?symbol=%5ETNX&range=1y&d=${today}`).then(r => r.json()),
      fetch(`/api/history?symbol=SHY&range=1y&d=${today}`).then(r => r.json()),
      fetch(`/api/treasury-2y?range=20d`).then(r => r.json()),
    ]).then(([tyx, tnx, shy, two]) => {
      if (!alive) return;
      const tyxC  = (tyx.closes || []).map(Number).filter(v => !isNaN(v));
      const tnxC  = (tnx.closes || []).map(Number).filter(v => !isNaN(v));
      const shyC  = (shy.closes || []).map(Number).filter(v => !isNaN(v));
      const shyV2 = (shy.vs200  || []).map(v => (v == null || isNaN(Number(v))) ? null : Number(v));
      const twoC  = (two.closes || []).map(Number).filter(v => !isNaN(v));
      const twoY  = twoC.length > 0 ? twoC[twoC.length - 1] : null;
      const streak = (arr, test) => {
        let n = 0;
        for (let i = arr.length - 1; i >= 0; i--) {
          const v = arr[i];
          if (v == null || isNaN(v)) break;
          if (test(v)) n++; else break;
        }
        return n > 0 ? n : null;
      };
      const tyx30  = tyxC.length  > 0 ? tyxC[tyxC.length - 1]   : null;
      const tnx10  = tnxC.length  > 0 ? tnxC[tnxC.length - 1]   : null;
      const shyV   = shyV2.length > 0 ? shyV2[shyV2.length - 1] : null;
      const days30  = tyx30 != null ? streak(tyxC, v =>
        tyx30 >= 5.0  ? v >= 5.0 :
        tyx30 >= 4.5  ? v >= 4.5 && v < 5.0 :
        tyx30 >= 3.5  ? v >= 3.5 && v < 4.5 : v < 3.5) : null;
      const days10  = tnx10 != null ? streak(tnxC, v =>
        tnx10 >= 4.5  ? v >= 4.5 :
        tnx10 >= 3.5  ? v >= 3.5 && v < 4.5 : v < 3.5) : null;
      const daysShy = shyV  != null ? streak(shyV2, v => shyV  >  0   ? v >  0   : v <= 0)  : null;
      const roc30  = tyxC.length >= 11 ? tyxC[tyxC.length - 1] - tyxC[tyxC.length - 11] : null;
      const roc10  = tnxC.length >= 11 ? tnxC[tnxC.length - 1] - tnxC[tnxC.length - 11] : null;
      const rocShy = shyC.length >= 11 ? ((shyC[shyC.length - 1] / shyC[shyC.length - 11]) - 1) * 100 : null;
      setLive({ tyx30, tnx10, shyV, days30, days10, daysShy, roc30, roc10, rocShy, twoY });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const stats   = card.stats || [];
  const cardRows = card.rows || [];
  const s30  = stats.find(s => (s[0]||'').includes('30Y'));
  const s10  = stats.find(s => (s[0]||'').includes('10Y'));
  const rShy = cardRows.find(r => (r[0]||'').includes('2Y Trend') || ((r[0]||'').includes('SHY') && !(r[0]||'').includes('Days')));
  const normT = (s) => s === 'pos' || s === 'neg' ? s : s === 'bullish' ? 'pos' : s === 'bearish' ? 'neg' : null;
  const _dir  = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const shyTone = normT(rShy?.[3]);
  const near30  = live?.tyx30 != null && (Math.abs(live.tyx30 - 5.0) <= 0.2 || Math.abs(live.tyx30 - 4.5) <= 0.2);
  const near10  = live?.tnx10 != null && (Math.abs(live.tnx10 - 4.5) <= 0.2 || Math.abs(live.tnx10 - 3.5) <= 0.2);

  const y30T = [
    { label: 'Critical Zone', text: '≥ 5%  Shorten duration; hold cash; avoid REITs and utilities', color: '#ef4444' },
    { label: 'Danger Zone',   text: '4.5–5%  Reduce rate-sensitive exposure; watch for 5% breach',  color: '#ef4444' },
    { label: 'Watch Zone',    text: '3.5–4.5%  Elevated; headwind for growth stocks and housing',   color: '#f59e0b' },
    { label: 'Supportive',    text: '< 3.5%  Low rates support multiples; extend duration on dips', color: '#22c55e' },
  ];
  const y10T = [
    { label: 'Restrictive',   text: '≥ 4.5%  Compressing multiples; avoid rate-sensitive sectors',  color: '#ef4444' },
    { label: 'Elevated',      text: '3.5–4.5%  Headwind for growth stocks and housing',             color: '#f59e0b' },
    { label: 'Accommodative', text: '< 3.5%  Supports equity multiples; growth and REIT favoured', color: '#22c55e' },
  ];
  const shyT = [
    { label: 'Easing',  text: 'Above 200d SMA  Short rates falling; market pricing Fed cuts or pause', color: '#22c55e' },
    { label: 'Hawkish', text: 'Below 200d SMA  Short rates rising; Fed in tightening mode',            color: '#ef4444' },
  ];

  // Row 1 — current benchmark values; derive conditions from live yield values for accuracy
  const L = live;
  const cc30  = L?.tyx30 != null
    ? (L.tyx30 >= 5.0  ? 'At/Above 5% — Shorten Duration'
       : L.tyx30 >= 4.5 ? 'Approaching 5% — Reduce Duration Risk'
       : L.tyx30 >= 3.5 ? 'Watch Zone — Monitor Rate Path'
       : 'Below 3.5% — Multiples Supported')
    : (cardRows.find(r => (r[0]||'').includes('30Y'))?.[2] || '—');
  const cc10  = L?.tnx10 != null
    ? (L.tnx10 >= 4.5  ? 'Restrictive — Reduce Rate Exposure'
       : L.tnx10 >= 3.5 ? 'Elevated — Headwind for Growth'
       : 'Accommodative — Stay Positioned')
    : (cardRows.find(r => (r[0]||'').includes('10Y') && !(r[0]||'').includes('Curve'))?.[2] || '—');
  const t30   = L?.tyx30 != null ? (L.tyx30 >= 5.0 ? 'neg' : L.tyx30 >= 4.5 ? null : L.tyx30 >= 3.5 ? null : 'pos') : normT(s30?.[3]);
  const t10   = L?.tnx10 != null ? (L.tnx10 >= 4.5 ? 'neg' : L.tnx10 >= 3.5 ? null : 'pos') : normT(s10?.[3]);
  const ccShy = rShy?.[2] || (shyTone === 'pos' ? 'Above 200d — Short Rates Easing · Fed Dovish' : shyTone === 'neg' ? 'Below 200d — Short Rates Rising · Fed Hawkish' : '—');
  const d30roc = L?.roc30 != null ? (L.roc30 > 0 ? 'up' : 'down') : null;
  const d10roc = L?.roc10 != null ? (L.roc10 > 0 ? 'up' : 'down') : null;
  const row1 = [
    [s30?.[0] || '30Y Benchmark', s30?.[1] || '—', 'US 30-Year Yield (^TYX)', t30,      cc30,  y30T, d30roc,         near30, false],
    [s10?.[0] || '10Y Benchmark', s10?.[1] || '—', 'US 10-Year Yield (^TNX)', t10,      cc10,  y10T, d10roc,         near10, false],
    ['2Y Trend', L?.twoY != null ? L.twoY.toFixed(2) + '%' : (rShy?.[1] || '—'),        'SHY — 1-3yr Treasury ETF vs 200d SMA', shyTone, ccShy, shyT, _dir(shyTone), false],
  ];

  // Row 2 — days in zone
  const fmtD   = (n) => n != null ? String(n) : '—';
  const z30t   = L?.tyx30 != null ? (L.tyx30 >= 5.0 ? 'neg' : L.tyx30 >= 4.5 ? 'neg' : L.tyx30 >= 3.5 ? null : 'pos') : null;
  const z10t   = L?.tnx10 != null ? (L.tnx10 >= 4.5 ? 'neg' : L.tnx10 >= 3.5 ? null : 'pos') : null;
  const zSt    = L?.shyV  != null ? (L.shyV  >  0   ? 'pos' : 'neg') : null;
  const z30kpi = L?.tyx30 != null ? (L.tyx30 >= 5.0 ? 'Consecutive days ≥ 5.0%' : L.tyx30 >= 4.5 ? 'Consecutive days 4.5–5.0%' : L.tyx30 >= 3.5 ? 'Consecutive days 3.5–4.5%' : 'Consecutive days < 3.5%') : 'Consecutive days in zone';
  const z10kpi = L?.tnx10 != null ? (L.tnx10 >= 4.5 ? 'Consecutive days ≥ 4.5%' : L.tnx10 >= 3.5 ? 'Consecutive days 3.5–4.5%' : 'Consecutive days < 3.5%') : 'Consecutive days in zone';
  const zSkpi  = L?.shyV  != null ? (L.shyV  >  0   ? 'Consecutive days above 200d SMA' : 'Consecutive days below 200d SMA') : 'Consecutive days in zone';
  const z30c   = L?.tyx30 != null ? (L.tyx30 >= 5.0 ? 'Critical Level — Equity Headwind Active' : L.tyx30 >= 4.5 ? 'Danger Zone — Watch for 5% Breach' : L.tyx30 >= 3.5 ? 'Watch Zone — Monitor Rate Path' : 'Supportive Range — Duration Favoured') : '—';
  const z10c   = L?.tnx10 != null ? (L.tnx10 >= 4.5 ? 'Restrictive — Compressing Multiples' : L.tnx10 >= 3.5 ? 'Elevated — Headwind for Growth' : 'Accommodative — Equities Supported') : '—';
  const zSc    = L?.shyV  != null ? (L.shyV  >  0   ? 'Above 200d — Short Rates Easing' : 'Below 200d — Short Rates Tightening') : '—';
  // direction: yields above 3.5% = headwind = down arrow (red); below = up (green). SHY: above 200d = up, below = down.
  const z30dir = L?.tyx30 != null ? (L.tyx30 < 3.5 ? 'up' : 'down') : null;
  const z10dir = L?.tnx10 != null ? (L.tnx10 < 3.5 ? 'up' : 'down') : null;
  const daysZoneT = [
    { label: '>60 days',   text: 'Entrenched — zone is deeply established; trend unlikely to reverse near-term; position with conviction', color: '#f59e0b' },
    { label: '20–60 days', text: 'Confirmed — pattern established; adjust positioning to align with the zone',                            color: '#f59e0b' },
    { label: '5–20 days',  text: 'Forming — early confirmation; watch for follow-through before adding exposure',                         color: '#94a3b8' },
    { label: '<5 days',    text: 'Fresh entry — newly entered zone; wait for confirmation before acting on the change',                   color: '#94a3b8' },
  ];
  const row2 = [
    ['30Y Days in Zone', fmtD(L?.days30),  z30kpi, z30t, z30c, daysZoneT, z30dir,    false],
    ['10Y Days in Zone', fmtD(L?.days10),  z10kpi, z10t, z10c, daysZoneT, z10dir,    false],
    ['SHY Days in Zone', fmtD(L?.daysShy), zSkpi,  zSt,  zSc,  daysZoneT, _dir(zSt), false],
  ];

  // Row 3 — 10d rate of change
  const fmtBp  = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + Math.round(v * 100) + 'bp';
  const fmtPct = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const r30t   = L?.roc30  != null ? (L.roc30  > 0 ? 'neg' : 'pos') : null;
  const r10t   = L?.roc10  != null ? (L.roc10  > 0 ? 'neg' : 'pos') : null;
  const rSt    = L?.rocShy != null ? (L.rocShy > 0 ? 'pos' : 'neg') : null;
  const r30d   = L?.roc30  != null ? (L.roc30  > 0 ? 'up' : 'down') : null;
  const r10d   = L?.roc10  != null ? (L.roc10  > 0 ? 'up' : 'down') : null;
  const rSd    = L?.rocShy != null ? (L.rocShy > 0 ? 'up' : 'down') : null;
  const r30c   = L?.roc30  != null ? (L.roc30  > 0 ? 'Rising — Long-Bond Headwind Growing'  : 'Falling — Long-Bond Pressure Easing')   : '—';
  const r10c   = L?.roc10  != null ? (L.roc10  > 0 ? 'Rising — Restrictive Trend Deepening' : 'Falling — Rate Pressure Easing')         : '—';
  const rSc    = L?.rocShy != null ? (L.rocShy > 0 ? 'Rising — Short Rates Easing, Fed Dovish' : 'Falling — Short Rates Tightening, Fed Hawkish') : '—';
  const rocBpT = [
    { label: '> +25bp',   text: '>+25bp in 10 days  Rapid rise — rate shock risk; shorten duration aggressively',      color: '#ef4444' },
    { label: '+10–25bp',  text: '+10–25bp  Rising quickly — headwind building; reduce rate-sensitive exposure',         color: '#ef4444' },
    { label: '±10bp',     text: 'Within ±10bp  Range-bound — no directional pressure; hold current positioning',       color: '#f59e0b' },
    { label: '-10–25bp',  text: '-10–25bp  Easing — rate pressure declining; consider extending duration',             color: '#22c55e' },
    { label: '< -25bp',   text: '<-25bp in 10 days  Rapid easing — bond rally underway; extend duration on dips',      color: '#22c55e' },
  ];
  const rocShyT = [
    { label: '> +1%',    text: '>+1% in 10 days  SHY rallying strongly — short rates falling; market pricing Fed pivot',  color: '#22c55e' },
    { label: '+0.3–1%',  text: '+0.3–1%  Mild rally — short-end easing; monitor for continuation',                       color: '#22c55e' },
    { label: '±0.3%',    text: 'Within ±0.3%  Stable — short rates range-bound; no directional signal',                  color: '#f59e0b' },
    { label: '-0.3–1%',  text: '-0.3–1%  Declining — short rates rising; Fed maintaining tightening pressure',           color: '#ef4444' },
    { label: '< -1%',    text: '<-1%  Rapid decline — short rates surging; hawkish regime deepening',                    color: '#ef4444' },
  ];
  const row3 = [
    ['30Y 10d Change', fmtBp(L?.roc30),   '10-day yield change (basis points)', r30t, r30c, rocBpT,  r30d, false, false],
    ['10Y 10d Change', fmtBp(L?.roc10),   '10-day yield change (basis points)', r10t, r10c, rocBpT,  r10d, false, false],
    ['SHY 10d Change', fmtPct(L?.rocShy), '10-day price change',                rSt,  rSc,  rocShyT, rSd,  false, true],
  ];

  return (
    <>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={row1} /></div>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={row2} /></div>
      <StatBoxes stats={row3} />
    </>
  );
}

// ── Currency: 3×3 metric boxes (vs 200d / Days in Zone / Ext. Velocity) ──────
function CurrencyMetricsBoxes() {
  const [uup, setUup] = useStateD(null);
  const [fxe, setFxe] = useStateD(null);
  const [fxy, setFxy] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    const load = (sym, set) =>
      fetch(`/api/history?symbol=${sym}&range=1y`)
        .then(r => r.json())
        .then(d => { if (alive && d.summary) set(d.summary); })
        .catch(() => {});
    load('UUP', setUup); load('FXE', setFxe); load('FXY', setFxy);
    return () => { alive = false; };
  }, []);

  const fmtPct = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const fmtD   = (v) => v == null ? '—' : v + 'd';
  const zDesc  = (z) => z && z.includes('bull') ? 'above 200d SMA' : 'below 200d SMA';

  // UUP: dollar strength = bearish for risk assets (positiveDir=false throughout)
  const uupT200  = (v) => v == null ? null : v >  2 ? 'neg' : v >  0 ? 'neutral' : 'pos';
  const uupZoneT = (z) => z && z.includes('bull') ? 'neg' : z && z.includes('bear') ? 'pos' : 'neutral';
  const uupRocT  = (v) => v == null ? null : v >  1 ? 'neg' : v > -1 ? 'neutral' : 'pos';

  // FXE: euro strength = bullish for risk assets
  const fxeT200  = (v) => v == null ? null : v >  2 ? 'pos' : v > -2 ? 'neutral' : 'neg';
  const fxeZoneT = (z) => z && z.includes('bull') ? 'pos' : z && z.includes('bear') ? 'neg' : 'neutral';
  const fxeRocT  = (v) => v == null ? null : v >  1 ? 'pos' : v > -1 ? 'neutral' : 'neg';

  // FXY: yen is context-dependent — neutral tone
  const fxyT200  = () => 'neutral';
  const fxyZoneT = () => 'neutral';
  const fxyRocT  = () => 'neutral';

  const _dir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;

  const uupVs200T = [
    { label: 'Strong',   text: '> +2%  Dollar well above 200d — headwind for equities, EM, and commodities', color: '#ef4444' },
    { label: 'Near SMA', text: '0 to +2%  Mild dollar strength — watch for breakout or reversal',            color: '#f59e0b' },
    { label: 'Weak',     text: '< 0%  Dollar below 200d — tailwind for risk assets and EM equities',         color: '#22c55e' },
  ];
  const fxeVs200T = [
    { label: 'Strong', text: '> +2%  Euro above 200d — risk-on for European assets; USD softening', color: '#22c55e' },
    { label: 'Near',   text: '-2% to +2%  Euro near 200d — FX signal neutral',                     color: '#f59e0b' },
    { label: 'Weak',   text: '< -2%  Euro below 200d — risk-off; potential USD safe-haven demand', color: '#ef4444' },
  ];
  const fxyVs200T = [
    { label: 'Above 200d', text: 'Yen above 200d — carry trade under pressure; watch for unwind risk', color: '#f59e0b' },
    { label: 'Below 200d', text: 'Yen below 200d — carry trade intact; USD/JPY trend holds',           color: '#94a3b8' },
  ];
  const uupRocTrig = [
    { label: 'Accel',  text: '> +1%  Dollar accelerating — reduce risk exposure, cut EM',            color: '#ef4444' },
    { label: 'Flat',   text: '-1% to +1%  Dollar momentum neutral — no directional signal',           color: '#f59e0b' },
    { label: 'Decel',  text: '< -1%  Dollar losing momentum — improving backdrop for risk assets',    color: '#22c55e' },
  ];
  const fxeRocTrig = [
    { label: 'Accel',  text: '> +1%  Euro gaining momentum — supportive for European equities',       color: '#22c55e' },
    { label: 'Flat',   text: '-1% to +1%  Euro momentum neutral',                                     color: '#f59e0b' },
    { label: 'Decel',  text: '< -1%  Euro losing momentum — consider reducing European exposure',     color: '#ef4444' },
  ];
  const fxyRocTrig = [
    { label: 'Rising',  text: '> +1%  Yen gaining — carry trades at risk; watch for forced unwind',  color: '#f59e0b' },
    { label: 'Flat',    text: '-1% to +1%  Yen momentum neutral',                                     color: '#94a3b8' },
    { label: 'Falling', text: '< -1%  Yen weakening — carry trade remains intact',                    color: '#f59e0b' },
  ];

  const u = uup, f = fxe, y = fxy;

  const row0 = [
    ['UUP vs 200d', fmtPct(u?.currentVs200), 'US Dollar ETF', uupT200(u?.currentVs200), null, uupVs200T, _dir(uupT200(u?.currentVs200)), false, false],
    ['FXE vs 200d', fmtPct(f?.currentVs200), 'Euro ETF',      fxeT200(f?.currentVs200), null, fxeVs200T, _dir(fxeT200(f?.currentVs200)), false, true ],
    ['FXY vs 200d', fmtPct(y?.currentVs200), 'Yen ETF',       fxyT200(),                null, fxyVs200T, null,                            false, true ],
  ];
  const row1 = [
    ['UUP — Days in Zone', fmtD(u?.daysInZone), zDesc(u?.zone), uupZoneT(u?.zone), null, null, null, false, false],
    ['FXE — Days in Zone', fmtD(f?.daysInZone), zDesc(f?.zone), fxeZoneT(f?.zone), null, null, null, false, true ],
    ['FXY — Days in Zone', fmtD(y?.daysInZone), zDesc(y?.zone), fxyZoneT(),        null, null, null, false, true ],
  ];
  const row2 = [
    ['UUP — Ext. Velocity', fmtPct(u?.currentRoc10), '10d rate of change', uupRocT(u?.currentRoc10), null, uupRocTrig, _dir(uupRocT(u?.currentRoc10)), false, false],
    ['FXE — Ext. Velocity', fmtPct(f?.currentRoc10), '10d rate of change', fxeRocT(f?.currentRoc10), null, fxeRocTrig, _dir(fxeRocT(f?.currentRoc10)), false, true ],
    ['FXY — Ext. Velocity', fmtPct(y?.currentRoc10), '10d rate of change', fxyRocT(),                null, fxyRocTrig, null,                            false, true ],
  ];

  return (
    <>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={row0} /></div>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={row1} /></div>
      <StatBoxes stats={row2} />
    </>
  );
}

// ── Valuations: historical-context metric boxes (CAPE / PE / Buffett) ────────
// Follows DEEP_DIVE_STANDARDS.md: StatBoxes 8-field tuples with triggers, direction, warn.
function ValuationsMetricsBoxes() {
  const [vData, setVData] = useStateD(null);
  const [bData, setBData] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    fetch('/api/valuations-history?range=30y').then(r => r.json()).then(d => { if (alive && d.summary) setVData(d); }).catch(() => {});
    fetch('/api/buffett-history?range=30y').then(r => r.json()).then(d => { if (alive && d.summary) setBData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!vData || !bData) return (
    <div style={{ fontFamily: DSANS, fontSize: 12, color: '#475569', padding: '16px 0', textAlign: 'center' }}>Loading metrics…</div>
  );

  const ord = (n) => {
    if (n == null) return '—';
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    return n + (['th','st','nd','rd'][n % 10] || 'th');
  };

  const cS = vData.summary;
  const bS = bData.summary;

  const peStats = (() => {
    const vals    = vData.peRatios || [];
    const valid   = vals.filter(v => v != null && !isNaN(v));
    const lastIdx = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0).pop();
    const cur     = cS.currentPe ?? (lastIdx != null ? vals[lastIdx] : null);
    const avg     = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10 : null;
    const pct     = cur != null && valid.length ? Math.round(valid.filter(v => v <= cur).length / valid.length * 100) : null;
    const asOf    = lastIdx != null && vData.dates?.[lastIdx] ? vData.dates[lastIdx].slice(0, 7) : null;
    return { cur, avg, pct, asOf };
  })();

  // Tone (pos/neg/neutral for StatBoxes color mapping)
  const capeT = (v) => v == null ? null : v > 35 ? 'neg'     : v > 25 ? 'neutral' : 'pos';
  const peT   = (v) => v == null ? null : v > 25 ? 'neg'     : v > 20 ? 'neutral' : 'pos';
  const buffT = (v) => v == null ? null : v > 115 ? 'neg'    : v > 80  ? 'neutral' : 'pos';
  const pctT  = (p) => p == null ? null : p > 90  ? 'neg'    : p > 75  ? 'neutral' : p < 25 ? 'pos' : 'neutral';
  const _dir  = (t) => t === 'neg' ? 'down' : t === 'pos' ? 'up' : null;
  // _vDir: 'up'+positiveDir=false → ▲ red (elevated/bad), 'down'+positiveDir=false → ▼ green (below avg/good)
  const _vDir = (v, ref) => v == null || ref == null ? null : v > ref ? 'up' : 'down';
  const _near = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);

  // Action text
  const capeA = (v) => v == null ? '—' : v > 40 ? 'Extreme — Limit Equity Exposure' : v > 35 ? 'Very High — Reduce Allocation' : v > 25 ? 'Elevated — Quality & Value Bias' : 'Near Average — Normal Returns';
  const peA   = (v) => v == null ? '—' : v > 25 ? 'Elevated — Favour Value Over Growth' : v > 20 ? 'Above Average — Quality Bias' : v > 16 ? 'Near Average — Fully Valued' : 'Below Average — Add on Weakness';
  const buffA = (v) => v == null ? '—' : v > 160 ? 'Extreme — Limit Equity Exposure' : v > 115 ? 'Overvalued — Reduce Equity Weight' : v > 80 ? 'Fair Value — Neutral Allocation' : 'Undervalued — Accumulate on Dips';
  const pctA  = (p) => p == null ? '—' : p > 90  ? 'Extreme — Top Decile Reading'   : p > 75  ? 'High — Above 3rd Quartile'     : p < 25 ? 'Low — Historical Opportunity'   : 'Mid-Range — No Signal';

  // Trigger arrays
  const capeTriggers = [
    { label: 'Extreme',    text: '> 40×  Near 2000 peak — limit equity exposure',            color: '#ef4444' },
    { label: 'Very High',  text: '35–40×  Top decile — reduce equity allocation',            color: '#ef4444' },
    { label: 'Elevated',   text: '25–35×  Above ~17× avg — quality and value bias',          color: '#f59e0b' },
    { label: 'Fair Value', text: '16–25×  Near long-run average — normal returns',           color: '#22c55e' },
    { label: 'Cheap',      text: '< 16×  Below average — above-avg returns historically',    color: '#22c55e' },
  ];
  const peTriggers = [
    { label: 'Elevated',   text: '> 25×  Meaningfully above history — favour value',         color: '#ef4444' },
    { label: 'Above Avg',  text: '20–25×  Elevated — be selective in sector adds',           color: '#f59e0b' },
    { label: 'Fair',       text: '16–20×  Near long-run average — no clear signal',          color: '#22c55e' },
    { label: 'Cheap',      text: '< 16×  Below average — add equity on weakness',            color: '#22c55e' },
  ];
  const buffTriggers = [
    { label: 'Extreme',    text: '> 160%  Near dot-com peak — materially limit equity',      color: '#ef4444' },
    { label: 'Overvalued', text: '115–160%  Above GDP — expect below-avg 10yr returns',      color: '#ef4444' },
    { label: 'Fair',       text: '80–115%  Fair-value range for this metric',                color: '#22c55e' },
    { label: 'Cheap',      text: '< 80%  Undervalued vs GDP — historically above-avg returns', color: '#22c55e' },
  ];
  const pctTriggers = [
    { label: '> 90th',  text: 'Extreme — top decile; historically elevated return risk',            color: '#ef4444' },
    { label: '75–90th', text: 'High — above 3rd quartile; valuations stretched vs history',         color: '#f59e0b' },
    { label: '25–75th', text: 'Mid-range — near historical median; no strong directional signal',   color: '#94a3b8' },
    { label: '< 25th',  text: 'Low — below 1st quartile; historically above-average return outlook', color: '#22c55e' },
  ];

  const capeWarn = _near(cS.currentCape, [40, 35, 25, 16], 2);
  const peWarn   = _near(peStats.cur,    [25, 20, 16],      1.5);
  const buffWarn = _near(bS.current,     [160, 115, 80],    5);

  const capeAsOf = cS.latestDate ? cS.latestDate.slice(0, 7) : '—';
  const buffAsOf = bS.latestDate ? bS.latestDate.slice(0, 7) : '—';

  // 9-field StatBoxes tuples: [label, value, desc, tone, condition, triggers, direction, warn, positiveDir]
  // All valuation boxes use positiveDir=false: ▲ red = elevated (bad), ▼ green = below avg (good)
  // Current & Average share same direction (current vs 30Y avg); Percentile uses pct vs 50th
  const capeDir    = _vDir(cS.currentCape, cS.avgCape);
  const buffDir    = _vDir(bS.current,     bS.avg);
  const peDir      = _vDir(peStats.cur,    peStats.avg);
  const capePctDir = _vDir(cS.percentile,  50);
  const buffPctDir = _vDir(bS.percentile,  50);
  const pePctDir   = _vDir(peStats.pct,    50);

  const capeRow = [
    ['CAPE Shiller', cS.currentCape != null ? cS.currentCape.toFixed(1) + '×' : '—', `as of ${capeAsOf}`,            capeT(cS.currentCape),  capeA(cS.currentCape),  capeTriggers, capeDir,    capeWarn, false],
    ['30Y Average',  cS.avgCape     != null ? cS.avgCape.toFixed(1)     + '×' : '—', 'long-run historical average',  'neutral',              null,                   null,         capeDir,    false,    false],
    ['Percentile',   cS.percentile  != null ? ord(cS.percentile)              : '—', 'of monthly readings in 30Y',   pctT(cS.percentile),    pctA(cS.percentile),    pctTriggers,  capePctDir, false,    false],
  ];
  const buffRow = [
    ['Buffett Indicator', bS.current    != null ? bS.current.toFixed(1)    + '%' : '—', `as of ${buffAsOf}`,             buffT(bS.current),      buffA(bS.current),      buffTriggers, buffDir,    buffWarn, false],
    ['30Y Average',   bS.avg        != null ? bS.avg.toFixed(1)        + '%' : '—', 'long-run historical average',   'neutral',              null,                   null,         buffDir,    false,    false],
    ['Percentile',    bS.percentile != null ? ord(bS.percentile)             : '—', 'of quarterly readings in 30Y',  pctT(bS.percentile),    pctA(bS.percentile),    pctTriggers,  buffPctDir, false,    false],
  ];
  const peRow = [
    ['Trailing P/E', peStats.cur != null ? peStats.cur.toFixed(1) + '×' : '—', peStats.asOf ? `as of ${peStats.asOf}` : '—', peT(peStats.cur),  peA(peStats.cur),  peTriggers,  peDir,    peWarn, false],
    ['30Y Average',  peStats.avg != null ? peStats.avg.toFixed(1) + '×' : '—', 'long-run historical average',                 'neutral',         null,              null,        peDir,    false,  false],
    ['Percentile',   peStats.pct != null ? ord(peStats.pct)             : '—', 'of monthly readings in 30Y',                  pctT(peStats.pct), pctA(peStats.pct), pctTriggers, pePctDir, false,  false],
  ];

  return (
    <>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={capeRow} /></div>
      <div style={{ marginBottom: 10 }}><StatBoxes stats={buffRow} /></div>
      <StatBoxes stats={peRow} />
    </>
  );
}

// ── Valuations: tabbed Trailing P/E | CAPE | Buffett Indicator chart ─────────
const VALUATION_TABS = [
  { key: 'pe',      label: 'Trailing P/E', color: '#a855f7', desc: 'S&P 500 price / trailing 12-month EPS — historical avg ~16×', warnY: 22, warnLabel: 'Elevated (22×)' },
  { key: 'cape',    label: 'CAPE',         color: '#a855f7', desc: 'Shiller cyclically-adjusted P/E ratio — historical avg ~17×',  warnY: 35, warnLabel: 'Very High (35×)' },
  { key: 'buffett', label: 'Buffett',      color: '#a855f7', desc: 'Total US market cap / GDP — fair value 80–115%',               warnY: 115, warnLabel: 'Overvalued (115%)' },
];
const VALUATION_RANGES = ['5Y', '10Y', '20Y', '30Y'];
const VALUATION_RMAP   = { '5Y': '5y', '10Y': '10y', '20Y': '20y', '30Y': '30y' };

function ValuationsChart() {
  const [range, setRange] = useStateD('30Y');
  const [tab,   setTab]   = useStateD('pe');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const r = VALUATION_RMAP[range];
    if (tab === 'buffett') {
      fetch(`/api/buffett-history?range=${r}`)
        .then(res => res.json())
        .then(j => {
          if (!alive || !j.dates?.length) return;
          const vals = (j.ratios || []).map(v => v == null ? null : Number(v));
          const avg  = j.summary?.avg ?? null;
          setLive({
            values: vals, dates: j.dates, label: 'Buffett Indicator',
            lineColor: '#a855f7', format: 'pct_abs',
            thresholds: [
              ...(avg != null ? [{ y: avg, color: '#64748b' }] : []),
              { y: 115, color: '#f59e0b' },
            ],
          });
        }).catch(() => {});
    } else {
      fetch(`/api/valuations-history?range=${r}`)
        .then(res => res.json())
        .then(j => {
          if (!alive || !j.dates?.length) return;
          const vals  = tab === 'cape'
            ? (j.capes    || []).map(v => v == null ? null : Number(v))
            : (j.peRatios || []).map(v => v == null ? null : Number(v));
          const valid = vals.filter(v => v != null && !isNaN(v));
          const avg   = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
          setLive({
            values: vals, dates: j.dates,
            label: tab === 'cape' ? 'CAPE' : 'Trailing P/E',
            lineColor: '#a855f7',
            thresholds: [
              ...(avg != null ? [{ y: avg, color: '#64748b' }] : []),
              { y: tab === 'cape' ? 35 : 22, color: '#f59e0b' },
            ],
          });
        }).catch(() => {});
    }
    return () => { alive = false; };
  }, [range, tab]);

  const cfg = VALUATION_TABS.find(t => t.key === tab) || VALUATION_TABS[0];
  const fakeCard = { seed: 41, trend: 0.15, metric: cfg.label, metricUnit: cfg.desc, metricVal: '' };
  const tabBtn = (active) => ({
    all: 'unset', cursor: 'pointer', padding: '3px 9px', borderRadius: 6,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });
  const title = tab === 'pe' ? 'Trailing P/E Ratio' : tab === 'cape' ? 'Shiller CAPE Ratio' : 'Buffett Indicator';
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>{title}</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>{cfg.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {VALUATION_TABS.map(t => (
            <button key={t.key} style={tabBtn(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`valuations-${tab}`} color={cfg.color} height={210}
        range={range} setRange={setRange} live={live} ranges={VALUATION_RANGES} />
      <div style={{ display: 'flex', gap: 16, marginTop: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="18" height="3" style={{ display: 'block', overflow: 'visible' }}><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>Historical Avg</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="18" height="3" style={{ display: 'block', overflow: 'visible' }}><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>{cfg.warnLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ── Global Flows: tabbed regional ETF chart (price + 200d SMA, one tab per region) ──
const GLOBAL_TABS = [
  { key: 'global',   label: 'Global',   sym: 'ACWI',    color: '#22c55e', desc: 'MSCI ACWI — All Country World ETF, price vs 200d SMA'       },
  { key: 'usa',      label: 'USA',      sym: 'SPY',     color: '#3b82f6', desc: 'S&P 500 SPY — US Large Cap, price vs 200d SMA'               },
  { key: 'canada',   label: 'Canada',   sym: '^GSPTSE', color: '#f97316', desc: 'S&P/TSX Composite — Canada, price vs 200d SMA'               },
  { key: 'europe',   label: 'Europe',   sym: 'FEZ',     color: '#f59e0b', desc: 'Euro STOXX 50 FEZ — Europe, price vs 200d SMA'               },
  { key: 'asia',     label: 'Asia',     sym: 'AIA',     color: '#a855f7', desc: 'iShares Asia 50 AIA — Asia Pacific, price vs 200d SMA'       },
  { key: 'latam',    label: 'LatAm',    sym: 'ILF',     color: '#ec4899', desc: 'iShares LatAm 40 ILF — Latin America, price vs 200d SMA'    },
  { key: 'emerging', label: 'Emerging', sym: 'EEM',     color: '#06b6d4', desc: 'iShares MSCI Emerging Markets EEM, price vs 200d SMA'        },
];

// ── Yield: tabbed 2Y | 10Y | 30Y | 2Y vs 10Y | 30Y vs 10Y chart ────────────
const YIELD_CHART_TABS = [
  { key: '2y',     label: '2Y',          color: '#22c55e', desc: 'US 2-Year Treasury Yield — the Fed expectations signal; rising = tightening cycle, falling = easing cycle' },
  { key: '10y',    label: '10Y',         color: '#22d3ee', desc: 'US 10-Year Treasury Yield — global benchmark rate; at or above 4.5% is restrictive for equities' },
  { key: '30y',    label: '30Y',         color: '#a855f7', desc: 'US 30-Year Treasury Yield — long-bond benchmark; at or above 5% compresses equity multiples' },
  { key: '2y10y',  label: '10Y vs 2Y',  color: '#f97316', desc: '10Y and 2Y yields overlaid — spread (10Y−2Y) positive = normal curve, negative = inverted = recession warning' },
  { key: 'spread', label: '30Y vs 10Y', color: '#f59e0b', desc: '30Y and 10Y yields overlaid — the gap between them shows term premium and long-end risk appetite' },
];
const YIELD_CHART_RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
const YIELD_CHART_RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };

function YieldChart() {
  const [range, setRange] = useStateD('1Y');
  const [tab,   setTab]   = useStateD('2y');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const today = new Date().toISOString().slice(0, 10);
    const r = YIELD_CHART_RMAP[range];
    if (tab === 'spread') {
      Promise.all([
        fetch(`/api/history?symbol=%5ETYX&range=${r}&d=${today}`).then(res => res.json()),
        fetch(`/api/history?symbol=%5ETNX&range=${r}&d=${today}`).then(res => res.json()),
      ]).then(([tyx, tnx]) => {
        if (!alive || !tnx.dates?.length) return;
        const tnxVals = (tnx.closes || []).map(v => v == null ? null : Number(v));
        const tyxMap  = {};
        (tyx.dates || []).forEach((d, i) => { tyxMap[d] = tyx.closes?.[i]; });
        const tyxVals = tnx.dates.map(d => tyxMap[d] != null ? Number(tyxMap[d]) : null);
        const spread  = tyxVals.map((v, i) => v == null || tnxVals[i] == null ? null : v - tnxVals[i]);
        const dataMax = Math.max(...spread.filter(v => v != null && !isNaN(v)).map(Math.abs), 0.01);
        const absMax  = Math.max(dataMax * 1.15, 0.3);
        setLive({
          values:    tyxVals,
          dates:     tnx.dates,
          label:     '30Y',
          lineColor: '#a855f7',
          overlays:  [{ label: '10Y', values: tnxVals, color: '#22d3ee', dash: null }],
          histogram: {
            values:     spread,
            absMax,
            height:     150,
            label:      '30Y−10Y spread',
            thresholds: [
              { y:  1.0, color: '#ef4444', label: '>1% Elevated — Bearish' },
              { y: -0.25, color: '#f59e0b', label: 'Inverted ▼' },
            ],
          },
        });
      }).catch(() => {});
    } else if (tab === '2y10y') {
      Promise.all([
        fetch(`/api/treasury-2y?range=${r}`).then(res => res.json()),
        fetch(`/api/history?symbol=%5ETNX&range=${r}&d=${today}`).then(res => res.json()),
      ]).then(([two, tnx]) => {
        if (!alive || !two.dates?.length) return;
        // Build maps and use only dates present in BOTH sources to avoid gaps
        const twoMap = {};
        (two.dates || []).forEach((d, i) => { if (two.closes?.[i] != null) twoMap[d] = Number(two.closes[i]); });
        const tnxMap = {};
        (tnx.dates || []).forEach((d, i) => { if (tnx.closes?.[i] != null) tnxMap[d] = Number(tnx.closes[i]); });
        const commonDates = Object.keys(twoMap).filter(d => tnxMap[d] != null).sort();
        if (!commonDates.length) return;
        const twoVals = commonDates.map(d => twoMap[d]);
        const tnxVals = commonDates.map(d => tnxMap[d]);
        const spread  = tnxVals.map((v, i) => v - twoVals[i]); // 10Y − 2Y: positive = normal, negative = inverted
        const dataMax = Math.max(...spread.map(Math.abs), 0.01);
        const absMax  = Math.max(dataMax * 1.15, 0.3);
        setLive({
          values:    twoVals,
          dates:     commonDates,
          label:     '2Y',
          lineColor: '#22c55e',
          overlays:  [{ label: '10Y', values: tnxVals, color: '#22d3ee', dash: null }],
          histogram: {
            values:     spread,
            absMax,
            height:     150,
            label:      '10Y−2Y spread',
            thresholds: [
              { y:  1.0, color: '#22c55e', label: '>1% Steep Curve' },
              { y:  0,   color: '#f59e0b', label: 'Inverted ▼' },
            ],
          },
        });
      }).catch(() => {});
    } else if (tab === '2y') {
      fetch(`/api/treasury-2y?range=${r}`)
        .then(res => res.json())
        .then(j => {
          if (!alive || !j.dates?.length) return;
          setLive({
            values:    (j.closes || []).map(v => v == null ? null : Number(v)),
            dates:     j.dates,
            label:     '2Y',
            lineColor: '#22c55e',
            overlays:  [],
          });
        })
        .catch(() => {});
    } else {
      const sym = tab === '30y' ? '%5ETYX' : '%5ETNX';
      const col = tab === '30y' ? '#a855f7' : '#22d3ee';
      const lbl = tab === '30y' ? '30Y' : '10Y';
      fetch(`/api/history?symbol=${sym}&range=${r}&d=${today}`)
        .then(res => res.json())
        .then(j => {
          if (!alive || !j.dates?.length) return;
          setLive({
            values:    (j.closes || []).map(v => v == null ? null : Number(v)),
            dates:     j.dates,
            label:     lbl,
            lineColor: col,
            overlays:  [],
          });
        })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [range, tab]);

  const cfg      = YIELD_CHART_TABS.find(t => t.key === tab) || YIELD_CHART_TABS[0];
  const fakeCard = { seed: 53, trend: 0, metric: cfg.label, metricUnit: cfg.desc, metricVal: '' };
  const tabBtn   = (active, col) => ({
    all: 'unset', cursor: 'pointer', padding: '3px 9px', borderRadius: 6,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });
  const title = tab === '2y' ? '2-Year Treasury Yield'
    : tab === '10y' ? '10-Year Treasury Yield'
    : tab === '30y' ? '30-Year Treasury Yield'
    : tab === '2y10y' ? '10Y vs 2Y Treasury Yield'
    : '30Y vs 10Y Treasury Yield';
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>{title}</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>{cfg.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {YIELD_CHART_TABS.map(t => (
            <button key={t.key} style={tabBtn(tab === t.key, t.color)} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`yield-${tab}`} color={cfg.color} height={210}
        range={range} setRange={setRange} live={live} ranges={YIELD_CHART_RANGES} showDelta={tab === 'spread' || tab === '2y10y'} />
    </div>
  );
}

// ── Yield: Yield Curve Inversion chart (10Y−2Y and 10Y−3M spreads) ──
const YC_SPREAD_TABS = [
  { key: '10y2y', label: '10Y−2Y', color: '#a855f7', desc: 'Fast-moving early warning — leads recession by 12–24 months (high variance)' },
  { key: '10y3m', label: '10Y−3M', color: '#22d3ee', desc: 'Structural confirmation — leads recession by 8–12 months (tighter window)' },
];
const YC_SPREAD_RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
const YC_SPREAD_RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
const spreadCol = v => v >= 0 ? '#22c55e' : '#ef4444';

function YieldSpreadChart() {
  const [range, setRange] = useStateD('5Y');
  const [tab,   setTab]   = useStateD('10y2y');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const today = new Date().toISOString().slice(0, 10);
    const r     = YC_SPREAD_RMAP[range];

    if (tab === '10y2y') {
      Promise.all([
        fetch(`/api/history?symbol=%5ETNX&range=${r}&d=${today}`).then(res => res.json()),
        fetch(`/api/treasury-2y?range=${r}`).then(res => res.json()),
      ]).then(([tnx, two]) => {
        if (!alive || !tnx.dates?.length) return;
        const tnxVals = (tnx.closes || []).map(v => v == null ? null : Number(v));
        const twoMap  = {};
        (two.dates || []).forEach((d, i) => { if (two.closes?.[i] != null) twoMap[d] = Number(two.closes[i]); });
        const twoVals = tnx.dates.map(d => twoMap[d] ?? null);
        const spread  = tnxVals.map((v, i) => v == null || twoVals[i] == null ? null : v - twoVals[i]);
        setLive({ values: spread, dates: tnx.dates, label: '10Y−2Y', format: 'pct',
          colorBy: spread, colorByFn: spreadCol, thresholds: [{ y: 0, color: '#475569' }] });
      }).catch(() => {});
    } else {
      Promise.all([
        fetch(`/api/history?symbol=%5ETNX&range=${r}&d=${today}`).then(res => res.json()),
        fetch(`/api/history?symbol=%5EIRX&range=${r}&d=${today}`).then(res => res.json()),
      ]).then(([tnx, irx]) => {
        if (!alive || !tnx.dates?.length) return;
        const tnxVals = (tnx.closes || []).map(v => v == null ? null : Number(v));
        const irxMap  = {};
        (irx.dates || []).forEach((d, i) => { if (irx.closes?.[i] != null) irxMap[d] = Number(irx.closes[i]); });
        const irxVals = tnx.dates.map(d => irxMap[d] ?? null);
        const spread  = tnxVals.map((v, i) => v == null || irxVals[i] == null ? null : v - irxVals[i]);
        setLive({ values: spread, dates: tnx.dates, label: '10Y−3M', format: 'pct',
          colorBy: spread, colorByFn: spreadCol, thresholds: [{ y: 0, color: '#475569' }] });
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [range, tab]);

  const cfg      = YC_SPREAD_TABS.find(t => t.key === tab) || YC_SPREAD_TABS[0];
  const fakeCard = { seed: 8, trend: 0, metric: 'Yield Curve Inversion', metricUnit: '', metricVal: '' };
  const tabBtn   = (active, col) => ({
    all: 'unset', cursor: 'pointer', padding: '3px 9px', borderRadius: 6,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>Yield Curve Inversion</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>{cfg.desc} — below zero = inverted</div>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {YC_SPREAD_TABS.map(t => (
            <button key={t.key} style={tabBtn(tab === t.key, t.color)} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`yield-spread-${tab}`} color={cfg.color} height={200}
        range={range} setRange={setRange} live={live} ranges={YC_SPREAD_RANGES} />
    </div>
  );
}

function GlobalFlowsChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range, setRange] = useStateD('1Y');
  const [tabKey, setTab]  = useStateD('global');
  const [live, setLive]   = useStateD(null);

  const cfg = GLOBAL_TABS.find(t => t.key === tabKey) || GLOBAL_TABS[0];

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/history?symbol=${encodeURIComponent(cfg.sym)}&range=${RMAP[range]}&d=${today}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.dates?.length) return;
        const closes = (j.closes || []).map(v => v == null ? null : Number(v));
        const sma200 = (j.sma200 || []).map(v => v == null ? null : Number(v));
        setLive({
          values:    closes,
          dates:     j.dates,
          label:     cfg.sym,
          lineColor: cfg.color,
          overlays:  [{ label: '200d SMA', values: sma200, color: '#22d3ee', dash: [4, 3] }],
          vs200:     (j.vs200 || []).map(v => v == null ? null : Number(v)),
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range, tabKey]);

  const fakeCard = { seed: GLOBAL_TABS.findIndex(t => t.key === tabKey), trend: 0, metric: cfg.label, metricUnit: cfg.desc, metricVal: '' };
  const tabBtn = (active, col) => ({
    all: 'unset', cursor: 'pointer', padding: '3px 9px', borderRadius: 6,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>{cfg.label}</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>{cfg.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 320 }}>
          {GLOBAL_TABS.map(t => (
            <button key={t.key} style={tabBtn(tabKey === t.key, t.color)} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`globalflows-${tabKey}`} color={cfg.color} height={200}
        range={range} setRange={setRange} live={live} ranges={RANGES} />
    </div>
  );
}

// ── Currency: FX regime definitions ─────────────────────────────────────────
const FX_REGIMES = [
  {
    key: 'boom',
    label: 'Synchronized Global Boom',
    bgColor: 'rgba(34,197,94,0.07)', borderColor: 'rgba(34,197,94,0.22)', labelColor: '#22c55e', impactColor: '#22c55e',
    test: (u, e, j) => u < -2 && e > 2 && j < -2,
    desc: 'Abundant global liquidity. Capital leaves USD safe-haven to chase corporate growth in Europe while the Yen Carry Trade is wide open — borrowing cheap JPY to buy global assets.',
    impact: 'Strongly Bullish — abundant liquidity drives multi-sector rallies. Buy pullbacks and leverage beta.',
  },
  {
    key: 'squeeze',
    label: 'Global Liquidity Squeeze',
    bgColor: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.22)', labelColor: '#ef4444', impactColor: '#ef4444',
    test: (u, e, j) => u > 2 && e < -2 && j < -2,
    desc: 'Textbook Safety Flight. The Federal Reserve is actively tightening. Capital is leaving global risk assets and huddling into cash-rich US Treasury accounts.',
    impact: 'Bearish — broad market headwind. Multinationals lose on currency conversion. Favor cash or defensive value.',
  },
  {
    key: 'unwind',
    label: 'Systemic Carry Unwind',
    bgColor: 'rgba(245,158,11,0.07)', borderColor: 'rgba(245,158,11,0.3)', labelColor: '#f59e0b', impactColor: '#f59e0b',
    test: (u, e, j) => u < -1 && e < -1 && j > 4,
    desc: 'Margin Call Event. A sudden violent short-squeeze in the Yen forces speculators to dump global equities to buy back JPY and settle carry trade debts.',
    impact: 'Danger — expect rapid broad liquidation spikes. Tighten trailing stops immediately.',
  },
  {
    key: 'eurozone',
    label: 'Eurozone Crisis / Disruption',
    bgColor: 'rgba(249,115,22,0.07)', borderColor: 'rgba(249,115,22,0.22)', labelColor: '#f97316', impactColor: '#f97316',
    test: (u, e, j) => u > 2 && e < -4 && j > 1,
    desc: 'Isolated European Flight. Dollar strength is artificial — EUR crashing on localized geopolitical or debt strain. Capital distributes between USD and JPY for shelter.',
    impact: 'Neutral to Caution — highly volatile. Tech may hold as safe-haven; international value names drop.',
  },
  {
    key: 'balanced',
    label: 'Global Balance',
    bgColor: 'rgba(148,163,184,0.05)', borderColor: 'rgba(148,163,184,0.15)', labelColor: '#94a3b8', impactColor: '#94a3b8',
    test: (u, e, j) => Math.abs(u) < 0.5 && Math.abs(e) < 0.5 && Math.abs(j) < 0.5,
    desc: 'Equilibrium / Churn. Central banks on hold, economic data predictable. Currency markets are quiet — equity moves are driven by raw corporate earnings, not macro noise.',
    impact: "Neutral / Stock Picker's Market — broad indexes chop sideways. Sector rotation dominates.",
  },
];

// ── Currency: Chart 1 — individual price vs 200d SMA ────────────────────────
const CURRENCY_TABS = [
  { key: 'uup', sym: 'UUP', shortLabel: 'USD', label: 'US Dollar',     color: '#f59e0b', desc: 'UUP — DB Dollar Index ETF · safety & liquidity demand — above 200d = tightening financial conditions', bearish: true  },
  { key: 'fxe', sym: 'FXE', shortLabel: 'EUR', label: 'Euro',           color: '#22d3ee', desc: 'FXE — CurrencyShares Euro ETF · broad economic risk appetite — above 200d = risk-on signal',            bearish: false },
  { key: 'fxy', sym: 'FXY', shortLabel: 'JPY', label: 'Japanese Yen',   color: '#a855f7', desc: 'FXY — CurrencyShares Yen ETF · global funding & volatility radar — rapid spike signals carry unwind',  bearish: false },
];
const CURR_RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
const CURR_RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];

function CurrencyChart() {
  const [range, setRange] = useStateD('1Y');
  const [tab,   setTab]   = useStateD('uup');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const cfg = CURRENCY_TABS.find(t => t.key === tab);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/history?symbol=${cfg.sym}&range=${CURR_RMAP[range]}&d=${today}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.dates?.length) return;
        const toNum = v => v == null ? null : Number(v);
        const closes = (j.closes || []).map(toNum);
        const sma200 = (j.sma200 || []).map(toNum);
        const vs200  = (j.vs200  || []).map(toNum);
        setLive({
          values:    closes,
          dates:     j.dates,
          label:     cfg.sym,
          lineColor: cfg.color,
          overlays:  [{ label: '200d SMA', values: sma200, color: '#475569', dash: [4, 3] }],
          vs200,
          colorBy:   cfg.bearish ? vs200.map(v => v != null ? -v : null) : vs200,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range, tab]);

  const cfg = CURRENCY_TABS.find(t => t.key === tab);
  const seeds = { uup: 10, fxe: 11, fxy: 12 };
  const fakeCard = { seed: seeds[tab], trend: 0, metric: cfg.label, metricUnit: cfg.desc, metricVal: '' };
  const btnStyle = (active) => ({
    all: 'unset', cursor: 'pointer', padding: '4px 11px', borderRadius: 7,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>{cfg.label} — Price vs 200-day SMA</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>{cfg.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {CURRENCY_TABS.map(t => (
            <button key={t.key} style={btnStyle(tab === t.key)} onClick={() => setTab(t.key)}>{t.shortLabel}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`currency-${tab}`} color={cfg.color} height={200}
        range={range} setRange={setRange} live={live} ranges={CURR_RANGES} />
    </div>
  );
}

// ── Currency: Chart 2 — FX relationship + regime detector ───────────────────
function CurrencyRegimeChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y'];
  const [range, setRange] = useStateD('6M');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const today = new Date().toISOString().slice(0, 10);
    const r = RMAP[range];
    Promise.all([
      fetch(`/api/history?symbol=UUP&range=${r}&d=${today}`).then(res => res.json()),
      fetch(`/api/history?symbol=FXE&range=${r}&d=${today}`).then(res => res.json()),
      fetch(`/api/history?symbol=FXY&range=${r}&d=${today}`).then(res => res.json()),
    ]).then(([uup, fxe, fxy]) => {
      if (!alive) return;
      const dates = uup.dates || [];
      if (!dates.length) return;
      const toNum = v => v == null ? null : Number(v);
      const rebase = (closes) => {
        const arr = closes.map(toNum);
        const first = arr.find(v => v != null && v > 0);
        if (!first) return arr;
        return arr.map(v => v == null ? null : ((v - first) / first) * 100);
      };
      const fxeByDate = {}, fxyByDate = {};
      (fxe.dates || []).forEach((d, i) => { fxeByDate[d] = (fxe.closes || [])[i]; });
      (fxy.dates || []).forEach((d, i) => { fxyByDate[d] = (fxy.closes || [])[i]; });
      const fxeAligned = dates.map(d => fxeByDate[d] ?? null);
      const fxyAligned = dates.map(d => fxyByDate[d] ?? null);
      // 20-day % change for regime detection
      const pct20 = (arr) => {
        const vals = arr.map(toNum).filter(v => v != null);
        if (vals.length < 2) return 0;
        const sl = vals.slice(-Math.min(20, vals.length));
        return ((sl[sl.length - 1] - sl[0]) / Math.abs(sl[0])) * 100;
      };
      setLive({
        values:    rebase(uup.closes || []),
        dates,
        label:     'UUP (USD)',
        format:    'pct',
        lineColor: '#f59e0b',
        overlays: [
          { label: 'FXE (EUR)', values: rebase(fxeAligned), color: '#22d3ee', dash: null },
          { label: 'FXY (JPY)', values: rebase(fxyAligned), color: '#a855f7', dash: null },
        ],
        thresholds: [{ y: 0, color: '#94a3b8' }],
        pcts: { u: pct20(uup.closes || []), e: pct20(fxeAligned), j: pct20(fxyAligned) },
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const fakeCard = { seed: 13, trend: 0, metric: 'FX Relationship', metricUnit: 'Normalised return from period open', metricVal: '' };
  const regime = live?.pcts ? FX_REGIMES.find(r => r.test(live.pcts.u, live.pcts.e, live.pcts.j)) : null;
  const pcts   = live?.pcts;
  const fmtPct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const pctCol = (v, invert) => v == null ? '#64748b' : (v > 0) !== invert ? '#22c55e' : '#ef4444';

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>FX Relationship — Normalised Performance</div>
        <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>
          <span style={{ color: '#f59e0b', fontWeight: 600 }}>USD rising</span>{' = tighter conditions · '}
          <span style={{ color: '#22d3ee', fontWeight: 600 }}>EUR rising</span>{' = risk appetite · '}
          <span style={{ color: '#a855f7', fontWeight: 600 }}>JPY rising</span>{' = carry unwind risk'}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId="currency-regime" color="#f59e0b" height={200}
        range={range} setRange={setRange} live={live} ranges={RANGES} />
      {pcts && (
        <div style={{ marginTop: 14, background: regime ? regime.bgColor : 'rgba(100,116,139,0.05)', border: `1px solid ${regime ? regime.borderColor : 'rgba(100,116,139,0.14)'}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'USD (UUP)', pct: pcts.u, invert: true  },
              { label: 'EUR (FXE)', pct: pcts.e, invert: false },
              { label: 'JPY (FXY)', pct: pcts.j, invert: false },
            ].map(({ label, pct, invert }) => (
              <div key={label}>
                <div style={{ fontFamily: DMONO, fontSize: 9, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>{label} · 20D</div>
                <div style={{ fontFamily: DMONO, fontSize: 15, fontWeight: 700, color: pctCol(pct, invert) }}>{fmtPct(pct)}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontFamily: DMONO, fontSize: 9, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>FX REGIME</div>
              <div style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, color: regime ? regime.labelColor : '#64748b' }}>
                {regime ? regime.label : 'Mixed Signal'}
              </div>
            </div>
          </div>
          {regime ? (
            <>
              <div style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8', lineHeight: 1.55, marginBottom: 8 }}>{regime.desc}</div>
              <div style={{ fontFamily: DSANS, fontSize: 11.5, fontWeight: 600, color: regime.impactColor }}>S&P 500 Impact — {regime.impact}</div>
            </>
          ) : (
            <div style={{ fontFamily: DSANS, fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>
              No dominant FX regime detected. Currency signals are mixed — equity moves are driven more by earnings and sector rotation than macro currency flows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Credit: tabbed price + 200d SMA chart (Risk / Quality / Global) ───────────
const CREDIT_TABS = {
  risk:    { label: 'Risk Appetite',  sym: 'HYG', color: '#22c55e', desc: 'HYG — High Yield Corp Bond ETF, price vs 200d SMA' },
  quality: { label: 'Credit Quality', sym: 'LQD', color: '#a855f7', desc: 'LQD — Investment Grade Bond ETF, price vs 200d SMA' },
  global:  { label: 'Global Credit',  sym: 'EMB', color: '#f59e0b', desc: 'EMB — EM USD Bond ETF (JP Morgan), price vs 200d SMA' },
};

function CreditChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range, setRange] = useStateD('1Y');
  const [tab,   setTab]   = useStateD('risk');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const { sym } = CREDIT_TABS[tab];
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/history?symbol=${sym}&range=${RMAP[range]}&d=${today}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.dates?.length) return;
        const closes = (j.closes || []).map(v => v == null ? null : Number(v));
        const sma200 = (j.sma200 || []).map(v => v == null ? null : Number(v));
        setLive({
          values:    closes,
          dates:     j.dates,
          label:     sym,
          lineColor: CREDIT_TABS[tab].color,
          overlays:  [{ label: '200d SMA', values: sma200, color: '#22d3ee', dash: [4, 3] }],
          vs200:     (j.vs200 || []).map(v => v == null ? null : Number(v)),
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range, tab]);

  const cfg = CREDIT_TABS[tab];
  const fakeCard = { seed: tab === 'risk' ? 6 : tab === 'quality' ? 7 : 8, trend: 0, metric: cfg.label, metricUnit: cfg.desc, metricVal: '' };
  const btnStyle = (active) => ({
    all: 'unset', cursor: 'pointer', padding: '4px 11px', borderRadius: 7,
    fontFamily: DSANS, fontSize: 11.5, fontWeight: 600,
    color: active ? '#e8edf5' : '#64748b',
    background: active ? '#1b2736' : 'transparent',
    border: `1px solid ${active ? '#243446' : 'transparent'}`,
  });

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>{cfg.label}</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>{cfg.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[['risk','Risk'],['quality','Quality'],['global','Global']].map(([key, lbl]) => (
            <button key={key} style={btnStyle(tab === key)} onClick={() => setTab(key)}>{lbl}</button>
          ))}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId={`credit-${tab}`} color={cfg.color} height={200}
        range={range} setRange={setRange} live={live} ranges={RANGES} />
    </div>
  );
}

// ── Credit: HYG vs LQD normalised-return spread chart ────────────────────────
function CreditSpreadChart() {
  const RMAP   = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y' };
  const RANGES = ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'];
  const [range, setRange] = useStateD('3M');
  const [live,  setLive]  = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    const today = new Date().toISOString().slice(0, 10);
    const r = RMAP[range];
    Promise.all([
      fetch(`/api/history?symbol=HYG&range=${r}&d=${today}`).then(res => res.json()),
      fetch(`/api/history?symbol=LQD&range=${r}&d=${today}`).then(res => res.json()),
    ]).then(([hyg, lqd]) => {
      if (!alive) return;
      const dates = hyg.dates || [];
      if (!dates.length) return;
      const rebase = (closes) => {
        const arr = (closes || []).map(v => v == null ? null : Number(v));
        const first = arr.find(v => v != null && v > 0);
        if (!first) return arr;
        return arr.map(v => v == null ? null : ((v - first) / first) * 100);
      };
      setLive({
        values:    rebase(hyg.closes),
        dates,
        label:     'HYG',
        format:    'pct',
        lineColor: '#22c55e',
        overlays:  [{ label: 'LQD', values: rebase(lqd.closes), color: '#a855f7', dash: null }],
        thresholds: [{ y: 0, color: '#475569' }],
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const fakeCard = { seed: 9, trend: 0, metric: 'HYG vs LQD', metricUnit: '% return from period open', metricVal: '' };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>HYG vs LQD — Relative Performance</div>
        <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>
          {'Normalised return from period open · '}
          <span style={{ color: '#22c55e', fontWeight: 600 }}>HYG outperformance</span>
          {' = risk appetite rising; '}
          <span style={{ color: '#a855f7', fontWeight: 600 }}>LQD outperformance</span>
          {' = flight to quality'}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId="credit-spread" color="#22c55e" height={200}
        range={range} setRange={setRange} live={live} ranges={RANGES} showDelta={true} />
    </div>
  );
}

// ── Credit Diagnostics + Metrics ─────────────────────────────────────────────
function buildCreditDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];
  const leadingA = r0 == null ? '—'
    : r0[3] === 'bearish'
    ? 'Active — HYG is below its 200d SMA; historically leads equity drawdowns by 4–6 weeks'
    : 'Not Active — HYG is above its 200d SMA; no leading credit stress signal at this time';
  const leadingColor = r0 == null ? '#94a3b8' : r0[3] === 'bearish' ? '#ef4444' : '#22c55e';
  const bullCount = rows.filter(r => r && r[3] === 'bullish').length;
  const actionA = bullCount >= 3
    ? 'Credit is broadly constructive — maintain equity and HY exposure; watch HYG as the early warning system'
    : bullCount >= 2
    ? 'Mixed signals — stay selective; favour IG over HY and reduce EM bond duration'
    : 'Credit risk is elevated — reduce HY exposure, shorten duration, shift toward IG or cash';
  const actionColor = bullCount >= 3 ? '#22c55e' : bullCount >= 2 ? '#f59e0b' : '#ef4444';
  return [
    { label: 'HYG — Risk Appetite',      q: 'Is the High-Yield ETF above its 200d SMA, signalling healthy credit?',        a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'Spread Signal (HY vs IG)', q: 'Is the spread widening driven by credit default risk or interest rate moves?', a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'LQD — Investment Grade',   q: 'Is investment-grade credit demand firm, indicating no systemic stress?',       a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'EMB — EM Debt',            q: 'Is EM credit stable, or is contagion risk spreading to global credit?',        a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'Leading Signal Status',    q: 'Is HYG currently flashing an early warning for equity markets?',               a: leadingA,          c: leadingColor },
    { label: 'Portfolio Action',         q: 'What is the overall portfolio action implied by the current credit picture?',  a: actionA,           c: actionColor },
  ];
}
function buildCreditMetrics(card) {
  const stats = card.stats || [];
  // Stats layout from scores.js: [0-2] vs200, [3-5] Days in Zone, [6-8] Ext. Velocity
  const s = (i) => stats[i] || null;

  // Row 0: original HYG/LQD/EMB vs 200d boxes with trigger tooltips
  const hyg = stats[0], lqd = stats[1], emb = stats[2];
  const hygT = [
    { label: 'Healthy',       text: '> 0% vs 200d  Credit benign; maintain equity and HY exposure',  color: '#22c55e' },
    { label: 'At Threshold',  text: '-2% to 0%  Near breakdown; reduce HY, watch closely',           color: '#f59e0b' },
    { label: 'Warning',       text: '-5% to -2%  Below 200d; reduce equity risk, shift to IG',       color: '#ef4444' },
    { label: 'Stress Signal', text: '< -5%  Deep stress; cut HY, hold cash or IG only',             color: '#ef4444' },
  ];
  const lqdT = [
    { label: 'Intact',   text: '> 0% vs 200d  IG demand firm; systemic risk contained',             color: '#22c55e' },
    { label: 'At Level', text: '-2% to 0%  Near 200d; monitor systemic risk indicators',            color: '#f59e0b' },
    { label: 'Broken',   text: '< -2%  IG demand weakening; systemic stress elevated',              color: '#ef4444' },
  ];
  const embT = [
    { label: 'Risk On',   text: '> 0% vs 200d  EM credit stable; EM equity adds supported',        color: '#22c55e' },
    { label: 'Caution',   text: '-2% to 0%  Approaching 200d; reduce unhedged EM exposure',        color: '#f59e0b' },
    { label: 'Contagion', text: '< -2%  EM credit stress active; avoid EM bonds and equities',     color: '#ef4444' },
  ];
  const _cDir  = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _cNear = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const hygNum = hyg ? parseFloat(hyg[1]) : null;
  const lqdNum = lqd ? parseFloat(lqd[1]) : null;
  const embNum = emb ? parseFloat(emb[1]) : null;
  const row0 = [
    hyg ? [hyg[0], hyg[1], hyg[2], hyg[3], null, hygT, _cDir(hyg[3]), _cNear(hygNum, [0, -2, -5], 1)] : ['HYG vs 200d', '—', 'high yield health', null, null, hygT, null, false],
    lqd ? [lqd[0], lqd[1], lqd[2], lqd[3], null, lqdT, _cDir(lqd[3]), _cNear(lqdNum, [0, -2],     1)] : ['LQD vs 200d', '—', 'investment grade',  null, null, lqdT, null, false],
    emb ? [emb[0], emb[1], emb[2], emb[3], null, embT, _cDir(emb[3]), _cNear(embNum, [0, -2],     1)] : ['EMB vs 200d', '—', 'EM credit risk',    null, null, embT, null, false],
  ];

  const row1 = [s(3), s(4), s(5)].filter(Boolean);  // HYG/LQD/EMB Days in Zone
  const row2 = [s(6), s(7), s(8)].filter(Boolean);  // HYG/LQD/EMB Ext. Velocity
  return { row0, row1, row2 };
}

// ── Global Flows Diagnostics + Metrics ──────────────────────────────────────
function buildGlobalFlowsDiagnostics(card) {
  const rows = card.rows || [];
  const byR = (label) => rows.find(r => (r[0]||'').toLowerCase() === label.toLowerCase());
  const rGlobal = byR('Global');
  const rUsa    = byR('USA');
  const rEurope = byR('Europe');
  const rEm     = byR('Emerging');
  const bullCount = rows.filter(r => r[3] === 'bullish').length;
  const usVsIntl = rUsa
    ? (rUsa[3] === 'bullish'
      ? 'US is above its 200d SMA — domestic leadership intact; a US-first allocation bias is justified until international breadth improves'
      : 'US is below its 200d SMA — domestic leadership broken; consider reallocating toward regions still above their 200d SMA')
    : '—';
  const usVsColor = rUsa ? _tc(rUsa[3]) : '#94a3b8';
  const globalAction = bullCount >= 6
    ? 'Broad global expansion — maintain full international allocation; equal-weight regional exposure'
    : bullCount >= 4
    ? 'Partial expansion — favour the strongest regions; underweight those below their 200d SMA'
    : bullCount >= 2
    ? 'Global weakness — raise cash and shift toward the few regions with intact trends'
    : 'Broad global weakness — underweight international equity; favour domestic or cash';
  const actionColor = bullCount >= 6 ? '#22c55e' : bullCount >= 4 ? '#f59e0b' : '#ef4444';
  return [
    { label: 'ACWI — Global Benchmark', q: 'Is the global equity benchmark (ACWI) in a bull or bear market?',               a: rGlobal ? rGlobal[2] : '—', c: rGlobal ? _tc(rGlobal[3]) : '#94a3b8' },
    { label: 'USA (S&P 500)',            q: 'Is the US equity market above its 200d SMA and providing leadership?',          a: rUsa    ? rUsa[2]    : '—', c: rUsa    ? _tc(rUsa[3])    : '#94a3b8' },
    { label: 'Europe (Euro STOXX)',      q: 'Is European equity in an uptrend or a downtrend vs its 200d SMA?',              a: rEurope ? rEurope[2] : '—', c: rEurope ? _tc(rEurope[3]) : '#94a3b8' },
    { label: 'Emerging Markets (EEM)',   q: 'Are EM equities risk-on or risk-off relative to their 200d SMA?',               a: rEm     ? rEm[2]     : '—', c: rEm     ? _tc(rEm[3])     : '#94a3b8' },
    { label: 'US vs International',      q: 'Is domestic or international leadership more intact right now?',                a: usVsIntl,                   c: usVsColor },
    { label: 'Global Allocation Action', q: 'What does the breadth of global signals imply for regional allocation?',        a: globalAction,               c: actionColor },
  ];
}
function buildGlobalFlowsMetrics(card) {
  const stats = card.stats || [];
  const sReg  = stats.find(s => (s[0]||'').toLowerCase().includes('regional'));
  const sAcwi = stats.find(s => (s[0]||'').toLowerCase().includes('acwi'));
  const sEm   = stats.find(s => (s[0]||'').toLowerCase().includes('emerg'));
  const regT = [
    { label: 'Synchronized',text: '6–7 / 7  Global expansion — equal-weight all regions',         color: '#22c55e' },
    { label: 'Partial',     text: '4–5 / 7  Partial expansion — favour strongest regional trends', color: '#22c55e' },
    { label: 'Mixed',       text: '3 / 7  Neutral breadth — selective positioning only',           color: '#f59e0b' },
    { label: 'Weak',        text: '1–2 / 7  Global weakness — reduce international equity',        color: '#ef4444' },
    { label: 'Bear Market', text: '0 / 7  Full global bear — defensives and cash only',            color: '#ef4444' },
  ];
  const acwiT = [
    { label: 'Bull Market', text: 'Above 200d  Global bull market intact — stay invested',         color: '#22c55e' },
    { label: 'Bear Market', text: 'Below 200d  Global bear signal — raise cash; reduce equity',    color: '#ef4444' },
  ];
  const emT = [
    { label: 'EM Risk On',  text: 'Above 200d  EM appetite open — EM equity adds are supported',  color: '#22c55e' },
    { label: 'EM Watch',    text: '-5% to 0%  Near 200d — reduce unhedged EM exposure',            color: '#f59e0b' },
    { label: 'EM Risk Off', text: 'Below 200d  EM risk off — avoid unhedged EM equity and debt',   color: '#ef4444' },
  ];
  const cc = (s, pos, neg) => s ? (s[3]==='pos' ? pos : s[3]==='neg' ? neg : 'Monitor') : '—';
  const _gDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _gNear = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const regCount = sReg ? parseInt(sReg[1]) : null;
  const acwiNum  = sAcwi ? parseFloat(sAcwi[1]) : null;
  const emNum    = sEm   ? parseFloat(sEm[1])   : null;
  const regWarn  = regCount != null && regCount >= 3 && regCount <= 5;
  const acwiWarn = _gNear(acwiNum, [0], 2);
  const emWarn   = _gNear(emNum,   [0, -2], 1);
  return [
    sReg  ? [sReg[0], sReg[1], sReg[2], sReg[3], cc(sReg, 'Broad Expansion — Full Allocation','Global Weakness — Reduce Exposure'), regT, _gDir(sReg[3]), regWarn]  : ['Regional Bull','—','indexes above 200d', null,'—',regT, null,false],
    sAcwi ? [sAcwi[0],sAcwi[1],sAcwi[2],sAcwi[3],cc(sAcwi,'Bull Market Intact',              'Bear Market Signal — Raise Cash'),    acwiT,_gDir(sAcwi[3]),acwiWarn] : ['ACWI vs 200d', '—','global proxy',       null,'—',acwiT,null,false],
    sEm   ? [sEm[0],  sEm[1],  sEm[2],  sEm[3],  cc(sEm,  'EM Risk On — Add EM Exposure',    'EM Risk Off — Avoid EM'),            emT,  _gDir(sEm[3]), emWarn]    : ['Emerg. Mkts',  '—','EM risk appetite',   null,'—',emT,  null,false],
  ];
}

// ── Sectors Diagnostics + Metrics ────────────────────────────────────────────
function buildSectorsDiagnostics(card) {
  const rows  = card.rows  || [];
  const stats = card.stats || [];

  // ── Parse stats ──
  const sCycDef = stats.find(s => (s[0]||'').toLowerCase().includes('cyclical vs') || (s[0]||'').toLowerCase().includes('cyc vs'));
  const sCycs   = stats.find(s => (s[0]||'').toLowerCase() === 'cyclicals');
  const sDefs   = stats.find(s => (s[0]||'').toLowerCase() === 'defensives');

  const spreadVal = sCycDef ? parseFloat(sCycDef[1]) : null;
  const spreadC   = spreadVal == null ? '#94a3b8' : spreadVal > 1 ? '#22c55e' : spreadVal < -1 ? '#ef4444' : '#f59e0b';

  // ── Sector breadth: actual above/below 200d from row prices ──
  const rowsWith200 = rows.filter(r => r[5] != null && r[6] != null);
  const abv200      = rowsWith200.filter(r => r[6] > r[5]).length;
  const total       = rows.length || 11;
  const breadthC    = abv200 >= 9 ? '#22c55e' : abv200 >= 7 ? '#22c55e' : abv200 >= 5 ? '#f59e0b' : '#ef4444';
  const breadthA    = `${abv200} of ${total} sectors above their 200d SMA — ${
    abv200 >= 9 ? 'near-universal participation; regime is broadly supported across the market'
    : abv200 >= 7 ? 'broad sector health; rally is well-supported — stay long'
    : abv200 >= 5 ? 'mixed participation; rally narrowing — concentrate in leaders, reduce laggards'
    : abv200 >= 3 ? 'thin breadth; most sectors below trend — defensive posture warranted'
    : 'sector breakdown; only a handful above 200d — raise cash and wait for breadth to recover'
  }`;

  // ── Cyclical health ──
  const cycParts = sCycs ? sCycs[1].split('/') : null;
  const cycBull  = cycParts ? parseInt(cycParts[0].trim()) : null;
  const cycTotal = cycParts ? parseInt(cycParts[1].trim()) : 7;
  const cycC     = sCycs ? (sCycs[3] === 'pos' ? '#22c55e' : sCycs[3] === 'neg' ? '#ef4444' : '#f59e0b') : '#94a3b8';
  const cycA     = cycBull == null ? '—' : `${cycBull} of ${cycTotal} cyclical sectors above their 200d SMA — ${
    cycBull >= 6 ? 'broad cyclical strength; overweight cyclicals with high conviction'
    : cycBull >= 4 ? 'majority in trend; selective cyclical exposure is warranted'
    : cycBull === 3 ? 'mixed cyclical breadth; no broad cyclical bet — pick individual leaders only'
    : 'cyclicals breaking down; avoid broad cyclical ETFs until breadth recovers'
  }`;

  // ── Defensive posture (inverted: high above-200d = risk-off) ──
  const defParts = sDefs ? sDefs[1].split('/') : null;
  const defBull  = defParts ? parseInt(defParts[0].trim()) : null;
  const defTotal = defParts ? parseInt(defParts[1].trim()) : 4;
  const defC     = sDefs ? (sDefs[3] === 'pos' ? '#22c55e' : sDefs[3] === 'neg' ? '#ef4444' : '#f59e0b') : '#94a3b8';
  const defA     = defBull == null ? '—' : `${defBull} of ${defTotal} defensive sectors above their 200d SMA — ${
    defBull >= 4 ? 'full safe-haven bid; all defensives in trend — investors are rotating to safety; risk-off tilt is warranted'
    : defBull === 3 ? 'strong defensive bid; majority in trend — caution elevated; lean defensive until cyclicals recapture 200d'
    : defBull === 2 ? 'mixed defensive posture; neither confirmed risk-on nor risk-off — stay balanced'
    : 'defensives not in trend; no safe-haven demand — risk-on environment is supported'
  }`;

  // ── Top 3 leaders by 20d relative performance ──
  const top3     = rows.slice(0, 3);
  const leadersA = top3.length
    ? top3.map(r => `${r[0]} (${r[4]}): ${r[2]}`).join(' · ')
    : '—';

  // ── Portfolio action: synthesise rotation + breadth + cyclical signals ──
  const actionC  = spreadVal == null ? '#94a3b8' : spreadVal > 1 ? '#22c55e' : spreadVal < -1 ? '#ef4444' : '#f59e0b';
  const strongCyc = cycBull != null && cycBull >= 5;
  const strongDef = defBull != null && defBull >= 3;
  const actionA  = spreadVal == null ? '—'
    : spreadVal > 3 && strongCyc   ? 'Strong Risk-On — overweight cyclicals; concentrate in 200d leaders; reduce defensives to minimum'
    : spreadVal > 1                 ? 'Risk-On Lean — favor cyclicals outpacing SPY with 200d alignment; hold diversified core'
    : spreadVal < -3 && strongDef  ? 'Strong Risk-Off — shift to defensives and quality; reduce cyclicals; raise cash'
    : spreadVal < -1                ? 'Defensive Lean — reduce cyclical overweight; let defensives anchor the portfolio'
    :                                 'Neutral — no dominant rotation signal; stay diversified; wait for the spread to confirm direction';

  return [
    { label: 'Rotation Signal',   q: 'Are cyclicals or defensives leading on a 20-day average vs SPY?',               a: spreadVal == null ? '—' : `${(spreadVal >= 0 ? '+' : '') + spreadVal.toFixed(1)}% cyclical vs defensive spread (20d avg vs SPY) — ${spreadVal > 1 ? 'cyclicals leading; risk-on rotation confirmed' : spreadVal < -1 ? 'defensives leading; risk-off rotation confirmed' : 'near parity; no clear rotation signal yet'}`, c: spreadC },
    { label: 'Sector Breadth',    q: 'How many of the 11 S&P 500 sectors are above their 200d SMA?',                  a: breadthA,  c: breadthC },
    { label: 'Cyclical Health',   q: 'How many of the 7 cyclical sectors are above their 200d SMA?',                  a: cycA,      c: cycC     },
    { label: 'Defensive Posture', q: 'Are the 4 defensive sectors signaling a risk-off environment?',                 a: defA,      c: defC     },
    { label: 'Sector Leaders',    q: 'Which sectors are leading on 20-day relative performance and worth overweighting?', a: leadersA, c: '#22c55e' },
    { label: 'Portfolio Action',  q: 'What is the implied portfolio action from current sector rotation and breadth?', a: actionA,   c: actionC  },
  ];
}
function buildSectorsMetrics(card) {
  const stats = card.stats || [];
  const sCyc = stats.find(s => (s[0]||'').toLowerCase().includes('cyclical vs') || (s[0]||'').toLowerCase().includes('cyc vs') || (s[0]||'').toLowerCase().includes('cyc v'));
  const sUp  = stats.find(s => (s[0]||'').toLowerCase().includes('cyclicals'));
  const sDef = stats.find(s => (s[0]||'').toLowerCase().includes('defensives'));
  const cycdefT = [
    { label: 'Strong Cyc Lead', text: '> +2%  Cyclicals dominating — overweight cyclicals; risk-on',    color: '#22c55e' },
    { label: 'Mild Cyc Lead',   text: '0 to +2%  Cyclicals slightly ahead — lean cyclical',              color: '#22c55e' },
    { label: 'Neutral',         text: '-0.5% to 0%  No clear rotation signal — stay diversified',        color: '#f59e0b' },
    { label: 'Mild Def Lead',   text: '-2% to -0.5%  Defensives edging ahead — lean defensive',          color: '#f59e0b' },
    { label: 'Def Dominant',    text: '< -2%  Defensives leading — risk-off; reduce cyclicals',          color: '#ef4444' },
  ];
  const cycUpT = [
    { label: 'Broad Cyc Bull',  text: '6–7 / 7  Most cyclicals above 200d — max cyclical exposure',     color: '#22c55e' },
    { label: 'Moderate',        text: '4–5 / 7  Majority above 200d — selective cyclical exposure',      color: '#22c55e' },
    { label: 'Mixed',           text: '3 / 7  Half and half — no clear cyclical bet',                    color: '#f59e0b' },
    { label: 'Weak Cyclicals',  text: '1–2 / 7  Most cyclicals below 200d — avoid broad cyclical ETFs', color: '#ef4444' },
  ];
  const defUpT = [
    { label: 'Safe-Haven Bid',  text: '3–4 / 4  All defensives above 200d — risk-off confirmed',        color: '#ef4444' },
    { label: 'Moderate',        text: '2 / 4  Mixed defensive signal',                                   color: '#f59e0b' },
    { label: 'Risk On',         text: '0–1 / 4  Defensives below 200d — no safe-haven bid; risk-on',    color: '#22c55e' },
  ];
  const cc = (s, pos, neg) => s ? (s[3]==='pos' ? pos : s[3]==='neg' ? neg : 'Monitor') : '—';
  const _sDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _sNear = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const cycVal  = sCyc ? parseFloat(sCyc[1]) : null;
  const upCount = sUp  ? parseInt(sUp[1])    : null;
  const defCount= sDef ? parseInt(sDef[1])   : null;
  const cycWarn = _sNear(cycVal, [0, 2, -2], 0.5);
  const upWarn  = upCount  != null && (upCount  === 3 || upCount  === 4);
  const defWarn = defCount != null && defCount === 2;
  return [
    sCyc ? [sCyc[0],sCyc[1],sCyc[2],sCyc[3],cc(sCyc,'Cyclicals Leading — Overweight',   'Defensives Leading — Reduce Cyclicals'), cycdefT,_sDir(sCyc[3]),cycWarn] : ['Cyclical vs Defensive','—','20d avg vs SPY', null,'—',cycdefT,null,false],
    sUp  ? [sUp[0], sUp[1], sUp[2], sUp[3], cc(sUp, 'Broad Cyclical Participation',       'Cyclicals Weak — Avoid Broad ETFs'),     cycUpT, _sDir(sUp[3]), upWarn]  : ['Cyclicals ↑',  '—','above 200d',     null,'—',cycUpT, null,false],
    sDef ? [sDef[0],sDef[1],sDef[2],sDef[3],cc(sDef,'Defensives Weak — Risk On',         'Defensives Strong — Risk Off Warning'),  defUpT, _sDir(sDef[3]),defWarn] : ['Defensives ↑', '—','above 200d',     null,'—',defUpT, null,false],
  ];
}

// ── Sectors period-summary metrics (from /api/sectors) ──────────────────────
function SectorsApiMetricsRow({ range = '1Y' }) {
  const RMAP = { '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y' };
  const [summary, setSummary] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setSummary(null);
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/sectors?range=${RMAP[range] || '1y'}&d=${today}`)
      .then(r => r.json())
      .then(j => { if (alive && j.summary) setSummary(j.summary); })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  if (!summary) return null;

  const { current, streak, bestCyc, bestCycReturn } = summary;
  const fmtPct    = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const streakAbs = Math.abs(streak || 0);

  const spreadTone   = current > 1 ? 'pos' : current < -1 ? 'neg' : null;
  const spreadAction = current > 10 ? 'Cyclicals Dominating — Period Confirms Risk-On'
    : current > 1  ? 'Cyclicals Ahead — Lean Cyclical'
    : current < -10 ? 'Defensives Dominating — Period Confirms Risk-Off'
    : current < -1  ? 'Defensives Ahead — Lean Defensive'
    : 'Neutral — No Dominant Period Trend';
  const spreadT = [
    { label: 'Cyc Dominant',  text: '> +10%  Cyclicals dominating — risk-on positioning confirmed',          color: '#22c55e' },
    { label: 'Cyc Leading',   text: '+1% to +10%  Cyclicals ahead — lean cyclical; confirm with 20d signal', color: '#22c55e' },
    { label: 'Neutral',       text: '−1% to +1%  No clear period winner — stay diversified',                 color: '#f59e0b' },
    { label: 'Def Leading',   text: '−10% to −1%  Defensives ahead — lean defensive',                        color: '#ef4444' },
    { label: 'Def Dominant',  text: '< −10%  Defensives dominating — risk-off positioning confirmed',        color: '#ef4444' },
  ];

  const streakTone   = streak > 0 ? 'pos' : streak < 0 ? 'neg' : null;
  const streakLabel  = streak === 0 ? 'no streak active'
    : streak > 0 ? `day${streakAbs !== 1 ? 's' : ''} cyclicals leading`
    : `day${streakAbs !== 1 ? 's' : ''} defensives leading`;
  const streakAction = streakAbs >= 6 ? 'Strong Momentum — Adds to Conviction'
    : streakAbs >= 3 ? 'Building Momentum — Watch for Continuation'
    : streakAbs >= 1 ? 'Early — Confirm with 20d Spread'
    : 'No Streak — Mixed Daily Leadership';
  const streakT = [
    { label: 'Strong',   text: '≥ 6 days  Persistent daily leadership — momentum well established', color: '#22c55e' },
    { label: 'Building', text: '3–5 days  Momentum forming — watch for continuation',               color: '#22c55e' },
    { label: 'Early',    text: '1–2 days  Too short to act on — confirm with the 20d spread',      color: '#f59e0b' },
    { label: 'Reversed', text: 'Negative  Defensives leading daily — monitor for trend shift',      color: '#ef4444' },
  ];

  const bestName     = SECT_WL_META.find(([s]) => s === bestCyc)?.[1] ?? bestCyc ?? '—';
  const bestTone     = bestCycReturn > 0 ? 'pos' : bestCycReturn < 0 ? 'neg' : null;
  const bestAction   = `${fmtPct(bestCycReturn)} period return`;
  const bestT = [
    { label: 'Leader', text: 'Top-performing cyclical by cumulative return from period open', color: '#22c55e' },
    { label: 'Note',   text: 'Period = 5Y range; updated nightly via /api/sectors',          color: '#64748b' },
  ];

  const stats = [
    ['Cyclical vs Defensive', fmtPct(current), `${range} period spread`, spreadTone,  spreadAction, spreadT, spreadTone === 'pos' ? 'up' : spreadTone === 'neg' ? 'down' : null, Math.abs(current || 0) < 2],
    ['Streak',        String(streakAbs), streakLabel,        streakTone,  streakAction, streakT, streakTone === 'pos' ? 'up' : streakTone === 'neg' ? 'down' : null, false],
    ['Best Cyclical', bestCyc || '—',   bestName,           bestTone,    bestAction,   bestT,   bestTone === 'pos' ? 'up' : 'down', false],
  ];
  return <StatBoxes stats={stats} />;
}

// ── Commodities Diagnostics + Metrics ───────────────────────────────────────
function buildCommoditiesDiagnostics(card) {
  const rows = card.rows || [];
  const stats = card.stats || [];
  const byL = (label) => rows.find(r => (r[0]||'').toLowerCase() === label.toLowerCase());
  const rCopper = byL('Copper');
  const rGold   = byL('Gold');
  const rEnergy = byL('Energy');
  const rAgric  = byL('Agriculture');
  const sBull   = stats.find(s => (s[0]||'').toLowerCase().includes('bull'));
  const bullCount = sBull ? parseInt(sBull[1]) : rows.filter(r => r[3]==='bullish').length;
  const copGold = rCopper && rGold
    ? (rCopper[3]==='bullish' && rGold[3]!=='bullish'
      ? 'Copper leading gold — industrial demand exceeds safe-haven demand; risk-on regime confirmed'
      : rGold[3]==='bullish' && rCopper[3]!=='bullish'
      ? 'Gold leading copper — safe-haven demand exceeds industrial growth; risk-off tilt warranted'
      : rCopper[3]==='bullish' && rGold[3]==='bullish'
      ? 'Both above 200d — growth and uncertainty simultaneously elevated; stagflation or uncertainty environment'
      : 'Both below 200d — neither growth nor safety is bid; cautious positioning appropriate')
    : '—';
  const copGoldColor = rCopper && rGold
    ? (rCopper[3]==='bullish'&&rGold[3]!=='bullish' ? '#22c55e'
      : rGold[3]==='bullish'&&rCopper[3]!=='bullish' ? '#f59e0b'
      : rCopper[3]==='bullish'&&rGold[3]==='bullish' ? '#f59e0b' : '#ef4444')
    : '#94a3b8';
  const actionA = bullCount >= 6
    ? 'Broadly risk-on — overweight copper, energy, and industrial metals; commodities are supporting the growth narrative'
    : bullCount >= 4
    ? 'Mixed signals — selectively overweight commodity themes above 200d; avoid broad commodity ETF exposure'
    : 'Broadly weak — underweight real assets; wait for copper or energy to reclaim their 200d SMA before adding';
  const actionColor = bullCount >= 6 ? '#22c55e' : bullCount >= 4 ? '#f59e0b' : '#ef4444';
  return [
    { label: 'Copper (CPER)',             q: 'Is copper above its 200d SMA, confirming industrial growth?',                   a: rCopper ? rCopper[2] : '—', c: rCopper ? _tc(rCopper[3]) : '#94a3b8' },
    { label: 'Gold (GLD)',                q: 'Is gold above its 200d SMA — and does that signal risk-off demand?',            a: rGold   ? rGold[2]   : '—', c: rGold   ? _tc(rGold[3])   : '#94a3b8' },
    { label: 'Energy (IXC)',              q: 'Is energy trending above its 200d SMA, indicating demand and inflation?',       a: rEnergy ? rEnergy[2] : '—', c: rEnergy ? _tc(rEnergy[3]) : '#94a3b8' },
    { label: 'Agriculture (DBA)',         q: 'Are agricultural commodities trending — a food inflation warning indicator?',   a: rAgric  ? rAgric[2]  : '—', c: rAgric  ? _tc(rAgric[3])  : '#94a3b8' },
    { label: 'Copper vs Gold (Key Read)', q: 'Which is leading — copper (growth) or gold (safety) — and what does it signal?', a: copGold,                  c: copGoldColor },
    { label: 'Portfolio Action',          q: 'What do the commodity signals collectively imply for real asset allocation?',   a: actionA,                   c: actionColor },
  ];
}
function buildCommoditiesMetrics(card) {
  const stats = card.stats || [];
  const sBull   = stats.find(s => (s[0]||'').toLowerCase().includes('bull'));
  const sCopper = stats.find(s => (s[0]||'').toLowerCase().includes('copper'));
  const sGold   = stats.find(s => (s[0]||'').toLowerCase().includes('gold'));
  const bullT = [
    { label: 'Broad Bid', text: '5–7 / 7  Broadly trending — overweight real assets',         color: '#22c55e' },
    { label: 'Partial',   text: '3–4 / 7  Mixed — overweight only themes above 200d',          color: '#22c55e' },
    { label: 'Weak',      text: '0–2 / 7  Broadly weak — underweight real assets',             color: '#ef4444' },
  ];
  const copperT = [
    { label: 'Growth Confirmed', text: '> 0% vs 200d  Industrial growth intact; overweight industrials',     color: '#22c55e' },
    { label: 'At Level',         text: '-2% to 0%  Near 200d; watch for breakdown',                          color: '#f59e0b' },
    { label: 'Growth Warning',   text: '< -2%  Below 200d; growth slowing; underweight cyclical industrials', color: '#ef4444' },
  ];
  const goldT = [
    { label: 'Risk-Off Bid',   text: '> 0% vs 200d  Safe-haven demand active — reduce equity exposure (inverted)', color: '#ef4444' },
    { label: 'Gold Fading',    text: '-2% to 0%  Near 200d; safe-haven demand cooling — neutral',                  color: '#f59e0b' },
    { label: 'Risk-On Signal', text: '< -2%  Safe haven fading — risk-on confirmed; equity supported (inverted)',   color: '#22c55e' },
  ];
  const cc = (s, pos, neg) => s ? (s[3]==='pos' ? pos : s[3]==='neg' ? neg : 'Monitor') : '—';
  const _coDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _coNear = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const bullCount = sBull   ? parseInt(sBull[1])   : null;
  const copperNum = sCopper ? parseFloat(sCopper[1]) : null;
  const goldNum   = sGold   ? parseFloat(sGold[1])   : null;
  const bullWarn  = bullCount != null && (bullCount === 3 || bullCount === 4 || bullCount === 5);
  const copperWarn= _coNear(copperNum, [0, -2], 1);
  const goldWarn  = _coNear(goldNum,   [0, -2], 1);
  const row1 = [
    sBull   ? [sBull[0],  sBull[1],  sBull[2],  sBull[3],  cc(sBull,  'Broad Bid — Overweight Real Assets',        'Weak — Underweight Real Assets'),                   bullT,  _coDir(sBull[3]),  bullWarn]  : ['Bull Signals', '—','macro-positive', null,'—',bullT,  null,false],
    sCopper ? [sCopper[0],sCopper[1],sCopper[2],sCopper[3],cc(sCopper,'Growth Confirmed — Overweight Industrials', 'Growth Warning — Reduce Cyclical Industrials'),       copperT,_coDir(sCopper[3]),copperWarn]: ['Copper vs 200d','—','growth proxy',   null,'—',copperT,null,false],
    sGold   ? [sGold[0],  sGold[1],  sGold[2],  sGold[3],  cc(sGold,  'Risk-Off Bid — Reduce Equity (inverted)', 'Risk-On Signal — Equity Supported (inverted)'),       goldT,  _coDir(sGold[3]),  goldWarn]  : ['Gold vs 200d',  '—','safe-haven',    null,'—',goldT,  null,false],
  ];

  const sPct = stats.find(s => (s[0]||'') === 'USCI Percentile Rank');
  const sDur = stats.find(s => (s[0]||'') === 'USCI Days in Zone');
  const sVel = stats.find(s => (s[0]||'') === 'USCI Extension Velocity');
  if (!sPct && !sDur && !sVel) return { row1, row2: null };

  const d = card.commDeltas || {};
  const pctNum = sPct ? parseInt(sPct[1]) : null;
  const durNum = sDur ? parseInt(sDur[1]) : null;
  const velNum = sVel ? parseFloat(sVel[1]) : null;
  const warnPct = pctNum != null && (Math.abs(pctNum - 80) <= 5 || Math.abs(pctNum - 20) <= 5);
  const warnDur = durNum != null && ([400, 150, 30].some(t => Math.abs(durNum - t) <= 20));
  const warnVel = velNum != null && Math.abs(velNum) <= 1.5;
  const pctTriggers = [
    { label: 'Extended', text: '> 80th  Historically stretched — mean reversion risk elevated', color: '#f59e0b' },
    { label: 'Normal',   text: '20th – 80th  Normal historical range',                           color: '#22c55e' },
    { label: 'Oversold', text: '< 20th  Historically depressed — watch for bounce',              color: '#f59e0b' },
  ];
  const durTriggers = [
    { label: 'Short',    text: '< 30 days  Freshly established, fragile',     color: '#f59e0b' },
    { label: 'Building', text: '30–150 days  Building credibility',            color: '#22c55e' },
    { label: 'Extended', text: '150–400 days  Deeply entrenched trend',        color: '#22c55e' },
    { label: 'Late',     text: '400+ days  Late-cycle characteristic',         color: '#f59e0b' },
  ];
  const velTriggers = [
    { label: 'Accelerating', text: '> 0%  Extension growing — momentum building', color: '#22c55e' },
    { label: 'Decelerating', text: '< 0%  Extension shrinking — momentum fading',  color: '#ef4444' },
  ];
  const pctAction = pctNum == null ? '—' : pctNum >= 80 ? 'Monitor for Reversion' : pctNum <= 20 ? 'Watch for Bounce' : 'No Action';
  const durAction = durNum == null ? '—' : durNum > 400 ? 'Late-Cycle — Trail Stops' : durNum > 150 ? 'Entrenched Trend — Hold Core' : durNum > 30 ? 'Building — Monitor' : 'Fragile — Await Confirmation';
  const velAction = velNum == null ? '—' : velNum > 0 ? 'Momentum Building' : 'Momentum Fading';
  const row2 = [
    sPct ? [sPct[0], sPct[1], sPct[2], sPct[3], pctAction, pctTriggers, d.v200     || null, warnPct] : ['USCI Percentile Rank',    '—', '', null, '—', null, null, false],
    sDur ? [sDur[0], sDur[1], sDur[2], sDur[3], durAction, durTriggers, d.duration || null, warnDur] : ['USCI Days in Zone',       '—', '', null, '—', null, null, false],
    sVel ? [sVel[0], sVel[1], sVel[2], sVel[3], velAction, velTriggers, d.velocity || null, warnVel] : ['USCI Extension Velocity', '—', '', null, '—', null, null, false],
  ];
  return { row1, row2 };
}

// ── Equities Diagnostics ─────────────────────────────────────────────────────
function buildEquitiesDiagnostics(card) {
  const rows = card.rows || [];
  const stats = card.stats || [];
  const bySym  = (sym) => rows.find(r => (r[4]||'') === sym);
  const rIwm   = bySym('IWM');
  const rFcx   = bySym('FCX');
  const rGdx   = bySym('GDX');
  const sBull  = stats.find(s => (s[0]||'').toLowerCase().includes('names'));
  const bullCount = sBull ? parseInt(sBull[1]) : rows.filter(r => r[3]==='bullish').length;
  const total  = rows.length;
  const execEnv = bullCount >= 7
    ? 'Favourable — broad participation; execute longs with normal sizing across active themes'
    : bullCount >= 5
    ? 'Selective — majority of themes intact; add only on dips to 50d in names above 200d'
    : bullCount >= 3
    ? 'Cautious — fewer than half the themes intact; hold only high-conviction names with tight stops'
    : 'Unfavourable — most names below their MAs; stand aside and wait for MA recapture';
  const execColor = bullCount >= 7 ? '#22c55e' : bullCount >= 5 ? '#f59e0b' : '#ef4444';
  const riskApp = rIwm && rFcx
    ? (rIwm[3]==='bullish' && rFcx[3]==='bullish'
      ? 'High — small caps and copper both active; risk appetite is broad and global growth is confirmed'
      : (rIwm[3]==='bullish' || rFcx[3]==='bullish')
      ? 'Moderate — one of the two growth signals is intact; selective exposure is appropriate'
      : 'Low — IWM and FCX both below 200d; risk appetite is closed; stand aside until both recover')
    : '—';
  const riskColor = rIwm && rFcx
    ? (rIwm[3]==='bullish'&&rFcx[3]==='bullish' ? '#22c55e' : (rIwm[3]==='bullish'||rFcx[3]==='bullish') ? '#f59e0b' : '#ef4444')
    : '#94a3b8';
  return [
    { label: 'Russell 2000 (IWM)',    q: 'Are small caps confirming the rally, or is the market top-heavy?',               a: rIwm ? rIwm[2] : '—', c: rIwm ? _tc(rIwm[3]) : '#94a3b8' },
    { label: 'Freeport (FCX)',        q: 'Is copper / global growth signalling expansion or slowdown?',                     a: rFcx ? rFcx[2] : '—', c: rFcx ? _tc(rFcx[3]) : '#94a3b8' },
    { label: 'Gold Miners (GDX)',     q: 'Is safe-haven demand rising or falling — is risk-on environment genuine?',        a: rGdx ? rGdx[2] : '—', c: rGdx ? _tc(rGdx[3]) : '#94a3b8' },
    { label: 'Watchlist Health',      q: `How many of the ${total} watchlist names are above both 50d and 200d SMA?`,       a: `${bullCount} / ${total} names above both MAs`, c: execColor },
    { label: 'Execution Environment', q: 'What is the overall execution environment for new long positions?',               a: execEnv,               c: execColor },
    { label: 'Risk Appetite Check',   q: 'Do IWM and FCX collectively confirm that risk appetite and growth are open?',     a: riskApp,               c: riskColor },
  ];
}

// ── Equities Metrics ─────────────────────────────────────────────────────────
function buildEquitiesMetrics(card) {
  const stats = card.stats || [];
  const sNames  = stats.find(s => (s[0]||'').toLowerCase().includes('names'));
  const sIwm    = stats.find(s => (s[0]||'').toLowerCase().includes('russell'));
  const sFcx    = stats.find(s => (s[0]||'').toLowerCase().includes('freeport'));
  const namesT = [
    { label: 'Execution Green',  text: '≥ 7 / 9  Broad participation — normal sizing',          color: '#22c55e' },
    { label: 'Selective',        text: '5–6 / 9  Majority intact — add on dips to 50d only',    color: '#22c55e' },
    { label: 'Cautious',         text: '3–4 / 9  Fewer than half — hold only high-conviction',   color: '#f59e0b' },
    { label: 'Stand Aside',      text: '0–2 / 9  Most names weak — wait for MA recapture',       color: '#ef4444' },
  ];
  const iwmT = [
    { label: 'Risk Open',   text: '> 0% vs 200d  Small caps leading — rally broadening beyond mega-caps', color: '#22c55e' },
    { label: 'Watch',       text: '-2% to 0%  Near 200d — small-cap confirmation pending',                 color: '#f59e0b' },
    { label: 'Risk Closed', text: '< -2%  Small caps below 200d — narrow, top-heavy market',              color: '#ef4444' },
  ];
  const fcxT = [
    { label: 'Growth On',   text: '> 0% vs 200d  Copper breaking out — global growth expanding, cyclical exposure confirmed', color: '#22c55e' },
    { label: 'Caution',     text: '-5% to 0%  FCX near 200d — watch for copper confirmation before adding cyclicals',         color: '#f59e0b' },
    { label: 'Growth Off',  text: '< -5%  FCX below 200d — copper signalling global slowdown; reduce cyclical risk',           color: '#ef4444' },
  ];
  const cc = (s, pos, neg) => s ? (s[3]==='pos' ? pos : s[3]==='neg' ? neg : 'Monitor') : '—';
  const _eDir = (t) => t === 'pos' ? 'up' : t === 'neg' ? 'down' : null;
  const _eNear = (v, ts, m) => v != null && ts.some(t => Math.abs(v - t) <= m);
  const namesCount = sNames ? parseInt(sNames[1]) : null;
  const iwmNum     = sIwm   ? parseFloat(sIwm[1])  : null;
  const fcxNum     = sFcx   ? parseFloat(sFcx[1])  : null;
  const namesWarn  = namesCount != null && (namesCount >= 4 && namesCount <= 7);
  const iwmWarn    = _eNear(iwmNum, [0, -2], 1.5);
  const fcxWarn    = _eNear(fcxNum, [0, -5], 2);
  return [
    sNames ? [sNames[0],sNames[1],sNames[2],sNames[3],cc(sNames,'Execution Green — Size Normally', 'Stand Aside — Await MA Recapture'), namesT,_eDir(sNames[3]),namesWarn] : ['Names Above MAs','—','above both 50d & 200d',null,'—',namesT,null,false],
    sIwm   ? [sIwm[0],  sIwm[1],  sIwm[2],  sIwm[3],  cc(sIwm,  'Risk Appetite Open',             'Narrow Market — Top Heavy'),        iwmT,  _eDir(sIwm[3]),  iwmWarn]   : ['Russell 2000',   '—','small-cap appetite',   null,'—',iwmT,  null,false],
    sFcx   ? [sFcx[0],  sFcx[1],  sFcx[2],  sFcx[3],  cc(sFcx,  'Growth Signal On',               'Growth Signal Off — Reduce Cyclicals'), fcxT, _eDir(sFcx[3]), fcxWarn] : ['Freeport (FCX)', '—','copper / global growth',null,'—',fcxT, null,false],
  ];
}

// ── Currency Metrics ─────────────────────────────────────────────────────────
function buildCurrencyMetrics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2];

  const toTone = (t) => t === 'bullish' ? 'pos' : t === 'bearish' ? 'neg' : 'neutral';
  const toDir  = (valStr) => {
    if (!valStr) return null;
    const num = parseFloat(String(valStr).replace('−', '-'));
    return isNaN(num) ? null : num > 0 ? 'up' : num < 0 ? 'down' : null;
  };

  const uupT = r0 ? toTone(r0[3]) : 'neutral';
  const fxeT = r1 ? toTone(r1[3]) : 'neutral';
  const fxyT = r2 ? toTone(r2[3]) : 'neutral';

  const uupAction = uupT === 'neg' ? 'Reduce Risk — Tightening Conditions'
                  : uupT === 'pos' ? 'Add Risk — Dollar Easing Aids Liquidity'
                  : 'Neutral — Hold Positioning';
  const fxeAction = fxeT === 'neg' ? 'Risk-Off Signal — Global Stress Rising'
                  : fxeT === 'pos' ? 'Risk-On — European Liquidity Supportive'
                  : 'Neutral — Follow Earnings';
  const fxyAction = fxyT === 'neg' ? 'Carry Unwind Risk — Tighten Stops Immediately'
                  : fxyT === 'pos' ? 'Carry Trade Open — Monitor for Reversal'
                  : 'Carry Stable — Monitor for Surge';

  const uupTriggers = [
    { label: '> +3%',   text: 'Major tightening — reduce EM/international exposure; shift to USD cash', color: '#ef4444' },
    { label: '+1–3%',   text: 'Headwind building — underweight risk assets and commodities',             color: '#ef4444' },
    { label: '±1%',     text: 'Neutral Dollar — no directional pressure; follow earnings',              color: '#f59e0b' },
    { label: '−1–3%',   text: 'Dollar easing — tailwind for risk, EM, and commodities; add exposure',  color: '#22c55e' },
    { label: '< −3%',   text: 'Dollar breakdown — significant liquidity injection; rotate into risk',   color: '#22c55e' },
  ];
  const fxeTriggers = [
    { label: '> +2%',     text: 'Euro strength — Eurozone improving; European stocks attractive',           color: '#22c55e' },
    { label: '+0.5–2%',   text: 'Euro firming — mild risk-on signal; hold international exposure',         color: '#22c55e' },
    { label: '±0.5%',     text: 'Euro neutral — no signal; equity returns driven by earnings',             color: '#f59e0b' },
    { label: '−0.5–2%',   text: 'Euro softening — risk appetite waning; reduce cyclical/international',   color: '#ef4444' },
    { label: '< −2%',     text: 'Euro stress — Eurozone under pressure; shift to defensive positioning',   color: '#ef4444' },
  ];
  const fxyTriggers = [
    { label: '> +2%',     text: 'DANGER: Yen surge — carry-trade unwind; reduce risk immediately',         color: '#ef4444' },
    { label: '+0.5–2%',   text: 'Yen strengthening — carry unwinding; tighten stops on risk assets',      color: '#ef4444' },
    { label: '±0.5%',     text: 'Yen stable — carry trade holding; no emergency action needed',            color: '#f59e0b' },
    { label: '−0.5–2%',   text: 'Yen weakening — carry trade extending; favorable for risk-on assets',    color: '#22c55e' },
    { label: '< −2%',     text: 'Yen extreme weak — elevated crash risk if reversed; monitor closely',     color: '#f59e0b' },
  ];

  return [
    [r0?.[0] || 'UUP (Dollar)', r0?.[1] || '—', 'US Dollar vs 200-day SMA', uupT, uupAction, uupTriggers, toDir(r0?.[1]), false, false],
    [r1?.[0] || 'FXE (Euro)',   r1?.[1] || '—', 'Euro ETF vs 200-day SMA',  fxeT, fxeAction, fxeTriggers, toDir(r1?.[1]), false, true ],
    [r2?.[0] || 'FXY (Yen)',    r2?.[1] || '—', 'Yen ETF vs 200-day SMA',   fxyT, fxyAction, fxyTriggers, null,           false       ],
  ];
}

// ── Currency Diagnostics ─────────────────────────────────────────────────────
function buildCurrencyDiagnostics(card) {
  const rows = card.rows || [];
  const r0 = rows[0], r1 = rows[1], r2 = rows[2], r3 = rows[3];

  const carryRiskA = r2 == null ? '—'
    : r2[3] === 'bearish'
    ? 'Active — FXY has risen sharply above its 200d SMA; prior carry-unwind episodes (Aug 2024, 2022) triggered equity de-risking within days'
    : 'Not Active — FXY is below its 200d spike threshold; carry trade is intact, no emergency hedging required';
  const carryRiskC = r2 == null ? '#94a3b8' : r2[3] === 'bearish' ? '#ef4444' : '#22c55e';

  const bullCount = rows.filter(r => r && r[3] === 'bullish').length;
  const bearCount = rows.filter(r => r && r[3] === 'bearish').length;
  const carryBear = r2 && r2[3] === 'bearish';
  const actionA = carryBear
    ? 'Carry unwind risk is active — reduce risk assets and leveraged positions immediately; rotate to cash and defensives'
    : bullCount >= 2
    ? 'FX conditions are supportive — maintain equity and EM exposure; USD weakness is a macro tailwind'
    : bearCount >= 2
    ? 'FX headwinds are building — reduce EM and international exposure; favour USD cash and domestic large-caps'
    : 'FX signals are mixed — no dominant directional pressure; follow earnings and sector rotation';
  const actionC = carryBear ? '#ef4444' : bullCount >= 2 ? '#22c55e' : bearCount >= 2 ? '#ef4444' : '#f59e0b';

  return [
    { label: 'USD Trend (UUP)',    q: 'Is the US Dollar ETF above its 200d SMA, tightening global financial conditions?',         a: r0 ? r0[2] : '—', c: r0 ? _tc(r0[3]) : '#94a3b8' },
    { label: 'EUR/USD (FXE)',      q: 'Is the Euro ETF above its 200d SMA, signalling global risk appetite is constructive?',     a: r1 ? r1[2] : '—', c: r1 ? _tc(r1[3]) : '#94a3b8' },
    { label: 'JPY Carry (FXY)',    q: 'Is the Yen ETF rising sharply, signalling a carry-trade unwind is in progress?',           a: r2 ? r2[2] : '—', c: r2 ? _tc(r2[3]) : '#94a3b8' },
    { label: 'FX Regime',         q: 'What composite FX regime emerges from the USD, EUR, and JPY signals combined?',            a: r3 ? r3[2] : '—', c: r3 ? _tc(r3[3]) : '#94a3b8' },
    { label: 'Carry Risk Status',  q: 'Is the global carry trade at risk of an unwind that could trigger equity de-risking?',     a: carryRiskA,        c: carryRiskC },
    { label: 'Portfolio Action',   q: 'What is the overall portfolio action implied by the current FX regime?',                   a: actionA,           c: actionC },
  ];
}

// ── Dispatchers ─────────────────────────────────────────────────────────────
function getDiagnostics(cardId, card, computedStats) {
  switch (cardId) {
    case 'regime':      return buildRegimeDiagnostics(card);
    case 'leadership':  return buildLeadershipDiagnostics(card, computedStats);
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
function getMetricsRow(cardId, card) {
  switch (cardId) {
    case 'valuations':  return buildValuationsMetrics(card);
    case 'yield':       return buildYieldMetrics(card);
    case 'credit':      return buildCreditMetrics(card);
    case 'globalflows': return buildGlobalFlowsMetrics(card);
    case 'sectors':     return buildSectorsMetrics(card);
    case 'equities':    return buildEquitiesMetrics(card);
    case 'currency':    return buildCurrencyMetrics(card);
    default:            return null;
  }
}

// ── Regime card — Market Diagnostics: one static question per Regime Metrics box ──
function buildRegimeDiagnostics(card) {
  const rows = card.rows || [];   // [label, value, condition, status, indicator]
  const stats = card.stats || []; // [label, value, desc, tone]
  const r1 = rows[0], r2 = rows[1], r3 = rows[2];
  const findStat = (label) => stats.find((s) => s[0] === label);
  const pctStat = findStat('Percentile Rank');
  const durStat = findStat('Regime Duration');
  const velStat = findStat('Extension Velocity');
  const toneOfStatus = (status) => status === 'bullish' ? '#22c55e' : status === 'bearish' ? '#ef4444' : '#f59e0b';
  const toneOfStat = (tone) => tone === 'pos' ? '#22c55e' : tone === 'neg' ? '#ef4444' : '#f59e0b';

  // Parse the raw numbers back out of the formatted stat strings so we can attach an action.
  const pctNum = pctStat ? parseInt(pctStat[1], 10) : null;
  const durNum = durStat ? parseInt(durStat[1], 10) : null;
  const velNum = velStat ? parseFloat(velStat[1]) : null;

  const pctAction = pctNum == null ? null
    : pctNum >= 90 ? 'Reduce Exposure'
    : pctNum >= 70 ? 'Monitor for Reversion'
    : pctNum <= 10 ? 'Watch for Bounce'
    : pctNum <= 30 ? 'Watch for Reversal'
    : 'No Action';
  const durAction = durNum == null ? null
    : durNum > 250 ? 'Trail Stops'
    : durNum > 60  ? 'Hold Core'
    : durNum < 10  ? 'Await Confirmation'
    : 'Monitor';
  const velAction = velNum == null ? null
    : velNum > 0.05  ? 'Monitor Stretch'
    : velNum < -0.05 ? 'Pressure Easing'
    : 'No Signal Change';

  return [
    { label: 'SPY Regime', q: 'How is the prevailing market environment categorized?', a: r1 ? r1[2] : '—', c: r1 ? toneOfStatus(r1[3]) : '#94a3b8' },
    { label: 'Stretch Risk', q: 'To what degree has the market become overextended?', a: r2 ? r2[2] : '—', c: r2 ? toneOfStatus(r2[3]) : '#94a3b8' },
    { label: 'Trend Cross', q: 'Has the present market trend been confirmed?', a: r3 ? r3[2] : '—', c: r3 ? toneOfStatus(r3[3]) : '#94a3b8' },
    { label: 'Percentile Rank', q: 'Define the current period in context to historical precedents?', a: pctStat ? `${pctStat[1]} percentile of all historical days — ${pctAction}` : '—', c: pctStat ? toneOfStat(pctStat[3]) : '#94a3b8' },
    { label: 'Regime Duration', q: 'How persistent is the present market cycle?', a: durStat ? `${durStat[1]} ${durStat[2]} — ${durAction}` : '—', c: durStat ? toneOfStat(durStat[3]) : '#94a3b8' },
    { label: 'Extension Velocity', q: 'Is market momentum accelerating or decelerating?', a: velStat ? `${velStat[1]} (${velStat[2]}) — ${velAction}` : '—', c: velStat ? toneOfStat(velStat[3]) : '#94a3b8' },
  ];
}

// ── Regime card — builds both rows of 6 stat boxes with [label, value, indicator, tone, condition] ──
function buildRegimeMetrics(card) {
  const rows  = card.rows  || [];
  const stats = card.stats || [];
  const findStat = (label) => stats.find((s) => s[0] === label);
  const pctStat = findStat('Percentile Rank');
  const durStat = findStat('Regime Duration');
  const velStat = findStat('Extension Velocity');

  const pctNum = pctStat ? parseInt(pctStat[1], 10) : null;
  const durNum = durStat ? parseInt(durStat[1], 10) : null;
  const velNum = velStat ? parseFloat(velStat[1]) : null;
  const pctAction = pctNum == null ? '—' : pctNum >= 90 ? 'Reduce Exposure' : pctNum >= 70 ? 'Monitor for Reversion' : pctNum <= 10 ? 'Watch for Bounce' : pctNum <= 30 ? 'Watch for Reversal' : 'No Action';
  const durAction = durNum == null ? '—' : durNum > 250 ? 'Trail Stops' : durNum > 60 ? 'Hold Core' : durNum < 10 ? 'Await Confirmation' : 'Monitor';
  const velAction = velNum == null ? '—' : velNum > 0.05 ? 'Monitor Stretch' : velNum < -0.05 ? 'Pressure Easing' : 'No Signal Change';

  const row1Triggers = [
    [{ label: 'Bullish', text: 'SPY > 200d SMA', color: '#22c55e' }, { label: 'Bearish', text: 'SPY < 200d SMA', color: '#ef4444' }],
    [
      { label: 'Bearish', text: 'Overextended  > +14%',          color: '#ef4444' },
      { label: 'Neutral', text: 'Extended  +10% to +14%',        color: '#f59e0b' },
      { label: 'Bullish', text: 'Normal Bull  0% to +10%',       color: '#22c55e' },
      { label: 'Neutral', text: 'Bearish Retest  -10% to 0%',   color: '#f59e0b' },
      { label: 'Bearish', text: 'Deeply Oversold  < -10%',       color: '#ef4444' },
    ],
    [
      { label: 'Bullish', text: 'Golden Cross  50d SMA > 200d SMA', color: '#22c55e' },
      { label: 'Bearish', text: 'Death Cross  50d SMA < 200d SMA',  color: '#ef4444' },
    ],
  ];

  const d = card.deltas || {};
  const row1Dirs = [d.v200 || null, d.v200 || null, d.crossSpread || null];

  // ── Warning: value within margin of a status-change threshold AND trending toward it ──
  // Approaching: (val < threshold && dir === 'up') || (val > threshold && dir === 'down')
  const approaching = (val, threshold, dir) =>
    val != null && dir != null && dir !== 'flat' &&
    ((val < threshold && dir === 'up') || (val > threshold && dir === 'down'));
  const nearAny = (val, thresholds, dir, margin) =>
    thresholds.some(t => Math.abs(val - t) <= margin && approaching(val, t, dir));

  // SPY Regime: parse "755.14 vs 684.67" to compute raw v200 pct, warn within 2% of 0
  const spyM = (rows[0]?.[1] || '').match(/([\d.]+)\s+vs\s+([\d.]+)/);
  const spyV200pct = spyM ? (parseFloat(spyM[1]) - parseFloat(spyM[2])) / parseFloat(spyM[2]) * 100 : null;
  const warnSpy = spyV200pct != null && Math.abs(spyV200pct) <= 2 && approaching(spyV200pct, 0, d.v200);

  // Stretch Risk: parse "+10.29%" → float, warn within 1.5% of 14, 10, 0, -10
  const stretchVal = parseFloat((rows[1]?.[1] || '').replace('%', ''));
  const warnStretch = !isNaN(stretchVal) && nearAny(stretchVal, [14, 10, 0, -10], d.v200, 1.5);

  // Trend Cross: parse "+5.9%" → float, warn within 1% of 0
  const crossVal = parseFloat((rows[2]?.[1] || '').replace('%', ''));
  const warnCross = !isNaN(crossVal) && Math.abs(crossVal) <= 1 && approaching(crossVal, 0, d.crossSpread);

  // Percentile Rank: parse "78th" → int, warn within 5 pts of 80 or 20
  const warnPct = pctNum != null && nearAny(pctNum, [80, 20], d.v200, 5);

  // Regime Duration: parse days int, warn within 10 days of 30, 150, 400
  const warnDur = durNum != null && nearAny(durNum, [30, 150, 400], d.duration, 10);

  // Extension Velocity: velNum already a float, warn within 0.5% of any zone boundary
  const warnVel = velNum != null && nearAny(velNum, [12, 8, 2, 0, -2, -6, -10, -15], d.velocity, 0.5);

  const row1 = rows.slice(0, 3).map((r, idx) => {
    const [label, value, condition, status, indicator] = r;
    const tone = status === 'bullish' ? 'pos' : status === 'bearish' ? 'neg' : null;
    const warn = [warnSpy, warnStretch, warnCross][idx];
    let displayVal = value, displayInd = indicator || '';
    if (idx === 0 && spyM) {
      displayVal = `$${parseFloat(spyM[1]).toFixed(2)}`;
      displayInd = `vs $${Math.round(parseFloat(spyM[2]))} · 200d SMA`;
    }
    return [label, displayVal, displayInd, tone, condition || '—', row1Triggers[idx], row1Dirs[idx], warn];
  });

  const row2Triggers = [
    [
      { label: 'Extreme High', text: 'Historically extreme extension  > 80th Percentile',  color: '#f59e0b' },
      { label: 'Normal',       text: 'Normal historical range  20th – 80th Percentile',     color: '#22c55e' },
      { label: 'Extreme Low',  text: 'Historically extreme oversold  < 20th Percentile',    color: '#ef4444' },
    ],
    [
      { label: 'Short',     text: '< 30 days  Freshly established, fragile',          color: '#f59e0b' },
      { label: 'Moderate',  text: '30 – 150 days  Building credibility',               color: '#22c55e' },
      { label: 'Extended',  text: '150 – 300+ days  Deeply entrenched',               color: '#22c55e' },
      { label: 'Very Long', text: '400+ days  Late-cycle characteristic',              color: '#f59e0b' },
    ],
    [
      { label: 'Exhaustion',        text: '> +12%  Extreme risk — take profit',                 color: '#ef4444' },
      { label: 'Overextended',      text: '+8% to +12%  High risk — tighten stops',             color: '#f59e0b' },
      { label: 'Healthy Bullish',   text: '+2% to +8%  Sweet spot — buy pullbacks',             color: '#22c55e' },
      { label: 'Macro Crossroads',  text: '0% to +2%  Market resting — watch breadth',          color: '#f59e0b' },
      { label: 'Breakdown Zone',    text: '0% to -2%  Trend snapping — no new positions',       color: '#f59e0b' },
      { label: 'Confirmed Bear',    text: '-2% to -6%  Structural downtrend — sell if 3 days',  color: '#ef4444' },
      { label: 'Deep Correction',   text: '-6% to -10%  Systemic selling — rallies short-lived',color: '#ef4444' },
      { label: 'Capitulation',      text: '-10% to -15%  Severe panic — expect bounce',         color: '#ef4444' },
      { label: 'Systemic Bottom',   text: '< -15%  Generational value — deeply oversold',       color: '#f59e0b' },
    ],
  ];

  const row2 = [
    pctStat ? [pctStat[0], pctStat[1], pctStat[2], pctStat[3], pctAction, row2Triggers[0], d.v200     || null, warnPct]  : ['Percentile Rank',   '—', '', null, '—', null, null, false],
    durStat ? [durStat[0], durStat[1], durStat[2], durStat[3], durAction, row2Triggers[1], d.duration || null, warnDur]  : ['Regime Duration',    '—', '', null, '—', null, null, false],
    velStat ? [velStat[0], velStat[1], velStat[2], velStat[3], velAction, row2Triggers[2], d.velocity || null, warnVel]  : ['Extension Velocity', '—', '', null, '—', null, null, false],
  ];

  return { row1, row2 };
}

// ── Leadership card — Market Diagnostics: one question per Leadership Metrics box ──
function buildLeadershipDiagnostics(card, computedStats) {
  const rows  = card.rows  || [];
  const stats = computedStats || card.stats || [];

  const toneOfStatus = (st) => st === 'bullish' ? '#22c55e' : st === 'bearish' ? '#ef4444' : '#f59e0b';
  const toneOfStat   = (t)  => t  === 'pos'     ? '#22c55e' : t  === 'neg'     ? '#ef4444' : '#f59e0b';

  const r0 = rows[0], r1 = rows[1], r2 = rows[2];

  // Label-safe stat finders — robust to both ctx (5Y/1Y labels) and no-ctx fallback
  const mktSpreadStat = stats.find(s => {
    const l = (s[0] || '').toLowerCase();
    return !l.includes('streak') && !l.includes('tech') && !l.includes('qqew') && !l.includes('qqq') && !l.includes('growth') && !l.includes('style');
  });
  const streakStat = stats.find(s => (s[0] || '').toLowerCase().includes('streak'));
  const techSpreadStat = stats.find(s => {
    const l = (s[0] || '').toLowerCase();
    return l.includes('tech') || l.includes('qqew') || l.includes('qqq');
  });

  const spreadA  = mktSpreadStat  ? `${mktSpreadStat[1]}  —  ${mktSpreadStat[2]}`  : '—';
  const techA    = techSpreadStat ? `${techSpreadStat[1]}  —  ${techSpreadStat[2]}` : '—';
  const streakA  = streakStat     ? `${streakStat[1]} ${streakStat[2]}`             : '—';

  return [
    { label: 'Market Breadth', q: 'Is the current market rally broad-based or fragile?',
      a: r0 ? (r0[2] || '—') : '—', c: r0 ? toneOfStatus(r0[3]) : '#94a3b8' },
    { label: 'Tech Breadth',   q: 'Is the technology market rally broad-based or concentrated in mega-cap?',
      a: r1 ? (r1[2] || '—') : '—', c: r1 ? toneOfStatus(r1[3]) : '#94a3b8' },
    { label: 'Style Bias',     q: 'Is the market rotating to stable, value-oriented or higher-risk, high-multiple growth companies?',
      a: r2 ? (r2[2] || '—') : '—', c: r2 ? toneOfStatus(r2[3]) : '#94a3b8' },
    { label: 'Market Spread',  q: 'How does the equal-weighted and cap-weighted S&P 500 compare over a time range?',
      a: spreadA, c: mktSpreadStat ? toneOfStat(mktSpreadStat[3]) : '#94a3b8' },
    { label: 'Tech Spread',    q: 'How does the equal-weighted and cap-weighted NASDAQ 100 compare over a time range?',
      a: techA, c: techSpreadStat ? toneOfStat(techSpreadStat[3]) : '#94a3b8' },
    { label: 'Daily Streak',   q: 'How long has the current trend of outperformance or underperformance persisted on a day-to-day basis?',
      a: streakA, c: streakStat ? toneOfStat(streakStat[3]) : '#94a3b8' },
  ];
}

function buildLeadershipMetrics(card, computedStats, qcRange) {
  const rows  = card.rows  || [];
  const stats = computedStats || card.stats || [];
  const d     = card.deltas || {};
  const _pDir = (key) => { const v = d[key]; return v === 'up' || v === 'down' ? v : null; };

  const parseSpread = (val) => { const n = parseFloat((val || '').split('\n')[0]); return isNaN(n) ? null : n; };
  const fmtSpread   = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const fmtT        = (v) => v >= 0 ? `+${v}%` : `${v}%`;

  // Row 1 always shows the 20D server spread — thresholds fixed
  const R1 = { mild: 1, strong: 3, toneMin: 1, warn: 0.5 };

  // Row 2 shows the qcRange spread from lpriceData — thresholds scale with lookback.
  // At 20D, row 2 is the same metric as row 1 so thresholds and triggers must match.
  const R2 = qcRange === '200D'
    ? { mild: 6,  strong: 18, warn: 6 }
    : qcRange === '50D'
    ? { mild: 2,  strong: 12, warn: 2 }
    : { mild: R1.mild, strong: R1.strong, warn: R1.warn };
  const syncWithR1 = !qcRange || qcRange === '20D';

  // ── Row 1: three pair spread boxes ──
  const pairTriggers = [
    [  // Market Breadth — RSP vs SPY
      { label: 'Broad Participation', text: `> ${fmtT(R1.strong)}  Equal-weight leading — add broadly`,                              color: '#22c55e' },
      { label: 'Mild Breadth',        text: `${fmtT(R1.mild)} to ${fmtT(R1.strong)}  Moderate broadening underway`,                  color: '#22c55e' },
      { label: 'Neutral',             text: `${fmtT(-R1.mild)} to ${fmtT(R1.mild)}  No clear leadership signal`,                     color: '#f59e0b' },
      { label: 'Narrow Rally',        text: `${fmtT(-R1.strong)} to ${fmtT(-R1.mild)}  Cap-weight leading — stay with large caps`,   color: '#f59e0b' },
      { label: 'Concentration Risk',  text: `< ${fmtT(-R1.strong)}  Top stocks driving — reduce broad adds`,                         color: '#ef4444' },
    ],
    [  // Tech Breadth — QQEW vs QQQ
      { label: 'Tech Broadening',   text: `> ${fmtT(R1.strong)}  Small/mid tech healthy — rally has legs`,                           color: '#22c55e' },
      { label: 'Mild Tech Breadth', text: `${fmtT(R1.mild)} to ${fmtT(R1.strong)}  Some broadening in tech`,                        color: '#22c55e' },
      { label: 'Neutral',           text: `${fmtT(-R1.mild)} to ${fmtT(R1.mild)}  No clear tech leadership signal`,                  color: '#f59e0b' },
      { label: 'Mega-Cap Driven',   text: `${fmtT(-R1.strong)} to ${fmtT(-R1.mild)}  Large-cap tech leading — concentrate there`,   color: '#f59e0b' },
      { label: 'FAANG Risk',        text: `< ${fmtT(-R1.strong)}  Top tech names only — caution broad tech ETFs`,                   color: '#ef4444' },
    ],
    [  // Style Bias — IVW vs IVE
      { label: 'Growth Dominant', text: `> ${fmtT(R1.strong)}  Risk appetite strong — growth and momentum favored`,                  color: '#22c55e' },
      { label: 'Growth Leaning',  text: `${fmtT(R1.mild)} to ${fmtT(R1.strong)}  Mild risk-on bias`,                                color: '#22c55e' },
      { label: 'Style Neutral',   text: `${fmtT(-R1.mild)} to ${fmtT(R1.mild)}  No clear growth / value edge`,                      color: '#f59e0b' },
      { label: 'Value Rotating',  text: `${fmtT(-R1.strong)} to ${fmtT(-R1.mild)}  Defensive tilt — reduce high-multiple names`,    color: '#f59e0b' },
      { label: 'Value Dominant',  text: `< ${fmtT(-R1.strong)}  Risk-off — quality and dividend names favored`,                     color: '#ef4444' },
    ],
  ];

  const row1 = rows.slice(0, 3).map((r, idx) => {
    const [label, rawVal, condition, status, indicator] = r;
    const spread   = parseSpread(rawVal);
    const value    = fmtSpread(spread);
    const tone     = spread != null ? (spread > R1.toneMin ? 'pos' : spread < -R1.toneMin ? 'neg' : null)
                                    : (status === 'bullish' ? 'pos' : status === 'bearish' ? 'neg' : null);
    const indShort = (indicator || '').replace(/\s*—\s*20d Return/, ' 20d');
    const warn     = spread != null && Math.abs(spread) < R1.warn;
    const pairKeys = ['rsp', 'qqew', 'style'];
    const dir = _pDir(pairKeys[idx]) || (spread != null ? (spread >= 0 ? 'up' : 'down') : null);
    return [label, value, indShort, tone, condition || '—', pairTriggers[idx], dir, warn];
  });

  // ── Row 2: contextual stats — triggers and conditions scale with qcRange ──
  const mktCtxTriggers = [
    { label: 'Breadth Regime',   text: `> ${fmtT(R2.strong)}  Equal-weight decisively ahead — breadth in place`,                    color: '#22c55e' },
    { label: 'Positive Breadth', text: `${fmtT(R2.mild)} to ${fmtT(R2.strong)}  RSP edging ahead — early broadening`,              color: '#22c55e' },
    { label: 'Contested',        text: `${fmtT(-R2.mild)} to ${fmtT(R2.mild)}  No structural leadership edge`,                      color: '#f59e0b' },
    { label: 'Narrow Market',    text: `${fmtT(-R2.strong)} to ${fmtT(-R2.mild)}  Cap-weight ahead — concentration building`,       color: '#f59e0b' },
    { label: 'Mega-Cap Regime',  text: `< ${fmtT(-R2.strong)}  Persistent top-stock leadership — be selective`,                     color: '#ef4444' },
  ];
  const streakTriggers = [
    { label: 'Extended Bull Run', text: '> 7 days  RSP leading daily — breadth confirmed',          color: '#22c55e' },
    { label: 'RSP Leading',       text: '1 – 7 days  RSP beating SPY on daily returns',            color: '#22c55e' },
    { label: 'SPY Leading',       text: '1 – 7 days  SPY beating RSP — narrowing',                 color: '#f59e0b' },
    { label: 'Extended Bear Run', text: '> 7 days  SPY leading daily — concentration risk rising',  color: '#ef4444' },
  ];
  const techCtxTriggers = [
    { label: 'Tech Broadening',  text: `> ${fmtT(R2.strong)}  Equal-weight tech ahead over the period`,                             color: '#22c55e' },
    { label: 'Positive Tech',    text: `${fmtT(R2.mild)} to ${fmtT(R2.strong)}  QQEW edging ahead — some broadening`,              color: '#22c55e' },
    { label: 'Contested',        text: `${fmtT(-R2.mild)} to ${fmtT(R2.mild)}  No structural tech breadth edge`,                    color: '#f59e0b' },
    { label: 'Mega-Cap Tech',    text: `${fmtT(-R2.strong)} to ${fmtT(-R2.mild)}  QQQ leading — favour large-cap tech`,            color: '#f59e0b' },
    { label: 'FAANG Dominance',  text: `< ${fmtT(-R2.strong)}  Persistent mega-cap tech — narrow exposure`,                         color: '#ef4444' },
  ];
  const styleCtxTriggers = [
    { label: 'Growth Dominant', text: `> ${fmtT(R2.strong)}  Growth decisively ahead structurally`,                                  color: '#22c55e' },
    { label: 'Growth Leaning',  text: `${fmtT(R2.mild)} to ${fmtT(R2.strong)}  Growth edging ahead over the period`,               color: '#22c55e' },
    { label: 'Contested',       text: `${fmtT(-R2.mild)} to ${fmtT(R2.mild)}  No structural growth / value edge`,                   color: '#f59e0b' },
    { label: 'Value Rotating',  text: `${fmtT(-R2.strong)} to ${fmtT(-R2.mild)}  Value gaining structurally`,                       color: '#f59e0b' },
    { label: 'Value Dominant',  text: `< ${fmtT(-R2.strong)}  Persistent value outperformance — risk-off bias`,                     color: '#ef4444' },
  ];

  const mktCond  = (v) => v == null || isNaN(v) ? '—' :
    v > R2.strong ? 'Breadth Regime — Add Broadly' : v > R2.mild ? 'Positive — Maintain Exposure' :
    v > -R2.mild ? 'Contested — Watch for Catalyst' : v > -R2.strong ? 'Narrow Market — Favour Large Cap' : 'Mega-Cap Regime — Be Selective';
  const techCond = (v) => v == null || isNaN(v) ? '—' :
    v > R2.strong ? 'Tech Broadening — Tech Healthy' : v > R2.mild ? 'Positive Tech Breadth' :
    v > -R2.mild ? 'Contested Tech Leadership' : v > -R2.strong ? 'Mega-Cap Tech Led' : 'FAANG Dominance — Concentrate';
  const styleCond = (v) => v == null || isNaN(v) ? '—' :
    v > R2.strong ? 'Growth Regime — Risk-On' : v > R2.mild ? 'Growth Leaning' :
    v > -R2.mild ? 'Style Neutral' : v > -R2.strong ? 'Value Rotating — De-Risk' : 'Value Dominant — Risk-Off';
  const streakCond = (valStr, tone) => {
    const n = parseInt(valStr, 10);
    if (isNaN(n)) return '—';
    if (tone === 'pos') return n > 7 ? 'Extended Run — Breadth Confirmed' : 'RSP Leading Daily';
    if (tone === 'neg') return n > 7 ? 'Extended Run — Concentration Risk' : 'SPY Leading Daily';
    return '—';
  };

  const row2 = stats.slice(0, 3).map((s) => {
    if (!s) return ['—', '—', '', null, '—', null, null, false];
    const lbl    = (s[0] || '').toLowerCase();
    const valStr = s[1] || '—';
    const rawNum = parseFloat(valStr.replace('%', ''));
    const tone   = s[3] || null;

    let triggers, condition;
    if (lbl.includes('streak')) {
      triggers  = streakTriggers;
      condition = streakCond(valStr, tone);
    } else if (lbl.includes('tech') || lbl.includes('qqew') || lbl.includes('qqq')) {
      triggers  = syncWithR1 ? pairTriggers[1] : techCtxTriggers;
      condition = techCond(rawNum);
    } else if (lbl.includes('style') || lbl.includes('growth') || lbl.includes('value')) {
      triggers  = syncWithR1 ? pairTriggers[2] : styleCtxTriggers;
      condition = styleCond(rawNum);
    } else {
      triggers  = syncWithR1 ? pairTriggers[0] : mktCtxTriggers;
      condition = mktCond(rawNum);
    }
    const warn = !lbl.includes('streak') && !isNaN(rawNum) && Math.abs(rawNum) < R2.warn;
    const dKey = lbl.includes('streak') ? null
               : lbl.includes('tech') || lbl.includes('qqew') || lbl.includes('qqq') ? 'qqew'
               : lbl.includes('style') || lbl.includes('growth') || lbl.includes('value') ? 'style'
               : 'rsp';
    const dir  = lbl.includes('streak') ? (tone === 'pos' ? 'up' : tone === 'neg' ? 'down' : null)
               : _pDir(dKey) || (!isNaN(rawNum) ? (rawNum >= 0 ? 'up' : 'down') : null);
    return [s[0], valStr, s[2] || '', tone, condition, triggers, dir, warn];
  });

  return { row1, row2 };
}

// ── COT Positioning panel — CFTC Commitment of Traders ───────────────────────
function COTPositioning() {
  const [data, setData] = useStateD(null);
  useEffectD(() => {
    let alive = true;
    fetch('/api/cot').then(r => r.json())
      .then(d => { if (alive && d.contracts) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const LABELS = { ES: 'S&P 500 Futures', GC: 'Gold', CL: 'WTI Crude' };
  const ICONS  = { ES: '📈', GC: '🟡', CL: '🛢' };

  const crowdColor = (c) => c === 'crowded_long' ? '#22c55e' : c === 'crowded_short' ? '#ef4444' : '#f59e0b';
  const crowdLabel = (c) => c === 'crowded_long' ? 'Crowded Long' : c === 'crowded_short' ? 'Crowded Short' : 'Neutral';

  const interp = (key, crowding, pctile) => {
    if (key === 'ES') {
      if (crowding === 'crowded_long')  return `Hedge funds are heavily net-long S&P futures (${pctile}th percentile). Positioning is stretched — a catalyst for rapid unwinding. Historically precedes sharp but brief corrections as crowded longs exit.`;
      if (crowding === 'crowded_short') return `Hedge funds are historically net-short S&P futures (${pctile}th percentile). Extreme short positioning often fuels sharp short-covering rallies on any positive surprise.`;
      return `Speculative S&P positioning is within normal range (${pctile}th percentile). No positioning extreme — price direction driven by fundamentals and flows rather than forced covering.`;
    }
    if (key === 'GC') {
      if (crowding === 'crowded_long')  return `Gold speculative longs are historically crowded (${pctile}th percentile). Safe-haven demand is priced in — upside may be limited from here without a new catalyst.`;
      if (crowding === 'crowded_short') return `Gold speculative shorts are at an extreme (${pctile}th percentile). Crowded shorts are fuel for a snap rally on any risk-off event.`;
      return `Gold positioning is neutral (${pctile}th percentile). No significant sentiment extreme — price will follow macro cues.`;
    }
    if (key === 'CL') {
      if (crowding === 'crowded_long')  return `WTI crude speculative longs are stretched (${pctile}th percentile). Energy positioning is crowded — supply-side surprises carry outsized downside risk.`;
      if (crowding === 'crowded_short') return `Crude short positioning is at an extreme (${pctile}th percentile). Any demand surprise or supply cut could trigger aggressive short covering.`;
      return `Crude oil positioning is neutral (${pctile}th percentile). Balanced positioning — oil price will track macro growth signals rather than sentiment.`;
    }
    return '';
  };

  if (!data) {
    return (
      <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ fontFamily: DSANS, fontSize: 13, color: '#475569' }}>Loading COT data…</div>
      </div>
    );
  }

  const hasData = data.contracts.some(c => !c.empty);
  if (!hasData) {
    return (
      <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ fontFamily: DSANS, fontSize: 13, color: '#475569' }}>No COT data yet — run /api/refresh to seed.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.contracts.filter(c => !c.empty).map(c => {
        const cc = crowdColor(c.crowding);
        const cl = crowdLabel(c.crowding);
        const netK = c.noncommNet != null ? (Math.abs(c.noncommNet) >= 1000
          ? `${c.noncommNet > 0 ? '+' : '−'}${(Math.abs(c.noncommNet) / 1000).toFixed(0)}K`
          : `${c.noncommNet > 0 ? '+' : ''}${c.noncommNet}`) : '—';
        const pctStr = `${(c.netPctOi * 100).toFixed(1)}% of OI`;

        return (
          <div key={c.key} style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: DSANS, fontSize: 14, fontWeight: 600, color: '#cbd5e1' }}>{c.label}</div>
                <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>
                  Speculative net · {c.reportDate ? `Week of ${c.reportDate}` : 'CFTC COT'}
                </div>
              </div>
              <div style={{ padding: '3px 10px', borderRadius: 7, background: cc + '22', border: `1px solid ${cc}44`, flexShrink: 0 }}>
                <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, color: cc }}>{cl}</span>
              </div>
            </div>

            {/* Net position + percentile */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: DMONO, fontSize: 22, fontWeight: 700, color: cc, lineHeight: 1 }}>{netK}</span>
              <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>contracts net · {pctStr}</span>
            </div>

            {/* Percentile bar */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: DSANS, fontSize: 10, color: '#475569' }}>3Y percentile</span>
                <span style={{ fontFamily: DMONO, fontSize: 12, fontWeight: 600, color: cc }}>{c.pctile}th</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: '#1e2d3d', overflow: 'hidden', position: 'relative' }}>
                {/* Zone tints */}
                <div style={{ position: 'absolute', left: 0, top: 0, width: '20%', height: '100%', background: 'rgba(239,68,68,0.15)' }} />
                <div style={{ position: 'absolute', right: 0, top: 0, width: '20%', height: '100%', background: 'rgba(34,197,94,0.15)' }} />
                <div style={{ height: '100%', width: `${c.pctile}%`, background: cc, borderRadius: 3, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontFamily: DSANS, fontSize: 9, color: '#ef4444' }}>Crowded Short</span>
                <span style={{ fontFamily: DSANS, fontSize: 9, color: '#22c55e' }}>Crowded Long</span>
              </div>
            </div>

            {/* Interpretation */}
            <div style={{ background: '#060e19', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${cc}55`, marginTop: 4 }}>
              <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569', marginBottom: 5 }}>What this means</div>
              <div style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{interp(c.key, c.crowding, c.pctile)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Crowd Signals deep dive — Kalshi events + Polymarket macro signals ──
// ── CPI Inflation — Headline & Core historical chart (CrowdSignals deep dive) ──
const CPI_RANGES = ['1Y', '2Y', '5Y', '10Y', '20Y'];
function CpiHistoryChart() {
  const RMAP = { '1Y': '1y', '2Y': '2y', '5Y': '5y', '10Y': '10y', '20Y': '20y' };
  const [range, setRange]     = useStateD('10Y');
  const [live, setLive]       = useStateD(null);
  const [momData, setMomData] = useStateD(null);
  const [latest, setLatest]       = useStateD(null);
  const [latestMom, setLatestMom] = useStateD(null);
  const [latestMonth, setLatestMonth] = useStateD(null);

  useEffectD(() => {
    let alive = true;
    setLive(null);
    setMomData(null);
    setLatest(null);
    setLatestMom(null);
    setLatestMonth(null);
    const mo = new Date().toISOString().slice(0, 7);
    fetch(`/api/cpi-history?range=${RMAP[range]}&d=${mo}&v=2`)
      .then(r => r.json())
      .then(j => {
        const hasYoy = Array.isArray(j.headline_yoy) && j.headline_yoy.length > 0;
        const hasMom = Array.isArray(j.headline)     && j.headline.length > 0;
        if (!alive || (!hasYoy && !hasMom)) return;
        const yoyValues  = hasYoy ? j.headline_yoy : null;
        const coreYoy    = hasYoy ? (j.core_yoy || []) : (j.core || []);
        const momValues  = j.headline || [];
        const coreMom    = j.core || [];
        const lastYoy    = hasYoy ? [...yoyValues].reverse().find(v => v != null) : null;
        const lastMom    = [...momValues].reverse().find(v => v != null);
        if (lastYoy != null) setLatest(lastYoy);
        if (lastMom != null) setLatestMom(lastMom);
        if (Array.isArray(j.dates) && j.dates.length) {
          const lastDate = j.dates[j.dates.length - 1];
          const mon = new Date(lastDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short' });
          setLatestMonth(mon);
        }
        setMomData({ headline: momValues, core: coreMom });
        setLive({
          values:     yoyValues || momValues,
          dates:      j.dates,
          label:      hasYoy ? 'CPI (Headline)' : 'CPI MoM (Headline)',
          format:     'pct',
          lineColor:  '#a855f7',
          overlays:   [{ label: hasYoy ? 'CPI (Core)' : 'CPI MoM (Core)', values: coreYoy, color: '#22d3ee', dash: null }],
          thresholds: hasYoy ? [
            { y: 2.0, color: '#22c55e' },
            { y: 5.0, color: '#ef4444' },
          ] : [
            { y: 0.167, color: '#22c55e' },
            { y: 0.4,   color: '#ef4444' },
          ],
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const fakeCard     = { seed: 7, trend: 0.02, metric: 'CPI YoY', metricUnit: '', metricVal: '' };
  const hColorYoy    = latest == null ? '#f59e0b' : latest > 5 ? '#ef4444' : latest > 2 ? '#f59e0b' : '#22c55e';
  const hColorMom    = latestMom == null ? '#64748b' : latestMom > 0.4 ? '#ef4444' : latestMom > 0.167 ? '#f59e0b' : '#22c55e';
  const hoverExtras  = momData ? [
    { label: 'MoM Headline', values: momData.headline, format: 'pct', color: '#a855f7' },
    { label: 'MoM Core',     values: momData.core,     format: 'pct', color: '#22d3ee' },
  ] : null;

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>CPI Inflation — Headline &amp; Core</div>
          <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>CPI monthly print actuals, hover for monthly change</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          {latest != null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>{latestMonth || 'Latest'}</span>
              <span style={{ fontFamily: DMONO, fontSize: 14, fontWeight: 700, color: hColorYoy }}>
                {(latest >= 0 ? '+' : '') + latest.toFixed(1)}%
              </span>
            </div>
          )}
          {latestMom != null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontFamily: DSANS, fontSize: 10, color: '#475569' }}>MoM</span>
              <span style={{ fontFamily: DMONO, fontSize: 11.5, fontWeight: 600, color: hColorMom }}>
                {(latestMom >= 0 ? '+' : '') + latestMom.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      </div>
      <DeepChartLg card={fakeCard} cardId="cpi" color="#a855f7" height={220} range={range} setRange={setRange} live={live} ranges={CPI_RANGES} hoverExtras={hoverExtras} />
    </div>
  );
}

function PositioningDeepDive() {
  const [cotData, setCotData] = useStateD(null);
  useEffectD(() => {
    let alive = true;
    fetch('/api/cot').then(r => r.json())
      .then(d => { if (alive && d.contracts) setCotData(d.contracts); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const secLabel = (txt) => (
    <div style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 10 }}>{txt}</div>
  );

  // Contrarian trading color: crowded_short = bullish (green), crowded_long = bearish (red)
  const sigColor = (crowding) =>
    crowding === 'crowded_short' ? '#22c55e'
    : crowding === 'crowded_long' ? '#ef4444'
    : '#f59e0b';

  function buildDiagnostics(contracts) {
    if (!contracts) return null;
    const es = contracts.find(c => c.key === 'ES');
    const gc = contracts.find(c => c.key === 'GC');
    const cl = contracts.find(c => c.key === 'CL');
    const na = { a: '—', c: '#94a3b8' };

    const esD = es && !es.empty ? {
      a: es.crowding === 'crowded_short'
        ? `Crowded Short (${es.pctile}th pctile) — Contrarian Bullish; short-squeeze fuel if any positive catalyst hits`
        : es.crowding === 'crowded_long'
        ? `Crowded Long (${es.pctile}th pctile) — Contrarian Bearish; stretched longs are the next wave of sellers`
        : `Neutral (${es.pctile}th pctile) — No Positioning Extreme; price driven by fundamentals, not forced flows`,
      c: sigColor(es.crowding),
    } : na;

    const gcD = gc && !gc.empty ? {
      a: gc.crowding === 'crowded_short'
        ? `Crowded Short (${gc.pctile}th pctile) — Specs underweight gold; safe-haven trade not stretched, room to move`
        : gc.crowding === 'crowded_long'
        ? `Crowded Long (${gc.pctile}th pctile) — Specs heavily long gold; safe-haven trade is crowded, limited upside`
        : `Neutral (${gc.pctile}th pctile) — Balanced gold positioning; no crowding signal either way`,
      c: sigColor(gc.crowding),
    } : na;

    const clD = cl && !cl.empty ? {
      a: cl.crowding === 'crowded_short'
        ? `Crowded Short (${cl.pctile}th pctile) — Specs net-short crude; any supply cut or demand beat triggers squeeze`
        : cl.crowding === 'crowded_long'
        ? `Crowded Long (${cl.pctile}th pctile) — Energy specs are stretched; demand miss or supply build carries outsized downside`
        : `Neutral (${cl.pctile}th pctile) — Balanced crude positioning; oil will follow macro growth signals`,
      c: sigColor(cl.crowding),
    } : na;

    const extremes = [es, gc, cl].filter(c => c && !c.empty && c.crowding !== 'neutral');
    const aggA = extremes.length === 0
      ? 'Balanced — No Positioning Extremes; markets pricing on fundamentals, not forced flows'
      : extremes.length === 1
      ? `One Extreme — ${extremes[0].label} positioning is stretched; watch for catalyst-driven covering`
      : `Multiple Extremes — ${extremes.length} contracts at positioning extremes; high-conviction contrarian setup`;
    const aggC = extremes.length >= 2 ? '#ef4444' : extremes.length === 1 ? '#f59e0b' : '#22c55e';

    return [
      { label: 'S&P 500 Futures (ES)', q: 'Are large speculators crowded long or short — is there positioning fuel or a unwind risk?', ...esD },
      { label: 'Gold Futures (GC)',    q: 'Is safe-haven demand from specs crowded — does gold have room to run or is it stretched?',   ...gcD },
      { label: 'WTI Crude (CL)',       q: 'Are energy speculators confirming or contradicting the commodity cycle?',                    ...clD },
      { label: 'Aggregate Signal',     q: 'Across all three contracts, how broadly stretched is speculative positioning?',              a: aggA, c: aggC },
    ];
  }

  function buildNarrative(contracts) {
    if (!contracts) return null;
    const es = contracts.find(c => c.key === 'ES');
    const gc = contracts.find(c => c.key === 'GC');
    const cl = contracts.find(c => c.key === 'CL');
    const parts = [];

    if (es && !es.empty) {
      const netK = es.noncommNet != null ? `${(es.noncommNet / 1000).toFixed(0)}K` : '—';
      parts.push(
        es.crowding === 'crowded_short'
          ? `S&P 500 futures: specs are heavily net-short (${netK} contracts, ${es.pctile}th pctile over 3 years). Extreme short positioning is a contrarian bullish signal — historically, short squeezes at these levels produce sharp but swift rallies.`
          : es.crowding === 'crowded_long'
          ? `S&P 500 futures: specs are crowded net-long (${netK} contracts, ${es.pctile}th pctile over 3 years). Stretched longs become sellers on any disappointment — the positioning itself is a latent source of downside volatility.`
          : `S&P 500 futures: speculative positioning is neutral at the ${es.pctile}th pctile (${netK} contracts). No positioning distortion — equity direction will be set by earnings, macro data, and Fed signals rather than forced covering.`
      );
    }

    if (gc && !gc.empty && gc.crowding !== 'neutral') {
      const netK = gc.noncommNet != null ? `${(gc.noncommNet / 1000).toFixed(0)}K` : '—';
      parts.push(
        gc.crowding === 'crowded_long'
          ? `Gold: speculative longs at the ${gc.pctile}th pctile (${netK} contracts) — the safe-haven trade is crowded. Upside is constrained unless a new macro shock drives a fresh wave of demand beyond current positioning.`
          : `Gold: specs are net-short at the ${gc.pctile}th pctile (${netK} contracts) — the safe-haven trade is under-owned. Any flight to quality has a clean runway with minimal crowded-long resistance.`
      );
    }

    if (cl && !cl.empty && cl.crowding !== 'neutral') {
      const netK = cl.noncommNet != null ? `${(cl.noncommNet / 1000).toFixed(0)}K` : '—';
      parts.push(
        cl.crowding === 'crowded_long'
          ? `WTI crude: energy specs are stretched long at the ${cl.pctile}th pctile (${netK} contracts). Supply-side or demand misses carry outsized impact when longs are this crowded.`
          : `WTI crude: specs are net-short at the ${cl.pctile}th pctile (${netK} contracts). Energy is under-owned — OPEC cuts or a demand surprise could trigger aggressive short-covering in crude.`
      );
    }

    if (!parts.length) return 'Speculative positioning across ES, GC, and CL is within normal historical ranges — no extreme crowding detected in any contract. Markets are pricing on fundamentals rather than positioning distortion.';
    return parts.join(' ');
  }

  const items = buildDiagnostics(cotData);
  const narrative = buildNarrative(cotData);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        {secLabel('COT — Commitment of Traders')}
        <COTPositioning />
      </div>
      <div>
        {secLabel('Positioning Diagnostics')}
        <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '16px 20px' }}>
          {items && (
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e2d3d' }}>
              {items.map(({ label, q, a, c }, idx, arr) => (
                <div key={label} style={{ paddingTop: idx===0?0:11, paddingBottom: idx<arr.length-1?11:0, borderBottom: idx<arr.length-1?'1px solid #0d1e2e':'none' }}>
                  <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 600, color: c, lineHeight: 1.4, marginBottom: 4 }}>{a}</div>
                  <div style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{q}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 7 }}>Positioning Narrative</div>
          <p style={{ fontFamily: DSANS, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.65, margin: 0 }}>
            {narrative || 'Loading…'}
          </p>
        </div>
      </div>
    </div>
  );
}

function CrowdSignalsDeepDive() {
  const [kalshi, setKalshi]           = useStateD(null);
  const [poly, setPoly]               = useStateD(null);
  const [summary, setSummary]         = useStateD(null);
  const [summaryStatus, setSummaryStatus] = useStateD('idle');
  useEffectD(() => {
    let alive = true;
    fetch('/api/kalshi', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (alive) setKalshi(d); })
      .catch(() => { if (alive) setKalshi({ events: [] }); });
    fetch('/api/polymarket', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (alive) setPoly(d); })
      .catch(() => { if (alive) setPoly({ signals: [] }); });
    return () => { alive = false; };
  }, []);

  // Fire once when both data sources are loaded
  useEffectD(() => {
    if (!kalshi || !poly) return;
    setSummaryStatus('loading');
    let alive = true;
    fetch('/api/crowd-signals-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kalshi, poly }),
    })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        if (d.summary) { setSummary(d.summary); setSummaryStatus('ready'); }
        else setSummaryStatus('error');
      })
      .catch(() => { if (alive) setSummaryStatus('error'); });
    return () => { alive = false; };
  }, [kalshi, poly]);

  const secLabel = (txt) => (
    <div style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 10 }}>{txt}</div>
  );

  const kalshiEvents = kalshi?.events || [];
  const polySignals  = poly?.signals   || [];
  const fomcEvent    = kalshiEvents.find(e => e.type === 'fomc');
  const cpiEvent     = kalshiEvents.find(e => e.type === 'cpi');

  const renderKalshiBox = (evt) => {
    const isFomc      = evt.type === 'fomc';
    const actionColor = evt.action === 'Cut' ? '#22c55e' : evt.action === 'Hike' ? '#ef4444' : '#f59e0b';
    const conf        = evt.confidence ?? 0;
    const cpiVal      = !isFomc ? parseFloat((evt.consensus || '').replace(/[~%]/g, '')) : 0;

    const implication = isFomc
      ? evt.action === 'Cut'  ? 'Add duration. Bonds (TLT), utilities (XLU), and real estate (XLRE) historically rally into Fed easing cycles.'
      : evt.action === 'Hike' ? 'Reduce duration. Financials (XLF) and short-term bonds outperform during tightening cycles.'
      :                         'No Fed catalyst. Earnings and sector momentum are the primary near-term driver.'
      : cpiVal < 0
      ? 'Soft CPI reinforces the cut narrative. Growth stocks and longer-duration bonds may benefit.'
      : cpiVal > 0.2
      ? 'Sticky CPI may delay Fed cuts. Commodities and value stocks outperform in persistent-inflation environments.'
      : 'Muted CPI keeps Fed optionality intact. Neutral — focus on earnings and sector rotation.';

    const convictionLabel = conf >= 70 ? 'High conviction' : conf >= 50 ? 'Moderate conviction' : 'Low conviction';
    const barColor        = isFomc ? actionColor : '#a855f7';

    // FOMC: show current rate → market-implied rate
    const fomcFromTo = isFomc && evt.currentRate != null ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        <div>
          <div style={{ fontFamily: DMONO, fontSize: 26, fontWeight: 700, color: '#64748b', lineHeight: 1 }}>{evt.currentRate.toFixed(2)}%</div>
          <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginTop: 4 }}>Current rate</div>
        </div>
        <div style={{ fontFamily: DSANS, fontSize: 20, color: '#94a3b8', lineHeight: 1, paddingBottom: 14 }}>→</div>
        <div>
          <div style={{ fontFamily: DMONO, fontSize: 26, fontWeight: 700, color: actionColor, lineHeight: 1 }}>{evt.consensus}</div>
          <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginTop: 4 }}>Market-implied</div>
        </div>
        {evt.action && (
          <div style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 7, background: actionColor + '22', border: `1px solid ${actionColor}44`, alignSelf: 'flex-start' }}>
            <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, color: actionColor }}>{evt.action.toUpperCase()}</span>
          </div>
        )}
      </div>
    ) : null;

    // CPI: show last actual → crowd estimate
    const la = evt.lastActual;
    const cpiFromTo = !isFomc ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
        {la ? (
          <div>
            <div style={{ fontFamily: DMONO, fontSize: 26, fontWeight: 700, color: '#64748b', lineHeight: 1 }}>
              {la.value >= 0 ? '+' : ''}{la.value.toFixed(1)}%
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginTop: 4 }}>Last actual ({la.month})</div>
          </div>
        ) : null}
        {la && <div style={{ fontFamily: DSANS, fontSize: 20, color: '#94a3b8', lineHeight: 1, paddingBottom: 14 }}>→</div>}
        <div>
          <div style={{ fontFamily: DMONO, fontSize: 26, fontWeight: 700, color: '#a855f7', lineHeight: 1 }}>{evt.consensus}</div>
          <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginTop: 4 }}>Crowd estimate ({evt.date})</div>
        </div>
      </div>
    ) : null;

    return (
      <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#64748b' }}>
          {evt.label} · {evt.date}{evt.unit ? ` · ${evt.unit}` : ''}
        </div>
        {fomcFromTo || cpiFromTo}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>Market confidence</span>
            <span style={{ fontFamily: DMONO, fontSize: 13, color: '#e8edf5', fontWeight: 600 }}>{conf}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#1e2d3d', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${conf}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#94a3b8' }}>{convictionLabel} · {conf}% of market pricing this outcome</div>
        </div>
        <div style={{ background: '#060e19', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${barColor}55` }}>
          <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569', marginBottom: 5 }}>What this means</div>
          <div style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{implication}</div>
        </div>
      </div>
    );
  };

  const renderPolyRow = (sig, i, total) => {
    const sentColor  = sig.sentiment === 'bullish' ? '#22c55e' : sig.sentiment === 'bearish' ? '#ef4444' : '#f59e0b';
    const sentLabel  = sig.sentiment === 'bullish' ? 'Risk-On' : sig.sentiment === 'bearish' ? 'Risk-Off' : 'Neutral';
    const probPct    = (sig.probability * 100).toFixed(1);
    const pp         = sig.weekChange != null ? sig.weekChange * 100 : null;
    const ppStr      = pp != null ? `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp / 7d` : null;
    const ppColor    = pp != null ? (pp >= 0 ? '#22c55e' : '#ef4444') : '#64748b';
    const endLabel   = sig.endDate ? 'Resolves ' + new Date(sig.endDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;

    const p      = sig.probability;
    const rising = sig.weekChange != null && sig.weekChange > 0.02;

    const implication = sig.sentiment === 'bullish'
      ? p >= 0.65
        ? rising  ? 'Crowd conviction building — risk-on assets and growth stocks supported by this signal.'
                  : 'Strong crowd signal but momentum cooling — risk-on positioning intact, watch for reversal.'
        : p >= 0.40 ? 'Crowd is divided — wait for conviction above 65% before positioning on this outcome.'
                    : 'Crowd is not pricing this bullish scenario — risk assets may face headwinds.'
      : sig.sentiment === 'bearish'
      ? p >= 0.65
        ? rising  ? 'Bearish conviction rising — consider trimming cyclicals, adding defensives (XLV, XLP) or cash.'
                  : 'Elevated bearish signal but momentum stalling — cautiously defensive, watch for stabilization.'
        : p >= 0.40 ? 'Split signal — maintain balanced positioning until this resolves above 65% or below 35%.'
                    : 'Crowd is not pricing this bearish outcome — markets are looking through this risk for now.'
      : 'No strong directional crowd signal — focus on earnings and sector momentum near-term.';

    return (
      <div key={i} style={{ padding: '16px 0', borderBottom: i === total - 1 ? 'none' : '1px solid #1a2942' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: DSANS, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.45, marginBottom: 5 }}>{sig.label}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: 5, background: sentColor + '22', border: `1px solid ${sentColor}44`, fontFamily: DSANS, fontSize: 10, fontWeight: 700, color: sentColor }}>{sentLabel}</span>
              {ppStr && <span style={{ fontFamily: DMONO, fontSize: 10.5, color: ppColor }}>{ppStr}</span>}
              {endLabel && <span style={{ fontFamily: DSANS, fontSize: 10, color: '#94a3b8' }}>{endLabel}</span>}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div style={{ fontFamily: DMONO, fontSize: 20, fontWeight: 700, color: sentColor, lineHeight: 1 }}>{probPct}%</div>
            <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginTop: 2 }}>probability</div>
          </div>
        </div>
        <div style={{ height: 5, borderRadius: 2.5, background: '#1e2d3d', overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${probPct}%`, background: sentColor, borderRadius: 2.5, opacity: 0.75 }} />
        </div>
        <div style={{ fontFamily: DSANS, fontSize: 11, color: '#475569', lineHeight: 1.5 }}>{implication}</div>
      </div>
    );
  };

  const loading = (
    <div style={{ fontFamily: DSANS, fontSize: 13, color: '#475569', padding: '16px 0' }}>Loading…</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        {secLabel('CPI Inflation History')}
        <CpiHistoryChart />
      </div>
      <div>
        {secLabel('Kalshi — Prediction Markets')}
        {!kalshi ? loading : kalshiEvents.length === 0 ? (
          <div style={{ fontFamily: DSANS, fontSize: 13, color: '#475569', padding: '12px 0' }}>No open Kalshi events found.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: fomcEvent && cpiEvent ? '1fr 1fr' : '1fr', gap: 14 }}>
            {fomcEvent && renderKalshiBox(fomcEvent)}
            {cpiEvent  && renderKalshiBox(cpiEvent)}
          </div>
        )}
      </div>
      <div>
        {secLabel('Polymarket — Macro Signals')}
        {!poly ? loading : polySignals.length === 0 ? (
          <div style={{ fontFamily: DSANS, fontSize: 13, color: '#475569', padding: '12px 0' }}>No qualifying Polymarket signals found.</div>
        ) : (
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '4px 20px' }}>
            {polySignals.map((sig, i) => renderPolyRow(sig, i, polySignals.length))}
          </div>
        )}
      </div>
      {kalshi && poly && (() => {
        const top5      = polySignals.slice(0, 5);
        const bulls     = top5.filter(s => s.sentiment === 'bullish').length;
        const bears     = top5.filter(s => s.sentiment === 'bearish').length;
        const n         = top5.length;
        const skewDir   = bulls > bears ? 'bullish' : bears > bulls ? 'bearish' : 'neutral';
        const skewColor = skewDir === 'bullish' ? '#22c55e' : skewDir === 'bearish' ? '#ef4444' : '#f59e0b';
        const skewLabel = bulls > bears ? `${bulls}/${n} Bullish` : bears > bulls ? `${bears}/${n} Bearish` : `Mixed ${n > 0 ? n + '/'+n : ''}`;

        const fedAction = fomcEvent?.action || null;
        const fedColor  = fedAction === 'Cut' ? '#22c55e' : fedAction === 'Hike' ? '#ef4444' : '#f59e0b';

        const cpiRaw  = cpiEvent ? parseFloat((cpiEvent.consensus || '').replace(/[~+%\s]/g, '')) : NaN;
        const cpiColor = !isNaN(cpiRaw) ? (cpiRaw > 0.2 ? '#ef4444' : cpiRaw < 0 ? '#22c55e' : '#f59e0b') : '#f59e0b';

        let direction, dirColor, dirText;
        if (fedAction === 'Cut' && skewDir === 'bullish') {
          direction = 'Risk-On';    dirColor = '#22c55e';
          dirText   = 'Rate cuts anticipated and crowd sentiment is constructive — equity exposure and duration are supported near-term.';
        } else if ((fedAction === 'Hold' || fedAction === 'Hike') && skewDir === 'bearish') {
          direction = 'Risk-Off';   dirColor = '#ef4444';
          dirText   = 'No rate relief expected and crowd sentiment is bearish — reduce risk, favor cash and defensives.';
        } else if (fedAction === 'Cut' && skewDir === 'bearish') {
          direction = 'Divergence'; dirColor = '#f59e0b';
          dirText   = 'Fed pivot is priced in but crowd risk sentiment is bearish — macro uncertainty is elevated; position cautiously.';
        } else if (fedAction === 'Hold' && skewDir === 'bullish') {
          direction = 'Selective';  dirColor = '#f59e0b';
          dirText   = 'Rates on hold but the crowd remains constructive — earnings momentum and sector rotation drive near-term returns.';
        } else {
          direction = 'Mixed';      dirColor = '#f59e0b';
          dirText   = 'No clear directional conviction from prediction markets — await a catalyst before adding directional exposure.';
        }

        const cols = [fomcEvent, cpiEvent, n > 0].filter(Boolean).length || 1;

        return (
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 14 }}>Aggregated Crowd Signal</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, marginBottom: 14 }}>
              {fomcEvent && (
                <div style={{ padding: '11px 13px', background: '#080c14', borderRadius: 10, border: `1px solid ${fedColor}28` }}>
                  <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Rate Markets</div>
                  <div style={{ fontFamily: DMONO, fontSize: 15, fontWeight: 700, color: fedColor }}>{fomcEvent.action}</div>
                  <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginTop: 4 }}>{fomcEvent.confidence}% confidence · {fomcEvent.consensus}</div>
                </div>
              )}
              {cpiEvent && (
                <div style={{ padding: '11px 13px', background: '#080c14', borderRadius: 10, border: `1px solid ${cpiColor}28` }}>
                  <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Inflation</div>
                  <div style={{ fontFamily: DMONO, fontSize: 15, fontWeight: 700, color: cpiColor }}>CPI {cpiEvent.consensus}</div>
                  <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginTop: 4 }}>{cpiEvent.confidence}% crowd consensus</div>
                </div>
              )}
              {n > 0 && (
                <div style={{ padding: '11px 13px', background: '#080c14', borderRadius: 10, border: `1px solid ${skewColor}28` }}>
                  <div style={{ fontFamily: DSANS, fontSize: 10, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>Crowd Skew</div>
                  <div style={{ fontFamily: DMONO, fontSize: 15, fontWeight: 700, color: skewColor }}>{skewLabel}</div>
                  <div style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b', marginTop: 4 }}>Polymarket top {n} signals</div>
                </div>
              )}
            </div>
            <div style={{ padding: '11px 14px', borderRadius: 9, background: dirColor + '0f', border: `1px solid ${dirColor}28`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontFamily: DMONO, fontSize: 11, fontWeight: 700, color: dirColor, whiteSpace: 'nowrap', letterSpacing: '.04em' }}>{direction}</span>
              <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55 }}>{dirText}</span>
            </div>
          </div>
        );
      })()}
      {(summaryStatus === 'loading' || summaryStatus === 'ready') && (
        <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderLeft: '3px solid #60a5fa', borderRadius: 14, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: summaryStatus === 'ready' ? 12 : 0 }}>
            <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#60a5fa', flex: 1 }}>Crowd Signal Summary</span>
            <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 600, color: '#60a5fa', padding: '2px 7px', borderRadius: 4, background: '#0d1e35', border: '1px solid #1a3a5c', letterSpacing: '.04em' }}>✦ CLAUDE</span>
          </div>
          {summaryStatus === 'loading' && (
            <span style={{ fontFamily: DSANS, fontSize: 13, color: '#64748b' }}>Synthesizing crowd signals…</span>
          )}
          {summaryStatus === 'ready' && summary && (
            <p style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', lineHeight: 1.65, margin: 0 }}>{summary}</p>
          )}
        </div>
      )}
      <div style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
        Kalshi: KXFED (Fed funds rate) and KXCPI (CPI MoM) series — FOMC confidence reflects implied probability at the market-implied rate. Polymarket: top macro signals by volume from Macro Single and Macro Indicators tags, filtered for yield-relevant keywords.
      </div>
    </div>
  );
}

// ── VIX Term Structure panel — Equities deep-dive ────────────────────────────
const sectionLabel = (txt) => (
  <div style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', marginBottom: 10 }}>{txt}</div>
);

function VIXTermStructure({ vix }) {
  const [hover, setHover] = useStateD(null);
  if (!vix) return null;
  const pts = [
    { sym: '^VIX9D', label: 'VIX9D', desc: '9-Day',   val: vix.v9d },
    { sym: '^VIX',   label: 'VIX',   desc: '30-Day',  val: vix.v30 },
    { sym: '^VIX3M', label: 'VIX3M', desc: '3-Month', val: vix.v3m },
    { sym: '^VIX6M', label: 'VIX6M', desc: '6-Month', val: vix.v6m },
  ].filter(p => p.val != null);
  if (pts.length < 2) return null;

  const shape = vix.shape;
  const shapeLabel = shape === 'backwardation' ? 'Backwardation' : shape === 'contango' ? 'Contango' : 'Flat';
  const shapeColor = shape === 'backwardation' ? '#ef4444' : shape === 'contango' ? '#22c55e' : '#f59e0b';
  const interp = shape === 'backwardation'
    ? 'Short-term options are more expensive than long-term ones — traders are paying up to hedge against something happening soon. This is unusual and signals near-term stress or a known risk event. It often marks a fear peak; once the spike fades and VIX9D drops back below VIX, that is typically the cleaner entry for risk.'
    : shape === 'contango'
    ? 'Short-term options are cheaper than long-term ones — the normal state. No one is panicking about next week; any uncertainty is priced further out. When this lines up with a bullish macro backdrop, it is straightforward confirmation that risk appetite is healthy.'
    : 'Volatility is priced roughly the same across all maturities — neither near-term fear nor long-term complacency is dominant. Typically a transitional read with no strong signal in either direction.';

  const W = 480, H = 120, padL = 36, padB = 8, padT = 20, padR = 12;
  const innerW = W - padL - padR, innerH = H - padB - padT;
  const vals  = pts.map(p => p.val);
  const minV  = Math.min(...vals), maxV = Math.max(...vals);
  const span  = maxV - minV || 1;
  const yFloor = Math.max(0, minV - span * 0.5);
  const yCeil  = maxV + span * 0.3;
  const yRange = yCeil - yFloor;
  const yOf = v => padT + innerH * (1 - (v - yFloor) / yRange);
  const n = pts.length;
  const xOf = i => padL + i * (innerW / (n - 1));
  const linePts = pts.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.val).toFixed(1)}`).join(' ');
  const areaPts = `${xOf(0).toFixed(1)},${(padT + innerH).toFixed(1)} ${linePts} ${xOf(n-1).toFixed(1)},${(padT + innerH).toFixed(1)}`;
  const ticks = [yFloor, (yFloor + yCeil) / 2, yCeil].map(v => Math.round(v));
  const vixLevel = vix.v30 ?? pts[0].val;
  const vixZone  = vixLevel < 15 ? { label: 'VIX < 15 — Complacency', color: '#f59e0b' }
    : vixLevel < 20 ? { label: `VIX ${vixLevel.toFixed(1)} — Normal`,    color: '#22c55e' }
    : vixLevel < 30 ? { label: `VIX ${vixLevel.toFixed(1)} — Elevated`,  color: '#f59e0b' }
    :                  { label: `VIX ${vixLevel.toFixed(1)} — Fear Zone`, color: '#ef4444' };

  return (
    <div>
      {sectionLabel('VIX Term Structure')}
      <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '16px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: DSANS, fontSize: 14, fontWeight: 600, color: '#cbd5e1' }}>VIX Term Structure</div>
            <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>Implied volatility across maturities — slope reveals near-term fear vs calm</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, marginLeft: 16 }}>
            <div style={{ background: shapeColor + '22', border: `1px solid ${shapeColor}55`, borderRadius: 6, padding: '3px 10px' }}>
              <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, color: shapeColor }}>{shapeLabel}</span>
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 600, color: vixZone.color }}>{vixZone.label}</div>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%' }}>
            {ticks.map(v => {
              const y = yOf(v);
              return (
                <g key={v}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1e2d3d" strokeWidth={0.5} />
                  <text x={padL - 4} y={y + 3.5} textAnchor="end" fontSize={8.5} fill="#64748b">{v}</text>
                </g>
              );
            })}
            <polygon points={areaPts} fill={shapeColor} opacity={0.08} />
            <polyline points={linePts} fill="none" stroke={shapeColor} strokeWidth={2} strokeLinejoin="round" />
            {pts.map((p, i) => {
              const x = xOf(i), y = yOf(p.val);
              const isHov = hover === i;
              return (
                <g key={p.sym} style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx={x} cy={y} r={12} fill="transparent" />
                  <circle cx={x} cy={y} r={isHov ? 5 : 3.5} fill={shapeColor} />
                  <circle cx={x} cy={y} r={isHov ? 2 : 1.4} fill="#0d1520" />
                </g>
              );
            })}
          </svg>
          {hover !== null && (() => {
            const frac = hover / Math.max(n - 1, 1);
            const posStyle = frac > 0.55
              ? { right: `calc(${(1 - frac) * 100}% + 14px)` }
              : { left: `calc(${frac * 100}% + 14px)` };
            return (
              <div style={{
                position: 'absolute', top: 10, pointerEvents: 'none', zIndex: 10, ...posStyle,
                background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 10,
                padding: '10px 14px', minWidth: 160,
                boxShadow: '0 8px 24px rgba(0,0,0,.5)',
              }}>
                {pts.map((p, i) => {
                  const active = i === hover;
                  return (
                    <div key={p.sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: i < pts.length - 1 ? 5 : 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? shapeColor : '#334155', flexShrink: 0 }} />
                        <span style={{ fontFamily: DSANS, fontSize: 12, color: active ? '#cbd5e1' : '#475569' }}>{p.label}</span>
                      </span>
                      <span style={{ fontFamily: DMONO, fontSize: 12.5, color: active ? '#e8edf5' : '#475569', fontWeight: 600 }}>{p.val.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
        <div style={{ fontFamily: DSANS, fontSize: 12, color: '#8295a9', lineHeight: 1.55, borderTop: '1px solid #1e2d3d', paddingTop: 10, marginTop: 4 }}>
          <span style={{ color: shapeColor, fontWeight: 600 }}>{shapeLabel}: </span>{interp}
        </div>
      </div>
    </div>
  );
}

// ── VIX History chart — Equities deep-dive ───────────────────────────────────
function VIXHistoryChart() {
  const [tab, setTab]     = useStateD('levels');
  const [range, setRange] = useStateD('1Y');
  const [data, setData]   = useStateD(null);
  const RMAP = { '1Y': '1y', '3Y': '3y', '5Y': '5y' };

  useEffectD(() => {
    let alive = true;
    setData(null);
    fetch(`/api/vix-history?range=${RMAP[range]}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d?.dates?.length) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [range]);

  const W = 640, H = 170, padL = 38, padB = 26, padT = 14, padR = 8;
  const innerW = W - padL - padR, innerH = H - padB - padT;
  const xOf4 = (n) => [0, Math.floor(n / 3), Math.floor(2 * n / 3), n - 1];

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} style={{
      fontFamily: DSANS, fontSize: 10, fontWeight: 700, padding: '3px 9px',
      borderRadius: 4, border: 'none', cursor: 'pointer',
      background: tab === key ? '#22d3ee' : 'transparent', color: tab === key ? '#000' : '#64748b',
    }}>{label}</button>
  );
  const rangeBtn = (r) => (
    <button key={r} onClick={() => setRange(r)} style={{
      fontFamily: DSANS, fontSize: 10, fontWeight: 700, padding: '3px 7px',
      borderRadius: 4, border: 'none', cursor: 'pointer',
      background: range === r ? '#334155' : 'transparent', color: range === r ? '#cbd5e1' : '#475569',
    }}>{r}</button>
  );

  const empty = (msg) => (
    <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: DSANS, fontSize: 12, color: '#64748b' }}>{msg}</span>
    </div>
  );

  const renderLevels = () => {
    const series = data?.series || [];
    if (!series.length) return empty('No VIX history yet — run /api/refresh to seed data');
    const n = data.dates.length;
    const allVals = series.flatMap(s => s.values).filter(v => v != null);
    const maxV = Math.max(...allVals, 30) * 1.08;
    const xOf = i => padL + (i / Math.max(n - 1, 1)) * innerW;
    const yOf = v => padT + innerH * (1 - v / maxV);
    const ticks = [0, 20, 30, Math.round(maxV)].filter((v, i, a) => v <= maxV && a.indexOf(v) === i);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%' }}>
        {/* Background bands */}
        <rect x={padL} y={yOf(maxV)}  width={innerW} height={yOf(30) - yOf(maxV)} fill="rgba(239,68,68,0.07)" />
        <rect x={padL} y={yOf(30)}    width={innerW} height={yOf(20) - yOf(30)}   fill="rgba(245,158,11,0.06)" />
        <rect x={padL} y={yOf(20)}    width={innerW} height={yOf(0)  - yOf(20)}   fill="rgba(34,197,94,0.04)"  />
        {/* Band labels */}
        <text x={W - padR - 2} y={yOf((maxV + 30) / 2) + 3} textAnchor="end" fontSize={7.5} fill="rgba(239,68,68,0.45)">Fear</text>
        <text x={W - padR - 2} y={yOf(25) + 3}              textAnchor="end" fontSize={7.5} fill="rgba(245,158,11,0.45)">Elevated</text>
        <text x={W - padR - 2} y={yOf(10) + 3}              textAnchor="end" fontSize={7.5} fill="rgba(34,197,94,0.45)">Normal</text>
        {/* Y gridlines */}
        {ticks.map(v => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1e2d3d" strokeWidth={v === 20 || v === 30 ? 0.7 : 0.4} strokeDasharray={v === 20 || v === 30 ? '3 3' : null} />
              <text x={padL - 4} y={y + 3.5} textAnchor="end" fontSize={8} fill="#64748b">{v}</text>
            </g>
          );
        })}
        {/* Series lines */}
        {series.map(s => {
          let d = ''; let on = false;
          s.values.forEach((v, i) => {
            if (v == null) { on = false; return; }
            const pt = `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
            d += on ? ` L${pt}` : `M${pt}`; on = true;
          });
          return <path key={s.sym} d={d} fill="none" stroke={s.color} strokeWidth={1.5} />;
        })}
        {/* X labels */}
        {xOf4(n).map(i => (
          <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize={7.5} fill="#475569">{(data.dates[i] || '').slice(0, 7)}</text>
        ))}
      </svg>
    );
  };

  const renderSpread = () => {
    const spread = data?.spread;
    if (!spread) return empty('Requires both VIX9D and VIX3M data');
    const vals = spread.values;
    const n = data.dates.length;
    const nonNull = vals.filter(v => v != null);
    if (!nonNull.length) return empty('No spread data yet');
    const absMax = Math.max(Math.abs(Math.min(...nonNull)), Math.abs(Math.max(...nonNull)), 2) * 1.2;
    const xOf  = i => padL + (i / Math.max(n - 1, 1)) * innerW;
    const yOf  = v => padT + innerH * (1 - (v + absMax) / (absMax * 2));
    const yZ   = yOf(0);
    const ticks = [-Math.round(absMax), -2, 0, 2, Math.round(absMax)].filter((v, i, a) => Math.abs(v) <= absMax && a.indexOf(v) === i);

    // Build polygon of the full spread area; clipPaths cut it at zero for two-color fill
    const first = vals.findIndex(v => v != null);
    const last  = vals.length - 1 - [...vals].reverse().findIndex(v => v != null);
    const polyPts = [
      `${xOf(first).toFixed(1)},${yZ.toFixed(1)}`,
      ...vals.map((v, i) => v != null ? `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}` : null).filter(Boolean),
      `${xOf(last).toFixed(1)},${yZ.toFixed(1)}`,
    ].join(' ');

    let linePts = ''; let on = false;
    vals.forEach((v, i) => {
      if (v == null) { on = false; return; }
      const pt = `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
      linePts += on ? ` L${pt}` : `M${pt}`; on = true;
    });

    const aboveId = `vix-above-${range}`, belowId = `vix-below-${range}`;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%' }}>
        <defs>
          <clipPath id={aboveId}><rect x={padL} y={padT}  width={innerW} height={Math.max(0, yZ - padT)} /></clipPath>
          <clipPath id={belowId}><rect x={padL} y={yZ}    width={innerW} height={Math.max(0, padT + innerH - yZ)} /></clipPath>
        </defs>
        {/* Y gridlines */}
        {ticks.map(v => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v === 0 ? '#334155' : '#1e2d3d'} strokeWidth={v === 0 ? 1.2 : 0.4} />
              <text x={padL - 4} y={y + 3.5} textAnchor="end" fontSize={8} fill={v === 0 ? '#475569' : '#374151'}>{v > 0 ? '+' : ''}{v}</text>
            </g>
          );
        })}
        {/* Colour fills clipped at zero */}
        <polygon points={polyPts} fill="rgba(239,68,68,0.25)"  clipPath={`url(#${aboveId})`} />
        <polygon points={polyPts} fill="rgba(34,197,94,0.2)"   clipPath={`url(#${belowId})`} />
        {/* Spread line */}
        <path d={linePts} fill="none" stroke="#94a3b8" strokeWidth={1.2} />
        {/* Zone labels */}
        <text x={W - padR - 2} y={yOf(absMax * 0.6) + 3}  textAnchor="end" fontSize={7.5} fill="rgba(239,68,68,0.55)">Backwardation</text>
        <text x={W - padR - 2} y={yOf(-absMax * 0.6) + 3} textAnchor="end" fontSize={7.5} fill="rgba(34,197,94,0.55)">Contango</text>
        {/* X labels */}
        {xOf4(n).map(i => (
          <text key={i} x={xOf(i)} y={H - 4} textAnchor="middle" fontSize={7.5} fill="#475569">{(data.dates[i] || '').slice(0, 7)}</text>
        ))}
      </svg>
    );
  };

  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '16px 20px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: DSANS, fontSize: 14, fontWeight: 600, color: '#cbd5e1' }}>VIX History</div>
          <div style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', marginTop: 2 }}>
            {tab === 'levels'
              ? 'Implied volatility levels across maturities over time'
              : 'VIX9D − VIX3M spread — positive = backwardation (near-term fear), negative = contango (calm)'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ display: 'flex', background: '#111827', borderRadius: 5, padding: 2 }}>
            {tabBtn('levels', 'Levels')}
            {tabBtn('spread', 'Shape Signal')}
          </div>
          <div style={{ display: 'flex', background: '#111827', borderRadius: 5, padding: 2 }}>
            {['1Y', '3Y', '5Y'].map(rangeBtn)}
          </div>
        </div>
      </div>
      {tab === 'levels' && data?.series?.length > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
          {data.series.map(s => (
            <div key={s.sym} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 2, background: s.color, borderRadius: 1 }} />
              <span style={{ fontFamily: DSANS, fontSize: 10, color: '#8295a9' }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
      {!data
        ? empty('Loading…')
        : tab === 'levels' ? renderLevels() : renderSpread()
      }
      {tab === 'spread' && data && (
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 8, background: 'rgba(239,68,68,0.4)', borderRadius: 1 }} />
            <span style={{ fontFamily: DSANS, fontSize: 10, color: '#8295a9' }}>Backwardation — near-term fear spike</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 8, background: 'rgba(34,197,94,0.35)', borderRadius: 1 }} />
            <span style={{ fontFamily: DSANS, fontSize: 10, color: '#8295a9' }}>Contango — normal / calm market</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Full deep-dive content (chart + regime timeline + stats + indicators) — shared by all options ──
function DeepDiveContent({ card, cardId, asOf, chartHeight = 230 }) {
  const sg = DSIG[card.status];
  const [range, setRange] = useStateD('1Y');
  const [sectorsChartRange, setSectorsChartRange] = useStateD('1Y');
  const [regimeRange, setRegimeRange] = useStateD('20D');
  const [live, setLive] = useStateD(null);
  const [regimeLive, setRegimeLive] = useStateD(null);
  const [qcRange, setQcRange] = useStateD('20D');
  const [lpriceData, setLpriceData] = useStateD(null);
  const [eqBreadthLive, setEqBreadthLive] = useStateD(null);

  const activeRange   = cardId === 'leadership' ? qcRange   : cardId === 'regime' ? regimeRange   : range;
  const setActiveRange = cardId === 'leadership' ? setQcRange : cardId === 'regime' ? setRegimeRange : setRange;

  useEffectD(() => {
    let alive = true;
    setLive(null);
    if (window.MarketHubData && cardId) {
      window.MarketHubData.loadHistory(cardId, activeRange).then((r) => {
        if (alive && r && r.values && r.values.length > 1) setLive(r);
      });
    }
    return () => { alive = false; };
  }, [cardId, activeRange]);

  // Regime timeline always uses 1Y data independent of the chart range selector
  useEffectD(() => {
    let alive = true;
    setRegimeLive(null);
    if (window.MarketHubData && cardId) {
      window.MarketHubData.loadHistory(cardId, '1Y').then((r) => {
        if (alive && r && r.values && r.values.length > 1) setRegimeLive(r);
      });
    }
    return () => { alive = false; };
  }, [cardId]);

  // Equities history: VIX-based monthly regime from D1
  useEffectD(() => {
    if (cardId !== 'equities') return;
    let alive = true;
    fetch('/api/vix-regime?months=24')
      .then(r => r.json())
      .then(d => { if (alive && d.dates?.length) setEqBreadthLive(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cardId]);

  // Leadership quality check: raw 1Y prices for rebased-spread computation (same methodology as chart 1)
  useEffectD(() => {
    if (cardId !== 'leadership') return;
    let alive = true;
    fetch('/api/leadership?range=1y')
      .then(r => r.json())
      .then(j => { if (alive && j.prices && j.dates?.length) setLpriceData({ dates: j.dates, prices: j.prices }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cardId]);

  // Leadership: the chart's live series for this card is already a cumulative spread
  // over the selected range, so tie the "Spread" key metrics to that same range instead
  // of always showing the server's fixed 5Y figure. Daily Streak / Growth vs Value (no
  // chart equivalent) pass through untouched.
  const leadershipStats = (() => {
    if (cardId !== 'leadership' || !card.stats) return card.stats;
    if (!lpriceData) return card.stats;
    const DAYS = { '20D': 21, '50D': 51, '200D': 201 };
    const n = Math.min(DAYS[qcRange] || 21, lpriceData.dates.length);
    const rebase = (sym) => {
      const sliced = (lpriceData.prices[sym] || []).slice(-n);
      const first = sliced.find(v => v != null && v > 0);
      if (!first) return sliced.map(() => null);
      return sliced.map(v => v == null ? null : ((v - first) / first) * 100);
    };
    const sub = (a, b) => a.map((v, i) => v == null || b[i] == null ? null : v - b[i]);
    const rspVals  = sub(rebase('RSP'),  rebase('SPY'));
    const qqewVals = sub(rebase('QQEW'), rebase('QQQ'));
    const rspSpread  = rspVals[rspVals.length - 1];
    const qqewSpread = qqewVals[qqewVals.length - 1];
    const fmt  = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    const tone = (v) => v == null ? null : v > 0 ? 'pos' : v < 0 ? 'neg' : null;
    return card.stats.map((s) => {
      const desc = (s[2] || '').toLowerCase();
      if (desc.includes('rsp vs spy'))  return [`${qcRange} Market Spread`, fmt(rspSpread),  'RSP vs SPY',  tone(rspSpread)];
      if (desc.includes('qqew vs qqq')) return [`${qcRange} Tech Spread`,   fmt(qqewSpread), 'QQEW vs QQQ', tone(qqewSpread)];
      return s;
    });
  })();

  // Leadership "Quality Check": pick the spread pair with the largest absolute divergence
  // at the selected window (20D/50D/200D) using rebased prices — same methodology as chart 1
  const qualityCheck = (() => {
    if (cardId !== 'leadership') return { live, label: null, spread: null };
    if (!lpriceData) return { live: null, label: null, spread: null };
    const DAYS = { '20D': 21, '50D': 51, '200D': 201 };
    const n = Math.min(DAYS[qcRange] || 21, lpriceData.dates.length);
    const dates = lpriceData.dates.slice(-n);
    const rebase = (sym) => {
      const sliced = (lpriceData.prices[sym] || []).slice(-n);
      const first = sliced.find(v => v != null && v > 0);
      if (!first) return sliced.map(() => null);
      return sliced.map(v => v == null ? null : ((v - first) / first) * 100);
    };
    const sub = (a, b) => a.map((v, i) => v == null || b[i] == null ? null : v - b[i]);
    const candidates = [
      { label: 'RSP vs SPY',  spreadVals: sub(rebase('RSP'),  rebase('SPY')),  color: '#a855f7' },
      { label: 'QQEW vs QQQ', spreadVals: sub(rebase('QQEW'), rebase('QQQ')),  color: '#818cf8' },
      { label: 'IVW vs IVE',  spreadVals: sub(rebase('IVW'),  rebase('IVE')),  color: '#ef4444' },
    ];
    const dom = candidates.reduce((best, c) => {
      const bv = Math.abs(best.spreadVals[best.spreadVals.length - 1] ?? 0);
      const cv = Math.abs(c.spreadVals[c.spreadVals.length - 1]    ?? 0);
      return cv > bv ? c : best;
    });
    const last = dom.spreadVals[dom.spreadVals.length - 1] ?? 0;
    const fmt  = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    return {
      live:   { values: dom.spreadVals, dates, label: dom.label, format: 'pct', lineColor: dom.color, overlays: [], thresholds: [{ y: 0, color: '#475569' }] },
      label:  dom.label,
      spread: fmt(last),
    };
  })();

  if (cardId === 'breadth') {
    // Breadth order: NYSE Breadth → Breadth History → Sector ETF Breadth → Sector Breakdown → Consumer Signal → Key Metrics → Summary
    const liveSectorCount = card.sectorTable ? card.sectorTable.filter(s => s.bull).length : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <NyseBreadthChart />
        <NyseAdidChart />
        <div>
          {sectionLabel('Breadth History')}
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 20px' }}>
            <RegimeTimeline card={card} cardId={cardId} asOf={asOf} liveData={regimeLive} />
          </div>
        </div>
        <SectorBreadthChart liveSectorCount={liveSectorCount} />
        {card.sectorTable && card.sectorTable.length > 0 && (
          <div>
            {sectionLabel('Sector Breakdown')}
            <SectorBreakdown sectorTable={card.sectorTable} />
          </div>
        )}
        <div>
          {sectionLabel(`${card.title} Metrics`)}
          <BreadthStatBoxes sectorCount={liveSectorCount} sectorTotal={card.sectorTable?.length || 11} consumerRow={(card.rows||[]).find(r => r[0] === 'Consumer Signal')} />
        </div>
        {card.note && (
          <div>
            {sectionLabel('Market Diagnostics')}
            <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '16px 20px' }}>
              {(() => { const items = buildBreadthDiagnostics(card); return items ? (<div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e2d3d' }}>{items.map(({ label, q, a, c }, idx, arr) => (<div key={label} style={{ paddingTop: idx===0?0:11, paddingBottom: idx<arr.length-1?11:0, borderBottom: idx<arr.length-1?'1px solid #0d1e2e':'none' }}><div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>{label}</div><div style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 600, color: c, lineHeight: 1.4, marginBottom: 4 }}>{a}</div><div style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{q}</div></div>))}</div>) : null; })()}
              <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 7 }}>Market Narrative</div>
              <p style={{ fontFamily: DSANS, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.65, margin: 0 }}>{card.note}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (cardId === 'equities') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <EquitiesFocusChart />
        <EquitiesChart />
        {card.vix && <VIXTermStructure vix={card.vix} />}
        <VIXHistoryChart />
        <div>
          {sectionLabel('Equities History')}
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 20px' }}>
            <RegimeTimeline card={card} cardId={cardId} asOf={asOf} liveData={eqBreadthLive} />
          </div>
        </div>
        <div>
          {sectionLabel('Indicators')}
          <IndicatorTable rows={card.rows} indicatorWidth={80} signalDescriptions={EQ_DESCRIPTIONS} hoverDescriptions={EQ_WHY} />
        </div>
        <div>
          {sectionLabel('Equities Metrics')}
          <EquitiesMASummary rows={card.rows} />
        </div>
        {card.note && (
          <div>
            {sectionLabel('Market Diagnostics')}
            <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '16px 20px' }}>
              {(() => { const items = buildEquitiesDiagnostics(card); return items ? (<div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e2d3d' }}>{items.map(({ label, q, a, c }, idx, arr) => (<div key={label} style={{ paddingTop: idx===0?0:11, paddingBottom: idx<arr.length-1?11:0, borderBottom: idx<arr.length-1?'1px solid #0d1e2e':'none' }}><div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>{label}</div><div style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 600, color: c, lineHeight: 1.4, marginBottom: 4 }}>{a}</div><div style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{q}</div></div>))}</div>) : null; })()}
              <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 7 }}>Market Narrative</div>
              <p style={{ fontFamily: DSANS, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.65, margin: 0 }}>{card.note}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (cardId === 'positioning') {
    return <PositioningDeepDive />;
  }

  if (cardId === 'crowdsignals') {
    return <CrowdSignalsDeepDive />;
  }

  // Credit card: reorder rows and reformat value for deep dive only
  const indicatorRows = cardId === 'credit' ? (() => {
    const ORDER = ['Risk Appetite', 'Credit Quality', 'Spread Signal', 'Global Credit'];
    const sorted = ORDER.map(label => card.rows.find(r => r[0] === label)).filter(Boolean);
    return sorted.map(r => {
      const ticker = (r[4] || '').split(' ')[0];
      if (['HYG', 'LQD', 'EMB'].includes(ticker) && r[1]?.includes('\n') && r[0] !== 'Spread Signal') {
        const [vs200Line, priceLine] = r[1].split('\n');
        const vs200Part = vs200Line.replace(/^(HYG|LQD|EMB)\s+/, '');
        return [r[0], `${ticker} ${priceLine}\n200d ${vs200Part}`, r[2], r[3], r[4], r[5], r[6]];
      }
      return r;
    });
  // Global Flows: show the 7 regional ETF rows in geographic order; skip the 'Regional Bull' summary row
  // Global and Emerging rows carry vs200 on line 1 of value (for the card tile); strip it here so the
  // Indicators table shows just the price, consistent with the other 5 regional rows.
  })() : cardId === 'globalflows' ? (() => {
    const ORDER = ['Global', 'USA', 'Canada', 'Europe', 'Asia', 'LatAm', 'Emerging'];
    return ORDER.map(label => {
      const r = card.rows.find(row => row[0] === label);
      if (!r) return null;
      if ((label === 'Global' || label === 'Emerging') && r[1]?.includes('\n')) {
        const price = r[1].split('\n')[1];
        return [r[0], price, r[2], r[3], r[4], r[5], r[6]];
      }
      return r;
    }).filter(Boolean);
  })() : cardId === 'valuations' ? card.rows.filter(r => !['CAPE', 'Buffett Ind.', 'Buffett Indicator'].includes(r[0])) : card.rows;

  const GF_FLAG_IMG = (code, alt) => <img src={`/assets/flags/${code}.svg`} alt={alt} style={{ width: 22, height: 15, borderRadius: 2, objectFit: 'cover', border: '1px solid #1e2d3d' }} />;
  const GF_FLAGS = { Global: '🌐', USA: GF_FLAG_IMG('us', 'US'), Canada: GF_FLAG_IMG('ca', 'CA'), Europe: '🌏', Asia: '🌏', LatAm: '🌎', Emerging: '🌍' };
  const gfIcons = cardId === 'globalflows' ? indicatorRows.map(r => GF_FLAGS[r[0]] || null) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* leadership-only: raw price history for all 6 underlying symbols, above the spread chart */}
      {cardId === 'leadership' && <LeadershipPriceChart />}
      {/* sectors-only: cyclicals vs defensives two-line chart above the spread chart */}
      {cardId === 'sectors' && <CycVsDefChart range={sectorsChartRange} setRange={setSectorsChartRange} />}
      {/* sectors-only: all-sector normalized performance watchlist */}
      {cardId === 'sectors' && <SectorsWatchlistChart />}
      {/* sectors-only: cycle-signal ratio charts (Idea 03B) */}
      {cardId === 'sectors' && <SectorRatioCharts />}
      {/* sectors-only: relative rotation graph (Idea 03A) */}
      {cardId === 'sectors' && <SectorRRG />}
      {/* credit-only: HYG / LQD / EMB vs 200d three-line chart */}
      {cardId === 'credit' && <CreditChart />}
      {cardId === 'credit' && <CreditSpreadChart />}
      {/* valuations-only: tabbed Trailing P/E | CAPE | Buffett Indicator chart */}
      {cardId === 'valuations' && <ValuationsChart />}
      {/* yield-only: tabbed 30Y / 10Y / 30Y vs 10Y chart + yield curve inversion */}
      {cardId === 'yield' && <YieldChart />}
      {cardId === 'yield' && <YieldSpreadChart />}
      {/* currency-only: USD/EUR/JPY vs 200d + FX regime relationship chart */}
      {cardId === 'currency' && <CurrencyChart />}
      {cardId === 'currency' && <CurrencyRegimeChart />}
      {/* globalflows-only: tabbed regional ETF chart + country watchlist */}
      {cardId === 'globalflows' && <GlobalFlowsChart />}
      {cardId === 'globalflows' && <CountryWatchlistChart />}
      {/* chart card — hidden for sectors, credit, globalflows, yield, currency, valuations (all replaced by custom charts above) */}
      {cardId !== 'sectors' && cardId !== 'credit' && cardId !== 'globalflows' && cardId !== 'yield' && cardId !== 'currency' && cardId !== 'valuations' && <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: DSANS, fontSize: 14, color: '#cbd5e1', fontWeight: 600 }}>
              {cardId === 'leadership' ? (qualityCheck.label || 'The Quality Check') : card.metric}
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 11.5, color: '#8295a9', marginTop: 2 }}>
              {cardId === 'leadership'
                ? `Largest ${qcRange} divergence · ${qualityCheck.spread || ''}`
                : card.metricUnit}
            </div>
          </div>
          {cardId !== 'leadership' && cardId !== 'regime' && cardId !== 'commodities' && <div style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 600, color: sg.c }}>{card.metricVal}</div>}
        </div>
        <DeepChartLg card={card} cardId={cardId} color={cardId === 'leadership' ? (qualityCheck.live?.lineColor || sg.c) : sg.c} height={chartHeight}
          range={activeRange} setRange={setActiveRange}
          live={cardId === 'leadership' ? qualityCheck.live : live}
          ranges={cardId === 'leadership' ? ['20D', '50D', '200D'] : cardId === 'regime' ? ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y', '20Y'] : (cardId === 'commodities' || cardId === 'equities') ? ['20D', '1W', '1M', '3M', '6M', '1Y', '5Y', '10Y'] : undefined} />
      </div>}
      {cardId === 'commodities' && <CommoditiesWatchlistChart />}
      {/* regime timeline — always 1Y, never tied to chart range */}
      <div>
        {sectionLabel(`${card.title} History`)}
        <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 16, padding: '18px 20px 20px' }}>
          <RegimeTimeline card={card} cardId={cardId} asOf={asOf} liveData={regimeLive} />
        </div>
      </div>
      {/* indicators — hidden for regime, leadership, yield, and currency (superseded by metrics boxes) */}
      {cardId !== 'regime' && cardId !== 'leadership' && cardId !== 'yield' && cardId !== 'currency' && (
        <div>
          {sectionLabel('Indicators')}
          <IndicatorTable rows={indicatorRows}
            indicatorWidth={cardId === 'commodities' || cardId === 'sectors' ? 80 : 285}
            signalDescriptions={cardId === 'commodities' ? COMM_DESCRIPTIONS : cardId === 'sectors' ? SECT_DESCRIPTIONS : null}
            hoverDescriptions={cardId === 'commodities' ? COMM_WHY : cardId === 'sectors' ? SECT_WHY : null}
            showSectorWeights={cardId === 'sectors'}
            icons={gfIcons} />
        </div>
      )}
      {/* country breakdown — global flows card only */}
      {card.details && card.details.length > 0 && (
        <div>
          {sectionLabel('Country Breakdown')}
          <CountryTable details={card.details} />
        </div>
      )}
      {/* key metrics */}
      {card.stats && card.stats.length > 0 && (
        <div>
          {sectionLabel(`${card.title} Metrics`)}
          {cardId === 'regime' ? (() => {
            const { row1, row2 } = buildRegimeMetrics(card);
            return (<><div style={{ marginBottom: 10 }}><StatBoxes stats={row1} /></div><StatBoxes stats={row2} /></>);
          })() : cardId === 'leadership' ? (() => {
            const { row1, row2 } = buildLeadershipMetrics(card, leadershipStats, qcRange);
            return (<><div style={{ marginBottom: 10 }}><StatBoxes stats={row1} /></div><StatBoxes stats={row2} /></>);
          })() : cardId === 'sectors' ? (() => {
            const row = buildSectorsMetrics(card);
            return (
              <>
                <div style={{ marginBottom: 10 }}><StatBoxes stats={row} /></div>
                <SectorsApiMetricsRow range={sectorsChartRange} />
              </>
            );
          })() : cardId === 'commodities' ? (() => {
            const { row1, row2 } = buildCommoditiesMetrics(card);
            return (
              <>
                <div style={{ marginBottom: row2 ? 0 : 0 }}><StatBoxes stats={row1} /></div>
                {row2 && (
                  <div style={{ marginTop: 10 }}>
                    <StatBoxes stats={row2} />
                  </div>
                )}
              </>
            );
          })() : cardId === 'currency' ? (
            <CurrencyMetricsBoxes />
          ) : cardId === 'credit' ? (() => {
            const { row0, row1, row2 } = buildCreditMetrics(card);
            return (
              <>
                {row0.length > 0 && <div style={{ marginBottom: 10 }}><StatBoxes stats={row0} /></div>}
                {row1.length > 0 && <div style={{ marginBottom: 10 }}><StatBoxes stats={row1} /></div>}
                {row2.length > 0 && <StatBoxes stats={row2} />}
              </>
            );
          })() : cardId === 'valuations' ? (
            <ValuationsMetricsBoxes />
          ) : cardId === 'yield' ? (
            <YieldMetricsBoxes card={card} />
          ) : (() => { const row = getMetricsRow(cardId, card); return row ? <StatBoxes stats={row} /> : <StatBoxes stats={card.stats} />; })()}
        </div>
      )}
      {/* summary note */}
      {card.note && (
        <div>
          {sectionLabel('Market Diagnostics')}
          <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' }}>
            {(() => {
              const items = getDiagnostics(cardId, card, leadershipStats);
              if (!items) return null;
              return (
                <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e2d3d' }}>
                  {items.map(({ label, q, a, c }, idx, arr) => (
                    <div key={label} style={{
                      paddingTop: idx === 0 ? 0 : 11,
                      paddingBottom: idx < arr.length - 1 ? 11 : 0,
                      borderBottom: idx < arr.length - 1 ? '1px solid #0d1e2e' : 'none',
                    }}>
                      <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 3 }}>{label}</div>
                      <div style={{ fontFamily: DSANS, fontSize: 13, fontWeight: 600, color: c, lineHeight: 1.4, marginBottom: 4 }}>{a}</div>
                      <div style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{q}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 7 }}>Market Narrative</div>
            <p style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', lineHeight: 1.7, margin: 0 }}>{card.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { DSIG, DMONO, DSANS, postureColorD, HorizonHero, HorizonRailMini, HorizonDial, AnchorDial, InteractionMatrix, DeepChartLg, RegimeTimeline, StatusPill, SparkD, StatBoxes, IndicatorTable, SectorBreakdown, CountryTable, BreadthStatBoxes, NyseBreadthChart, NyseAdidChart, SectorBreadthChart, LeadershipPriceChart, EquitiesMASummary, EquitiesFocusChart, EquitiesChart, CommoditiesWatchlistChart, ValuationsChart, YieldChart, YieldSpreadChart, CurrencyChart, CurrencyRegimeChart, CpiHistoryChart, SectorRatioCharts, SectorRRG, VIXTermStructure, VIXHistoryChart, COTPositioning, PositioningDeepDive, DeepDiveContent });
