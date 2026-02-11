# Bot Detection Evasion Implementation

This document describes the bot detection evasion features implemented in the scraper infrastructure.

## Overview

The scraper has been enhanced with comprehensive bot detection evasion capabilities to bypass Booking.com's anti-bot mechanisms while maintaining reliability and proper logging.

## Features Implemented

### 1. User-Agent Rotation (30+ Real Browser Profiles)

**File:** `lib/scrapers/utils/user-agents.ts`

- **Total User-Agents:** 32 real browser strings
- **Desktop Browsers:**
  - Chrome on Windows 10/11 (4 variants)
  - Chrome on macOS Sonoma/Ventura (4 variants)
  - Firefox on Windows 10/11 (4 variants)
  - Firefox on macOS (3 variants)
  - Safari on macOS (4 variants)
  - Edge on Windows (3 variants)
- **Mobile Browsers:**
  - Chrome Mobile on Android 13/14 (4 variants)
  - Safari iOS 17/18 (4 variants)
  - Samsung Internet on Android (2 variants)

**Usage:**
```typescript
import { getRandomUserAgent } from './lib/scrapers/utils/user-agents';
const userAgent = getRandomUserAgent();
```

### 2. Header Spoofing

**File:** `lib/scrapers/utils/headers.ts`

Headers vary on each request to avoid fingerprinting:

- **Accept-Language:** Rotates between 6 language variants (en-US, de-DE, fr-FR, es-ES, it-IT, en-GB)
- **Referer:** Randomly selects from Google, DuckDuckGo, Bing, or direct (no referer)
- **Cache-Control:** Randomizes between `no-cache`, `max-age=0`, and `no-cache, no-store`
- **Accept-Encoding:** Always `gzip, deflate, br` (realistic compression support)
- **Accept:** Standard browser accept header

**Usage:**
```typescript
import { getSpoofedHeaders } from './lib/scrapers/utils/headers';
const headers = getSpoofedHeaders();
// Override specific headers if needed:
const customHeaders = getSpoofedHeaders({ userAgent: 'custom UA' });
```

### 3. Request Delays & Timing

**File:** `lib/scrapers/utils/delays.ts`

- **Base Delay:** 3-8 seconds (random) between requests per hotel
- **Jitter:** ±20% variance applied to each delay
- **Implementation:** Integrated into BaseScraper's `applyDelay()` method

**Functions:**
```typescript
import { getRandomDelay, applyJitter } from './lib/scrapers/utils/delays';

const delay = getRandomDelay(3000, 8000); // 3-8 seconds
const withJitter = applyJitter(delay, 20); // ±20% variance
```

### 4. Session Management

**File:** `lib/scrapers/utils/session-manager.ts`

- **Cookie Persistence:** Cookies maintained within a batch of requests
- **Session Rotation:** Automatically rotates after 15 requests (configurable) or 30 minutes
- **Cookie Jar:** Simple cookie storage and retrieval

**Features:**
- Stores cookies from `Set-Cookie` headers
- Sends cookies with subsequent requests in same session
- Clean rotation on session expiry
- Session statistics tracking

**Usage:**
```typescript
import { SessionManager } from './lib/scrapers/utils/session-manager';

const sessionMgr = new SessionManager(15); // 15 requests per session
const session = sessionMgr.getSession();
session.addSimple('cookieName', 'cookieValue');
const cookieString = session.getCookieString();
```

### 5. Error Handling & Retry Logic

**File:** `lib/scrapers/utils/retry-logic.ts`

Status-specific retry behavior:

- **HTTP 429 (Too Many Requests):**
  - Backoff: 5-10 minutes
  - Retries: Up to 3 times
  - Action: Exponential backoff with increasing delays

- **HTTP 403 (Forbidden):**
  - Backoff: None
  - Retries: 0
  - Action: Mark as `bot_blocked`, skip hotel, log pattern

- **HTTP 503 (Service Unavailable):**
  - Backoff: 2s → 4s → 8s (exponential)
  - Retries: Up to 3 times

- **Timeout (>30s):**
  - Retries: Up to 2 times
  - Delay: Longer delays (5s → 10s → 20s)

**Functions:**
```typescript
import { 
  getBackoffDelay, 
  shouldRetry, 
  retryWithStatusHandling 
} from './lib/scrapers/utils/retry-logic';

const delay = getBackoffDelay(retryCount);
const shouldContinue = shouldRetry(httpStatus, retryCount);
```

### 6. Logging & Monitoring

**File:** `lib/scrapers/utils/logger.ts`

Structured logging with standardized codes:

**Status Codes:**
- `success` - Scrape completed successfully
- `error` - General error occurred
- `timeout` - Request timed out
- `block` - Bot detection triggered (403, 429)
- `manual_review` - Requires human intervention

**Event Structure:**
```typescript
{
  timestamp: "2026-02-11T11:00:00.000Z",
  scrape_status: "success",
  hotel_id: 123,
  url: "https://example.com/hotel",
  http_status: 200,
  delay_ms: 5430,
  retry_count: 0,
  error_message: null,
  user_agent: "Mozilla/5.0...",
  reason: "Scrape completed successfully"
}
```

