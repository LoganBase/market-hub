// Market Hub — desktop layout explorations. Three landing concepts behind a switcher.
// A: Full dashboard grid · B: Two-pane workspace · C: Glance → deep-dive page.
const { useState: useStateA, useEffect: useEffectA } = React;

function useIsMobile() {
  const [m, setM] = useStateA(window.innerWidth < 768);
  useEffectA(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

// True when viewport is at least `bp` wide — drives the Workspace list/detail
// collapse (single-pane in portrait, two-pane in landscape/desktop).
function useMinWidth(bp) {
  const [ok, setOk] = useStateA(window.innerWidth >= bp);
  useEffectA(() => {
    const h = () => setOk(window.innerWidth >= bp);
    window.addEventListener('resize', h);
    window.addEventListener('orientationchange', h);
    return () => { window.removeEventListener('resize', h); window.removeEventListener('orientationchange', h); };
  }, [bp]);
  return ok;
}

// Live data hook: paints the bundled mock instantly, then swaps in /api/scores
// data if the adapter can reach it (production). In the preview it stays on mock.
function useGlance() {
  const [D, setD] = useStateA(window.GLANCE);
  useEffectA(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadGlance().then((live) => { if (alive && live) setD(live); }).catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  return D;
}

// Fetches today's daily brief from the API.
function useDailyBrief() {
  const [brief, setBrief] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadDailyBrief()
        .then((data) => { if (alive && data && !data.error) setBrief(data); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  return brief;
}

function sentimentColor(s) {
  if (s >= 2) return '#22c55e';
  if (s <= -2) return '#ef4444';
  return '#f59e0b';
}
function sentimentLabel(s) {
  if (s >= 3) return 'Bullish';
  if (s >= 1) return 'Slightly Bullish';
  if (s === 0) return 'Neutral';
  if (s >= -2) return 'Slightly Bearish';
  return 'Bearish';
}

// ── Daily Brief card — full-width news feed tile (Dashboard view) ──
function DailyBriefCard({ brief }) {
  if (!brief) return null;

  // ── Weekly layout (Sat / Sun) ──────────────────────────────────────────────
  if (brief.isWeekly) {
    const sc = sentimentColor(Math.round(brief.avgSentiment));
    const sl = sentimentLabel(Math.round(brief.avgSentiment));
    return (
      <div style={{ background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sc}`, borderRadius: 13, padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: DSANS, fontSize: 13.5, fontWeight: 700, color: '#e8edf5' }}>Weekly Brief</span>
          <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#64748b' }}>{brief.weekLabel}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#94a3b8', padding: '2px 8px', borderRadius: 5, background: '#16202e', border: '1px solid #1e2d3d' }}>{brief.dominantSector}</span>
            <span style={{ fontFamily: DMONO, fontSize: 12, fontWeight: 700, color: sc, padding: '2px 8px', borderRadius: 5, background: sc + '18', border: `1px solid ${sc}40` }}>{sl} avg {brief.avgSentiment > 0 ? '+' : ''}{brief.avgSentiment}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {brief.briefs.map(b => {
            const dc = sentimentColor(b.sentiment);
            const dl = new Date(b.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <div key={b.date} style={{ paddingTop: 12, borderTop: '1px solid #16202e' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>{dl}</span>
                  <span style={{ fontFamily: DMONO, fontSize: 11, fontWeight: 700, color: dc }}>{b.sentiment > 0 ? '+' : ''}{b.sentiment}</span>
                  <span style={{ fontFamily: DSANS, fontSize: 10, color: '#64748b', padding: '1px 6px', borderRadius: 4, background: '#16202e', border: '1px solid #1e2d3d' }}>{b.sector}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 24px' }}>
                  {b.bullets.slice(0, 2).map((bullet, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: dc, flexShrink: 0, marginTop: 7 }} />
                      <span style={{ fontFamily: DSANS, fontSize: 12, color: '#94a3b8', lineHeight: 1.55 }}>{bullet}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Daily layout (weekday) ─────────────────────────────────────────────────
  const sc = sentimentColor(brief.sentiment);
  const sl = sentimentLabel(brief.sentiment);
  const dateLabel = new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div style={{ background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sc}`, borderRadius: 13, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: DSANS, fontSize: 13.5, fontWeight: 700, color: '#e8edf5' }}>Briefing.com Close Update</span>
        <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#64748b' }}>{dateLabel}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#94a3b8', padding: '2px 8px', borderRadius: 5, background: '#16202e', border: '1px solid #1e2d3d' }}>{brief.sector}</span>
          <span style={{ fontFamily: DMONO, fontSize: 12, fontWeight: 700, color: sc, padding: '2px 8px', borderRadius: 5, background: sc + '18', border: `1px solid ${sc}40` }}>{sl} {brief.sentiment > 0 ? '+' : ''}{brief.sentiment}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 28px' }}>
        {brief.bullets.map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc, boxShadow: `0 0 4px ${sc}`, flexShrink: 0, marginTop: 7 }} />
            <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55 }}>{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Daily Brief glance row — compact list tile (Glance view) ──
function DailyBriefGlanceRow({ brief, onOpen }) {
  const mob = useIsMobile();
  const pad = mob ? '11px 12px' : '15px 18px';
  const titleW = mob ? 82 : 150;
  const chevron = <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;

  if (!brief) {
    return (
      <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: mob ? 10 : 16, padding: pad, width: '100%',
        background: '#111827', border: '1px solid #1e2d3d', borderLeft: '3px solid #1e2d3d', borderRadius: 13 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: titleW, flexShrink: 0 }}>
          <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5' }}>Daily Brief</span>
          <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>—</span>
        </div>
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#475569', flex: 1 }}>No brief available yet</span>
        {chevron}
      </button>
    );
  }

  // ── Weekly glance row ──────────────────────────────────────────────────────
  if (brief.isWeekly) {
    const sc = sentimentColor(Math.round(brief.avgSentiment));
    const topBullets = brief.briefs[0]?.bullets.slice(0, mob ? 2 : 3) ?? [];
    const totalBullets = brief.briefs.reduce((n, b) => n + b.bullets.length, 0);
    return (
      <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', gap: mob ? 10 : 16, padding: pad, width: '100%',
        background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sc}`, borderRadius: 13 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: titleW, flexShrink: 0 }}>
          <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5' }}>Weekly Brief</span>
          <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>{brief.weekLabel}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          {topBullets.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: sc, flexShrink: 0, marginTop: 6 }} />
              <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{b}</span>
            </div>
          ))}
          {totalBullets > (mob ? 2 : 3) && <span style={{ fontFamily: DSANS, fontSize: 11, color: '#475569', paddingLeft: 13 }}>+{totalBullets - (mob ? 2 : 3)} more</span>}
        </div>
        {!mob && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: sc }}>avg {brief.avgSentiment > 0 ? '+' : ''}{brief.avgSentiment}</span>
              <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#94a3b8', padding: '2px 7px', borderRadius: 4, background: '#16202e', border: '1px solid #1e2d3d', whiteSpace: 'nowrap' }}>{brief.dominantSector}</span>
            </div>
            {chevron}
          </div>
        )}
        {mob && chevron}
      </button>
    );
  }

  // ── Daily glance row ───────────────────────────────────────────────────────
  const sc = sentimentColor(brief.sentiment);
  const dateLabel = new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', gap: mob ? 10 : 16, padding: pad, width: '100%',
      background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sc}`, borderRadius: 13 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: titleW, flexShrink: 0 }}>
        <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5' }}>Daily Brief</span>
        <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>{dateLabel}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
        {brief.bullets.slice(0, mob ? 2 : 4).map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: sc, flexShrink: 0, marginTop: 6 }} />
            <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{b}</span>
          </div>
        ))}
        {brief.bullets.length > (mob ? 2 : 4) && <span style={{ fontFamily: DSANS, fontSize: 11, color: '#475569', paddingLeft: 13 }}>+{brief.bullets.length - (mob ? 2 : 4)} more</span>}
      </div>
      {!mob && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: sc }}>{brief.sentiment > 0 ? '+' : ''}{brief.sentiment}</span>
            <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#94a3b8', padding: '2px 7px', borderRadius: 4, background: '#16202e', border: '1px solid #1e2d3d', whiteSpace: 'nowrap' }}>{brief.sector}</span>
          </div>
          {chevron}
        </div>
      )}
      {mob && chevron}
    </button>
  );
}

// Fetches today's Claude-synthesized macro narrative from /api/macro-brief.
function useMacroBrief() {
  const [state, setState] = useStateA({ status: 'loading', narrative: null, date: null, isWeekly: false, weekLabel: null });
  useEffectA(() => {
    let alive = true;
    fetch('/api/macro-brief')
      .then(r => r.json())
      .then(data => {
        if (!alive) return;
        if (data.error) setState({ status: 'unavailable', narrative: null, date: null, isWeekly: false, weekLabel: null });
        else setState({ status: 'ready', narrative: data.narrative, date: data.date, isWeekly: data.isWeekly ?? false, weekLabel: data.weekLabel ?? null });
      })
      .catch(() => { if (alive) setState({ status: 'unavailable', narrative: null, date: null, isWeekly: false, weekLabel: null }); });
    return () => { alive = false; };
  }, []);
  return state;
}

