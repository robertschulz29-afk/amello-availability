-- Migration 021: Snapshot hotels at scan creation time
CREATE TABLE IF NOT EXISTS scan_hotels (
  scan_id   INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id  INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name      VARCHAR(255) NOT NULL,
  code      VARCHAR(50)  NOT NULL,
  brand     VARCHAR(100),
  region    VARCHAR(100),
  country   VARCHAR(100),
  bookable  BOOLEAN NOT NULL DEFAULT false,
  active    BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (scan_id, hotel_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_hotels_scan_id ON scan_hotels(scan_id);
