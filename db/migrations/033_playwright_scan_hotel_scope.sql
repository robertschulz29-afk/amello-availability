-- Adds optional hotel scoping to Playwright scans.
-- NULL means "all active+bookable hotels" (legacy/unscoped behavior).
ALTER TABLE playwright_scans ADD COLUMN IF NOT EXISTS hotel_ids INT[] NULL;
