# Requirements Document

## Introduction

The Scan Setup page (/status-overview) provides scan creation controls and a scan management table with per-source progress tracking. It enables operators to configure and launch availability scans, monitor their execution, and manage scan history.

## Glossary

- **Status_Overview_Page**: The page (/status-overview) providing scan creation controls and a scan management table with progress tracking
- **Source_Toggle**: A switch control for enabling/disabling a booking source for a new scan

## Requirements

### Requirement 1: Scan Creation and Management

**User Story:** As a user, I want to create new scans and monitor their progress, so that I can collect fresh availability data.

#### Acceptance Criteria

1. THE Status_Overview_Page SHALL display a "Create New Scan" card with controls for: hotel multi-select (defaulting to all active+bookable hotels), check-in date, stay nights, days to scan, adults count, and source toggle switches
2. THE Status_Overview_Page SHALL default the booking and booking_member source toggles to OFF on page load regardless of their persisted database state
3. WHEN the user clicks "Start Scan", THE Status_Overview_Page SHALL validate that at least one hotel is selected and at least one source is enabled before sending the create request
4. IF the booking_member source is enabled, THEN THE Status_Overview_Page SHALL perform a pre-check by testing cookie validity before starting the scan, and display a linked error message if the test fails
5. THE Status_Overview_Page SHALL display an "All Scans" table with columns: ID, Created, Base check-in, Checkout, Days, Nights, Progress by source (mini progress bars), Status badge, and Actions (Export CSV, Cancel, Delete)
6. WHILE any scan has status "running" or "queued", THE Status_Overview_Page SHALL poll the scan list every 3 seconds to update progress
7. WHEN the user clicks Delete on a scan, THE Status_Overview_Page SHALL display a confirmation dialog including the scan ID before executing the deletion
