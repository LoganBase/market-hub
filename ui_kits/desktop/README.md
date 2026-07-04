# Market Hub — Desktop UI Kit

The **laptop-scale** surface of Market Hub's macro framework: a two-pane analyst
**Workspace** with a one-tap **Glance** toggle. This is the *redesign* (look-and-feel
pass), distinct from `ui_kits/dashboard/`, which faithfully recreates the current
live product.

## What's here

| File | Role |
|---|---|
| `index.html` | Entry point. Renders `ToggleShell` — **defaults to Workspace**, toggles to Glance. |
| `desktop-app.jsx` | Layout shells + the two views: `OptionWorkspace` (B), `OptionGlancePage` (C), plus `BreadthBar`, `ScoreTile`, `ToggleShell`, `SoloShell`, `DesktopApp` (3-way switcher). |
| `desktop-parts.jsx` | Shared atoms: `DeepDiveContent`, `DeepChartLg`, `RegimeTimeline`, `StatBoxes`, `IndicatorTable`, `StatusPill`, `SparkD`. |
| `glance-data.js` | `window.GLANCE` — directional (bull/neutral/bear) signal data; no fabricated 0–10 scores. |

## The two views

**Workspace (default)** — left rail lists every signal grouped by category (status
dot + mini sparkline); the right pane holds the selected signal's full deep-dive,
always live. Selection persists across reloads (`localStorage: mh-ws-sel`). This is
the view for methodical, click-down-the-list analysis.

**Glance** — a calm centered column: breadth hero + signal rows with inline KPIs;
click a row to open its dedicated full deep-dive page with a back button. Mirrors the
mobile glance's scan-then-drill rhythm.

The toggle choice persists too (`localStorage: mh-bc`).

## The deep-dive (shared by both views)

`DeepDiveContent` composes, top to bottom:
1. **Charted headline metric** — `DeepChartLg`, signal-colored area chart, range toggle (1M/3M/6M/1Y/5Y, default **1Y**).
2. **Regime history timeline** — `RegimeTimeline`, **14 months** of directional status as colored cells, with regime-change markers and the current month highlighted. Answers *"how did this signal's posture evolve?"*
3. **Stat boxes** — three headline figures.
4. **Flag row** — for Global Flows (country breadth), from `../../assets/flags/`.
5. **Indicator table** — the full KPI set with status dots.

## Design decisions (defaults)

- **Default view:** Workspace (B).
- **Regime timeline span:** 14 months.
- **Chart default range:** 1Y.
- **Status model:** directional only — `bullish` / `neutral` / `bearish`. Color carries
  the meaning (green / amber / red); no invented numeric scores.

## Conventions

- All styling via the system's navy surface ramp + green/amber/red signal palette.
- Mono figures use the system mono stack; labels use Inter.
- Components are cosmetic recreations — wire them to your real `/api` signal feed in production.
