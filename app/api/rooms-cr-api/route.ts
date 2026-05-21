import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scanId = Number(searchParams.get('scanId'));

  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scanId' }, { status: 400 });
  }

  try {
    const [hotelsQ, screenshotsQ, imageryQ, scanRoomNamesQ, crRoomNamesQ] = await Promise.all([
      query<{ id: number; name: string; code: string; brand: string | null; active: boolean | null; bookable: boolean | null }>(
        `SELECT id, name, code, brand, active, bookable FROM hotels ORDER BY name`,
        [],
      ),
      query<{ hotel_id: number; screenshot_url: string }>(
        `SELECT hotel_id, screenshot_url FROM scan_screenshots WHERE scan_id = $1`,
        [scanId],
      ),
      query<{ hotel_id: number; room_name: string; image_url: string }>(
        `SELECT hotel_id, room_name, image_url FROM room_imagery ORDER BY hotel_id, room_name`,
        [],
      ),
      // Distinct room names from amello scan results for this scan
      query<{ hotel_id: number; room_names: string[] }>(
        `SELECT sr.hotel_id,
                array_agg(DISTINCT room->>'name' ORDER BY room->>'name') AS room_names
         FROM scan_results sr,
              jsonb_array_elements(sr.response_json->'rooms') AS room
         WHERE sr.scan_id = $1
           AND sr.source = 'amello'
           AND sr.response_json ? 'rooms'
           AND room->>'name' IS NOT NULL
         GROUP BY sr.hotel_id`,
        [scanId],
      ),
      // Distinct room names per hotel in room_imagery (CR-API)
      query<{ hotel_id: number; room_names: string[] }>(
        `SELECT hotel_id, array_agg(DISTINCT room_name ORDER BY room_name) AS room_names
         FROM room_imagery
         GROUP BY hotel_id`,
        [],
      ),
    ]);

    const screenshotMap = new Map<number, string>();
    for (const row of screenshotsQ.rows) {
      screenshotMap.set(row.hotel_id, row.screenshot_url);
    }

    const imageryMap = new Map<number, Array<{ room_name: string; image_url: string }>>();
    for (const row of imageryQ.rows) {
      const arr = imageryMap.get(row.hotel_id) ?? [];
      arr.push({ room_name: row.room_name, image_url: row.image_url });
      imageryMap.set(row.hotel_id, arr);
    }

    const scanRoomNamesMap = new Map<number, string[]>();
    for (const row of scanRoomNamesQ.rows) {
      scanRoomNamesMap.set(row.hotel_id, row.room_names);
    }

    const crRoomNamesMap = new Map<number, string[]>();
    for (const row of crRoomNamesQ.rows) {
      crRoomNamesMap.set(row.hotel_id, row.room_names);
    }

    const result = hotelsQ.rows.map(h => {
      const scanRoomNames = scanRoomNamesMap.get(h.id) ?? null;
      const crRoomNames = crRoomNamesMap.get(h.id) ?? null;
      return {
        hotel: { id: h.id, name: h.name, code: h.code, brand: h.brand, active: h.active, bookable: h.bookable },
        screenshot: screenshotMap.has(h.id) ? { url: screenshotMap.get(h.id)! } : null,
        roomImagery: imageryMap.get(h.id) ?? [],
        scanRoomNames,
        crRoomNames,
        scanRoomCount: scanRoomNames?.length ?? null,
        crRoomCount: crRoomNames?.length ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[GET /api/rooms-cr-api] error', e);
    return NextResponse.json({ error: e.message || 'failed to load data' }, { status: 500 });
  }
}
