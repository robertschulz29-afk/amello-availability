-- Migration 007: Add scrape_logs table for monitoring and logging scrape attempts

CREATE TABLE IF NOT EXISTS scrape_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
  hotel_name VARCHAR(255),
  scrape_status VARCHAR(50) NOT NULL CHECK (scrape_status IN ('success', 'error', 'timeout', 'block', 'manual_review')),
  http_status INTEGER,
  delay_ms INTEGER,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  user_agent TEXT,
  reason TEXT,
  response_time_ms INTEGER,
  session_id VARCHAR(100),
  url TEXT,
  check_in_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_scrape_logs_scan_timestamp ON scrape_logs(scan_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_status ON scrape_logs(scrape_status);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_hotel_status ON scrape_logs(hotel_id, scrape_status);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_timestamp ON scrape_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_scan_id ON scrape_logs(scan_id);
