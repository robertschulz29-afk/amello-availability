// lib/scrapers/BaseScraper.ts
// Base class for web scraping with bot detection prevention

import { getRandomUserAgent, getNextUserAgent } from './utils/user-agents';
import { RateLimiter, randomSleep } from './utils/delays';
import { parseHTML, extractText, extractMultiple } from './utils/html-parser';
import { retry, isRetryableError } from './utils/retry';
import { logScrapeEvent } from './utils/scrape-logger';
import type {
  ScanSource,
  ScrapeRequest,
  ScrapeResult,
  ScraperOptions,
} from './types';

/**
 * Base scraper class with bot detection prevention features
 * - User-Agent rotation
 * - Request rate limiting
 * - Random delays between requests
 * - Retry logic with exponential backoff
 * - HTML parsing with CSS selectors
 */
export abstract class BaseScraper {
  protected source: ScanSource;
  protected rateLimiter: RateLimiter;
  protected options: Required<ScraperOptions>;
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
      rateLimitMs: source.rate_limit_ms ?? 2000,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      timeout: options.timeout ?? 30000,
    };

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter(this.options.rateLimitMs);
    
    // Generate unique session ID for tracking
    this.sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get headers for HTTP requests with User-Agent rotation
   */
  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
    };

    // Rotate User-Agent if enabled
    if (this.options.userAgentRotation) {
      headers['User-Agent'] = getRandomUserAgent();
    }

    return headers;
  }

  /**
   * Fetch HTML content from a URL with retries and rate limiting
   */
  protected async fetchHTML(url: string): Promise<string> {
    // Wait for rate limiter
    await this.rateLimiter.waitForNextRequest();

    // Add random delay to mimic human behavior
    await randomSleep(100, 500);

    // Retry with exponential backoff
    return retry(
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

          if (!response.ok) {
            const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            throw error;
          }

          return await response.text();
        } catch (error: any) {
          clearTimeout(timeoutId);
          
          // Handle abort errors
          if (error.name === 'AbortError') {
            const timeoutError: any = new Error('Request timeout');
            timeoutError.code = 'ETIMEDOUT';
            throw timeoutError;
          }
          
          throw error;
        }
      },
      {
        maxRetries: this.options.maxRetries,
        baseDelayMs: this.options.retryDelayMs,
        maxDelayMs: 30000,
        exponentialBackoff: true,
        onRetry: (attempt, error) => {
          console.log(`[BaseScraper] Retry attempt ${attempt} for ${url}: ${error.message}`);
        },
      }
    );
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

      // Track retry count
      const originalRetry = retry;
      let attemptCount = 0;

      // Fetch HTML content with retry tracking
      const html = await retry(
        async () => {
          attemptCount++;
          
          // Wait for rate limiter
          await this.rateLimiter.waitForNextRequest();

          // Add random delay to mimic human behavior
          const randomDelayMs = Math.floor(Math.random() * 400) + 100;
          await randomSleep(100, 500);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

          try {
            const headers = this.getHeaders();
            userAgent = headers['User-Agent'] || '';
            
            const response = await fetch(url, {
              method: 'GET',
              headers,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);
            httpStatus = response.status;

            if (!response.ok) {
              const error: any = new Error(`HTTP ${response.status}: ${response.statusText}`);
              error.status = response.status;
              throw error;
            }

            return await response.text();
          } catch (error: any) {
            clearTimeout(timeoutId);
            
            // Handle abort errors
            if (error.name === 'AbortError') {
              const timeoutError: any = new Error('Request timeout');
              timeoutError.code = 'ETIMEDOUT';
              throw timeoutError;
            }
            
            throw error;
          }
        },
        {
          maxRetries: this.options.maxRetries,
          baseDelayMs: this.options.retryDelayMs,
          maxDelayMs: 30000,
          exponentialBackoff: true,
          onRetry: (attempt, error) => {
            retryCount = attempt;
            console.log(`[BaseScraper] Retry attempt ${attempt} for ${url}: ${error.message}`);
          },
        }
      );

      // Parse data using CSS selectors
      const parsedData = this.parseData(html);

      // Process data and return result
      const result = this.processData(parsedData, html);
      
      // Calculate response time
      const responseTimeMs = Date.now() - startTime;

      // Log successful scrape
      await logScrapeEvent({
        timestamp: new Date(),
        scrape_status: 'success',
        hotel_id: this.hotelId,
        hotel_name: this.hotelName,
        scan_id: this.scanId,
        check_in_date: request.checkInDate,
        url,
        http_status: httpStatus || 200,
        delay_ms: delayMs,
        retry_count: retryCount,
        error_message: null,
        user_agent: userAgent,
        reason: 'Scrape completed successfully',
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

      // Log error
      await logScrapeEvent({
        timestamp: new Date(),
        scrape_status: scrapeStatus,
        hotel_id: this.hotelId,
        hotel_name: this.hotelName,
        scan_id: this.scanId,
        check_in_date: request.checkInDate,
        url,
        http_status: error.status,
        delay_ms: delayMs,
        retry_count: retryCount,
        error_message: error.message,
        user_agent: userAgent,
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
    
    if (options.rateLimitMs !== undefined) {
      this.rateLimiter.setMinDelay(options.rateLimitMs);
    }
  }

  /**
   * Get the current source configuration
   */
  getSource(): ScanSource {
    return this.source;
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
