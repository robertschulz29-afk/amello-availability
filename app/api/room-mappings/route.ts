// app/api/room-mappings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/room-mappings?hotelId=123
// Returns all mappings for a hotel, plus the distinct room names seen in scan_results
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hotelId = searchParams.get('hotelId');

    if (!hotelId) {
      return NextResponse.json({ error: 'hotelId is required' }, { status: 400 });
    }

    // Existing saved mappings
    const mappings = await sql`
      SELECT id, hotel_id, amello_room, booking_room, created_at, updated_at
      FROM room_mappings
      WHERE hotel_id = ${Number(hotelId)}
      ORDER BY amello_room, booking_room
    `;

    // Distinct Amello room names seen for this hotel across all scans
    const amelloRooms = await sql`
      SELECT DISTINCT
        elem->>'name' AS room_name
      FROM scan_results sr,
           jsonb_array_elements(sr.response_json->'rooms') AS elem
      WHERE sr.hotel_id   = ${Number(hotelId)}
        AND sr.source      = 'amello'
        AND sr.status      = 'green'
        AND elem->>'name' IS NOT NULL
      ORDER BY room_name
    `;

    // Distinct Booking.com room names seen for this hotel across all scans
    const bookingRooms = await sql`
      SELECT DISTINCT
        elem->>'name' AS room_name
      FROM scan_results sr,
           jsonb_array_elements(sr.response_json->'rooms') AS elem
      WHERE sr.hotel_id   = ${Number(hotelId)}
        AND sr.source      = 'booking'
        AND sr.status      = 'green'
        AND elem->>'name' IS NOT NULL
      ORDER BY room_name
    `;

    return NextResponse.json({
      mappings:     mappings.rows,
      amelloRooms:  amelloRooms.rows.map((r: any) => r.room_name as string),
      bookingRooms: bookingRooms.rows.map((r: any) => r.room_name as string),
    });
  } catch (e: any) {
    console.error('[GET /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/room-mappings
// Body: { hotelId, amelloRoom, bookingRoom }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { hotelId, amelloRoom, bookingRoom } = body;

    if (!hotelId || !amelloRoom || !bookingRoom) {
      return NextResponse.json(
        { error: 'hotelId, amelloRoom and bookingRoom are required' },
        { status: 400 }
      );
    }

    const result = await sql`
      INSERT INTO room_mappings (hotel_id, amello_room, booking_room)
      VALUES (${Number(hotelId)}, ${amelloRoom}, ${bookingRoom})
      ON CONFLICT (hotel_id, amello_room, booking_room) DO UPDATE
        SET updated_at = NOW()
      RETURNING *
    `;

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (e: any) {
    console.error('[POST /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/room-mappings?id=123
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await sql`DELETE FROM room_mappings WHERE id = ${Number(id)}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[DELETE /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH /api/room-mappings?id=123
// Body: { amelloRoom?, bookingRoom? }
export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { amelloRoom, bookingRoom } = body;

    if (!amelloRoom && !bookingRoom) {
      return NextResponse.json(
        { error: 'At least one of amelloRoom or bookingRoom is required' },
        { status: 400 }
      );
    }

    const result = await sql`
      UPDATE room_mappings
      SET
        amello_room  = COALESCE(${amelloRoom  ?? null}, amello_room),
        booking_room = COALESCE(${bookingRoom ?? null}, booking_room),
        updated_at   = NOW()
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (e: any) {
    console.error('[PATCH /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
