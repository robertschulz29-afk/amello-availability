import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/app-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  const value = await getSetting(key);
  return NextResponse.json({ key, value });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { key, value } = body;
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  await setSetting(key, value ?? null);
  return NextResponse.json({ ok: true });
}
