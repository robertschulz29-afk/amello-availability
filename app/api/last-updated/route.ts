import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';


export const runtime = 'nodejs';


export async function GET() {
const { rows } = await sql`SELECT value FROM meta WHERE key = 'last_updated'`;
return NextResponse.json({ lastUpdated: rows[0]?.value ?? null });
