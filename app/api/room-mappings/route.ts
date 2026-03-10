// app/api/room-mappings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/room-mappings
// Returns all hotels with their mappings + available room names in one query
// Optionally scoped: GET /api/room-mappings?hotelId=123
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hotelId = searchParams.get('hotelId');

    // All hotels
    const hotelsQ = await sql`
      SELECT id, name, code
      FROM hotels
      WHERE active = true
      ORDER BY name
    `;

    const hotelIds = hotelsQ.rows.map((h: any) => h.id);
    if (hotelIds.length === 0) return NextResponse.json({ hotels: [] });

    // All mappings for all hotels in one query
    const mappingsQ = await query(
      `SELECT id, hotel_id, amello_room, booking_room, source, confidence, created_at, updated_at
       FROM room_mappings
       WHERE hotel_id = ANY($1::int[])
       ORDER BY hotel_id, amello_room, booking_room`,
      [hotelIds]
    );

    // Room names are maintained in hotel_room_names (updated on scan completion).
    // One indexed lookup instead of a full scan_results JSONB expansion.
    const roomNamesQ = await query(
      `SELECT hotel_id, source, room_name
       FROM hotel_room_names
       WHERE hotel_id = ANY($1::int[])
       ORDER BY hotel_id, source, room_name`,
      [hotelIds]
    );

    // Split into amello / booking maps in JS — single DB round-trip
    const amelloQ  = { rows: roomNamesQ.rows.filter((r: any) => r.source === 'amello')  };
    const bookingQ = { rows: roomNamesQ.rows.filter((r: any) => r.source === 'booking') };

    // Group by hotel_id
    const mappingsByHotel = new Map<number, any[]>();
    const amelloByHotel = new Map<number, string[]>();
    const bookingByHotel = new Map<number, string[]>();

    for (const row of mappingsQ.rows) {
      if (!mappingsByHotel.has(row.hotel_id)) mappingsByHotel.set(row.hotel_id, []);
      mappingsByHotel.get(row.hotel_id)!.push(row);
    }
    for (const row of amelloQ.rows) {
      if (!amelloByHotel.has(row.hotel_id)) amelloByHotel.set(row.hotel_id, []);
      amelloByHotel.get(row.hotel_id)!.push(row.room_name);
    }
    for (const row of bookingQ.rows) {
      if (!bookingByHotel.has(row.hotel_id)) bookingByHotel.set(row.hotel_id, []);
      bookingByHotel.get(row.hotel_id)!.push(row.room_name);
    }

    const hotels = hotelsQ.rows.map((h: any) => ({
      id: h.id,
      name: h.name,
      code: h.code,
      mappings:     mappingsByHotel.get(h.id)  ?? [],
      amelloRooms:  amelloByHotel.get(h.id)    ?? [],
      bookingRooms: bookingByHotel.get(h.id)   ?? [],
    }));

    // If scoped to one hotel, return in legacy shape for backwards compat
    if (hotelId) {
      const h = hotels.find(h => h.id === Number(hotelId));
      if (!h) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 });
      return NextResponse.json({
        mappings:     h.mappings,
        amelloRooms:  h.amelloRooms,
        bookingRooms: h.bookingRooms,
      });
    }

    return NextResponse.json({ hotels });
  } catch (e: any) {
    console.error('[GET /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/room-mappings
// Body: { hotelId, amelloRoom, bookingRoom, source?, confidence? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { hotelId, amelloRoom, bookingRoom, source = 'manual', confidence = null } = body;

    if (!hotelId || !amelloRoom || !bookingRoom) {
      return NextResponse.json(
        { error: 'hotelId, amelloRoom and bookingRoom are required' },
        { status: 400 }
      );
    }

    const existing = await sql`
      SELECT id, source FROM room_mappings
      WHERE hotel_id = ${Number(hotelId)}
        AND amello_room = ${amelloRoom}
        AND booking_room = ${bookingRoom}
    `;

    if (existing.rows.length > 0 && existing.rows[0].source === 'manual' && source === 'ai') {
      return NextResponse.json(existing.rows[0], { status: 200 });
    }

    const result = await sql`
      INSERT INTO room_mappings (hotel_id, amello_room, booking_room, source, confidence)
      VALUES (${Number(hotelId)}, ${amelloRoom}, ${bookingRoom}, ${source}, ${confidence})
      ON CONFLICT (hotel_id, amello_room, booking_room) DO UPDATE
        SET updated_at  = NOW(),
            source      = CASE WHEN room_mappings.source = 'manual' THEN 'manual' ELSE EXCLUDED.source END,
            confidence  = CASE WHEN room_mappings.source = 'manual' THEN room_mappings.confidence ELSE EXCLUDED.confidence END
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
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await sql`DELETE FROM room_mappings WHERE id = ${Number(id)}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[DELETE /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH /api/room-mappings?id=123
// Patching always promotes to 'manual'
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
        source       = 'manual',
        confidence   = NULL,
        updated_at   = NOW()
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.rows.length) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: any) {
    console.error('[PATCH /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
