# Scan Processing Guide

## Overview

As of the refactoring completed in February 2026, the scan interface has been updated to improve UX and make scans run independently of the browser.

## Key Changes

### 1. Scan Setup Page (formerly "Status Overview")
- **URL**: `/status-overview`
- **Purpose**: Configure and start new scans
- **Features**:
  - Scan parameter configuration (Check-in Date, Days to Scan, Stay Nights, Adult Count)
  - "Start Scan" button to create a new scan
  - "Export CSV" button for quick export of existing scans
  - Success/error messages displayed after scan creation

### 2. Availability Overview Page (formerly "Dashboard")
- **URL**: `/` (root)
- **Purpose**: View scan results and overall availability
- **Features**:
  - Scan selection dropdown
  - "Stop Scan" button for running scans
  - Availability overview tile with percentage score
  - Grouped bar charts by brand/region/country
  - Scan parameter display

### 3. Scan Results Page
- **URL**: `/scan-results`
- **Purpose**: Detailed view of individual scan results
- **Features**:
  - Scan selection with "Stop Scan" button
  - Hotel filtering and search
  - Date filtering
  - Source filtering (Amello vs Booking.com)
  - Paginated results table

## Scan Lifecycle

### Creating a Scan

1. User navigates to "Scan Setup" page
2. User configures scan parameters:
   - Base Check-in Date
   - Days to Scan (number of date columns)
   - Stay Nights (length of stay)
   - Adult Count
3. User clicks "Start Scan"
4. Frontend calls `POST /api/scans` to create scan record
5. Scan is created with status='running'
6. User receives success message with scan ID
7. User can navigate to "Availability Overview" or "Scan Results" to monitor progress

### Processing a Scan

**Auto-Processing Enabled**: As of the latest update, scans now process automatically after creation using a dual-approach system.

#### Automatic Processing (Default Behavior)

When a scan is created, processing begins automatically through two mechanisms:

1. **Immediate Trigger**: The scan creation endpoint triggers the first batch (30 cells) immediately
2. **Cron Backup**: A Vercel cron job runs every minute to continue processing any incomplete scans

This means:
- No manual intervention required
- Scans complete automatically even for large datasets
- Processing continues within Vercel serverless constraints
- User can monitor progress on Availability Overview or Scan Results pages

#### Option 1: Manual Processing (Development/Testing Only)

For development and testing without Vercel cron, you can manually trigger scan processing:

```bash
# Process a batch of 30 cells starting from index 0
curl -X POST https://your-app.vercel.app/api/scans/process \
  -H "Content-Type: application/json" \
  -d '{"scanId": 123, "startIndex": 0, "size": 30}'

# Repeat with increasing startIndex until done=true
```

#### Option 2: Cron Job (Production - Already Configured)

The cron-based processing is already configured in `vercel.json` and runs automatically in production:

```json
{
  "crons": [{
    "path": "/api/scans/process-next",
    "schedule": "* * * * *"
  }]
}
```

The `/api/scans/process-next` endpoint:
- Finds the oldest running scan with incomplete processing
- Processes the next batch of 30 cells
- Returns processing result
- Runs automatically every minute via Vercel cron

#### Option 3: Queue System (Advanced)

For production use with high scan volumes, consider integrating a queue system:
- AWS SQS + Lambda
- Vercel Cron Jobs
- Upstash QStash
- Inngest

### Stopping a Scan

Users can stop a running scan from either:
- Availability Overview page
- Scan Results page

1. User selects a running scan from the dropdown
2. "Stop Scan" button appears
3. User clicks "Stop Scan" and confirms
4. Frontend calls `POST /api/scans/{id}/stop`
5. Scan status is updated to 'cancelled'
6. Next process invocation will detect cancelled status and exit early

## API Endpoints

### `POST /api/scans`
Create a new scan.

**Request Body**:
```json
{
  "baseCheckIn": "2026-02-18",
  "days": 86,
  "stayNights": 7,
  "adultCount": 2
}
```

**Response**:
```json
{
  "scanId": 123,
  "totalCells": 8600,
  "baseCheckIn": "2026-02-18",
  "days": 86,
  "stayNights": 7
}
```

### `POST /api/scans/process`
Process a batch of scan cells.

**Request Body**:
```json
{
  "scanId": 123,
  "startIndex": 0,
  "size": 30
}
```

**Response**:
```json
{
  "processed": 30,
  "failures": 0,
  "nextIndex": 30,
  "done": false,
  "total": 8600
}
```

**Note**: If scan status is 'cancelled', returns immediately with:
```json
{
  "processed": 0,
  "nextIndex": 0,
  "done": true,
  "message": "Scan has been cancelled"
}
```

### `POST /api/scans/{id}/stop`
Stop a running scan.

**Response**:
```json
{
  "success": true,
  "scanId": 123,
  "message": "Scan stopped successfully"
}
```

## Database Schema

### Scan Status Values
- `queued`: Scan created but not yet started (currently unused)
- `running`: Scan is actively being processed
- `done`: Scan completed successfully
- `error`: Scan encountered an error
- `cancelled`: Scan was stopped by user

The `status` column in the `scans` table is VARCHAR(20), which supports all these values.

## Troubleshooting

### Scan not processing
With auto-processing enabled, scans should start immediately. If not:
- Check server logs for `[POST /api/scans] Triggering first batch processing` message
- Verify Vercel cron is configured (check vercel.json exists)
- Check that scan status is 'running' (not 'cancelled' or 'done')
- Review logs at `/api/scans/process-next` for cron activity
- Manually trigger: `curl -X POST /api/scans/process-next`

### Scan stuck at partial completion
- Check for errors in the `/api/scans/process` endpoint logs
- Verify hotel and date data is valid
- Check if scan was cancelled by user
- Cron should resume processing automatically within 1 minute

### Browser showing "Scan started" but no progress
- Auto-processing is enabled - progress should appear within 1-2 minutes
- Check server logs for processing activity
- Verify scan status in database is 'running'
- If needed, manually trigger: `POST /api/scans/process-next`

## Migration Notes

### What's New
1. **Auto-processing enabled**: Scans now process automatically after creation via dual approach:
   - Immediate trigger on scan creation
   - Cron-based polling every minute as backup

2. **New endpoint**: `/api/scans/process-next` for cron-based polling

3. **Vercel cron configured**: `vercel.json` sets up automatic processing

### Breaking Changes
1. **No manual setup required**: External orchestration is now built-in and automatic.

2. **New scan status**: The 'cancelled' status is now supported for stopped scans.

### Backward Compatibility
- Existing scans in the database continue to work
- Old scan results display correctly in all pages
- Export functionality unchanged
- Manual processing endpoints still available for development

### If You Need Manual Control
If you need the old browser-based processing temporarily, you can:
1. Navigate to Scan Results page
2. Select the running scan
3. Open browser console and run:
```javascript
async function processInBrowser(scanId) {
  let idx = 0;
  while (true) {
    const r = await fetch('/api/scans/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId, startIndex: idx, size: 30 })
    }).then(r => r.json());
    console.log(`Processed ${r.processed}, next: ${r.nextIndex}`);
    if (r.done) break;
    idx = r.nextIndex;
  }
}
processInBrowser(123); // Replace 123 with your scan ID
```
