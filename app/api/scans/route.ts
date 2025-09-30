import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL =
  process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

/** Format a UTC Date to 'YYYY-MM-DD' */
function toYMDUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Berlin “today” (calendar day) via Intl without parsing locale strings */
function todayBerlin(): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return { y, m, d };
}

/** Inclusive range of YYYY-MM-DD check-in dates for Berlin today+start..end */
function berlinCheckinsYMD(startOffset: number, endOffset: number): string[] {
  const { y, m, d } = todayBerlin();
  const baseUTC = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const d
