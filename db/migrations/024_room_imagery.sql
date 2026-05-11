CREATE TABLE IF NOT EXISTS room_imagery (
  id          SERIAL PRIMARY KEY,
  hotel_id    INT    NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_name   TEXT   NOT NULL,
  image_url   TEXT   NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT room_imagery_hotel_room UNIQUE (hotel_id, room_name)
);
CREATE INDEX IF NOT EXISTS idx_room_imagery_hotel ON room_imagery(hotel_id);
