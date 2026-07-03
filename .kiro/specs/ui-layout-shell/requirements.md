# Requirements Document

## Introduction

The Layout Shell provides the consistent navigation structure for the amello-availability platform. It includes the fixed topbar with branding and controls, sidebar navigation with section grouping, responsive mobile overlay behavior, theme management, and login/logout flows.

## Glossary

- **Layout_Shell**: The shared layout component providing fixed topbar, sidebar navigation, back-to-top button, and body scroll management
- **Theme_Context**: The React context managing light/dark theme state with localStorage persistence and system preference detection
- **Back_To_Top_Button**: A floating button that appears after 300px of vertical scroll enabling smooth scroll to page top
- **API_Client**: The centralized `fetchJSON` utility that handles base URL construction, Bello-Mandator header injection, JSON parsing, and error handling

## Requirements

### Requirement 1: Application Layout Shell

**User Story:** As a user, I want a consistent navigation layout with sidebar and topbar, so that I can access all application pages efficiently.

#### Acceptance Criteria

1. THE Layout_Shell SHALL render a fixed topbar containing the TUI logo, a theme toggle button, a logout button, and a hamburger menu button visible on mobile viewports
2. THE Layout_Shell SHALL render a fixed sidebar with two navigation sections: "Reports" containing links to Dashboard, Portfolio Health, Rate Report, Scan Results, and Rooms/CR-API; and "Setup" containing links to Scan Setup, Room Mappings, Hotels, and Settings
3. WHEN the current pathname matches a sidebar link href, THE Layout_Shell SHALL apply the "active" CSS class to that link element
4. WHEN the viewport width is less than 768px, THE Layout_Shell SHALL collapse the sidebar into a slide-in overlay triggered by the hamburger menu button
5. WHILE the mobile sidebar overlay is open, THE Layout_Shell SHALL display a backdrop element and lock body scroll by setting overflow to hidden
6. WHEN a navigation route change occurs while the mobile sidebar is open, THE Layout_Shell SHALL close the sidebar overlay
7. WHEN the user scrolls more than 300px vertically, THE Layout_Shell SHALL display the Back_To_Top_Button
8. WHEN the user clicks the Back_To_Top_Button, THE Layout_Shell SHALL scroll the page to the top with smooth behavior
9. WHEN the current pathname is "/login", THE Layout_Shell SHALL render only the page children without the topbar and sidebar
10. THE Layout_Shell SHALL implement responsive column layouts: 3-column hotel card grids on viewports ≥992px, 2-column on viewports ≥768px, and 1-column below 768px

### Requirement 2: Theme Management

**User Story:** As a user, I want to toggle between light and dark themes, so that I can use the application comfortably in different lighting conditions.

#### Acceptance Criteria

1. THE Theme_Context SHALL initialize the theme from localStorage if a valid value ("light" or "dark") exists
2. IF no saved theme exists in localStorage, THEN THE Theme_Context SHALL detect the system color scheme preference and use "dark" when prefers-color-scheme is dark, otherwise "light"
3. WHEN the theme state changes, THE Theme_Context SHALL persist the new value to localStorage and set both "data-bs-theme" and "data-theme" attributes on the document root element
4. WHEN the user clicks the theme toggle button, THE Theme_Context SHALL switch the theme from "light" to "dark" or from "dark" to "light"
5. THE Theme_Context SHALL display a sun icon in dark mode and a moon icon in light mode on the toggle button

### Requirement 3: Authentication and Login

**User Story:** As a user, I want to authenticate with username and password, so that I can access the protected application.

#### Acceptance Criteria

1. THE Login page SHALL render a centered card containing a form with username input, password input, and a "Sign in" submit button on a light background
2. WHEN the user submits the login form, THE Login page SHALL send a POST request to /api/auth/login with JSON body containing username and password
3. WHILE the login request is in progress, THE Login page SHALL disable the submit button and display "Signing in…" text
4. WHEN the login API returns a successful response, THE Login page SHALL redirect to "/" using window.location.href
5. IF the login API returns an error response, THEN THE Login page SHALL display the error message in an inline alert element below the form fields
6. WHEN the user clicks the logout button in the topbar, THE Layout_Shell SHALL send a POST request to /api/auth/logout and redirect to "/login" using window.location.href

### Requirement 4: API Client Communication

**User Story:** As a developer, I want a centralized fetch wrapper, so that all API requests use consistent headers and error handling.

#### Acceptance Criteria

1. THE API_Client SHALL include the "Bello-Mandator" header with the configured default mandator value on every request
2. WHEN NEXT_PUBLIC_API_URL environment variable is set, THE API_Client SHALL prepend the base URL to all request paths
3. IF the API response status is not OK, THEN THE API_Client SHALL parse the response body for an error message and throw an Error with that message
4. WHEN the API response body is empty, THE API_Client SHALL return null instead of attempting JSON parse
5. THE API_Client SHALL return the parsed JSON response body for successful non-empty responses

### Requirement 5: Shared Components

**User Story:** As a developer, I want reusable UI components, so that consistent behavior and styling are maintained across all pages.

#### Acceptance Criteria

1. THE Hotel_Combobox SHALL render a multi-select dropdown that groups hotels by brand, provides a search filter, select all/deselect all buttons, brand-level toggle with indeterminate checkbox state, and a selection count footer
2. WHEN the user clicks outside the Hotel_Combobox dropdown, THE Hotel_Combobox SHALL close the dropdown and clear the search query
3. THE Pagination_Bar SHALL render page navigation buttons (first/prev/next/last), an items-per-page select with options (5/10/25/50/100), and a total count display showing "Page X of Y (Z items)"
4. WHEN the total items count is zero, THE Pagination_Bar SHALL render nothing
5. THE Scan_Info_Card SHALL render a scan dropdown formatted as "#ID • datetime • status" and display scan metadata including: scan ID, scanned at timestamp, timezone, base check-in date, days scanned, stay nights, and hotel counts (total and bookable+active)
6. THE Price_Formatter SHALL format numeric values with Euro symbol prefix and 2 decimal places, return a dash character for null/undefined/non-finite inputs, and support currency code mapping for USD ($), GBP (£), JPY (¥), and CHF