**Usage:**
```typescript
import { logScrapeEvent, createScrapeEvent } from './lib/scrapers/utils/logger';

const event = createScrapeEvent('success', url, 'Completed', {
  hotel_id: 123,
  http_status: 200,
  delay_ms: 5000,
});
logScrapeEvent(event);
```

### 7. Proxy Layer Preparation

**File:** `lib/scrapers/types.ts`

Interface designed for future proxy implementation:

```typescript
interface ProxyConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
  rotationEnabled?: boolean;
  rotationInterval?: number;
}
```

**Integration:**
- `setProxyConfig()` method available in BaseScraper
- Can be implemented without refactoring existing code
- Optional - falls back to direct requests if not configured

## BaseScraper Integration

**File:** `lib/scrapers/BaseScraper.ts`

All utilities are integrated into the BaseScraper class:

1. **Header Spoofing:** `getHeaders()` uses `getSpoofedHeaders()`
2. **Delay with Jitter:** `applyDelay()` applies 3-8s delays with ±20% jitter
3. **Session Management:** `sessionManager` handles cookie persistence
4. **Retry Logic:** `fetchHTML()` uses `retryWithStatusHandling()`
5. **Logging:** All requests logged with structured events
6. **Proxy Support:** `setProxyConfig()` method ready for future implementation

**New Methods:**
- `getSessionStats()` - Get session statistics
- `getScrapeStats()` - Get scraping statistics
- `rotateSession()` - Force session rotation
- `setProxyConfig()` - Configure proxy settings

## Usage Example

```typescript
import { BaseScraper } from './lib/scrapers/BaseScraper';
import { ExampleScraper } from './lib/scrapers/examples/ExampleScraper';

// Create scraper with bot detection evasion
const source = {
  id: 1,
  name: 'Booking.com',
  enabled: true,
  base_url: 'https://www.booking.com',
  css_selectors: { availability: '.availability' },
  rate_limit_ms: 5000,
  user_agent_rotation: true,
};

const scraper = new ExampleScraper(source);

// Scrape with automatic bot detection evasion
const result = await scraper.scrape({
  hotelCode: 'HTL123',
  checkInDate: '2026-03-15',
  checkOutDate: '2026-03-17',
});

// Check session stats
const stats = scraper.getSessionStats();
console.log(`Requests in session: ${stats.requestCount}`);

// Check scraping stats
const scrapeStats = scraper.getScrapeStats();
console.log(`Success rate: ${scrapeStats.success}/${scrapeStats.success + scrapeStats.error}`);
```

## Testing

All features have been verified:

- ✅ 32 User-Agent strings (requirement: 30+)
- ✅ Header spoofing utilities (Accept-Language, Referer, Cache-Control)
- ✅ Delay with jitter (3-8s ± 20%)
- ✅ Session management with cookie persistence
- ✅ HTTP status-specific retry logic (429, 403, 503)
- ✅ Structured logging with event codes
- ✅ Proxy interface designed
- ✅ TypeScript compilation successful
- ✅ All utilities integrated into BaseScraper

## Performance Expectations

Based on the implementation:

- **Request Rate:** ~8-12 requests/minute (considering 3-8s delays)
- **Daily Capacity:** 100+ requests/day easily achievable
- **Expected Failure Rate:** <10% with proper retry logic
- **Session Lifetime:** 15 requests or 30 minutes per session

## Security Summary

### Vulnerabilities Addressed

1. **Bot Detection Prevention:**
   - Implemented diverse User-Agent rotation to avoid fingerprinting
   - Added header spoofing to mimic real browser behavior
   - Randomized timing patterns with jitter

2. **Rate Limiting Handling:**
   - Proper backoff for HTTP 429 (5-10 minutes)
   - Session rotation to avoid pattern detection
   - Request delay enforcement (3-8 seconds)

3. **Error Handling:**
   - HTTP 403 properly marked as bot_blocked (no retry)
   - Timeout handling with appropriate retry limits
   - Structured logging for monitoring and debugging

### No New Vulnerabilities Introduced

- All utilities use standard web APIs
- No external dependencies added beyond existing ones
- Type-safe TypeScript implementation
- No secrets or credentials stored
- Proxy configuration interface prepared but not implemented (avoids exposing credentials)

## Future Enhancements

1. **Proxy Rotation:**
   - Implement actual proxy rotation using ProxyConfig interface
   - Support residential/datacenter proxy pools
   - Automatic proxy health checking

2. **Advanced Fingerprinting Prevention:**
   - Browser fingerprint randomization
   - TLS fingerprint variation
   - Canvas/WebGL fingerprinting evasion

3. **Machine Learning Integration:**
   - Adaptive delay adjustment based on success rates
   - Automatic pattern detection for bot blocks
   - Predictive retry strategies

4. **Enhanced Monitoring:**
   - Real-time dashboard for scraping metrics
   - Alert system for bot blocks
   - Success rate tracking per source
