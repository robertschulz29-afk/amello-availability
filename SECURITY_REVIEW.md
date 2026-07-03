# Security & Design Review Report

**Project:** amello-availability  
**Date:** 2025-01-XX  
**Severity scale:** 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low · ⚪ Informational

---

## Executive Summary

The application has several critical and high-severity security issues that should be addressed before any production deployment involving sensitive data. The most urgent problems are around authentication bypass, insecure defaults, and information disclosure. The codebase has solid fundamentals (parameterized queries, password hashing with scrypt, HMAC session tokens) but the configuration and authorization layer is weak.

---

## 🔴 Critical Issues

### 1. Most API routes bypass authentication entirely

**File:** `middleware.ts`

```typescript
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/scans',               // scan creation, listing, stop, delete
  '/api/scan-sources',        // source toggle
  '/api/hotels',              // hotel data
  '/api/settings',            // app settings (cookies etc.)
  '/api/global_types',        // global types and filter group management
  '/api/playwright-scan',     // scan trigger + status polling + process chunks
];
```

**Impact:** Anyone can trigger scans, delete hotels, modify settings, access all hotel data, and manipulate the entire platform without authenticating. The `startsWith` matching means `/api/hotels/123` (DELETE), `/api/scans/123/export`, `/api/settings/booking-cookies` are all unauthenticated.

**Recommendation:** Reverse the whitelist approach — make everything authenticated by default, and only whitelist the login route and possibly health checks. If cron endpoints need to be public for Vercel cron, protect them with a `CRON_SECRET` bearer token check.

---

### 2. Default SESSION_SECRET allows session forgery

**File:** `lib/auth-edge.ts` + `lib/auth.ts`

```typescript
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'changeme-set-SESSION_SECRET-in-env';
```

