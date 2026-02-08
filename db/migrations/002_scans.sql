-- Migration 002: Scans tables (tables already exist in production)
-- This file is a placeholder for the migration runner
-- The actual tables (scans, scan_results) were created previously

-- Placeholder: Check if tables exist, create only if they don't
DO $$ 
BEGIN
  -- Tables should already exist from previous setup
  -- This is just to prevent migration runner errors
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scans') THEN
    CREATE TABLE scans (
      id SERIAL PRIMARY KEY,
      scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fixed_checkout DATE,
      start_offset INTEGER,
      end_offset INTEGER,
      stay_nights INTEGER,
      timezone VARCHAR(50),
      total_cells INTEGER,
      done_cells INTEGER DEFAULT 0,
      status VARCHAR(20),
      base_checkin DATE,
      days INTEGER
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_results') THEN
    CREATE TABLE scan_results (
      id SERIAL PRIMARY KEY,
      scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
      hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
      check_in_date DATE NOT NULL,
      status VARCHAR(10) NOT NULL,
      response_json JSONB,
      UNIQUE(scan_id, hotel_id, check_in_date)
    );
  END IF;
END $$;
