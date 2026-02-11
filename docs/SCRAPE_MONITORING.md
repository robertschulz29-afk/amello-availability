# Scrape Monitoring & Logging

This document describes the scrape monitoring and logging infrastructure added to the amello-availability application.

## Overview

The scrape monitoring system provides comprehensive visibility into web scraping health, failure patterns, and rate limits through:
- Structured event logging for every scrape attempt
- Real-time metrics aggregation
- Dashboard widgets for at-a-glance health status
- Detailed monitoring page with trends and failure analysis
- Automatic alerting based on configurable thresholds

## Database Migration

Before using the monitoring features, you need to apply the database migration:

```bash
# Connect to your PostgreSQL database
psql $DATABASE_URL

# Apply the migration
\i db/migrations/007_scrape_logs.sql

# To rollback (if needed):
\i db/migrations/rollback_007_scrape_logs.sql
```

The migration creates a `scrape_logs` table with the following schema:

```sql
CREATE TABLE scrape_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  scan_id INTEGER REFERENCES scans(id),
  hotel_id INTEGER REFERENCES hotels(id),
  hotel_name VARCHAR(255),
  scrape_status VARCHAR(50) NOT NULL CHECK (scrape_status IN ('success', 'error', 'timeout', 'block', 'manual_review')),
  http_status INTEGER,
  delay_ms INTEGER,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  user_agent TEXT,
  reason TEXT,
  response_time_ms INTEGER,
  session_id VARCHAR(100),
  url TEXT,
  check_in_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Architecture

### Components

1. **`lib/scrapers/utils/scrape-logger.ts`**
   - Core logging utility functions
   - Metrics aggregation
   - Threshold checking and alerting

2. **`lib/scrapers/BaseScraper.ts`**
   - Modified to automatically log all scrape attempts
   - Tracks timing, HTTP status, retries, and errors
   - Non-blocking async logging

3. **API Routes**
   - `GET /api/scrape-logs` - Fetch logs with filters
   - `GET /api/scrape-metrics` - Get aggregated metrics for a scan
   - `GET /api/scrape-health` - Daily health metrics and trends

4. **UI Components**
   - `app/components/ScrapeHealthWidget.tsx` - Compact health widget
   - `app/monitoring/page.tsx` - Full monitoring dashboard

## Usage

### Automatic Logging

All scrape attempts are automatically logged when using `BaseScraper`. No additional code is required.

To set logging context (scan_id, hotel_id, hotel_name):

```typescript
const scraper = new BookingComScraper(source);

// Set context before scraping
scraper.setLoggingContext({
  scanId: 123,
  hotelId: 456,
  hotelName: "Hotel Example"
});

// Scrape - logging happens automatically
const result = await scraper.scrape(request);
```

### Fetching Metrics

```typescript
import { getScrapeMetrics, alertOnThresholds } from '@/lib/scrapers/utils/scrape-logger';

// Get metrics for a scan
const metrics = await getScrapeMetrics(scanId);

console.log(`Success rate: ${metrics.success_percentage.toFixed(1)}%`);
console.log(`Total attempts: ${metrics.total_attempts}`);
console.log(`Block count: ${metrics.block_count}`);

// Check thresholds and log alerts
await alertOnThresholds(scanId);
```

### Using the Widget

```tsx
import { ScrapeHealthWidget } from '@/app/components/ScrapeHealthWidget';

