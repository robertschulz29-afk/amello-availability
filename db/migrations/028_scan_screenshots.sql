CREATE TABLE IF NOT EXISTS scan_screenshots (
  id SERIAL PRIMARY KEY,
  scan_id INT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id INT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  hotel_code TEXT NOT NULL,
  screenshot_url TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, hotel_id)
);