// ── Macro Brief card — Claude-synthesized narrative (Dashboard / Glance views) ──
function MacroBriefCard({ brief: dailyBrief }) {
  const { status, narrative, date, isWeekly, weekLabel } = useMacroBrief();
  const dateLabel = date ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null;
  const titleText  = isWeekly ? 'Weekly Macro Brief' : 'Macro Brief';
  const footerDate = isWeekly ? weekLabel : dateLabel;
  return (
    <div style={{ background: '#111827', border: '1px solid #1e2d3d', borderLeft: '3px solid #60a5fa', borderRadius: 13, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontFamily: DSANS, fontSize: 13.5, fontWeight: 700, color: '#e8edf5' }}>{titleText}</span>
        {(isWeekly ? weekLabel : dateLabel) && <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#64748b' }}>{isWeekly ? weekLabel : dateLabel}</span>}
        <span style={{ marginLeft: 'auto', fontFamily: DSANS, fontSize: 10, fontWeight: 600, color: '#60a5fa', padding: '2px 8px', borderRadius: 5, background: '#0d1e35', border: '1px solid #1a3a5c', letterSpacing: '.04em' }}>✦ CLAUDE</span>
      </div>
      {status === 'loading' && (
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#64748b' }}>Synthesizing structural signals with today's market action…</span>
      )}
      {status === 'unavailable' && (
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#475569' }}>
          {'Synthesis unavailable — scorecard or brief data not yet loaded.'}
        </span>
      )}
      {status === 'ready' && narrative && (
        <>
          <p style={{ fontFamily: DSANS, fontSize: 13.5, color: '#94a3b8', lineHeight: 1.72, margin: 0 }}>{narrative}</p>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #16202e', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#60a5fa', boxShadow: '0 0 5px #60a5fa' }} />
            <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#475569' }}>Synthesized by Claude Haiku · {footerDate}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Macro Brief glance row — compact list tile (Glance view) ──
function MacroBriefGlanceRow({ onOpen }) {
  const mob = useIsMobile();
  const { status, narrative, date } = useMacroBrief();
  const dateLabel = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
  const maxChars = mob ? 80 : 160;
  const preview   = narrative ? narrative.slice(0, maxChars) + (narrative.length > maxChars ? '…' : '') : null;
  const clickable = status === 'ready' && !!onOpen;
  return (
    <div onClick={clickable ? onOpen : undefined} style={{ boxSizing: 'border-box', display: 'flex', alignItems: 'flex-start', gap: mob ? 10 : 16, padding: mob ? '11px 12px' : '15px 18px', width: '100%',
      background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${status === 'ready' ? '#60a5fa' : '#1e2d3d'}`, borderRadius: 13,
      cursor: clickable ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: mob ? 82 : 150, flexShrink: 0 }}>
        <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5' }}>Macro Brief</span>
        <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>{dateLabel}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {status === 'loading' && <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#475569' }}>Synthesizing…</span>}
        {status === 'unavailable' && <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#475569' }}>Unavailable — scorecard or brief data not yet loaded</span>}
        {status === 'ready' && preview && <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55 }}>{preview}</span>}
      </div>
      <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 600, color: '#60a5fa', padding: '2px 7px', borderRadius: 4, background: '#0d1e35', border: '1px solid #1a3a5c', flexShrink: 0, alignSelf: 'flex-start' }}>✦</span>
      {clickable && <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  );
}

// ── Macro Brief deep dive — full narrative page ──
function MacroBriefDeepDive({ onBack }) {
  const { status, narrative, date, isWeekly, weekLabel } = useMacroBrief();
  const dateLabel = date ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const titleText = isWeekly ? 'Weekly Macro Brief' : 'Macro Brief';
  const footerDate = isWeekly ? weekLabel : dateLabel;
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 32px 60px' }}>
      <button onClick={onBack} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderRadius: 10, background: '#0d1520', border: '1px solid #1e2d3d', marginBottom: 22 }}>
        <svg width="8" height="13" viewBox="0 0 8 13"><path d="M6.5 1L1.5 6.5l5 5.5" stroke="#94a3b8" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>All signals</span>
      </button>
      <div style={{ background: '#111827', border: '1px solid #1e2d3d', borderLeft: '3px solid #60a5fa', borderRadius: 13, padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontFamily: DSANS, fontSize: 18, fontWeight: 700, color: '#e8edf5' }}>{titleText}</span>
          {footerDate && <span style={{ fontFamily: DSANS, fontSize: 12, color: '#64748b' }}>{footerDate}</span>}
          <span style={{ marginLeft: 'auto', fontFamily: DSANS, fontSize: 10, fontWeight: 600, color: '#60a5fa', padding: '2px 8px', borderRadius: 5, background: '#0d1e35', border: '1px solid #1a3a5c', letterSpacing: '.04em' }}>✦ CLAUDE</span>
        </div>
        {status === 'loading' && <span style={{ fontFamily: DSANS, fontSize: 14, color: '#64748b' }}>Synthesizing structural signals with today's market action…</span>}
        {status === 'unavailable' && <span style={{ fontFamily: DSANS, fontSize: 14, color: '#475569' }}>Synthesis unavailable — scorecard or brief data not yet loaded.</span>}
        {status === 'ready' && narrative && (
          <p style={{ fontFamily: DSANS, fontSize: 15, color: '#94a3b8', lineHeight: 1.78, margin: 0 }}>{narrative}</p>
        )}
      </div>
    </div>
  );
}

// ── Macro Brief compact panel for Workspace left rail ──
function MacroBriefWorkspacePanel({ onClick, active }) {
  const { status, narrative, date } = useMacroBrief();
  const dateLabel = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const preview   = narrative ? narrative.slice(0, 200) + (narrative.length > 200 ? '…' : '') : null;
  return (
    <button onClick={onClick} title="Open the full Macro Brief" style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '12px 14px', borderRadius: 10, background: active ? '#141f2e' : '#0d1520', borderTop: `1px solid ${active ? '#24364a' : '#1e2d3d'}`, borderRight: `1px solid ${active ? '#24364a' : '#1e2d3d'}`, borderBottom: `1px solid ${active ? '#24364a' : '#1e2d3d'}`, borderLeft: `3px solid ${status === 'ready' ? '#60a5fa' : '#1e2d3d'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: status === 'unavailable' ? 0 : 9 }}>
        <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9', flex: 1 }}>Macro Brief</span>
        {status === 'ready' && <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 600, color: '#60a5fa' }}>✦</span>}
        {dateLabel && <span style={{ fontFamily: DSANS, fontSize: 10, color: '#475569' }}>{dateLabel}</span>}
      </div>
      {status === 'loading'     && <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#475569' }}>Synthesizing…</span>}
      {status === 'unavailable' && <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#475569' }}>Requires today's Close Update</span>}
      {status === 'ready' && preview && <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.55 }}>{preview}</span>}
    </button>
  );
}

// ── Hook: last 30 days of brief history (for deep-dive trend chart) ──
function useBriefHistory() {
  const [history, setHistory] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/daily-brief?range=30')
      .then(r => r.json())
      .then(data => { if (alive && data.results) setHistory(data.results); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return history;
}

// ── 30-day sentiment bar chart (SVG) ──
function SentimentBarChart({ history }) {
  const W = 720, H = 148, padBot = 28, padTop = 14, padL = 34, padR = 8;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBot;
  const days = [...history].reverse();
  const n = days.length;
  if (n < 2) return null;
  const spacing = plotW / n;
  const barW = Math.max(Math.min(spacing - 3, 28), 3);
  const unitH = (plotH / 2) / 5;
  const zeroY = padTop + plotH / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#1e2d3d" strokeWidth="1" />
      <line x1={padL} y1={zeroY - unitH * 2} x2={W - padR} y2={zeroY - unitH * 2} stroke="#22c55e" strokeWidth=".6" strokeDasharray="4 4" opacity=".35" />
      <line x1={padL} y1={zeroY + unitH * 2} x2={W - padR} y2={zeroY + unitH * 2} stroke="#ef4444" strokeWidth=".6" strokeDasharray="4 4" opacity=".35" />
      <text x={padL - 5} y={padTop + 4} textAnchor="end" fontSize="9" fill="#475569" fontFamily="monospace">+5</text>
      <text x={padL - 5} y={zeroY - unitH * 2 + 4} textAnchor="end" fontSize="9" fill="#334155" fontFamily="monospace">+2</text>
      <text x={padL - 5} y={zeroY + 4} textAnchor="end" fontSize="9" fill="#475569" fontFamily="monospace">0</text>
      <text x={padL - 5} y={zeroY + unitH * 2 + 4} textAnchor="end" fontSize="9" fill="#334155" fontFamily="monospace">-2</text>
      <text x={padL - 5} y={H - padBot} textAnchor="end" fontSize="9" fill="#475569" fontFamily="monospace">-5</text>
      {days.map((b, i) => {
        const s = b.sentiment;
        const bx = padL + i * spacing + (spacing - barW) / 2;
        const barH = Math.abs(s) * unitH;
        const by = s >= 0 ? zeroY - barH : zeroY;
        const color = s >= 2 ? '#22c55e' : s <= -2 ? '#ef4444' : '#f59e0b';
        const dl = new Date(b.date + 'T12:00:00Z');
        const label = dl.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const showLabel = i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0;
        return (
          <g key={b.date}>
            <rect x={bx} y={by} width={barW} height={Math.max(barH, 2)} fill={color} opacity=".8" rx="1.5" />
            {showLabel && <text x={bx + barW / 2} y={H - padBot + 11} textAnchor="middle" fontSize="8.5" fill="#475569" fontFamily="sans-serif">{label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── Sector abbreviation map ──
function abbrevSector(s) {
  if (!s) return '—';
  const MAP = { 'Technology': 'Tech', 'Consumer Discretionary': 'Disc', 'Healthcare': 'Hlth', 'Financials': 'Fin', 'Energy': 'Enrg', 'Industrials': 'Ind', 'Materials': 'Mat', 'Utilities': 'Util', 'Real Estate': 'RE', 'Communication Services': 'Comm', 'Consumer Staples': 'Stpl', 'Broad Market': 'Mkt' };
  return MAP[s] || s.slice(0, 4);
}

// ── Brief day popover — shown on tile hover ──
function BriefDayPopover({ brief, rect }) {
  const sc       = brief.sentiment >= 2 ? '#22c55e' : brief.sentiment <= -2 ? '#ef4444' : '#f59e0b';
  const dateLabel = new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const vw       = window.innerWidth || 1200;
  const vh       = window.innerHeight || 800;
  const mob      = vw < 768;
  const W        = Math.min(290, vw - 20);
  const estH     = 58 + (brief.bullets || []).length * 22; // rough height for the flip decision
  // Horizontal: center on mobile so it never runs off a side; clamp to viewport on desktop.
  const left     = mob ? Math.round((vw - W) / 2)
                       : Math.min(Math.max(rect.left + rect.width / 2 - W / 2, 10), vw - W - 10);
  // Vertical: sit above the cell if there's room, otherwise flip below — never clips top/bottom.
  const above    = rect.top >= estH + 14;
  const top      = above ? rect.top - 10 : rect.bottom + 10;
  return (
    <div style={{ position: 'fixed', left, top, transform: above ? 'translateY(-100%)' : 'none', zIndex: 9999, width: W,
      maxHeight: vh - 20, overflowY: 'auto',
      background: '#0d1520', border: '1px solid #28384a', borderLeft: `3px solid ${sc}`,
      borderRadius: 10, padding: '12px 14px', boxShadow: '0 8px 32px rgba(0,0,0,.65)', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: sc }}>{brief.sentiment > 0 ? '+' : ''}{brief.sentiment}</span>
        <span style={{ fontFamily: DSANS, fontSize: 12.5, fontWeight: 600, color: '#e8edf5' }}>{dateLabel}</span>
        <span style={{ marginLeft: 'auto', fontFamily: DSANS, fontSize: 10, color: '#64748b',
          padding: '2px 7px', borderRadius: 4, background: '#16202e', border: '1px solid #1e2d3d', whiteSpace: 'nowrap' }}>{brief.sector}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {(brief.bullets || []).map((bullet, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <span style={{ color: sc, fontSize: 7, marginTop: 5, lineHeight: 1, flexShrink: 0 }}>●</span>
            <span style={{ fontFamily: DSANS, fontSize: 11, color: '#8295a9', lineHeight: 1.52 }}>{bullet}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sector rotation strip (30-day day cells) ──
function SectorStrip({ history }) {
  const [hovered, setHovered] = useStateA(null);
  const days = [...history].reverse();
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {days.map(b => {
        const sc    = b.sentiment >= 2 ? '#22c55e' : b.sentiment <= -2 ? '#ef4444' : '#f59e0b';
        const dayNum = new Date(b.date + 'T12:00:00Z').getUTCDate();
        const isHov = hovered?.brief.date === b.date;
        return (
          <div key={b.date}
            onMouseEnter={e => setHovered({ brief: b, rect: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setHovered(null)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: isHov ? sc + '25' : sc + '12',
              border: `1px solid ${isHov ? sc + '60' : sc + '28'}`,
              borderRadius: 7, padding: '6px 7px', minWidth: 38, cursor: 'default',
              transition: 'background 0.12s, border-color 0.12s' }}>
            <span style={{ fontFamily: DMONO, fontSize: 9.5, color: sc, fontWeight: 700 }}>{b.sentiment > 0 ? '+' : ''}{b.sentiment}</span>
            <span style={{ fontFamily: DSANS, fontSize: 9, color: '#94a3b8' }}>{abbrevSector(b.sector)}</span>
            <span style={{ fontFamily: DSANS, fontSize: 8.5, color: '#475569' }}>{dayNum}</span>
          </div>
        );
      })}
      {hovered && <BriefDayPopover brief={hovered.brief} rect={hovered.rect} />}
    </div>
  );
}

// ── Daily Brief deep-dive page ──
function DailyBriefDeepDive({ brief, D, onBack }) {
  const history = useBriefHistory();
  const [searchQuery, setSearchQuery] = useStateA('');
  const [searchResults, setSearchResults] = useStateA(null);
  const [searching, setSearching] = useStateA(false);

  const doSearch = () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    fetch('/api/daily-brief?search=' + encodeURIComponent(q))
      .then(r => r.json())
      .then(data => { setSearchResults(data.results || []); setSearching(false); })
      .catch(() => setSearching(false));
  };

  // Divergence: scorecard posture vs. recent tactical sentiment
  let divergence = null;
  if (history && history.length >= 3 && D?.exec?.label) {
    const recent = history.slice(0, 5);
    const avgSent = recent.reduce((a, b) => a + b.sentiment, 0) / recent.length;
    const isRiskOn  = /on/i.test(D.exec.label);
    const isRiskOff = /off/i.test(D.exec.label);
    if (isRiskOn  && avgSent < -1) divergence = 'Scorecard is risk-on but recent market action has been negative — watch for trend confirmation before adding exposure.';
    if (isRiskOff && avgSent >  1) divergence = 'Scorecard signals risk-off but recent market action has been positive — may be a relief rally within a downtrend; remain cautious.';
  }

  const SL = { fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9' };

  const BulletList = ({ bullets, color, size = 13.5 }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {bullets.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}`, flexShrink: 0, marginTop: 6 }} />
          <span style={{ fontFamily: DSANS, fontSize: size, color: '#94a3b8', lineHeight: 1.62 }}>{b}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 32px 60px' }}>
      {/* Back */}
      <button onClick={onBack} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderRadius: 10, background: '#0d1520', border: '1px solid #1e2d3d', marginBottom: 22 }}>
        <svg width="8" height="13" viewBox="0 0 8 13"><path d="M6.5 1L1.5 6.5l5 5.5" stroke="#94a3b8" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>All signals</span>
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 28 }}>
        <span style={{ fontFamily: DSANS, fontSize: 26, fontWeight: 700, color: '#e8edf5' }}>Daily Brief</span>
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#64748b' }}>Briefing.com · Close Update</span>
      </div>

      {/* ── Section 1: Today's / Weekly close update ── */}
      {brief && (
        <div style={{ marginBottom: 36 }}>
          <span style={SL}>
            {brief.isWeekly
              ? brief.weekLabel
              : new Date(brief.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
          <div style={{ marginTop: 12, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 13, padding: '18px 22px' }}>
            {!brief.isWeekly && <BulletList bullets={brief.bullets} color={sentimentColor(brief.sentiment)} />}
            {brief.isWeekly && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {brief.briefs.map(d => {
                  const dc = sentimentColor(d.sentiment);
                  const dl = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                  return (
                    <div key={d.date}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #16202e' }}>
                        <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>{dl}</span>
                        <span style={{ fontFamily: DMONO, fontSize: 11, fontWeight: 700, color: dc }}>{d.sentiment > 0 ? '+' : ''}{d.sentiment}</span>
                        <span style={{ fontFamily: DSANS, fontSize: 10, color: '#64748b', padding: '1px 6px', borderRadius: 4, background: '#16202e', border: '1px solid #1e2d3d' }}>{d.sector}</span>
                      </div>
                      <BulletList bullets={d.bullets} color={dc} size={13} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Divergence flag ── */}
      {divergence && (
        <div style={{ marginBottom: 28, padding: '13px 16px', borderRadius: 10, background: '#1c1700', border: '1px solid #78350f40', borderLeft: '3px solid #f59e0b' }}>
          <span style={{ fontFamily: DSANS, fontSize: 10.5, fontWeight: 700, color: '#f59e0b', letterSpacing: '.09em', textTransform: 'uppercase' }}>⚡ Scorecard / Tactical Divergence</span>
          <p style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', margin: '8px 0 0', lineHeight: 1.62 }}>{divergence}</p>
        </div>
      )}

      {/* ── Section 2: 30-day sentiment trend ── */}
      <div style={{ marginBottom: 36 }}>
        <span style={SL}>Sentiment History · 30 Days</span>
        <div style={{ marginTop: 12, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 13, padding: '18px 22px' }}>
          {!history && <span style={{ fontFamily: DSANS, fontSize: 13, color: '#64748b' }}>Loading…</span>}
          {history && history.length < 2 && <span style={{ fontFamily: DSANS, fontSize: 13, color: '#64748b' }}>Not enough history yet — data accumulates after 2+ briefs.</span>}
          {history && history.length >= 2 && (
            <>
              <SentimentBarChart history={history} />
              <div style={{ display: 'flex', gap: 18, marginTop: 10, paddingTop: 10, borderTop: '1px solid #16202e' }}>
                {[['#22c55e', 'Bullish  (+2 to +5)'], ['#f59e0b', 'Mixed  (−1 to +1)'], ['#ef4444', 'Bearish  (−2 to −5)']].map(([c, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>{l}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Section 3: Sector rotation strip ── */}
      {history && history.length >= 2 && (
        <div style={{ marginBottom: 36 }}>
          <span style={SL}>Sector Rotation · 30 Days</span>
          <div style={{ marginTop: 12 }}>
            <SectorStrip history={history} />
          </div>
          <p style={{ fontFamily: DSANS, fontSize: 11, color: '#475569', margin: '10px 0 0' }}>Each cell shows the sentiment score, leading sector, and calendar day. Hover for full date.</p>
        </div>
      )}

      {/* ── Section 4: Full-text search ── */}
      <div>
        <span style={SL}>Search Close Updates</span>
        <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
          <input type="text" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Search all Close Updates (e.g. Fed, inflation, yield)…"
            style={{ flex: 1, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 9, padding: '10px 14px',
              fontFamily: DSANS, fontSize: 13, color: '#e8edf5', outline: 'none' }} />
          <button onClick={doSearch} style={{ all: 'unset', cursor: 'pointer', padding: '10px 18px', borderRadius: 9,
            background: searching ? '#0d1520' : '#1b2736', border: '1px solid #243446', fontFamily: DSANS, fontSize: 13, color: '#94a3b8', whiteSpace: 'nowrap' }}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {searchResults !== null && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(() => {
              const q = searchQuery.trim().toLowerCase();
              // Flatten to individual matching bullets, each tagged with its date row
              const matches = [];
              searchResults.forEach(r => {
                const dl = new Date(r.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const sc = sentimentColor(r.sentiment);
                r.bullets.forEach(b => {
                  if (b.toLowerCase().includes(q)) matches.push({ date: r.date, dl, sc, b });
                });
              });
              if (matches.length === 0) return <span style={{ fontFamily: DSANS, fontSize: 13, color: '#64748b' }}>No matching bullets found.</span>;
              return matches.map((m, i) => {
                // Highlight the matching term
                const idx = m.b.toLowerCase().indexOf(q);
                const before = m.b.slice(0, idx);
                const hit    = m.b.slice(idx, idx + q.length);
                const after  = m.b.slice(idx + q.length);
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#0d1520', border: '1px solid #1e2d3d', borderLeft: `3px solid ${m.sc}`, borderRadius: 9, padding: '10px 14px' }}>
                    <span style={{ fontFamily: DMONO, fontSize: 10.5, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap', marginTop: 2, minWidth: 90 }}>{m.dl}</span>
                    <span style={{ fontFamily: DSANS, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.58 }}>
                      {before}<mark style={{ background: '#78350f55', color: '#fbbf24', borderRadius: 3, padding: '0 2px' }}>{hit}</mark>{after}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Executive Summary card — score circle + action label + two-column breakdown ──
function BreadthBar({ exec, cats, groups, cards }) {
  const total = exec.bull + exec.neutral + exec.bear;
  const color = postureColorD(exec.label);
  const R = 30, C = 2 * Math.PI * R, gap = 5;
  const segs = [['bullish', exec.bull], ['neutral', exec.neutral], ['bearish', exec.bear]].filter((x) => x[1] > 0);
  let acc = 0;
  const arcs = segs.map(([k, n]) => { const len = (n / total) * C; const off = acc; acc += len; return { k, len, off, c: DSIG[k].c }; });
  const dotStyle = (s) => ({ width: 9, height: 9, borderRadius: '50%', background: DSIG[s] ? DSIG[s].c : '#475569', boxShadow: DSIG[s] ? `0 0 5px ${DSIG[s].glow}` : 'none', flexShrink: 0 });
  return (
    <div style={{ background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 18, padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Row 1: circle + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', rowGap: 14 }}>
        <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', boxShadow: `0 0 30px ${color}44` }} />
          <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="38" cy="38" r={R} fill="none" stroke="#16202e" strokeWidth="7" />
            {arcs.map((a) => (<circle key={a.k} cx="38" cy="38" r={R} fill="none" stroke={a.c} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${Math.max(a.len - gap, 0)} ${C}`} strokeDashoffset={-(a.off + gap / 2)} style={{ filter: `drop-shadow(0 0 3px ${a.c}88)` }} />))}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <span style={{ fontFamily: DMONO, fontSize: 17, fontWeight: 700, color: '#e8edf5' }}>
                  {total > 0 ? Math.round((exec.bull + exec.neutral * 0.5) / total * 100) : 0}
                </span>
                <span style={{ fontFamily: DMONO, fontSize: 10, color: '#94a3b8' }}>%</span>
              </div>
              {exec.scoreDirection === 'up'   && <span style={{ fontFamily: DMONO, fontSize: 9, color: '#22c55e', lineHeight: 1 }}>▲</span>}
              {exec.scoreDirection === 'down' && <span style={{ fontFamily: DMONO, fontSize: 9, color: '#ef4444', lineHeight: 1 }}>▼</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0, marginTop: 4 }} />
            <span style={{ fontFamily: DSANS, fontSize: 16, fontWeight: 700, color: '#e8edf5', lineHeight: 1.25, whiteSpace: 'nowrap' }}>{exec.label}</span>
          </div>
          <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', lineHeight: 1.4, paddingLeft: 18 }}>{exec.posture}</span>
        </div>
      </div>
      {/* Row 2: by section (left) | by factor (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: '0 20px', marginTop: 18, paddingTop: 16, borderTop: '1px solid #1e2d3d' }}>
        {/* Left: by section / card group */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#475569', marginBottom: 3 }}>By Section</span>
          {(groups || []).filter((g) => !g.ids.includes('crowdsignals')).map((g) => {
            const statuses = g.ids.map((id) => cards && cards[id] ? cards[id].status : 'neutral');
            const bull = statuses.filter((s) => s === 'bullish').length;
            return (
              <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: DSANS, fontSize: 12, color: '#cbd5e1', flex: 1, whiteSpace: 'nowrap' }}>{g.label}</span>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {statuses.map((s, i) => <span key={i} style={dotStyle(s)} />)}
                </div>
                <span style={{ fontFamily: DMONO, fontSize: 11, color: '#94a3b8', width: 28, textAlign: 'right', flexShrink: 0 }}>{bull}/{statuses.length}</span>
              </div>
            );
          })}
        </div>
        {/* Divider */}
        <div style={{ background: '#1e2d3d' }} />
        {/* Right: by factor / scoring category */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#475569', marginBottom: 3 }}>By Factor</span>
          {(cats || []).map((c) => {
            const bull = c.cards.filter((s) => s === 'bullish').length;
            return (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: DSANS, fontSize: 12, color: '#cbd5e1', flex: 1, whiteSpace: 'nowrap' }}>{c.label}</span>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {c.cards.map((s, i) => <span key={i} style={dotStyle(s)} />)}
                </div>
                <span style={{ fontFamily: DMONO, fontSize: 11, color: '#94a3b8', width: 28, textAlign: 'right', flexShrink: 0 }}>{bull}/{c.cards.length}</span>
              </div>
            );
          })}
        </div>
      </div>
      {exec.regimeBearish && (
        <div style={{ borderTop: '1px solid #2d1a00', paddingTop: 14, marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0b', flexShrink: 0 }} />
          <span style={{ fontFamily: DSANS, fontSize: 11.5, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em', flexShrink: 0 }}>REGIME WARNING</span>
          <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>SPY is below its 200-day SMA — the primary trend is bearish. Other signals may lead a recovery, but size positions accordingly.</span>
        </div>
      )}
      {exec.divergence && (
        <div style={{ borderTop: '1px solid #0d1e35', paddingTop: 14, marginTop: exec.regimeBearish ? 6 : 16, display: 'flex', alignItems: 'center', gap: 10 }}>
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

// ── Regime list sparkline — 20D SPY (cyan) + 200d SMA (purple), falls back to synthetic spark ──
function RegimeMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadHistory('regime', '20D').then((r) => {
        if (!alive || !r || !r.values || r.values.length < 2) return;
        const sma200 = (r.overlays || []).find(o => o.label === '200d SMA');
        setData({ spy: r.values, sma200: sma200 ? sma200.values : [] });
      });
    }
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.spy, ...data.sma200].filter(v => v != null && v > 0);
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.spy.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.sma200)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.spy)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Commodities list sparkline — live 20D USCI (cyan) + 200d SMA (purple), falls back to SparkD ──
function CommoditiesMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    if (window.MarketHubData) {
      window.MarketHubData.loadHistory('commodities', '20D').then((r) => {
        if (!alive || !r || !r.values || r.values.length < 2) return;
        const sma200 = (r.overlays || []).find(o => o.label === '200d SMA');
        setData({ usci: r.values, sma200: sma200 ? sma200.values : [] });
      });
    }
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.usci, ...data.sma200].filter(v => v != null && v > 0);
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.usci.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.sma200)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.usci)}   fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Leadership list sparkline — live 20D SPY + RSP rebased to 0%, falls back to SparkD ──
function LeadershipMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/leadership?range=1mo')
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.prices || !j.dates?.length) return;
        const rebase = (arr) => {
          const first = (arr || []).find(v => v != null && v > 0);
          if (!first) return arr || [];
          return (arr || []).map(v => v == null ? null : ((v - first) / first) * 100);
        };
        setData({ spy: rebase(j.prices.SPY || []), rsp: rebase(j.prices.RSP || []) });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.spy, ...data.rsp].filter(v => v != null);
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.spy.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.spy)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.rsp)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Breadth list sparkline — live 20D MMTH (purple) + MMFI (cyan), falls back to SparkD ──
function BreadthMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    const cb = new Date().toISOString().slice(0, 10);
    fetch(`/api/breadth-history?range=20d&_cb=${cb}`)
      .then(r => r.json())
      .then(j => {
        if (!alive || !Array.isArray(j.mmth) || !j.mmth.length) return;
        setData({ mmth: j.mmth, mmfi: j.mmfi || [] });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.mmth, ...data.mmfi].filter(v => v != null);
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.mmth.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.mmth)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.mmfi)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Equities list sparkline — live 20D IWM (indigo) / FCX (cyan) / GDX (amber) rebased to 0% ──
function EquitiesMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/equities-history?range=3mo')
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.dates?.length || !j.equities?.length) return;
        const rebase = (sym) => {
          const eq = j.equities.find(e => e.sym === sym);
          const sliced = (eq?.prices || []).slice(-20);
          const first = sliced.find(v => v != null && v > 0);
          if (!first) return sliced;
          return sliced.map(v => v == null ? null : ((v / first - 1) * 100));
        };
        setData({ iwm: rebase('IWM'), fcx: rebase('FCX'), gdx: rebase('GDX') });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.iwm, ...data.fcx, ...data.gdx].filter(v => v != null);
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.iwm.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.gdx)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.fcx)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.iwm)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Credit list sparkline — live 20D HYG (green) / LQD (purple) / EMB (amber) normalised return, falls back to SparkD ──
function CreditMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    Promise.all([
      fetch('/api/history?symbol=HYG&range=20d').then(r => r.json()),
      fetch('/api/history?symbol=LQD&range=20d').then(r => r.json()),
      fetch('/api/history?symbol=EMB&range=20d').then(r => r.json()),
    ]).then(([hyg, lqd, emb]) => {
      if (!alive) return;
      const rebase = (closes) => {
        const arr = (closes || []).slice(-20).map(v => v == null ? null : Number(v));
        const first = arr.find(v => v != null && v > 0);
        if (!first) return arr;
        return arr.map(v => v == null ? null : ((v - first) / first) * 100);
      };
      const h20 = rebase(hyg.closes), l20 = rebase(lqd.closes), e20 = rebase(emb.closes);
      if (!h20.length) return;
      setData({ hyg: h20, lqd: l20, emb: e20 });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.hyg, ...data.lqd, ...data.emb].filter(v => v != null && !isNaN(v));
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.hyg.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null || isNaN(v) ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.emb)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.lqd)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.hyg)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Global Flows list sparkline — live 20D ACWI (green) + EEM (cyan) normalised return, falls back to SparkD ──
function GlobalFlowsMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    Promise.all([
      fetch('/api/history?symbol=ACWI&range=20d').then(r => r.json()),
      fetch('/api/history?symbol=EEM&range=20d').then(r => r.json()),
    ]).then(([acwi, eem]) => {
      if (!alive) return;
      const rebase = (closes) => {
        const arr = (closes || []).slice(-20).map(v => v == null ? null : Number(v));
        const first = arr.find(v => v != null && v > 0);
        if (!first) return arr;
        return arr.map(v => v == null ? null : ((v - first) / first) * 100);
      };
      const a20 = rebase(acwi.closes), e20 = rebase(eem.closes);
      if (!a20.length) return;
      setData({ acwi: a20, eem: e20 });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.acwi, ...data.eem].filter(v => v != null && !isNaN(v));
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.acwi.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null || isNaN(v) ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.eem)}  fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.acwi)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Yield sparkline — live 20D 30Y (purple) / 10Y (cyan) / 2Y (green), falls back to SparkD ──
function YieldMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    const safe = (p) => p.then(r => r.json()).catch(() => ({}));
    Promise.all([
      safe(fetch('/api/history?symbol=%5ETYX&range=20d')),
      safe(fetch('/api/history?symbol=%5ETNX&range=20d')),
      safe(fetch('/api/treasury-2y?range=20d')),
    ]).then(([tyx, tnx, two]) => {
      if (!alive) return;
      const toArr = (arr) => (arr || []).slice(-20).map(v => v == null ? null : Number(v));
      const d = { tyx: toArr(tyx.closes), tnx: toArr(tnx.closes), two: toArr(two.closes) };
      if (d.tyx.length || d.tnx.length) setData(d);
    });
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color="#a855f7" w={w} h={h} />;
  const allVals = [...data.tyx, ...data.tnx, ...data.two].filter(v => v != null && !isNaN(v));
  if (!allVals.length) return <SparkD seed={seed} trend={trend} color="#a855f7" w={w} h={h} />;
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const n = Math.max(data.tyx.length, data.tnx.length, data.two.length);
  const dx = w / Math.max(n - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null || isNaN(v) ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.two)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.tnx)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.tyx)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Yield glance KPIs — 30Y / 10Y from rows, 2Y from live treasury-2y ──
