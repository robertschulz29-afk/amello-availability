-- Migration 006: Add booking_com_url column to hotels table
-- Adds Booking.com hotel search URL for scraping integration

ALTER TABLE hotels ADD COLUMN IF NOT EXISTS booking_com_url TEXT DEFAULT NULL;

-- Add index for query performance on booking_com_url
CREATE INDEX IF NOT EXISTS idx_hotels_booking_com_url ON hotels(booking_com_url);
