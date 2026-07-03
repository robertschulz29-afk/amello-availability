# Requirements Document

## Introduction

The Portfolio Health page (/portfolio-health) provides availability visualization via bar charts and heatmaps with grouping, filtering, and export controls. It enables operators to identify hotels with availability problems across date ranges.

## Glossary

- **Portfolio_Health_Page**: The page (/portfolio-health) providing availability visualization via bar charts and heatmaps with grouping and filtering controls
- **Availability_Matrix**: A hotel×date grid derived from scan results indicating green (available) or red (unavailable) status per cell

## Requirements

### Requirement 1: Portfolio Health Visualization

**User Story:** As a user, I want to visualize hotel availability patterns over time, so that I can identify hotels with availability problems.

#### Acceptance Criteria

1. THE Portfolio_Health_Page SHALL display a scan selector with scan info card and an overall availability donut showing the aggregate green percentage
2. THE Portfolio_Health_Page SHALL provide filter controls for: Active (All/Yes/No), Bookable (All/Yes/No), Group by (None/Hotel/Brand/Region/Country), Sort by Avg Availability (None/Asc/Desc), Availability filter (All/≥50%/<50%), and Visualization toggle (Heatmap/Bar Chart)
3. THE Portfolio_Health_Page SHALL provide an Export CSV button that generates a client-side CSV file containing hotel names, codes, brands, average percentages, and per-date availability statuses
4. WHEN visualization mode is "Bar Chart", THE Portfolio_Health_Page SHALL render an SVG bar chart with date-based bars color-coded green (>75%), yellow (>50%), or red (≤50%) per group
5. WHEN visualization mode is "Heatmap", THE Portfolio_Health_Page SHALL render an SVG heatmap grid with hotel rows and date columns, coloring cells green for available and red for unavailable
6. THE Portfolio_Health_Page SHALL render a collapsible Price Data table per group showing date, hotel, room type, rate type, and lowest price
7. WHEN grouped by hotel, THE Portfolio_Health_Page SHALL display the hotel base_image in the group header section
8. THE Portfolio_Health_Page SHALL support the "filter" URL query parameter to pre-select the availability filter on page load
9. THE Portfolio_Health_Page SHALL download the full scan data set client-side and derive the availability matrix by deduplicating entries by hotel and date for the amello source
