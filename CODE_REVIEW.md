# Code Review Report

**Project:** amello-availability  
**Date:** 2025-01-XX  
**Scope:** Architecture, code quality, patterns, bugs, and design issues  
**Note:** Security issues were covered in SECURITY_REVIEW.md and fixes already applied.

---

## Architecture Overview

- **Framework:** Next.js 14.2 with App Router, almost exclusively `'use client'` pages
- **Styling:** Bootstrap 5.3 via CDN + custom CSS, Font Awesome icons
- **State:** React useState/useEffect, no external state library
- **Data fetching:** Client-side `fetchJSON` wrapper over `fetch`, no server components used for data
- **Database:** PostgreSQL via `pg` pool, custom tagged-template `sql` helper
- **Scraping:** ScrapingAnt proxy for Booking.com, Playwright/Chromium for TUI site

---

## 🔴 Bugs & Broken Code

### 1. `/api/global_types/filter-groups` queries dropped columns

**File:** `app/api/global_types/filter-groups/route.ts`

This route queries `type_name`, `type_category`, `group_name` — all three were dropped in migration 020. Running this endpoint against the current schema throws a SQL error.

**Fix:** Remove or rewrite to use the current collector-based schema.

---

### 2. `scan_hotels` INSERT is missing required columns

**File:** `app/api/scans/route.ts` (line ~170)

```typescript
INSERT INTO scan_hotels (scan_id, hotel_id, code, bookable, active)
SELECT $1, id, code, bookable, active FROM hotels ...
```

But the `scan_hotels` table requires `name` (NOT NULL):
```sql
CREATE TABLE scan_hotels (
  ...
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  ...
)
```

The INSERT omits `name`, which will fail with a NOT NULL violation.

**Fix:** Add `name` to the INSERT column list and SELECT.

---

### 3. Dashboard fetches entire scan result set client-side

**File:** `app/page.tsx`

```typescript
fetchJSON(`/api/scans/${selectedScanId}`)
  .then(data => {
    const fs: FullSetEntry[] = Array.isArray(data?.fullSet) ? data.fullSet : [];
    setFullSet(fs);
  })
```

The dashboard downloads the entire `fullSet` (every scan result for a scan — potentially thousands of rows) into the browser to compute availability percentages and pricing conflicts. This is extremely inefficient for large scans.

**Impact:** Page load times of 10+ seconds for scans with many hotels × many days.

**Fix:** Move availability and pricing computations to the server. Create dedicated API endpoints that return pre-computed summary data.

---

## 🟠 Design Issues

### 4. No server components — everything is `'use client'`

Every page is a client component that fetches data in `useEffect`. This means:
- No SSR/streaming benefits
- No search-engine indexability (not critical for internal tool)
- All data fetching waterfalls are visible to the user as loading states
- Larger JS bundles since page logic ships to client

