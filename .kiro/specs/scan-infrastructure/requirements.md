# Requirements Document

## Introduction

The Scan Infrastructure module provides the foundational configuration and tracking capabilities that support the scanning system. This includes scan source definitions, scan status tracking and listing, result deduplication, hotel snapshots, room name caching, screenshot storage, and application-level settings.

## Glossary

- **Scan_Source**: A configurable booking platform definition (e.g., amello, booking, booking_member, check24) with scraping parameters
- **Source_Job**: A per-source progress tracker within a scan tracking total_cells, done_cells, and status
- **Hotel_Snapshot**: A frozen copy of eligible hotel data at scan creation time stored in scan_hotels
- **Hotel_Room_Names**: A cache of distinct room names per hotel per source derived from scan results
- **App_Settings**: A key-value store for application-level configuration
- **Scan_Screenshot**: A stored screenshot URL captured during scanning for visual verification

## Requirements

### Requirement 1: Scan Source Configuration

**User Story:** As a platform operator, I want to configure booking sources with their scraping parameters, so that I can control which sources are active and how they behave.

#### Acceptance Criteria

1. THE Platform SHALL store scan sources with name (unique), enabled status, base_url, css_selectors (JSONB), rate_limit_ms (default 2000), and user_agent_rotation preference (default true)
2. WHEN a scan source is created or updated via POST, THE Platform SHALL upsert by name with the provided configuration
3. IF the name is missing or not a string, THEN THE Platform SHALL return a 400 error
4. IF css_selectors is provided and is not an object, THEN THE Platform SHALL return a 400 error
5. THE Platform SHALL support bulk enable/disable of multiple sources via PATCH with a sources array containing id and enabled fields
6. THE Platform SHALL provide pre-seeded default sources: amello (enabled), booking (enabled), booking_member (disabled), check24 (disabled)
7. THE Platform SHALL automatically update the updated_at timestamp via database trigger whenever a source is modified

### Requirement 2: Scan Listing and Status Tracking

**User Story:** As a platform operator, I want to view all scans with their per-source job progress, so that I can monitor scan execution status.

#### Acceptance Criteria

1. WHEN the scan list is queried, THE Platform SHALL return the 200 most recent scans ordered by scanned_at descending
2. THE Platform SHALL return scan metadata including id, scanned_at, base_checkin, fixed_checkout, days, stay_nights, timezone, total_cells, done_cells, status, sources, and store_screenshot
3. THE Platform SHALL include per-source job summaries (id, source, total_cells, done_cells, status) aggregated as a JSON array for each scan
4. THE Platform SHALL track source job statuses using the values: queued, running, done, error, or cancelled

### Requirement 3: Scan Result Deduplication

**User Story:** As a platform operator, I want scan results to be deduplicated per hotel, date, and source within a scan, so that re-processing does not create duplicate records.

#### Acceptance Criteria

1. THE Platform SHALL enforce a unique constraint on (scan_id, hotel_id, source, check_in_date) in the scan_results table
2. WHEN a duplicate result is inserted, THE Platform SHALL update the existing record with the new status and response_json data (ON CONFLICT DO UPDATE)
3. THE Platform SHALL enforce a unique constraint on (scan_id, hotel_id, source_id, check_in_date) in the scan_results_extended table

### Requirement 4: Hotel Snapshot at Scan Creation

**User Story:** As a platform operator, I want a frozen snapshot of eligible hotels at scan creation time, so that scan processing uses a consistent hotel set regardless of later hotel data changes.

#### Acceptance Criteria

1. WHEN a scan is created, THE Platform SHALL copy eligible hotel records (active=true AND bookable=true, or matching the provided hotel_ids) into the scan_hotels table with scan_id, hotel_id, code, bookable, and active fields
2. THE Platform SHALL use ON CONFLICT DO NOTHING to handle any race conditions during snapshot creation
3. WHEN processing scan batches, THE Platform SHALL read hotels from scan_hotels joined with the hotels table for additional data (like booking_url) rather than querying the live hotels table directly

### Requirement 5: Room Name Caching

**User Story:** As a platform operator, I want distinct room names per hotel and source to be cached, so that mapping interfaces load quickly without re-parsing raw scan JSONB data.

#### Acceptance Criteria

1. THE Platform SHALL store distinct room names in the room_names table keyed by (hotel_id, source, room_name) with a last_seen_at timestamp
2. THE Platform SHALL use the room_names cache as the primary data source for room mapping interfaces
3. THE Platform SHALL provide an index on (hotel_id, source) for efficient querying

### Requirement 6: Scan Screenshots

**User Story:** As a platform operator, I want scans to optionally capture and store screenshots of booking pages, so that I can visually verify scraped data.

#### Acceptance Criteria

1. WHEN a scan has store_screenshot enabled, THE Platform SHALL store captured screenshot URLs with scan_id, hotel_id, hotel_code, and captured_at timestamp
2. THE Platform SHALL enforce one screenshot per hotel per scan via a unique constraint on (scan_id, hotel_id)
3. WHEN a Playwright scan has take_screenshot enabled, THE Platform SHALL store screenshot_url alongside each scan result

### Requirement 7: Application Settings

**User Story:** As a platform operator, I want to store application-level key-value settings, so that configurable values can be managed without code changes.

#### Acceptance Criteria

1. THE Platform SHALL store application settings as key-value text pairs in the app_settings table with an updated_at timestamp
2. THE Platform SHALL use the key as the primary identifier for settings (unique)
3. THE Platform SHALL support reading and writing individual settings by key

### Requirement 8: Scan Results Extended Storage

**User Story:** As a platform operator, I want additional scraped data to be stored with structured fields, so that extended source-specific information is captured beyond the basic scan result.

#### Acceptance Criteria

1. THE Platform SHALL store extended scan results with scan_id, hotel_id, source_id, check_in_date, check_out_date, status (green/red/pending/error), scraped_data (JSONB), price, currency, availability_text, and error_message
2. THE Platform SHALL enforce valid status values via a CHECK constraint (green, red, pending, error)
3. THE Platform SHALL enforce uniqueness on (scan_id, hotel_id, source_id, check_in_date)
4. THE Platform SHALL provide indexes on scan_id, hotel_id, source_id, status, check_in_date, and the composite (scan_id, hotel_id, source_id) for efficient querying
