import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeYMD(input: any): string {
  if (!input && input !== 0) return '';
  if (input instanceof Date && !isNaN(input.getTime())) {
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  return s;
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return new NextResponse('invalid scan id', { status: 400 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'long').toLowerCase(); // 'long' | 'wide'
  const filename = `scan_${scanId}_${format}.csv`;

  try {
    // fetch scan (for sanity + date list if needed)
    const scanQ = await sql`
      SELECT id, base_checkin, days, stay_nights, scanned_at
      FROM scans WHERE id = ${scanId}
    `;
    if (scanQ.rows.length === 0) {
      return new NextResponse('scan not found', { status: 404 });
    }
    const scan = scanQ.rows[0];

    // fetch hotels + results
    const q = await sql`
      SELECT
        h.id AS hotel_id,
        h.name AS hotel_name,
        h.code AS hotel_code,
        h.brand AS hotel_brand,
        h.region AS hotel_region,
        h.country AS hotel_country,
        r.check_in_date,
        r.status
      FROM scan_results r
      JOIN hotels h ON h.id = r.hotel_id
      WHERE r.scan_id = ${scanId}
      ORDER BY h.name ASC, r.check_in_date ASC
    `;
    const rows = q.rows as Array<{
      hotel_id: number;
      hotel_name: string;
      hotel_code: string;
      hotel_brand: string | null;
      hotel_region: string | null;
      hotel_country: string | null;
      check_in_date: any;
      status: string;
    }>;

    // If there are no rows, still produce a valid CSV with header only
    if (format === 'long') {
      // Long format: one row per (hotel, date)
      // Columns: hotel_id, hotel_name, hotel_code, brand, region, country, check_in_date, status
      const header = [
        'hotel_id',
        'hotel_name',
        'hotel_code',
        'brand',
        'region',
        'country',
        'check_in_date',
        'status',
      ];
      const out: string[] = [header.join(',')];

      for (const r of rows) {
        const rec = [
          csvEscape(r.hotel_id),
          csvEscape(r.hotel_name),
          csvEscape(r.hotel_code),
          csvEscape(r.hotel_brand ?? ''),
          csvEscape(r.hotel_region ?? ''),
          csvEscape(r.hotel_country ?? ''),
          csvEscape(normalizeYMD(r.check_in_date)),
          csvEscape(r.status),
        ];
        out.push(rec.join(','));
      }

      const body = out.join('\r\n');
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } else if (format === 'wide') {
      // Wide format: one row per hotel, one column per date
      // Build date set
      const datesSet = new Set<string>();
      for (const r of rows) datesSet.add(normalizeYMD(r.check_in_date));
      const dates = Array.from(datesSet).sort();

      // Build map: hotel_code -> { meta, statuses[date] = 'green'|'red' }
      type Meta = { id: number; name: string; code: string; brand: string; region: string; country: string };
      const hotelsMap = new Map<string, { meta: Meta; statuses: Record<string, string> }>();
      for (const r of rows) {
        const code = r.hotel_code;
        const entry = hotelsMap.get(code) || {
          meta: {
            id: r.hotel_id,
            name: r.hotel_name,
            code: r.hotel_code,
            brand: r.hotel_brand ?? '',
            region: r.hotel_region ?? '',
            country: r.hotel_country ?? '',
          },
          statuses: {},
        };
        entry.statuses[normalizeYMD(r.check_in_date)] = r.status;
        hotelsMap.set(code, entry);
      }

      // Header
      const header = ['hotel_id','hotel_name','hotel_code','brand','region','country', ...dates];
      const out: string[] = [header.join(',')];

      // Rows
      const hotelRows = Array.from(hotelsMap.values())
        .sort((a,b) => a.meta.name.localeCompare(b.meta.name));

      for (const h of hotelRows) {
        const base = [
          csvEscape(h.meta.id),
          csvEscape(h.meta.name),
          csvEscape(h.meta.code),
          csvEscape(h.meta.brand),
          csvEscape(h.meta.region),
          csvEscape(h.meta.country),
        ];
        const cells = dates.map(d => csvEscape(h.statuses[d] ?? ''));
        out.push([...base, ...cells].join(','));
      }

      const body = out.join('\r\n');
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } else {
      return new NextResponse('unsupported format; use ?format=long or ?format=wide', { status: 400 });
    }
  } catch (e:any) {
    console.error('[GET /api/scans/:id/export] error', e);
    return new NextResponse('export failed', { status: 500 });
  }
}