For an internal tool this is acceptable, but the dashboard (issue #3) and rate-comparison page suffer from transferring large datasets to the client for processing.

**Recommendation:** For data-heavy pages, add API endpoints that do the aggregation server-side and return only the summary.

---

### 5. CDN-loaded dependencies (Bootstrap, Font Awesome, Fonts)

**File:** `app/layout.tsx`

```html
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" .../>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
```

**Issues:**
- External CDN dependency means offline doesn't work
- CDN outage = broken styling
- No tree-shaking — loading all of Font Awesome (>100KB) for ~20 icons
- Content Security Policy (CSP) harder to configure

**Recommendation:** Install `bootstrap` and a Font Awesome subset as npm packages. This improves reliability and reduces bundle size.

---

### 6. Self-referencing HTTP calls in scan processing

**Files:** `app/api/scans/route.ts`, `app/api/scans/process-next/route.ts`

The scan creation route triggers processing by making HTTP requests back to itself:
```typescript
fetch(`${getBaseUrl()}/api/scans/process/${source}`, { method: 'POST', ... })
```

**Problems:**
- Adds network latency to every batch
- Can fail on cold starts (Vercel serverless)
- Extra HTTP request overhead on each cron tick
- Harder to debug (distributed trace)

**Recommendation:** Import the processing logic as a module and call it directly:
```typescript
import { processAmelloBatch } from '@/lib/processors/amello';
await processAmelloBatch({ jobId, startIndex, size });
```

---

### 7. Rate comparison page is 700+ lines of mixed concerns

**File:** `app/rate-comparison/page.tsx` (~750 lines)

This single file contains:
- Type definitions (15+ types)
- Utility functions (sorting, filtering, coloring, data transformation)
- Multiple sub-components (SortTh, DiffCell, RateNameCell)
- Full page logic with heavy state management
- Two table renderers (best-rate and all-rates)

**Recommendation:** Extract into:
- `lib/rate-comparison-utils.ts` (pure functions)
- `app/rate-comparison/components/BestRateTable.tsx`
- `app/rate-comparison/components/AllRatesTable.tsx`
- `app/rate-comparison/hooks/useRateData.ts`

---

### 8. Hotels page is 500+ lines with inline modals

**File:** `app/hotels/page.tsx` (~500 lines)

Contains three modal implementations (edit, delete, global types) inline with the page logic. Each modal has its own state management creating a complex state space.

**Recommendation:** Extract modals into separate components (`EditHotelModal`, `DeleteHotelModal`, `GlobalTypesModal`).

---

## 🟡 Code Quality Issues

### 9. Inconsistent error handling in API routes

Some routes return `e.message` (leaking internals), others return generic messages. No consistent pattern:

```typescript
// Bad — leaks internals
return NextResponse.json({ error: e.message }, { status: 500 });

// Better — generic message
return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
```

**Recommendation:** Create a helper that logs the full error server-side and returns a generic message:
```typescript
function apiError(message: string, e: unknown, status = 500) {
  console.error(`[API] ${message}:`, e);
  return NextResponse.json({ error: message }, { status });
}
```

---

### 10. `useEffect` dependency warnings suppressed throughout

Multiple pages use `// eslint-disable-line react-hooks/exhaustive-deps`:

```typescript
React.useEffect(() => { ... }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

This hides potential stale-closure bugs. The initial load effects reference callbacks that may change.

**Recommendation:** Use the `useCallback` pattern properly or restructure to avoid the warning legitimately.

---

### 11. No loading/error boundaries

Pages handle loading and error states individually with inline conditional rendering. If a page crashes, the entire app goes blank.

**Recommendation:** Add a root `error.tsx` boundary and consider `loading.tsx` files for route-level loading states.

---

### 12. `price-utils.ts` has overly defensive code

**File:** `lib/price-utils.ts` (300+ lines)

The `extractPriceValue` function searches through 10+ possible field names, handles nested objects recursively, and tries to parse prices from arbitrary string formats. While defensive, this makes debugging price extraction issues very difficult — it's unclear which path produced a given price.

**Recommendation:** Since there are only 2 actual sources (Amello API and Booking HTML), write two explicit extractors rather than one generic one. This makes the code testable and debuggable.

---

### 13. Repeated hotel fetch pattern across pages

Every page independently fetches `/api/hotels?active=1&bookable=1` and stores it in local state. The dashboard, scan-results, rate-comparison, and status-overview pages all do this.

**Recommendation:** Create a shared hook `useHotels()` or a React context that caches the hotel list. Hotels rarely change during a session.

---

### 14. No TypeScript `strict` null checks effectively used

While `tsconfig.json` has `strict: true`, many places use `any` types or unsafe access patterns:

```typescript
const job = jobQ.rows[0]; // could be undefined if rows is empty
const { job_id: jobId } = job; // runtime error if job is undefined
```

The `rows[0]` pattern is used without checking for empty results in several API routes.

**Recommendation:** Add early-return guards after every DB query that expects rows.

---

### 15. Database queries built with string concatenation (safe but fragile)

**Files:** `app/api/scan-results/route.ts`, `app/api/rate-comparison/route.ts`

While these use parameterized values (safe from injection), the query strings are built with complex string concatenation:

```typescript
const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
```

This is hard to read and maintain for complex queries (the rate-comparison query is ~80 lines of interpolated SQL).

**Recommendation:** Consider a lightweight query builder pattern or at minimum extract the SQL into named template strings in a separate file.

---

## 🔵 Minor Issues

### 16. Unused `parseGlobalTypes` function in hotels page
The function is defined but never called in the component render logic.

### 17. `react-hooks/exhaustive-deps` is treated as a suggestion
The eslint rule is disabled on multiple hooks rather than being properly addressed.

### 18. No test coverage
Despite having jest configured, the `__tests__` directory was not found. Zero test coverage for a scraping-heavy application with complex price parsing logic.

### 19. `puppeteer-core` is an unused dependency
Only `playwright-core` is used in the codebase. Remove `puppeteer-core` from `package.json`.

### 20. `name` not in package.json
The `package.json` is missing a `name` field, which can cause issues with some tooling.

---

## Regarding the Dashboard Spec

There is **no spec for the dashboard/frontend UI**. The existing 9 specs cover only backend API functionality. The frontend has these pages that lack documentation:

| Page | Function |
|------|----------|
| `/` (Dashboard) | KPI donuts, availability by country/brand, pricing conflicts |
| `/portfolio-health` | Hotel availability health metrics |
| `/rate-comparison` | Side-by-side price comparison (best-rate + all-rates views) |
| `/scan-results` | Paginated scan result browser with filters |
| `/status-overview` | Scan creation form + scan list with progress |
| `/hotels` | Hotel CRUD with filters, modals, global type filter |
| `/room-mappings` | Cross-source room name mapping management |
| `/rooms-cr-api` | CR-API room imagery browser |
| `/settings` | Booking.com cookies + global type collectors |
| `/imagery-mappings` | Imagery-to-scan room mapping |

Want me to create a dashboard/UI spec covering these?

---

## Prioritized Action Items

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | Fix broken `filter-groups` endpoint (#1) | 30 min |
| 2 | Fix missing `name` column in scan_hotels INSERT (#2) | 10 min |
| 3 | Add server-side summary endpoints for dashboard (#3) | 3-4 hours |
| 4 | Extract rate-comparison page into components (#7) | 2 hours |
| 5 | Create shared `useHotels` hook (#13) | 1 hour |
| 6 | Add error boundaries (#11) | 30 min |
| 7 | Standardize API error handling (#9) | 1-2 hours |
| 8 | Add tests for price-utils (#18) | 2-3 hours |
| 9 | Remove unused dependency (#19) | 5 min |
| 10 | Move CDN deps to npm packages (#5) | 1-2 hours |
