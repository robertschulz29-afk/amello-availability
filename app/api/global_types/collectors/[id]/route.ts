import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    const { name, description, type_category_id } = await req.json();
    const { rows } = await query(
      `UPDATE global_type_collector
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           type_category_id = COALESCE($3, type_category_id)
       WHERE id = $4
       RETURNING id, name, description, type_category_id`,
      [name ?? null, description ?? null, type_category_id ?? null, id],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    // Unassign types before deleting
    await query(`UPDATE global_types SET group_id = NULL WHERE group_id = $1`, [id]);
    await query(`DELETE FROM global_type_collector WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
