// lib/scrapers/BaseScraper.ts
// Base class for web scraping with enhanced bot detection prevention

import { getSpoofedHeaders } from './utils/headers';
import { getRandomDelay, applyJitter, sleep } from './utils/delays';
import { parseHTML, extractText, extractMultiple } from './utils/html-parser';
import { retryWithStatusHandling, retryWithTimeoutHandling, isTimeoutError } from './utils/retry-logic';
import { SessionManager } from './utils/session-manager';
import { logScrapeEvent, createScrapeEvent, getLogger } from './utils/logger';
import { logScrapeEvent as logScrapeEventToDB } from './utils/scrape-logger';
import type {
  ScanSource,
  ScrapeRequest,
  ScrapeResult,
  ScraperOptions,
  ProxyConfig,
} from './types';

/**
 * Base scraper class with enhanced bot detection prevention features
 * - User-Agent rotation (30+ real browser profiles)
 * - Header spoofing (Accept-Language, Referer, Cache-Control)
 * - Request delays with jitter (3-8s with ±20% variance)
 * - Session management with cookie persistence
 * - Retry logic with HTTP status-specific handling
 * - Structured logging with event tracking
 * - Proxy interface (designed but not implemented)
 */
export abstract class BaseScraper {
  protected source: ScanSource;
  protected options: Required<ScraperOptions>;
  protected sessionManager: SessionManager;
  protected proxyConfig?: ProxyConfig;
  protected sessionId: string;
  
  // Logging context - can be set externally
  public scanId?: number;
  public hotelId?: number;
  public hotelName?: string;

  constructor(source: ScanSource, options: ScraperOptions = {}) {
    this.source = source;

    // Set default options
    this.options = {
      userAgentRotation: source.user_agent_rotation ?? true,
      rateLimitMs: source.rate_limit_ms ?? 3000, // Default 3s (bot detection requirement)
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      timeout: options.timeout ?? 30000,
    };

    // Initialize session manager (10-20 requests per session)
    this.sessionManager = new SessionManager(15);
    
    // Generate unique session ID for tracking
    this.sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get headers for HTTP requests with spoofing
   */
  protected getHeaders(): Record<string, string> {
    const session = this.sessionManager.getSession();
    const headers = getSpoofedHeaders();

    // Add cookies from session if available
    const cookieString = session.getCookieString();
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }

    return headers;
  }

  /**
   * Apply request delay with jitter to mimic human behavior
   * Base delay: 3-8 seconds with ±20% jitter
   */
  protected async applyDelay(): Promise<number> {
    const baseDelay = getRandomDelay(3000, 8000); // 3-8 seconds
    const delayWithJitter = applyJitter(baseDelay, 20); // ±20% jitter
    await sleep(delayWithJitter);
    return delayWithJitter;
  }

  /**
   * Fetch HTML content from a URL with retries and rate limiting
   */
  protected async fetchHTML(url: string, hotelId?: number): Promise<string> {
    let retryCount = 0;
    let lastDelay = 0;
    const userAgent = this.getHeaders()['User-Agent'];

    try {
      // Apply delay before request
      lastDelay = await this.applyDelay();

      // Increment session request count
      this.sessionManager.incrementRequestCount();

      // Fetch with retry logic
      const html = await retryWithStatusHandling(
        async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

          try {
            const response = await fetch(url, {
              method: 'GET',
              headers: this.getHeaders(),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Store cookies from response
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) {
              this.sessionManager.getSession().parseCookieHeader(setCookie);
            }

            if (!response.ok) {
              const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
              error.status = response.status;
              error.statusCode = response.status;
              throw error;
            }

            return await response.text();
          } catch (error: any) {
            clearTimeout(timeoutId);
            
            // Handle abort errors as timeouts
            if (error.name === 'AbortError') {
              const timeoutError: any = new Error('Request timeout');
              timeoutError.code = 'ETIMEDOUT';
              throw timeoutError;
            }
            
            throw error;
          }
        },
        this.options.maxRetries,
        (retryAttempt, error, delayMs) => {
          retryCount = retryAttempt;
          const httpStatus = error.status || error.statusCode || 0;
          
          // Log retry event
          logScrapeEvent(createScrapeEvent(
            'error',
            url,
            `Retry attempt ${retryAttempt + 1}: ${error.message}`,
            {
              hotel_id: hotelId,
              http_status: httpStatus,
              retry_count: retryAttempt,
              error_message: error.message,
              user_agent: userAgent,
              delay_ms: delayMs,
            }
          ));
        }
      );

      // Log success
      logScrapeEvent(createScrapeEvent(
        'success',
        url,
        'Scrape completed successfully',
        {
          hotel_id: hotelId,
          http_status: 200,
          retry_count: retryCount,
          delay_ms: lastDelay,
          user_agent: userAgent,
        }
      ));

      return html;

    } catch (error: any) {
      const httpStatus = error.status || error.statusCode || 0;
      
      // Determine status based on error type
      let scrapeStatus: 'error' | 'timeout' | 'block' | 'manual_review' = 'error';
      let reason = error.message || 'Unknown error';

      // HTTP 403 - Bot blocked
      if (httpStatus === 403 || error.botBlocked) {
        scrapeStatus = 'block';
        reason = 'Bot detection - HTTP 403 Forbidden';
      }
      // HTTP 429 - Rate limit
      else if (httpStatus === 429) {
        scrapeStatus = 'block';
        reason = 'Booking.com rate limit (429)';
      }
      // Timeout
      else if (isTimeoutError(error)) {
        scrapeStatus = 'timeout';
        reason = 'Request timeout (>30s)';
      }
      // Other errors
      else {
        scrapeStatus = 'error';
        reason = `HTTP ${httpStatus}: ${error.message}`;
      }

      // Log error event
      logScrapeEvent(createScrapeEvent(
        scrapeStatus,
        url,
        reason,
        {
          hotel_id: hotelId,
          http_status: httpStatus,
          retry_count: retryCount,
          error_message: error.message,
          user_agent: userAgent,
        }
      ));

      throw error;
    }
  }

