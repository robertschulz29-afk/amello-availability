import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await sql`
    SELECT
      gt.global_type,
      gc.id   AS collector_id,
      gc.name AS collector_name,
      gtc.global_type_category
    FROM global_types gt
    LEFT JOIN global_type_collector gc  ON gt.group_id = gc.id
    LEFT JOIN global_types_categories gtc ON gc.type_category_id = gtc.id
    WHERE gt.global_type IS NOT NULL
    ORDER BY gtc.global_type_category ASC NULLS LAST,
             gc.name ASC NULLS LAST,
             gt.global_type ASC
  `;
  return NextResponse.json(rows);
}
