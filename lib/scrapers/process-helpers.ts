// lib/scrapers/process-helpers.ts
// Shared date utilities and types for scan processing sub-routes

export function toYMDUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function normalizeYMD(input: any): string | null {
  if (!input && input !== 0) return null;
  if (input instanceof Date && !isNaN(input.getTime())) return toYMDUTC(input);
  const s = String(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toYMDUTC(d);
  return null;
}

export function ymdToUTC(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function datesFromBase(baseYMD: string, days: number): string[] {
  const base = ymdToUTC(baseYMD);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + i);
    out.push(toYMDUTC(dt));
  }
  return out;
}

export type ScanCell = {
  hotelId: number;
  hotelCode: string;
  bookingUrl: string | null;
  checkIn: string;
  checkOut: string;
};
