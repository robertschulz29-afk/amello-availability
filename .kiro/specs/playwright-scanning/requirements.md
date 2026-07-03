# Requirements Document

## Introduction

The Playwright Scanning module provides browser-based availability scraping using Playwright for sources that require JavaScript rendering. It operates as an independent scanning subsystem with its own scan lifecycle, supporting multiple occupancy variants per hotel, optional screenshot capture, and retry capabilities.

## Glossary

- **Playwright_Scanner**: The browser-based scanning subsystem using Playwright for web scraping
- **Playwright_Scan**: A scan record tracking browser-based scraping progress with status, totals, and timestamps
- **Playwright_Scan_Result**: An individual result from a browser-based scan for a specific hotel and occupancy
- **Occupancy**: A traveler configuration variant (the system tests 4 occupancy variants per hotel)
- **Chunk**: A subset of hotels processed in a single browser automation batch
- **Screenshot_URL**: A URL pointing to a captured screenshot of the booking page during scanning

## Requirements

### Requirement 1: Playwright Scan Creation

**User Story:** As a platform operator, I want to trigger browser-based availability scans, so that I can scrape data from JavaScript-heavy booking platforms.

#### Acceptance Criteria

1. WHEN a Playwright scan is created, THE Playwright_Scanner SHALL accept a check-in date (YYYY-MM-DD format, required), optional take_screenshot flag (default false), and optional hotel_ids array
2. IF the check-in date is missing or not in YYYY-MM-DD format, THEN THE Playwright_Scanner SHALL return a 400 error
3. IF hotel_ids are provided but contain no valid positive integers, THEN THE Playwright_Scanner SHALL return a 400 error
4. IF a Playwright scan with status "running" already exists, THEN THE Playwright_Scanner SHALL reject the new scan with a 409 conflict error including the running scan ID
5. WHEN a scan is created with hotel_ids, THE Playwright_Scanner SHALL calculate total as hotel_count × 4 (occupancy variants)
6. WHEN a scan is created without hotel_ids, THE Playwright_Scanner SHALL calculate total based on all active bookable hotels × 4
7. THE Playwright_Scanner SHALL store the hotel_ids array on the scan record for later processing reference
8. THE Playwright_Scanner SHALL return the new scan ID and total count upon successful creation

### Requirement 2: Playwright Scan Status Polling

**User Story:** As a platform operator, I want to poll the status of a running Playwright scan, so that I can monitor its progress in the UI.

#### Acceptance Criteria

1. WHEN a scan status is polled by ID, THE Playwright_Scanner SHALL return id, check_in, take_screenshot, status, total, processed, errors, created_at, and finished_at
2. IF the scan ID is invalid or not found, THEN THE Playwright_Scanner SHALL return a 404 error

### Requirement 3: Playwright Scan Processing

**User Story:** As a platform operator, I want the system to process Playwright scans in chunks using browser automation, so that availability is scraped from rendered web pages.

#### Acceptance Criteria

1. WHEN processing a chunk, THE Playwright_Scanner SHALL accept scanId, offset, and takeScreenshot parameters
2. THE Playwright_Scanner SHALL execute browser automation to load booking pages and extract availability data
3. THE Playwright_Scanner SHALL store results per hotel with occupancy, rooms data (JSONB), optional screenshot_url, and any error messages
4. THE Playwright_Scanner SHALL enforce uniqueness on (scan_id, hotel_id, occupancy) to prevent duplicate results
5. IF processing fails fatally, THEN THE Playwright_Scanner SHALL update the scan status to "failed" and set finished_at

### Requirement 4: Playwright Scan Retry

**User Story:** As a platform operator, I want to retry failed items in a Playwright scan, so that transient errors can be recovered without re-running the entire scan.

#### Acceptance Criteria

1. WHEN a retry is triggered for a scan, THE Playwright_Scanner SHALL re-process items that previously resulted in errors
2. THE Playwright_Scanner SHALL track whether a retry has been attempted via the retry_attempted flag on the scan record

### Requirement 5: Playwright Scan Listing

**User Story:** As a platform operator, I want to view past Playwright scans, so that I can review historical browser-based scan data.

#### Acceptance Criteria

1. WHEN Playwright scans are listed, THE Playwright_Scanner SHALL return scan records with their status, progress counts, and timestamps
2. THE Playwright_Scanner SHALL support a process-next endpoint that picks up the next unprocessed chunk for a running scan
