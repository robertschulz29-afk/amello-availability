-- Migration 002: Scans tables (idempotent - handles missing columns)
-- This migration ensures scan_results table has all required columns including 'id'

DO $$ 
BEGIN
  -- Create scans table if it doesn't exist
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
    RAISE NOTICE 'Created scans table';
  END IF;

  -- Create scan_results table if it doesn't exist
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
    RAISE NOTICE 'Created scan_results table';
  ELSE
    -- Table exists, ensure id column exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'id'
    ) THEN
      -- Recreate the table with the id column
      -- First, create a backup of existing data
      CREATE TABLE scan_results_backup AS SELECT * FROM scan_results;
      
      -- Drop the old table
      DROP TABLE scan_results CASCADE;
      
      -- Recreate with id column
      CREATE TABLE scan_results (
        id SERIAL PRIMARY KEY,
        scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
        hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
        check_in_date DATE NOT NULL,
        status VARCHAR(10) NOT NULL,
        response_json JSONB,
        UNIQUE(scan_id, hotel_id, check_in_date)
      );
      
      -- Restore data (id will be auto-generated)
      INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json)
      SELECT scan_id, hotel_id, check_in_date, status, response_json 
      FROM scan_results_backup;
      
      -- Drop backup table
      DROP TABLE scan_results_backup;
      
      RAISE NOTICE 'Added id column to scan_results table and migrated data';
    END IF;
    
    -- Ensure other required columns exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'scan_id'
    ) THEN
      ALTER TABLE scan_results ADD COLUMN scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE;
      RAISE NOTICE 'Added scan_id column to scan_results table';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'hotel_id'
    ) THEN
      ALTER TABLE scan_results ADD COLUMN hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE;
      RAISE NOTICE 'Added hotel_id column to scan_results table';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'check_in_date'
    ) THEN
      ALTER TABLE scan_results ADD COLUMN check_in_date DATE NOT NULL;
      RAISE NOTICE 'Added check_in_date column to scan_results table';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'status'
    ) THEN
      ALTER TABLE scan_results ADD COLUMN status VARCHAR(10) NOT NULL;
      RAISE NOTICE 'Added status column to scan_results table';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'response_json'
    ) THEN
      ALTER TABLE scan_results ADD COLUMN response_json JSONB;
      RAISE NOTICE 'Added response_json column to scan_results table';
    END IF;
    
    -- Ensure unique constraint exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'scan_results_scan_id_hotel_id_check_in_date_key'
      AND contype = 'u'
    ) THEN
      BEGIN
        ALTER TABLE scan_results ADD CONSTRAINT scan_results_scan_id_hotel_id_check_in_date_key 
          UNIQUE(scan_id, hotel_id, check_in_date);
        RAISE NOTICE 'Added unique constraint to scan_results table';
      EXCEPTION
        WHEN duplicate_table THEN
          RAISE NOTICE 'Unique constraint already exists';
        WHEN others THEN
          RAISE NOTICE 'Could not add unique constraint: %', SQLERRM;
      END;
    END IF;
  END IF;
END $$;
