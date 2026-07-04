/**
 * Market Hub — Kalshi Near-Term Events API
 * GET /api/kalshi
 *
 * Fetches the next open FOMC and CPI markets from Kalshi's public API.
 * Derives crowd consensus (50th-percentile threshold) for each event.
 * Unauthenticated read-only.
 *
 * Caching: D1 api_cache table, 5-min TTL for live results, 30-sec TTL for
 * fallback (no open markets / rate limited) so the system recovers quickly.
 *
 * Series:
 *   KXFED — Fed funds rate upper bound after each FOMC meeting
 *   KXCPI — CPI MoM threshold markets
 */

const BASE    = 'https://api.elections.kalshi.com/trade-api/v2';
const HEADERS = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; MarketHub/1.0)' };

// Current Fed funds rate upper bound target — update after each FOMC decision
const CURRENT_FFTR = 3.75;

// Fallback constants — used when FRED_API_KEY is absent or FRED is unreachable
const LAST_CPI_MOM   = 0.2;
const LAST_CPI_MONTH = 'May';

const FRED_BASE   = 'https://api.stlouisfed.org/fred/series/observations';
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TTL_LIVE    = 5 * 60;   // 5 min — cache live market data
const TTL_EMPTY   = 2 * 60;   // 2 min — back off when no markets / rate limited

function fredMonth(dateStr) {
  if (!dateStr) return '';
  return MONTH_NAMES[parseInt(dateStr.slice(5, 7), 10) - 1] || '';
}

async function fetchFred(seriesId, apiKey, extraParams = {}) {
  try {
    const url = new URL(FRED_BASE);
    url.searchParams.set('series_id',  seriesId);
    url.searchParams.set('api_key',    apiKey);
    url.searchParams.set('file_type',  'json');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('limit',      '1');
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const { observations = [] } = await res.json();
    const obs = observations[0];
    if (!obs || obs.value === '.' || obs.value === '') return null;
    return { value: parseFloat(obs.value), date: obs.date };
  } catch { return null; }
}

function norm(p) {
  const n = parseFloat(p);
  return isNaN(n) ? null : n > 1 ? n / 100 : n;
}

function strike(ticker) {
  const m = ticker.match(/T(-?\d+\.?\d*)$/);
  return m ? parseFloat(m[1]) : null;
}

