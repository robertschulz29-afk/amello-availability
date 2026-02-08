-- Migration 003: Add scan_sources table for configuring different booking sources

CREATE TABLE IF NOT EXISTS scan_sources (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE, -- e.g., 'Booking.com', 'Expedia', 'Hotels.com'
  enabled BOOLEAN DEFAULT true,
  base_url VARCHAR(512), -- Base URL pattern for the booking site
  css_selectors JSONB, -- Store CSS selectors for data extraction as JSON
  rate_limit_ms INTEGER DEFAULT 2000, -- Minimum delay between requests in milliseconds
  user_agent_rotation BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookups of enabled sources
CREATE INDEX IF NOT EXISTS idx_scan_sources_enabled ON scan_sources(enabled) WHERE enabled = true;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_scan_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scan_sources_updated_at
  BEFORE UPDATE ON scan_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_scan_sources_updated_at();
