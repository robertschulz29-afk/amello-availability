import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await sql`
    SELECT global_type, type_name, type_category, group_name,
           gtc.global_type_category
    FROM global_types gt
    LEFT JOIN global_types_categories gtc ON gt.type_category::bigint = gtc.id
    WHERE gt.global_type IS NOT NULL
    ORDER BY gt.group_name ASC NULLS LAST, gt.type_name ASC
  `;
  return NextResponse.json(rows);
}

// PUT body: { assignments: { global_type: string, group_name: string | null }[] }
export async function PUT(req: NextRequest) {
  try {
    const { assignments } = await req.json();
    if (!Array.isArray(assignments)) {
      return NextResponse.json({ error: 'assignments must be an array' }, { status: 400 });
    }
    for (const { global_type, group_name } of assignments) {
      await query(
        `UPDATE global_types SET group_name = $1 WHERE global_type = $2`,
        [group_name ?? null, global_type],
      );
    }
    return NextResponse.json({ ok: true, updated: assignments.length });
  } catch (e: any) {
    console.error('[PUT /api/global_types/filter-groups] error', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
