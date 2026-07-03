# Requirements Document

## Introduction

The Rate Comparison page (/rate-comparison) compares Amello and Booking.com prices in two view modes: Best Rate (minimum price per hotel/date) and All Rates (room-level comparison using room mappings). It provides hotel-level pagination, sorting, filtering, and color-coded pricing conflict indicators.

## Glossary

- **Rate_Comparison_Page**: The page (/rate-comparison) comparing Amello and Booking.com prices in Best Rate and All Rates view modes
- **Best_Rate_View**: Displays the minimum price per source per hotel/date combination
- **All_Rates_View**: Displays room-level price comparison using room mappings to match Amello and Booking rooms

## Requirements

### Requirement 1: Rate Comparison

**User Story:** As a user, I want to compare Amello and Booking.com prices, so that I can identify pricing conflicts across hotels and dates.

#### Acceptance Criteria

1. THE Rate_Comparison_Page SHALL provide two view modes: "Best Rate" and "All Rates" selectable via toggle buttons
2. THE Rate_Comparison_Page SHALL provide controls for: scan selector, hotel combobox filter, status filter (All/Amello only/Booking only/Booking cheaper >5%/Booking cheaper ≤5%/Booking cheaper/Amello cheaper), and Group by (None/Brand/Country/Region)
3. THE Rate_Comparison_Page SHALL display a scan info card and a summary card showing total rows, both available count, amello-only count, booking-only count, cheaper counts, and average prices
4. THE Rate_Comparison_Page SHALL implement hotel-level pagination by fetching the hotel list from /api/scan-results/hotels then loading data page-by-page for the visible hotels
5. WHEN in "Best Rate" view mode, THE Rate_Comparison_Page SHALL display per-hotel tables with columns: Check-In, Amello Room, Amello Rate, Booking Room, Booking Rate, Amello Price, Booking Price, Member Price, Difference, and Status pill
6. WHEN in "All Rates" view mode, THE Rate_Comparison_Page SHALL use room mappings to match Amello and Booking rooms side by side, displaying unmapped rooms separately
7. THE Rate_Comparison_Page SHALL apply row background coloring: table-success for amello cheaper, table-danger for booking cheaper >5%, table-warning for booking cheaper ≤5%, table-primary for amello only, and table-pink for booking only
8. WHEN a user clicks a sortable column header, THE Rate_Comparison_Page SHALL toggle sort direction between ascending and descending for that column
9. THE Rate_Comparison_Page SHALL support "scanId" and "filter" URL query parameters to pre-select the scan and status filter on page load
