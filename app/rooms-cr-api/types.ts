// ── Shared types for Rooms/CR-API page ────────────────────────────────────────

export type PlaywrightScan = {
  id: number;
  check_in: string;
  take_screenshot: boolean;
  status: string;
  total: number;
  processed: number;
  errors: number;
  created_at: string;
  finished_at: string | null;
};

export type CrRoom = {
  hotel_id: number;
  name: string;
  room_code: string | null;
  global_types: string[] | null;
  image_url: string | null;
};

export type PlaywrightOccResult = {
  hotel_id: number;
  occupancy: string;
  rooms: Array<{ roomId: string; roomCode: string; roomName: string; imageMissing: boolean }> | null;
  screenshot_url: string | null;
  error: string | null;
};

export type HotelEntry = {
  hotel: { id: number; name: string; code: string; brand: string | null; region: string | null; country: string | null };
  crRooms: CrRoom[];
  playwrightScanId: number | null;
  playwrightResults: Record<string, PlaywrightOccResult> | null;
};

export type GroupBy = 'none' | 'brand' | 'region' | 'country';
export type AttentionFilter = 'all' | 'attention' | 'fixable';
export type Quality = 'perfect' | 'verygood' | 'good' | 'mediocre' | 'poor' | 'horrible' | 'unavailable';
export type QualityFilter = 'all' | Quality;

// ── Quality constants ─────────────────────────────────────────────────────────

export const QUALITY_LABELS: Record<Quality, string> = {
  perfect:     'Perfect',
  verygood:    'Very good',
  good:        'Good',
  mediocre:    'Mediocre',
  poor:        'Poor',
  horrible:    'Horrible',
  unavailable: 'Unavailable',
};

export const QUALITY_COLORS: Record<Quality, string> = {
  perfect:     'success',
  verygood:    'primary',
  good:        'info',
  mediocre:    'warning',
  poor:        'orange',
  horrible:    'danger',
  unavailable: 'secondary',
};

export const QUALITY_DESCRIPTIONS: Record<Quality, string> = {
  perfect:     'All scan rooms have images; all matched names equal CR-API names; no unmapped CR-API rooms with images',
  verygood:    'All scan rooms have images; no unmapped CR-API rooms with images; names may differ',
  good:        'All scan rooms have images; unmapped CR-API rooms with images exist',
  mediocre:    '≥50% of scan rooms have images; at least 1 missing',
  poor:        '<50% of scan rooms have images; at least 1 present',
  horrible:    'No scan room has an image',
  unavailable: 'Hotel was scanned but no rooms were found for any occupancy',
};

// ── Quality / attention logic ─────────────────────────────────────────────────

export function hasAttention(entry: HotelEntry): boolean {
  if (!entry.playwrightResults) return false;
  return Object.values(entry.playwrightResults).some(r => r.rooms?.some(rm => rm.imageMissing));
}

export function computeQuality(entry: HotelEntry): Quality | null {
  if (!entry.playwrightResults) return null;

  const scanRooms = new Map<string, { roomName: string; hasImage: boolean }>();
  for (const result of Object.values(entry.playwrightResults)) {
    for (const r of result.rooms ?? []) {
      const key = r.roomCode || r.roomName;
      const hasImage = !r.imageMissing;
      const existing = scanRooms.get(key);
      if (!existing || hasImage) {
        scanRooms.set(key, { roomName: r.roomName, hasImage: hasImage || (existing?.hasImage ?? false) });
      }
    }
  }
  if (scanRooms.size === 0) return 'unavailable';

  const withImg = [...scanRooms.values()].filter(r => r.hasImage).length;
  const ratio = withImg / scanRooms.size;

  if (withImg === 0) return 'horrible';
  if (ratio < 0.5) return 'poor';
  if (withImg < scanRooms.size) return 'mediocre';

  const crWithImg = new Map<string, string>();
  for (const r of entry.crRooms) {
    if (r.image_url) crWithImg.set(r.room_code || r.name, r.name);
  }

  const scanKeys = new Set(scanRooms.keys());
  const hasUnmappedCrWithImg = [...crWithImg.keys()].some(k => !scanKeys.has(k));
  if (hasUnmappedCrWithImg) return 'good';

  let allMatchedNamesEqual = true;
  for (const [key, scan] of scanRooms) {
    const crName = crWithImg.get(key);
    if (crName !== undefined && crName.trim().toLowerCase() !== scan.roomName.trim().toLowerCase()) {
      allMatchedNamesEqual = false;
      break;
    }
  }
  return allMatchedNamesEqual ? 'perfect' : 'verygood';
}
