/**
 * Market Hub — Briefing.com Email Ingest Worker
 *
 * Triggered by Cloudflare Email Routing when a Briefing.com daily update arrives.
 * Pipeline:
 *   1. Validate sender domain
 *   2. Parse raw email with postal-mime
 *   3. Send body to Claude (Haiku) for structured extraction
 *   4. Upsert result into D1 daily_briefs table
 *   5. Forward original email to destination inbox
 *
 * Deploy:
 *   cd workers/email-ingest && npm install && npx wrangler deploy
 *
 * Secret:
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *
 * Email Routing (Cloudflare dashboard):
 *   Email > Email Routing > Routes
 *   Add rule: from *@briefing.com → action: Send to Worker → market-hub-email-ingest
 */

import PostalMime from 'postal-mime';

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ALLOWED_DOMAIN   = 'briefing.com';
const ANTHROPIC_URL    = 'https://api.anthropic.com/v1/messages';
const MODEL            = 'claude-haiku-4-5-20251001';
const MAX_BODY_CHARS   = 8_000;   // chars sent to Claude (cost control)
const MAX_SOURCE_CHARS = 50_000;  // chars stored in D1 raw_source

const SECTOR_VOCAB = [
  'Equities', 'Rates', 'Fed/Policy', 'Energy', 'Financials',
  'Commodities', 'Credit', 'FX/Dollar', 'Macro/Data', 'Geopolitics',
];

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial market analyst extracting structured data from daily Briefing.com market updates.

Return ONLY a valid JSON object. No markdown. No code fences. No explanation. No introductory text. Just the raw JSON.

Required format:
{
  "bullets": ["string", "string"],
  "sentiment": 0,
  "sector": "string"
}

Rules:
- bullets: array of 5–8 strings, ordered by market significance (highest first). Each is one complete sentence under 25 words. Focus on: price action, key catalysts, Fed/policy signals, and forward-looking implications. No redundancy between bullets.
- sentiment: single integer from -5 to +5 reflecting the net impact on US equity markets for this session.
  -5 = extreme panic/crash day
  -3 = clearly bearish (meaningful losses, risk-off)
  -1 = slightly bearish (modest declines, mild caution)
   0 = flat or genuinely mixed
  +1 = slightly bullish (modest gains, risk-on lean)
  +3 = clearly bullish (solid rally, broad participation)
  +5 = extreme euphoria/surge day
- sector: the single dominant theme driving today's market. Must be EXACTLY one of:
  Equities | Rates | Fed/Policy | Energy | Financials | Commodities | Credit | FX/Dollar | Macro/Data | Geopolitics

Return ONLY the JSON object. Nothing else.`;

// ── HELPERS ───────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractDate(parsed) {
  const etFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' });
  if (parsed.date) {
    const d = new Date(parsed.date);
    if (!isNaN(d)) return etFmt.format(d);
  }
  return etFmt.format(new Date());
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default {
  async email(message, env, ctx) {
    try {
      // 1. Validate sender before doing any work
      const from = (message.from ?? '').toLowerCase();
      if (!from.includes(ALLOWED_DOMAIN)) {
        console.log(`Ignored email from: ${from}`);
        return;
      }

      // 2. Read raw stream into buffer FIRST — message.raw is a ReadableStream
      //    that can only be consumed once; forward() must come after to avoid locking it.
      const raw    = await new Response(message.raw).arrayBuffer();
      const parsed = await new PostalMime().parse(raw);

      // Forward to inbox — after reading raw so the stream is already captured
      try {
        if (!env.FORWARD_TO) throw new Error('FORWARD_TO env var not configured');
        await message.forward(env.FORWARD_TO);
      } catch (fwdErr) {
        console.error('Forward failed:', fwdErr);
      }

      // Filter to Close Update only — ignore Morning and Midday emails
      const subject = (parsed.subject ?? '').toLowerCase();
      if (!subject.includes('close')) {
        console.log(`Ignored non-close email: "${parsed.subject}"`);
        return;
      }

      // 3. Extract plain text body
      let body = parsed.text?.trim() ?? '';
      if (!body && parsed.html) body = stripHtml(parsed.html);
      if (body.length < 100) {
        console.error('Body too short — skipping');
        return;
      }

      const date = extractDate(parsed);
      console.log(`Processing brief for ${date} (${body.length} chars)`);

      // 4. Call Claude
      const claudeRes = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-api-key':       env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: 1024,
          system:     SYSTEM_PROMPT,
          messages: [{
            role:    'user',
            content: `Daily market update for ${date}:\n\n${body.slice(0, MAX_BODY_CHARS)}`,
          }],
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        console.error('Claude API error:', claudeRes.status, err);
        return;
      }

      const claudeData = await claudeRes.json();
      const rawText    = claudeData.content?.[0]?.text ?? '';

      // 5. Parse JSON — with fallback extraction if Claude added any wrapper
      let result;
      try {
        result = JSON.parse(rawText);
      } catch {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (!match) { console.error('No JSON found in response:', rawText.slice(0, 200)); return; }
        result = JSON.parse(match[0]);
      }

      // 6. Validate fields
      const { bullets, sentiment, sector } = result;

      if (!Array.isArray(bullets) || bullets.length < 1 || bullets.length > 8) {
        console.error('Invalid bullets array:', bullets);
        return;
      }
      if (!Number.isInteger(sentiment) || sentiment < -5 || sentiment > 5) {
        console.error('Invalid sentiment:', sentiment);
        return;
      }
      if (!SECTOR_VOCAB.includes(sector)) {
        console.error('Invalid sector:', sector, '— expected one of:', SECTOR_VOCAB.join(', '));
        return;
      }

      // 7. Upsert into D1 — ON CONFLICT replaces so re-processing a day is safe
      await env.DB.prepare(`
        INSERT INTO daily_briefs (date, bullets, sentiment, sector, raw_source, model)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          bullets    = excluded.bullets,
          sentiment  = excluded.sentiment,
          sector     = excluded.sector,
          raw_source = excluded.raw_source,
          model      = excluded.model,
          created_at = datetime('now')
      `).bind(
        date,
        JSON.stringify(bullets),
        sentiment,
        sector,
        body.slice(0, MAX_SOURCE_CHARS),
        MODEL,
      ).run();

      console.log(`Stored brief: date=${date} sentiment=${sentiment} sector=${sector} bullets=${bullets.length}`);

    } catch (err) {
      console.error('Email worker unhandled error:', err?.message ?? err);
    }
  },
};
