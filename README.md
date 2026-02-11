# amello-availability

## Configuration

### Required Environment Variables

- `AMELLO_MANDATOR_ID` - TUI Amello API Mandator ID (required for hotel availability API calls)
- `AMELLO_BASE_URL` - Amello API base URL (default: `https://prod-api.amello.plusline.net/api/v1`)
- `DATABASE_URL` - PostgreSQL connection string

The Mandator ID is a unique identifier assigned by TUI during partner onboarding and is required for all API requests to the Amello platform.

## Core Features

### Scan history
- **Create new scan**: POST `/api/scans` (button "New scan"). Persists a row in `scans` and all cells in `scan_results`.
- **List scans**: GET `/api/scans`.
- **Load a past scan**: GET `/api/scans/{id}`. The UI dropdown loads any historical scan and renders the saved matrix.
- **Process scan**: POST `/api/scans/process` - Process Amello API data for a scan.

All scans use Europe/Berlin; dates are fixed at startOffset=5, endOffset=90 and fixed checkout = today+12 (relative to the scan time).

## Scrape Monitoring & Logging

**NEW**: Comprehensive monitoring infrastructure for web scraping health and reliability.

Features:
- ✅ Structured event logging for every scrape attempt
- ✅ Real-time metrics aggregation (success rate, errors, blocks, timeouts)
- ✅ Dashboard widget for at-a-glance health status
- ✅ Monitoring page at `/monitoring` with daily/weekly trends
- ✅ Automatic alerting when success rate drops or blocks increase
- ✅ CSV export for detailed analysis

**[📖 Full Documentation](docs/SCRAPE_MONITORING.md)**

### Quick Start

1. Apply database migration:
   ```bash
   psql $DATABASE_URL < db/migrations/007_scrape_logs.sql
   ```

2. Scraping is automatically logged:
   ```typescript
   const scraper = new BookingComScraper(source);
   scraper.setLoggingContext({ scanId, hotelId, hotelName });
   await scraper.scrape(request); // Logged automatically
   ```

3. View monitoring dashboard:
   - Navigate to `/monitoring`
   - Or use `<ScrapeHealthWidget scanId={123} />` component

## Multi-Source Booking Scraper

The application now supports scanning multiple booking sources (Booking.com, Expedia, etc.) via web scraping.

### Database Schema

#### `scrape_logs` table (NEW)
Stores detailed logs of every scrape attempt:
- `scrape_status` - success, error, timeout, block, manual_review
- `http_status`, `response_time_ms`, `retry_count`
- `reason` - Human-readable failure reason
- Full context: hotel, scan, date, URL, user-agent

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
  - **Automatic logging** of all scrape attempts
  - Cookie/session management support

- **Utilities**:
  - `utils/user-agents.ts` - User-Agent rotation (10+ real browser UAs)
  - `utils/delays.ts` - Request throttling and rate limiting
  - `utils/html-parser.ts` - HTML parsing with cheerio
  - `utils/scrape-logger.ts` - **NEW**: Logging and metrics utilities
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
