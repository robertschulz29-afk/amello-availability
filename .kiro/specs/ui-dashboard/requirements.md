# Requirements Document

## Introduction

The Dashboard page (/) is the landing page of the amello-availability platform. It displays KPI summary cards with donut charts and grouped availability tables for a selected scan, providing a quick overview of portfolio health, source coverage, and pricing conflicts.

## Glossary

- **Dashboard**: The root page (/) displaying KPI summary cards and grouped availability tables for a selected scan
- **Donut_Chart**: An SVG-based circular progress indicator displaying a percentage value, count ratio, and label
- **Scan_Selector**: A dropdown allowing users to select from available scans

## Requirements

### Requirement 1: Dashboard KPI Overview

**User Story:** As a user, I want to see a high-level summary of scan results on the dashboard, so that I can quickly assess the overall availability and pricing status.

#### Acceptance Criteria

1. THE Dashboard SHALL display a scan selector dropdown populated with all scans sorted by scanned_at descending, defaulting to the most recent scan
2. THE Dashboard SHALL display four KPI cards in a single responsive row: Scan Info, Scan Sources, Portfolio Health, and Pricing Conflicts
3. WHEN a scan is selected, THE Dashboard SHALL download the full scan result set from the API and compute availability and source count metrics client-side
4. THE Dashboard SHALL render Donut_Chart components for: Amello green percentage (blue), Booking green percentage (purple), overall availability percentage (green), and booking-cheaper percentage (red)
5. THE Dashboard SHALL display "Availability by Country" and "Availability by Brand" tables below the KPI cards with columns for label, hotel count, available days ratio, and percentage
6. WHEN a percentage value in the grouped tables is 75% or above, THE Dashboard SHALL apply green text color; when 50% or above, yellow; below 50%, red
7. THE Dashboard SHALL provide a "View problems" link navigating to /portfolio-health?filter=below50 and a "View conflicts" link navigating to /rate-comparison with the current scanId and filter=booking_cheaper parameters
8. WHILE scan data is loading, THE Dashboard SHALL display a centered spinner
