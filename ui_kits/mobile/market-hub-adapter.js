// Market Hub mobile — data adapter.
// Fetches /api/scores, /api/daily-brief, /api/macro-brief and maps them into
// the shape Glance.jsx renders. Falls back to the static mock in glance-data.js
// when any API is unreachable (design preview / offline).
(function () {
  'use strict';

  const CONFIG = { baseUrl: '', timeoutMs: 5000 };

  const RANGE_MAP = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y' };

  const HISTORY = {
    regime:      { url: (r) => `/api/history?symbol=SPY&range=${r}`,    field: 'vs200'    },
    leadership:  { url: (r) => `/api/leadership?range=${r}`,            field: 'rspVsSpy' },
    breadth:     { url: (r) => `/api/breadth-history?range=${r}`,       field: 'mmth'     },
    valuations:  { url: (r) => { const vr = ['5y','10y','20y'].includes(r) ? r : '5y'; return `/api/valuations-history?range=${vr}`; }, field: 'capes' },
    yield:       { url: (r) => `/api/history?symbol=%5ETNX&range=${r}`, field: 'closes'   },
    credit:      { url: (r) => `/api/history?symbol=HYG&range=${r}`,    field: 'closes'   },
    currency:    { url: (r) => `/api/history?symbol=UUP&range=${r}`,    field: 'closes'   },
    globalflows: { url: (r) => `/api/history?symbol=ACWI&range=${r}`,   field: 'closes'   },
    sectors:     { url: (r) => `/api/sectors?range=${r}`,               field: 'cycVsDef' },
    commodities: { url: (r) => `/api/history?symbol=USCI&range=${r}`,   field: 'closes'   },
    equities:    { url: (r) => `/api/equities-history?range=${r}`,      field: null       },
  };

  const FLAG = {
    'SPY': 'us', '^GSPTSE': 'ca', 'EWU': 'gb', 'EWG': 'de', 'EWQ': 'fr', 'EWL': 'ch',
    'EWJ': 'jp', 'MCHI': 'cn', 'INDA': 'in', 'EWZ': 'br', 'EWA': 'au', 'EWY': 'kr',
    'EWH': 'hk', 'EWW': 'mx', 'EWT': 'tw', 'EWP': 'es', 'EWI': 'it', 'EWN': 'nl', 'ECH': 'cl',
  };

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  }
  async function getJSON(path) {
    const res = await withTimeout(fetch(CONFIG.baseUrl + path, { credentials: 'same-origin' }), CONFIG.timeoutMs);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (d && d.error) throw new Error(d.error);
    return d;
  }

  function hashSeed(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h || 7; }
  function asOfLabel() { return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function stripHtml(s) {
    if (!s) return '';
    // Split on newline OR <br> — Leadership rows encode spread + breakdown as "spread\nRSP… SPY…"
    const first = String(s).split(/\n|<br\s*\/?>/i)[0];
    return first.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  }

  function mapCard(c) {
    const rowSource = c.allRows || c.rows || [];
    const rows = rowSource.map((r) => [r.label, stripHtml(r.value || ''), r.condition || '', r.status || 'neutral', r.indicator || '', r.sma200 ?? null, r.price ?? null]);
    const head = (c.rows && c.rows[0]) || {};
    const out = {
      id: c.id, title: c.title, status: c.status,
      seed: hashSeed(c.id),
      trend: c.status === 'bullish' ? 0.5 : c.status === 'bearish' ? -0.5 : 0.05,
      metric: c.subtitle || head.label || c.title,
      metricVal: stripHtml(head.value || ''),
      metricUnit: head.condition || head.indicator || '',
      stats: c.stats || (c.rows || []).slice(0, 3).map((r) => [
        r.label, stripHtml(r.value), r.condition || r.indicator || '',
        r.status === 'bullish' ? 'pos' : r.status === 'bearish' ? 'neg' : null,
      ]),
      rows,
      note: c.note || null,
    };
    if (c.id === 'globalflows' && Array.isArray(c.details)) {
      out.flags = c.details.map((d) => FLAG[d.sym || d.symbol]).filter(Boolean);
    }
    return out;
  }

  function mapScores(data) {
    const agg = data.aggregate || {};
    const byId = {};
    (data.cards || []).forEach((c) => { byId[c.id] = mapCard(c); });

    // Inject currency + crowdsignals from seed when API doesn't return them yet.
    const seed = (window.GLANCE || {}).cards || {};
    ['currency', 'crowdsignals', 'positioning'].forEach((id) => { if (!byId[id] && seed[id]) byId[id] = seed[id]; });

    // Currency shows in Macro Conditions dots but is excluded from the scored denominator (10 cards only).
    const categories = (agg.categories || []).map((cat) => ({
      label: cat.label,
      weight: Math.round((cat.weight || 0) * 100) + '%',
      cards: (cat.cards || []).map((c) => c.status),
    }));
    const macroIdx = categories.findIndex((c) => /macro/i.test(c.label));
    const currStatus = byId['currency']?.status;
    if (currStatus && macroIdx !== -1) {
      const mc = categories[macroIdx];
      categories[macroIdx] = { ...mc, cards: [...mc.cards, currStatus] };
    }

    const GROUPS = [
      { label: 'Market Structure',   ids: ['regime', 'leadership', 'breadth'] },
      { label: 'Macro Pricing',      ids: ['valuations', 'yield', 'credit', 'currency'] },
      { label: 'Flow & Rotation',    ids: ['globalflows', 'sectors'] },
      { label: 'Real Assets',        ids: ['commodities', 'equities'] },
      { label: 'Crowd Intelligence', ids: ['crowdsignals', 'positioning'] },
    ].map((g) => ({ label: g.label, ids: g.ids.filter((id) => byId[id]) })).filter((g) => g.ids.length);

    return {
      asOf: asOfLabel(),
      exec: {
        label: agg.label || 'Neutral',
        posture: agg.posture || '',
        bull: agg.bullish ?? 0, neutral: agg.neutral ?? 0, bear: agg.bearish ?? 0,
        regimeBearish: agg.regimeBearish ?? false,
      },
      horizons: data.horizons || null,
      categories,
      groups: GROUPS,
      cards: byId,
      _live: true,
    };
  }

  const MarketHubData = {
    config: CONFIG,

    async loadGlance() {
      try {
        return mapScores(await getJSON('/api/scores'));
      } catch {
        return window.GLANCE ? { ...window.GLANCE, _live: false } : null;
      }
    },

    async loadDailyBrief() {
      try { return await getJSON('/api/daily-brief'); } catch { return null; }
    },

    async loadMacroBrief() {
      try { return await getJSON('/api/macro-brief'); } catch { return null; }
    },

    async loadHistory(cardId, uiRange) {
      const cfg = HISTORY[cardId];
      if (!cfg) return null;
      const r = RANGE_MAP[uiRange] || '1y';
      try {
        const data = await getJSON(cfg.url(r) + `&d=${new Date().toISOString().slice(0, 10)}`);
        if (cardId === 'equities') {
          const spy = (data.equities || []).find((e) => e.sym === 'SPY');
          return spy ? { values: spy.prices.map(Number), dates: data.dates || [] } : null;
        }
        if (!cfg.field) return null;
        const values = data[cfg.field];
        if (!Array.isArray(values) || !values.length) return null;
        return { values: values.map(Number), dates: data.dates || [] };
      } catch { return null; }
    },
  };

  window.MarketHubData = MarketHubData;
})();
