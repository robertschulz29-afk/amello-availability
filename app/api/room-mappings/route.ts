// app/api/room-mappings/route.ts
// N-way room mapping groups: a group is a set of at most one room_name per
// source ("anchor + attach" pattern). See db/init.sql for schema.
import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/room-mappings
// Returns all hotels with their mapping groups (+ members) and unmapped room_names.
// Optionally scoped: GET /api/room-mappings?hotelId=123
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hotelIdParam = searchParams.get('hotelId');

    const hotelsQ = await sql`
      SELECT id, name, code
      FROM hotels
      WHERE active = true
      ORDER BY name
    `;

    const hotelIds = hotelsQ.rows.map((h: any) => h.id);
    if (hotelIds.length === 0) return NextResponse.json({ hotels: [] });

    // All groups + members for all hotels in one query (join room_names for the label).
    const membersQ = await query(
      `SELECT
         g.id            AS group_id,
         g.hotel_id      AS hotel_id,
         g.source        AS group_source,
         g.confidence    AS group_confidence,
         m.id            AS member_id,
         m.source        AS member_source,
         m.room_name_id  AS room_name_id,
         m.member_status AS member_status,
         m.confidence    AS member_confidence,
         rn.room_name    AS room_name
       FROM room_mapping_groups g
       JOIN room_mapping_members m ON m.group_id = g.id
       JOIN room_names rn ON rn.id = m.room_name_id
       WHERE g.hotel_id = ANY($1::int[])
       ORDER BY g.hotel_id, g.id, m.source`,
      [hotelIds]
    );

    // All room_names not currently claimed by any group, grouped by hotel + source.
    const unmappedQ = await query(
      `SELECT rn.id, rn.hotel_id, rn.source, rn.room_name
       FROM room_names rn
       WHERE rn.hotel_id = ANY($1::int[])
         AND NOT EXISTS (
           SELECT 1 FROM room_mapping_members m WHERE m.room_name_id = rn.id
         )
       ORDER BY rn.hotel_id, rn.source, rn.room_name`,
      [hotelIds]
    );

    const groupsByHotel = new Map<number, Map<number, any>>();
    for (const row of membersQ.rows) {
      if (!groupsByHotel.has(row.hotel_id)) groupsByHotel.set(row.hotel_id, new Map());
      const hotelGroups = groupsByHotel.get(row.hotel_id)!;
      if (!hotelGroups.has(row.group_id)) {
        hotelGroups.set(row.group_id, {
          groupId: row.group_id,
          hotelId: row.hotel_id,
          source: row.group_source,
          confidence: row.group_confidence,
          members: [],
        });
      }
      hotelGroups.get(row.group_id).members.push({
        memberId: row.member_id,
        groupId: row.group_id,
        source: row.member_source,
        roomNameId: row.room_name_id,
        roomName: row.room_name,
        memberStatus: row.member_status,
        confidence: row.member_confidence,
      });
    }

    const unmappedByHotel = new Map<number, any[]>();
    for (const row of unmappedQ.rows) {
      if (!unmappedByHotel.has(row.hotel_id)) unmappedByHotel.set(row.hotel_id, []);
      unmappedByHotel.get(row.hotel_id)!.push({
        id: row.id,
        source: row.source,
        roomName: row.room_name,
      });
    }

    const hotels = hotelsQ.rows.map((h: any) => ({
      id: h.id,
      name: h.name,
      code: h.code,
      groups: Array.from(groupsByHotel.get(h.id)?.values() ?? []),
      unmapped: unmappedByHotel.get(h.id) ?? [],
    }));

    if (hotelIdParam) {
      const h = hotels.find(h => h.id === Number(hotelIdParam));
      if (!h) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 });
      return NextResponse.json(h);
    }

    return NextResponse.json({ hotels });
  } catch (e: any) {
    console.error('[GET /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/room-mappings
// Anchor a new group on a single room_name.
// Body: { hotelId, source, roomNameId }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      hotelId, source, roomNameId,
      groupSource = 'manual',
      memberStatus = 'manual',
      confidence = null,
    } = body;

    if (!hotelId || !source || !roomNameId) {
      return NextResponse.json(
        { error: 'hotelId, source and roomNameId are required' },
        { status: 400 }
      );
    }

    // Verify the room_name belongs to this hotel/source and isn't already grouped.
    const roomNameCheck = await sql`
      SELECT id FROM room_names WHERE id = ${Number(roomNameId)} AND hotel_id = ${Number(hotelId)} AND source = ${source}
    `;
    if (roomNameCheck.rows.length === 0) {
      return NextResponse.json({ error: 'roomNameId does not belong to this hotel/source' }, { status: 400 });
    }

    const alreadyGrouped = await sql`
      SELECT group_id FROM room_mapping_members WHERE room_name_id = ${Number(roomNameId)}
    `;
    if (alreadyGrouped.rows.length > 0) {
      return NextResponse.json({ error: 'This room is already mapped elsewhere' }, { status: 409 });
    }

    const groupIns = await sql`
      INSERT INTO room_mapping_groups (hotel_id, source, confidence)
      VALUES (${Number(hotelId)}, ${groupSource}, ${confidence})
      RETURNING *
    `;
    const group = groupIns.rows[0];

    const memberIns = await sql`
      INSERT INTO room_mapping_members (group_id, room_name_id, source, member_status, confidence)
      VALUES (${group.id}, ${Number(roomNameId)}, ${source}, ${memberStatus}, ${confidence})
      RETURNING *
    `;

    return NextResponse.json({
      groupId: group.id,
      hotelId: group.hotel_id,
      source: group.source,
      confidence: group.confidence,
      members: [memberIns.rows[0]],
    }, { status: 201 });
  } catch (e: any) {
    console.error('[POST /api/room-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
