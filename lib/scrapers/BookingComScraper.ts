// lib/scrapers/BookingComScraper.ts
// Booking.com scraper implementation with HTML parsing for rooms, rates, and prices

import { BaseScraper } from './BaseScraper';
import { parseHTML } from './utils/html-parser';
import type { ScrapeRequest, ScrapeResult } from './types';

/**
 * Data structure for Booking.com scraped data
 */
export interface BookingComData {
  rooms: Array<{
    type: string;
    name: string;
  }>;
  rates: Array<{
    type: string;
    name: string;
    cancellation: string;
  }>;
  prices: Array<{
    amount: number;
    currency: string;
    room_id: number;
    rate_id: number;
  }>;
  scrape_status: 'success' | 'failed' | 'timeout' | 'pending';
  error_message: string | null;
  scraped_at: string | null;
}

/**
 * BookingComScraper - Production-ready Booking.com scraper
 * 
 * Features:
 * - Constructs proper Booking.com URLs with search parameters
 * - Parses HTML to extract room types, rate types, and prices
 * - Stores structured data in booking_com_data JSONB column
 * - Handles errors and timeouts gracefully
 * 
 * Usage:
 * ```typescript
 * const source = {
 *   id: 1,
 *   name: 'Booking.com',
 *   base_url: 'https://www.booking.com',
 *   // ... other config
 * };
 * 
 * const scraper = new BookingComScraper(source);
 * const result = await scraper.scrape({
 *   hotelCode: '/hotel/de/example.html',
 *   checkInDate: '2024-03-15',
 *   checkOutDate: '2024-03-17',
 *   adults: 2,
 * });
 * ```
 */
export class BookingComScraper extends BaseScraper {
  /**
   * Build the Booking.com search URL with query parameters
   * @param request - Search parameters (hotel, dates, occupancy)
   * @returns Complete URL to scrape
   */
  protected buildURL(request: ScrapeRequest): string {
    const { hotelCode, checkInDate, checkOutDate, adults = 2 } = request;
    
    // Get base URL from source configuration or use default
    // hotelCode should be the hotel path (e.g., '/hotel/de/example.html')
    const baseUrl = this.source.base_url || 'https://www.booking.com';
    
    // Construct URL with query parameters
    const params = new URLSearchParams({
      checkin: checkInDate,
      checkout: checkOutDate,
      group_adults: adults.toString(),
      group_children: '0',
    });

    // Combine base URL + hotel code + query parameters
    // Handle both full URLs and partial paths
    let fullUrl: string;
    if (hotelCode.startsWith('http://') || hotelCode.startsWith('https://')) {
      // hotelCode is a full URL
      const url = new URL(hotelCode);
      params.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
      fullUrl = url.toString();
    } else {
      // hotelCode is a path
      fullUrl = `${baseUrl}${hotelCode}?${params.toString()}`;
    }

    return fullUrl;
  }

  /**
   * Process scraped data and extract Booking.com room/rate/price information
   * @param data - Extracted data using CSS selectors (not used for Booking.com)
   * @param html - Raw HTML to parse
   * @returns Scraping result with structured Booking.com data
   */
  protected processData(
    data: Record<string, string | null>,
    html: string
  ): ScrapeResult {
    try {
      const bookingData = this.extractBookingComData(html);
      
      // Determine overall status based on scrape results
      let status: 'green' | 'red' | 'pending' | 'error' = 'pending';
      
      if (bookingData.scrape_status === 'success') {
        // If we successfully scraped and found rooms/prices, mark as green
        status = bookingData.rooms.length > 0 && bookingData.prices.length > 0 ? 'green' : 'red';
      } else if (bookingData.scrape_status === 'failed' || bookingData.scrape_status === 'timeout') {
        status = 'error';
      }

      return {
        status,
        scrapedData: bookingData,
        errorMessage: bookingData.error_message || undefined,
      };
    } catch (error: any) {
      console.error('[BookingComScraper] Processing error:', error);
      
      const errorData: BookingComData = {
        rooms: [],
        rates: [],
        prices: [],
        scrape_status: 'failed',
        error_message: error.message || 'Unknown processing error',
        scraped_at: new Date().toISOString(),
      };

      return {
        status: 'error',
        scrapedData: errorData,
        errorMessage: error.message || 'Unknown processing error',
      };
    }
  }

  /**
   * Parse price from text, handling various international number formats
   * @param priceText - Price text like "€150.00", "$1,234.56", "1.234,56 €"
   * @returns Parsed price as number
   */
  private parsePrice(priceText: string): number {
    // Common currency symbols to remove
    const currencySymbols = /[€$£¥₹₽¢₩]/g;
    
    // Remove currency symbols and whitespace
    let cleaned = priceText.replace(currencySymbols, '').replace(/\s/g, '');
    
    // Detect format: if last comma is after last period, it's European format (1.234,56)
    // Otherwise it's US format (1,234.56)
    const lastComma = cleaned.lastIndexOf(',');
    const lastPeriod = cleaned.lastIndexOf('.');
    
    if (lastComma > lastPeriod) {
      // European format: 1.234,56 -> remove periods (thousands), replace comma with period
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,234.56 -> just remove commas (thousands)
      cleaned = cleaned.replace(/,/g, '');
    }
    
    return parseFloat(cleaned);
  }

