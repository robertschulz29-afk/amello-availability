/**
 * Utility functions for extracting price information from hotel API responses
 */

export interface LowestPriceInfo {
  roomName: string | null;
  rateName: string | null;
  price: number | null;
}

/**
 * Safely extracts the lowest price from a hotel API response JSON
 * Handles various response structures and returns null values if unavailable
 */
export function extractLowestPrice(responseJson: any): LowestPriceInfo {
  const result: LowestPriceInfo = {
    roomName: null,
    rateName: null,
    price: null,
  };

  if (!responseJson || typeof responseJson !== 'object') {
    return result;
  }

  // Find the rooms array - could be in various locations
  let rooms: any[] | null = null;

  if (Array.isArray(responseJson.rooms)) {
    rooms = responseJson.rooms;
  } else if (responseJson.data && Array.isArray(responseJson.data.rooms)) {
    rooms = responseJson.data.rooms;
  } else {
    // Fallback: search for any key containing 'rooms' (case-insensitive)
    for (const [key, value] of Object.entries(responseJson)) {
      if (key.toLowerCase() === 'rooms' && Array.isArray(value)) {
        rooms = value;
        break;
      }
    }
  }

  if (!rooms || rooms.length === 0) {
    return result;
  }

  let lowestPrice = Infinity;

  // Iterate through all rooms
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue;

    // Get room name
    const roomName = room.name || room.roomName || room.title || room.type || null;

    // Find rates/prices array - could be in various locations
    let rates: any[] | null = null;

    if (Array.isArray(room.rates)) {
      rates = room.rates;
    } else if (Array.isArray(room.prices)) {
      rates = room.prices;
    } else if (Array.isArray(room.offers)) {
      rates = room.offers;
    } else if (room.rate && typeof room.rate === 'object') {
      rates = [room.rate];
    } else if (room.price && typeof room.price === 'object') {
      rates = [room.price];
    } else {
      // Check for nested rate/price data
      for (const [key, value] of Object.entries(room)) {
        const lowerKey = key.toLowerCase();
        if ((lowerKey.includes('rate') || lowerKey.includes('price') || lowerKey.includes('offer')) && Array.isArray(value)) {
          rates = value;
          break;
        }
      }
    }

    if (!rates || rates.length === 0) {
      // Maybe the room object itself contains a direct price
      const directPrice = extractPriceValue(room);
      if (directPrice !== null && directPrice < lowestPrice) {
        lowestPrice = directPrice;
        result.roomName = roomName;
        result.rateName = room.rateName || room.planName || null;
        result.price = directPrice;
      }
      continue;
    }

    // Iterate through rates/prices
    for (const rate of rates) {
      if (!rate || typeof rate !== 'object') continue;

      const price = extractPriceValue(rate);
      
      if (price !== null && price < lowestPrice) {
        lowestPrice = price;
        result.roomName = roomName;
        result.rateName = rate.name || rate.rateName || rate.planName || rate.title || rate.type || null;
        result.price = price;
      }
    }
  }

  // If we found a valid price, return it
  if (result.price !== null && isFinite(result.price)) {
    return result;
  }

  // Otherwise return null values
  return {
    roomName: null,
    rateName: null,
    price: null,
  };
}

/**
 * Extracts a numeric price value from various possible price fields
 */
function extractPriceValue(obj: any): number | null {
  if (!obj || typeof obj !== 'object') return null;

  // Try various common field names for price
  const possiblePriceFields = [
    'price',
    'totalPrice',
    'total',
    'amount',
    'value',
    'cost',
    'rate',
    'basePrice',
    'netPrice',
    'grossPrice',
  ];

  for (const field of possiblePriceFields) {
    const value = obj[field];
    
    // Direct numeric value
    if (typeof value === 'number' && isFinite(value) && value >= 0) {
      return value;
    }

    // String that can be parsed to number
    if (typeof value === 'string') {
      // Remove common currency symbols and whitespace
      const cleaned = value.replace(/[€$£¥,\s]/g, '');
      const parsed = parseFloat(cleaned);
      if (isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    // Nested price object
    if (value && typeof value === 'object') {
      const nestedPrice = extractPriceValue(value);
      if (nestedPrice !== null) {
        return nestedPrice;
      }
    }
  }

  return null;
}

/**
 * Formats a price for display
 */
export function formatPrice(price: number | null, currency: string = '€'): string {
  if (price === null || !isFinite(price)) {
    return '—';
  }
  return `${currency}${price.toFixed(2)}`;
}
