/**
 * Market Hub — Card Signal Tracker
 * GET /api/signals
 *
 * Called nightly by the scheduler after /api/refresh.
 * 1. Creates card_signals table if it doesn't exist.
 * 2. Fetches the current card statuses from /api/scores.
 * 3. Writes one signal row per card, dated by the latest SPY price date in
 *    D1 (the data date), not the calendar date (INSERT OR IGNORE — safe to re-run).
 * 4. Fills in 20-trading-day outcomes for pending signals old enough to score.
 *
 * Table schema:
 *   card_signals(card_id, signal_date, status, spy_close, spy_20d, correct)
 *
 * correct: 1 = prediction matched direction, 0 = wrong, NULL = pending or neutral
 */

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS card_signals (
    card_id      TEXT    NOT NULL,
    signal_date  TEXT    NOT NULL,
    status       TEXT    NOT NULL,
    spy_close    REAL,
    spy_20d      REAL,
    correct      INTEGER,
    PRIMARY KEY (card_id, signal_date)
  )`;

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  const token = context.request.headers.get('X-Hub-Token');
  if (!token || token !== context.env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'D1 binding not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    // ── 1. Ensure table exists ────────────────────────────────────────────────
    await db.prepare(INIT_SQL).run();

    const origin = new URL(context.request.url).origin;

    // ── 2. Resolve the data date: the latest SPY close in D1 ─────────────────
    // signal_date must be the market date the card statuses were computed
    // from, not the wall-clock date this endpoint happened to run. /api/scores
    // scores the latest rows in D1, so its statuses belong to that date. Using
    // the calendar date stamped weekend rows whenever the cron (or a manual
    // catch-up) ran on a Saturday/Sunday, carrying Friday's close under the
    // wrong date.
    const spyRow = await db.prepare(
      `SELECT date, close FROM daily_prices WHERE symbol='SPY' ORDER BY date DESC LIMIT 1`
    ).first();
    if (!spyRow?.date) throw new Error('No SPY price data in D1 — refresh has not run');
    const dataDate = spyRow.date;
    const spyClose = spyRow.close ?? null;

    // ── 3. Fetch card statuses (computed from the same latest D1 rows) ──────
    const scoresRes = await fetch(`${origin}/api/scores`);
    if (!scoresRes.ok) throw new Error(`scores fetch failed: HTTP ${scoresRes.status}`);
    const { cards } = await scoresRes.json();
    if (!cards?.length) throw new Error('No cards returned from /api/scores');

    // ── 4. Write the signal row for each card (skip if already written) ─────
    let written = 0;
    for (const card of cards) {
      const { meta } = await db.prepare(
        `INSERT OR IGNORE INTO card_signals (card_id, signal_date, status, spy_close)
         VALUES (?, ?, ?, ?)`
      ).bind(card.id, dataDate, card.status, spyClose).run();
      if (meta.changes > 0) written++;
    }

    // ── 5. Fill outcomes for pending signals old enough to score ──────────────
    const scored = await fillOutcomes(db);

    return new Response(JSON.stringify({
      date: dataDate,
      signalsWritten: written,
      outcomesScored: scored,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// ── Fill 20-trading-day outcomes ──────────────────────────────────────────────
// 20 trading days ≈ 28 calendar days. We look for the first available SPY
// close on or after signal_date + 28 calendar days.
async function fillOutcomes(db) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { results: pending } = await db.prepare(
    `SELECT card_id, signal_date, status, spy_close
     FROM card_signals
     WHERE correct IS NULL AND spy_close IS NOT NULL
       AND status != 'neutral'
       AND signal_date <= ?`
  ).bind(cutoffDate).all();

  let scored = 0;
  for (const row of pending) {
    // Target date: signal_date + 28 calendar days
    const target = new Date(row.signal_date);
    target.setDate(target.getDate() + 28);
    const targetStr = target.toISOString().slice(0, 10);

    // First trading day on or after target
    const { results: spy20Rows } = await db.prepare(
      `SELECT close FROM daily_prices
       WHERE symbol='SPY' AND date >= ?
       ORDER BY date ASC LIMIT 1`
    ).bind(targetStr).all();

    if (!spy20Rows[0]) continue;

    const spy20Close = spy20Rows[0].close;
    const correct = row.status === 'bullish'
      ? (spy20Close > row.spy_close ? 1 : 0)
      : (spy20Close < row.spy_close ? 1 : 0); // bearish

    await db.prepare(
      `UPDATE card_signals SET spy_20d = ?, correct = ?
       WHERE card_id = ? AND signal_date = ?`
    ).bind(spy20Close, correct, row.card_id, row.signal_date).run();
    scored++;
  }

  return scored;
}
