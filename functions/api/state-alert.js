/**
 * Market Hub — State-Change Alert API (R13)
 * Cloudflare Pages Function: GET /api/state-alert
 *
 * Compares the current decision state to the last stored fingerprint and
 * reports what changed. Called nightly by workers/data-refresh after the
 * snapshot; the worker sends the email (it holds the Resend secret) — this
 * endpoint only detects and describes.
 *
 * Fingerprint: effective quadrant (post-hysteresis), pending shift, Entry
 * Window, VIX veto, Anchor zone, and the RRG playbook's over/underweight sets.
 * The fingerprint is stored in KV (SUMMARIES) under alert-state:last; the
 * first run stores a baseline and reports changed:false so it never spams.
 *
 * Auth: X-Hub-Token must match env.HUB_TOKEN.
 */

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export function buildFingerprint(scores) {
  const h = scores?.horizons ?? {};
  const sectors = (scores?.cards ?? []).find(c => c.id === 'sectors');
  const pb = sectors?.playbook ?? [];
  return {
    quadrant:      h.matrix?.quadrant ?? null,
    quadrantLabel: h.matrix?.label ?? null,
    pending:       h.matrix?.pending?.quadrant ?? null,
    pendingLabel:  h.matrix?.pending?.label ?? null,
    entryWindow:   !!h.entryWindow?.open,
    ewDays:        h.entryWindow?.daysOpen ?? 0,
    veto:          !!h.speedometer?.veto,
    anchorZone:    h.anchor?.zone ?? null,
    overweights:   pb.filter(p => p.call === 'overweight').map(p => p.sym).sort(),
    underweights:  pb.filter(p => p.call === 'underweight').map(p => p.sym).sort(),
    scores: {
      speedometer: h.speedometer?.score ?? null,
      compass:     h.compass?.score ?? null,
      anchor:      h.anchor?.score ?? null,
    },
  };
}

export function diffStates(prev, next) {
  if (!prev) return [];
  const changes = [];
  if (prev.quadrant !== next.quadrant) {
    changes.push({ kind: 'quadrant', sev: 'high', text: `Quadrant changed: ${prev.quadrantLabel ?? prev.quadrant} → ${next.quadrantLabel ?? next.quadrant}` });
  }
  if (!prev.entryWindow && next.entryWindow) {
    changes.push({ kind: 'entry-window', sev: 'high', text: `ENTRY WINDOW OPEN — Speedometer oversold with the Compass trend intact (day ${next.ewDays})` });
  }
  if (prev.entryWindow && !next.entryWindow) {
    changes.push({ kind: 'entry-window', sev: 'info', text: 'Entry Window closed' });
  }
  if (!prev.veto && next.veto) {
    changes.push({ kind: 'veto', sev: 'high', text: 'VIX term-structure veto ENGAGED — volatility backwardation; all adds vetoed' });
  }
  if (prev.veto && !next.veto) {
    changes.push({ kind: 'veto', sev: 'info', text: 'VIX veto released' });
  }
  if (prev.anchorZone !== next.anchorZone && next.anchorZone) {
    changes.push({ kind: 'anchor', sev: 'info', text: `Macro Anchor zone: ${prev.anchorZone} → ${next.anchorZone}` });
  }
  if (prev.pending !== next.pending && next.pending) {
    changes.push({ kind: 'pending', sev: 'info', text: `Quadrant shift confirming: → ${next.pendingLabel ?? next.pending}` });
  }
  const setDiff = (a = [], b = []) => ({ added: b.filter(x => !a.includes(x)), removed: a.filter(x => !b.includes(x)) });
  const ow = setDiff(prev.overweights, next.overweights);
  for (const s of ow.added)   changes.push({ kind: 'sector', sev: 'info', text: `Sector call NEW: ${s} overweight (RRG-confirmed)` });
  for (const s of ow.removed) changes.push({ kind: 'sector', sev: 'info', text: `Sector call ENDED: ${s} no longer overweight` });
  const uw = setDiff(prev.underweights, next.underweights);
  for (const s of uw.added)   changes.push({ kind: 'sector', sev: 'info', text: `Sector call NEW: ${s} underweight` });
  for (const s of uw.removed) changes.push({ kind: 'sector', sev: 'info', text: `Sector call ENDED: ${s} no longer underweight` });
  return changes;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.headers.get('X-Hub-Token') !== env.HUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }
  const kv = env.SUMMARIES;
  if (!kv) return new Response(JSON.stringify({ error: 'KV (SUMMARIES) not configured' }), { status: 500, headers: CORS });

  // Fresh scores — cache-busted so we fingerprint the post-refresh state.
  let scores;
  try {
    const url = new URL('/api/scores?_alert=' + Date.now(), request.url);
    scores = await (await fetch(url.toString(), { headers: { Accept: 'application/json' } })).json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'scores fetch failed: ' + err.message }), { status: 502, headers: CORS });
  }
  if (!scores?.horizons) {
    return new Response(JSON.stringify({ error: 'no horizons in scores response' }), { status: 502, headers: CORS });
  }

  const next = buildFingerprint(scores);
  let prev = null;
  try { prev = await kv.get('alert-state:last', 'json'); } catch { /* treat as first run */ }
  const changes = diffStates(prev, next);
  try { await kv.put('alert-state:last', JSON.stringify(next)); } catch { /* next run re-baselines */ }

  const d = scores.horizons.directive ?? null;
  return new Response(JSON.stringify({
    changed: changes.length > 0,
    first: !prev,
    changes,
    state: next,
    directive: d ? {
      verb: d.verb, headline: d.headline,
      where: d.where?.note ?? null, size: d.size?.note ?? null,
      trigger: d.trigger ?? null, receipt: d.receipt ?? null,
      proceeds: d.sleeve?.note ?? null,
    } : null,
    timestamp: scores.timestamp,
  }), { headers: CORS });
}
