-- Daily Briefing.com summaries — processed by email-ingest worker
-- Run: npx wrangler d1 execute market-hub-db --remote --file=seed/migrations/001_daily_briefs.sql

CREATE TABLE IF NOT EXISTS daily_briefs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT    NOT NULL UNIQUE,                          -- YYYY-MM-DD, deduplication key
  bullets     TEXT    NOT NULL,                                 -- JSON array of 5–8 strings
  sentiment   INTEGER NOT NULL CHECK(sentiment BETWEEN -5 AND 5),
  sector      TEXT    NOT NULL,                                 -- controlled vocab
  raw_source  TEXT,                                             -- original email body for reprocessing
  model       TEXT,                                             -- claude model used
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Primary retrieval index — date DESC for "give me the latest" and range queries
CREATE INDEX IF NOT EXISTS idx_daily_briefs_date ON daily_briefs(date DESC);

-- FTS5 virtual table for full-text search across bullets and sector
CREATE VIRTUAL TABLE IF NOT EXISTS daily_briefs_fts USING fts5(
  date,
  bullets,
  sector,
  content='daily_briefs',
  content_rowid='id'
);

-- Keep FTS index in sync on insert
CREATE TRIGGER IF NOT EXISTS daily_briefs_fts_insert
  AFTER INSERT ON daily_briefs
BEGIN
  INSERT INTO daily_briefs_fts(rowid, date, bullets, sector)
  VALUES (new.id, new.date, new.bullets, new.sector);
END;

-- Keep FTS index in sync on update (ON CONFLICT REPLACE triggers an update)
CREATE TRIGGER IF NOT EXISTS daily_briefs_fts_update
  AFTER UPDATE ON daily_briefs
BEGIN
  INSERT INTO daily_briefs_fts(daily_briefs_fts, rowid, date, bullets, sector)
  VALUES ('delete', old.id, old.date, old.bullets, old.sector);
  INSERT INTO daily_briefs_fts(rowid, date, bullets, sector)
  VALUES (new.id, new.date, new.bullets, new.sector);
END;
