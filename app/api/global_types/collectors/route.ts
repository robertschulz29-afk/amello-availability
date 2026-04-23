import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Return all collectors with their assigned global types + unassigned types
  const { rows: collectors } = await sql`
    SELECT
      gc.id,
      gc.name,
      gc.description,
      gc.type_category_id,
      gtc.global_type_category,
      COALESCE(
        jsonb_agg(
          jsonb_build_object('global_type', gt.global_type)
          ORDER BY gt.global_type
        ) FILTER (WHERE gt.global_type IS NOT NULL),
        '[]'::jsonb
      ) AS types
    FROM global_type_collector gc
    LEFT JOIN global_types_categories gtc ON gc.type_category_id = gtc.id
    LEFT JOIN global_types gt ON gt.group_id = gc.id
    GROUP BY gc.id, gc.name, gc.description, gc.type_category_id, gtc.global_type_category
    ORDER BY gtc.global_type_category ASC NULLS LAST, gc.name ASC
  `;

  const { rows: unassigned } = await sql`
    SELECT global_type, global_type_label
    FROM global_types
    WHERE group_id IS NULL
    ORDER BY global_type ASC
  `;

  const { rows: categories } = await sql`
    SELECT id, global_type_category FROM global_types_categories ORDER BY global_type_category ASC
  `;

  return NextResponse.json({ collectors, unassigned, categories });
}

// POST: create a new collector
export async function POST(req: NextRequest) {
  try {
    const { name, description, type_category_id } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const { rows } = await query(
      `INSERT INTO global_type_collector (name, description, type_category_id)
       VALUES ($1, $2, $3) RETURNING id, name, description, type_category_id`,
      [name.trim(), description ?? null, type_category_id ?? null],
    );
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
