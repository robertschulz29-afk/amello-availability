import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await sql`
    SELECT
      gt.global_type,
      gt.type_description,
      gt.type_category,
      gtc.global_type_category
    FROM global_types gt
    LEFT JOIN global_types_categories gtc
      ON gt.type_category::bigint = gtc.id
    WHERE gt.global_type IS NOT NULL
    ORDER BY gtc.global_type_category ASC, gt.type_description ASC, gt.global_type ASC
  `;
  return NextResponse.json(rows);
}
