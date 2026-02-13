# Scan Processing Troubleshooting Guide

## How to View Logs

### Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Click your project
3. Click "Logs" or "Observability" → "Function Logs"
4. Filter by function: `/api/scans/process`

### Key Log Markers

Look for these in sequence:

1. **Scan Creation**
   ```
   [processFirstBatch] ==================== START ====================
   [processFirstBatch] Scan ID: 123
   ```

2. **First Batch Processing**
   ```
   [process] ==================== PROCESSING REQUEST ====================
   [process] Scan ID: 123
   [process] Start Index: 0
   ```

3. **First Batch Complete**
   ```
   [process] ===== PROCESSING COMPLETE =====
   [process] Processed: 30
   [process] Next Index: 30
   [process] Done: false
   ```

4. **Cron Job Picks Up**
   ```
   [process-next] ==================== CRON JOB INVOKED ====================
   [process-next] Scan ID: 123
   [process-next] Progress: 30 / 8600
   ```

## Common Issues

### Issue: No logs after scan creation
**Cause:** `NEXTAUTH_URL` not set or incorrect
**Fix:** Set `NEXTAUTH_URL` in Vercel environment variables

### Issue: First batch works, then stops
**Cause:** Cron job not running or failing
**Fix:** Check Vercel dashboard → Cron Jobs → Verify job is enabled

### Issue: "No scans to process" in cron logs
**Cause:** Scan status is not 'running' or done_cells >= total_cells
**Fix:** Check database:
```sql
SELECT id, status, done_cells, total_cells 
FROM scans 
WHERE status = 'running' AND done_cells < total_cells;
```

### Issue: Cron never runs
**Cause:** vercel.json not deployed
**Fix:** Verify vercel.json exists in repository root, redeploy

## Manual Testing

### Trigger cron manually
```bash
curl -X POST https://your-url.vercel.app/api/scans/process-next
```

### Check scan status
```bash
curl https://your-url.vercel.app/api/scans
```

### Process specific scan
```bash
curl -X POST https://your-url.vercel.app/api/scans/process \
  -H "Content-Type: application/json" \
  -H "Bello-Mandator: YOUR_VALUE" \
  -d '{"scanId": 123, "startIndex": 30, "size": 30}'
```

## Expected Behavior After This Fix

### Logs You'll See

When you create a scan:
```
[processFirstBatch] ==================== START ====================
[processFirstBatch] Scan ID: 123
[processFirstBatch] Base URL: https://your-app.vercel.app
[processFirstBatch] Target URL: https://your-app.vercel.app/api/scans/process
[process] ==================== PROCESSING REQUEST ====================
[process] Scan ID: 123
[process] Start Index: 0
[process] Batch Size: 30
[process] ===== PROCESSING COMPLETE =====
[process] Processed: 30
[process] Next Index: 30
[process] Done: false
[processFirstBatch] ✅ REQUEST SUCCESS
[processFirstBatch] Processed: 30
```

Every minute (cron):
```
[process-next] ==================== CRON JOB INVOKED ====================
[process-next] Scan ID: 123
[process-next] Progress: 30 / 8600
[process] ==================== PROCESSING REQUEST ====================
[process] Scan ID: 123
[process] Start Index: 30
[process] Processed: 30
```

### Database Changes

```sql
-- After first batch
id | done_cells | total_cells | status
123| 30         | 8600        | running

-- After 1 minute (cron)
id | done_cells | total_cells | status
123| 60         | 8600        | running

-- After 2 minutes
id | done_cells | total_cells | status
123| 90         | 8600        | running

-- Eventually
id | done_cells | total_cells | status
123| 8600       | 8600        | done
```

## Success Criteria

- ✅ Logs show scan creation and first batch processing
- ✅ `done_cells` increases every minute
- ✅ Cron logs appear every minute while scan is running
- ✅ Scan eventually reaches status='done'
- ✅ All logs are searchable in Vercel dashboard

## Testing Checklist

After deploying this PR:

1. [ ] Create a new scan
2. [ ] Check Vercel logs immediately - see first batch logs
3. [ ] Check database - `done_cells` should be 30
4. [ ] Wait 1 minute
5. [ ] Check Vercel logs - see cron job logs
6. [ ] Check database - `done_cells` should be 60
7. [ ] Wait 5 minutes total
8. [ ] Verify scan is progressing (done_cells increasing)

If any step fails, the logs will show exactly where and why!
