# Requirements Document

## Introduction

The User Authentication module provides simple username/password authentication with HTTP-only session cookies. It protects the platform from unauthorized access using a straightforward login/logout flow without complex role-based access control.

## Glossary

- **Auth_System**: The authentication subsystem handling user login/logout with session cookies
- **Session_Token**: A signed token stored in an HTTP-only cookie that identifies an authenticated user
- **Password_Hash**: A securely hashed password stored in the users table (using salt:hash format)
- **Cookie_Name**: The name of the session cookie used for authentication
- **Max_Age**: The maximum lifetime of the session cookie before it expires

## Requirements

### Requirement 1: User Login

**User Story:** As a platform user, I want to log in with my username and password, so that I can access the platform's functionality.

#### Acceptance Criteria

1. WHEN valid credentials (username and password) are submitted via POST, THE Auth_System SHALL verify the password against the stored hash
2. WHEN authentication succeeds, THE Auth_System SHALL create a session token containing the username
3. WHEN authentication succeeds, THE Auth_System SHALL set the session token in a cookie with httpOnly=true, secure=true (in production), sameSite=lax, configured maxAge, and path=/
4. IF username or password is missing from the request body, THEN THE Auth_System SHALL return a 400 error with message "Missing credentials"
5. IF the username does not exist in the database, THEN THE Auth_System SHALL return a 401 error with message "Invalid username or password"
6. IF the password does not match the stored hash, THEN THE Auth_System SHALL return a 401 error with the same generic message "Invalid username or password"

### Requirement 2: User Logout

**User Story:** As a platform user, I want to log out, so that my session is terminated and the browser cookie is cleared.

#### Acceptance Criteria

1. WHEN a logout is requested via POST, THE Auth_System SHALL clear the session cookie by setting it to an empty value with maxAge=0 and path=/
2. THE Auth_System SHALL return a success response ({ok: true}) after clearing the cookie

### Requirement 3: Session Security

**User Story:** As a platform operator, I want sessions to be secure against common web attacks, so that unauthorized users cannot hijack authenticated sessions.

#### Acceptance Criteria

1. THE Auth_System SHALL store passwords using a salt:hash format with cryptographic hashing
2. THE Auth_System SHALL set the secure flag on session cookies when running in production mode (NODE_ENV=production)
3. THE Auth_System SHALL use httpOnly cookies to prevent client-side JavaScript access to the session token
4. THE Auth_System SHALL use sameSite=lax to protect against CSRF attacks while allowing normal navigation
