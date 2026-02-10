/**
 * Utility functions for extracting price information from hotel API responses
 */

export interface LowestPriceInfo {
  roomName: string | null;
  rateName: string | null;
  price: number | null;
  currency: string | null;
}

export interface RateInfo {
  name: string | null;
  price: number;
  currency: string;
}

export interface RoomInfo {
  name: string | null;
  rates: RateInfo[];
}

export interface CompactRoomData {
  rooms: RoomInfo[];
}

/**
 * Extracts room configurations with their associated rates and prices from the Amello API response
 * Returns a compact data structure containing only essential information
 */
export function extractRoomRateData(responseJson: any): CompactRoomData {
  const result: CompactRoomData = {
    rooms: [],
  };

  if (!responseJson || typeof responseJson !== 'object') {
    return result;
  }

  // Detect if this is Amello API format (data.rooms with offers containing rate objects)
  // Amello API always returns prices in cents that need to be divided by 100
  const isAmelloFormat = !!(
    responseJson.data &&
    Array.isArray(responseJson.data.rooms) &&
    responseJson.data.rooms.length > 0 &&
    responseJson.data.rooms.some((room: any) => 
      Array.isArray(room.offers) && 
      room.offers.some((offer: any) => offer.rate && offer.totalPrice)
    )
  );

  // Try to extract currency from response (fallback to EUR)
  const globalCurrency = extractCurrency(responseJson) || 'EUR';

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

  // Iterate through all rooms to extract data
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue;

    // Get room name
    const roomName = room.name || room.roomName || room.title || room.type || null;

    // Try to get currency from room if not found at root level
    const roomCurrency = extractCurrency(room) || globalCurrency;

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
    }

    const extractedRates: RateInfo[] = [];

    if (rates && rates.length > 0) {
      // Iterate through rates/prices
      for (const rate of rates) {
        if (!rate || typeof rate !== 'object') continue;

        const price = extractPriceValue(rate, isAmelloFormat);
        
        if (price !== null && isFinite(price)) {
          // For Amello API, rate name is in rate.rate.name, otherwise try common fields
          const rateName = (rate.rate && rate.rate.name) || 
                          rate.name || 
                          rate.rateName || 
                          rate.planName || 
                          rate.title || 
                          rate.type || 
                          null;
          
          const rateCurrency = extractCurrency(rate) || roomCurrency;

          extractedRates.push({
            name: rateName,
            price: price,
            currency: rateCurrency,
          });
        }
      }
    } else {
      // Maybe the room object itself contains a direct price
      const directPrice = extractPriceValue(room, isAmelloFormat);
      if (directPrice !== null && isFinite(directPrice)) {
        const rateName = room.rateName || room.planName || null;
        extractedRates.push({
          name: rateName,
          price: directPrice,
          currency: roomCurrency,
        });
      }
    }

    // Only add the room if we found at least one rate with a valid price
    if (extractedRates.length > 0) {
      result.rooms.push({
        name: roomName,
        rates: extractedRates,
      });
    }
  }

  return result;
}

/**
 * Safely extracts the lowest price from a hotel API response JSON
 * Handles various response structures including the new compact format
 * and returns null values if unavailable
 */
