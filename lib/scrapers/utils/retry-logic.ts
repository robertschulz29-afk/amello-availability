// lib/scrapers/utils/retry-logic.ts
// Enhanced retry logic with specific HTTP status handling for bot detection

import { sleep } from './delays';

/**
 * Calculate exponential backoff delay for retry attempts
 * 
 * @param retryCount - Current retry attempt (0-based)
 * @param baseDelayMs - Base delay in milliseconds (default: 2000ms)
 * @returns Delay in milliseconds for this retry
 */
export function getBackoffDelay(retryCount: number, baseDelayMs: number = 2000): number {
  // Exponential backoff: 2s → 4s → 8s
  return baseDelayMs * Math.pow(2, retryCount);
}

/**
 * Determine if an HTTP status code should trigger a retry
 * 
 * @param httpStatus - HTTP status code
 * @param retryCount - Current retry count
 * @returns true if should retry, false otherwise
 */
export function shouldRetry(httpStatus: number, retryCount: number): boolean {
  // HTTP 429 (Too Many Requests): Retry up to 3 times
  if (httpStatus === 429) {
    return retryCount < 3;
  }

  // HTTP 403 (Forbidden): Do NOT retry - mark as bot_blocked
  if (httpStatus === 403) {
    return false;
  }

  // HTTP 503 (Service Unavailable): Retry up to 3 times
  if (httpStatus === 503) {
    return retryCount < 3;
  }

  // HTTP 5xx errors: Retry up to 3 times
  if (httpStatus >= 500 && httpStatus < 600) {
    return retryCount < 3;
  }

  // Timeout errors: Retry up to 2 times
  // (This is checked separately in the retry logic)

  return false;
}

/**
 * Get appropriate delay for specific HTTP status codes
 * 
 * @param httpStatus - HTTP status code
 * @param retryCount - Current retry attempt (0-based)
 * @returns Delay in milliseconds
 */
export function getStatusSpecificDelay(httpStatus: number, retryCount: number): number {
  // HTTP 429 (Too Many Requests): Backoff 5-10 minutes
  if (httpStatus === 429) {
    const baseDelay = 5 * 60 * 1000; // 5 minutes
    const maxDelay = 10 * 60 * 1000; // 10 minutes
    const increment = (maxDelay - baseDelay) / 3;
    return baseDelay + (increment * retryCount);
  }

  // HTTP 503 (Service Unavailable): Exponential backoff (2s → 4s → 8s)
  if (httpStatus === 503) {
    return getBackoffDelay(retryCount, 2000);
  }

  // Other 5xx errors: Exponential backoff
  if (httpStatus >= 500 && httpStatus < 600) {
    return getBackoffDelay(retryCount, 2000);
  }

  // Default exponential backoff
  return getBackoffDelay(retryCount);
}

/**
 * Retry an async operation with specific HTTP status handling
 * 
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retry attempts
 * @param onRetry - Optional callback for retry events
 * @returns Result of the function
 * @throws Error if all retries fail
 */
export async function retryWithStatusHandling<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  onRetry?: (retryCount: number, error: any, delayMs: number) => void
): Promise<T> {
  let lastError: any;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const result = await fn();
      // Success - reset retry counter would happen here in real usage
      return result;
    } catch (error: any) {
      lastError = error;

      // Check if this is an HTTP error with status
      const httpStatus = error.status || error.statusCode || 0;

      // Special handling for 403 - don't retry, mark as blocked
      if (httpStatus === 403) {
        error.botBlocked = true;
        throw error;
      }

      // Check if we should retry based on status
      if (!shouldRetry(httpStatus, retryCount)) {
        throw error;
      }

      // If this was the last retry, throw the error
      if (retryCount >= maxRetries) {
        throw error;
      }

      // Calculate delay based on status code
      const delayMs = getStatusSpecificDelay(httpStatus, retryCount);

      // Call retry callback if provided
      if (onRetry) {
        onRetry(retryCount, error, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);

      retryCount++;
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: any): boolean {
  return (
    error.name === 'AbortError' ||
    error.code === 'ETIMEDOUT' ||
    error.message?.includes('timeout') ||
    error.message?.includes('timed out')
  );
}

/**
 * Retry with timeout-specific handling
 * Timeouts get up to 2 retries with longer delays
 */
export async function retryWithTimeoutHandling<T>(
  fn: () => Promise<T>,
  maxTimeoutRetries: number = 2,
  onRetry?: (retryCount: number, error: any, delayMs: number) => void
): Promise<T> {
  let lastError: any;
  let retryCount = 0;

  while (retryCount <= maxTimeoutRetries) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Only retry if it's a timeout error
      if (!isTimeoutError(error)) {
        throw error;
      }

      // If this was the last retry, throw the error
      if (retryCount >= maxTimeoutRetries) {
        throw error;
      }

      // Longer delay for timeout retries
      const delayMs = getBackoffDelay(retryCount, 5000); // 5s → 10s → 20s

      if (onRetry) {
        onRetry(retryCount, error, delayMs);
      }

      await sleep(delayMs);
      retryCount++;
    }
  }

  throw lastError || new Error('Timeout retry failed');
}
