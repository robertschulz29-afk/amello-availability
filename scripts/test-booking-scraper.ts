// Test script to verify BookingComScraper functionality
// This is a simple manual test that can be run with: npx tsx scripts/test-booking-scraper.ts

import { BookingComScraper } from '../lib/scrapers/BookingComScraper';
import type { ScanSource } from '../lib/scrapers/types';

async function testBookingScraper() {
  console.log('Testing BookingComScraper...\n');
  
  // Create a test source configuration
  const testSource: ScanSource = {
    id: 999,
    name: 'Booking.com Test',
    enabled: true,
    base_url: 'https://www.booking.com',
    css_selectors: null,
    rate_limit_ms: 1000,
    user_agent_rotation: true,
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  const scraper = new BookingComScraper(testSource);
  
  // Test 1: URL construction
  console.log('Test 1: URL Construction');
  console.log('------------------------');
  const testBookingUrl = 'https://www.booking.com/hotel/de/example-hotel.html';
  const checkIn = '2024-03-15';
  const checkOut = '2024-03-17';
  
  // Access the protected buildURL method via a test instance
  const TestClass = class extends BookingComScraper {
    public testBuildURL(request: any) {
      return this.buildURL(request);
    }
  };
  
  const testInstance = new TestClass(testSource);
  const constructedUrl = testInstance.testBuildURL({
    hotelCode: testBookingUrl,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    adults: 2,
    children: 0,
  });
  
  console.log('Input URL:', testBookingUrl);
  console.log('Check-in:', checkIn);
  console.log('Check-out:', checkOut);
  console.log('Constructed URL:', constructedUrl);
  
  // Verify URL has the expected query parameters
  const url = new URL(constructedUrl);
  const hasCheckin = url.searchParams.get('checkin') === checkIn;
  const hasCheckout = url.searchParams.get('checkout') === checkOut;
  const hasAdults = url.searchParams.get('group_adults') === '2';
  const hasChildren = url.searchParams.get('group_children') === '0';
  
  console.log('\nURL Parameter Verification:');
  console.log('✓ Has checkin param:', hasCheckin);
  console.log('✓ Has checkout param:', hasCheckout);
  console.log('✓ Has group_adults param:', hasAdults);
  console.log('✓ Has group_children param:', hasChildren);
  
  if (hasCheckin && hasCheckout && hasAdults && hasChildren) {
    console.log('\n✅ URL construction test PASSED\n');
  } else {
    console.log('\n❌ URL construction test FAILED\n');
  }
  
  // Test 2: HTML parsing (mock data)
  console.log('Test 2: HTML Parsing');
  console.log('--------------------');
  
  // Create sample Booking.com HTML structure
  const sampleHtml = `
    <div id="available_rooms">
      <table>
        <tr class="hprt-table-row">
          <td>
            <a class="hprt-roomtype-link">Superior Double Room</a>
          </td>
          <td>
            <div class="bui-list__item e2e-cancellation">Free cancellation</div>
            <div class="bui-price-display__value">€120</div>
          </td>
        </tr>
        <tr class="hprt-table-row">
          <td>
            <a class="hprt-roomtype-link">Deluxe Suite</a>
          </td>
          <td>
            <div class="bui-list__item e2e-cancellation">Non-refundable</div>
            <div class="bui-price-display__value">€200</div>
          </td>
        </tr>
      </table>
    </div>
  `;
  
  // Test the processData method with sample HTML
  const TestClass2 = class extends BookingComScraper {
    public testProcessData(html: string) {
      return this.processData({}, html);
    }
  };
  
  const testInstance2 = new TestClass2(testSource);
  const result = testInstance2.testProcessData(sampleHtml);
  
  console.log('Parse Result Status:', result.status);
  console.log('Scraped Data:', JSON.stringify(result.scrapedData, null, 2));
  
  // Verify parsed data structure
  const data = result.scrapedData as any;
  const hasRooms = data && data.rooms && Array.isArray(data.rooms);
  const hasSource = data && data.source === 'booking';
  const roomCount = hasRooms ? data.rooms.length : 0;
  
  console.log('\nParsing Verification:');
  console.log('✓ Has rooms array:', hasRooms);
  console.log('✓ Has source field:', hasSource);
  console.log('✓ Room count:', roomCount);
  
  if (hasRooms && roomCount === 2) {
    console.log('✓ First room name:', data.rooms[0].name);
    console.log('✓ First room rates:', data.rooms[0].rates.length);
    if (data.rooms[0].rates.length > 0) {
      console.log('✓ First rate price:', data.rooms[0].rates[0].price);
      console.log('✓ First rate currency:', data.rooms[0].rates[0].currency);
    }
  }
  
  if (hasRooms && hasSource && roomCount === 2 && result.status === 'green') {
    console.log('\n✅ HTML parsing test PASSED\n');
  } else {
    console.log('\n❌ HTML parsing test FAILED\n');
  }
  
  console.log('All tests completed!');
}

// Run tests
testBookingScraper().catch(console.error);
