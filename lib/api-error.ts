import { NextResponse } from 'next/server';

/**
 * Logs the error and returns a 500 JSON response.
 * Use at the bottom of every API route catch block.
 *
 * @param label  Log prefix, e.g. '[GET /api/scan-results]'
 * @param e      The caught error (unknown type)
 */
export function apiError(label: string, e: unknown): NextResponse {
  const message = e instanceof Error ? e.message : String(e);
  console.error(label, e);
  return NextResponse.json({ error: message }, { status: 500 });
}
