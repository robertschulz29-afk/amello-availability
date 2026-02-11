// lib/scrapers/BookingComScraper.ts
// Booking.com scraper implementation

import { BaseScraper } from './BaseScraper';
import { parseHTML } from './utils/html-parser';
import type { ScrapeRequest, ScrapeResult } from './types';

export interface BookingComRoom {
  name: string;
  rates: BookingComRate[];
}

export interface BookingComRate {
  name: string | null;
  price: number;
  currency: string;
}

export interface BookingComData {
  rooms: BookingComRoom[];
  source: 'booking';
}

// Default currency for Booking.com when not specified
const DEFAULT_CURRENCY = 'EUR';

/**
 * Scraper for Booking.com hotel availability and pricing
 * 
 * Extracts:
 * - Room types from elements with class 'hprt-roomtype-link'
 * - Rates from class 'bui-list__item e2e-cancellation' under each room
 * - Prices from class 'bui-price-display__value' under each rate
 * - All data contained under element ID 'available_rooms'
 */
export class BookingComScraper extends BaseScraper {
  /**
   * Build Booking.com URL with query parameters
   * @param request - Search parameters (hotel code mapped to booking_url)
   * @returns Complete Booking.com URL
   */
  protected buildURL(request: ScrapeRequest): string {
    const { hotelCode, checkInDate, checkOutDate, adults = 2, children = 0 } = request;
    
    // The hotelCode for Booking.com should be the base booking_url from the database
    // We'll append query parameters to it
    let baseUrl = hotelCode;
    
    // If hotelCode doesn't start with http, use the source's base_url
    if (!baseUrl.startsWith('http')) {
      baseUrl = this.source.base_url || hotelCode;
    }
    
    // Parse existing URL to preserve any existing parameters
    const url = new URL(baseUrl);
    
    // Add/override query parameters
    url.searchParams.set('checkin', checkInDate);
    url.searchParams.set('checkout', checkOutDate);
    url.searchParams.set('group_adults', adults.toString());
    url.searchParams.set('group_children', children.toString());
    
    return url.toString();
  }

  /**
   * Process scraped Booking.com HTML and extract structured room/rate/price data
   * @param data - Extracted data using CSS selectors (not used for Booking.com)
   * @param html - Raw HTML from Booking.com
   * @returns Scraping result with structured data
   */
  protected processData(
    data: Record<string, string | null>,
    html: string
  ): ScrapeResult {
    try {
      // Parse the HTML and extract structured data
      const bookingData = this.parseBookingComHTML(html);
      
      // Determine status based on available rooms
      const hasRooms = bookingData.rooms && bookingData.rooms.length > 0;
      const status = hasRooms ? 'green' : 'red';
      
      // Store full HTML in scraped data along with parsed structure
      const scrapedData = {
        ...bookingData,
        rawHtml: html, // Store full HTML response
      };
      
      return {
        status,
        scrapedData,
      };
    } catch (error: any) {
      console.error('[BookingComScraper] Error processing data:', error);
      return {
        status: 'error',
        errorMessage: error.message || 'Failed to parse Booking.com data',
        scrapedData: { 
          error: String(error),
          rawHtml: html,
        },
      };
    }
  }

  /**
   * Parse Booking.com HTML to extract room types, rates, and prices
   * @param html - Raw HTML from Booking.com
   * @returns Structured data with rooms, rates, and prices
   */
  private parseBookingComHTML(html: string): BookingComData {
    const $ = parseHTML(html);
    const rooms: BookingComRoom[] = [];
    
    // Find the available_rooms container
    const availableRoomsContainer = $('#available_rooms');
    
    if (availableRoomsContainer.length === 0) {
      console.warn('[BookingComScraper] available_rooms container not found');
      return { rooms, source: 'booking' };
    }
    
    // Find all room type links
    const roomElements = availableRoomsContainer.find('.hprt-roomtype-link');
    
    if (roomElements.length === 0) {
      console.warn('[BookingComScraper] No room type links found');
      return { rooms, source: 'booking' };
    }
    
    // Process each room type
    roomElements.each((_, roomElement) => {
      try {
        const roomName = $(roomElement).text().trim();
        
        if (!roomName) {
          return; // Skip rooms without names
        }
        
        // Find the parent room row to locate associated rates
        // Booking.com typically has a table structure where room name is in one cell
        // and rates/prices are in adjacent cells or rows
        const roomRow = $(roomElement).closest('tr, .hprt-table-row');
        const rates: BookingComRate[] = [];
        
        // Find all rate/cancellation policy elements within this room's context
        // Look for rate elements in the same row or in following rows that belong to this room
        const rateElements = roomRow.find('.bui-list__item.e2e-cancellation');
        
        if (rateElements.length === 0) {
          // Try to find rates in a broader context (sometimes rates are in sibling rows)
          // Get all rate rows that follow this room
          // We'll filter by looking at all nextAll() and stop when we hit another room type
          const allNextRows = roomRow.nextAll();
          let rateRows = allNextRows;
          
          // Find the index of the next room type if it exists
          const nextRoomIndex = allNextRows.toArray().findIndex(
            (el) => $(el).find('.hprt-roomtype-link').length > 0
          );
          
          // If we found another room, only take rows before it
          if (nextRoomIndex >= 0) {
            rateRows = allNextRows.slice(0, nextRoomIndex);
          }
          
          rateRows.find('.bui-list__item.e2e-cancellation').each((_, rateElement) => {
            const rate = this.extractRateFromElement($, rateElement);
            if (rate) {
              rates.push(rate);
            }
          });
        } else {
          // Rates found in the same row
          rateElements.each((_, rateElement) => {
            const rate = this.extractRateFromElement($, rateElement);
            if (rate) {
              rates.push(rate);
            }
          });
        }
        
        // Also check for prices directly associated with the room row
        // Sometimes prices are in a separate cell in the same row
        if (rates.length === 0) {
          const priceElements = roomRow.find('.bui-price-display__value');
          if (priceElements.length > 0) {
            priceElements.each((_, priceElement) => {
              const price = this.extractPriceFromElement($, priceElement);
              if (price) {
                rates.push({
                  name: null, // No specific rate name when price is directly on room
                  price: price.amount,
                  currency: price.currency,
                });
              }
            });
          }
        }
        
        // Only add room if we found at least one rate with price
        if (rates.length > 0) {
          rooms.push({
            name: roomName,
            rates,
          });
        }
      } catch (error) {
        console.error('[BookingComScraper] Error processing room:', error);
      }
    });
    
    return { rooms, source: 'booking' };
  }

