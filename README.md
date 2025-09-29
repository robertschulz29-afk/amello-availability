# amello-availability

### Scan history
- **Create new scan**: POST `/api/scans` (button “New scan”). Persists a row in `scans` and all cells in `scan_results`.
- **List scans**: GET `/api/scans`.
- **Load a past scan**: GET `/api/scans/{id}`. The UI dropdown loads any historical scan and renders the saved matrix.


All scans use Europe/Berlin; dates are fixed at startOffset=5, endOffset=90 and fixed checkout = today+12 (relative to the scan time).
