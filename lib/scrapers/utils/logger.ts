// lib/scrapers/utils/logger.ts
// Structured logging for scraping events with standardized codes

/**
 * Scraping event status codes
 */
export type ScrapeStatus = 'success' | 'error' | 'timeout' | 'block' | 'manual_review';

/**
 * Structured scraping event for logging
 */
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

/**
 * Logger configuration
 */
export interface LoggerConfig {
  enableConsole?: boolean;
  enableFile?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

class ScraperLogger {
  private config: Required<LoggerConfig>;
  private events: ScrapeEvent[] = [];

  constructor(config: LoggerConfig = {}) {
    this.config = {
      enableConsole: config.enableConsole ?? true,
      enableFile: config.enableFile ?? false,
      logLevel: config.logLevel ?? 'info',
    };
  }

  /**
   * Log a scraping event with structured data
   */
  logEvent(event: ScrapeEvent): void {
    // Store event in memory
    this.events.push(event);

    // Log to console if enabled
    if (this.config.enableConsole) {
      this.logToConsole(event);
    }

    // File logging would go here if needed
    if (this.config.enableFile) {
      // Future implementation: write to file
    }
  }

  /**
   * Log event to console with color coding
   */
  private logToConsole(event: ScrapeEvent): void {
    const timestamp = new Date(event.timestamp).toISOString();
    const status = event.scrape_status.toUpperCase().padEnd(13);
    const httpStatus = event.http_status ? `HTTP ${event.http_status}` : '';
    const retries = event.retry_count > 0 ? `[Retry ${event.retry_count}]` : '';
    
    let message = `[${timestamp}] ${status} ${httpStatus} ${retries} - ${event.reason}`;
    
    if (event.url) {
      message += `\n  URL: ${event.url}`;
    }
    
    if (event.error_message) {
      message += `\n  Error: ${event.error_message}`;
    }
    
    if (event.delay_ms !== undefined) {
      message += `\n  Delay: ${event.delay_ms}ms`;
    }

    // Color coding based on status
    switch (event.scrape_status) {
      case 'success':
        console.log(`✓ ${message}`);
        break;
      case 'error':
        console.error(`✗ ${message}`);
        break;
      case 'timeout':
        console.warn(`⏱ ${message}`);
        break;
      case 'block':
        console.error(`🚫 ${message}`);
        break;
      case 'manual_review':
        console.warn(`⚠ ${message}`);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * Get all logged events
   */
  getEvents(): ScrapeEvent[] {
    return [...this.events];
  }

  /**
   * Get events by status
   */
  getEventsByStatus(status: ScrapeStatus): ScrapeEvent[] {
    return this.events.filter(e => e.scrape_status === status);
  }

  /**
   * Get event statistics
   */
  getStats(): Record<ScrapeStatus, number> {
    const stats: Record<string, number> = {
      success: 0,
      error: 0,
      timeout: 0,
      block: 0,
      manual_review: 0,
    };

    for (const event of this.events) {
      stats[event.scrape_status]++;
    }

    return stats as Record<ScrapeStatus, number>;
  }

  /**
   * Clear all logged events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
let loggerInstance: ScraperLogger | null = null;

/**
 * Get or create the logger instance
 */
export function getLogger(config?: LoggerConfig): ScraperLogger {
  if (!loggerInstance) {
    loggerInstance = new ScraperLogger(config);
  } else if (config) {
    loggerInstance.updateConfig(config);
  }
  return loggerInstance;
}

/**
 * Log a scraping event (convenience function)
 */
export function logScrapeEvent(event: ScrapeEvent): void {
  getLogger().logEvent(event);
}

/**
 * Create a scrape event helper
 */
export function createScrapeEvent(
  status: ScrapeStatus,
  url: string,
  reason: string,
  options: {
    hotel_id?: number;
    http_status?: number;
    delay_ms?: number;
    retry_count?: number;
    error_message?: string;
    user_agent?: string;
  } = {}
): ScrapeEvent {
  return {
    timestamp: new Date().toISOString(),
    scrape_status: status,
    url,
    reason,
    hotel_id: options.hotel_id,
    http_status: options.http_status,
    delay_ms: options.delay_ms,
    retry_count: options.retry_count ?? 0,
    error_message: options.error_message ?? null,
    user_agent: options.user_agent,
  };
}
