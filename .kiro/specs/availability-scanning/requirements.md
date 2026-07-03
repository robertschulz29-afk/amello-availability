# Requirements Document

## Introduction

The Availability Scanning module orchestrates multi-source availability scans across booking platforms. It manages scan creation with configurable parameters, distributes work across per-source processing jobs, and coordinates batch processing for Amello API calls, Booking.com scraping, and Check24 scraping. Each source processes its workload independently in batches with progress tracking.

## Glossary

- **Scan_Engine**: The subsystem that orchestrates availability scans across booking sources
- **Amello_Processor**: The component that fetches availability from the Amello API for a scan batch
- **Booking_Processor**: The component that scrapes availability from Booking.com for a scan batch
- **Check24_Processor**: The component that scrapes availability from Check24 for a scan batch
- **Source_Job**: A per-source progress tracker within a scan (one per enabled source per scan)
- **Scan_Cell**: A single unit of work representing one hotel on one date for one source
- **Batch**: A subset of scan cells processed in a single API invocation
- **Hotel_Snapshot**: A frozen copy of eligible hotel data captured at scan creation time in scan_hotels
- **Base_Checkin**: The first check-in date in the scan range
- **Stay_Nights**: The number of nights per booking (determines check-out date)
- **Days**: The number of consecutive check-in dates to scan starting from base_checkin

## Requirements

### Requirement 1: Scan Creation and Orchestration

**User Story:** As a platform operator, I want to create multi-source availability scans with configurable parameters, so that I can gather pricing data across booking platforms for analysis.

#### Acceptance Criteria

1. WHEN a scan is created, THE Scan_Engine SHALL accept parameters for: base check-in date (YYYY-MM-DD), days (1-365, default 86), stay_nights (1-30, default 7), adult_count (1-10, default 2), sources array, optional hotel ID selection, and store_screenshot preference
2. WHEN no base check-in date is provided, THE Scan_Engine SHALL default to 5 days from the current date in Europe/Berlin timezone
3. WHEN sources are provided as an array, THE Scan_Engine SHALL use those sources; WHEN no sources are provided, THE Scan_Engine SHALL read enabled sources from the scan_sources table
4. IF no sources are selected or enabled, THEN THE Scan_Engine SHALL return a 400 error
5. IF hotel IDs are provided but none are valid positive integers, THEN THE Scan_Engine SHALL return a 400 error
6. WHEN a scan is created, THE Scan_Engine SHALL create one Source_Job record per selected source with total_cells calculated as eligible_hotels × days
7. WHEN calculating total cells for booking or booking_member sources, THE Scan_Engine SHALL count only hotels that have a non-empty booking_url
8. WHEN calculating total cells for check24 source, THE Scan_Engine SHALL count only hotels that have a non-empty check24_url
9. WHEN calculating total cells for amello source, THE Scan_Engine SHALL count all active bookable hotels (or the selected hotel subset)
10. WHEN a scan is created, THE Scan_Engine SHALL snapshot eligible hotel data into the scan_hotels table for consistent processing
11. WHEN all source jobs are created, THE Scan_Engine SHALL trigger the first processing batch for each source via fire-and-forget HTTP POST calls
12. WHEN a cron-triggered scan is requested (cron=1 or key parameter) and a scan with status queued/running/done already exists for the current Berlin date, THE Scan_Engine SHALL skip creation and return the existing scan ID

### Requirement 2: Amello Availability Processing

**User Story:** As a platform operator, I want the system to fetch availability from the Amello API in batches, so that room/rate data is collected efficiently without overwhelming the API.

#### Acceptance Criteria

1. WHEN processing a batch, THE Amello_Processor SHALL accept jobId, startIndex, and size (max 200) parameters
2. WHEN processing begins, THE Amello_Processor SHALL load the source job, parent scan parameters (base_checkin, days, stay_nights, adult_count), and the hotel snapshot for the scan
3. WHEN generating the work slice, THE Amello_Processor SHALL calculate cells as hotels (from scan_hotels) × dates, ordered by hotel then date
4. WHEN processing each cell, THE Amello_Processor SHALL call the Amello hotel/offer endpoint with hotel code, departure date (check-in), return date (check-in + stay_nights), currency EUR, adult count, and locale en_DE
5. WHEN a successful 200 response contains rooms with rates, THE Amello_Processor SHALL extract room/rate data and store the result with status "green"
6. WHEN a response contains no rooms or a non-200 status, THE Amello_Processor SHALL store the result with status "red" including the raw response
7. THE Amello_Processor SHALL process cells with a concurrency of 4 parallel requests within each batch
8. WHEN the batch completes, THE Amello_Processor SHALL update the source job done_cells to the next index position
9. WHEN all cells are completed (nextIndex >= total), THE Amello_Processor SHALL mark the source job as done and evaluate whether all source jobs for the scan are complete
10. IF the scan status is "cancelled" or the source job status is "cancelled", THEN THE Amello_Processor SHALL stop processing immediately and return done=true

### Requirement 3: Booking.com Availability Processing

**User Story:** As a platform operator, I want the system to scrape availability from Booking.com, so that competitor pricing is captured for comparison.

#### Acceptance Criteria

1. WHEN processing a booking batch, THE Booking_Processor SHALL target only hotels from the scan_hotels snapshot that have a configured booking_url
2. THE Booking_Processor SHALL store results in scan_results with source set to "booking" or "booking_member" matching the source job's source value
3. WHEN all cells are processed, THE Booking_Processor SHALL update the source job progress and evaluate scan completion
4. THE Booking_Processor SHALL follow the same batch orchestration pattern as the Amello_Processor (jobId, startIndex, size)

### Requirement 4: Check24 Availability Processing

**User Story:** As a platform operator, I want the system to scrape availability from Check24, so that additional competitor pricing is available for analysis.

#### Acceptance Criteria

1. WHEN processing a Check24 batch, THE Check24_Processor SHALL target only hotels from the scan_hotels snapshot that have a configured check24_url
2. THE Check24_Processor SHALL store results in scan_results with source set to "check24"
3. THE Check24_Processor SHALL follow the same batch orchestration pattern as the Amello_Processor (jobId, startIndex, size)

### Requirement 5: Scan Completion Evaluation

**User Story:** As a platform operator, I want the system to automatically detect when all sources have finished processing, so that the overall scan status is updated correctly.

#### Acceptance Criteria

1. WHEN a source job is marked as done, THE Scan_Engine SHALL check whether all source jobs for that scan are in a terminal state (done, error, or cancelled)
2. WHEN all source jobs are in a terminal state, THE Scan_Engine SHALL update the parent scan status to "done"
3. THE Scan_Engine SHALL update the parent scan's done_cells count as the sum of all source job done_cells values
