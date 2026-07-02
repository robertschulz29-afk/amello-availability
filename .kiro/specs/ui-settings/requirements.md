# Requirements Document

## Introduction

The Settings page (/settings) manages Booking.com session cookies for member pricing access and global type collector configurations for hotel classification. It provides cookie testing, category/collector CRUD, and bulk type assignment workflows.

## Glossary

- **Settings_Page**: The page (/settings) managing Booking.com cookies and global type collector configurations
- **Collector**: A named group of global type codes assigned to a category, used as filter buttons on the Hotels page

## Requirements

### Requirement 1: Settings Management

**User Story:** As a user, I want to configure Booking.com session cookies and global type collectors, so that the platform can access member pricing and categorize hotels.

#### Acceptance Criteria

1. THE Settings_Page SHALL display a "Booking.com Cookies" card with 6 named cookie input fields (bkng, bkng_sso_auth, bkng_sso_session, bkng_sso_ses, pcm_consent, aws-waf-token) each with a descriptive hint
2. THE Settings_Page SHALL provide Save and Test Login buttons for the cookie configuration, displaying test results (logged-in indicators: Genius element, Avatar element, Sign-in text) upon test completion
3. THE Settings_Page SHALL display a "Global Type Collectors" card containing: a Categories section with badge list, delete buttons, and create form; and a two-column layout with collector list on left and collector detail on right
4. WHEN a collector is selected in the list, THE Settings_Page SHALL display the collector detail panel showing: category assignment dropdown, assigned global types list with remove buttons, and a searchable unassigned types list with click-to-assign
5. THE Settings_Page SHALL track pending assignment changes and display a "Save Assignments" button with the pending count indicator, executing a bulk PUT to /api/global_types/assignments on save
