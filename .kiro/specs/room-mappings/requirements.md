# Requirements Document

## Introduction

The Room Mappings module manages the association between room names from different booking sources for the same physical room. Since Amello and Booking.com use different naming conventions, this module allows operators to create mappings (manually or via AI suggestions) so that rate comparisons can match equivalent rooms across sources.

## Glossary

- **Room_Mapper**: The subsystem managing room name mappings between Amello and Booking.com
- **Room_Mapping**: A record associating an Amello room name with a Booking.com room name for a specific hotel
- **Amello_Room**: A room name as it appears in Amello scan results
- **Booking_Room**: A room name as it appears in Booking.com scan results
- **Hotel_Room_Names**: A cached table of distinct room names per hotel and source, updated from scan results
- **Mapping_Source**: The origin of a mapping — either "manual" (user-created) or "ai" (AI-suggested)
- **Confidence**: A numeric score (0-1) indicating how confident the AI is in a suggested mapping

## Requirements

### Requirement 1: Room Mapping Storage and Querying

**User Story:** As a platform operator, I want to view all room mappings alongside available room names from each source, so that I can manage cross-source room associations.

#### Acceptance Criteria

1. WHEN room mappings are queried without a hotel ID, THE Room_Mapper SHALL return all active hotels with their existing mappings, Amello room names, and Booking room names
2. WHEN room mappings are queried with a specific hotel ID, THE Room_Mapper SHALL return mappings, amelloRooms, and bookingRooms for that hotel only
3. THE Room_Mapper SHALL source available room names from the hotel_room_names cache table filtered by source (amello or booking)
4. THE Room_Mapper SHALL return mapping records with id, hotel_id, amello_room, booking_room, source, confidence, created_at, and updated_at

### Requirement 2: Room Mapping Creation

**User Story:** As a platform operator, I want to create room mappings between Amello and Booking.com room names, so that rate comparisons can match equivalent rooms.

#### Acceptance Criteria

1. WHEN a mapping is created, THE Room_Mapper SHALL require hotelId, amelloRoom, and bookingRoom fields
2. IF any required field is missing, THEN THE Room_Mapper SHALL return a 400 error
3. WHEN a mapping is created with source "ai" but a manual mapping already exists for the same (hotel_id, amello_room, booking_room) combination, THE Room_Mapper SHALL preserve the existing manual mapping and return it without modification
4. WHEN a duplicate mapping is inserted, THE Room_Mapper SHALL upsert on (hotel_id, amello_room, booking_room) preserving manual source over ai source
5. THE Room_Mapper SHALL accept optional source (default "manual") and confidence parameters

### Requirement 3: Room Mapping Updates and Deletion

**User Story:** As a platform operator, I want to edit or delete room mappings, so that I can correct errors or remove obsolete mappings.

#### Acceptance Criteria

1. WHEN a mapping is patched by ID, THE Room_Mapper SHALL allow updating amelloRoom and/or bookingRoom fields
2. WHEN a mapping is patched, THE Room_Mapper SHALL promote the source to "manual" and clear the confidence score
3. IF neither amelloRoom nor bookingRoom is provided in a patch, THEN THE Room_Mapper SHALL return a 400 error
4. IF the mapping ID does not exist, THEN THE Room_Mapper SHALL return a 404 error
5. WHEN a mapping is deleted by ID, THE Room_Mapper SHALL remove the record from the database

### Requirement 4: AI-Suggested Room Mappings

**User Story:** As a platform operator, I want AI-generated suggestions for matching Amello room names to Booking.com room names, so that I can quickly create mappings without manual comparison.

#### Acceptance Criteria

1. WHEN suggestions are requested for a hotel, THE Room_Mapper SHALL provide room name pairs with confidence scores based on semantic similarity
2. THE Room_Mapper SHALL return suggestions without saving them, requiring explicit creation calls to persist
