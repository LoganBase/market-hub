/**
 * Market Hub — IBKR Portfolio Sync (Portfolio Engine, Phase 1)
 * Cloudflare Pages Function: GET /api/portfolio-sync
 *
 * Mirrors the live Interactive Brokers account into D1 via the Flex Web
 * Service — a standalone HTTPS pull API (long-lived token + pre-configured
 * Flex Query): SendRequest returns a reference code, GetStatement (polled;
 * generation is async) returns the XML statement. No gateway, no session.
 *
 * Writes:
 *   portfolio_positions  — live mirror, replaced wholesale each sync
 *   portfolio_snapshots  — append-only daily history ('_ACCOUNT' row = NAV/cash)
 *
 * Honesty rules: on any parse failure the raw XML head is stored in KV
 * (flex-last-error) and NOTHING is written — never a partial mirror.
 *
 * Auth: X-Hub-Token must match env.HUB_TOKEN.
 * Env:  FLEX_TOKEN, FLEX_QUERY_ID (Pages env vars), DB (D1), SUMMARIES (KV).
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
const FLEX_BASE = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

// Parse all occurrences of a (self-closing or open) XML tag's attributes.
// Flex statements are attribute-style XML, so a light regex parse is reliable
// and avoids needing a DOM in the Workers runtime.
export function xmlTags(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const ar = /([\w.]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

export function xmlText(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}

// '20260718' | '2026-07-18' → '2026-07-18'
export function normDate(s) {
  if (!s) return null;
  const t = String(s).replaceAll('-', '');
  return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
}

const num = (v) => (v == null || v === '' ? null : Number(v));

// Extract positions + account summary from a Flex statement.
// Exported for tests; pure.
export function parseFlexStatement(xml) {
  const positions = xmlTags(xml, 'OpenPosition').map(p => ({
    symbol:        p.symbol ?? null,
    description:   p.description ?? null,
    quantity:      num(p.position),
    avg_cost:      num(p.costBasisPrice),
    mark_price:    num(p.markPrice),
    unrealized_pnl: num(p.fifoPnlUnrealized),
    currency:      p.currency ?? 'USD',
    asset_class:   p.assetCategory ?? 'STK',
    con_id:        p.conid != null ? Number(p.conid) : null,
    report_date:   normDate(p.reportDate),
  })).filter(p => p.symbol && p.quantity != null && p.quantity !== 0);

  // NAV/cash: prefer EquitySummaryByReportDateInBase (NAV section); fall back
  // to CashReport ending cash if the query was configured with that instead.
  const eq = xmlTags(xml, 'EquitySummaryByReportDateInBase');
  const eqLast = eq.length ? eq[eq.length - 1] : null;
  const cashRows = xmlTags(xml, 'CashReportCurrency').filter(c => (c.currency ?? '') === 'BASE_SUMMARY');
  const account = {
    nav:  eqLast ? num(eqLast.total) : null,
    cash: eqLast ? num(eqLast.cash) : (cashRows.length ? num(cashRows[0].endingCash) : null),
    report_date: eqLast ? normDate(eqLast.reportDate) : (positions[0]?.report_date ?? null),
  };
  return { positions, account };
}

async function flexFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'market-hub/1.0' } });
  return await res.text();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.headers.get('X-Hub-Token') !== env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const db = env.DB, kv = env.SUMMARIES;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not configured' }), { status: 500, headers: CORS });
  if (!env.FLEX_TOKEN || !env.FLEX_QUERY_ID) {
    return new Response(JSON.stringify({ error: 'FLEX_TOKEN / FLEX_QUERY_ID not configured' }), { status: 500, headers: CORS });
  }

  const jerr = async (stage, detail, xmlHead) => {
    try { if (kv && xmlHead) await kv.put('flex-last-error', JSON.stringify({ at: new Date().toISOString(), stage, detail, xmlHead: xmlHead.slice(0, 2000) }), { expirationTtl: 604800 }); } catch { /* non-fatal */ }
    return new Response(JSON.stringify({ error: `${stage}: ${detail}` }), { status: 502, headers: CORS });
  };

  // 1. SendRequest → reference code
  let sendXml;
  try {
    sendXml = await flexFetch(`${FLEX_BASE}/SendRequest?t=${env.FLEX_TOKEN}&q=${env.FLEX_QUERY_ID}&v=3`);
  } catch (e) { return jerr('SendRequest', e.message); }
  const refCode = xmlText(sendXml, 'ReferenceCode');
  if (!refCode || (xmlText(sendXml, 'Status') ?? '').toLowerCase() !== 'success') {
    return jerr('SendRequest', xmlText(sendXml, 'ErrorMessage') ?? 'no reference code', sendXml);
  }

  // 2. GetStatement — poll; generation is async (code 1019 = still generating)
  let stmtXml = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
    let body;
    try { body = await flexFetch(`${FLEX_BASE}/GetStatement?t=${env.FLEX_TOKEN}&q=${refCode}&v=3`); }
    catch (e) { continue; }
    if (body.includes('<FlexQueryResponse')) { stmtXml = body; break; }
    const code = xmlText(body, 'ErrorCode');
    if (code && code !== '1019') return jerr('GetStatement', `${code}: ${xmlText(body, 'ErrorMessage') ?? ''}`, body);
  }
  if (!stmtXml) return jerr('GetStatement', 'statement not ready after 6 attempts');

  // 3. Parse — refuse to write anything on an empty/failed parse
  const { positions, account } = parseFlexStatement(stmtXml);
  if (!positions.length) return jerr('parse', 'no OpenPosition rows parsed', stmtXml);

  // 4. Write: replace mirror + append today's snapshot rows (single D1 batch = atomic)
  const now = new Date().toISOString();
  const today = account.report_date ?? now.slice(0, 10);
  const stmts = [db.prepare('DELETE FROM portfolio_positions')];
  for (const p of positions) {
    stmts.push(db.prepare(
      `INSERT INTO portfolio_positions (symbol, description, quantity, avg_cost, mark_price, unrealized_pnl, currency, asset_class, con_id, report_date, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(p.symbol, p.description, p.quantity, p.avg_cost, p.mark_price, p.unrealized_pnl, p.currency, p.asset_class, p.con_id, p.report_date ?? today, now));
    stmts.push(db.prepare(
      `INSERT OR REPLACE INTO portfolio_snapshots (date, symbol, quantity, avg_cost, mark_price, market_value, unrealized_pnl, nav, cash)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).bind(today, p.symbol, p.quantity, p.avg_cost, p.mark_price,
      p.mark_price != null && p.quantity != null ? p.mark_price * p.quantity : null, p.unrealized_pnl));
  }
  stmts.push(db.prepare(
    `INSERT OR REPLACE INTO portfolio_snapshots (date, symbol, quantity, avg_cost, mark_price, market_value, unrealized_pnl, nav, cash)
     VALUES (?, '_ACCOUNT', NULL, NULL, NULL, NULL, NULL, ?, ?)`
  ).bind(today, account.nav, account.cash));

  try {
    // Self-create schema on first run (house pattern), then write
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS portfolio_positions (
         symbol TEXT PRIMARY KEY, description TEXT,
         quantity REAL NOT NULL, avg_cost REAL, mark_price REAL, unrealized_pnl REAL,
         currency TEXT DEFAULT 'USD', asset_class TEXT DEFAULT 'STK', con_id INTEGER,
         report_date TEXT NOT NULL, synced_at TEXT NOT NULL)`
    ).run();
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
         date TEXT NOT NULL, symbol TEXT NOT NULL,
         quantity REAL, avg_cost REAL, mark_price REAL, market_value REAL, unrealized_pnl REAL,
         nav REAL, cash REAL, PRIMARY KEY (date, symbol))`
    ).run();
    await db.batch(stmts);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'D1 write failed: ' + e.message }), { status: 500, headers: CORS });
  }

  return new Response(JSON.stringify({
    synced: positions.length, reportDate: today,
    nav: account.nav, cash: account.cash,
    symbols: positions.map(p => p.symbol),
  }), { headers: CORS });
}
