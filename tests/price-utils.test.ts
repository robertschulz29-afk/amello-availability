/**
 * Unit tests for price-utils.ts
 * Run with: npx tsx --test tests/price-utils.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractPriceValue } from '../lib/price-utils.js';

describe('extractPriceValue', () => {
  describe('Amello offers (pricesInCents=true)', () => {
    it('should extract inMinorUnits and multiply by nights', () => {
      const offer = {
        inMinorUnits: '12345',
        nights: 2
      };
      const result = extractPriceValue(offer, true);
      // 12345/100 = 123.45 per day, * 2 nights = 246.90
      assert.strictEqual(result, 246.90);
    });

    it('should handle inMinorUnits as number', () => {
      const offer = {
        inMinorUnits: 12345,
        nights: 2
      };
      const result = extractPriceValue(offer, true);
      assert.strictEqual(result, 246.90);
    });

    it('should handle inMinorUnits with numberOfNights', () => {
      const offer = {
        inMinorUnits: '10000',
        numberOfNights: 3
      };
      const result = extractPriceValue(offer, true);
      // 10000/100 = 100 per day, * 3 nights = 300
      assert.strictEqual(result, 300);
    });

    it('should handle inMinorUnits with days field', () => {
      const offer = {
        inMinorUnits: '5000',
        days: 5
      };
      const result = extractPriceValue(offer, true);
      // 5000/100 = 50 per day, * 5 days = 250
      assert.strictEqual(result, 250);
    });

    it('should prefer totalPrice when both inMinorUnits and totalPrice exist', () => {
      const offer = {
        inMinorUnits: '12345',
        totalPrice: 150.50,
        nights: 2
      };
      const result = extractPriceValue(offer, true);
      // Should use totalPrice directly (already in decimal format)
      assert.strictEqual(result, 150.50);
    });

    it('should handle inMinorUnits without days field (single night)', () => {
      const offer = {
        inMinorUnits: '12345'
      };
      const result = extractPriceValue(offer, true);
      // 12345/100 = 123.45 (single night assumed)
      assert.strictEqual(result, 123.45);
    });

    it('should strip non-digits from inMinorUnits string', () => {
      const offer = {
        inMinorUnits: '$123.45',
        nights: 1
      };
      const result = extractPriceValue(offer, true);
      // Strip to "12345", divide by 100 = 123.45
      assert.strictEqual(result, 123.45);
    });

    it('should fall back to existing logic if inMinorUnits parsing fails', () => {
      const offer = {
        inMinorUnits: 'invalid',
        price: 100
      };
      const result = extractPriceValue(offer, true);
      // Should fall back to price field: 100/100 = 1
      assert.strictEqual(result, 1);
    });

    it('should handle null inMinorUnits gracefully', () => {
      const offer = {
        inMinorUnits: null,
        price: 200
      };
      const result = extractPriceValue(offer, true);
      // Should fall back to price field: 200/100 = 2
      assert.strictEqual(result, 2);
    });
  });

  describe('Booking.com prices (pricesInCents=false)', () => {
    it('should return price as-is without division', () => {
      const booking = {
        price: '123.45'
      };
      const result = extractPriceValue(booking, false);
      assert.strictEqual(result, 123.45);
    });

    it('should handle numeric price', () => {
      const booking = {
        price: 99.99
      };
      const result = extractPriceValue(booking, false);
      assert.strictEqual(result, 99.99);
    });

    it('should ignore inMinorUnits when pricesInCents=false', () => {
      const booking = {
        inMinorUnits: '12345',
        price: '123.45'
      };
      const result = extractPriceValue(booking, false);
      // Should use price field without conversion
      assert.strictEqual(result, 123.45);
    });

    it('should handle totalPrice field', () => {
      const booking = {
        totalPrice: 250.00
      };
      const result = extractPriceValue(booking, false);
      assert.strictEqual(result, 250.00);
    });
  });
});
