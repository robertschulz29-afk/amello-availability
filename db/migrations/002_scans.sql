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
      BEGIN
        CREATE TABLE scan_results_backup AS SELECT * FROM scan_results;
        
        -- Verify backup was created successfully
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_results_backup') THEN
          RAISE EXCEPTION 'Failed to create backup table';
        END IF;
        
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
        -- Order by existing columns to ensure deterministic id assignment
        INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json)
        SELECT scan_id, hotel_id, check_in_date, status, response_json 
        FROM scan_results_backup
        ORDER BY scan_id, hotel_id, check_in_date;
        
        -- Drop backup table
        DROP TABLE scan_results_backup;
        
        RAISE NOTICE 'Added id column to scan_results table and migrated data';
      EXCEPTION
        WHEN others THEN
          -- If anything fails, restore from backup if it exists
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_results_backup') THEN
            DROP TABLE IF EXISTS scan_results;
            ALTER TABLE scan_results_backup RENAME TO scan_results;
            RAISE NOTICE 'Migration failed, restored from backup. Error: %', SQLERRM;
          END IF;
          RAISE;
      END;
    END IF;
    
    -- Ensure unique constraint exists (only check if id column exists)
    -- Check by columns rather than constraint name for robustness
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'scan_results' AND column_name = 'id'
    ) AND NOT EXISTS (
      SELECT 1 
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu 
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.table_name = 'scan_results' 
        AND tc.constraint_type = 'UNIQUE'
        AND EXISTS (
          SELECT 1 FROM information_schema.constraint_column_usage
          WHERE constraint_name = tc.constraint_name
            AND table_name = 'scan_results'
            AND column_name IN ('scan_id', 'hotel_id', 'check_in_date')
          GROUP BY constraint_name
          HAVING COUNT(*) = 3
        )
    ) THEN
      BEGIN
        ALTER TABLE scan_results ADD CONSTRAINT scan_results_scan_id_hotel_id_check_in_date_key 
          UNIQUE(scan_id, hotel_id, check_in_date);
        RAISE NOTICE 'Added unique constraint to scan_results table';
      EXCEPTION
        WHEN duplicate_object THEN
          RAISE NOTICE 'Unique constraint already exists';
        WHEN others THEN
          RAISE NOTICE 'Could not add unique constraint: %', SQLERRM;
      END;
    END IF;
  END IF;
END $$;
