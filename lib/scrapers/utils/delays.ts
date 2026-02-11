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
 * Default: 3-8 seconds (3000-8000ms) as per bot detection requirements
 */
export function getRandomDelay(minMs: number = 3000, maxMs: number = 8000): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Apply jitter (variance) to a delay value
 * Default jitter is ±20% of the original delay
 * 
 * @param delayMs - Base delay in milliseconds
 * @param jitterPercent - Percentage of variance (default: 20)
 * @returns Delay with jitter applied
 */
export function applyJitter(delayMs: number, jitterPercent: number = 20): number {
  const jitterRange = delayMs * (jitterPercent / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random value between -jitterRange and +jitterRange
  return Math.max(0, Math.floor(delayMs + jitter));
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
