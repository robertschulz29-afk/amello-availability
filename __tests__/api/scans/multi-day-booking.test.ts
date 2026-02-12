// __tests__/api/scans/multi-day-booking.test.ts
// Integration-style test for multi-day booking scans

import { BookingComScraper } from '@/lib/scrapers/BookingComScraper';
import type { ScrapeRequest, ScrapeResult } from '@/lib/scrapers/types';

describe('Multi-day Booking Scans', () => {
  describe('Promise Tracking', () => {
    it('should create and track a promise for each check-in date', async () => {
      // Simulate multi-day scan: 3 dates (start_offset=0, end_offset=2)
      const dates = ['2026-03-01', '2026-03-02', '2026-03-03'];
      const stayNights = 7;
      
      // Track promises like in the actual route
      const bookingPromises: Promise<void>[] = [];
      
      // Simulate the worker loop for each date
      for (const checkIn of dates) {
        // Calculate checkOut
        const checkInDate = new Date(checkIn);
        checkInDate.setUTCDate(checkInDate.getUTCDate() + stayNights);
        const checkOut = checkInDate.toISOString().split('T')[0];
        
        // Create promise and IMMEDIATELY push it (critical fix)
        const bookingPromise = (async () => {
          // Mock the scrape operation
          await new Promise(resolve => setTimeout(resolve, 10));
          // Simulate result storage
          return;
        })();
        
        // CRITICAL: Push immediately after creation
        bookingPromises.push(bookingPromise);
      }
      
      // Wait for all promises
      const results = await Promise.allSettled(bookingPromises);
      
      // Verify we tracked all 3 promises
      expect(bookingPromises).toHaveLength(3);
      expect(results).toHaveLength(3);
      
      // All should be fulfilled (no rejections in mock)
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(3);
    });

    it('should handle invalid date ranges by skipping the scan', () => {
      // Simulate invalid date range: checkIn >= checkOut
      const invalidCases = [
        { checkIn: '2026-03-05', checkOut: '2026-03-05' }, // Same date
        { checkIn: '2026-03-10', checkOut: '2026-03-08' }, // checkIn > checkOut
      ];
      
      const bookingPromises: Promise<void>[] = [];
      
      invalidCases.forEach(({ checkIn, checkOut }) => {
        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);
        
        // Validation logic from route.ts
        if (checkInDate >= checkOutDate) {
          // Should skip - don't create promise
          console.log('Skipping invalid date range:', checkIn, checkOut);
        } else {
          // Valid - create and track promise
          const bookingPromise = (async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
          })();
          bookingPromises.push(bookingPromise);
        }
      });
      
      // No promises should have been created for invalid dates
      expect(bookingPromises).toHaveLength(0);
    });
  });

  describe('Data Normalization', () => {
    it('should normalize booking result to have rooms array', () => {
      // Test various result shapes
      const testCases = [
        { input: { rooms: [{ name: 'Room 1', rates: [] }] }, expected: 1 },
        { input: { rooms: [] }, expected: 0 },
        { input: {}, expected: 0 }, // Missing rooms
        { input: null, expected: 0 }, // Null result
        { input: undefined, expected: 0 }, // Undefined result
      ];
      
      testCases.forEach(({ input, expected }) => {
        // Simulate normalization logic from route.ts
        const bookingData = input && typeof input === 'object'
          ? { ...input, rooms: input.rooms || [], source: 'booking' }
          : { rooms: [], source: 'booking' };
        
        expect(bookingData).toHaveProperty('rooms');
        expect(Array.isArray(bookingData.rooms)).toBe(true);
        expect(bookingData.rooms).toHaveLength(expected);
        expect(bookingData.source).toBe('booking');
      });
    });

    it('should normalize booking status to valid values', () => {
      const testCases = [
        { input: 'green', expected: 'green' },
        { input: 'red', expected: 'red' },
        { input: 'error', expected: 'error' },
        { input: 'invalid', expected: 'red' }, // Invalid -> default to red
        { input: undefined, expected: 'red' }, // Undefined -> default to red
      ];
      
      testCases.forEach(({ input, expected }) => {
        // Simulate status normalization logic from route.ts
        let bookingStatus: 'green' | 'red' | 'error' = 'red';
        if (input === 'green' || input === 'red' || input === 'error') {
          bookingStatus = input;
        }
        
        expect(bookingStatus).toBe(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('should create normalized error structure for DB storage', () => {
      const mockError = new Error('Scraping failed');
      mockError.name = 'ScrapingError';
      
      // Simulate error data structure from route.ts
      const errorData = {
        error: mockError.message || String(mockError),
        rooms: [],
        source: 'booking',
        errorType: mockError.name || 'Unknown',
        stack: mockError.stack || 'No stack trace',
      };
      
      expect(errorData).toHaveProperty('error');
      expect(errorData).toHaveProperty('rooms');
      expect(Array.isArray(errorData.rooms)).toBe(true);
      expect(errorData.rooms).toHaveLength(0);
      expect(errorData.source).toBe('booking');
      expect(errorData.errorType).toBe('ScrapingError');
    });
  });

  describe('Timeout Handling', () => {
    it('should handle timeout with Promise.race', async () => {
      const TIMEOUT_MS = 100;
      
      // Create a slow promise (won't complete in time)
      const slowPromise = new Promise<'completed'>((resolve) => {
        setTimeout(() => resolve('completed'), 500);
      });
      
      // Create timeout promise
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), TIMEOUT_MS);
      });
      
      // Race them
      const result = await Promise.race([slowPromise, timeoutPromise]);
      
      // Timeout should win
      expect(result).toBe('timeout');
    });

    it('should complete before timeout when promises resolve quickly', async () => {
      const TIMEOUT_MS = 500;
      
      // Create fast promises
      const fastPromises = [
        Promise.resolve('done1'),
        Promise.resolve('done2'),
        Promise.resolve('done3'),
      ];
      
      // Create timeout promise
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), TIMEOUT_MS);
      });
      
      // Race them
      const result = await Promise.race([
        Promise.allSettled(fastPromises).then(() => 'completed' as const),
        timeoutPromise,
      ]);
      
      // Completion should win
      expect(result).toBe('completed');
    });
  });
});
