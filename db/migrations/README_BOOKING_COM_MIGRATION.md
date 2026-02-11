# Database Migration Guide: Booking.com Integration

## Overview
This guide describes migration 006, which extends the database schema to support Booking.com scraping alongside TUIAmello API data collection.

## Important Note
This migration **reuses the existing `booking_url` column** from the `hotels` table (added in migration 005). The `booking_url` column serves as a synonym for Booking.com URLs, so no new column is needed in the hotels table.

## Migration

### Migration 006: Add `booking_com_data` to `scan_results` table
**File:** `db/migrations/006_add_booking_com_data.sql`

Adds a nullable JSONB column to store extracted Booking.com data.

**Changes:**
- Adds `booking_com_data` JSONB column (nullable)
- Creates composite index `idx_scan_results_scan_hotel` on `(scan_id, hotel_id)`
- Creates GIN index `idx_scan_results_booking_com_data` on the JSONB column

**Expected JSON Structure:**
```json
{
  "rooms": [
    {"type": "string", "name": "string"}
  ],
  "rates": [
    {"type": "string", "name": "string", "cancellation": "string"}
  ],
  "prices": [
    {"amount": number, "currency": "string", "room_id": number, "rate_id": number}
  ],
  "scrape_status": "pending" | "success" | "failed" | "timeout",
  "error_message": "string or null",
  "scraped_at": "ISO timestamp or null"
}
```

**Rollback:**
Run `db/migrations/rollback_006_remove_booking_com_data.sql` to revert.

## Running Migrations

### Apply Migrations
```bash
node scripts/migrate.mjs
```

This will apply all migrations in order, including 006.

### Rollback Migration
If you need to rollback this change:

```bash
# Connect to your database and run:
psql $DATABASE_URL -f db/migrations/rollback_006_remove_booking_com_data.sql
```

## Integration with Existing Schema

### Using Existing `booking_url` Column
The `hotels` table already has a `booking_url` column (added in migration 005):
```sql
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS booking_url VARCHAR(500) DEFAULT NULL;
```

This column is used to store Booking.com hotel search URLs. No additional column is needed.

### Storing Booking.com Data
Scraped Booking.com data is stored in the `scan_results` table's new `booking_com_data` JSONB column, alongside the existing `response_json` column which stores TUIAmello API data.

## API Changes

### Updated Endpoints

#### `GET /api/scan-results`
Now returns `booking_com_data` in the response:
```json
{
  "data": [
    {
      "scan_id": 1,
      "hotel_id": 1,
      "check_in_date": "2024-01-01",
      "status": "green",
      "response_json": {...},
      "booking_com_data": {...}
    }
  ]
}
```

#### Hotels API (No Changes Required)
The hotels API (`GET/POST /api/hotels`) already handles `booking_url`:
```json
{
  "id": 1,
  "name": "Hotel Name",
  "code": "ABC123",
  "booking_url": "https://www.booking.com/...",
  "tuiamello_url": "https://...",
  "expedia_url": "https://..."
}
```

## Backward Compatibility

All changes are backward compatible:
- New `booking_com_data` column is nullable (DEFAULT NULL)
- Existing code continues to work without modification
- Migration uses `IF NOT EXISTS` clauses for idempotency
- API endpoints handle missing fields gracefully
- Reuses existing `booking_url` column (no schema changes to hotels table)

## Database Considerations

- **Database:** PostgreSQL (uses JSONB and GIN indexes)
- **Idempotency:** Migration can be run multiple times safely
- **Performance:** Indexes added for efficient queries
- **Storage:** JSONB columns are stored compressed in PostgreSQL

## Testing

After applying the migration, verify:

1. **Migration Applied:**
   ```sql
   SELECT column_name, data_type, is_nullable 
   FROM information_schema.columns 
   WHERE table_name = 'scan_results' AND column_name = 'booking_com_data';
   ```

2. **Indexes Created:**
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'scan_results' 
   AND indexname LIKE '%booking_com%';
   ```

3. **Existing booking_url Column:**
   ```sql
   SELECT column_name, data_type, character_maximum_length
   FROM information_schema.columns 
   WHERE table_name = 'hotels' AND column_name = 'booking_url';
   ```

4. **API Endpoints:**
   - Test `GET /api/scan-results` returns new field
   - Test `GET /api/hotels` returns existing `booking_url`

## Usage Example

### Setting Booking.com URL for a Hotel
```bash
POST /api/hotels
{
  "name": "Hotel Example",
  "code": "HOTEL123",
  "booking_url": "https://www.booking.com/hotel/example.html?checkin=2024-01-01&checkout=2024-01-05"
}
```

### Storing Scraped Booking.com Data
After scraping, update the scan result:
```sql
UPDATE scan_results 
SET booking_com_data = '{
  "rooms": [{"type": "double", "name": "Standard Double Room"}],
  "rates": [{"type": "standard", "name": "Non-refundable", "cancellation": "non_refundable"}],
  "prices": [{"amount": 150.00, "currency": "EUR", "room_id": 0, "rate_id": 0}],
  "scrape_status": "success",
  "scraped_at": "2024-01-01T10:00:00Z"
}'::jsonb
WHERE scan_id = 1 AND hotel_id = 1 AND check_in_date = '2024-01-01';
```

### Querying Successful Scrapes
```sql
SELECT hotel_id, check_in_date, 
       booking_com_data->>'scrape_status' as status,
       booking_com_data->'prices' as prices
FROM scan_results 
WHERE scan_id = 1 
AND booking_com_data @> '{"scrape_status": "success"}';
```

## Notes

- The `booking_com_data` JSONB structure is flexible and can be extended
- The GIN index enables efficient queries like: `WHERE booking_com_data @> '{"scrape_status": "success"}'`
- Consider adding additional indexes based on query patterns in production
- The existing `booking_url` column in hotels table serves dual purpose for Booking.com integration
