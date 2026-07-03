-- Migration 034: Trim scan_hotels snapshot to only what's not derivable from hotels
-- name/brand/region/country are looked up live via a join on hotel_id now.
ALTER TABLE scan_hotels DROP COLUMN IF EXISTS name;
ALTER TABLE scan_hotels DROP COLUMN IF EXISTS brand;
ALTER TABLE scan_hotels DROP COLUMN IF EXISTS region;
ALTER TABLE scan_hotels DROP COLUMN IF EXISTS country;
