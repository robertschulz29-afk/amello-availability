// lib/scrapers/examples/ExampleScraper.ts
// Example implementation of a booking source scraper
// This demonstrates how to extend BaseScraper for a specific booking site

import { BaseScraper } from '../BaseScraper';
import type { ScrapeRequest, ScrapeResult } from '../types';

/**
 * Example scraper implementation for demonstration purposes
 * 
 * To create a scraper for a real booking source (e.g., Booking.com):
 * 1. Extend BaseScraper
 * 2. Implement buildURL() to construct the search URL
 * 3. Implement processData() to extract and interpret the scraped data
 * 4. Configure CSS selectors in the scan_sources table
 */
export class ExampleScraper extends BaseScraper {
  /**
   * Build the URL for the booking search
   * @param request - Search parameters (hotel, dates, occupancy)
   * @returns Complete URL to scrape
   */
  protected buildURL(request: ScrapeRequest): string {
    const { hotelCode, checkInDate, checkOutDate, adults = 2, children = 0, rooms = 1 } = request;
    
    // Example: Construct URL with query parameters
    // Real implementation would use the actual booking site's URL structure
    const baseUrl = this.source.base_url || 'https://example-booking-site.com';
    const params = new URLSearchParams({
      hotel: hotelCode,
      checkin: checkInDate,
      checkout: checkOutDate,
      adults: adults.toString(),
      children: children.toString(),
      rooms: rooms.toString(),
    });

    return `${baseUrl}/hotel-search?${params.toString()}`;
  }

  /**
   * Process scraped data and determine availability
   * @param data - Extracted data using CSS selectors
   * @param html - Raw HTML (for advanced parsing if needed)
   * @returns Scraping result with status and extracted information
   */
  protected processData(
    data: Record<string, string | null>,
    html: string
  ): ScrapeResult {
    // Example: Check for availability indicators
    const availabilityText = data.availability?.toLowerCase() || '';
    const priceText = data.price || '';
    const errorText = data.error || '';

    // Check for error conditions
    if (errorText && errorText.includes('not found')) {
      return {
        status: 'error',
        errorMessage: 'Hotel not found',
        availabilityText: errorText,
      };
    }

    // Check for sold out / no availability
    if (availabilityText.includes('sold out') || 
        availabilityText.includes('not available') ||
        availabilityText.includes('no rooms')) {
      return {
        status: 'red',
        availabilityText: data.availability || undefined,
      };
    }

    // Extract price if available
    let price: number | undefined;
    let currency: string | undefined;
    
    if (priceText) {
      // Example: Parse "$199.99" or "€150,00"
      const priceMatch = priceText.match(/([€$£])?[\d,]+\.?\d*/);
      const currencyMatch = priceText.match(/[€$£]/);
      
      if (priceMatch) {
        price = parseFloat(priceMatch[0].replace(/[€$£,]/g, ''));
        currency = currencyMatch ? this.getCurrencyCode(currencyMatch[0]) : 'USD';
      }
    }

    // Check for positive availability
    if (availabilityText.includes('available') || 
        availabilityText.includes('rooms left') ||
        priceText) {
      return {
        status: 'green',
        scrapedData: data,
        price,
        currency,
        availabilityText: data.availability || undefined,
      };
    }

    // Default to red if we can't determine availability
    return {
      status: 'red',
      availabilityText: data.availability || undefined,
    };
  }

  /**
   * Helper: Convert currency symbol to ISO code
   */
  private getCurrencyCode(symbol: string): string {
    const map: Record<string, string> = {
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
    };
    return map[symbol] || 'USD';
  }
}

/**
 * Usage example:
 * 
 * // 1. Create a scan source in the database with CSS selectors
 * const source = {
 *   id: 1,
 *   name: 'Example Booking Site',
 *   enabled: true,
 *   base_url: 'https://example-booking-site.com',
 *   css_selectors: {
 *     availability: '.availability-status',
 *     price: '.room-price',
 *     error: '.error-message'
 *   },
 *   rate_limit_ms: 2000,
 *   user_agent_rotation: true,
 * };
 * 
 * // 2. Create scraper instance
 * const scraper = new ExampleScraper(source);
 * 
 * // 3. Scrape a hotel
 * const result = await scraper.scrape({
 *   hotelCode: 'HTL123',
 *   checkInDate: '2024-03-15',
 *   checkOutDate: '2024-03-17',
 *   adults: 2,
 *   children: 0,
 *   rooms: 1,
 * });
 * 
 * // 4. Check result
 * console.log(result.status); // 'green', 'red', 'pending', or 'error'
 * if (result.price) {
 *   console.log(`Price: ${result.price} ${result.currency}`);
 * }
 */
