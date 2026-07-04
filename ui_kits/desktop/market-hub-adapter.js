// ════════════════════════════════════════════════════════════════════════════
// Market Hub — data adapter
// ────────────────────────────────────────────────────────────────────────────
// Translates the LIVE product API (/api/scores + per-card history endpoints)
// into the shape the redesign kits render (window.GLANCE). In production this
// runs same-origin against your Cloudflare worker; in the design-system preview
// (no API reachable) every call falls back to the baked-in mock so the kit
// still renders. Drop this file into the app and point CONFIG.baseUrl at "" .
//
// Real contract (from the live app's own code):
//   GET /api/scores  ->  { aggregate, horizons, cards }
//     aggregate: { glow:'green'|'yellow'|'red', label, posture, score,
//                  bullish, neutral, bearish, regimeBearish,
//                  categories:[ { label, weight:0..1, score, glow,
//                                 cards:[ { status } ] } ] }
//     horizons: { speedometer:{ score:0..10, level:'high'|'low', components[], veto, vixRatio, trigger, horizon },
//                 compass:    { score:0..10, level, components[], trigger, horizon },
//                 anchor:     { score:0..10, zone:'green'|'amber'|'red', sizingFactor, percentiles[], note, trigger, horizon },
//                 matrix:     { quadrant, label, guidance, sizingFactor, speedLevel, compassLevel } }
//     cards: [ { id, title, subtitle, status, delta,
//                rows:[ { label, indicator, value, condition, status } ],
//                hideIndicator?, allRows?, sectorTable?, details? } ]
//   GET /api/history?symbol=SPY&range=1y&d=YYYY-MM-DD -> { dates, closes, sma200, vs200, summary }
//   GET /api/breadth-history?range=1y    -> { dates, mmth, mmfi, summary }
//   GET /api/leadership?range=1y         -> { dates, rspVsSpy, qqewVsQqq, summary }
//   GET /api/valuations-history?range=10y-> { dates, capes, peRatios, summary }
//   GET /api/sectors?range=1y            -> { dates, cycVsDef, summary }
//   GET /api/global-flows-history?range=5y -> { dates, regional:[{sym,label,prices}], countries }
//   GET /api/equities-history?range=1y   -> { dates, equities:[{sym,label,group,prices}] }
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CONFIG = {
    // "" = same-origin (production). The preview sandbox can't reach the API,
    // so requests fail fast and we fall back to the mock. Set to your full
    // origin (e.g. "https://www.loganbase.com/market-hub") to test cross-origin.
    baseUrl: '',
    timeoutMs: 4000,
  };

  // UI range labels (kit) -> API range tokens (live product)
  const RANGE_MAP = { '20D': '20d', '1W': '1wk', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y', '10Y': '10y', '20Y': '20y' };

  // Per-card history: which endpoint to call and how to extract { values, dates }.
  // Simple cards use `field` (a flat number[] on the response).
  // Complex cards (objects-in-array) use `extract(data)` to pick one series.
  const HISTORY = {
    regime: {
      url: (r) => `/api/history?symbol=SPY&range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.closes) || !data.closes.length) return null;
        return {
          values:    data.closes.map(Number),
          dates:     data.dates || [],
          lineColor: '#22d3ee',
          overlays: [
            { label: '50d SMA',  values: (data.sma50  || []).map(Number), color: '#818cf8', dash: [5, 3] },
            { label: '200d SMA', values: (data.sma200 || []).map(Number), color: '#a855f7', dash: null },
          ],
          vs200:   (data.vs200  || []).map(Number),
          // Price's % distance above/below the 50d SMA (not the 50d-vs-200d cross spread).
          vs50: data.closes.map((c, i) => {
            const s50 = Number((data.sma50 || [])[i]);
            return (c != null && s50) ? ((Number(c) - s50) / s50) * 100 : null;
          }),
          rsi:     (data.rsi14  || []).map(Number),
        };
      },
    },
    leadership: {
      url: (r) => `/api/leadership?range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.rspVsSpy) || !data.rspVsSpy.length) return null;
        return {
          values:    data.rspVsSpy,
          dates:     data.dates || [],
          label:     'RSP vs SPY',
          format:    'pct',
          lineColor: '#22d3ee',
          overlays: [
            { label: 'QQEW vs QQQ', values: data.qqewVsQqq || [], color: '#a855f7', dash: null },
            { label: 'IVW vs IVE',  values: data.ivwVsIve  || [], color: '#f59e0b', dash: [5, 3] },
          ],
        };
      },
    },
    breadth: {
      url: (r) => `/api/breadth-history?range=${r}`,
      extract: (data) => {
        const mmth = data.mmth;
        if (!Array.isArray(mmth) || !mmth.length) return null;
        return {
          values:  mmth.map(Number),
          dates:   data.dates || [],
          colorBy: mmth.map(v => v == null ? null : v - 50), // >0 when MMTH>50% (green), <0 when MMTH<50% (red)
        };
      },
    },
    valuations: {
      // API only supports 5y/10y/20y/30y/50y/100y — short UI ranges fall back to 5y
      url: (r) => {
        const vr = ['5y','10y','20y','30y','50y','100y'].includes(r) ? r : '5y';
        return `/api/valuations-history?range=${vr}`;
      },
      extract: (data) => {
        const capes = data.capes;
        if (!Array.isArray(capes) || !capes.length) return null;
        const values   = capes.map(Number);
        // Map each CAPE reading to a regime status using the same thresholds as
        // buildValuationsMetrics: >35 = bearish (very high), >25 = neutral (elevated),
        // ≤25 = bullish (near/below historical average).
        const statuses = values.map(v =>
          v == null || isNaN(v) ? 'neutral' :
          v > 35 ? 'bearish' :
          v > 25 ? 'neutral' :
          'bullish'
        );
        return { values, dates: data.dates || [], statuses };
      },
    },
    yield: {
      url: (r) => `/api/history?symbol=%5ETNX&range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.closes) || !data.closes.length) return null;
        const toNum = (v) => v == null ? null : Number(v);
        const vs200 = (data.vs200 || []).map(toNum);
        return {
          values:  data.closes.map(toNum),
          dates:   data.dates || [],
          colorBy: vs200.map(v => v != null ? -v : null), // above 200d = tighter conditions = bearish
        };
      },
    },
    credit: {
      url: (r) => `/api/history?symbol=HYG&range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.closes) || !data.closes.length) return null;
        const toNum = (v) => v == null ? null : Number(v);
        const vs200 = (data.vs200 || []).map(toNum);
        return {
          values:  data.closes.map(toNum),
          dates:   data.dates || [],
          colorBy: vs200,  // >0 = above 200d (bullish), <0 = below 200d (bearish)
          vs200,
        };
      },
    },
    currency: {
      url: (r) => `/api/history?symbol=UUP&range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.closes) || !data.closes.length) return null;
        const toNum = (v) => v == null ? null : Number(v);
        const vs200 = (data.vs200 || []).map(toNum);
        return {
          values:  data.closes.map(toNum),
          dates:   data.dates || [],
          colorBy: vs200.map(v => v != null ? -v : null), // USD above 200d = tighter conditions = bearish
        };
      },
    },
    sectors:     { url: (r) => `/api/sectors?range=${r}`,               field: 'cycVsDef'  },
    commodities: {
      url: (r) => `/api/history?symbol=USCI&range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.closes) || !data.closes.length) return null;
        const toNum = (v) => v == null ? null : Number(v);
        return {
          values:    data.closes.map(toNum),
          dates:     data.dates || [],
          label:     'USCI',
          lineColor: '#22d3ee',
          overlays: [
            { label: '50d SMA',  values: (data.sma50  || []).map(toNum), color: '#818cf8', dash: [5, 3] },
            { label: '200d SMA', values: (data.sma200 || []).map(toNum), color: '#a855f7', dash: null  },
          ],
          vs200:   (data.vs200 || []).map(toNum),
          colorBy: (data.vs200 || []).map(toNum),
          vs50:  data.closes.map((c, i) => {
            const s50 = toNum((data.sma50 || [])[i]);
            return (c != null && s50) ? ((Number(c) - s50) / s50) * 100 : null;
          }),
          rsi: (data.rsi14 || []).map(toNum),
        };
      },
    },
    globalflows: {
      url: (r) => `/api/history?symbol=ACWI&range=${r}`,
      extract: (data) => {
        if (!Array.isArray(data.closes) || !data.closes.length) return null;
        const toNum = (v) => v == null ? null : Number(v);
        const vs200 = (data.vs200 || []).map(toNum);
        return {
          values:  data.closes.map(toNum),
          dates:   data.dates || [],
          colorBy: vs200, // >0 = ACWI above 200d SMA (bullish), <0 = below (bearish)
        };
      },
    },
    equities: {
      url: (r) => `/api/equities-history?range=${r}`,
      extract: (data) => {
        const spy = (data.equities || []).find((e) => e.sym === 'SPY');
        return spy ? { values: spy.prices.map(Number), dates: data.dates || [] } : null;
      },
    },
  };

  // Symbol -> ISO country code, for the Global Flows flag row (from the live app).
  const FLAG = {
    'SPY': 'us', '^GSPTSE': 'ca', 'EWU': 'gb', 'EWG': 'de', 'EWQ': 'fr', 'EWL': 'ch',
    'EWJ': 'jp', 'MCHI': 'cn', 'INDA': 'in', 'EWZ': 'br', 'EWA': 'au', 'EWY': 'kr',
    'EWH': 'hk', 'EWW': 'mx', 'EWT': 'tw', 'EWP': 'es', 'EWI': 'it', 'EWN': 'nl', 'ECH': 'cl',
  };

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
  }
  async function getJSON(path) {
    const res = await withTimeout(fetch(CONFIG.baseUrl + path, { credentials: 'same-origin' }), CONFIG.timeoutMs);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function hashSeed(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h || 7; }
  function asOfLabel() {
    const d = new Date();
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Strip HTML — single line (for stat boxes where space is tight)
  function stripHtml(s) {
    if (!s) return '';
    const first = String(s).split(/<br\s*\/?>/i)[0];
    return first
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  // Strip HTML — multi-line: joins <br>-separated segments with \n (for indicator table rows)
  function stripHtmlMulti(s) {
    if (!s) return '';
    return String(s)
      .split(/<br\s*\/?>/i)
      .map((seg) => seg.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
      .filter(Boolean)
      .join('\n');
  }

  // ── Map a live /api/scores card into the kit's card shape ──
  function mapCard(c) {
    const normStatus = (s) => s === 'bullish' ? 'bullish' : s === 'bearish' ? 'bearish' : 'neutral';
    // r[0]=label, r[1]=value (multi-line), r[2]=condition, r[3]=status, r[4]=indicator, r[5]=sma200, r[6]=price
    // r[7]=weight (sectors only, S&P index weight 0–1), r[8]=relPerf (sectors only, 20d vs SPY %)
    // Use allRows (full set) when present (e.g. Sectors has top-6 in rows, all-11 in allRows)
    const rowSource = c.allRows || c.rows || [];
    const rows = rowSource.map((r) => [r.label, stripHtmlMulti(r.value), r.condition || '', normStatus(r.status), r.indicator || '', r.sma200 ?? null, r.price ?? null, r.weight ?? null, r.relPerf ?? null]);
    const head = (c.rows && c.rows[0]) || {};
    const out = {
      id: c.id,
      title: c.title,
      status: c.status,
      seed: hashSeed(c.id),
      trend: c.status === 'bullish' ? 0.5 : c.status === 'bearish' ? -0.5 : 0.05,
      metric: c.subtitle || head.label || c.title,
      metricVal: stripHtml(head.value || ''),
      metricUnit: head.condition || head.indicator || '',
      // Use server-provided stats (e.g. regime historical context) if available, else derive from top 3 rows.
      stats: c.stats || (c.rows || []).slice(0, 3).map((r) => [r.label, stripHtml(r.value), r.condition || r.indicator || '',
        r.status === 'bullish' ? 'pos' : r.status === 'bearish' ? 'neg' : null]),
      rows,
      note: c.note || null,
      sectorTable: c.sectorTable || null,
      details: c.details || null,
      deltas:     c.deltas     || null,
      commDeltas: c.commDeltas || null,
      vix:        c.vix        || null,
    };
    // Global Flows: derive the flag row from card.details (field is `sym`, not `symbol`).
    if (c.id === 'globalflows' && Array.isArray(c.details)) {
      out.flags = c.details.map((d) => FLAG[d.sym]).filter(Boolean);
    }
    return out;
  }

  // ── Map the whole /api/scores payload into window.GLANCE shape ──
  function mapScores(data) {
    const agg = data.aggregate || {};
    const cardsArr = data.cards || [];
    const byId = {};
    cardsArr.forEach((c) => { byId[c.id] = mapCard(c); });
    const categories = (agg.categories || []).map((cat) => ({
      label: cat.label,
      weight: Math.round((cat.weight || 0) * 100) + '%',
      cards: (cat.cards || []).map((c) => c.status),
    }));
    // Inject seed-only cards the API doesn't return (crowdsignals, positioning — currency is now in /api/scores).
    const seedCards = (window.GLANCE || {}).cards || {};
    ['currency', 'crowdsignals', 'positioning'].forEach(id => { if (!byId[id] && seedCards[id]) byId[id] = seedCards[id]; });
    // Currency is a Macro Conditions signal — inject into display category and exec counts when
    // it comes from the seed fallback (API already includes it in categories when server-side).
    const macroIdx = categories.findIndex((c) => /macro/i.test(c.label));
    const currencyStatus = byId['currency']?.status;
    if (currencyStatus && macroIdx !== -1) {
      const mc = categories[macroIdx];
      categories[macroIdx] = { ...mc, cards: [...mc.cards, currencyStatus] };
    }

    // Preserve the kit's group ordering, keep only ids the API actually returned.
    const GROUPS = [
      { label: 'Market Structure', ids: ['regime', 'leadership', 'breadth'] },
      { label: 'Macro Pricing',    ids: ['valuations', 'yield', 'credit', 'currency'] },
      { label: 'Flow & Rotation',  ids: ['globalflows', 'sectors'] },
      { label: 'Real Assets',      ids: ['commodities', 'equities'] },
      { label: 'Crowd Intelligence', ids: ['crowdsignals', 'positioning'] },
    ].map((g) => ({ label: g.label, ids: g.ids.filter((id) => byId[id]) })).filter((g) => g.ids.length);
    return {
      asOf: asOfLabel(),
      exec: {
        label: agg.label || 'Neutral',
        posture: agg.posture || '',
        bull: agg.bullish ?? 0, neutral: agg.neutral ?? 0, bear: agg.bearish ?? 0,
        regimeBearish: agg.regimeBearish ?? false,
        score: agg.score || null,
        scoreDirection: agg.scoreDirection || 'same',
        divergence: agg.divergence || null,
      },
      horizons: data.horizons || null,
      categories,
      groups: GROUPS,
      cards: byId,
      _live: true,
    };
  }

  // ── Public API ──
  const MarketHubData = {
    config: CONFIG,

    // Returns today's daily brief from /api/daily-brief, or null on error.
    async loadDailyBrief() {
      try {
        return await getJSON('/api/daily-brief');
      } catch (e) {
        return null;
      }
    },

    // Returns kit-shaped data. Live when /api/scores is reachable, else the mock.
    async loadGlance() {
      try {
        const data = await getJSON('/api/scores');
        return mapScores(data);
      } catch (e) {
        // Expected in the design-system preview — fall back to the bundled mock.
        if (window.GLANCE) return Object.assign({}, window.GLANCE, { _live: false });
        throw e;
      }
    },

    // Returns { values:number[], dates:string[] } for a card's primary series,
    // or null if unavailable (caller then renders the synthetic sparkline).
    async loadHistory(cardId, uiRange) {
      const cfg = HISTORY[cardId];
      if (!cfg) return null;
      const r = RANGE_MAP[uiRange] || '1y';
      try {
        const data = await getJSON(cfg.url(r) + `&d=${new Date().toISOString().slice(0, 10)}`);
        if (cfg.extract) return cfg.extract(data);
        const values = data[cfg.field];
        if (!Array.isArray(values) || !values.length) return null;
        return { values: values.map(Number), dates: data.dates || [] };
      } catch (e) {
        return null;
      }
    },

    _internal: { mapScores, mapCard, RANGE_MAP, HISTORY, FLAG },
  };

  window.MarketHubData = MarketHubData;
})();
