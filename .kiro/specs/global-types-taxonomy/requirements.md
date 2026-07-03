# Requirements Document

## Introduction

The Global Types Taxonomy module manages a hierarchical classification system for hotels. Global type codes (sourced from TUI content systems) are organized into collectors (named groups) which are in turn assigned to categories. This taxonomy enables hotel filtering by meaningful classification dimensions such as amenities, location features, and hotel types.

## Glossary

- **Taxonomy_Manager**: The subsystem managing global types, collectors, and categories
- **Global_Type**: An individual classification code (e.g., "GT03-SNOW") with an optional label, assigned to a collector group
- **Collector**: A named group that aggregates multiple related global types (e.g., "Winter Sports" collecting snow-related types)
- **Category**: A top-level classification bucket for collectors (e.g., "Activities", "Location")
- **Filter_Group**: An alternative grouping mechanism using a group_name field directly on global types
- **Type_Assignment**: The relationship between a global type and its collector (via group_id)

## Requirements

### Requirement 1: Global Types Listing

**User Story:** As a platform operator, I want to view all global types with their collector and category context, so that I can understand the current taxonomy structure.

#### Acceptance Criteria

1. WHEN global types are queried, THE Taxonomy_Manager SHALL return each type's global_type code, collector_id, collector_name, and global_type_category
2. THE Taxonomy_Manager SHALL order results by category ascending (nulls last), then collector name ascending (nulls last), then global_type code ascending
3. THE Taxonomy_Manager SHALL exclude rows where global_type is NULL

### Requirement 2: Collector Management

**User Story:** As a platform operator, I want to create and view collectors with their assigned types, so that I can organize global types into meaningful groups.

#### Acceptance Criteria

1. WHEN collectors are queried, THE Taxonomy_Manager SHALL return each collector with id, name, description, type_category_id, global_type_category name, and an array of assigned global type codes
2. WHEN collectors are queried, THE Taxonomy_Manager SHALL separately return a list of unassigned global types (those with no group_id)
3. WHEN collectors are queried, THE Taxonomy_Manager SHALL return all available categories
4. WHEN a collector is created, THE Taxonomy_Manager SHALL require a non-empty name and accept optional description and type_category_id
5. IF the collector name is empty or missing, THEN THE Taxonomy_Manager SHALL return a 400 error
6. WHEN a collector is updated by ID, THE Taxonomy_Manager SHALL allow updating name, description, and type_category_id
7. WHEN a collector is deleted by ID, THE Taxonomy_Manager SHALL remove the collector record

### Requirement 3: Category Management

**User Story:** As a platform operator, I want to create and manage categories, so that collectors can be organized into top-level classification groups.

#### Acceptance Criteria

1. WHEN a category is created, THE Taxonomy_Manager SHALL accept a global_type_category name and return the created record with its ID
2. WHEN a category is updated by ID, THE Taxonomy_Manager SHALL allow changing the global_type_category name
3. WHEN a category is deleted by ID, THE Taxonomy_Manager SHALL remove the category record

### Requirement 4: Global Type Assignments to Collectors

**User Story:** As a platform operator, I want to assign global types to collectors in bulk, so that I can efficiently organize the taxonomy.

#### Acceptance Criteria

1. WHEN assignments are submitted, THE Taxonomy_Manager SHALL accept an array of objects each containing global_type and collector_id (nullable)
2. WHEN processing assignments, THE Taxonomy_Manager SHALL update the group_id of each specified global type to the provided collector_id
3. WHEN collector_id is null in an assignment, THE Taxonomy_Manager SHALL unassign the global type from any collector
4. IF the assignments parameter is not an array, THEN THE Taxonomy_Manager SHALL return a 400 error

### Requirement 5: Filter Group Management

**User Story:** As a platform operator, I want to assign global types to named filter groups, so that I can create custom filtering dimensions independent of the collector hierarchy.

#### Acceptance Criteria

1. WHEN filter groups are queried, THE Taxonomy_Manager SHALL return all global types with their group_name and category information
2. WHEN filter group assignments are updated, THE Taxonomy_Manager SHALL accept an array of objects each containing global_type and group_name (nullable)
3. WHEN processing filter group assignments, THE Taxonomy_Manager SHALL update the group_name field for each specified global type
4. IF the assignments parameter is not an array, THEN THE Taxonomy_Manager SHALL return a 400 error

### Requirement 6: Hotel Filtering by Collectors

**User Story:** As a platform operator, I want to filter hotels by selected collectors, so that I can find hotels matching specific classification criteria.

#### Acceptance Criteria

1. WHEN collector IDs are provided in a hotel query, THE Taxonomy_Manager SHALL look up all global_type codes assigned to each collector
2. THE Taxonomy_Manager SHALL match hotel globalTypes using text LIKE patterns supporting exact matches and slash-separated subtype prefixes (e.g., "GT03-SNOW" matches "GT03-SNOW/ST03-SCHO")
3. THE Taxonomy_Manager SHALL apply AND logic across collectors (hotel must match at least one type from every selected collector) and OR logic within a collector
4. IF any selected collector has no assigned types, THEN THE Taxonomy_Manager SHALL return an empty result set
