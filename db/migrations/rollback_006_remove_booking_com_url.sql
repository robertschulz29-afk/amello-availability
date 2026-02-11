-- Rollback Migration 006: Remove booking_com_url column from hotels table
-- This rollback removes the Booking.com URL column and its associated index

-- Drop the index on booking_com_url
DROP INDEX IF EXISTS idx_hotels_booking_com_url;

-- Remove the booking_com_url column
ALTER TABLE hotels DROP COLUMN IF EXISTS booking_com_url;
