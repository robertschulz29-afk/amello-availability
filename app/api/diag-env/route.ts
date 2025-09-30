import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mask(u?: string) {
  if (!u) return 'missing';
  try {
    const x = new URL(u);
    return { host: x.host, db: x.pathname.replace(/^\//, '') };
  } catch {
    return 'invalid';
  }
}

export async function GET() {
  // DO NOT import '@/lib/db' here—this route only inspects env
  const out = {
    DATABASE_URL: mask(process.env.DATABASE_URL),
    POSTGRES_URL: mask(process.env.POSTGRES_URL),
    PGHOST: process.env.PGHOST ?? null,
    POSTGRES_HOST: process.env.POSTGRES_HOST ?? null,
  };
  return NextResponse.json(out);
}
