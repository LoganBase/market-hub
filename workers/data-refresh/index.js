/**
 * Market Hub — Data Refresh Worker
 *
 * Fires Mon–Fri at 22:00 UTC (6 PM ET) via Cloudflare Cron Trigger.
 * Calls /api/refresh on the Pages site, which fetches any missing trading
 * days from Yahoo Finance and upserts prices + indicators into D1.
 *
 * Required secrets (set via deploy.py or Cloudflare dashboard):
 *   HUB_TOKEN  — matches the HUB_TOKEN in Cloudflare Pages env vars
 *   SITE_URL   — e.g. "https://market.loganbase.com" (no trailing slash)
 *
 * Manual trigger (for catch-up / testing):
 *   GET https://market-hub-data-refresh.<account>.workers.dev/run
 *   Header: Authorization: Bearer <CRON_SECRET>
 */

// Send an alert email via Resend when health check fails.
// Requires RESEND_API_KEY secret and ALERT_EMAIL var (set in Cloudflare Worker env).
async function sendAlert(env, health) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[data-refresh] RESEND_API_KEY not set — skipping email alert');
    return;
  }

  const to      = env.ALERT_EMAIL;
  if (!to) {
    console.warn('[data-refresh] ALERT_EMAIL not configured — skipping email alert');
    return;
  }
  const subject = `⚠️ Market Hub Data Alert — ${health.status?.toUpperCase()} — ${health.data_date}`;

  const staleRows = (health.stale_symbols || [])
    .map(s => `<tr><td style="padding:4px 12px 4px 0;color:#e8edf5">${s.symbol}</td><td style="padding:4px 0;color:#f59e0b">${s.last_date}</td></tr>`)
    .join('');
  const gapRows = (health.gap_dates || [])
    .map(g => `<tr><td style="padding:4px 12px 4px 0;color:#e8edf5">${g.date}</td><td style="padding:4px 0;color:#f59e0b">${g.sym_count} symbols</td></tr>`)
    .join('');
  const lagRows = (health.indicator_lag || [])
    .map(l => `<tr><td style="padding:4px 12px 4px 0;color:#e8edf5">${l.symbol}</td><td style="padding:4px 0;color:#64748b">${l.ind_date ?? 'none'} vs ${l.price_date}</td></tr>`)
    .join('');

  const html = `
<div style="background:#080c14;color:#e8edf5;font-family:system-ui,sans-serif;padding:32px;border-radius:12px;max-width:560px">
  <h2 style="margin:0 0 4px;color:#ef4444">Market Hub — Data Alert</h2>
  <p style="margin:0 0 24px;color:#64748b;font-size:13px">Nightly refresh completed with issues</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="color:#64748b;font-size:12px;padding-bottom:4px">STATUS</td>
        <td style="color:${health.status === 'error' ? '#ef4444' : '#f59e0b'};font-weight:700">${health.status?.toUpperCase()}</td></tr>
    <tr><td style="color:#64748b;font-size:12px;padding-bottom:4px">EXPECTED DATE</td>
        <td style="color:#e8edf5">${health.data_date}</td></tr>
    <tr><td style="color:#64748b;font-size:12px">CHECKED AT</td>
        <td style="color:#64748b;font-size:12px">${health.checked_at}</td></tr>
  </table>

  ${staleRows ? `
  <h3 style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">
    Stale Symbols (${health.stale_symbols.length})
  </h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${staleRows}</table>` : ''}

  ${gapRows ? `
  <h3 style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">
    Incomplete Dates (${health.gap_dates.length})
  </h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${gapRows}</table>` : ''}

  ${lagRows ? `
  <h3 style="margin:0 0 8px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">
    Indicator Lag (${health.indicator_lag.length})
  </h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${lagRows}</table>` : ''}

  <p style="margin:24px 0 0;font-size:11px;color:#334155">
    Market Hub · loganbase.com · <a href="https://market.loganbase.com/api/health" style="color:#3b82f6">View live health status</a>
  </p>
</div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: 'Market Hub <onboarding@resend.dev>', to, subject, html }),
    });
    if (r.ok) {
      console.log('[data-refresh] alert email sent to', to);
    } else {
      const body = await r.text();
      console.error('[data-refresh] Resend error:', r.status, body.slice(0, 200));
    }
  } catch (err) {
    console.error('[data-refresh] failed to send alert email:', err.message);
  }
}

// Call an authenticated hub endpoint and return parsed JSON, or an error object.
async function callHub(url, hubToken) {
  let res;
  try {
    res = await fetch(url, { headers: { 'X-Hub-Token': hubToken } });
  } catch (err) {
    return { error: `network error: ${err.message}`, url };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `HTTP ${res.status}`, body: body.slice(0, 200), url };
  }
  try {
    return await res.json();
  } catch {
    return { error: 'invalid JSON', url };
  }
}

async function runRefresh(env) {
  const hubToken = env.HUB_TOKEN;
  const siteUrl  = (env.SITE_URL || 'https://market.loganbase.com').replace(/\/$/, '');

  if (!hubToken) {
    console.error('HUB_TOKEN not configured — aborting refresh');
    return { error: 'HUB_TOKEN not configured' };
  }

  // Split 85 symbols into three batches of ~28 to stay under Cloudflare's
  // 50 subrequest-per-invocation limit (each symbol calls Yahoo Finance).
  console.log(`[data-refresh] batch 1 (symbols 0-27)`);
  const b1 = await callHub(`${siteUrl}/api/refresh?start=0`, hubToken);

  console.log(`[data-refresh] batch 2 (symbols 28-56)`);
  const b2 = await callHub(`${siteUrl}/api/refresh?start=28`, hubToken);

  console.log(`[data-refresh] batch 3 (symbols 57-84)`);
  const b3 = await callHub(`${siteUrl}/api/refresh?start=57`, hubToken);

  const totalAdded = (b1.totalAdded ?? 0) + (b2.totalAdded ?? 0) + (b3.totalAdded ?? 0);
  const symbols    = [...(b1.symbols ?? []), ...(b2.symbols ?? []), ...(b3.symbols ?? [])];
  console.log(`[data-refresh] refresh done — ${totalAdded} rows added across ${symbols.length} symbols`);

  // Append FRED macro series (real yield, HY OAS, fed funds) for the horizon scores.
  console.log(`[data-refresh] running fred-refresh`);
  const fred = await callHub(`${siteUrl}/api/fred-refresh`, hubToken);
  console.log(`[data-refresh] fred-refresh done — ${fred.error ? 'error: ' + fred.error : 'saved: ' + Object.keys(fred.saved ?? {}).join(', ')}`);

  // Run signals after refresh — records card statuses and scores outcomes.
  console.log(`[data-refresh] running signals`);
  const sig = await callHub(`${siteUrl}/api/signals`, hubToken);
  console.log(`[data-refresh] signals done — wrote: ${sig.signalsWritten ?? '?'}, scored: ${sig.outcomesScored ?? '?'}`);

  // Health check — email an alert only on a real failure (status 'error':
  // D1 unreachable or mass staleness). 'warning' covers benign, expected gaps
  // (market holidays, a stray missing ticker) and must not spam the inbox.
  console.log(`[data-refresh] running health check`);
  const health = await fetch(`${siteUrl}/api/health`).then(r => r.json()).catch(err => ({ status: 'error', error: err.message }));
  console.log(`[data-refresh] health: ${health.status} — stale: ${health.summary?.stale_count ?? '?'}, gaps: ${health.summary?.gap_date_count ?? '?'}`);
  if (health.status === 'error') {
    await sendAlert(env, health);
  }

  return {
    timestamp:      b1.timestamp ?? new Date().toISOString(),
    totalAdded,
    symbols,
    batch1Error:    b1.error,
    batch2Error:    b2.error,
    batch3Error:    b3.error,
    fred,
    signals:        sig,
    health,
  };
}

export default {
  // Cron trigger — fires on schedule defined in wrangler.toml / deploy.py
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env));
  },

  // Manual trigger for catch-up and health checks
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') {
      return new Response(
        'Market Hub Data Refresh Worker\n\nGET /run  with  Authorization: Bearer <CRON_SECRET>\n\nRuns /api/refresh (2 batches) then /api/signals.',
        { status: 200, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    const secret = env.CRON_SECRET;
    const auth   = request.headers.get('Authorization') ?? '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    let result;
    try {
      result = await runRefresh(env);
    } catch (err) {
      result = { error: err.message, stack: err.stack?.slice(0, 500) };
    }

    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  },
};
