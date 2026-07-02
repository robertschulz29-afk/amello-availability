# Requirements Document

## Introduction

The Hotels page (/hotels) manages hotel records with a card grid display, edit/delete modals, global type filtering, and synchronization from external APIs (Amello and TUI CR-API). It enables operators to maintain the hotel portfolio used by the scanning system.

## Glossary

- **Hotels_Page**: The page (/hotels) managing hotel records with card grid display, edit/delete modals, global type filtering, and sync actions
- **Global_Type_Filter**: A collapsible card showing collector buttons grouped by category, implementing AND logic across selected collectors to filter hotels

## Requirements

### Requirement 1: Hotel Management

**User Story:** As a user, I want to manage hotel records with filtering and bulk sync capabilities, so that I can maintain an accurate hotel portfolio.

#### Acceptance Criteria

1. THE Hotels_Page SHALL display a toolbar card with controls for: hotel combobox filter, active toggle (All/Yes/No), bookable toggle (All/Yes/No), sort by (Name/Brand/Region with direction toggle), Update Hotel List button, Update CR-API Data button, and Export CSV button
2. THE Hotels_Page SHALL display a collapsible "Filter by Feature" card showing global type collectors grouped by category as toggle buttons implementing AND logic across selected collectors, with matched hotel codes and a copy button
3. THE Hotels_Page SHALL display a stats line showing: Total, Active, Inactive, Bookable, Non-bookable, Active & Bookable, and Showing counts
4. THE Hotels_Page SHALL render hotel records as a responsive card grid (3-column on large, 2-column on medium, 1-column on small viewports) with each card containing: hotel image with gradient overlay and name, edit/delete action buttons overlaid on image, and a detail table showing all hotel attributes
5. WHEN the user clicks edit on a hotel card, THE Hotels_Page SHALL display a modal with fields for: brand, region, country, all 4 URLs, bookable checkbox, and active checkbox, with URL validation
6. WHEN the user clicks delete on a hotel card, THE Hotels_Page SHALL display a confirmation modal showing the hotel name and code before executing deletion
7. WHEN the user clicks "Update Hotel List", THE Hotels_Page SHALL trigger an Amello hotel sync via POST to /api/hotels/sync?mode=amello and display the sync result summary