**Impact:** If `SESSION_SECRET` is not set in the environment, the application uses a hardcoded value. An attacker who knows this (it's in the source code) can forge valid session tokens for any user.

**Recommendation:** Fail hard on startup if `SESSION_SECRET` is not set. Add a startup check that throws an error.

---

### 3. Booking.com session cookies stored in database in plaintext

**File:** `db/init.sql` (migration 017), `app/api/settings/booking-cookies/get.ts`

The `app_settings` table stores Booking.com session cookies as plaintext. These cookies grant authenticated access to a Booking.com account (including Genius member pricing).

**Impact:** Anyone with database read access (or API access since `/api/settings` is unauthenticated — see issue #1) can steal the Booking.com session.

**Recommendation:** 
- Encrypt sensitive settings at rest using an application-level encryption key
- Restrict the settings API to authenticated users only (minimum fix)

---

## 🟠 High Issues

### 4. No CRON_SECRET validation on `/api/scans/process-next`

**File:** `app/api/scans/process-next/route.ts`

The playwright process-next route checks `CRON_SECRET`:
```typescript
const cronSecret = process.env.CRON_SECRET;
if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

But `/api/scans/process-next` has **no such check**. Anyone can trigger scan processing.

**Impact:** An attacker can trigger batch processing at will, burning ScrapingAnt API credits and causing uncontrolled load.

**Recommendation:** Add the same `CRON_SECRET` bearer check to all cron-triggered endpoints.

---

### 5. SSL certificate validation disabled on database connection

**File:** `lib/db.ts`

```typescript
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
```

**Impact:** The application will connect to any server presenting any certificate, making it vulnerable to man-in-the-middle attacks on the database connection. An attacker on the network path could intercept all queries and data.

**Recommendation:** Set `rejectUnauthorized: true` and provide the CA certificate via `PGSSLROOTCERT` or the `ssl.ca` option. If using Vercel Postgres or Supabase, their CA certs are available for download.

---

### 6. Diagnostic routes expose infrastructure information

**Files:** `app/api/diag/route.ts`, `app/api/diag-env/route.ts`

- `/api/diag` reveals which database tables exist and verifies connectivity
- `/api/diag-env` reveals database hostnames and database names

These routes are not in PUBLIC_PATHS but since they start with `/api/diag` (not matching any whitelist prefix), they technically require auth. **However**, if the auth middleware has any bugs or is misconfigured, these become an info leak.

**Impact:** Aids reconnaissance by revealing internal infrastructure details.

**Recommendation:** Remove these routes from production or gate them behind an explicit admin check and a separate secret.

---

### 7. ScrapingAnt API key only validated at runtime

**File:** `app/api/scans/process/booking/_handler.ts`

```typescript
const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';
```

If the key is empty, the fetch to ScrapingAnt will fail at runtime but the function happily proceeds to build and send the request. Combined with issue #4, an attacker could trigger hundreds of calls that log errors and consume resources.

**Recommendation:** Validate required secrets at application startup or module initialization. Return a clear 503 if scraping infrastructure is not configured.

---

## 🟡 Medium Issues

### 8. No rate limiting on login endpoint

**File:** `app/api/auth/login/route.ts`

The login route has no protection against brute force attacks. An attacker can attempt unlimited password guesses.

**Recommendation:** Add rate limiting (e.g., per-IP sliding window using Redis/KV, or at minimum a Vercel WAF rule). Consider account lockout after N failed attempts.

---

### 9. No input validation library — ad-hoc validation throughout

The entire codebase uses manual `if/else` checks for input validation. There is no schema validation (no zod, joi, etc.).

**Impact:** Inconsistent validation, easy to miss edge cases, harder to maintain.

**Example** (multiple routes):
```typescript
const jobId = Number(body?.jobId);
if (!Number.isFinite(jobId) || jobId <= 0) { ... }
```

**Recommendation:** Adopt `zod` for request body validation. Define schemas per endpoint for type safety and consistent error messages.

---

### 10. Chromium launched with `--no-sandbox`

**File:** `lib/scrapers/browser-launch.ts`

```typescript
export const LAUNCH_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--no-zygote', ...
];
```

**Impact:** If a malicious page exploits a Chromium vulnerability, there's no sandbox to contain it. While this is common for serverless environments (where the container IS the sandbox), it's worth documenting as an accepted risk.

**Recommendation:** Accepted risk in serverless context. Document this decision. Ensure Chromium is regularly updated (currently v143).

---

### 11. No CORS configuration

There is no CORS configuration anywhere in the project. Next.js API routes default to same-origin, but if the frontend is deployed on a different domain or accessed via a different origin, responses will be blocked — or worse, if someone adds permissive CORS later without understanding the auth bypass.

**Recommendation:** Explicitly configure CORS headers for API routes, even if currently same-origin. This prevents accidental misconfiguration later.

---

### 12. Session token has no revocation mechanism

**Files:** `lib/auth.ts`, `lib/auth-edge.ts`

Session tokens are stateless (HMAC-signed payloads with expiry). There is no server-side session store or token blacklist.

**Impact:** If a session is compromised, it cannot be invalidated until natural expiry (8 hours). Logout only clears the cookie client-side but the token remains valid if captured.

**Recommendation:** For an internal tool with one admin user, this is acceptable risk. Document it. If more users are added, consider a server-side session store or at minimum a "last valid token issued at" timestamp per user.

---

## 🔵 Low Issues

### 13. No `.env.example` file

There is no documentation of required environment variables. New developers or deployments may miss critical secrets.

**Required variables (identified from code):**
- `DATABASE_URL` or `POSTGRES_URL`
- `SESSION_SECRET`
- `SCRAPINGANT_API_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOOKING_COM_COOKIES` (optional, DB-backed alternative exists)
- `AMELLO_BASE_URL` (optional, has default)

**Recommendation:** Create a `.env.example` with all required/optional vars documented.

---

### 14. Error messages leak internal details

Multiple routes return `e.message` directly to the client:

```typescript
return NextResponse.json({ error: e.message }, { status: 500 });
```

**Impact:** Stack traces, DB error messages, or internal service URLs could be exposed to attackers.

**Recommendation:** Return generic error messages to clients. Log detailed errors server-side only.

---

### 15. Puppeteer-core is unused but still a dependency

**File:** `package.json`

Both `playwright-core` and `puppeteer-core` are listed as dependencies. Only Playwright is used in the code.

**Recommendation:** Remove `puppeteer-core` to reduce attack surface and bundle size.

---

## ⚪ Design Observations

### 16. `filter-groups` route references columns that were dropped in migration 020

**File:** `app/api/global_types/filter-groups/route.ts`

This route queries `type_name`, `type_category`, `group_name` columns which were dropped by migration 020. It will throw a SQL error if run against the current `init.sql` schema.

**Recommendation:** Remove or rewrite this endpoint to use the current schema (collector-based).

---

### 17. Hotels table uses TEXT column for globalTypes instead of JSONB

**File:** `db/init.sql`

```sql
"globalTypes" TEXT
```

The column stores JSON arrays but as a TEXT type. This means no JSON indexing, no `@>` containment queries, and forces brittle LIKE matching in the hotel filter.

**Recommendation:** Convert to `JSONB` and use proper `@>` or `?|` operators for filtering. This also enables GIN indexing.

---

### 18. Scan processing uses self-referencing HTTP calls

**File:** `app/api/scans/process-next/route.ts`

```typescript
const url = `${getBaseUrl()}/api/scans/process/${source}`;
const response = await fetch(url, { ... });
```

The cron handler makes an HTTP request to itself (its own server) to trigger processing. This adds network latency, can fail due to cold starts, and adds auth complexity.

**Recommendation:** Refactor to direct function calls. Import the processing logic as a module and invoke it directly within the same request lifecycle.

---

### 19. No database connection pool monitoring

The pool is set to `max: 1` which is correct for Vercel serverless, but there's no connection error handling, retry logic, or health monitoring.

**Recommendation:** Add a connection error handler on the pool (`pool.on('error', ...)`) to log and handle unexpected disconnections gracefully.

---

### 20. Mixed quoted/unquoted identifiers

The codebase mixes `"globalTypes"` (quoted, case-sensitive PostgreSQL identifier) with snake_case columns. This creates confusion and makes queries harder to write.

**Recommendation:** When feasible, rename the column to `global_types` (snake_case JSONB) and update all references. This is a breaking change that requires a data migration.

---

## Prioritized Action Plan

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | Fix PUBLIC_PATHS — authenticate all API routes by default | 1–2 hours |
| 2 | Fail hard if SESSION_SECRET is not set | 10 minutes |
| 3 | Add CRON_SECRET check to `/api/scans/process-next` | 15 minutes |
| 4 | Enable SSL cert validation on DB connection | 30 minutes |
| 5 | Create `.env.example` documenting all secrets | 20 minutes |
| 6 | Add rate limiting to login endpoint | 1–2 hours |
| 7 | Stop returning raw `e.message` to clients | 1 hour |
| 8 | Remove diagnostic routes from production | 15 minutes |
| 9 | Fix dead `filter-groups` endpoint | 30 minutes |
| 10 | Encrypt sensitive settings in DB | 2–3 hours |
