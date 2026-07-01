-- Migration 035: Check24 scan source + adult count on scans
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS check24_url VARCHAR(500) DEFAULT NULL;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS adult_count INT DEFAULT 2;
INSERT INTO scan_sources (name, enabled) VALUES ('check24', false) ON CONFLICT (name) DO NOTHING;