function eventMonth(ticker) {
  const m = ticker.match(/-(\d{2})([A-Z]{3})$/);
  if (!m) return '';
  const map = { JAN:'Jan',FEB:'Feb',MAR:'Mar',APR:'Apr',MAY:'May',JUN:'Jun',
                JUL:'Jul',AUG:'Aug',SEP:'Sep',OCT:'Oct',NOV:'Nov',DEC:'Dec' };
  return map[m[2]] || m[2];
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

// D1-backed fetch: checks cache first, calls Kalshi only when stale.
async function fetchNext(seriesTicker, db) {
  const cacheKey = `kalshi:${seriesTicker}`;
  const now = Math.floor(Date.now() / 1000);

  // Check D1 cache
  if (db) {
    try {
      const row = await db.prepare(
        'SELECT value, updated_at FROM api_cache WHERE key = ?'
      ).bind(cacheKey).first();
      if (row) {
        const age = now - row.updated_at;
        const data = JSON.parse(row.value);
        const ttl  = data.length > 0 ? TTL_LIVE : TTL_EMPTY;
        if (age < ttl) return { markets: data, cached: true, age };
      }
    } catch {}
  }

  // Cache miss or stale — fetch from Kalshi
  try {
    const url = `${BASE}/markets?series_ticker=${seriesTicker}&status=open&limit=100`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      // Cache the failure briefly so we don't keep hammering Kalshi
      if (db) {
        try {
          await db.prepare(
            'INSERT INTO api_cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
          ).bind(cacheKey, '[]', now).run();
        } catch {}
      }
      return { markets: [], httpStatus: res.status };
    }
    const body = await res.json();
    const markets = body.markets || body.data || [];
    let result = [];
    if (markets.length) {
      markets.sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
      const evt = markets[0].event_ticker;
      result = markets.filter(m => m.event_ticker === evt);
    }
    // Write to D1 (live result OR empty — empty has short TTL so it retries soon)
    if (db) {
      try {
        await db.prepare(
          'INSERT INTO api_cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        ).bind(cacheKey, JSON.stringify(result), now).run();
      } catch {}
    }
    return { markets: result };
  } catch (e) {
    return { markets: [], error: e.message };
  }
}

function parseFed(markets, currentRate = CURRENT_FFTR) {
  const rows = markets
    .map(m => {
      const mid = (parseFloat(m.yes_bid ?? m.yes_bid_dollars) + parseFloat(m.yes_ask ?? m.yes_ask_dollars)) / 2;
      const raw = m.last_price ?? m.last_price_dollars ?? (isNaN(mid) ? null : mid);
      return { s: strike(m.ticker), p: norm(raw), t: m.close_time, evt: m.event_ticker };
    })
    .filter(r => r.s !== null && r.p !== null)
    .sort((a, b) => a.s - b.s);

  if (!rows.length) return null;

  const floor = [...rows].reverse().find(r => r.p >= 0.50);
  if (!floor) return null;

  const implied    = floor.s;
  const upperRow   = rows.find(r => r.s === implied + 0.25);
  const pUpper     = upperRow ? upperRow.p : 0;
  const confidence = Math.round((floor.p - pUpper) * 100);
  const action     = implied > currentRate + 0.01 ? 'Hike'
                   : implied < currentRate - 0.01 ? 'Cut'
                   : 'Hold';

  return {
    label:        'FOMC Rate',
    date:         fmtDate(rows[0].t),
    closeTime:    rows[0].t,
    consensus:    `${implied.toFixed(2)}%`,
    action,
    unit:         '',
    confidence:   Math.min(confidence, 99),
    type:         'fomc',
    currentRate,
    distribution: rows.filter(r => r.p > 0.01).map(r => ({ rate: r.s, prob: Math.round(r.p * 100) })),
  };
}

function parseCPI(markets, lastActual = { value: LAST_CPI_MOM, month: LAST_CPI_MONTH }) {
  const month = markets.length ? eventMonth(markets[0].event_ticker) : '';
  const rows = markets
    .map(m => {
      const mid = (parseFloat(m.yes_bid ?? m.yes_bid_dollars) + parseFloat(m.yes_ask ?? m.yes_ask_dollars)) / 2;
      const raw = m.last_price ?? m.last_price_dollars ?? (isNaN(mid) ? null : mid);
      return { s: strike(m.ticker), p: norm(raw), t: m.close_time };
    })
    .filter(r => r.s !== null && r.p !== null)
    .sort((a, b) => b.s - a.s);

  if (!rows.length) return null;

  const median = rows.find(r => r.p >= 0.50);
  if (!median) return null;

  const sign = median.s > 0 ? '+' : '';
  return {
    label:      `${month} CPI`,
    date:       fmtDate(rows[0].t),
    closeTime:  rows[0].t,
    consensus:  `~${sign}${median.s.toFixed(1)}%`,
    action:     '',
    unit:       'MoM',
    confidence: Math.round(median.p * 100),
    type:       'cpi',
    lastActual,
  };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }

  try {
    const db      = context.env.DB || null;
    const fredKey = context.env.FRED_API_KEY;

    const [fedRaw, cpiRaw, fredRate, fredCpi] = await Promise.all([
      fetchNext('KXFED', db),
      fetchNext('KXCPI', db),
      fredKey ? fetchFred('DFEDTARU', fredKey) : Promise.resolve(null),
      fredKey ? fetchFred('CPIAUCSL',  fredKey, { units: 'pch' }) : Promise.resolve(null),
    ]);

    const fedMarkets = fedRaw.markets;
    const cpiMarkets = cpiRaw.markets;
    const _debug = {
      fed: { cached: fedRaw.cached, age: fedRaw.age, httpStatus: fedRaw.httpStatus, count: fedMarkets.length, error: fedRaw.error },
      cpi: { cached: cpiRaw.cached, age: cpiRaw.age, httpStatus: cpiRaw.httpStatus, count: cpiMarkets.length, error: cpiRaw.error },
    };

    const currentRate = fredRate ? fredRate.value : CURRENT_FFTR;
    const lastActual  = fredCpi
      ? { value: fredCpi.value, month: fredMonth(fredCpi.date) }
      : { value: LAST_CPI_MOM, month: LAST_CPI_MONTH };

    const fedResult = parseFed(fedMarkets, currentRate) || {
      label: 'FOMC Rate', date: 'Between Meetings', closeTime: null,
      consensus: `${currentRate.toFixed(2)}%`, action: 'Hold', unit: '',
      confidence: 0, type: 'fomc', currentRate, distribution: [],
    };

    const sign = lastActual.value >= 0 ? '+' : '';
    const cpiResult = parseCPI(cpiMarkets, lastActual) || {
      label: `${lastActual.month} CPI`, date: 'Markets Pending', closeTime: null,
      consensus: `${sign}${lastActual.value.toFixed(1)}%`, action: '', unit: 'MoM actual',
      confidence: 0, type: 'cpi', lastActual,
    };

    const events = [cpiResult, fedResult]
      .sort((a, b) => (a.closeTime && b.closeTime) ? new Date(a.closeTime) - new Date(b.closeTime) : a.closeTime ? -1 : 1);

    return new Response(JSON.stringify({ events, timestamp: new Date().toISOString(), source: 'kalshi', _debug }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ events: [], error: err.message, source: 'kalshi' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
  }
}
