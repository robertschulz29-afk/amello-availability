-- Migration 014: Store active sources on each scan record

ALTER TABLE scans ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '["amello","booking"]';
