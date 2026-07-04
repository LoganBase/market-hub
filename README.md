# Market Hub

Macro dashboard tracking the economy to help make informed investment decisions.
Served at **market.loganbase.com** (Cloudflare Pages).

- `index.html` — desktop app entry (adaptive: phones redirect to `/mobile/`)
- `ui_kits/desktop`, `ui_kits/mobile` — React kits (CDN React + Babel)
- `mobile/` — mobile app
- `functions/api/` — Cloudflare Pages Functions (the API)
- `workers/` — scheduled/webhook Workers (data-refresh, tv-webhook, pe-updater, email-ingest)
- `seed/` — one-time D1 backfill scripts
