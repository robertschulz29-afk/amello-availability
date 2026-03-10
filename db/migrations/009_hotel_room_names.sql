-- Migration 009: hotel_room_names table
-- Caches distinct room names per hotel/source so room-mappings page
-- never has to scan all scan_results rows.
-- Updated once per scan completion (scoped to that scan_id only).

CREATE TABLE IF NOT EXISTS hotel_room_names (
  hotel_id     INT          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  source       VARCHAR(20)  NOT NULL,  -- 'amello' | 'booking'
  room_name    TEXT         NOT NULL,
  last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT hotel_room_names_pkey PRIMARY KEY (hotel_id, source, room_name)
);

CREATE INDEX IF NOT EXISTS idx_hotel_room_names_hotel_source
  ON hotel_room_names(hotel_id, source);

-- One-time backfill from existing scan_results.
-- Picks the most recent green result per hotel+source to limit work.
INSERT INTO hotel_room_names (hotel_id, source, room_name, last_seen_at)
SELECT DISTINCT
  sr.hotel_id,
  sr.source,
  elem->>'name' AS room_name,
  NOW()
FROM scan_results sr,
     jsonb_array_elements(sr.response_json->'rooms') AS elem
WHERE sr.status = 'green'
  AND elem->>'name' IS NOT NULL
ON CONFLICT (hotel_id, source, room_name)
  DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
