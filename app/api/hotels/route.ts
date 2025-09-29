import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';


export const runtime = 'nodejs';


export async function GET() {
const { rows } = await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`;
return NextResponse.json(rows);
}


export async function POST(req: NextRequest) {
const body = await req.json();
const items = Array.isArray(body) ? body : [body];
for (const it of items) {
if (!it?.name || !it?.code) {
return NextResponse.json({ error: 'Each item must have name and code' }, { status: 400 });
}
}
const values = items.map((i: any) => sql`(${i.name}, ${i.code})`);
await sql`
INSERT INTO hotels (name, code)
VALUES ${sql.join(values, sql`, `)}
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
`;
const { rows } = await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`;
return NextResponse.json(rows);
}


export async function DELETE(req: NextRequest) {
const { code } = await req.json();
if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });
await sql`DELETE FROM hotels WHERE code = ${code}`;
const { rows } = await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`;
return NextResponse.json(rows);
