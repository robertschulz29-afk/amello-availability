# Requirements Document

## Introduction

The Hotel Management module handles all hotel data operations including CRUD, synchronization from external APIs (Amello and TUI CR-API), and CSV export. Hotels are the foundational entity that all scans target, storing metadata, booking platform URLs, and classification data.

## Glossary

- **Hotel_Manager**: The subsystem responsible for hotel data CRUD operations and synchronization
- **Amello_API**: The production Amello API at prod-api.amello.plusline.net providing hotel reference and detail data
- **CR_API**: The TUI Content APIs (GraphQL and REST) providing global types and room data
- **Bello_Mandator**: A required HTTP header for authenticating with the Amello API
- **Global_Types**: Classification codes from the TUI content system stored as a JSON array on hotel records
- **Hotel_Code**: A unique alphanumeric identifier for each hotel in the Amello system

## Requirements

### Requirement 1: Hotel Data Storage and CRUD

**User Story:** As a platform operator, I want to manage hotel records with their booking platform URLs and metadata, so that scans can target the correct hotels across all sources.

#### Acceptance Criteria

1. THE Hotel_Manager SHALL store hotel records with name, code (unique), brand, region, country, base_image, bookable status, active status, and booking platform URLs (booking_url, tuiamello_url, expedia_url, check24_url)
2. WHEN a hotel record is created or updated via the API, THE Hotel_Manager SHALL upsert the record using the hotel code as the unique identifier
3. WHEN the hotel list is queried, THE Hotel_Manager SHALL return hotels ordered by ID ascending with optional filtering by active status and bookable status
4. WHEN hotels are queried with collector IDs, THE Hotel_Manager SHALL return only hotels whose globalTypes field matches at least one global type code from every specified collector (AND logic across collectors, OR logic within a collector)
5. THE Hotel_Manager SHALL support a slim query mode that excludes base_image and globalTypes fields from the response
6. WHEN a single hotel is updated by ID, THE Hotel_Manager SHALL allow partial updates to any editable field including booking platform URLs

### Requirement 2: Hotel Synchronization from Amello API

**User Story:** As a platform operator, I want to automatically sync hotel data from the Amello API, so that the hotel list stays current without manual data entry.

#### Acceptance Criteria

1. WHEN an Amello sync is triggered (POST with mode=amello), THE Hotel_Manager SHALL fetch the hotel reference list from the Amello production API using the configured Bello-Mandator header
2. WHEN the hotel reference list is received, THE Hotel_Manager SHALL extract unique hotel codes from all sources in the response
3. WHEN hotel codes are identified, THE Hotel_Manager SHALL fetch detail data (name, brand, images, region, country, bookable, active status) for each hotel code in parallel
4. WHEN hotel details are fetched, THE Hotel_Manager SHALL upsert each hotel record preserving manually-configured fields (booking_url, tuiamello_url, expedia_url, check24_url)
5. WHEN the sync completes successfully, THE Hotel_Manager SHALL mark hotels not returned by the API as inactive and non-bookable
6. WHEN the sync completes, THE Hotel_Manager SHALL return the count of synced hotels, skipped hotels, any errors, and the full updated hotel list
7. IF the Amello API returns an error during reference list fetch, THEN THE Hotel_Manager SHALL return a 502 error with the failure details
8. IF no hotel codes are found in the reference response, THEN THE Hotel_Manager SHALL return a 502 error with a sample of the response data

### Requirement 3: Hotel Synchronization from TUI CR-API

**User Story:** As a platform operator, I want to sync global types and room data from the TUI content APIs, so that hotels have classification data and room imagery available.

#### Acceptance Criteria

1. WHEN a CR-API sync is triggered (POST with mode=crapi), THE Hotel_Manager SHALL query all active and bookable hotel codes from the database
2. WHEN processing each hotel, THE Hotel_Manager SHALL fetch global types from the TUI GraphQL API combining hotel-level and room-level globalTypes into a deduplicated set
3. WHEN global types are fetched for a hotel, THE Hotel_Manager SHALL store them as a JSON array in the hotel's globalTypes field
4. WHEN processing each hotel, THE Hotel_Manager SHALL fetch room data (room code, title, image URLs) from the TUI REST API and upsert each room into the cr_api_rooms table keyed by (hotel_id, room_code)
5. THE Hotel_Manager SHALL process all hotels in parallel with an 8-second timeout per TUI API call
6. IF an individual hotel's TUI API call fails, THEN THE Hotel_Manager SHALL log the error and continue processing remaining hotels
7. IF no active bookable hotels exist in the database, THEN THE Hotel_Manager SHALL return a 400 error instructing to run the Amello sync first
8. WHEN the sync completes, THE Hotel_Manager SHALL return the count of updated hotels, skipped count, and any errors

### Requirement 4: Hotel CSV Export

**User Story:** As a platform operator, I want to export hotel data as a CSV file, so that I can analyze or share hotel information externally.

#### Acceptance Criteria

1. WHEN an export is requested, THE Hotel_Manager SHALL generate a CSV file containing id, name, code, brand, region, country, booking_url, tuiamello_url, expedia_url, bookable, and active columns
2. WHEN specific hotel IDs are provided via the ids parameter, THE Hotel_Manager SHALL export only those hotels
3. WHEN no IDs are specified, THE Hotel_Manager SHALL export all hotels ordered by name ascending
4. THE Hotel_Manager SHALL properly escape CSV values containing commas, double quotes, or newlines using RFC 4180 quoting rules
5. THE Hotel_Manager SHALL set the Content-Type to text/csv and Content-Disposition header with a filename including the current date (hotels_YYYY-MM-DD.csv)
