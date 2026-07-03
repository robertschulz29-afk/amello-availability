# Requirements Document

## Introduction

The Room Imagery module manages room image data sourced from the TUI CR-API and provides mapping between imagery room names (German) and scan result room names (English). It includes AI-powered cross-language mapping suggestions using Claude to bridge the naming gap between TUI's German content system and the English scan results.

## Glossary

- **Imagery_Manager**: The subsystem managing room imagery from CR-API and imagery-to-scan room mappings
- **CR_API_Room**: A room record from the TUI CR-API containing name (German), room_code, image_url, and global_types
- **Imagery_Mapping**: A mapping between a TUI CR-API room name (imagery_room_name) and a scan result room name (scan_room_name)
- **Scan_Room**: A room name extracted from Amello scan results (English)
- **Imagery_Room**: A room name from the TUI CR-API / content system (German)
- **Confidence_Threshold**: The minimum confidence score (0.75) for an AI suggestion to be considered "confident" vs requiring manual review

## Requirements

### Requirement 1: Room Imagery Data Querying

**User Story:** As a platform operator, I want to view room imagery data from the TUI CR-API, so that I can see available room images and their metadata.

#### Acceptance Criteria

1. WHEN room imagery is queried, THE Imagery_Manager SHALL return CR-API room records joined with hotel name and code
2. THE Imagery_Manager SHALL support optional filtering by hotel ID, active hotel status, and bookable hotel status
3. THE Imagery_Manager SHALL return id, hotel_id, hotel_name, hotel_code, room_name, room_code, image_url, global_types, and updated_at for each room
4. THE Imagery_Manager SHALL order results by hotel name, then room name

### Requirement 2: Imagery Mapping Management

**User Story:** As a platform operator, I want to create and manage mappings between imagery room names and scan room names, so that room images can be associated with availability data.

#### Acceptance Criteria

1. WHEN imagery mappings are queried, THE Imagery_Manager SHALL return all hotels (with optional active/bookable filtering) with their existing mappings, imagery rooms (from cr_api_rooms), and scan rooms (from amello green scan results)
2. THE Imagery_Manager SHALL only include hotels that have at least one imagery room or scan room in the response
3. WHEN a mapping is created, THE Imagery_Manager SHALL require hotelId, imageryRoomName, and scanRoomName fields
4. IF any required field is missing, THEN THE Imagery_Manager SHALL return a 400 error
5. WHEN a mapping is created, THE Imagery_Manager SHALL upsert on the unique constraint (hotel_id, scan_room_name), updating imagery_room_name, source, and confidence if a conflict occurs
6. THE Imagery_Manager SHALL accept source as "manual" or "ai" (defaulting to "manual") and an optional numeric confidence value
7. WHEN a mapping is patched by ID, THE Imagery_Manager SHALL allow updating imageryRoomName and/or scanRoomName with the updated_at timestamp refreshed
8. IF neither field is provided in a patch, THEN THE Imagery_Manager SHALL return a 400 error
9. IF the mapping ID does not exist for a patch, THEN THE Imagery_Manager SHALL return a 404 error
10. WHEN a mapping is deleted by ID, THE Imagery_Manager SHALL remove the record

### Requirement 3: AI-Suggested Imagery Mappings

**User Story:** As a platform operator, I want AI-generated suggestions for mapping German imagery room names to English scan room names, so that I can efficiently create mappings across languages.

#### Acceptance Criteria

1. WHEN suggestions are requested for a hotel, THE Imagery_Manager SHALL identify unmapped scan rooms by excluding rooms that already have any imagery mapping
2. WHEN all scan rooms are already mapped, THE Imagery_Manager SHALL return an empty suggestions list with an informational message
3. IF no scan rooms or imagery rooms exist for the hotel, THEN THE Imagery_Manager SHALL return an empty list with a message to run a scan or hotel sync first
4. WHEN making suggestions, THE Imagery_Manager SHALL call the Claude API with the unmapped scan room names (English) and all imagery room names (German) along with common translation guidance
5. THE Imagery_Manager SHALL validate that all suggested room names exist in the actual scan room list and imagery room list, discarding invalid suggestions
6. WHEN a suggestion has confidence at or above 0.75, THE Imagery_Manager SHALL classify it as a confident suggestion ready for saving
7. WHEN a suggestion has confidence below 0.75 but above 0, THE Imagery_Manager SHALL classify it as "skipped" requiring manual review
8. THE Imagery_Manager SHALL return suggestions and skipped items separately without persisting any data, requiring frontend confirmation before saving

### Requirement 4: Room Imagery Report

**User Story:** As a platform operator, I want to generate a report of room imagery coverage, so that I can identify hotels with missing or incomplete room image data.

#### Acceptance Criteria

1. WHEN a room imagery report is requested, THE Imagery_Manager SHALL provide coverage statistics for room imagery across hotels
