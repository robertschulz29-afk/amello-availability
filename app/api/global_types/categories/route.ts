import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await sql`
    SELECT id, global_type_category FROM global_types_categories ORDER BY global_type_category ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const { rows } = await query(
      `INSERT INTO global_types_categories (global_type_category) VALUES ($1) RETURNING id, global_type_category`,
      [name.trim()],
    );
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
