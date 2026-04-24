import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    const body = await req.json();
    const setClauses: string[] = [];
    const values: any[] = [];

    if ('name' in body && body.name?.trim()) {
      values.push(body.name.trim());
      setClauses.push(`name = $${values.length}`);
    }
    if ('description' in body) {
      values.push(body.description ?? null);
      setClauses.push(`description = $${values.length}`);
    }
    if ('type_category_id' in body) {
      values.push(body.type_category_id ?? null);
      setClauses.push(`type_category_id = $${values.length}`);
    }

    if (setClauses.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    values.push(id);
    const { rows } = await query(
      `UPDATE global_type_collector SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING id, name, description, type_category_id`,
      values,
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
