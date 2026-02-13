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

**Important**: In the serverless (Vercel) environment, scans do not process automatically in the background. Scan processing requires external orchestration.

#### Option 1: Manual Processing (Development/Testing)
For development and testing, you can manually trigger scan processing:

```bash
# Process a batch of 30 cells starting from index 0
curl -X POST https://your-app.vercel.app/api/scans/process \
  -H "Content-Type: application/json" \
  -d '{"scanId": 123, "startIndex": 0, "size": 30}'

# Repeat with increasing startIndex until done=true
```

#### Option 2: Cron Job (Recommended for Production)

Set up a cron job or scheduled task that repeatedly calls the process endpoint:

```javascript
// Example cron job (runs every minute)
async function processPendingScans() {
  // 1. Fetch running scans
  const scans = await fetch('https://your-app.vercel.app/api/scans');
  const runningScanIds = scans
    .filter(s => s.status === 'running')
    .map(s => s.id);
  
  // 2. Process each running scan
  for (const scanId of runningScanIds) {
    const response = await fetch('https://your-app.vercel.app/api/scans/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        scanId, 
        startIndex: 0,  // API will auto-calculate correct startIndex
        size: 30        // Process 30 cells per invocation
      })
    });
    
    const result = await response.json();
    if (result.done) {
      console.log(`Scan ${scanId} completed`);
    }
  }
}
```

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
- Verify that your cron job or processing mechanism is running
- Check that scan status is 'running' (not 'cancelled' or 'done')
- Review server logs for errors

### Scan stuck at partial completion
- Check for errors in the `/api/scans/process` endpoint logs
- Verify hotel and date data is valid
- Try manually calling the process endpoint with the next startIndex

### Browser showing "Scan started" but no progress
- This is expected behavior - scans no longer process in the browser
- Set up external processing (cron job) to process the scan
- Or manually trigger processing via API calls

## Migration Notes

### Breaking Changes
1. **Frontend no longer processes scans**: The old behavior where the frontend would loop and process scans in the browser is removed. External orchestration is now required.

2. **New scan status**: The 'cancelled' status is now supported for stopped scans.

### Backward Compatibility
- Existing scans in the database continue to work
- Old scan results display correctly in all pages
- Export functionality unchanged

### If You Need Old Behavior
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
