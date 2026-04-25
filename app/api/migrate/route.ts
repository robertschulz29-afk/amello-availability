import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS scan_hotels (
        scan_id   INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        hotel_id  INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        name      VARCHAR(255) NOT NULL,
        code      VARCHAR(50)  NOT NULL,
        brand     VARCHAR(100),
        region    VARCHAR(100),
        country   VARCHAR(100),
        bookable  BOOLEAN NOT NULL DEFAULT false,
        active    BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (scan_id, hotel_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scan_hotels_scan_id ON scan_hotels(scan_id)`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
