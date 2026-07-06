# Historical Scorecard Chart — Build Plan

Persist the three horizon scores + matrix quadrant daily, backfill multi-year
history from data already in D1, and surface it as a narrated timeline in the
Exec Summary.

## Data model (D1)
```sql
CREATE TABLE IF NOT EXISTS score_history (
  date TEXT PRIMARY KEY,
  speedometer REAL, compass REAL, anchor REAL,
  quadrant TEXT, sizing_factor REAL,
  brief_sentiment INTEGER, brief_sector TEXT, brief_theme TEXT
);
CREATE INDEX IF NOT EXISTS idx_score_history_date ON score_history(date);
```

## Phase 1 — Data layer
Sequenced forward-first (low risk) → backfill (the refactor).

**1a. Forward capture (no scores.js change).**
- `functions/api/score-snapshot.js` — X-Hub-Token auth (mirrors `fred-refresh.js`),
  self-creates `score_history`. Fetches same-origin `/api/scores` + `/api/daily-brief`,
  extracts horizons (speedometer/compass/anchor/quadrant/sizing) + brief sentiment/sector,
  upserts today's row.
- Wire `workers/data-refresh/index.js` to call `/api/score-snapshot` after the refresh batches.
- Add table to `seed/schema.sql`.
- Result: data accrues nightly starting immediately.

**1b. Backfill (as-of refactor).**
- Refactor `functions/api/scores.js` loaders to accept optional `asOf`
  (`WHERE date <= asOf ORDER BY date DESC`; `<= asOf` for percentile histories).
  Live `/api/scores` passes `asOf=null` → behavior byte-identical.
- `seed/seed_score_history.py` — loops historical trading dates, computes horizons
  as-of each date via the shared path, upserts. Instant multi-year depth.
  (brief_* left null pre-brief-era.)

## Phase 2 — History read API
`functions/api/score-history.js` — `?range=3m|6m|1y|all` → `{dates, speedometer,
compass, anchor, quadrants, annotations[]}`. Annotations (quadrant transitions +
local extrema) computed server-side. `Cache-Control: public, max-age=300`.

## Phase 3 — Chart (hero)
Placement: Exec Summary detail (the `HorizonHero` view), new "Score History" section
below the matrix + mini-sparklines under each dial.
- `ScoreHistoryChart` in `ui_kits/desktop/desktop-parts.jsx`: 3 lines (SPD/CMP/ANC,
  dial colors) + quadrant-tinted background bands (reuse regime-timeline band pattern);
  Anchor as a faint shaded band, not a co-equal line. Range selector, hover tooltip,
  "now" marker. Responsive from the start (width:100%/viewBox + useIsMobileD).
- Fetches `/api/score-history` directly (like NyseBreadthChart). Bump `?v=` stamps.

## Phase 4 — Macro-rotation trail (optional)
`MacroRotationTrail` — clone `SectorRRG`; plot (Speedometer, Compass) over N months,
hollow→filled+arrow, dot size = Anchor. Second toggle within the section. Extends the
InteractionMatrix metaphor.

## Phase 5 — Brief themes (optional)
Weekly Anthropic call (reuse ANTHROPIC_API_KEY + macro-brief pipeline) distills the
week's briefs into a 2-4 word `brief_theme`. Chart renders it at inflection markers
("Apr · tariff shock").

## Notes
- Backfill recomputes history with *today's* scoring logic on past data (honest =
  "how the current framework reads history") — footnote it on the chart.
- First deliverable: Phases 1-3. 4 & 5 are additive.
