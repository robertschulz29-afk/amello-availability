// lib/scrapers/utils/retry.ts
// Retry logic with exponential backoff for handling transient failures

import { sleep } from './delays';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  exponentialBackoff?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Calculate delay for a retry attempt with exponential backoff
 */
function calculateRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  exponentialBackoff: boolean
): number {
  if (!exponentialBackoff) {
    return baseDelayMs;
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  
  // Add jitter (±20%) to avoid thundering herd
  const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
  const delayWithJitter = exponentialDelay + jitter;
  
  // Cap at maxDelayMs
  return Math.min(delayWithJitter, maxDelayMs);
}

/**
 * Retry a function with exponential backoff
 * @param fn - Async function to retry
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries fail
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    exponentialBackoff = true,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Call the onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      // Calculate and wait for the retry delay
      const delay = calculateRetryDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        exponentialBackoff
      );
      
      console.log(
        `[retry] Attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${Math.round(delay)}ms...`
      );
      
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}

/**
 * Check if an error is retryable (e.g., network errors, 5xx status codes)
 */
export function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
    return true;
  }

  // HTTP 5xx errors are typically retryable
  if (error.status >= 500 && error.status < 600) {
    return true;
  }

  // HTTP 429 (Too Many Requests) is retryable with backoff
  if (error.status === 429) {
    return true;
  }

  return false;
}

/**
 * Conditional retry: only retry if error is retryable
 */
export async function retryIfNeeded<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retry(async () => {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error)) {
        throw error; // Don't retry non-retryable errors
      }
      throw error;
    }
  }, options);
}
