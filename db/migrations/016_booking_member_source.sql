-- Migration 016: Add booking_member as a separate scan source (disabled by default)
INSERT INTO scan_sources (name, enabled)
VALUES ('booking_member', false)
ON CONFLICT (name) DO NOTHING;
