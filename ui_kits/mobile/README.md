# Market Hub — Mobile UI Kit

The **phone** surface of Market Hub: a calm **Daily Glance** you check each morning,
with a tap-through to a **charted deep-dive** for any signal. Designed mobile-first —
the view you reach for daily, while heavier analysis lives on the desktop kit.

## What's here

| File | Role |
|---|---|
| `index.html` | Entry point. Mounts `Glance` inside an iOS device frame (`IOSDevice`, dark). |
| `Glance.jsx` | The app: `Home` (glance) + `DeepDive` (charted detail), plus `HeroGauge`, `CategoryBreadth`, `CardRow`, `DeepChart`. |
| `glance-data.js` | `window.GLANCE` — directional signal data, shared with the desktop kit. |
| `ios-frame.jsx` | iOS device bezel + status bar (`IOSDevice`). |

## The flow

**Home (Daily Glance)** — top to bottom:
1. **Breadth ring** — a segmented donut showing the live bull/neutral/bear split (the
   arcs *are* the breakdown), center reads `7/10 bullish`, with the posture label
   (Risk-On / Neutral / Risk-Off) below.
2. **Category breadth** — one dot per card per category → `2/3 bull` at a glance.
3. **Scorecard list** — each card leads with its name, a sparkline, and its **top 3
   inline KPIs** (value + status dot + label) so you read detail without tapping.

**Deep-dive** — tapping a card goes **straight** to a full-screen charted view (no
intermediate sheet): back button, status badge, signal-colored area chart with a range
toggle (1WK–10Y), stat boxes, and the full indicator table. The active view persists
across reloads (`localStorage: mh-active`).

## Design decisions

- **Directional status only** — `bullish` / `neutral` / `bearish`; color carries meaning
  (green / amber / red). No fabricated 0–10 scores.
- **3 KPIs per card** on the glance face; the rest live in the deep-dive table.
- **Touch targets** ≥ 44px; mono figures for all numbers.

## Relationship to the desktop kit

Shares `glance-data.js` and the same signal/status vocabulary as `ui_kits/desktop/`.
The desktop **Glance** view is the wide cousin of this screen; the desktop
**Workspace** is the analyst surface this intentionally omits on mobile.
