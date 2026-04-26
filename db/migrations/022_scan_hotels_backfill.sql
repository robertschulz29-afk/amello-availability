-- Backfill scan_hotels for existing scans that have no snapshot yet.
-- Uses current hotel state (bookable + active) since historical state is unavailable.
-- Only inserts for scans that have zero snapshot rows to avoid partial double-inserts.

INSERT INTO scan_hotels (scan_id, hotel_id, name, code, brand, region, country, bookable, active)
SELECT s.id, h.id, h.name, h.code, h.brand, h.region, h.country, h.bookable, h.active
FROM scans s
CROSS JOIN hotels h
WHERE h.bookable = true
  AND h.active   = true
  AND NOT EXISTS (
    SELECT 1 FROM scan_hotels sh WHERE sh.scan_id = s.id
  )
ON CONFLICT (scan_id, hotel_id) DO NOTHING;