  /**
   * Extract Booking.com data from HTML
   * @param html - Raw HTML from Booking.com
   * @returns Structured Booking.com data
   */
  private extractBookingComData(html: string): BookingComData {
    const $ = parseHTML(html);
    const scrapedAt = new Date().toISOString();

    try {
      // Check if the available_rooms container exists
      const availableRoomsContainer = $('#available_rooms');
      if (availableRoomsContainer.length === 0) {
        // No rooms container found - could be bot detection or hotel not available
        return {
          rooms: [],
          rates: [],
          prices: [],
          scrape_status: 'failed',
          error_message: 'No available rooms container found - possible bot detection or no availability',
          scraped_at: scrapedAt,
        };
      }

      // Extract room types
      const rooms: BookingComData['rooms'] = [];
      $('.hprt-roomtype-link').each((index, element) => {
        const roomName = $(element).text().trim();
        if (roomName) {
          rooms.push({
            type: roomName,
            name: roomName,
          });
        }
      });

      // Extract rate types (cancellation policies, breakfast, etc.)
      const rates: BookingComData['rates'] = [];
      $('.bui-list__item.e2e-cancellation').each((index, element) => {
        const rateName = $(element).text().trim();
        if (rateName) {
          rates.push({
            type: rateName,
            name: rateName,
            cancellation: rateName, // Use the text as cancellation info
          });
        }
      });

      // Extract prices
      const prices: BookingComData['prices'] = [];
      $('.bui-price-display__value').each((index, element) => {
        const priceText = $(element).text().trim();
        if (priceText) {
          // Parse price - handle various formats
          const amount = this.parsePrice(priceText);
          
          if (!isNaN(amount) && amount > 0) {
            // Extract currency from price text
            let currency = 'EUR'; // Default to EUR
            if (priceText.includes('$')) currency = 'USD';
            else if (priceText.includes('£')) currency = 'GBP';
            else if (priceText.includes('€')) currency = 'EUR';
            
            // Map prices to rooms and rates
            // Note: This is a simplified mapping. In production, you may need
            // to analyze the HTML structure to determine correct associations.
            let room_id = 0;
            let rate_id = 0;
            
            if (rooms.length > 0 && rates.length > 0) {
              // Distribute prices across rooms and rates (rates.length guaranteed > 0 here)
              room_id = Math.floor(index / rates.length) % rooms.length;
              rate_id = index % rates.length;
            } else if (rooms.length > 0) {
              // Only rooms, no rates
              room_id = index % rooms.length;
            }
            // If no rooms or rates, defaults to room_id=0, rate_id=0
            
            prices.push({
              amount,
              currency,
              room_id,
              rate_id,
            });
          }
        }
      });

      // Check if we found any data
      if (rooms.length === 0 && rates.length === 0 && prices.length === 0) {
        return {
          rooms: [],
          rates: [],
          prices: [],
          scrape_status: 'failed',
          error_message: 'No room, rate, or price data found - selectors may have changed',
          scraped_at: scrapedAt,
        };
      }

      return {
        rooms,
        rates,
        prices,
        scrape_status: 'success',
        error_message: null,
        scraped_at: scrapedAt,
      };
    } catch (error: any) {
      console.error('[BookingComScraper] Extraction error:', error);
      return {
        rooms: [],
        rates: [],
        prices: [],
        scrape_status: 'failed',
        error_message: error.message || 'Extraction error',
        scraped_at: scrapedAt,
      };
    }
  }

  /**
   * Override scrape method to handle specific Booking.com errors
   */
  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    try {
      // Build the URL for the request
      const url = this.buildURL(request);
      console.log(`[BookingComScraper] Scraping URL: ${url}`);

      // Fetch HTML content
      const html = await this.fetchHTML(url);

      // Process data and return result
      // Note: parsedData parameter is not used as BookingComScraper does direct HTML parsing
      return this.processData({}, html);
    } catch (error: any) {
      console.error('[BookingComScraper] Scrape error:', error);

      // Determine scrape status based on error type
      let scrapeStatus: BookingComData['scrape_status'] = 'failed';
      let errorMessage = error.message || 'Unknown error';

      // Handle specific error cases
      if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
        scrapeStatus = 'timeout';
        errorMessage = 'Request timeout';
      } else if (error.status === 429) {
        scrapeStatus = 'failed';
        errorMessage = 'Rate limited (429) - too many requests';
      } else if (error.status === 403) {
        scrapeStatus = 'failed';
        errorMessage = 'Forbidden (403) - possible bot detection';
      } else if (error.status === 503) {
        scrapeStatus = 'failed';
        errorMessage = 'Service unavailable (503)';
      }

      const errorData: BookingComData = {
        rooms: [],
        rates: [],
        prices: [],
        scrape_status: scrapeStatus,
        error_message: errorMessage,
        scraped_at: new Date().toISOString(),
      };

      return {
        status: 'error',
        scrapedData: errorData,
        errorMessage,
      };
    }
  }
}
