-- Migration 013: Seed scan_sources with amello and booking.com entries

INSERT INTO scan_sources (name, enabled)
VALUES
  ('amello',  true),
  ('booking', true)
ON CONFLICT (name) DO NOTHING;
