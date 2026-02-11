-- Migration 006: Add booking_com_data JSONB column to scan_results table
-- Stores extracted Booking.com data with structure for rooms, rates, prices, and scrape status
-- Note: Uses existing booking_url column from hotels table (added in migration 005)

ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS booking_com_data JSONB DEFAULT NULL;

-- Add composite index on (scan_id, hotel_id) for query performance
-- This index is particularly useful for queries that need to look up scan results 
-- for a specific scan and hotel combination
CREATE INDEX IF NOT EXISTS idx_scan_results_scan_hotel ON scan_results(scan_id, hotel_id);

-- Optional: Add a GIN index on the JSONB column for efficient queries on JSON content
-- This allows efficient queries like: WHERE booking_com_data @> '{"scrape_status": "success"}'
CREATE INDEX IF NOT EXISTS idx_scan_results_booking_com_data ON scan_results USING GIN (booking_com_data);
