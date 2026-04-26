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
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
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

type PriceInfo = {
  roomName: string | null;
  rateName: string | null;
  basePrice: number | null;
  actualPrice: number | null;
  currency: string | null;
};

function extractPrice(responseJson: any): PriceInfo {
  if (!responseJson) return { roomName: null, rateName: null, basePrice: null, actualPrice: null, currency: null };

  const rooms: any[] = responseJson.rooms ?? [];
  let best: { roomName: string; rateName: string; basePrice: number; actualPrice: number; currency: string } | null = null;

  for (const room of rooms) {
    for (const rate of room.rates ?? []) {
      // support both new (actualPrice/basePrice) and old (price/memberPrice) field names
      const actualPrice: number | null = rate.actualPrice ?? rate.price ?? null;
      if (actualPrice == null) continue;
      const basePrice: number | null = rate.basePrice ?? rate.memberPrice ?? null;
      if (!best || actualPrice < best.actualPrice) {
        best = {
          roomName: room.name ?? '',
          rateName: rate.name ?? '',
          basePrice,
          actualPrice,
          currency: rate.currency ?? responseJson.currency ?? 'EUR',
        };
      }
    }
  }

  if (!best) return { roomName: null, rateName: null, basePrice: null, actualPrice: null, currency: null };
  return { roomName: best.roomName, rateName: best.rateName, basePrice: best.basePrice, actualPrice: best.actualPrice, currency: best.currency };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return new NextResponse('invalid scan id', { status: 400 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'long').toLowerCase();
  const filename = `scan_${scanId}_${format}.csv`;

  try {
    const scanQ = await sql`SELECT id FROM scans WHERE id = ${scanId}`;
    if (scanQ.rows.length === 0) return new NextResponse('scan not found', { status: 404 });

    const q = await sql`
      SELECT
        h.id AS hotel_id,
        h.name AS hotel_name,
        h.code AS hotel_code,
        h.brand AS hotel_brand,
        h.region AS hotel_region,
        h.country AS hotel_country,
        r.check_in_date,
        r.status,
        r.source,
        r.response_json
      FROM scan_results r
      JOIN hotels h ON h.id = r.hotel_id
      WHERE r.scan_id = ${scanId}
      ORDER BY h.name ASC, r.check_in_date ASC, r.source ASC
    `;

    type Row = {
      hotel_id: number;
      hotel_name: string;
      hotel_code: string;
      hotel_brand: string | null;
      hotel_region: string | null;
      hotel_country: string | null;
      check_in_date: any;
      status: string;
      source: string;
      response_json: any;
    };
    const rows = q.rows as Row[];

    if (format === 'long') {
      const header = [
        'hotel_id', 'hotel_name', 'hotel_code', 'brand', 'region', 'country',
        'check_in_date', 'status', 'source',
        'room_name', 'rate_name', 'base_price', 'actual_price', 'currency',
      ];
      const out: string[] = [header.join(',')];

      for (const r of rows) {
        const { roomName, rateName, basePrice, actualPrice, currency } =
          r.status === 'green' ? extractPrice(r.response_json) : { roomName: null, rateName: null, basePrice: null, actualPrice: null, currency: null };
        out.push([
          csvEscape(r.hotel_id),
          csvEscape(r.hotel_name),
          csvEscape(r.hotel_code),
          csvEscape(r.hotel_brand ?? ''),
          csvEscape(r.hotel_region ?? ''),
          csvEscape(r.hotel_country ?? ''),
          csvEscape(normalizeYMD(r.check_in_date)),
          csvEscape(r.status),
          csvEscape(r.source ?? ''),
          csvEscape(roomName),
          csvEscape(rateName),
          csvEscape(basePrice),
          csvEscape(actualPrice),
          csvEscape(currency),
        ].join(','));
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
      const datesSet = new Set<string>();
      for (const r of rows) datesSet.add(normalizeYMD(r.check_in_date));
      const dates = Array.from(datesSet).sort();

      type HotelEntry = {
        meta: { id: number; name: string; code: string; brand: string; region: string; country: string };
        statuses: Record<string, string>;
        prices: Record<string, number | null>;
        currencies: Record<string, string | null>;
      };
      const hotelsMap = new Map<string, HotelEntry>();

      for (const r of rows) {
        const code = r.hotel_code;
        if (!hotelsMap.has(code)) {
          hotelsMap.set(code, {
            meta: { id: r.hotel_id, name: r.hotel_name, code, brand: r.hotel_brand ?? '', region: r.hotel_region ?? '', country: r.hotel_country ?? '' },
            statuses: {},
            prices: {},
            currencies: {},
          });
        }
        const entry = hotelsMap.get(code)!;
        const date = normalizeYMD(r.check_in_date);
        entry.statuses[date] = r.status;
        if (r.status === 'green') {
          const { actualPrice, currency } = extractPrice(r.response_json);
          if (actualPrice != null && (entry.prices[date] == null || actualPrice < entry.prices[date]!)) {
            entry.prices[date] = actualPrice;
            entry.currencies[date] = currency;
          }
        }
      }

      const dateCols = dates.flatMap(d => [`status_${d}`, `price_${d}`]);
      const header = ['hotel_id', 'hotel_name', 'hotel_code', 'brand', 'region', 'country', ...dateCols];
      const out: string[] = [header.join(',')];

      for (const h of Array.from(hotelsMap.values()).sort((a, b) => a.meta.name.localeCompare(b.meta.name))) {
        const base = [
          csvEscape(h.meta.id), csvEscape(h.meta.name), csvEscape(h.meta.code),
          csvEscape(h.meta.brand), csvEscape(h.meta.region), csvEscape(h.meta.country),
        ];
        const cells = dates.flatMap(d => [
          csvEscape(h.statuses[d] ?? ''),
          csvEscape(h.prices[d] ?? ''),
        ]);
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
  } catch (e: any) {
    console.error('[GET /api/scans/:id/export] error', e);
    return new NextResponse('export failed', { status: 500 });
  }
}