export function extractLowestPrice(responseJson: any): LowestPriceInfo {
  const result: LowestPriceInfo = {
    roomName: null,
    rateName: null,
    price: null,
    currency: null,
  };

  if (!responseJson || typeof responseJson !== 'object') {
    return result;
  }

  // Check if this is the new compact format (has rooms array with rates)
  const isCompactFormat = !!(
    Array.isArray(responseJson.rooms) &&
    responseJson.rooms.length > 0 &&
    responseJson.rooms[0]?.rates &&
    Array.isArray(responseJson.rooms[0].rates)
  );

  if (isCompactFormat) {
    // Handle compact format - prices are already in decimal form
    let lowestPrice = Infinity;

    for (const room of responseJson.rooms) {
      if (!room || !Array.isArray(room.rates)) continue;

      for (const rate of room.rates) {
        if (!rate || typeof rate.price !== 'number' || !isFinite(rate.price)) continue;

        if (rate.price < lowestPrice) {
          lowestPrice = rate.price;
          result.roomName = room.name || null;
          result.rateName = rate.name || null;
          result.price = rate.price;
          result.currency = rate.currency || 'EUR';
        }
      }
    }

    if (isFinite(lowestPrice)) {
      return result;
    }

    return {
      roomName: null,
      rateName: null,
      price: null,
      currency: null,
    };
  }

  // Original logic for full API response format
  // Detect if this is Amello API format (data.rooms with offers containing rate objects)
  // Amello API always returns prices in cents that need to be divided by 100
  const isAmelloFormat = !!(
    responseJson.data &&
    Array.isArray(responseJson.data.rooms) &&
    responseJson.data.rooms.length > 0 &&
    responseJson.data.rooms.some((room: any) => 
      Array.isArray(room.offers) && 
      room.offers.some((offer: any) => offer.rate && offer.totalPrice)
    )
  );

  // Try to extract currency from response
  let currency = extractCurrency(responseJson);

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

    // Try to get currency from room if not found at root level
    if (!currency) {
      currency = extractCurrency(room);
    }

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
      const directPrice = extractPriceValue(room, isAmelloFormat);
      if (directPrice !== null && directPrice < lowestPrice) {
        lowestPrice = directPrice;
        result.roomName = roomName;
        result.rateName = room.rateName || room.planName || null;
        result.price = directPrice;
        if (!currency) {
          currency = extractCurrency(room);
        }
      }
      continue;
    }

    // Iterate through rates/prices
    for (const rate of rates) {
      if (!rate || typeof rate !== 'object') continue;

      const price = extractPriceValue(rate, isAmelloFormat);
      
      if (price !== null && price < lowestPrice) {
        lowestPrice = price;
        result.roomName = roomName;
        // For Amello API, rate name is in rate.rate.name, otherwise try common fields
        result.rateName = (rate.rate && rate.rate.name) || rate.name || rate.rateName || rate.planName || rate.title || rate.type || null;
        result.price = price;
        if (!currency) {
          currency = extractCurrency(rate);
        }
      }
    }
  }

  // If we found a valid price, set currency and return
  if (result.price !== null && isFinite(result.price)) {
    result.currency = currency || 'EUR'; // Default to EUR if not found
    return result;
  }

  // Otherwise return null values
  return {
    roomName: null,
    rateName: null,
    price: null,
    currency: null,
  };
}

/**
 * Extracts currency code from an object
 */
function extractCurrency(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;

  const possibleCurrencyFields = [
    'currency',
    'currencyCode',
    'currency_code',
  ];

  for (const field of possibleCurrencyFields) {
    const value = obj[field];
    if (typeof value === 'string' && value.length > 0) {
      return value.toUpperCase();
    }
  }

  return null;
}

/**
 * Extracts a numeric price value from various possible price fields
 * Automatically converts prices from cents to decimal (divides by 100)
 * when pricesInCents flag is true
 */
function extractPriceValue(obj: any, pricesInCents: boolean = false): number | null {
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
      // Convert from cents to decimal if explicitly indicated
      return pricesInCents ? value / 100 : value;
    }

    // String that can be parsed to number
    if (typeof value === 'string') {
      // First, try to match a valid number format (with optional decimal point)
      const match = value.match(/\d+(?:\.\d+)?/);
      if (match) {
        const parsed = parseFloat(match[0]);
        if (isFinite(parsed) && parsed >= 0) {
          // Convert from cents to decimal if explicitly indicated
          return pricesInCents ? parsed / 100 : parsed;
        }
      }
    }

    // Nested price object
    if (value && typeof value === 'object') {
      const nestedPrice = extractPriceValue(value, pricesInCents);
      if (nestedPrice !== null) {
        return nestedPrice;
      }
    }
  }

  return null;
}

/**
 * Formats a price for display with currency symbol
 */
export function formatPrice(price: number | null, currency: string | null = null): string {
  if (price === null || !isFinite(price)) {
    return '—';
  }
  
  // Map common currency codes to symbols
  const currencySymbols: Record<string, string> = {
    'EUR': '€',
    'USD': '$',
    'GBP': '£',
    'JPY': '¥',
    'CHF': 'CHF',
  };
  
  const symbol = currency ? (currencySymbols[currency.toUpperCase()] || currency) : '€';
  return `${symbol}${price.toFixed(2)}`;
}
