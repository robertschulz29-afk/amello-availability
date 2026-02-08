-- Migration 001: Initial schema (tables already exist in production)
-- This file is a placeholder for the migration runner
-- The actual tables (hotels, scans, scan_results, meta) were created previously

-- Placeholder: Check if tables exist, create only if they don't
DO $$ 
BEGIN
  -- Tables should already exist from previous setup
  -- This is just to prevent migration runner errors
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hotels') THEN
    CREATE TABLE hotels (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      brand VARCHAR(100),
      region VARCHAR(100),
      country VARCHAR(100)
    );
  END IF;
END $$;
