# Market Hub — Wiring the kits to live data

Both UI kits (`ui_kits/desktop/` and `ui_kits/mobile/`) render from a single data
object, `window.GLANCE`. In the design-system preview that's the **bundled mock**
(`glance-data.js`). In production, the adapter (`market-hub-adapter.js`) swaps in
**live data from your existing API** — no component changes needed.

## How it works

1. The page loads `glance-data.js` (mock) **then** `market-hub-adapter.js`.
2. Each app shell calls `useGlance()`: it paints the mock instantly, then calls
   `MarketHubData.loadGlance()` and, if `/api/scores` answers, swaps in live data.
3. Each deep-dive chart calls `MarketHubData.loadHistory(cardId, range)`; on success
   it plots the real series and the chart footer flips from **"Sample"** to a glowing
   green **"Live"**. On failure it keeps the synthetic sparkline.

So the same files work in both places. In the preview every request fails fast
(the sandbox can't reach your API) and you see "Sample"; in the app they succeed
and you see "Live".

## To point at production

In `market-hub-adapter.js`, `CONFIG.baseUrl` defaults to `""` (same-origin). If the
kit is served from the same origin as the API (your Cloudflare worker), **there is
nothing to change** — it just works. To test against a remote origin, set:

```js
const CONFIG = { baseUrl: 'https://www.loganbase.com/market-hub', timeoutMs: 4000 };
```

(Cross-origin requires CORS headers on the API.)

## The contract the adapter expects (from your live app's own code)

```
GET /api/scores -> { aggregate, cards }
  aggregate: { glow:'green'|'yellow'|'red', label, posture, score,
               bullish, neutral, bearish, regimeBearish,
               categories:[ { label, weight:0..1, score, glow,
                              cards:[ { status } ] } ] }
  cards: [ { id, title, subtitle, status, delta,
             rows:[ { label, indicator, value, condition, status } ],
             hideIndicator?, allRows?, sectorTable?, details? } ]
```

Per-card chart history (primary plotted field in **bold**):

| Card id      | Endpoint                                   | Field      |
|--------------|--------------------------------------------|------------|
| regime       | `/api/history?symbol=SPY&range=…`          | **vs200**  |
| leadership   | `/api/leadership?range=…`                  | **ratio**  |
| breadth      | `/api/breadth-history?range=…`             | **mmth**   |
| valuations   | `/api/valuations-history?range=…`          | **cape**   |
| yield        | `/api/history?symbol=^TNX&range=…`         | **closes** |
| credit       | `/api/history?symbol=HYG&range=…`          | **closes** |
| globalflows  | `/api/global-flows-history?range=…`        | **regional** |
| sectors      | `/api/sectors?range=…`                     | **cycVsDef** |
| commodities  | `/api/history?symbol=USCI&range=…`         | **closes** |
| equities     | `/api/equities-history?range=…`            | **equities** |

UI range tokens map `1M→1mo · 3M→3mo · 6M→6mo · 1Y→1y · 5Y→5y` (edit `RANGE_MAP` to
add 10Y/20Y).

## What's still mock (by design)

- **Stat boxes** — the API has no dedicated stat-box set, so the adapter surfaces each
  card's top 3 indicators. If you add a `stats` field to `/api/scores`, map it in
  `mapCard()`.
- **Regime-history timeline** — the month-by-month bull/neutral/bear strip is currently
  seeded illustratively. Expose a status history (e.g. `card.regimeHistory: ['bullish', …]`)
  and feed it into `RegimeTimeline` to make it real.

## Files

| File | Role |
|---|---|
| `market-hub-adapter.js` | The adapter. Edit `CONFIG`, `RANGE_MAP`, `HISTORY`, `mapCard()` here. |
| `glance-data.js` | The mock / fallback (`window.GLANCE`). |
| `desktop-parts.jsx` / `Glance.jsx` | Chart components that call `loadHistory`. |
| `desktop-app.jsx` / `Glance.jsx` | App shells that call `loadGlance` via `useGlance()`. |
