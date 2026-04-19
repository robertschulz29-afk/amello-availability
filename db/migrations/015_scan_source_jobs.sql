-- Migration 015: per-source job tracking
-- Each scan gets one row per enabled source with independent progress counters.
-- This replaces the shared done_cells/total_cells approach and makes sources
-- fully independent. Adding a new source = adding a new sub-route + job row.

CREATE TABLE IF NOT EXISTS scan_source_jobs (
  id           SERIAL PRIMARY KEY,
  scan_id      INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  source       TEXT    NOT NULL,           -- 'amello', 'booking', etc.
  total_cells  INTEGER NOT NULL DEFAULT 0,
  done_cells   INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','error','cancelled')),
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, source)
);

CREATE INDEX IF NOT EXISTS idx_ssj_scan_id ON scan_source_jobs(scan_id);
CREATE INDEX IF NOT EXISTS idx_ssj_status  ON scan_source_jobs(status);
