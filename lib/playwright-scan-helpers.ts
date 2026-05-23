// lib/playwright-scan-helpers.ts

export const OCCUPANCY_CONFIGS = [
  { param: '1',      folder: 'rooms_1',        label: '1 Adult' },
  { param: '2',      folder: 'rooms_2',        label: '2 Adults' },
  { param: '4',      folder: 'rooms_4',        label: '4 Adults' },
  { param: '2%2C+9', folder: 'rooms_2_child9', label: '2 Adults + Child 9' },
] as const;

export type OccupancyConfig = (typeof OCCUPANCY_CONFIGS)[number];

// CSS selectors
export const SELECTOR_ROOM_HEADING = '.CardRoom_card-room__heading__eM_Eo';
export const SELECTOR_IMAGE_CONTAINER = '.CardRoom_card-room__image-container__cN3mR';

/**
 * Hotel slug: name lowercased, apostrophes/accents/specials → space or removed,
 * spaces → hyphens, consecutive hyphens collapsed, trailing stripped,
 * then append `-{code}`
 */
export function buildHotelSlug(name: string, code: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[''`]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/-$/, '') +
    '-' +
    code
  );
}

/**
 * Build the TUI Amello URL for a given hotel slug, check-in date, and occupancy param.
 * Checkout = checkin + 1 day.
 */
export function buildUrl(slug: string, checkIn: string, occupancyParam: string): string {
  const d = new Date(checkIn + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  const checkOut = d.toISOString().slice(0, 10);
  return `https://www.tuiamello.com/en-DE/hotel/${slug}/?departure-date=${checkIn}&return-date=${checkOut}&rooms=${occupancyParam}`;
}
