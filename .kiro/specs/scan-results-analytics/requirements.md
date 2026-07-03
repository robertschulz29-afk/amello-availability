# Requirements Document

## Introduction

The Scan Results Analytics module provides querying, comparison, and summarization capabilities for availability scan data. It enables operators to inspect individual scan results, compare prices across sources (Amello vs Booking.com), and view aggregated summaries of competitive positioning.

## Glossary

- **Rate_Comparator**: The component that compares prices across sources for the same hotel/date combination
- **Scan_Result**: A single availability response for one hotel on one date from one source, containing status and room/rate JSON data
- **Green_Status**: A scan result where availability was found (rooms with rates present)
- **Red_Status**: A scan result where no availability was found
- **Price_Difference**: The absolute difference between Amello minimum price and Booking minimum price
- **Percentage_Difference**: The relative price difference expressed as a percentage of the Booking price
- **Comparison_Format**: A pivoted view that merges results across sources into a single row per hotel/date/room/rate

## Requirements

### Requirement 1: Scan Results Querying

**User Story:** As a platform operator, I want to query scan results with flexible filtering and pagination, so that I can analyze availability data across hotels, dates, and sources.

#### Acceptance Criteria

1. WHEN querying scan results, THE Platform SHALL support filtering by scan ID, status (green or red), hotel ID (single or comma-separated list), check-in date, and source (amello, booking, or booking_member)
2. THE Platform SHALL paginate results with configurable page size (default 100, max 500 for standard queries, max 5000 for comparison format)
3. THE Platform SHALL return scan_id, hotel_id, hotel_name, booking_url, tuiamello_url, hotel_code, check_in_date, status, response_json, and source for each result
4. THE Platform SHALL return total count, current page, limit, and total pages metadata in all paginated responses
5. THE Platform SHALL order standard results by scan_id descending

### Requirement 2: Comparison Format Results

**User Story:** As a platform operator, I want to view results in a comparison format that shows prices side by side across sources, so that I can quickly identify pricing differences per room and rate.

#### Acceptance Criteria

1. WHEN the comparison format is requested (format=comparison), THE Platform SHALL extract room names and rate names from the response_json rooms array with actualPrice values
2. THE Platform SHALL pivot results to show price_amello, price_booking, and price_booking_member columns grouped by hotel_id, hotel_name, check_in_date, room_name, and rate_name
3. THE Platform SHALL include status_amello and status_booking indicators and a currency field in comparison results
4. THE Platform SHALL order comparison results by hotel_id, check_in_date, room_name, and rate_name

### Requirement 3: Rate Comparison Analytics

**User Story:** As a platform operator, I want to compare minimum prices between Amello and Booking.com for each hotel and date, so that I can identify pricing discrepancies at a glance.

#### Acceptance Criteria

1. WHEN querying rate comparisons, THE Rate_Comparator SHALL calculate the minimum price per source for each hotel/date combination using only green-status results
2. THE Rate_Comparator SHALL return the cheapest room_name, rate_name, rate_description, member_price, and currency for both Amello and Booking sources
3. THE Rate_Comparator SHALL calculate amello_min_price, booking_min_price, booking_member_min_price for each hotel/date
4. THE Rate_Comparator SHALL calculate price_difference as (amello_min - booking_min) and percentage_difference as ((amello_min - booking_min) / booking_min × 100)
5. THE Rate_Comparator SHALL support filtering by scan ID and hotel ID(s) with pagination (max 5000 per page)
6. THE Rate_Comparator SHALL include all hotel/date combinations in the base result set regardless of whether prices exist (using LEFT JOIN from base combinations to price data)

### Requirement 4: Scan Results Summary

**User Story:** As a platform operator, I want a high-level summary of price comparison outcomes for a scan, so that I can quickly assess competitive positioning.

#### Acceptance Criteria

1. WHEN a summary is requested for a scan (scanID required), THE Platform SHALL calculate counts for five categories: amello_cheaper, booking_cheaper, same_price, amello_only, and booking_only
2. THE Platform SHALL derive comparisons by matching room_name and rate_name pairs across amello and booking sources within the specified scan
3. THE Platform SHALL classify a pair as amello_cheaper when amello price is less than booking price, booking_cheaper when booking price is less, and same_price when prices are equal
4. THE Platform SHALL classify a pair as amello_only when only amello has a price, and booking_only when only booking has a price
5. THE Platform SHALL support optional hotel ID filtering to scope the summary to specific hotels