function MyPage() {
  return (
    <div>
      <ScrapeHealthWidget 
        scanId={123} 
        autoRefresh={true}
        refreshInterval={5000}
      />
    </div>
  );
}
```

### Accessing the Monitoring Page

Navigate to `/monitoring` to view:
- Daily success rates for the last 7/14/30 days
- Top failure reasons
- Summary statistics
- Recent scrape logs with filtering
- CSV export functionality

## API Reference

### GET /api/scrape-logs

Fetch scrape logs with optional filters.

**Query Parameters:**
- `scan_id` - Filter by scan ID
- `hotel_id` - Filter by hotel ID
- `status` - Filter by scrape status (success, error, timeout, block, manual_review)
- `limit` - Number of records (default: 100, max: 1000)
- `offset` - Pagination offset (default: 0)

**Example:**
```bash
curl "http://localhost:3000/api/scrape-logs?scan_id=123&limit=50"
```

### GET /api/scrape-metrics

Get aggregated metrics for a scan.

**Query Parameters:**
- `scan_id` - Scan ID (required)
- `check_thresholds` - If true, check and log alerts (default: false)

**Example:**
```bash
curl "http://localhost:3000/api/scrape-metrics?scan_id=123&check_thresholds=true"
```

**Response:**
```json
{
  "total_attempts": 100,
  "success_count": 87,
  "success_percentage": 87.0,
  "error_count": 5,
  "error_percentage": 5.0,
  "timeout_count": 3,
  "timeout_percentage": 3.0,
  "block_count": 5,
  "block_percentage": 5.0,
  "manual_review_count": 0,
  "manual_review_percentage": 0.0,
  "avg_response_time_ms": 5234.5,
  "avg_retry_count": 0.8,
  "min_delay_ms": 2000,
  "max_delay_ms": 3500
}
```

### GET /api/scrape-health

Get daily health metrics for the last N days.

**Query Parameters:**
- `days` - Number of days to look back (default: 7, max: 30)
- `scan_id` - Optional scan ID for failure reasons

**Example:**
```bash
curl "http://localhost:3000/api/scrape-health?days=7"
```

## Alerting

The system automatically checks thresholds and logs warnings/errors:

### Alert Thresholds

1. **Success Rate Alert**
   - Triggers when success rate < 80% (minimum 10 attempts)
   - Logged as `[WARN]`

2. **Block Rate Alert**
   - Triggers when block rate > 20% (minimum 10 attempts)
   - Logged as `[ERROR]`

3. **IP Ban Detection**
   - Triggers when a hotel gets 3+ consecutive 403 errors
   - Logged as `[ERROR]` with hotel details

### Checking Thresholds

```typescript
import { alertOnThresholds } from '@/lib/scrapers/utils/scrape-logger';

// Check and log alerts for a scan
await alertOnThresholds(scanId);
```

## Scrape Status Codes

- `success` - Scrape completed successfully
- `error` - Generic error occurred
- `timeout` - Request timed out (default: 30s)
- `block` - Bot detection/rate limit (HTTP 429, 403, 503)
- `manual_review` - Requires manual intervention

## Performance

- **Non-blocking**: Logging is async and never blocks the scraping flow
- **Error handling**: Logging errors are caught and logged to console, not thrown
- **Indexed queries**: Database indexes on scan_id, timestamp, status, and hotel_id
- **Optimized aggregations**: SQL aggregations use PostgreSQL's FILTER for efficiency

## CSV Export

The monitoring page includes a CSV export feature that exports:
- Timestamp
- Hotel name
- Status
- HTTP status
- Reason
- Check-in date
- Response time (ms)

Respects current filters (status and hotel name).

## Best Practices

1. **Set context before scraping**:
   ```typescript
   scraper.setLoggingContext({ scanId, hotelId, hotelName });
   ```

2. **Check alerts periodically**:
   ```typescript
   await alertOnThresholds(scanId);
   ```

3. **Monitor trends**:
   - Use the monitoring page to identify patterns
   - Export CSV for deeper analysis

4. **Investigate blocks**:
   - High block rates indicate aggressive scraping
   - Consider increasing delays or rate limits
   - Review user-agent rotation

## Troubleshooting

### No logs appearing

1. Check that the migration was applied:
   ```sql
   SELECT * FROM scrape_logs LIMIT 1;
   ```

2. Verify logging context is set:
   ```typescript
   scraper.setLoggingContext({ scanId, hotelId, hotelName });
   ```

3. Check console for logging errors

### Metrics show 0%

- Ensure there are logs for the scan_id
- Check that scan_id is correct
- Verify scrape_status values are valid

### Widget not updating

- Check autoRefresh prop is true
- Verify scan_id exists
- Check browser console for errors

## Future Enhancements

Potential improvements:
- Real-time alerts via email/Slack
- Grafana/Prometheus integration
- Machine learning-based anomaly detection
- Per-hotel success rate tracking
- Geographic block detection
- Rate limit optimization suggestions
