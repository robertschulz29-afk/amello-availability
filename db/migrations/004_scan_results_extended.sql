-- Migration 004: Add scan_results_extended table for storing scraped data from multiple sources

CREATE TABLE IF NOT EXISTS scan_results_extended (
  id SERIAL PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES scan_sources(id) ON DELETE CASCADE,
  check_in_date DATE NOT NULL,
  check_out_date DATE,
  status VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red', 'pending', 'error')),
  scraped_data JSONB, -- Store the full scraped data as JSON
  price NUMERIC(10, 2), -- Optional: extracted price
  currency VARCHAR(3), -- Optional: currency code
  availability_text TEXT, -- Optional: raw availability text
  error_message TEXT, -- Store error details if scraping failed
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Composite unique constraint to prevent duplicate entries
  UNIQUE (scan_id, hotel_id, source_id, check_in_date)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_scan_results_extended_scan_id ON scan_results_extended(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_extended_hotel_id ON scan_results_extended(hotel_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_extended_source_id ON scan_results_extended(source_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_extended_status ON scan_results_extended(status);
CREATE INDEX IF NOT EXISTS idx_scan_results_extended_check_in ON scan_results_extended(check_in_date);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_scan_results_extended_scan_hotel_source 
  ON scan_results_extended(scan_id, hotel_id, source_id);
