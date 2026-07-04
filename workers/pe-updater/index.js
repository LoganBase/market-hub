/**
 * Market Hub — PE Updater Worker
 *
 * Runs nightly at 02:00 UTC via Cloudflare Cron Trigger.
 * Fetches current P/E ratios from Yahoo Finance and upserts into D1.
 *
 * Sources:
 *   Japan P/E  — EWJ trailingPE (summaryDetail)  iShares MSCI Japan ETF
 *   US P/E     — SPY trailingPE (summaryDetail)  live benchmark for Japan comparison
 *
 * Manual trigger:
 *   GET https://market-hub-pe-updater.shane-logan.workers.dev/run
 *   Header: Authorization: Bearer <CRON_SECRET>
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── YAHOO FINANCE AUTH (crumb + cookies) ──────────────────────────────────────

async function getYFAuth() {
  // Step 1: visit Yahoo Finance to get session cookies
  const landingRes = await fetch('https://finance.yahoo.com/', {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  // Collect cookies — Workers exposes Set-Cookie as a single joined header
  const rawCookies = landingRes.headers.get('set-cookie') || '';
  const cookies = rawCookies
    .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
    .map(c => c.trim().split(';')[0])
    .filter(Boolean)
    .join('; ');

  // Step 2: fetch crumb using the cookies
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: {
      'User-Agent': UA,
      'Accept': '*/*',
      'Referer': 'https://finance.yahoo.com/',
      'Cookie': cookies,
    },
  });

  if (!crumbRes.ok) return null;
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('{')) return null;  // got HTML/JSON instead of crumb
  return { cookies, crumb };
}

// ── FETCH P/E FROM YF v10 ─────────────────────────────────────────────────────

async function fetchPe(symbol, field, modName, auth) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encoded}` +
              `?modules=${modName}&crumb=${encodeURIComponent(auth.crumb)}`;
  try {
    const res  = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
        'Cookie': auth.cookies,
      },
    });
    const text = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}`, body: text.slice(0, 200) };
    let data;
    try { data = JSON.parse(text); } catch (e) { return { error: 'invalid JSON' }; }
    const detail = data?.quoteSummary?.result?.[0]?.[modName];
    if (!detail) return { error: `no ${modName}`, yfError: data?.quoteSummary?.error };
    const raw = detail[field];
    // Yahoo returns some fields as {raw, fmt} and others as plain numbers
    const val = (raw != null && typeof raw === 'object') ? raw.raw : (typeof raw === 'number' ? raw : null);
    if (val == null) {
      return { error: `"${field}" not in response`, fieldRawValue: JSON.stringify(raw), availableKeys: Object.keys(detail) };
    }
    return { value: Math.round(val * 10) / 10 };
  } catch (e) {
    return { error: e.message };
  }
}

// ── MAIN UPDATE ───────────────────────────────────────────────────────────────

async function runUpdate(env) {
  const today = new Date().toISOString().slice(0, 10);

  if (!env.DB) return { date: today, error: 'D1 binding (DB) not configured', saved: {} };

  const auth = await getYFAuth();
  if (!auth) {
    return { date: today, error: 'Failed to obtain Yahoo Finance crumb', saved: {} };
  }

  const [japanResult, spyResult] = await Promise.all([
    fetchPe('EWJ', 'trailingPE', 'summaryDetail', auth),
    fetchPe('SPY', 'trailingPE', 'summaryDetail', auth),
  ]);
  const results = { date: today, japanRaw: japanResult, spyRaw: spyResult, saved: {} };

  if (japanResult?.value != null) {
    await env.DB.prepare('INSERT OR REPLACE INTO japan_pe_data (date, pe) VALUES (?, ?)')
      .bind(today, japanResult.value).run();
    results.saved.japanPe = japanResult.value;
  }

  if (spyResult?.value != null) {
    await env.DB.prepare('INSERT OR REPLACE INTO forward_pe_data (date, pe) VALUES (?, ?)')
      .bind(today, spyResult.value).run();
    results.saved.spyPe = spyResult.value;
  }

  console.log(`PE update ${today}: Japan=${japanResult?.value}, SPY=${spyResult?.value}`);
  return results;
}

// ── HANDLERS ──────────────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runUpdate(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') {
      return new Response('PE Updater — GET /run with Authorization: Bearer <secret>', { status: 200 });
    }
    const secret = env.CRON_SECRET;
    const auth   = request.headers.get('Authorization') ?? '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    let results;
    try {
      results = await runUpdate(env);
    } catch (err) {
      results = { error: err.message, stack: err.stack?.slice(0, 500) };
    }
    return new Response(JSON.stringify(results, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
