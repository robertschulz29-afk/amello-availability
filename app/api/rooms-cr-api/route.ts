import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playwrightScanIdParam = searchParams.get('playwrightScanId');

  try {
    // Load active+bookable hotels ordered by name
    const hotelsQ = await query<{ id: number; name: string; code: string; brand: string | null }>(
      `SELECT id, name, code, brand FROM hotels WHERE active = true AND bookable = true ORDER BY name`,
      [],
    );

    // Load all CR-API rooms
    const crRoomsQ = await query<{
      hotel_id: number;
      name: string;
      room_code: string | null;
      global_types: string[] | null;
      image_url: string | null;
    }>(
      `SELECT hotel_id, name, room_code, global_types, image_url FROM cr_api_rooms ORDER BY hotel_id, name`,
      [],
    );

    // Determine which playwright scan to use
    let playwrightScanId: number | null = null;
    if (playwrightScanIdParam) {
      const n = Number(playwrightScanIdParam);
      if (Number.isFinite(n) && n > 0) {
        playwrightScanId = n;
      }
    } else {
      // Most recent done scan
      const latestQ = await query<{ id: number }>(
        `SELECT id FROM playwright_scans WHERE status = 'done' ORDER BY id DESC LIMIT 1`,
        [],
      );
      if (latestQ.rows.length > 0) {
        playwrightScanId = latestQ.rows[0].id;
      }
    }

    // Load playwright scan results for the selected scan
    type PlaywrightResult = {
      hotel_id: number;
      occupancy: string;
      rooms: Array<{ roomName: string; imageMissing: boolean }> | null;
      screenshot_url: string | null;
      error: string | null;
    };

    let playwrightResults: PlaywrightResult[] = [];
    if (playwrightScanId !== null) {
      const prQ = await query<PlaywrightResult>(
        `SELECT hotel_id, occupancy, rooms, screenshot_url, error
         FROM playwright_scan_results WHERE scan_id = $1`,
        [playwrightScanId],
      );
      playwrightResults = prQ.rows;
    }

    // Build maps
    const crRoomsMap = new Map<number, typeof crRoomsQ.rows>();
    for (const row of crRoomsQ.rows) {
      const arr = crRoomsMap.get(row.hotel_id) ?? [];
      arr.push(row);
      crRoomsMap.set(row.hotel_id, arr);
    }

    // playwright results: hotel_id → occupancy → result
    const playwrightMap = new Map<number, Map<string, PlaywrightResult>>();
    for (const row of playwrightResults) {
      let occMap = playwrightMap.get(row.hotel_id);
      if (!occMap) {
        occMap = new Map();
        playwrightMap.set(row.hotel_id, occMap);
      }
      occMap.set(row.occupancy, row);
    }

    const result = hotelsQ.rows.map(h => ({
      hotel: { id: h.id, name: h.name, code: h.code, brand: h.brand },
      crRooms: crRoomsMap.get(h.id) ?? [],
      playwrightScanId,
      playwrightResults: playwrightMap.has(h.id)
        ? Object.fromEntries(playwrightMap.get(h.id)!)
        : null,
    }));

    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[GET /api/rooms-cr-api] error', e);
    return NextResponse.json({ error: e.message || 'failed to load data' }, { status: 500 });
  }
}
