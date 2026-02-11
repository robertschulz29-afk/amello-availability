# Database Migration Guide: Booking.com Integration

## Overview
This guide describes migrations 006 and 007, which extend the database schema to support Booking.com scraping alongside TUIAmello API data collection.

## Migrations

### Migration 006: Add `booking_com_url` to `hotels` table
**File:** `db/migrations/006_add_booking_com_url.sql`

Adds a nullable `booking_com_url` column to store Booking.com hotel search URLs for each hotel.

**Changes:**
- Adds `booking_com_url` TEXT column (nullable)
- Creates index `idx_hotels_booking_com_url` for query performance

**Rollback:**
Run `db/migrations/rollback_006_remove_booking_com_url.sql` to revert.

### Migration 007: Add `booking_com_data` to `scan_results` table
**File:** `db/migrations/007_add_booking_com_data.sql`

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
Run `db/migrations/rollback_007_remove_booking_com_data.sql` to revert.

## Running Migrations

### Apply Migrations
```bash
node scripts/migrate.mjs
```

This will apply all migrations in order, including 006 and 007.

### Rollback Migrations
If you need to rollback these changes:

```bash
# Connect to your database and run:
psql $DATABASE_URL -f db/migrations/rollback_007_remove_booking_com_data.sql
psql $DATABASE_URL -f db/migrations/rollback_006_remove_booking_com_url.sql
```

Note: Rollback migrations must be run in reverse order (007 before 006).

## API Changes

### Updated Endpoints

#### `GET /api/hotels`
Now returns `booking_com_url` in the response:
```json
{
  "id": 1,
  "name": "Hotel Name",
  "code": "ABC123",
  "booking_com_url": "https://www.booking.com/...",
  ...
}
```

#### `POST /api/hotels`
Now accepts `booking_com_url` in the request body:
```json
{
  "name": "Hotel Name",
  "code": "ABC123",
  "booking_com_url": "https://www.booking.com/..."
}
```

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

## Backward Compatibility

All changes are backward compatible:
- New columns are nullable (DEFAULT NULL)
- Existing code continues to work without modification
- Migrations use `IF NOT EXISTS` clauses for idempotency
- API endpoints handle missing fields gracefully

## Database Considerations

- **Database:** PostgreSQL (uses JSONB and GIN indexes)
- **Idempotency:** All migrations can be run multiple times safely
- **Performance:** Indexes added for efficient queries
- **Storage:** JSONB columns are stored compressed in PostgreSQL

## Testing

After applying migrations, verify:

1. **Migrations Applied:**
   ```sql
   SELECT column_name, data_type, is_nullable 
   FROM information_schema.columns 
   WHERE table_name = 'hotels' AND column_name = 'booking_com_url';
   
   SELECT column_name, data_type, is_nullable 
   FROM information_schema.columns 
   WHERE table_name = 'scan_results' AND column_name = 'booking_com_data';
   ```

2. **Indexes Created:**
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename IN ('hotels', 'scan_results') 
   AND indexname LIKE '%booking_com%';
   ```

3. **API Endpoints:**
   - Test `GET /api/hotels` returns new field
   - Test `POST /api/hotels` with `booking_com_url`
   - Test `GET /api/scan-results` returns new field

## Notes

- The `booking_com_data` JSONB structure is flexible and can be extended
- The GIN index enables efficient queries like: `WHERE booking_com_data @> '{"scrape_status": "success"}'`
- Consider adding additional indexes based on query patterns in production
