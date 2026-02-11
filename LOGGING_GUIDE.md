# Booking.com Scraper Logging Guide

This document describes the comprehensive logging added to the Booking.com scraper to help identify where failures occur.

## Log Format

All logs are prefixed with `[BookingComScraper]` or `[process]` to make them easy to filter.

## Expected Log Flow

### 1. Scraper Initialization
```
[BookingComScraper] === SCRAPE INITIALIZED ===
[BookingComScraper] Hotel ID/URL: https://www.booking.com/hotel/...
[BookingComScraper] Check-in: 2024-03-15
[BookingComScraper] Check-out: 2024-03-17
[BookingComScraper] Adults: 2 Children: 0
```

### 2. HTTP Request Phase
```
[BookingComScraper] === HTTP REQUEST PHASE ===
[BookingComScraper] Constructed URL: https://www.booking.com/hotel/...?checkin=2024-03-15&checkout=2024-03-17...
[BookingComScraper] Request headers: {
  "Accept": "text/html,application/xhtml+xml...",
  "User-Agent": "Mozilla/5.0...",
  ...
}
[BookingComScraper] Response received - Status: 200 (OK)
[BookingComScraper] Response content length: 250000 characters
[BookingComScraper] First 200 chars of HTML: <!DOCTYPE html><html>...
```

### 3. HTML Parsing Phase
```
[BookingComScraper] === DATA PROCESSING PHASE ===
[BookingComScraper] === HTML PARSING PHASE ===
[BookingComScraper] Parsing HTML with cheerio...
[BookingComScraper] CSS Selector: #available_rooms
[BookingComScraper] Element found: true
[BookingComScraper] CSS Selector: .hprt-roomtype-link
[BookingComScraper] Number of rooms found: 5
```

### 4. Room Processing
```
[BookingComScraper] Processing room 1: "Deluxe Double Room"
[BookingComScraper]   - CSS Selector: .bui-list__item.e2e-cancellation
[BookingComScraper]   - Rates found in row: 2
[BookingComScraper]     ✓ Extracted rate: Free cancellation, 150.00 EUR
[BookingComScraper]     ✓ Extracted rate: Non-refundable, 130.00 EUR
[BookingComScraper]   ✓ Room added with 2 rate(s)
```

### 5. Price Extraction
```
[BookingComScraper]         Parsing price text: €150
[BookingComScraper]         Currency: EUR
[BookingComScraper]         Numeric text: 150
[BookingComScraper]         Normalized number: 150
[BookingComScraper]         ✓ Parsed price: 150 EUR
```

### 6. Data Extraction Complete
```
[BookingComScraper] Parsing complete. Total rooms with rates: 5
[BookingComScraper] === DATA EXTRACTION COMPLETE ===
[BookingComScraper] Total rooms extracted: 5
[BookingComScraper] Source field value: booking
[BookingComScraper] Room 1: Deluxe Double Room
[BookingComScraper]   - Rates found: 2
[BookingComScraper]   - Rate 1: Free cancellation
[BookingComScraper]     Price: 150 EUR
[BookingComScraper]   - Rate 2: Non-refundable
[BookingComScraper]     Price: 130 EUR
```

### 7. Database Write Phase (from route.ts)
```
[process] === BOOKING.COM SCAN STARTED ===
[process] Hotel ID: 42
[process] Booking URL: https://www.booking.com/hotel/...
[process] Check-in: 2024-03-15
[process] Check-out: 2024-03-17
[process] === BOOKING.COM SCAN COMPLETE ===
[process] Result status: green
[process] Has scraped data: true
[process] === DATABASE WRITE PHASE ===
[process] Scan ID: 123
[process] Hotel ID: 42
[process] Check-in date: 2024-03-15
[process] Status: green
[process] Source field: booking
[process] Data structure (truncated): {"rooms":[{"name":"Deluxe Double Room","rates":[{"name":"Free cancellation",...
[process] ✓ Database write successful for Booking.com
```

## Error Scenarios

### HTTP Request Error
```
[BookingComScraper] === SCRAPE ERROR ===
[BookingComScraper] Error type: FetchError
[BookingComScraper] Error message: HTTP 404: Not Found
[BookingComScraper] Error stack: FetchError: HTTP 404: Not Found
    at fetchHTML (/path/to/BaseScraper.ts:92)
    ...
[BookingComScraper] Context: {
  hotelCode: "https://www.booking.com/hotel/...",
  checkInDate: "2024-03-15",
  checkOutDate: "2024-03-17",
  adults: 2,
  children: 0
}
```

### Parsing Error
```
[BookingComScraper] === ERROR IN PROCESSING DATA ===
[BookingComScraper] Error type: TypeError
[BookingComScraper] Error message: Cannot read property 'length' of undefined
[BookingComScraper] Error stack: TypeError: Cannot read property...
[BookingComScraper] HTML length: 250000
```

### Database Error
```
[process] === BOOKING.COM SCAN ERROR (NON-BLOCKING) ===
[process] Error type: Error
[process] Error message: Scraping failed
[process] Error stack: Error: Scraping failed at...
[process] Context: {
  hotelId: 42,
  checkIn: "2024-03-15",
  checkOut: "2024-03-17",
  bookingUrl: "https://www.booking.com/hotel/...",
  scanId: 123
}
[process] === STORING ERROR RESULT IN DATABASE ===
[process] Error data structure: {"error":"Scraping failed","source":"booking","errorType":"Error","stack":"Error: Scraping failed at..."}
[process] ✓ Error result stored successfully
```

## Filtering Logs

To view only Booking.com scraper logs:
```bash
# View all scraper logs
grep "\[BookingComScraper\]" logs.txt

# View only errors
grep "\[BookingComScraper\].*ERROR" logs.txt

# View process-level logs
grep "\[process\].*BOOKING.COM" logs.txt
```

## Security Notes

The following sensitive information is **NOT** logged:
- Authorization headers
- Cookie values
- API keys (X-API-Key header)
- Full HTML content (only first 200 characters)
- Full scraped data in database logs (truncated to 100 characters)

## Debugging Tips

1. **No rooms found**: Check logs for `Number of rooms found: 0` and verify CSS selectors
2. **No rates found**: Look for `Rates found in row: 0` and check rate extraction logs
3. **Price parsing failures**: Check for `✗ Invalid amount` or `✗ Failed to parse price`
4. **Database errors**: Look for `DATABASE ERROR WRITE FAILED` in process logs
