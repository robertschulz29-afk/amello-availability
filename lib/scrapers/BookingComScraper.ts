// lib/scrapers/BookingComScraper.ts
// Booking.com scraper implementation

import { BaseScraper } from './BaseScraper';
import { parseHTML } from './utils/html-parser';
import type { ScrapeRequest, ScrapeResult } from './types';
import { getBrowserManager } from './utils/browser-manager';
import { getRandomUserAgent } from './utils/user-agents';
import type { Page } from 'puppeteer-core';

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
   * Override scrape method to add comprehensive logging
   */
  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const { hotelCode, checkInDate, checkOutDate, adults = 2, children = 0 } = request;
    
    console.log('[BookingComScraper] === SCRAPE INITIALIZED ===');
    console.log('[BookingComScraper] Hotel ID/URL:', hotelCode);
    console.log('[BookingComScraper] Check-in:', checkInDate);
    console.log('[BookingComScraper] Check-out:', checkOutDate);
    console.log('[BookingComScraper] Adults:', adults, 'Children:', children);
    
    try {
      // Build the URL for the request
      const url = this.buildURL(request);
      console.log('[BookingComScraper] === HTTP REQUEST PHASE ===');
      console.log('[BookingComScraper] Constructed URL:', url);
      
      // Log request headers (excluding sensitive ones)
      const headers = this.getHeaders();
      const safeHeaders = { ...headers };
      delete safeHeaders['Authorization'];
      delete safeHeaders['Cookie'];
      delete safeHeaders['X-API-Key'];
      console.log('[BookingComScraper] Request headers:', JSON.stringify(safeHeaders, null, 2));
      
      // Fetch HTML content
      const html = await this.fetchHTML(url);
      console.log('[BookingComScraper] Response received - Status: 200 (OK)');
      console.log('[BookingComScraper] Response content length:', html.length, 'characters');
      console.log('[BookingComScraper] First 200 chars of HTML:', html.substring(0, 200).replace(/\s+/g, ' '));
      
      // Parse data using CSS selectors (not used for Booking.com, but kept for compatibility)
      const parsedData = this.parseData(html);
      
      console.log('[BookingComScraper] === DATA PROCESSING PHASE ===');
      // Process data and return result
      return this.processData(parsedData, html);
    } catch (error: any) {
      console.error('[BookingComScraper] === SCRAPE ERROR ===');
      console.error('[BookingComScraper] Error type:', error.name || 'Unknown');
      console.error('[BookingComScraper] Error message:', error.message || 'No message');
      console.error('[BookingComScraper] Error stack:', error.stack || 'No stack trace');
      console.error('[BookingComScraper] Context:', {
        hotelCode,
        checkInDate,
        checkOutDate,
        adults,
        children
      });

      return {
        status: 'error',
        errorMessage: error.message || 'Unknown error',
        scrapedData: { 
          error: String(error),
          source: 'booking',
        },
      };
    }
  }

  /**
   * Override fetchHTML to use Puppeteer for JavaScript execution
   * This allows us to bypass AWS WAF challenges and get rendered HTML
   */
  protected async fetchHTML(url: string): Promise<string> {
    // Wait for rate limiter
    await this.rateLimiter.waitForNextRequest();

    // Add random delay to mimic human behavior
    const { randomSleep } = await import('./utils/delays');
    await randomSleep(100, 500);

    const browserManager = getBrowserManager();
    let page: Page | null = null;

    try {
      console.log('[BookingComScraper] Creating browser page...');
      
      // Get user agent for this request
      const userAgent = getRandomUserAgent();
      page = await browserManager.createPage(userAgent);
      
      console.log('[BookingComScraper] Browser page created with User-Agent:', userAgent);
      console.log('[BookingComScraper] Navigating to URL:', url);

      // Navigate to URL with extended timeout to handle AWS WAF challenges
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      console.log('[BookingComScraper] Page loaded, waiting for #available_rooms element...');

      // Wait for the available_rooms element to appear (with timeout)
      try {
        await page.waitForSelector('#available_rooms', {
          timeout: 15000,
        });
        console.log('[BookingComScraper] #available_rooms element found');
      } catch (waitError) {
        console.warn('[BookingComScraper] #available_rooms element not found within timeout');
        // Continue anyway - we'll still get the rendered HTML
      }

      // Get the fully rendered HTML after JavaScript execution
      const html = await page.content();
      
      console.log('[BookingComScraper] Rendered HTML retrieved, length:', html.length);
      
      return html;
    } catch (error: any) {
      console.error('[BookingComScraper] Puppeteer error:', error.message);
      throw error;
    } finally {
      // Always close the page to free resources
      if (page) {
        try {
          await page.close();
          console.log('[BookingComScraper] Browser page closed');
        } catch (closeError) {
          console.error('[BookingComScraper] Error closing page:', closeError);
        }
      }
    }
  }

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
      console.log('[BookingComScraper] === HTML PARSING PHASE ===');
      // Parse the HTML and extract structured data
      const bookingData = this.parseBookingComHTML(html);
      
      console.log('[BookingComScraper] === DATA EXTRACTION COMPLETE ===');
      console.log('[BookingComScraper] Total rooms extracted:', bookingData.rooms.length);
      console.log('[BookingComScraper] Source field value:', bookingData.source);
      
      // Log each room's data
      bookingData.rooms.forEach((room, idx) => {
        console.log(`[BookingComScraper] Room ${idx + 1}:`, room.name);
        console.log(`[BookingComScraper]   - Rates found:`, room.rates.length);
        room.rates.forEach((rate, rateIdx) => {
          console.log(`[BookingComScraper]   - Rate ${rateIdx + 1}:`, rate.name || 'No name');
          console.log(`[BookingComScraper]     Price: ${rate.price} ${rate.currency}`);
        });
      });
      
      // Determine status based on available rooms
      const hasRooms = bookingData.rooms && bookingData.rooms.length > 0;
      const status = hasRooms ? 'green' : 'red';
      
      console.log('[BookingComScraper] Final status:', status);
      
      console.log('[BookingComScraper] Data structure prepared for database insertion');
      
      return {
        status,
        scrapedData: bookingData,
      };
    } catch (error: any) {
      console.error('[BookingComScraper] === ERROR IN PROCESSING DATA ===');
      console.error('[BookingComScraper] Error type:', error.name || 'Unknown');
      console.error('[BookingComScraper] Error message:', error.message || 'No message');
      console.error('[BookingComScraper] Error stack:', error.stack || 'No stack trace');
      console.error('[BookingComScraper] HTML length:', html.length);
      
      return {
        status: 'error',
        errorMessage: error.message || 'Failed to parse Booking.com data',
        scrapedData: { 
          error: String(error),
          source: 'booking',
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
    
    console.log('[BookingComScraper] Parsing HTML with cheerio...');
    
    // Find the available_rooms container
    const availableRoomsContainer = $('#available_rooms');
    console.log('[BookingComScraper] CSS Selector: #available_rooms');
    console.log('[BookingComScraper] Element found:', availableRoomsContainer.length > 0);
    
    if (availableRoomsContainer.length === 0) {
      console.warn('[BookingComScraper] available_rooms container not found');
      return { rooms, source: 'booking' };
    }
    
    // Find all room type links
    const roomElements = availableRoomsContainer.find('.hprt-roomtype-link');
    console.log('[BookingComScraper] CSS Selector: .hprt-roomtype-link');
    console.log('[BookingComScraper] Number of rooms found:', roomElements.length);
    
    if (roomElements.length === 0) {
      console.warn('[BookingComScraper] No room type links found');
      return { rooms, source: 'booking' };
    }
    
    // Process each room type
    roomElements.each((roomIdx, roomElement) => {
      try {
        const roomName = $(roomElement).text().trim();
        console.log(`[BookingComScraper] Processing room ${roomIdx + 1}: "${roomName}"`);
        
        if (!roomName) {
          console.log(`[BookingComScraper]   - Skipping room ${roomIdx + 1} (no name)`);
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
        console.log(`[BookingComScraper]   - CSS Selector: .bui-list__item.e2e-cancellation`);
        console.log(`[BookingComScraper]   - Rates found in row:`, rateElements.length);
        
        if (rateElements.length === 0) {
          console.log(`[BookingComScraper]   - Searching for rates in sibling rows...`);
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
            console.log(`[BookingComScraper]   - Searching ${nextRoomIndex} sibling rows before next room`);
          } else {
            console.log(`[BookingComScraper]   - Searching all remaining sibling rows`);
          }
          
          const siblingRates = rateRows.find('.bui-list__item.e2e-cancellation');
          console.log(`[BookingComScraper]   - Rates found in siblings:`, siblingRates.length);
          
          siblingRates.each((_, rateElement) => {
            const rate = this.extractRateFromElement($, rateElement);
            if (rate) {
              rates.push(rate);
              console.log(`[BookingComScraper]     ✓ Extracted rate: ${rate.name || 'No name'}, ${rate.price} ${rate.currency}`);
            } else {
              console.log(`[BookingComScraper]     ✗ Failed to extract rate from element`);
            }
          });
        } else {
          // Rates found in the same row
          rateElements.each((_, rateElement) => {
            const rate = this.extractRateFromElement($, rateElement);
            if (rate) {
              rates.push(rate);
              console.log(`[BookingComScraper]     ✓ Extracted rate: ${rate.name || 'No name'}, ${rate.price} ${rate.currency}`);
            } else {
              console.log(`[BookingComScraper]     ✗ Failed to extract rate from element`);
            }
          });
        }
        
        // Also check for prices directly associated with the room row
        // Sometimes prices are in a separate cell in the same row
        if (rates.length === 0) {
          console.log(`[BookingComScraper]   - No rates found, checking for direct prices...`);
          const priceElements = roomRow.find('.bui-price-display__value');
          console.log(`[BookingComScraper]   - CSS Selector: .bui-price-display__value`);
          console.log(`[BookingComScraper]   - Direct prices found:`, priceElements.length);
          
          if (priceElements.length > 0) {
            priceElements.each((_, priceElement) => {
              const price = this.extractPriceFromElement($, priceElement);
              if (price) {
                rates.push({
                  name: null, // No specific rate name when price is directly on room
                  price: price.amount,
                  currency: price.currency,
                });
                console.log(`[BookingComScraper]     ✓ Extracted direct price: ${price.amount} ${price.currency}`);
              } else {
                console.log(`[BookingComScraper]     ✗ Failed to extract price from element`);
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
          console.log(`[BookingComScraper]   ✓ Room added with ${rates.length} rate(s)`);
        } else {
          console.log(`[BookingComScraper]   ✗ Room skipped (no valid rates found)`);
        }
      } catch (error: any) {
        console.error(`[BookingComScraper] === ERROR PROCESSING ROOM ${roomIdx + 1} ===`);
        console.error('[BookingComScraper] Error type:', error.name || 'Unknown');
        console.error('[BookingComScraper] Error message:', error.message || 'No message');
        console.error('[BookingComScraper] Error stack:', error.stack || 'No stack trace');
      }
    });
    
    console.log(`[BookingComScraper] Parsing complete. Total rooms with rates: ${rooms.length}`);
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
        console.log('[BookingComScraper]       ✗ No price element found for rate');
        return null; // No price found for this rate
      }
      
      const priceInfo = this.extractPriceFromElement($, priceElement);
      if (!priceInfo) {
        console.log('[BookingComScraper]       ✗ Failed to parse price from element');
        return null;
      }
      
      return {
        name: rateName,
        price: priceInfo.amount,
        currency: priceInfo.currency,
      };
    } catch (error: any) {
      console.error('[BookingComScraper]       === ERROR EXTRACTING RATE ===');
      console.error('[BookingComScraper]       Error message:', error.message || 'No message');
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
        console.log('[BookingComScraper]         ✗ Empty price text');
        return null;
      }
      
      console.log('[BookingComScraper]         Parsing price text:', priceText);
      
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
      
      console.log('[BookingComScraper]         Currency:', currency);
      
      // Extract numeric value
      // Remove currency symbols and codes, keep only numbers and decimal separators
      const numericText = priceText
        .replace(/[€$£]/g, '')
        .replace(/\b[A-Z]{3}\b/g, '')
        .replace(/[^\d.,]/g, '')
        .trim();
      
      console.log('[BookingComScraper]         Numeric text:', numericText);
      
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
      
      console.log('[BookingComScraper]         Normalized number:', normalizedNumber);
      
      const amount = parseFloat(normalizedNumber);
      
      if (isNaN(amount) || amount <= 0) {
        console.log('[BookingComScraper]         ✗ Invalid amount:', amount);
        return null;
      }
      
      console.log('[BookingComScraper]         ✓ Parsed price:', amount, currency);
      return { amount, currency };
    } catch (error: any) {
      console.error('[BookingComScraper]         === ERROR EXTRACTING PRICE ===');
      console.error('[BookingComScraper]         Error message:', error.message || 'No message');
      return null;
    }
  }
}
