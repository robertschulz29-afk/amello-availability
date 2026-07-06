-- ============================================================
-- init.sql — Full database schema (consolidated from migrations 001–035)
-- Run this on a fresh PostgreSQL database to set up all tables.
-- ============================================================

-- ─── hotels ─────────────────────────────────────────────────
CREATE TABLE hotels (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  code          VARCHAR(50) NOT NULL UNIQUE,
  brand         VARCHAR(100),
  region        VARCHAR(100),
  country       VARCHAR(100),
  base_image    TEXT,
  bookable      BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  booking_url   VARCHAR(500) DEFAULT NULL,
  tuiamello_url VARCHAR(500) DEFAULT NULL,
  expedia_url   VARCHAR(500) DEFAULT NULL,
  check24_url   VARCHAR(500) DEFAULT NULL,
  brand_url     VARCHAR(500) DEFAULT NULL,
  "globalTypes" TEXT
);

-- ─── scans ──────────────────────────────────────────────────
CREATE TABLE scans (
  id               SERIAL PRIMARY KEY,
  scanned_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fixed_checkout   DATE,
  start_offset     INTEGER,
  end_offset       INTEGER,
  stay_nights      INTEGER,
  timezone         VARCHAR(50),
  total_cells      INTEGER,
  done_cells       INTEGER DEFAULT 0,
  status           VARCHAR(20),
  base_checkin     DATE,
  days             INTEGER,
  sources          JSONB NOT NULL DEFAULT '["amello","booking"]',
  store_screenshot BOOLEAN NOT NULL DEFAULT FALSE,
  adult_count      INT DEFAULT 2
);

-- ─── scan_results ───────────────────────────────────────────
CREATE TABLE scan_results (
  id               SERIAL PRIMARY KEY,
  scan_id          INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id         INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  check_in_date    DATE NOT NULL,
  status           VARCHAR(10) NOT NULL,
  response_json    JSONB,
  booking_com_data JSONB DEFAULT NULL,
  source           VARCHAR(20) DEFAULT 'amello',
  CONSTRAINT scan_results_unique_per_source UNIQUE(scan_id, hotel_id, source, check_in_date)
);

CREATE INDEX idx_scan_results_scan_hotel ON scan_results(scan_id, hotel_id);
CREATE INDEX idx_scan_results_booking_com_data ON scan_results USING GIN (booking_com_data);
CREATE INDEX idx_scan_results_source ON scan_results(source);
CREATE INDEX idx_scan_results_scan_source ON scan_results(scan_id, source);

-- ─── scan_sources ───────────────────────────────────────────
CREATE TABLE scan_sources (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(255) NOT NULL UNIQUE,
  enabled             BOOLEAN DEFAULT true,
  base_url            VARCHAR(512),
  css_selectors       JSONB,
  rate_limit_ms       INTEGER DEFAULT 2000,
  user_agent_rotation BOOLEAN DEFAULT true,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scan_sources_enabled ON scan_sources(enabled) WHERE enabled = true;

CREATE OR REPLACE FUNCTION update_scan_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scan_sources_updated_at
  BEFORE UPDATE ON scan_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_scan_sources_updated_at();

-- ─── scan_results_extended ──────────────────────────────────
CREATE TABLE scan_results_extended (
  id                SERIAL PRIMARY KEY,
  scan_id           INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id          INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  source_id         INTEGER NOT NULL REFERENCES scan_sources(id) ON DELETE CASCADE,
  check_in_date     DATE NOT NULL,
  check_out_date    DATE,
  status            VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red', 'pending', 'error')),
  scraped_data      JSONB,
  price             NUMERIC(10, 2),
  currency          VARCHAR(3),
  availability_text TEXT,
  error_message     TEXT,
  scraped_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scan_id, hotel_id, source_id, check_in_date)
);

CREATE INDEX idx_scan_results_extended_scan_id ON scan_results_extended(scan_id);
CREATE INDEX idx_scan_results_extended_hotel_id ON scan_results_extended(hotel_id);
CREATE INDEX idx_scan_results_extended_source_id ON scan_results_extended(source_id);
CREATE INDEX idx_scan_results_extended_status ON scan_results_extended(status);
CREATE INDEX idx_scan_results_extended_check_in ON scan_results_extended(check_in_date);
CREATE INDEX idx_scan_results_extended_scan_hotel_source ON scan_results_extended(scan_id, hotel_id, source_id);

-- ─── room_names ─────────────────────────────────────────────
CREATE TABLE room_names (
  id           SERIAL       PRIMARY KEY,
  hotel_id     INT          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  source       VARCHAR(20)  NOT NULL,
  room_name    TEXT         NOT NULL,
  last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT room_names_hotel_source_name_unique UNIQUE (hotel_id, source, room_name)
);

