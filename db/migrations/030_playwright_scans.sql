CREATE TABLE playwright_scans (
  id              SERIAL PRIMARY KEY,
  check_in        DATE NOT NULL,
  take_screenshot BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'running',
  total           INT NOT NULL DEFAULT 0,
  processed       INT NOT NULL DEFAULT 0,
  errors          INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE TABLE playwright_scan_results (
  id             SERIAL PRIMARY KEY,
  scan_id        INT NOT NULL REFERENCES playwright_scans(id) ON DELETE CASCADE,
  hotel_id       INT NOT NULL REFERENCES hotels(id),
  hotel_code     TEXT NOT NULL,
  occupancy      TEXT NOT NULL,
  rooms          JSONB,
  screenshot_url TEXT,
  error          TEXT,
  scanned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, hotel_id, occupancy)
);

CREATE INDEX idx_playwright_scan_results_scan_id ON playwright_scan_results(scan_id);
