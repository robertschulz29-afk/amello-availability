# Requirements Document

## Introduction

The Rooms/CR-API page (/rooms-cr-api) provides room imagery scanning via Playwright, CR-API room data comparison, and quality assessment. It enables operators to identify room imagery gaps and mapping quality issues across the hotel portfolio.

## Glossary

- **Rooms_CR_API_Page**: The page (/rooms-cr-api) providing room imagery scanning, CR-API room data comparison, and quality assessment
- **Quality_Level**: A classification (Perfect/Very good/Good/Mediocre/Poor/Horrible/Unavailable) based on image coverage ratios

## Requirements

### Requirement 1: Rooms and CR-API Comparison

**User Story:** As a user, I want to scan hotel rooms and compare them against CR-API data, so that I can identify room imagery gaps and mapping quality issues.

#### Acceptance Criteria

1. THE Rooms_CR_API_Page SHALL display an "Amello Rooms Scan" card with: hotel multi-selector, check-in date input, take screenshots checkbox, and a Start Scan button that shows a progress bar during execution
2. THE Rooms_CR_API_Page SHALL provide a filters toolbar with: scan dropdown, Expand/Collapse All button, hotels combobox, Group by buttons (None/Brand/Region/Country), Attention filter (All/Attention needed/Fix potential), and Quality filter (Perfect/Very good/Good/Mediocre/Poor/Horrible/Unavailable) with help popup explanations
3. THE Rooms_CR_API_Page SHALL display a collapsible scan summary card containing two tables: room counts by occupancy configuration and hotels by image status
4. THE Rooms_CR_API_Page SHALL render per-hotel collapsible cards with a quality badge and attention/fixable indicator badges
5. WITHIN each hotel card, THE Rooms_CR_API_Page SHALL display a collapsible "Rooms" panel showing: CR-API rooms split by image presence (with/without), and Amello scan rooms per occupancy in an accordion showing room code, name, and image status
6. WITHIN each hotel card, THE Rooms_CR_API_Page SHALL display a mapping table comparing CR-API codes to scan codes with filters (Match/Image CR-API/Image Scan), per-occupancy presence columns, and a fix-potential mode highlighting actionable rows
