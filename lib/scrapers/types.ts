// lib/scrapers/types.ts
// TypeScript interfaces for the web scraping infrastructure

/**
 * Configuration for a booking source (e.g., Booking.com, Expedia)
 */
export interface ScanSource {
  id: number;
  name: string;
  enabled: boolean;
  base_url: string | null;
  css_selectors: CSSSelectors | null;
  rate_limit_ms: number;
  user_agent_rotation: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * CSS selectors for extracting data from HTML pages
 */
export interface CSSSelectors {
  availability?: string;
  price?: string;
  currency?: string;
  rooms?: string;
  error?: string;
  [key: string]: string | undefined; // Allow additional custom selectors
}

/**
 * Scraping request parameters
 */
export interface ScrapeRequest {
  hotelCode: string;
  checkInDate: string; // YYYY-MM-DD format
  checkOutDate: string; // YYYY-MM-DD format
  adults?: number;
  children?: number;
  rooms?: number;
}

/**
 * Scraping result
 */
export interface ScrapeResult {
  status: 'green' | 'red' | 'pending' | 'error';
  scrapedData?: any; // Raw scraped data as JSON
  price?: number;
  currency?: string;
  availabilityText?: string;
  errorMessage?: string;
}

/**
 * Extended scan result for database storage
 */
export interface ScanResultExtended {
  id?: number;
  scan_id: number;
  hotel_id: number;
  source_id: number;
  check_in_date: string;
  check_out_date: string | null;
  status: 'green' | 'red' | 'pending' | 'error';
  scraped_data?: any;
  price?: number;
  currency?: string;
  availability_text?: string;
  error_message?: string;
  scraped_at?: Date;
}

/**
 * Options for the BaseScraper
 */
export interface ScraperOptions {
  userAgentRotation?: boolean;
  rateLimitMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  timeout?: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBackoff: boolean;
}

/**
 * Proxy configuration interface (for future implementation)
 * Designed to support proxy rotation without refactoring scraper
 */
export interface ProxyConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
  rotationEnabled?: boolean;
  rotationInterval?: number; // Requests before rotation
}

/**
 * Header options for customizing HTTP headers
 */
export interface HeaderOptions {
  userAgent?: string;
  referer?: string;
  acceptLanguage?: string;
  cacheControl?: string;
}

/**
 * Scraping event for structured logging
 */
export type ScrapeStatus = 'success' | 'error' | 'timeout' | 'block' | 'manual_review';

export interface ScrapeEvent {
  timestamp: string;
  scrape_status: ScrapeStatus;
  hotel_id?: number;
  url: string;
  http_status?: number;
  delay_ms?: number;
  retry_count: number;
  error_message: string | null;
  user_agent?: string;
  reason: string;
}
