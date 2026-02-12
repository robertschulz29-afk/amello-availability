# amello-availability

## Configuration

### Database Setup

Before running the application, ensure the database schema is up to date by running migrations:

```bash
node scripts/migrate.mjs
```

This will apply all database migrations in order, including:
- Initial schema (hotels, scans, scan_results)
- Extended scan results tables
- Source tracking for multi-source scans

### Environment Variables

Create a `.env` file in the project root (see `.env.example` for reference):

- **DATABASE_URL** (required): PostgreSQL connection string (pooled connection URL from Supabase or your provider)
- **NEXT_PUBLIC_API_URL** (optional): Full URL of the backend API server (e.g., `https://api.example.com`)
  - If not set, API requests will use relative paths (calls to the same Next.js server)
  - Set this when deploying frontend and backend separately
- **API_BASE_URL** (optional): Server-side only API URL (alternative to NEXT_PUBLIC_API_URL)
- **AMELLO_BASE_URL** (optional): Base URL for the Amello API (defaults to `https://prod-api.amello.plusline.net/api/v1`)

### Vercel/Lambda Deployment

When deploying to Vercel or AWS Lambda, additional configuration is required for the web scraping functionality:

1. **Set Environment Variable in Vercel Dashboard**:
   - Go to your project settings in Vercel
   - Navigate to "Environment Variables"
   - Add: `AWS_LAMBDA_JS_RUNTIME` = `nodejs20.x`
   - This environment variable must be set in the Vercel dashboard, NOT in your `.env` file
   - It ensures `@sparticuz/chromium` uses the correct binaries for the Lambda runtime

2. **Chromium Binary Handling**:
   - The `@sparticuz/chromium` package provides pre-built Chromium binaries for serverless environments
   - These are automatically extracted to `/tmp` in Lambda (the only writable directory)
   - The `next.config.mjs` is configured to mark chromium as external to prevent webpack bundling issues

3. **Function Size Limits**:
   - Vercel has a 50MB limit on uncompressed Lambda function size
   - The full `@sparticuz/chromium` package fits within this limit
   - If you encounter size issues, consider using `@sparticuz/chromium-min` with a remote binary URL

### API Client

All frontend API requests use the `fetchJSON` utility from `lib/api-client.ts`, which:
- Automatically adds the `Bello-Mandator: amello.en` header to all requests
- Constructs full API URLs using `NEXT_PUBLIC_API_URL` if configured
- Falls back to relative paths for backward compatibility

## Core Features

### Scan history
- **Create new scan**: POST `/api/scans` (button "New scan"). Persists a row in `scans` and all cells in `scan_results`.
- **List scans**: GET `/api/scans`.
- **Load a past scan**: GET `/api/scans/{id}`. The UI dropdown loads any historical scan and renders the saved matrix.
- **Process scan**: POST `/api/scans/process` - Process Amello API data for a scan.

All scans use Europe/Berlin; dates are fixed at startOffset=5, endOffset=90 and fixed checkout = today+12 (relative to the scan time).

## Multi-Source Booking Scraper

The application now supports scanning multiple booking sources (Booking.com, Expedia, etc.) via web scraping.

### Database Schema

#### `scan_sources` table
Stores configuration for different booking sources:
- `name` - Source name (e.g., "Booking.com", "Expedia")
- `enabled` - Whether the source is active
- `base_url` - Base URL pattern for the booking site
- `css_selectors` - JSON object with CSS selectors for data extraction
- `rate_limit_ms` - Minimum delay between requests (default: 2000ms)
- `user_agent_rotation` - Enable User-Agent rotation (default: true)

#### `scan_results_extended` table
Stores scraped data from multiple sources:
- Links to `scan_id`, `hotel_id`, and `source_id`
- `status` - 'green', 'red', 'pending', or 'error'
- `scraped_data` - Full scraped data as JSONB
- `price`, `currency`, `availability_text` - Extracted fields
- `error_message` - Error details if scraping failed

### Web Scraping Infrastructure

Located in `lib/scrapers/`:

- **BaseScraper** - Abstract base class with bot detection prevention:
  - User-Agent rotation
  - Request rate limiting with configurable delays
  - Retry logic with exponential backoff
  - CSS selector-based HTML parsing
  - Cookie/session management support

- **Utilities**:
  - `utils/user-agents.ts` - User-Agent rotation (10+ real browser UAs)
  - `utils/delays.ts` - Request throttling and rate limiting
  - `utils/html-parser.ts` - HTML parsing with cheerio
  - `utils/retry.ts` - Retry logic with exponential backoff

### API Endpoints

#### Scan Sources
- `GET /api/scan-sources` - List all configured booking sources
- `POST /api/scan-sources` - Create or update a booking source
- `PATCH /api/scan-sources` - Bulk update sources (enable/disable)

#### Scraping
- `POST /api/scans/scrape` - Trigger scraping for selected sources

Request body:
```json
{
  "scanId": 123,
  "sourceIds": [1, 2],
  "hotelIds": [10, 20],
  "startIndex": 0,
  "size": 10
}
```

### Usage Example

1. Create a scan source:
```bash
curl -X POST http://localhost:3000/api/scan-sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Booking.com",
    "enabled": true,
    "base_url": "https://www.booking.com/...",
    "css_selectors": {
      "price": ".price",
      "availability": ".availability"
    },
    "rate_limit_ms": 3000
  }'
```

2. Trigger scraping:
```bash
curl -X POST http://localhost:3000/api/scans/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "scanId": 1,
    "sourceIds": [1],
    "size": 10
  }'
```

### Extending with Custom Scrapers

To add a new booking source scraper:

1. Create a new class extending `BaseScraper`:
```typescript
import { BaseScraper } from '@/lib/scrapers/BaseScraper';

class BookingComScraper extends BaseScraper {
  protected buildURL(request: ScrapeRequest): string {
    // Build the URL for Booking.com
  }

  protected processData(data: Record<string, string | null>, html: string): ScrapeResult {
    // Extract and process availability data
  }
}
```

2. Use the scraper in `/api/scans/scrape`:
```typescript
const scraper = new BookingComScraper(source);
const result = await scraper.scrape({ hotelCode, checkInDate, checkOutDate });
```

### Notes
- CSS selectors and URL patterns are stored per source and can be updated via API
- Bot detection prevention is built-in (User-Agent rotation, rate limiting, random delays)
- Framework is ready for production use - specific scraper implementations to be added per source
