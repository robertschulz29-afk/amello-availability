# amello-availability

## Purpose

A hotel availability tracker for the amello platform. It scans hotel inventory across a rolling date range and renders the result as a date × hotel matrix, with support for pulling data from the Amello API and from external booking sources (Booking.com, Expedia, …) via a pluggable scraping layer.
Built with Next.js (App Router), PostgreSQL (Supabase), and deployed on Vercel.
What it does

* Runs availability scans over a configurable time window for a configurable hotel set using the Amello public API and Booking.com.
* Provides reports on portfolio healthon Amello.com and  price comparison between Amello and Booking.com
* Provides list of hot3els with filterable global types for website managemen team 
* Persists every scan so historical availability can be loaded and compared from a dropdown in the UI.
* Processes scans in batches via a Vercel cron job — 30 cells per minute, with progress tracked on the scans row.

## How it works
### Scan lifecycle

User clicks New scan → POST /api/scans inserts a row in scans with status='running' and seeds scan_results cells.
The route immediately triggers the first batch by calling /api/scans/process over HTTP (URL built from NEXTAUTH_URL → VERCEL_URL → localhost).
A Vercel cron hits /api/scans/process-next every minute and processes 30 cells per invocation.
done_cells on the scans row increments after each batch; status flips to done when done_cells >= total_cells.

For a typical 86-day × 100-hotel run (~8 600 cells), end-to-end completion takes roughly 4.8 hours at 30 cells/minute.
Multi-source scraping
External booking sources are described as rows in scan_sources:

base_url — URL pattern for the source
css_selectors — JSONB map of selectors (price, availability, …) used by the parser
rate_limit_ms — minimum delay between requests (default 2000)
user_agent_rotation — toggles UA rotation (default true)

Scraped results land in scan_results_extended, keyed on (scan_id, hotel_id, source_id) with the full payload kept in scraped_data (JSONB) and the headline fields (price, currency, availability_text, status, error_message) projected out for querying.
The scraping framework lives in lib/scrapers/:

BaseScraper — abstract class handling UA rotation, throttling, retries with exponential backoff, cookie/session state, and selector-based parsing.
utils/ — user-agents.ts, delays.ts, html-parser.ts, retry.ts.
