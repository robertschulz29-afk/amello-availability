-- Rename price fields in scan_results.response_json to the unified schema:
--   rate.price       → rate.actualPrice  (price you pay — always present)
--   rate.memberPrice → rate.basePrice    (strikethrough/original price — only when discount shown)
--
-- booking:        { price: actual, memberPrice?: strikethrough }
--                 → { actualPrice: actual, basePrice?: strikethrough }
-- booking_member: { price: genius }  (standard was dropped at scrape time for old rows)
--                 → { actualPrice: genius }
-- amello:         { price: single }
--                 → { actualPrice: single }

-- booking: price → actualPrice; memberPrice → basePrice (when present)
UPDATE scan_results
SET response_json = jsonb_set(
  response_json,
  '{rooms}',
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_set(
        room_obj,
        '{rates}',
        (
          SELECT COALESCE(jsonb_agg(
            CASE
              WHEN rate_obj ? 'memberPrice' THEN
                (rate_obj - 'price' - 'memberPrice')
                || jsonb_build_object('actualPrice', rate_obj->'price', 'basePrice', rate_obj->'memberPrice')
              ELSE
                (rate_obj - 'price')
                || jsonb_build_object('actualPrice', rate_obj->'price')
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(room_obj->'rates') AS rate_obj
        )
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(response_json->'rooms') AS room_obj
  )
)
WHERE source = 'booking'
  AND response_json ? 'rooms';

-- booking_member + amello: price → actualPrice
UPDATE scan_results
SET response_json = jsonb_set(
  response_json,
  '{rooms}',
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_set(
        room_obj,
        '{rates}',
        (
          SELECT COALESCE(jsonb_agg(
            (rate_obj - 'price')
            || jsonb_build_object('actualPrice', rate_obj->'price')
          ), '[]'::jsonb)
          FROM jsonb_array_elements(room_obj->'rates') AS rate_obj
        )
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(response_json->'rooms') AS room_obj
  )
)
WHERE source IN ('booking_member', 'amello')
  AND response_json ? 'rooms';
