import { NextRequest, NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

const BASE_URL = process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function datesBerlin(startOffset: number, endOffset: number, anchor?: Date): string[] {
  const now = anchor ?? new Date();
  const berlinNow = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/Berlin' }));
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const d = new Date(berlinNow);
    d.setDate(d.getDate() + off);
    out.push(toYMD(d));
  }
  return out;
}

// GET /api/scans → list scans
export async function GET() {
  const { rows } = await sql`
    SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone
    FROM scans
    ORDER BY scanned_at DESC
  `;
  return NextResponse.json(rows);
}

// POST /api/scans → run a new scan and persist results
export async function POST(req: NextRequest) {
  const { startOffset = 5, endOffset = 90 } = await req.json().catch(() => ({}));
  const anchor = new Date();
  const checkInDates = datesBerlin(startOffset, endOffset, anchor);
  const fixedCheckout = datesBerlin(12, 12, anchor)[0];

  const scanIns = await sql`
    INSERT INTO scans (fixed_checkout, start_offset, end_offset, timezone)
    VALUES (${fixedCheckout}, ${startOffset}, ${endOffset}, 'Europe/Berlin')
    RETURNING id, scanned_at
  `;
  const scan = scanIns.rows[0] as { id: number; scanned_at: string };

  const hotels = (await sql`
    SELECT id, name, code
