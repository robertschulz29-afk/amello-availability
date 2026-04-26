// app/api/hotels/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get('format') || 'long').toLowerCase();
    const idsParam = searchParams.get('ids');
    const ids = idsParam ? idsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n)) : [];

    let hotels: any[];
    if (ids.length > 0) {
      const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
      const res = await query(
        `SELECT id, name, code, brand, region, country, booking_url, tuiamello_url, expedia_url, bookable, active
         FROM hotels WHERE id IN (${ph}) ORDER BY name ASC`,
        ids,
      );
      hotels = res.rows;
    } else {
      const res = await query(
        `SELECT id, name, code, brand, region, country, booking_url, tuiamello_url, expedia_url, bookable, active
         FROM hotels ORDER BY name ASC`,
        [],
      );
      hotels = res.rows;
    }

    const header = [
      'id', 'name', 'code', 'brand', 'region', 'country',
      'booking_url', 'tuiamello_url', 'expedia_url',
      'bookable', 'active',
    ];

    const lines: string[] = [header.join(',')];

    for (const h of hotels) {
      lines.push([
        csvEscape(h.id),
        csvEscape(h.name),
        csvEscape(h.code),
        csvEscape(h.brand),
        csvEscape(h.region),
        csvEscape(h.country),
        csvEscape(h.booking_url),
        csvEscape(h.tuiamello_url),
        csvEscape(h.expedia_url),
        csvEscape(h.bookable),
        csvEscape(h.active),
      ].join(','));
    }

    const body = lines.join('\r\n');
    const filename = `hotels_${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });

  } catch (e: any) {
    console.error('[GET /api/hotels/export]', e);
    return new NextResponse('Export failed: ' + e.message, { status: 500 });
  }
}