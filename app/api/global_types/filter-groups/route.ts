import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: returns global types with their collector and category context
// (rewritten to use current schema — collector-based, not the dropped columns)
export async function GET() {
  const { rows } = await sql`
    SELECT
      gt.global_type,
      gc.id   AS collector_id,
      gc.name AS collector_name,
      gtc.global_type_category
    FROM global_types gt
    LEFT JOIN global_type_collector gc ON gt.group_id = gc.id
    LEFT JOIN global_types_categories gtc ON gc.type_category_id = gtc.id
    WHERE gt.global_type IS NOT NULL
    ORDER BY gtc.global_type_category ASC NULLS LAST,
             gc.name ASC NULLS LAST,
             gt.global_type ASC
  `;
  return NextResponse.json(rows);
}

// PUT body: { assignments: { global_type: string, collector_id: number | null }[] }
// Assigns global types to collectors (replaces the old group_name-based approach)
export async function PUT(req: NextRequest) {
  try {
    const { assignments } = await req.json();
    if (!Array.isArray(assignments)) {
      return NextResponse.json({ error: 'assignments must be an array' }, { status: 400 });
    }
    for (const { global_type, collector_id } of assignments) {
      await query(
        `UPDATE global_types SET group_id = $1 WHERE global_type = $2`,
        [collector_id ?? null, global_type],
      );
    }
    return NextResponse.json({ ok: true, updated: assignments.length });
  } catch (e: any) {
    console.error('[PUT /api/global_types/filter-groups] error', e);
    return NextResponse.json({ error: 'Failed to update assignments' }, { status: 500 });
  }
}
