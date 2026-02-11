// lib/scrapers/BaseScraper.ts
// Base class for web scraping with bot detection prevention

import { getRandomUserAgent, getNextUserAgent } from './utils/user-agents';
import { RateLimiter, randomSleep } from './utils/delays';
import { parseHTML, extractText, extractMultiple } from './utils/html-parser';
import { retry, isRetryableError } from './utils/retry';
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
    try {
      // Build the URL for the request
      const url = this.buildURL(request);

      // Fetch HTML content
      const html = await this.fetchHTML(url);

      // Parse data using CSS selectors
      const parsedData = this.parseData(html);

      // Process data and return result
      return this.processData(parsedData, html);
    } catch (error: any) {
      console.error('[BaseScraper] Scrape error:', error);

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
}