  /**
   * Parse HTML and extract data using CSS selectors
   */
  protected parseData(html: string): Record<string, string | null> {
    const selectors = this.source.css_selectors;
    
    if (!selectors) {
      return {};
    }

    return extractMultiple(html, selectors as Record<string, string>);
  }

  /**
   * Build the URL for a scraping request
   * Must be implemented by subclasses
   */
  protected abstract buildURL(request: ScrapeRequest): string;

  /**
   * Process scraped data and determine availability status
   * Must be implemented by subclasses
   */
  protected abstract processData(
    data: Record<string, string | null>,
    html: string
  ): ScrapeResult;

  /**
   * Scrape data for a single hotel/date combination
   */
  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const startTime = Date.now();
    let url = '';
    let httpStatus: number | undefined;
    let retryCount = 0;
    let delayMs = this.options.rateLimitMs;
    let userAgent = '';
    
    try {
      // Build the URL for the request
      url = this.buildURL(request);

      // Extract hotel ID if available (for logging)
      const hotelId = parseInt(request.hotelCode) || undefined;
      
      // Get user agent for logging
      userAgent = this.getHeaders()['User-Agent'] || 'Unknown';

      // Fetch HTML content
      const html = await this.fetchHTML(url, hotelId);
      httpStatus = 200;

      // Parse data using CSS selectors
      const parsedData = this.parseData(html);

      // Process data and return result
      const result = this.processData(parsedData, html);
      
      // Calculate response time
      const responseTimeMs = Date.now() - startTime;

      // Log successful scrape to database
      // Note: retry_count and delay_ms are logged internally by fetchHTML's console logger
      // This top-level log captures overall scrape success with scan/hotel context
      await logScrapeEventToDB({
        timestamp: new Date(),
        scrape_status: 'success',
        hotel_id: this.hotelId || hotelId,
        hotel_name: this.hotelName,
        scan_id: this.scanId,
        check_in_date: request.checkInDate,
        url,
        http_status: httpStatus,
        delay_ms: undefined,
        retry_count: 0,
        error_message: null,
        user_agent: userAgent,
        reason: undefined,
        response_time_ms: responseTimeMs,
        session_id: this.sessionId,
      });

      return result;
    } catch (error: any) {
      console.error('[BaseScraper] Scrape error:', error);

      const responseTimeMs = Date.now() - startTime;
      const errorStatus = error.status || error.code;
      
      // Determine scrape status
      let scrapeStatus: 'error' | 'timeout' | 'block' | 'manual_review' = 'error';
      let reason = error.message || 'Unknown error';
      
      if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
        scrapeStatus = 'timeout';
        reason = `Timeout after ${this.options.timeout}ms`;
      } else if (error.status === 429 || error.status === 403) {
        scrapeStatus = 'block';
        if (error.status === 429) {
          reason = 'Booking.com rate limit (429)';
        } else {
          reason = 'Access forbidden (403) - possible IP block';
        }
      } else if (error.status === 503) {
        scrapeStatus = 'block';
        reason = 'Service unavailable (503) - possible bot detection';
      }

      // Log error to database
      // Note: retry_count and delay_ms are logged internally by fetchHTML's console logger
      // This top-level log captures overall scrape failure with scan/hotel context
      await logScrapeEventToDB({
        timestamp: new Date(),
        scrape_status: scrapeStatus,
        hotel_id: this.hotelId || (request.hotelCode ? parseInt(request.hotelCode) : undefined),
        hotel_name: this.hotelName,
        scan_id: this.scanId,
        check_in_date: request.checkInDate,
        url,
        http_status: error.status,
        delay_ms: undefined,
        retry_count: 0,
        error_message: error.message,
        user_agent: userAgent || 'Unknown',
        reason,
        response_time_ms: responseTimeMs,
        session_id: this.sessionId,
      });

      return {
        status: 'error',
        errorMessage: error.message || 'Unknown error',
        scrapedData: { error: String(error) },
      };
    }
  }

  /**
   * Scrape multiple requests in sequence (to respect rate limiting)
   */
  async scrapeMultiple(requests: ScrapeRequest[]): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];

    for (const request of requests) {
      const result = await this.scrape(request);
      results.push(result);
    }

    return results;
  }

  /**
   * Update scraper options
   */
  updateOptions(options: Partial<ScraperOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Configure proxy settings (prepared for future implementation)
   */
  setProxyConfig(config: ProxyConfig): void {
    this.proxyConfig = config;
    // Future: Implement actual proxy rotation
  }

  /**
   * Get the current source configuration
   */
  getSource(): ScanSource {
    return this.source;
  }

  /**
   * Get session statistics
   */
  getSessionStats(): { requestCount: number; sessionAge: number; cookieCount: number } {
    return this.sessionManager.getStats();
  }

  /**
   * Get scraping statistics
   */
  getScrapeStats(): Record<string, number> {
    return getLogger().getStats();
  }

  /**
   * Force session rotation
   */
  rotateSession(): void {
    this.sessionManager.rotateSession();
  }
  
  /**
   * Set logging context for scrape events
   */
  setLoggingContext(context: { scanId?: number; hotelId?: number; hotelName?: string }): void {
    this.scanId = context.scanId;
    this.hotelId = context.hotelId;
    this.hotelName = context.hotelName;
  }
}
