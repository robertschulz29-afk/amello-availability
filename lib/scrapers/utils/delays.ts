// lib/scrapers/utils/delays.ts
// Request delay and throttling utilities for rate limiting

/**
 * Sleep for a specified number of milliseconds
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random delay between min and max milliseconds
 * Useful for mimicking human behavior
 */
export function getRandomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Sleep for a random duration between min and max milliseconds
 */
export async function randomSleep(minMs: number, maxMs: number): Promise<void> {
  const delay = getRandomDelay(minMs, maxMs);
  return sleep(delay);
}

/**
 * Rate limiter class to enforce minimum delay between requests
 */
export class RateLimiter {
  private lastRequestTime: number = 0;
  private minDelayMs: number;

  constructor(minDelayMs: number) {
    this.minDelayMs = minDelayMs;
  }

  /**
   * Wait until enough time has passed since the last request
   */
  async waitForNextRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minDelayMs) {
      const waitTime = this.minDelayMs - timeSinceLastRequest;
      await sleep(waitTime);
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Update the minimum delay between requests
   */
  setMinDelay(minDelayMs: number): void {
    this.minDelayMs = minDelayMs;
  }

  /**
   * Get the current minimum delay
   */
  getMinDelay(): number {
    return this.minDelayMs;
  }
}
