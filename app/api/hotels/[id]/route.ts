import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UpdateHotelPayload = {
  brand?: string | null;
  region?: string | null;
  country?: string | null;
  booking_url?: string | null;
  tuiamello_url?: string | null;
  expedia_url?: string | null;
};

// Basic URL validation
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idString } = await params;
  try {
    const id = parseInt(idString, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid hotel ID' }, { status: 400 });
    }

    const body: UpdateHotelPayload = await req.json();

    // Validate URLs if provided
    const urlFields = ['booking_url', 'tuiamello_url', 'expedia_url'] as const;
    for (const field of urlFields) {
      const value = body[field];
      if (value && typeof value === 'string' && value.trim()) {
        if (!isValidUrl(value.trim())) {
          return NextResponse.json(
            { error: `Invalid URL format for ${field}` },
            { status: 400 }
          );
        }
      }
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    const fields: Array<keyof UpdateHotelPayload> = [
      'brand',
      'region',
      'country',
      'booking_url',
      'tuiamello_url',
      'expedia_url',
    ];

    for (const field of fields) {
      if (field in body) {
        const value = body[field];
        const trimmed = value && typeof value === 'string' ? value.trim() : null;
        updates.push(`${field} = $${paramIndex}`);
        values.push(trimmed || null);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Add ID as the last parameter
    values.push(String(id));

    const queryText = `
      UPDATE hotels
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, name, code, brand, region, country, booking_url, tuiamello_url, expedia_url
    `;

    const result = await query(queryText, values);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Hotel not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (e: any) {
    console.error('[PATCH /api/hotels/:id] error', e);
    return NextResponse.json(
      { error: 'Failed to update hotel' },
      { status: 500 }
    );
  }
}
