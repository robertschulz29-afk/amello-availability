import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT body: { assignments: { global_type: string, collector_id: number | null }[] }
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
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