CREATE INDEX idx_room_names_hotel_source ON room_names(hotel_id, source);

-- ─── global_types_categories ────────────────────────────────
CREATE TABLE global_types_categories (
  id                   BIGSERIAL PRIMARY KEY,
  global_type_category TEXT NOT NULL
);

-- ─── global_type_collector ──────────────────────────────────
CREATE TABLE global_type_collector (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  type_category_id BIGINT REFERENCES global_types_categories(id)
);

-- ─── global_types ───────────────────────────────────────────
CREATE TABLE global_types (
  id               BIGSERIAL PRIMARY KEY,
  global_type      TEXT,
  global_type_label TEXT,
  group_id         BIGINT REFERENCES global_type_collector(id)
);

-- ─── users ──────────────────────────────────────────────────
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email         VARCHAR(255) UNIQUE,
  role          VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','analyst','viewer')),
  status        VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','active','inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── scan_source_jobs ───────────────────────────────────────
CREATE TABLE scan_source_jobs (
  id          SERIAL PRIMARY KEY,
  scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  source      TEXT    NOT NULL,
  total_cells INTEGER NOT NULL DEFAULT 0,
  done_cells  INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','error','cancelled')),
  error_msg   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, source)
);

CREATE INDEX idx_ssj_scan_id ON scan_source_jobs(scan_id);
CREATE INDEX idx_ssj_status  ON scan_source_jobs(status);

-- ─── app_settings ───────────────────────────────────────────
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── scan_hotels (snapshot at scan creation) ────────────────
CREATE TABLE scan_hotels (
  scan_id  INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  code     VARCHAR(50)  NOT NULL,
  bookable BOOLEAN NOT NULL DEFAULT false,
  active   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (scan_id, hotel_id)
);

CREATE INDEX idx_scan_hotels_scan_id ON scan_hotels(scan_id);

-- ─── cr_api_rooms (rooms from CR-API) ───────────────────────
CREATE TABLE cr_api_rooms (
  id           SERIAL PRIMARY KEY,
  hotel_id     INT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  image_url    TEXT,
  room_code    TEXT,
  global_types JSONB,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr_api_rooms_hotel_code UNIQUE (hotel_id, room_code)
);

CREATE INDEX idx_cr_api_rooms_hotel ON cr_api_rooms(hotel_id);

-- ─── scan_screenshots ───────────────────────────────────────
CREATE TABLE scan_screenshots (
  id             SERIAL PRIMARY KEY,
  scan_id        INT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  hotel_id       INT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  hotel_code     TEXT NOT NULL,
  screenshot_url TEXT NOT NULL,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, hotel_id)
);

-- ─── playwright_scans ───────────────────────────────────────
CREATE TABLE playwright_scans (
  id              SERIAL PRIMARY KEY,
  check_in        DATE NOT NULL,
  take_screenshot BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'running',
  total           INT NOT NULL DEFAULT 0,
  processed       INT NOT NULL DEFAULT 0,
  errors          INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  locked_until    TIMESTAMPTZ,
  retry_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  hotel_ids       INT[] NULL
);

-- ─── playwright_scan_results ────────────────────────────────
CREATE TABLE playwright_scan_results (
  id             SERIAL PRIMARY KEY,
  scan_id        INT NOT NULL REFERENCES playwright_scans(id) ON DELETE CASCADE,
  hotel_id       INT NOT NULL REFERENCES hotels(id),
  hotel_code     TEXT NOT NULL,
  occupancy      TEXT NOT NULL,
  rooms          JSONB,
  screenshot_url TEXT,
  error          TEXT,
  scanned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, hotel_id, occupancy)
);

CREATE INDEX idx_playwright_scan_results_scan_id ON playwright_scan_results(scan_id);

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════

-- Default scan sources
INSERT INTO scan_sources (name, enabled) VALUES
  ('amello',         true),
  ('booking',        true),
  ('booking_member', false),
  ('check24',        false)
ON CONFLICT (name) DO NOTHING;

-- Default admin user (password: see original seed)
INSERT INTO users (username, password_hash, role, status)
VALUES (
  'admin',
  '36c3fb7cf0514f3ed68d5156a5e271f6:68e8d79a5ee8ced10c32eade48df079b05012f9927b39498cc2dcedb544566c088963118019bf381fd7321f722b78e4dd286d3b2e43bc5bb8090a6db78ec6ceb',
  'admin',
  'active'
)
ON CONFLICT (username) DO NOTHING;
