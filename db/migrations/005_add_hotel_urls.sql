-- Migration 005: Add booking platform URL columns to hotels table
-- Adds three new columns for storing URLs to different booking platforms

ALTER TABLE hotels ADD COLUMN IF NOT EXISTS booking_url VARCHAR(500) DEFAULT NULL;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS tuiamello_url VARCHAR(500) DEFAULT NULL;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS expedia_url VARCHAR(500) DEFAULT NULL;
