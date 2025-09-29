-- Persist scans and their per-cell results
-- Note: if your Postgres doesn't have timezone set, we store timestamptz explicitly


CREATE TABLE IF NOT EXISTS scans (
id BIGSERIAL PRIMARY KEY,
scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
fixed_checkout DATE NOT NULL,
start_offset INTEGER NOT NULL,
end_offset INTEGER NOT NULL,
timezone TEXT NOT NULL DEFAULT 'Europe/Berlin'
);


CREATE TABLE IF NOT EXISTS scan_results (
scan_id BIGINT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
departure_date DATE NOT NULL,
status TEXT NOT NULL CHECK (status IN ('green','red')),
PRIMARY KEY (scan_id, hotel_id, departure_date)
);


CREATE INDEX IF NOT EXISTS idx_scan_results_hotel_date ON scan_results(hotel_id, departure_date);
CREATE INDEX IF NOT EXISTS idx_scan_results_scan ON scan_results(scan_id);
