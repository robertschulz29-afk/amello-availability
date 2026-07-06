// app/api/room-mappings/[groupId]/members/route.ts
// Add / remove / confirm members of an existing room_mapping_group.
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/room-mappings/:groupId/members
// Body: { source, roomNameId, memberStatus? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: groupIdStr } = await params;
  try {
    const groupId = Number(groupIdStr);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'Invalid groupId' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { source, roomNameId, memberStatus = 'manual', confidence = null } = body;

    if (!source || !roomNameId) {
      return NextResponse.json({ error: 'source and roomNameId are required' }, { status: 400 });
    }

    const groupQ = await sql`SELECT * FROM room_mapping_groups WHERE id = ${groupId}`;
    if (groupQ.rows.length === 0) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    const group = groupQ.rows[0];

    const roomNameCheck = await sql`
      SELECT id FROM room_names WHERE id = ${Number(roomNameId)} AND hotel_id = ${group.hotel_id} AND source = ${source}
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

    const existingSourceMember = await sql`
      SELECT id FROM room_mapping_members WHERE group_id = ${groupId} AND source = ${source}
    `;
    if (existingSourceMember.rows.length > 0) {
      return NextResponse.json({ error: 'This group already has a member from that source' }, { status: 409 });
    }

    const memberIns = await sql`
      INSERT INTO room_mapping_members (group_id, room_name_id, source, member_status, confidence)
      VALUES (${groupId}, ${Number(roomNameId)}, ${source}, ${memberStatus}, ${confidence})
      RETURNING *
    `;

    await sql`UPDATE room_mapping_groups SET updated_at = NOW() WHERE id = ${groupId}`;

    return NextResponse.json(memberIns.rows[0], { status: 201 });
  } catch (e: any) {
    console.error('[POST /api/room-mappings/:groupId/members]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH /api/room-mappings/:groupId/members
// Confirm an AI-pending member: body { memberId } -> member_status 'ai' -> 'manual'
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: groupIdStr } = await params;
  try {
    const groupId = Number(groupIdStr);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'Invalid groupId' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { memberId } = body;
    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }

    const result = await sql`
      UPDATE room_mapping_members
      SET member_status = 'manual'
      WHERE id = ${Number(memberId)} AND group_id = ${groupId}
      RETURNING *
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found in this group' }, { status: 404 });
    }

    await sql`UPDATE room_mapping_groups SET updated_at = NOW() WHERE id = ${groupId}`;

    return NextResponse.json(result.rows[0]);
  } catch (e: any) {
    console.error('[PATCH /api/room-mappings/:groupId/members]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/room-mappings/:groupId/members?memberId=123
// Removes a single member (used for both "unlink" and "reject AI suggestion").
// If this was the last member of the group, the group itself is deleted.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: groupIdStr } = await params;
  try {
    const groupId = Number(groupIdStr);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'Invalid groupId' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get('memberId');
    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }

    const deleted = await sql`
      DELETE FROM room_mapping_members
      WHERE id = ${Number(memberId)} AND group_id = ${groupId}
      RETURNING id
    `;
    if (deleted.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found in this group' }, { status: 404 });
    }

    const remaining = await sql`
      SELECT COUNT(*)::int AS count FROM room_mapping_members WHERE group_id = ${groupId}
    `;

    let groupDeleted = false;
    if (remaining.rows[0].count === 0) {
      await sql`DELETE FROM room_mapping_groups WHERE id = ${groupId}`;
      groupDeleted = true;
    } else {
      await sql`UPDATE room_mapping_groups SET updated_at = NOW() WHERE id = ${groupId}`;
    }

    return NextResponse.json({ ok: true, groupDeleted });
  } catch (e: any) {
    console.error('[DELETE /api/room-mappings/:groupId/members]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
