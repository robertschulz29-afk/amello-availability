CREATE TABLE IF NOT EXISTS imagery_mappings (
  id                SERIAL PRIMARY KEY,
  hotel_id          INT    NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  imagery_room_name TEXT   NOT NULL,
  scan_room_name    TEXT   NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT imagery_mappings_unique UNIQUE (hotel_id, scan_room_name)
);
CREATE INDEX IF NOT EXISTS idx_imagery_mappings_hotel ON imagery_mappings(hotel_id);
