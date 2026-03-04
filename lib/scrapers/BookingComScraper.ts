// lib/scrapers/BookingComScraper.ts
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

const DEFAULT_CURRENCY = 'EUR';

// Production (Vercel) needs more time: Chromium cold start + slower page render
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const NAV_TIMEOUT    = IS_PRODUCTION ? 120_000 : 60_000;  // 120s prod, 60s dev
const ELEMENT_TIMEOUT = IS_PRODUCTION ?  30_000 : 15_000; // 30s prod, 15s dev

export class BookingComScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const { hotelCode, checkInDate, checkOutDate, adults = 2, children = 0 } = request;

    console.log('[BookingComScraper] === SCRAPE INITIALIZED ===');
    console.log('[BookingComScraper] Hotel ID/URL:', hotelCode);
    console.log('[BookingComScraper] Check-in:', checkInDate);
    console.log('[BookingComScraper] Check-out:', checkOutDate);
    console.log('[BookingComScraper] Adults:', adults, 'Children:', children);
    console.log('[BookingComScraper] IS_PRODUCTION:', IS_PRODUCTION, '| NAV_TIMEOUT:', NAV_TIMEOUT);

    try {
      const url = this.buildURL(request);
      console.log('[BookingComScraper] === HTTP REQUEST PHASE ===');
      console.log('[BookingComScraper] Constructed URL:', url);

      const headers = this.getHeaders();
      const safeHeaders = { ...headers };
      delete safeHeaders['Authorization'];
      delete safeHeaders['Cookie'];
      delete safeHeaders['X-API-Key'];
      console.log('[BookingComScraper] Request headers:', JSON.stringify(safeHeaders, null, 2));

      const html = await this.fetchHTML(url);
      console.log('[BookingComScraper] Response received - Status: 200 (OK)');
      console.log('[BookingComScraper] Response content length:', html.length, 'characters');
      console.log('[BookingComScraper] First 200 chars of HTML:', html.substring(0, 200).replace(/\s+/g, ' '));

      const parsedData = this.parseData(html);

      console.log('[BookingComScraper] === DATA PROCESSING PHASE ===');
      return this.processData(parsedData, html);
    } catch (error: any) {
      console.error('[BookingComScraper] === SCRAPE ERROR ===');
      console.error('[BookingComScraper] Error type:', error.name || 'Unknown');
      console.error('[BookingComScraper] Error message:', error.message || 'No message');
      console.error('[BookingComScraper] Context:', { hotelCode, checkInDate, checkOutDate, adults, children });

      return {
        status: 'error',
        errorMessage: error.message || 'Unknown error',
        scrapedData: {
          rooms: [],
          error: String(error),
          source: 'booking',
        },
      };
    }
  }

  protected async fetchHTML(url: string): Promise<string> {
    await this.rateLimiter.waitForNextRequest();

    const { randomSleep } = await import('./utils/delays');
    await randomSleep(100, 500);

    const browserManager = getBrowserManager();
    let page: Page | null = null;

    try {
      console.log('[BookingComScraper] Creating browser page...');
      const userAgent = getRandomUserAgent();
      page = await browserManager.createPage(userAgent);

      console.log('[BookingComScraper] Browser page created with User-Agent:', userAgent);
      console.log('[BookingComScraper] Navigating to URL:', url);

      // Use domcontentloaded instead of networkidle2 — much faster and reliable on cloud
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT,
      });

      console.log('[BookingComScraper] DOM loaded, waiting for #available_rooms element...');

      try {
        await page.waitForSelector('#available_rooms', { timeout: ELEMENT_TIMEOUT });
        console.log('[BookingComScraper] #available_rooms element found');
      } catch (waitError) {
        console.warn('[BookingComScraper] #available_rooms not found within timeout — continuing with current HTML');
      }

      const html = await page.content();
      console.log('[BookingComScraper] Rendered HTML retrieved, length:', html.length);
      return html;

    } catch (error: any) {
      console.error('[BookingComScraper] Puppeteer error:', error.message);
      throw error;
    } finally {
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

  protected buildURL(request: ScrapeRequest): string {
    const { hotelCode, checkInDate, checkOutDate, adults = 2, children = 0 } = request;

    console.log('[BookingComScraper] Building URL for date range:', { checkInDate, checkOutDate });

    if (checkOutDate <= checkInDate) {
      console.error('[BookingComScraper] ERROR: Invalid date range', { checkInDate, checkOutDate });
    }

    let baseUrl = hotelCode;
    if (!baseUrl.startsWith('http')) {
      baseUrl = this.source.base_url || hotelCode;
    }

    const url = new URL(baseUrl);
    url.searchParams.set('checkin', checkInDate);
    url.searchParams.set('checkout', checkOutDate);
    url.searchParams.set('group_adults', adults.toString());
    url.searchParams.set('group_children', children.toString());

    return url.toString();
  }

  protected processData(data: Record<string, string | null>, html: string): ScrapeResult {
    try {
      console.log('[BookingComScraper] === HTML PARSING PHASE ===');
      const bookingData = this.parseBookingComHTML(html);

      console.log('[BookingComScraper] === DATA EXTRACTION COMPLETE ===');
      console.log('[BookingComScraper] Total rooms extracted:', bookingData.rooms.length);

      if (bookingData.rooms.length === 0) {
        console.warn('[BookingComScraper] === NO ROOMS FOUND ===');
        console.warn('[BookingComScraper] HTML metadata:', {
          length: html.length,
          hasAvailableRoomsDiv: html.includes('id="available_rooms"'),
          hasRoomTypeLinks: html.includes('hprt-roomtype-link'),
          hasPriceDisplay: html.includes('bui-price-display__value'),
        });
      }

      bookingData.rooms.forEach((room, idx) => {
        console.log(`[BookingComScraper] Room ${idx + 1}:`, room.name, '| Rates:', room.rates.length);
        room.rates.forEach((rate, rIdx) => {
          console.log(`[BookingComScraper]   Rate ${rIdx + 1}:`, rate.name || 'No name', `| ${rate.price} ${rate.currency}`);
        });
      });

      const hasRooms = bookingData.rooms.length > 0;
      const status = hasRooms ? 'green' : 'red';
      console.log('[BookingComScraper] Final status:', status);

      return {
        status,
        scrapedData: {
          rooms: bookingData.rooms || [],
          source: 'booking',
        },
      };
    } catch (error: any) {
      console.error('[BookingComScraper] === ERROR IN PROCESSING DATA ===');
      console.error('[BookingComScraper] Error message:', error.message);
      return {
        status: 'error',
        errorMessage: error.message || 'Failed to parse Booking.com data',
        scrapedData: {
          rooms: [],
          error: String(error),
          source: 'booking',
        },
      };
    }
  }

  private parseBookingComHTML(html: string): BookingComData {
    const $ = parseHTML(html);
    const rooms: BookingComRoom[] = [];

    console.log('[BookingComScraper] Parsing HTML with cheerio...');

    const availableRoomsContainer = $('#available_rooms');
    console.log('[BookingComScraper] #available_rooms found:', availableRoomsContainer.length > 0);

    if (availableRoomsContainer.length === 0) {
      console.warn('[BookingComScraper] available_rooms container not found');
      return { rooms, source: 'booking' };
    }

    const roomElements = availableRoomsContainer.find('.hprt-roomtype-link');
    console.log('[BookingComScraper] Room elements found:', roomElements.length);

    if (roomElements.length === 0) {
      console.warn('[BookingComScraper] No room type links found');
      return { rooms, source: 'booking' };
    }

    roomElements.each((roomIdx, roomElement) => {
      try {
        const roomName = $(roomElement).text().trim();
        if (!roomName) return;

        console.log(`[BookingComScraper] Processing room ${roomIdx + 1}: "${roomName}"`);

        const roomRow = $(roomElement).closest('tr, .hprt-table-row');
        const rates: BookingComRate[] = [];

        let rateElements = roomRow.find('.bui-list__item.e2e-cancellation');

        if (rateElements.length === 0) {
          const allNextRows = roomRow.nextAll();
          const nextRoomIndex = allNextRows.toArray().findIndex(
            (el) => $(el).find('.hprt-roomtype-link').length > 0
          );
          const rateRows = nextRoomIndex >= 0 ? allNextRows.slice(0, nextRoomIndex) : allNextRows;
          rateElements = rateRows.find('.bui-list__item.e2e-cancellation');
        }

        rateElements.each((_, rateElement) => {
          const rate = this.extractRateFromElement($, rateElement);
          if (rate) rates.push(rate);
        });

        if (rates.length === 0) {
          const priceElements = roomRow.find('.bui-price-display__value');
          priceElements.each((_, priceElement) => {
            const price = this.extractPriceFromElement($, priceElement);
            if (price) {
              rates.push({ name: null, price: price.amount, currency: price.currency });
            }
          });
        }

        if (rates.length > 0) {
          rooms.push({ name: roomName, rates });
          console.log(`[BookingComScraper] ✓ Room added: "${roomName}" with ${rates.length} rate(s)`);
        } else {
          console.log(`[BookingComScraper] ✗ Room skipped (no rates): "${roomName}"`);
        }
      } catch (error: any) {
        console.error(`[BookingComScraper] Error processing room ${roomIdx + 1}:`, error.message);
      }
    });

    console.log(`[BookingComScraper] Parsing complete. Total rooms: ${rooms.length}`);
    return { rooms, source: 'booking' };
  }

  private extractRateFromElement($: any, rateElement: any): BookingComRate | null {
    try {
      const rateName = $(rateElement).text().trim() || null;

      let priceElement = $(rateElement).find('.bui-price-display__value').first();
      if (priceElement.length === 0) {
        const rateRow = $(rateElement).closest('tr, .hprt-table-row, .hprt-table-cell');
        priceElement = rateRow.find('.bui-price-display__value').first();
      }
      if (priceElement.length === 0) return null;

      const priceInfo = this.extractPriceFromElement($, priceElement);
      if (!priceInfo) return null;

      return { name: rateName, price: priceInfo.amount, currency: priceInfo.currency };
    } catch (error: any) {
      console.error('[BookingComScraper] Error extracting rate:', error.message);
      return null;
    }
  }

  private extractPriceFromElement($: any, priceElement: any): { amount: number; currency: string } | null {
    try {
      const priceText = $(priceElement).text().trim();
      if (!priceText) return null;

      console.log('[BookingComScraper] Parsing price text:', priceText);

      let currency = DEFAULT_CURRENCY;
      if (priceText.includes('€')) currency = 'EUR';
      else if (priceText.includes('$')) currency = 'USD';
      else if (priceText.includes('£')) currency = 'GBP';
      else {
        const currencyMatch = priceText.match(/\b([A-Z]{3})\b/);
        if (currencyMatch) currency = currencyMatch[1];
      }

      const numericText = priceText
        .replace(/[€$£]/g, '')
        .replace(/\b[A-Z]{3}\b/g, '')
        .replace(/[^\d.,]/g, '')
        .trim();

      let normalizedNumber = numericText;

      if (normalizedNumber.includes(',') && normalizedNumber.includes('.')) {
        if (normalizedNumber.lastIndexOf('.') > normalizedNumber.lastIndexOf(',')) {
          normalizedNumber = normalizedNumber.replace(/,/g, '').replace('.', '');
        } else {
          normalizedNumber = normalizedNumber.replace(/\./g, '').replace(',', '');
        }
      } else if (normalizedNumber.includes(',')) {
        const commaCount = (normalizedNumber.match(/,/g) || []).length;
        if (commaCount === 1 && normalizedNumber.split(',')[1].length <= 2) {
          normalizedNumber = normalizedNumber.replace(',', '');
        } else {
          normalizedNumber = normalizedNumber.replace(/,/g, '');
        }
      } else if (normalizedNumber.includes('.')) {
        const dotCount = (normalizedNumber.match(/\./g) || []).length;
        if (dotCount === 1 && normalizedNumber.split('.')[1].length <= 2) {
          normalizedNumber = normalizedNumber.replace('.', '');
        } else {
          normalizedNumber = normalizedNumber.replace(/\./g, '');
        }
      }

      const amount = parseInt(normalizedNumber, 10);
      if (isNaN(amount) || amount <= 0) return null;

      console.log('[BookingComScraper] ✓ Parsed price:', amount, currency);
      return { amount, currency };
    } catch (error: any) {
      console.error('[BookingComScraper] Error extracting price:', error.message);
      return null;
    }
  }
}
