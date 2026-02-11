-- Rollback Migration 007: Remove booking_com_data JSONB column from scan_results table
-- This rollback removes the Booking.com data column and its associated indexes

-- Drop the GIN index on the JSONB column
DROP INDEX IF EXISTS idx_scan_results_booking_com_data;

-- Drop the composite index on (scan_id, hotel_id)
DROP INDEX IF EXISTS idx_scan_results_scan_hotel;

-- Remove the booking_com_data column
ALTER TABLE scan_results DROP COLUMN IF EXISTS booking_com_data;
