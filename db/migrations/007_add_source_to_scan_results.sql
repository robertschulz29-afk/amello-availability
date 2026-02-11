-- Migration 007: Add source column to scan_results table
-- Adds a 'source' field to identify the origin of scan results ("booking" or "amello")

-- Add source column with default value "amello" for existing rows
ALTER TABLE scan_results 
ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'amello';

-- Drop the old unique constraint
DO $$ 
BEGIN
  -- Check if the old constraint exists and drop it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'scan_results' 
    AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%scan_id%hotel_id%check_in_date%'
    AND constraint_name NOT LIKE '%source%'
  ) THEN
    ALTER TABLE scan_results DROP CONSTRAINT IF EXISTS scan_results_scan_id_hotel_id_check_in_date_key;
  END IF;
END $$;

-- Add new unique constraint that includes source
-- This allows multiple rows for the same scan/hotel/date but different sources
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'scan_results' 
    AND constraint_name = 'scan_results_scan_id_hotel_id_check_in_date_source_key'
  ) THEN
    ALTER TABLE scan_results 
    ADD CONSTRAINT scan_results_scan_id_hotel_id_check_in_date_source_key 
    UNIQUE(scan_id, hotel_id, check_in_date, source);
  END IF;
END $$;

-- Add index on source column for efficient filtering
CREATE INDEX IF NOT EXISTS idx_scan_results_source ON scan_results(source);

-- Add composite index on (scan_id, source) for common query patterns
CREATE INDEX IF NOT EXISTS idx_scan_results_scan_source ON scan_results(scan_id, source);

