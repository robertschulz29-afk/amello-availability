-- Migration 008: Add 'cancelled' status support for scans
-- This migration is idempotent and can be safely run multiple times

DO $$ 
BEGIN
  -- The scans.status column is already VARCHAR(20), so it can hold 'cancelled' without schema changes
  -- This migration is primarily for documentation purposes
  -- No actual schema change needed as VARCHAR(20) already supports any status string
  
  RAISE NOTICE 'Status column already supports cancelled status (VARCHAR(20))';
  
  -- Optionally, we could add a CHECK constraint to limit valid statuses, but that would be breaking
  -- For now, we'll just document that 'cancelled' is a valid status value
  
END $$;
