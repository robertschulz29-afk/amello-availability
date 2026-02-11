// lib/scrapers/BookingComScraper.ts
// Booking.com scraper implementation

import { BaseScraper } from './BaseScraper';
import type { ScrapeRequest, ScrapeResult } from './types';

/**
 * BookingComScraper - Scraper for Booking.com
 * 
 * Uses the booking_url from hotels table to scrape availability and pricing data.
 * Implements bot detection prevention via BaseScraper (rate limiting, User-Agent rotation, retries).
 */
export class BookingComScraper extends BaseScraper {
  /**
   * Build the URL for Booking.com search
   * @param request - Search parameters (hotel, dates, occupancy)
   * @returns Complete Booking.com URL
   */
  protected buildURL(request: ScrapeRequest): string {
    const { hotelCode, checkInDate, checkOutDate, adults = 2, children = 0, rooms = 1 } = request;
    
    // If base_url is set (from hotel's booking_url), use it as the base
    // Otherwise construct from scratch
    let baseUrl = this.source.base_url || 'https://www.booking.com';
    
    // If the base_url already contains query parameters, parse and merge
    const url = new URL(baseUrl);
    
    // Set or override key parameters for availability check
    url.searchParams.set('checkin', checkInDate);
    url.searchParams.set('checkout', checkOutDate);
    url.searchParams.set('group_adults', adults.toString());
    url.searchParams.set('group_children', children.toString());
    url.searchParams.set('no_rooms', rooms.toString());
    
    return url.toString();
  }

  /**
   * Process scraped data from Booking.com and determine availability
   * @param data - Extracted data using CSS selectors
   * @param html - Raw HTML (for advanced parsing if needed)
   * @returns Scraping result with status and extracted information
   */
  protected processData(
    data: Record<string, string | null>,
    html: string
  ): ScrapeResult {
    const availabilityText = data.availability?.toLowerCase() || '';
    const priceText = data.price || '';
    const errorText = data.error || '';
    const roomsText = data.rooms || '';

    // Check for error conditions (hotel not found, page error, etc.)
    if (errorText) {
      if (errorText.toLowerCase().includes('not found') || 
          errorText.toLowerCase().includes('unavailable') ||
          errorText.toLowerCase().includes('error')) {
        return {
          status: 'error',
          errorMessage: errorText,
          scrapedData: { error: errorText },
        };
      }
    }

    // Check for explicit "no availability" indicators
    if (availabilityText.includes('sold out') || 
        availabilityText.includes('not available') ||
        availabilityText.includes('no rooms') ||
        availabilityText.includes('fully booked')) {
      return {
        status: 'red',
        availabilityText: data.availability || undefined,
        scrapedData: data,
      };
    }

    // Try to extract price
    let price: number | undefined;
    let currency: string | undefined;
    
    if (priceText) {
      // Booking.com typically shows prices like "€150" or "$200"
      const priceMatch = priceText.match(/([€$£])?\s*([\d,]+\.?\d*)/);
      
      if (priceMatch && priceMatch[2]) {
        price = parseFloat(priceMatch[2].replace(/,/g, ''));
        // Use capture group [1] for currency if available, otherwise default to EUR
        currency = priceMatch[1] ? this.getCurrencyCode(priceMatch[1]) : 'EUR';
      }
    }

    // If we found rooms or a price, consider it available
    // Use !== undefined to correctly handle 0 prices (free accommodations)
    if (roomsText || price !== undefined) {
      return {
        status: 'green',
        scrapedData: data,
        price,
        currency,
        availabilityText: data.availability || undefined,
      };
    }

    // Check for positive availability keywords
    if (availabilityText.includes('available') || 
        availabilityText.includes('rooms left') ||
        availabilityText.includes('in stock')) {
      return {
        status: 'green',
        scrapedData: data,
        price,
        currency,
        availabilityText: data.availability || undefined,
      };
    }

    // If HTML contains booking form or pricing elements, it's likely available
    // This is a fallback heuristic
    if (html.includes('reservation') || 
        html.includes('book now') ||
        html.includes('reserve')) {
      return {
        status: 'green',
        scrapedData: data,
        availabilityText: 'Found booking elements',
      };
    }

    // Default to red if we can't determine availability
    // Better to be conservative and mark as unavailable if uncertain
    return {
      status: 'red',
      scrapedData: data,
      availabilityText: 'Unable to determine availability',
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
    return map[symbol] || 'EUR'; // Default to EUR for Booking.com
  }
}