function YieldGlanceKpis({ card, compact = true, onStatus }) {
  const [twoY, setTwoY] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/treasury-2y?range=20d').then(r => r.json()).then(data => {
      if (!alive) return;
      const c = (data.closes || []).map(v => v == null ? null : Number(v)).filter(v => v != null && !isNaN(v));
      if (c.length) {
        const val = c[c.length - 1];
        setTwoY(val);
        if (onStatus) {
          const rows = card.rows || [];
          const r0Tone = rows[0]?.[3] || 'neutral';
          const r1Tone = rows[1]?.[3] || 'neutral';
          const t2Tone = val >= 4.5 ? 'bearish' : val >= 3.5 ? 'neutral' : 'bullish';
          const tones  = [r0Tone, r1Tone, t2Tone];
          const bulls  = tones.filter(t => t === 'bullish').length;
          const bears  = tones.filter(t => t === 'bearish').length;
          onStatus(bulls >= 2 ? 'bullish' : bears >= 2 ? 'bearish' : 'neutral');
        }
      }
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
  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 10 }}>
        {kpis.map(({ label, val, tone }, i) => {
          const rs = DSIG[tone] || DSIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, paddingLeft: i ? 11 : 0, borderLeft: i ? '1px solid #1b2736' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: DMONO, fontSize: 14, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
              </div>
              <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 22, flex: 1 }}>
      {kpis.map(({ label, val, tone }, i) => {
        const rs = DSIG[tone] || DSIG.neutral;
        return (
          <div key={i} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}` }} />
              <span style={{ fontFamily: DMONO, fontSize: 13.5, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Currency glance KPIs — USD Trend / EUR/USD / JPY Carry from D1 vs200 ──
function CurrencyGlanceKpis({ compact = true, onStatus }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/currency').then(r => r.json()).then(d => {
      if (!alive) return;
      const uupV = d.uup?.vs200;
      const fxeV = d.fxe?.vs200;
      const fxyV = d.fxy?.vs200;
      const uupTone = uupV == null ? 'neutral' : uupV > 0 ? 'bearish' : 'bullish';
      const fxeTone = fxeV == null ? 'neutral' : fxeV > 0 ? 'bullish' : 'bearish';
      const fxyTone = fxyV == null ? 'neutral' : fxyV > 3 ? 'bearish' : 'neutral';
      const tones = [uupTone, fxeTone, fxyTone];
      const bulls = tones.filter(t => t === 'bullish').length;
      const bears = tones.filter(t => t === 'bearish').length;
      const status = fxyTone === 'bearish' ? 'bearish'
                   : bulls >= 2 ? 'bullish'
                   : bears >= 2 ? 'bearish'
                   : 'neutral';
      if (onStatus) onStatus(status);
      setData({ uupV, fxeV, fxyV, uupTone, fxeTone, fxyTone });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const fmt = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const kpis = data ? [
    { label: 'USD Trend', val: fmt(data.uupV), tone: data.uupTone },
    { label: 'EUR/USD',   val: fmt(data.fxeV), tone: data.fxeTone },
    { label: 'JPY Carry', val: fmt(data.fxyV), tone: data.fxyTone },
  ] : [
    { label: 'USD Trend', val: '—', tone: 'neutral' },
    { label: 'EUR/USD',   val: '—', tone: 'neutral' },
    { label: 'JPY Carry', val: '—', tone: 'neutral' },
  ];
  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 10 }}>
        {kpis.map(({ label, val, tone }, i) => {
          const rs = DSIG[tone] || DSIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, paddingLeft: i ? 11 : 0, borderLeft: i ? '1px solid #1b2736' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: DMONO, fontSize: 14, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
              </div>
              <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 22, flex: 1 }}>
      {kpis.map(({ label, val, tone }, i) => {
        const rs = DSIG[tone] || DSIG.neutral;
        return (
          <div key={i} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}` }} />
              <span style={{ fontFamily: DMONO, fontSize: 13.5, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Crowd Signals glance KPIs — Fed Action / CPI Crowd / Rate Target ──
function CrowdSignalsGlanceKpis({ compact = true, onStatus }) {
  const [kpis, setKpis] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/kalshi', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ events: [] }))
    .then(k => {
      if (!alive) return;
      const fomc = (k.events || []).find(e => e.type === 'fomc');
      const cpi  = (k.events || []).find(e => e.type === 'cpi');
      const actionTone = fomc?.action === 'Cut'  ? 'bullish'
                       : fomc?.action === 'Hike' ? 'bearish'
                       : 'neutral';
      const cpiVal  = cpi ? parseFloat((cpi.consensus || '').replace(/[~%]/g, '')) : null;
      const cpiTone = cpiVal == null ? 'neutral'
                    : cpiVal <= 0    ? 'bullish'
                    : cpiVal > 0.2   ? 'bearish'
                    : 'neutral';
      const next = [
        { label: 'Fed Action',  val: fomc?.action    || '—', tone: actionTone },
        { label: 'CPI Crowd',   val: cpi?.consensus  || '—', tone: cpiTone    },
        { label: 'Rate Target', val: fomc?.consensus || '—', tone: actionTone },
      ];
      const bulls = next.filter(k => k.tone === 'bullish').length;
      const bears = next.filter(k => k.tone === 'bearish').length;
      if (onStatus) onStatus(bulls >= 2 ? 'bullish' : bears >= 2 ? 'bearish' : 'neutral');
      setKpis(next);
    });
    return () => { alive = false; };
  }, []);
  const items = kpis || [
    { label: 'Fed Action',  val: '—', tone: 'neutral' },
    { label: 'CPI Crowd',   val: '—', tone: 'neutral' },
    { label: 'Rate Target', val: '—', tone: 'neutral' },
  ];
  const compactItems = items;
  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 10 }}>
        {compactItems.map(({ label, val, tone }, i) => {
          const rs = DSIG[tone] || DSIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: DMONO, fontSize: 14, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
              </div>
              <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 4, whiteSpace: 'nowrap' }}>{label}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 22, flex: 1 }}>
      {items.map(({ label, val, tone }, i) => {
        const rs = DSIG[tone] || DSIG.neutral;
        return (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
              <span style={{ fontFamily: DMONO, fontSize: 13.5, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sectors list sparkline — live 20D Cyclicals (purple) vs Defensives (cyan), falls back to SparkD ──
function SectorsMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/sectors?range=3mo')
      .then(r => r.json())
      .then(j => {
        if (!alive || !j.cycAvgSeries?.length || !j.defAvgSeries?.length) return;
        setData({ cyc: j.cycAvgSeries.slice(-20).map(Number), def: j.defAvgSeries.slice(-20).map(Number) });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.cyc, ...data.def].filter(v => v != null && !isNaN(v));
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const dx = w / Math.max(data.cyc.length - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null || isNaN(v) ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.def)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.cyc)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CurrencyMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [data, setData] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    Promise.all([
      fetch('/api/history?symbol=UUP&range=20d').then(r => r.json()),
      fetch('/api/history?symbol=FXE&range=20d').then(r => r.json()),
      fetch('/api/history?symbol=FXY&range=20d').then(r => r.json()),
    ]).then(([uup, fxe, fxy]) => {
      if (!alive) return;
      const toArr = (arr) => (arr || []).slice(-20).map(v => v == null ? null : Number(v));
      setData({ uup: toArr(uup.closes), fxe: toArr(fxe.closes), fxy: toArr(fxy.closes) });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const allVals = [...data.uup, ...data.fxe, ...data.fxy].filter(v => v != null && !isNaN(v));
  if (!allVals.length) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const lo = Math.min(...allVals), hi = Math.max(...allVals), span = hi - lo || 1;
  const n = Math.max(data.uup.length, data.fxe.length, data.fxy.length);
  const dx = w / Math.max(n - 1, 1);
  const mkPath = (vals) => vals.map((v, i) => v == null || isNaN(v) ? '' :
    `${(i === 0 || vals[i - 1] == null) ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={mkPath(data.fxy)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.fxe)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={mkPath(data.uup)} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CrowdSignalsMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [sigs, setSigs] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/polymarket')
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const signals = (d.signals || []).slice(0, 5);
        if (signals.length) setSigs(signals);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!sigs) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const n       = sigs.length;
  const gap     = 2;
  const bw      = Math.max(1, Math.floor((w - gap * (n - 1)) / n));
  const maxProb = Math.max(...sigs.map(s => s.probability));
  const pad     = 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {sigs.map((s, i) => {
        const barColor = s.sentiment === 'bullish' ? '#22c55e'
                       : s.sentiment === 'bearish' ? '#ef4444'
                       : '#f59e0b';
        const bh = Math.max(2, (s.probability / maxProb) * (h - pad * 2));
        const x  = i * (bw + gap);
        const y  = h - pad - bh;
        return (
          <g key={i}>
            <rect x={x} y={pad} width={bw} height={h - pad * 2} rx={1} fill="#1e2d3d" />
            <rect x={x} y={y} width={bw} height={bh} rx={1} fill={barColor} opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}

// ── Scorecard tile (grid) ──
function ScoreTile({ card, onOpen, active }) {
  const [hover, setHover] = useStateA(false);
  const [crowdStatus, setCrowdStatus] = useStateA(null);
  const [currencyStatus, setCurrencyStatus] = useStateA(null);
  const [yieldStatus, setYieldStatus] = useStateA(null);
  const [positioningStatus, setPositioningStatus] = useStateA(null);
  const effStatus = card.id === 'crowdsignals' && crowdStatus        ? crowdStatus
                  : card.id === 'currency'    && currencyStatus      ? currencyStatus
                  : card.id === 'yield'       && yieldStatus         ? yieldStatus
                  : card.id === 'positioning' && positioningStatus   ? positioningStatus
                  : card.status;
  const sg = DSIG[effStatus];
  return (
    <button onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px',
        background: '#111827', border: `1px solid ${active ? sg.line : hover ? '#28384a' : '#1e2d3d'}`, borderLeft: `3px solid ${sg.c}`, borderRadius: 14,
        boxShadow: hover ? '0 6px 20px rgba(0,0,0,.35)' : '0 1px 2px rgba(0,0,0,.3)', transform: hover ? 'translateY(-2px)' : 'none', transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: DSANS, fontSize: 15.5, fontWeight: 600, color: '#e8edf5', flex: 1 }}>{card.title}</span>
        {card.id === 'leadership'
          ? <LeadershipMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'equities'
          ? <EquitiesMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'sectors'
          ? <SectorsMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'credit'
          ? <CreditMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'commodities'
          ? <CommoditiesMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'globalflows'
          ? <GlobalFlowsMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'yield'
          ? <YieldMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'currency'
          ? <CurrencyMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'crowdsignals'
          ? <CrowdSignalsMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : card.id === 'positioning'
          ? <PositioningMiniSpark seed={card.seed} trend={card.trend} color={sg.c} w={56} h={20} />
          : <SparkD seed={card.seed} trend={card.trend} color="#a855f7" w={56} h={20} />}
        <StatusPill status={effStatus} size="sm" />
      </div>
      {card.id === 'yield'
        ? <YieldGlanceKpis card={card} compact={true} onStatus={setYieldStatus} />
        : card.id === 'currency'
        ? <CurrencyGlanceKpis compact={true} onStatus={setCurrencyStatus} />
        : card.id === 'crowdsignals'
        ? <CrowdSignalsGlanceKpis compact={true} onStatus={setCrowdStatus} />
        : card.id === 'positioning'
        ? <PositioningGlanceKpis compact={true} onStatus={setPositioningStatus} />
        : <div style={{ display: 'flex', gap: 10 }}>
            {card.rows.slice(0, 3).map((r, i) => {
              const rs = DSIG[r[3]];
              return (
                <div key={i} style={{ flex: 1, minWidth: 0, paddingLeft: i ? 11 : 0, borderLeft: i ? '1px solid #1b2736' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                    <span style={{ fontFamily: DMONO, fontSize: 14, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{r[1].split('\n')[0]}</span>
                  </div>
                  <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[0]}</div>
                </div>
              );
            })}
          </div>
      }
    </button>
  );
}

// ════ OPTION A — Full dashboard grid (click a tile → deep-dive overlay) ════
function OptionDashboard({ D }) {
  const [open, setOpen] = useStateA(null);
  const brief = useDailyBrief();
  const card = open ? D.cards[open] : null;
  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '26px 32px 60px', display: 'flex', flexDirection: 'column', gap: 26 }}>
      {D.horizons ? <HorizonHero horizons={D.horizons} exec={D.exec} /> : <BreadthBar exec={D.exec} cats={D.categories} groups={D.groups} cards={D.cards} />}
      {D.groups.map((g) => (
        <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#64748b' }}>{g.label}</span>
            <div style={{ flex: 1, height: 1, background: '#16202e' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {g.ids.map((id) => <ScoreTile key={id} card={D.cards[id]} onOpen={() => setOpen(id)} />)}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#64748b' }}>Daily Context</span>
          <div style={{ flex: 1, height: 1, background: '#16202e' }} />
        </div>
        <DailyBriefCard brief={brief} />
        <MacroBriefCard brief={brief} />
      </div>
      {card && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(4,7,12,.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '52px 24px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 880, background: '#080c14', border: '1px solid #1e2d3d', borderRadius: 20, padding: '24px 28px 30px', boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 22 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: DSIG[card.status].c, boxShadow: `0 0 8px ${DSIG[card.status].c}` }} />
              <span style={{ fontFamily: DSANS, fontSize: 22, fontWeight: 700, color: '#e8edf5' }}>{card.title}</span>
              <StatusPill status={card.status} />
              <button onClick={() => setOpen(null)} style={{ all: 'unset', cursor: 'pointer', marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, background: '#0d1520', border: '1px solid #1e2d3d' }}>
                <svg width="13" height="13" viewBox="0 0 13 13"><path d="M1 1l11 11M12 1L1 12" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
            <DeepDiveContent card={card} cardId={open} asOf={D.asOf} chartHeight={210} />
          </div>
        </div>
      )}
    </div>
  );
}

// ════ OPTION B — Two-pane workspace (list left, deep-dive right) ════
function OptionWorkspace({ D }) {
  const allIds = D.groups.flatMap((g) => g.ids);
  const [sel, setSelRaw] = useStateA(() => { try { const v = localStorage.getItem('mh-ws-sel'); return v && D.cards[v] ? v : allIds[0]; } catch (e) { return allIds[0]; } });
  const setSel = (id) => { setSelRaw(id); try { localStorage.setItem('mh-ws-sel', id); } catch (e) {} };
  const brief = useDailyBrief();
  const imData = useRegimeRatios();
  const special = sel === 'daily-brief' || sel === 'exec-summary' || sel === 'macro-brief' || sel === 'intermarket';
  const card = special ? null : D.cards[sel];
  // Responsive list/detail: two-pane when wide, single-pane drill-in when narrow.
  const twoPane = useMinWidth(640);
  const [detailOpen, setDetailOpen] = useStateA(false);
  const goTo = (id) => { setSel(id); setDetailOpen(true); };
  const backToList = () => setDetailOpen(false);
  const briefBack = () => { twoPane ? setSel(allIds[0]) : backToList(); };
  const showRail = twoPane || !detailOpen;
  const showDetail = twoPane || detailOpen;
  return (
    <div style={{ display: 'flex', height: twoPane ? 'calc(100vh - 58px)' : 'auto', overflow: twoPane ? 'hidden' : 'visible' }}>
      {/* left rail */}
      <div style={{ display: showRail ? 'block' : 'none', width: twoPane ? 340 : '100%', flexShrink: 0, borderRight: twoPane ? '1px solid #16202e' : 'none', background: '#0a0f17', overflowY: twoPane ? 'auto' : 'visible', padding: '20px 16px' }}>
        <div style={{ padding: '4px 8px 18px', borderBottom: '1px solid #16202e', marginBottom: 16 }}>
          {/* Row 1: three-horizon strip — click opens the full market summary (rich Glance hero) */}
          {D.horizons && (
            <button onClick={() => goTo('exec-summary')} title="Open the full market summary" style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', borderRadius: 10, padding: '4px 6px',
              background: sel === 'exec-summary' ? '#141f2e' : 'transparent', border: `1px solid ${sel === 'exec-summary' ? '#24364a' : 'transparent'}` }}>
              <HorizonRailMini horizons={D.horizons} />
            </button>
          )}
          {!D.horizons && (() => {
            const wsTotal = D.exec.bull + D.exec.neutral + D.exec.bear;
            const wsPct = wsTotal > 0 ? Math.round((D.exec.bull + D.exec.neutral * 0.5) / wsTotal * 100) : 0;
            const wsColor = postureColorD(D.exec.label);
            const R2 = 24, C2 = 2 * Math.PI * R2, gap2 = 4;
            const segs2 = [['bullish', D.exec.bull], ['neutral', D.exec.neutral], ['bearish', D.exec.bear]].filter((x) => x[1] > 0);
            let acc2 = 0;
            const arcs2 = segs2.map(([k, n]) => { const len = (n / wsTotal) * C2; const off = acc2; acc2 += len; return { k, len, off, c: DSIG[k].c }; });
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', boxShadow: `0 0 20px ${wsColor}44` }} />
                  <svg width="60" height="60" viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="30" cy="30" r={R2} fill="none" stroke="#16202e" strokeWidth="6" />
                    {arcs2.map((a) => (<circle key={a.k} cx="30" cy="30" r={R2} fill="none" stroke={a.c} strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${Math.max(a.len - gap2, 0)} ${C2}`} strokeDashoffset={-(a.off + gap2 / 2)} style={{ filter: `drop-shadow(0 0 3px ${a.c}88)` }} />))}
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
                      <span style={{ fontFamily: DMONO, fontSize: 13, fontWeight: 700, color: '#e8edf5' }}>{wsPct}</span>
                      <span style={{ fontFamily: DMONO, fontSize: 8, color: '#94a3b8' }}>%</span>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: wsColor, boxShadow: `0 0 6px ${wsColor}`, flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 12, fontWeight: 700, color: '#e8edf5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{D.exec.label}</span>
                  </div>
                  <span style={{ fontFamily: DSANS, fontSize: 11, color: '#94a3b8', display: 'block', paddingLeft: 13 }}>{D.exec.posture}</span>
                </div>
              </div>
            );
          })()}
          {/* Old aggregate By-Section / By-Factor breakdowns removed — the
              three-horizon rail above is the scoring system now. */}
        </div>
        {D.groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', padding: '0 8px 8px' }}>{g.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {g.ids.map((id) => {
                const c = D.cards[id], sg = DSIG[c.status], on = id === sel;
                return (
                  <button key={id} onClick={() => goTo(id)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 10,
                    background: on ? '#141f2e' : '#111827',
                    borderTop: `1px solid ${on ? '#24364a' : '#1e2d3d'}`,
                    borderRight: `1px solid ${on ? '#24364a' : '#1e2d3d'}`,
                    borderBottom: `1px solid ${on ? '#24364a' : '#1e2d3d'}`,
                    borderLeft: `3px solid ${sg.c}` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sg.c, boxShadow: `0 0 6px ${sg.glow}`, flexShrink: 0 }} />
                    <span style={{ fontFamily: DSANS, fontSize: 13.5, color: on ? '#e8edf5' : '#cbd5e1', fontWeight: on ? 600 : 400, flex: 1 }}>{c.title}</span>
                    {id === 'regime'
                      ? <RegimeMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'leadership'
                      ? <LeadershipMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'breadth'
                      ? <BreadthMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'sectors'
                      ? <SectorsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'credit'
                      ? <CreditMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'commodities'
                      ? <CommoditiesMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'globalflows'
                      ? <GlobalFlowsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'yield'
                      ? <YieldMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'currency'
                      ? <CurrencyMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'crowdsignals'
                      ? <CrowdSignalsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : id === 'positioning'
                      ? <PositioningMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={46} h={16} />
                      : <SparkD seed={c.seed} trend={c.trend} color="#a855f7" w={46} h={16} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div style={{ marginBottom: 16 }}>
          <InterMarketTile data={imData} active={sel === 'intermarket'} onOpen={() => goTo('intermarket')} />
        </div>
        <div style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', padding: '0 8px 8px' }}>Daily Context</div>
        <button onClick={() => goTo('daily-brief')} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 0, padding: '12px 14px', borderRadius: 10,
          background: sel === 'daily-brief' ? '#141f2e' : '#111827',
          borderTop: `1px solid ${sel === 'daily-brief' ? '#24364a' : '#1e2d3d'}`,
          borderRight: `1px solid ${sel === 'daily-brief' ? '#24364a' : '#1e2d3d'}`,
          borderBottom: `1px solid ${sel === 'daily-brief' ? '#24364a' : '#1e2d3d'}`,
          borderLeft: `3px solid ${brief ? sentimentColor(brief.isWeekly ? Math.round(brief.avgSentiment) : brief.sentiment) : '#1e2d3d'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: brief ? 9 : 0 }}>
            <span style={{ fontFamily: DSANS, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9', flex: 1 }}>{brief?.isWeekly ? 'Weekly Brief' : 'Daily Brief'}</span>
            {brief && !brief.isWeekly && <>
              <span style={{ fontFamily: DMONO, fontSize: 11.5, fontWeight: 700, color: sentimentColor(brief.sentiment) }}>{brief.sentiment > 0 ? '+' : ''}{brief.sentiment}</span>
              <span style={{ fontFamily: DSANS, fontSize: 10, color: '#64748b', padding: '1px 6px', borderRadius: 4, background: '#16202e', border: '1px solid #1e2d3d' }}>{brief.sector}</span>
            </>}
            {brief?.isWeekly && <span style={{ fontFamily: DMONO, fontSize: 11, fontWeight: 700, color: sentimentColor(Math.round(brief.avgSentiment)) }}>avg {brief.avgSentiment > 0 ? '+' : ''}{brief.avgSentiment}</span>}
          </div>
          {!brief && <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#475569' }}>Loading…</span>}
          {brief && !brief.isWeekly && (
            <>
              {brief.bullets.slice(0, 3).map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 6 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: sentimentColor(brief.sentiment), flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontFamily: DSANS, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 }}>{b}</span>
                </div>
              ))}
              {brief.bullets.length > 3 && <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#475569', paddingLeft: 11 }}>+{brief.bullets.length - 3} more</span>}
            </>
          )}
          {brief?.isWeekly && (
            <span style={{ fontFamily: DSANS, fontSize: 11, color: '#64748b' }}>{brief.weekLabel} · {brief.briefs?.length ?? 0} days · {brief.dominantSector}</span>
          )}
        </button>
        <MacroBriefWorkspacePanel onClick={() => goTo('macro-brief')} active={sel === 'macro-brief'} />
      </div>
      {/* right deep-dive */}
      <div style={{ display: showDetail ? 'block' : 'none', flex: 1, overflowY: twoPane ? 'scroll' : 'visible', padding: (sel === 'daily-brief' || sel === 'macro-brief') ? '0' : (twoPane ? '28px 36px 60px' : '8px 14px 40px') }}>
        {!twoPane && detailOpen && sel !== 'daily-brief' && sel !== 'macro-brief' && (
          <button onClick={backToList} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 4px 14px' }}>
            <svg width="8" height="13" viewBox="0 0 8 13"><path d="M6.5 1L1.5 6.5l5 5.5" stroke="#94a3b8" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>All signals</span>
          </button>
        )}
        {sel === 'daily-brief' ? (
          <DailyBriefDeepDive brief={brief} D={D} onBack={briefBack} />
        ) : sel === 'macro-brief' ? (
          <MacroBriefDeepDive onBack={briefBack} />
        ) : sel === 'intermarket' ? (
          <InterMarketDeepDive />
        ) : sel === 'exec-summary' ? (
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 24 }}>
              <span style={{ fontFamily: DSANS, fontSize: 25, fontWeight: 700, color: '#e8edf5' }}>Market Summary</span>
              <span style={{ marginLeft: 'auto', fontFamily: DMONO, fontSize: 12, color: '#64748b' }}>As of {D.asOf}</span>
            </div>
            <MarketSummaryDetail horizons={D.horizons} exec={D.exec} />
          </div>
        ) : (
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 24 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: DSIG[card.status].c, boxShadow: `0 0 9px ${DSIG[card.status].c}` }} />
              <span style={{ fontFamily: DSANS, fontSize: 25, fontWeight: 700, color: '#e8edf5' }}>{card.title}</span>
              <StatusPill status={card.status} />
              <span style={{ marginLeft: 'auto', fontFamily: DMONO, fontSize: 12, color: '#64748b' }}>As of {D.asOf}</span>
            </div>
            <DeepDiveContent card={card} cardId={sel} asOf={D.asOf} chartHeight={190} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Yield glance row — standalone component so hooks can track live status ──
function YieldGlanceRow({ c, onOpen }) {
  const mob = useIsMobile();
  const [liveStatus, setLiveStatus] = useStateA(null);
  const eff = liveStatus || c.status;
  const sg  = DSIG[eff];
  return (
    <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: mob ? 10 : 16, padding: mob ? '11px 12px' : '15px 18px', width: '100%',
      background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sg.c}`, borderRadius: 13 }}>
      <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5', width: mob ? 82 : 150, flexShrink: 0 }}>{c.title}</span>
      <YieldGlanceKpis card={c} compact={mob} onStatus={setLiveStatus} />
      {!mob && <YieldMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />}
      <StatusPill status={eff} size="sm" />
      <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

// ── Currency glance row — standalone component so hooks can track live status ──
function CurrencyGlanceRow({ c, onOpen }) {
  const mob = useIsMobile();
  const [liveStatus, setLiveStatus] = useStateA(null);
  const eff = liveStatus || c.status;
  const sg  = DSIG[eff];
  return (
    <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: mob ? 10 : 16, padding: mob ? '11px 12px' : '15px 18px', width: '100%',
      background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sg.c}`, borderRadius: 13 }}>
      <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5', width: mob ? 82 : 150, flexShrink: 0 }}>{c.title}</span>
      <CurrencyGlanceKpis compact={mob} onStatus={setLiveStatus} />
      {!mob && <CurrencyMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />}
      <StatusPill status={eff} size="sm" />
      <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

// ── Positioning (COT) glance components ──
function PositioningGlanceKpis({ compact = true, onStatus }) {
  const [contracts, setContracts] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/cot').then(r => r.json())
      .then(d => {
        if (!alive || !d.contracts) return;
        setContracts(d.contracts);
        if (onStatus) {
          const es = d.contracts.find(c => c.key === 'ES');
          const status = !es ? 'neutral'
            : es.crowding === 'crowded_short' ? 'bullish'
            : es.crowding === 'crowded_long'  ? 'bearish'
            : 'neutral';
          onStatus(status);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const fallback = [
    { label: 'S&P 500 (ES)', val: '—', tone: 'neutral' },
    { label: 'Gold (GC)',     val: '—', tone: 'neutral' },
    { label: 'WTI (CL)',      val: '—', tone: 'neutral' },
  ];
  const items = contracts ? contracts.map(c => ({
    label: c.key === 'ES' ? 'S&P 500 (ES)' : c.key === 'GC' ? 'Gold (GC)' : 'WTI (CL)',
    val:   c.empty ? '—' : `${c.pctile}th`,
    tone:  c.crowding === 'crowded_short' ? 'bullish'
         : c.crowding === 'crowded_long'  ? 'bearish'
         : 'neutral',
  })) : fallback;
  if (compact) {
    return (
      <div style={{ display: 'flex', gap: 10 }}>
        {items.map(({ label, val, tone }, i) => {
          const rs = DSIG[tone] || DSIG.neutral;
          return (
            <div key={i} style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
                <span style={{ fontFamily: DMONO, fontSize: 14, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
              </div>
              <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 4, whiteSpace: 'nowrap' }}>{label}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 22, flex: 1 }}>
      {items.map(({ label, val, tone }, i) => {
        const rs = DSIG[tone] || DSIG.neutral;
        return (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}`, flexShrink: 0 }} />
              <span style={{ fontFamily: DMONO, fontSize: 13.5, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{val}</span>
            </div>
            <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function PositioningMiniSpark({ seed, trend, color, w = 56, h = 20 }) {
  const [netPcts, setNetPcts] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    fetch('/api/cot').then(r => r.json())
      .then(d => {
        if (!alive || !d.contracts) return;
        const es = d.contracts.find(c => c.key === 'ES');
        if (es?.netPcts?.length > 0) setNetPcts(es.netPcts.slice(-20));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!netPcts) return <SparkD seed={seed} trend={trend} color={color} w={w} h={h} />;
  const lo = Math.min(...netPcts), hi = Math.max(...netPcts), span = hi - lo || 1;
  const dx = w / Math.max(netPcts.length - 1, 1);
  const path = netPcts.map((v, i) =>
    `${i === 0 ? 'M' : 'L'}${(i * dx).toFixed(1)},${(h - ((v - lo) / span) * h * 0.86 - h * 0.07).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function PositioningGlanceRow({ c, onOpen }) {
  const mob = useIsMobile();
  const [liveStatus, setLiveStatus] = useStateA(null);
  const eff = liveStatus || c.status;
  const sg  = DSIG[eff];
  return (
    <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: mob ? 10 : 16, padding: mob ? '11px 12px' : '15px 18px', width: '100%',
      background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sg.c}`, borderRadius: 13 }}>
      <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5', width: mob ? 82 : 150, flexShrink: 0 }}>{c.title}</span>
      <PositioningGlanceKpis compact={mob} onStatus={setLiveStatus} />
      {!mob && <PositioningMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />}
      <StatusPill status={eff} size="sm" />
      <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

// ── Crowd Signals glance row — standalone component so hooks can track live status ──
function CrowdSignalsGlanceRow({ c, onOpen }) {
  const mob = useIsMobile();
  const [liveStatus, setLiveStatus] = useStateA(null);
  const eff = liveStatus || c.status;
  const sg  = DSIG[eff];
  return (
    <button onClick={onOpen} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: mob ? 10 : 16, padding: mob ? '11px 12px' : '15px 18px', width: '100%',
      background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sg.c}`, borderRadius: 13 }}>
      <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5', width: mob ? 82 : 150, flexShrink: 0 }}>{c.title}</span>
      <CrowdSignalsGlanceKpis compact={mob} onStatus={setLiveStatus} />
      {!mob && <CrowdSignalsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />}
      <StatusPill status={eff} size="sm" />
      <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

// ════ OPTION C — Glance → dedicated deep-dive page ════
function OptionGlancePage({ D, open: openProp, onSetOpen }) {
  const mob = useIsMobile();
  const [openState, setOpenState] = useStateA(null);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = onSetOpen || setOpenState;
  const brief = useDailyBrief();
  const imData = useRegimeRatios();
  if (open) {
    if (open === 'daily-brief') {
      return <DailyBriefDeepDive brief={brief} D={D} onBack={() => setOpen(null)} />;
    }
    if (open === 'macro-brief') {
      return <MacroBriefDeepDive onBack={() => setOpen(null)} />;
    }
    if (open === 'market-summary') {
      return (
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 32px 60px' }}>
          <button onClick={() => setOpen(null)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderRadius: 10, background: '#0d1520', border: '1px solid #1e2d3d', marginBottom: 22 }}>
            <svg width="8" height="13" viewBox="0 0 8 13"><path d="M6.5 1L1.5 6.5l5 5.5" stroke="#94a3b8" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>All signals</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 20 }}>
            <span style={{ fontFamily: DSANS, fontSize: 26, fontWeight: 700, color: '#e8edf5' }}>Market Summary</span>
            <span style={{ marginLeft: 'auto', fontFamily: DMONO, fontSize: 12, color: '#64748b' }}>As of {D.asOf}</span>
          </div>
          <MarketSummaryDetail horizons={D.horizons} exec={D.exec} />
        </div>
      );
    }
    if (open === 'intermarket') {
      return <div style={{ padding: mob ? '16px 12px 50px' : '24px 32px 60px' }}><InterMarketDeepDive onBack={() => setOpen(null)} /></div>;
    }
    const card = D.cards[open];
    return (
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 32px 60px' }}>
        <button onClick={() => setOpen(null)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, padding: '9px 15px', borderRadius: 10, background: '#0d1520', border: '1px solid #1e2d3d', marginBottom: 22 }}>
          <svg width="8" height="13" viewBox="0 0 8 13"><path d="M6.5 1L1.5 6.5l5 5.5" stroke="#94a3b8" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>All signals</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 24 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: DSIG[card.status].c, boxShadow: `0 0 9px ${DSIG[card.status].c}` }} />
          <span style={{ fontFamily: DSANS, fontSize: 26, fontWeight: 700, color: '#e8edf5' }}>{card.title}</span>
          <StatusPill status={card.status} />
        </div>
        <DeepDiveContent card={card} cardId={open} asOf={D.asOf} />
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: mob ? '16px 10px 40px' : '30px 28px 60px', display: 'flex', flexDirection: 'column', gap: mob ? 14 : 22 }}>
      {D.horizons ? <HorizonHero horizons={D.horizons} exec={D.exec} onOpen={() => setOpen('market-summary')} /> : <BreadthBar exec={D.exec} cats={D.categories} groups={D.groups} cards={D.cards} />}
      {D.groups.map((g) => (
        <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', paddingLeft: 2 }}>{g.label}</span>
          {g.ids.map((id) => {
            const c = D.cards[id], sg = DSIG[c.status];
            if (id === 'yield')        return <YieldGlanceRow key={id} c={c} onOpen={() => setOpen(id)} />;
            if (id === 'currency')     return <CurrencyGlanceRow key={id} c={c} onOpen={() => setOpen(id)} />;
            if (id === 'crowdsignals') return <CrowdSignalsGlanceRow key={id} c={c} onOpen={() => setOpen(id)} />;
            if (id === 'positioning')  return <PositioningGlanceRow  key={id} c={c} onOpen={() => setOpen(id)} />;
            return (
              <button key={id} onClick={() => setOpen(id)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: mob ? 10 : 16, padding: mob ? '11px 12px' : '15px 18px', width: '100%',
                background: '#111827', border: '1px solid #1e2d3d', borderLeft: `3px solid ${sg.c}`, borderRadius: 13 }}>
                <span style={{ fontFamily: DSANS, fontSize: mob ? 14 : 15.5, fontWeight: 600, color: '#e8edf5', width: mob ? 82 : 150, flexShrink: 0 }}>{c.title}</span>
                {id === 'yield'
                  ? <YieldGlanceKpis card={c} compact={mob} />
                  : id === 'crowdsignals'
                  ? <CrowdSignalsGlanceKpis compact={mob} />
                  : <div style={{ display: 'flex', gap: mob ? 10 : 22, flex: 1 }}>
                      {c.rows.slice(0, mob ? 2 : 3).map((r, i) => {
                        const rs = DSIG[r[3]];
                        return (
                          <div key={i} style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: rs.c, boxShadow: `0 0 5px ${rs.glow}` }} />
                              <span style={{ fontFamily: DMONO, fontSize: mob ? 11.5 : 13.5, fontWeight: 600, color: rs.c, whiteSpace: 'nowrap' }}>{r[1].split('\n')[0]}</span>
                            </div>
                            <div style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b', marginTop: 3, whiteSpace: 'nowrap' }}>{r[0]}</div>
                          </div>
                        );
                      })}
                    </div>
                }
                {!mob && (id === 'regime'
                  ? <RegimeMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'leadership'
                  ? <LeadershipMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'breadth'
                  ? <BreadthMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'equities'
                  ? <EquitiesMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'sectors'
                  ? <SectorsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'credit'
                  ? <CreditMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'commodities'
                  ? <CommoditiesMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'globalflows'
                  ? <GlobalFlowsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'yield'
                  ? <YieldMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'currency'
                  ? <CurrencyMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'crowdsignals'
                  ? <CrowdSignalsMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : id === 'positioning'
                  ? <PositioningMiniSpark seed={c.seed} trend={c.trend} color={sg.c} w={64} h={22} />
                  : <SparkD seed={c.seed} trend={c.trend} color="#a855f7" w={64} h={22} />)}
                <StatusPill status={c.status} size="sm" />
                <svg width="7" height="12" viewBox="0 0 7 12"><path d="M1 1l5 5-5 5" stroke="#334155" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            );
          })}
        </div>
      ))}
      <InterMarketGlanceRow data={imData} onOpen={() => setOpen('intermarket')} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8295a9', paddingLeft: 2 }}>Daily Context</span>
        <DailyBriefGlanceRow brief={brief} onOpen={() => setOpen('daily-brief')} />
        <MacroBriefGlanceRow onOpen={() => setOpen('macro-brief')} />
      </div>
    </div>
  );
}

// ════ Shell with prototype switcher ════
const OPTIONS = [
  { id: 'dashboard', label: 'A · Dashboard grid', sub: 'All cards at once', render: (D) => <OptionDashboard D={D} /> },
  { id: 'workspace', label: 'B · Two-pane workspace', sub: 'List + live deep-dive', render: (D) => <OptionWorkspace D={D} /> },
  { id: 'glance', label: 'C · Glance → page', sub: 'Scan, then drill in', render: (D) => <OptionGlancePage D={D} /> },
];

function DesktopApp() {
  const D = useGlance();
  const [opt, setOpt] = useStateA(() => { try { return localStorage.getItem('mh-desk-opt') || 'dashboard'; } catch (e) { return 'dashboard'; } });
  const pick = (id) => { setOpt(id); try { localStorage.setItem('mh-desk-opt', id); } catch (e) {} };
  const current = OPTIONS.find((o) => o.id === opt) || OPTIONS[0];
  return (
    <div style={{ minHeight: '100vh', background: '#080c14' }}>
      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 18, height: 58, padding: '0 24px', background: 'rgba(8,12,20,.86)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #16202e' }}>
        <svg width="24" height="21" viewBox="0 0 30 26"><rect x="0" y="14" width="7" height="12" rx="1.5" fill="#ef4444" /><rect x="11.5" y="7" width="7" height="19" rx="1.5" fill="#f59e0b" /><rect x="23" y="0" width="7" height="26" rx="1.5" fill="#22c55e" /></svg>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: DSANS, fontSize: 15, fontWeight: 700, color: '#e8edf5', lineHeight: 1.1 }}>Market Hub</span>
          <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>Macro Framework</span>
        </div>
        {/* prototype switcher */}
        <div style={{ marginLeft: 24, display: 'flex', gap: 4, padding: 4, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 11 }}>
          {OPTIONS.map((o) => (
            <button key={o.id} onClick={() => pick(o.id)} title={o.sub} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', padding: '6px 14px', borderRadius: 8,
              background: o.id === opt ? '#1b2736' : 'transparent', border: `1px solid ${o.id === opt ? '#28384a' : 'transparent'}` }}>
              <span style={{ fontFamily: DSANS, fontSize: 12.5, fontWeight: 600, color: o.id === opt ? '#e8edf5' : '#94a3b8' }}>{o.label}</span>
              <span style={{ fontFamily: DSANS, fontSize: 10, color: '#8295a9' }}>{o.sub}</span>
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 9, background: '#0d1520', border: '1px solid #1e2d3d' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ fontFamily: DMONO, fontSize: 12, color: '#94a3b8' }}>As of {D.asOf}</span>
        </div>
      </div>
      {/* prototype label banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 28px', background: '#0a0f17', borderBottom: '1px solid #16202e' }}>
        <span style={{ fontFamily: DSANS, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8295a9' }}>Prototype</span>
        <span style={{ fontFamily: DSANS, fontSize: 13, color: '#94a3b8' }}>{current.label.replace(/^.·\s/, '')} — {current.sub}</span>
      </div>
      {current.render(D)}
      <DisclaimerFooter />
    </div>
  );
}

window.DesktopApp = DesktopApp;

// ── Solo shell — renders a single option full-screen (for per-option preview cards) ──
function SoloShell({ optId }) {
  const D = useGlance();
  const o = OPTIONS.find((x) => x.id === optId) || OPTIONS[0];
  return (
    <div style={{ minHeight: '100vh', background: '#080c14' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 16, height: 58, padding: '0 24px', background: 'rgba(8,12,20,.86)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #16202e' }}>
        <svg width="24" height="21" viewBox="0 0 30 26"><rect x="0" y="14" width="7" height="12" rx="1.5" fill="#ef4444" /><rect x="11.5" y="7" width="7" height="19" rx="1.5" fill="#f59e0b" /><rect x="23" y="0" width="7" height="26" rx="1.5" fill="#22c55e" /></svg>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: DSANS, fontSize: 15, fontWeight: 700, color: '#e8edf5', lineHeight: 1.1 }}>Market Hub</span>
          <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>Macro Framework</span>
        </div>
        <div style={{ marginLeft: 18, display: 'flex', flexDirection: 'column', padding: '6px 14px', borderRadius: 9, background: '#1b2736', border: '1px solid #28384a' }}>
          <span style={{ fontFamily: DSANS, fontSize: 12.5, fontWeight: 600, color: '#e8edf5' }}>{o.label}</span>
          <span style={{ fontFamily: DSANS, fontSize: 10, color: '#8295a9' }}>{o.sub}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 9, background: '#0d1520', border: '1px solid #1e2d3d' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ fontFamily: DMONO, fontSize: 12, color: '#94a3b8' }}>As of {D.asOf}</span>
        </div>
      </div>
      {o.render(D)}
    </div>
  );
}

window.SoloShell = SoloShell;

// ── Toggle shell — flip between just B (workspace) and C (glance) ──
function DisclaimerFooter() {
  return (
    <div style={{ borderTop: '1px solid #16202e', padding: '18px 28px', marginTop: 8 }}>
      <p style={{ fontFamily: DSANS, fontSize: 11, color: '#475569', lineHeight: 1.6, margin: 0 }}>
        <strong style={{ color: '#64748b', fontWeight: 600 }}>Disclaimer:</strong> Market Hub is for informational and educational purposes only. Nothing on this site constitutes investment advice, a solicitation, or a recommendation to buy or sell any security, commodity, or financial instrument. Market Hub is not a registered investment adviser, broker-dealer, or commodity trading adviser. Data may be delayed, incomplete, or inaccurate — verify independently before acting. Past performance does not guarantee future results. Prediction market probabilities reflect crowd sentiment and are not guaranteed outcomes. Always consult a qualified financial professional before making investment decisions.
      </p>
    </div>
  );
}

function ToggleShell() {
  const D = useGlance();
  const [mode, setMode] = useStateA(() => { try { return localStorage.getItem('mh-bc') || 'workspace'; } catch (e) { return 'workspace'; } });
  const [glanceOpen, setGlanceOpen] = useStateA(null);
  const pick = (m) => { setMode(m); try { localStorage.setItem('mh-bc', m); } catch (e) {} };
  const goHome = () => { if (mode === 'glance') setGlanceOpen(null); };
  const TABS = [
    { id: 'workspace', label: 'Workspace', sub: 'List + live deep-dive' },
    { id: 'glance', label: 'Glance', sub: 'Scan, then drill in' },
  ];
  return (
    <div style={{ minHeight: '100vh', background: '#080c14' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 18, height: 58, padding: '0 24px', background: 'rgba(8,12,20,.86)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #16202e' }}>
        <button onClick={goHome} title="Back to home" style={{ all: 'unset', cursor: mode === 'glance' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="21" viewBox="0 0 30 26"><rect x="0" y="14" width="7" height="12" rx="1.5" fill="#ef4444" /><rect x="11.5" y="7" width="7" height="19" rx="1.5" fill="#f59e0b" /><rect x="23" y="0" width="7" height="26" rx="1.5" fill="#22c55e" /></svg>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontFamily: DSANS, fontSize: 15, fontWeight: 700, color: '#e8edf5', lineHeight: 1.1 }}>Market Hub</span>
            <span style={{ fontFamily: DSANS, fontSize: 10.5, color: '#64748b' }}>Macro Framework</span>
          </div>
        </button>
        {/* the toggle — right-aligned, replaces date */}
        <div style={{ marginLeft: 'auto', display: 'flex', padding: 3, background: '#0d1520', border: '1px solid #1e2d3d', borderRadius: 8 }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => pick(t.id)} style={{ all: 'unset', cursor: 'pointer', padding: '4px 12px', borderRadius: 6,
              background: t.id === mode ? '#1b2736' : 'transparent', border: `1px solid ${t.id === mode ? '#28384a' : 'transparent'}`, transition: 'background .18s ease' }}>
              <span style={{ fontFamily: DSANS, fontSize: 12.5, fontWeight: 600, color: t.id === mode ? '#e8edf5' : '#64748b' }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      {mode === 'workspace' ? <OptionWorkspace D={D} /> : <OptionGlancePage D={D} open={glanceOpen} onSetOpen={setGlanceOpen} />}
      <DisclaimerFooter />
    </div>
  );
}

window.ToggleShell = ToggleShell;
