export const OCCUPANCY_CONFIGS = [
  { param: '1',      folder: 'rooms_1',        label: '1 Adult' },
  { param: '2',      folder: 'rooms_2',        label: '2 Adults' },
  { param: '4',      folder: 'rooms_4',        label: '4 Adults' },
  { param: '2%2C+9', folder: 'rooms_2_child9', label: '2 Adults + Child 9' },
] as const;

// Stable selector to detect room cards are rendered (class prefix, hash-independent)
export const ROOM_CARD_SELECTOR       = '[class*="CardRoom_card-room"][id]';
// Hash-independent selectors for data extraction
export const ROOM_NAME_SELECTOR       = '[class*="CardRoom_card-room__heading"]';
export const IMAGE_CONTAINER_SELECTOR = '[class*="CardRoom_card-room__image-container"]';

export function buildHotelSlug(name: string, code: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') + '-' + code;
}

export function buildTuiUrl(slug: string, checkIn: string, occupancyParam: string): string {
  const d = new Date(checkIn + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  const checkOut = d.toISOString().slice(0, 10);
  return `https://www.tuiamello.com/en-DE/hotel/${slug}/?departure-date=${checkIn}&return-date=${checkOut}&rooms=${occupancyParam}`;
}
