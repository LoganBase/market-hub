-- Market Hub — Database Schema
-- Compatible with SQLite (local seed) and Cloudflare D1 (production)

CREATE TABLE IF NOT EXISTS daily_prices (
  symbol    TEXT    NOT NULL,
  date      TEXT    NOT NULL,   -- YYYY-MM-DD
  open      REAL,
  high      REAL,
  low       REAL,
  close     REAL,
  volume    INTEGER,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS indicators (
  symbol      TEXT    NOT NULL,
  date        TEXT    NOT NULL,
  sma50       REAL,
  sma200      REAL,
  rsi14       REAL,
  roc10       REAL,             -- 10-day rate of change (%)
  vs200_pct   REAL,             -- % distance from 200d SMA
  percentile  REAL,             -- historical percentile rank of vs200_pct
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_prices_symbol_date ON daily_prices (symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_indicators_symbol_date ON indicators (symbol, date DESC);

-- Date-only indexes: /api/scores' loadFromD1 filters by `date >=` across ALL
-- symbols. Without these it full-scans the whole table (~364k rows) instead of
-- ~2k. IMPORTANT: run `ANALYZE;` after any large delete/backfill so the query
-- planner actually chooses these over the (symbol, date) composite index.
CREATE INDEX IF NOT EXISTS idx_prices_date ON daily_prices (date);
CREATE INDEX IF NOT EXISTS idx_indicators_date ON indicators (date);

CREATE TABLE IF NOT EXISTS shiller_data (
  date     TEXT PRIMARY KEY,
  price    REAL,
  earnings REAL,
  dividend REAL,
  cape     REAL
);

CREATE INDEX IF NOT EXISTS idx_shiller_date ON shiller_data (date DESC);

CREATE TABLE IF NOT EXISTS buffett_data (
  date       TEXT PRIMARY KEY,   -- YYYY-MM-DD (quarter start)
  market_cap REAL,               -- billions USD (nonfinancial equities, FRED Z.1)
  gdp        REAL,               -- billions USD (SAAR)
  ratio      REAL                -- market_cap / gdp * 100 (%)
);

CREATE INDEX IF NOT EXISTS idx_buffett_date ON buffett_data (date DESC);

CREATE TABLE IF NOT EXISTS forward_pe_data (
  date TEXT PRIMARY KEY,   -- YYYY-MM-DD (monthly)
  pe   REAL                -- S&P 500 forward P/E estimate
);

CREATE INDEX IF NOT EXISTS idx_forward_pe_date ON forward_pe_data (date DESC);

CREATE TABLE IF NOT EXISTS japan_pe_data (
  date TEXT PRIMARY KEY,   -- YYYY-MM-DD (monthly)
  pe   REAL                -- Nikkei 225 TTM P/E ratio
);

CREATE INDEX IF NOT EXISTS idx_japan_pe_date ON japan_pe_data (date DESC);

-- Market breadth (NYSE), populated by the TradingView webhook. Created ad hoc
-- (kept here for reference). Daily, keyed by date:
--   pct_above_200d — $MMTH (% NYSE stocks above 200d SMA)
--   pct_above_50d  — $MMFI (% NYSE stocks above 50d SMA)
--   adid_nyse      — INDEX:ADDN (NYSE advance-decline difference, signed)
--   adid_nasdaq    — INDEX:ADDQ (Nasdaq advance-decline difference, signed)
CREATE TABLE IF NOT EXISTS market_breadth (
  date           TEXT PRIMARY KEY,   -- YYYY-MM-DD
  pct_above_200d REAL,
  pct_above_50d  REAL,
  adid_nyse      REAL,
  adid_nasdaq    REAL
);

-- S&P 500 trailing-12m earnings per share (Multpl SP500_EARNINGS_MONTH via
-- TradingView webhook + CSV backfill). Monthly. Feeds the earnings-direction
-- signal (6-month rate of change) on the Valuations card and Trend Compass.
CREATE TABLE IF NOT EXISTS sp500_eps (
  date TEXT PRIMARY KEY,   -- YYYY-MM-01 (month start)
  eps  REAL                -- S&P 500 trailing 12-month EPS (USD)
);

CREATE INDEX IF NOT EXISTS idx_sp500_eps_date ON sp500_eps (date DESC);

-- Generic FRED daily series store (Macro Anchor + Trend Compass credit).
-- Keyed by (series_id, date) so multiple FRED series share one table:
--   DFII10          — 10-year TIPS real yield (%)
--   BAMLH0A0HYM2 — ICE BofA US High-Yield option-adjusted spread (%)
--   DFEDTARU        — Federal funds target rate, upper bound (%)
CREATE TABLE IF NOT EXISTS fred_series (
  series_id TEXT NOT NULL,
  date      TEXT NOT NULL,   -- YYYY-MM-DD
  value     REAL,
  PRIMARY KEY (series_id, date)
);

CREATE INDEX IF NOT EXISTS idx_fred_series ON fred_series (series_id, date DESC);
