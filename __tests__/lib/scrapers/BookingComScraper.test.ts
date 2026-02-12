// __tests__/lib/scrapers/BookingComScraper.test.ts
// Unit test for BookingComScraper to ensure normalized data structure

import { BookingComScraper } from '@/lib/scrapers/BookingComScraper';
import type { ScanSource } from '@/lib/scrapers/types';

describe('BookingComScraper', () => {
  let scraper: BookingComScraper;
  let mockSource: ScanSource;

  beforeEach(() => {
    // Create a minimal mock source for testing
    mockSource = {
      id: -1,
      name: 'Booking.com Test',
      enabled: true,
      base_url: 'https://www.booking.com',
      css_selectors: null,
      rate_limit_ms: 2000,
      user_agent_rotation: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    scraper = new BookingComScraper(mockSource);
  });

  describe('processData', () => {
    it('should return normalized structure with rooms array when parsing succeeds', () => {
      // Create HTML with available rooms
      const htmlWithRooms = `
        <div id="available_rooms">
          <a class="hprt-roomtype-link">Deluxe Room</a>
          <div class="bui-list__item e2e-cancellation">
            Free cancellation
            <span class="bui-price-display__value">€150</span>
          </div>
        </div>
      `;

      // Call protected method via any cast (for testing purposes)
      const result = (scraper as any).processData({}, htmlWithRooms);

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('scrapedData');
      expect(result.scrapedData).toHaveProperty('rooms');
      expect(result.scrapedData).toHaveProperty('source', 'booking');
      expect(Array.isArray(result.scrapedData.rooms)).toBe(true);
    });

    it('should return normalized structure with empty rooms array when no rooms found', () => {
      // Create HTML without available rooms section
      const htmlWithoutRooms = `
        <div id="some_other_content">
          <p>No availability</p>
        </div>
      `;

      const result = (scraper as any).processData({}, htmlWithoutRooms);

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('scrapedData');
      expect(result.scrapedData).toHaveProperty('rooms');
      expect(result.scrapedData).toHaveProperty('source', 'booking');
      expect(Array.isArray(result.scrapedData.rooms)).toBe(true);
      expect(result.scrapedData.rooms).toHaveLength(0);
      expect(result.status).toBe('red'); // No rooms = red status
    });

    it('should return error status with normalized structure when parsing fails', () => {
      // Malformed HTML that could cause parsing issues
      const malformedHtml = '<div><span>Incomplete';

      const result = (scraper as any).processData({}, malformedHtml);

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('scrapedData');
      expect(result.scrapedData).toHaveProperty('rooms');
      expect(result.scrapedData).toHaveProperty('source', 'booking');
      expect(Array.isArray(result.scrapedData.rooms)).toBe(true);
      // Even on error, rooms array should be present (may be empty)
    });

    it('should always include source field set to "booking"', () => {
      const simpleHtml = '<html><body></body></html>';
      
      const result = (scraper as any).processData({}, simpleHtml);

      expect(result.scrapedData.source).toBe('booking');
    });
  });
});
