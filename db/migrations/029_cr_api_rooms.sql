-- Rename room_imagery to cr_api_rooms and restructure for CR-API room data

ALTER TABLE room_imagery RENAME TO cr_api_rooms;
ALTER TABLE cr_api_rooms RENAME COLUMN room_name TO name;

ALTER TABLE cr_api_rooms DROP CONSTRAINT IF EXISTS room_imagery_hotel_room;
DROP INDEX IF EXISTS idx_room_imagery_hotel;

ALTER TABLE cr_api_rooms ADD COLUMN IF NOT EXISTS room_code   TEXT;
ALTER TABLE cr_api_rooms ADD COLUMN IF NOT EXISTS global_types JSONB;
ALTER TABLE cr_api_rooms ALTER COLUMN image_url DROP NOT NULL;

TRUNCATE cr_api_rooms;

ALTER TABLE cr_api_rooms ADD CONSTRAINT cr_api_rooms_hotel_code UNIQUE (hotel_id, room_code);

CREATE INDEX IF NOT EXISTS idx_cr_api_rooms_hotel ON cr_api_rooms(hotel_id);
