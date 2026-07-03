# Requirements Document

## Introduction

The Scan Results page (/scan-results) displays paginated raw scan result data with filters, expandable room/rate rows, and external booking platform links. It enables operators to investigate specific hotel/date/source combinations in detail.

## Glossary

- **Scan_Results_Page**: The page (/scan-results) displaying paginated raw scan result data with filters and external links
- **Result_Row**: A single scan result entry that expands into multiple table rows (one per room/rate combination) when availability data is present

## Requirements

### Requirement 1: Scan Results Browser

**User Story:** As a user, I want to browse raw scan result data with filtering and external links, so that I can investigate specific hotel/date combinations.

#### Acceptance Criteria

1. THE Scan_Results_Page SHALL display a scan selector with scan info card and provide filters for: hotel combobox, source dropdown (All/TUI-Hotels/Booking Standard/Booking Member/Check24), date picker, and an Export CSV button
2. THE Scan_Results_Page SHALL display a paginated results table with columns: Scan ID, Hotel, Check-in, Status badge (green/red), Source badge, Room, Rate (expandable description), Actual Price, Base Price (strikethrough), and Links
3. WHEN a scan result has status "green" and contains response_json with rooms, THE Scan_Results_Page SHALL expand the result into multiple table rows — one per room/rate combination
4. THE Scan_Results_Page SHALL build external links for TUI-Hotels and Booking.com with check-in, checkout, and occupancy parameters derived from the scan result data
5. WHEN the "scanId" URL query parameter is present, THE Scan_Results_Page SHALL pre-select that scan on page load and update the URL parameter when the scan selection changes
6. THE Scan_Results_Page SHALL display the Pagination_Bar above and below the results table with configurable items per page (5/10/25/50/100)