  /**
   * Extract rate information from a rate element
   * @param $ - Cheerio instance
   * @param rateElement - The rate element
   * @returns Rate with name and price, or null if extraction fails
   */
  private extractRateFromElement($: any, rateElement: any): BookingComRate | null {
    try {
      // Get rate name (cancellation policy text)
      const rateName = $(rateElement).text().trim() || null;
      
      // Find price element within or near this rate element
      // First, try to find it within the rate element
      let priceElement = $(rateElement).find('.bui-price-display__value').first();
      
      // If not found within, look in parent or sibling elements
      if (priceElement.length === 0) {
        const rateRow = $(rateElement).closest('tr, .hprt-table-row, .hprt-table-cell');
        priceElement = rateRow.find('.bui-price-display__value').first();
      }
      
      if (priceElement.length === 0) {
        return null; // No price found for this rate
      }
      
      const priceInfo = this.extractPriceFromElement($, priceElement);
      if (!priceInfo) {
        return null;
      }
      
      return {
        name: rateName,
        price: priceInfo.amount,
        currency: priceInfo.currency,
      };
    } catch (error) {
      console.error('[BookingComScraper] Error extracting rate:', error);
      return null;
    }
  }

  /**
   * Extract price and currency from a price element
   * @param $ - Cheerio instance
   * @param priceElement - The price element
   * @returns Price amount and currency, or null if extraction fails
   */
  private extractPriceFromElement($: any, priceElement: any): { amount: number; currency: string } | null {
    try {
      const priceText = $(priceElement).text().trim();
      
      if (!priceText) {
        return null;
      }
      
      // Extract currency symbol or code
      // Common patterns: €150, $200, 150 EUR, EUR 150
      let currency = DEFAULT_CURRENCY;
      
      if (priceText.includes('€')) {
        currency = 'EUR';
      } else if (priceText.includes('$')) {
        currency = 'USD';
      } else if (priceText.includes('£')) {
        currency = 'GBP';
      } else {
        // Look for currency code (3 uppercase letters)
        const currencyMatch = priceText.match(/\b([A-Z]{3})\b/);
        if (currencyMatch) {
          currency = currencyMatch[1];
        }
      }
      
      // Extract numeric value
      // Remove currency symbols and codes, keep only numbers and decimal separators
      const numericText = priceText
        .replace(/[€$£]/g, '')
        .replace(/\b[A-Z]{3}\b/g, '')
        .replace(/[^\d.,]/g, '')
        .trim();
      
      // Handle different decimal separators
      // European format: 1.234,56 -> 1234.56
      // US format: 1,234.56 -> 1234.56
      let normalizedNumber = numericText;
      
      // If contains both comma and period, determine which is decimal separator
      if (normalizedNumber.includes(',') && normalizedNumber.includes('.')) {
        // If period comes after comma, period is decimal separator
        if (normalizedNumber.lastIndexOf('.') > normalizedNumber.lastIndexOf(',')) {
          normalizedNumber = normalizedNumber.replace(/,/g, '');
        } else {
          // Comma is decimal separator (European format)
          normalizedNumber = normalizedNumber.replace(/\./g, '').replace(',', '.');
        }
      } else if (normalizedNumber.includes(',')) {
        // Only comma - could be thousands separator or decimal
        // If more than one comma, it's thousands separator
        const commaCount = (normalizedNumber.match(/,/g) || []).length;
        if (commaCount === 1 && normalizedNumber.split(',')[1].length <= 2) {
          // Single comma with 1-2 digits after = decimal separator
          normalizedNumber = normalizedNumber.replace(',', '.');
        } else {
          // Thousands separator
          normalizedNumber = normalizedNumber.replace(/,/g, '');
        }
      }
      
      const amount = parseFloat(normalizedNumber);
      
      if (isNaN(amount) || amount <= 0) {
        return null;
      }
      
      return { amount, currency };
    } catch (error) {
      console.error('[BookingComScraper] Error extracting price:', error);
      return null;
    }
  }
}
