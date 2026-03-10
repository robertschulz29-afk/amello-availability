// app/api/room-mappings/suggest/route.ts
// Uses Claude to suggest room name mappings between Amello and Booking.com.
// Only suggests — never saves automatically. Frontend confirms before saving.
// Never overwrites existing manual mappings.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIDENCE_THRESHOLD = 0.75; // Below this → skip, highlight for manual review

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const hotelId = Number(body?.hotelId);

    if (!hotelId || !Number.isFinite(hotelId)) {
      return NextResponse.json({ error: 'hotelId is required' }, { status: 400 });
    }

    // Load existing mappings (manual or AI) so we don't re-suggest already-mapped rooms
    const existingMappings = await sql`
      SELECT amello_room, booking_room, source
      FROM room_mappings
      WHERE hotel_id = ${hotelId}
    `;
    const alreadyMapped = new Set(
      existingMappings.rows.map((r: any) => r.amello_room)
    );

    // Load available room names from scan_results
    const amelloRoomsQ = await sql`
      SELECT DISTINCT elem->>'name' AS room_name
      FROM scan_results sr,
           jsonb_array_elements(sr.response_json->'rooms') AS elem
      WHERE sr.hotel_id = ${hotelId}
        AND sr.source   = 'amello'
        AND sr.status   = 'green'
        AND elem->>'name' IS NOT NULL
      ORDER BY room_name
    `;

    const bookingRoomsQ = await sql`
      SELECT DISTINCT elem->>'name' AS room_name
      FROM scan_results sr,
           jsonb_array_elements(sr.response_json->'rooms') AS elem
      WHERE sr.hotel_id = ${hotelId}
        AND sr.source   = 'booking'
        AND sr.status   = 'green'
        AND elem->>'name' IS NOT NULL
      ORDER BY room_name
    `;

    const amelloRooms: string[] = amelloRoomsQ.rows.map((r: any) => r.room_name);
    const bookingRooms: string[] = bookingRoomsQ.rows.map((r: any) => r.room_name);

    if (!amelloRooms.length || !bookingRooms.length) {
      return NextResponse.json({
        suggestions: [],
        skipped: [],
        message: 'Not enough room data to make suggestions. Run a scan first.',
      });
    }

    // Filter out Amello rooms that already have any mapping (manual or AI)
    const unmappedAmelloRooms = amelloRooms.filter(r => !alreadyMapped.has(r));

    if (!unmappedAmelloRooms.length) {
      return NextResponse.json({
        suggestions: [],
        skipped: [],
        message: 'All Amello rooms already have mappings.',
      });
    }

    // Call Claude API
    const prompt = `You are a hotel room name matching assistant. Your job is to match room names from two different booking systems for the same hotel.

Amello room names (internal system):
${unmappedAmelloRooms.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Booking.com room names:
${bookingRooms.map((r, i) => `${i + 1}. ${r}`).join('\n')}

For each Amello room name, find the best matching Booking.com room name. Room names may be in different languages (German, Spanish, English) but describe the same room type.

Rules:
- Only match rooms that genuinely refer to the same room type
- A Booking.com room can be matched to multiple Amello rooms if appropriate
- If no good match exists for an Amello room, set confidence to 0
- confidence is a float between 0 and 1

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {
    "amello_room": "exact amello room name",
    "booking_room": "exact booking.com room name",
    "confidence": 0.95,
    "reasoning": "brief explanation"
  }
]`;

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!apiResponse.ok) {
      const err = await apiResponse.text().catch(() => '');
      throw new Error(`Claude API error ${apiResponse.status}: ${err.slice(0, 200)}`);
    }

    const apiData = await apiResponse.json();
    const rawText = apiData.content
      ?.filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('') ?? '';

    // Parse JSON from response
    let allSuggestions: Array<{
      amello_room: string;
      booking_room: string;
      confidence: number;
      reasoning: string;
    }> = [];

    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      allSuggestions = JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Validate that room names actually exist in our lists
    const amelloSet = new Set(amelloRooms);
    const bookingSet = new Set(bookingRooms);

    const validated = allSuggestions.filter(s =>
      amelloSet.has(s.amello_room) &&
      bookingSet.has(s.booking_room) &&
      typeof s.confidence === 'number'
    );

    // Split into confident (save-ready) and low-confidence (needs review)
    const suggestions = validated.filter(s => s.confidence >= CONFIDENCE_THRESHOLD);
    const skipped = validated.filter(s => s.confidence < CONFIDENCE_THRESHOLD && s.confidence > 0);

    console.log(`[suggest] Hotel ${hotelId}: ${suggestions.length} confident, ${skipped.length} low-confidence, ${allSuggestions.length - validated.length} invalid`);

    return NextResponse.json({ suggestions, skipped, threshold: CONFIDENCE_THRESHOLD });

  } catch (e: any) {
    console.error('[POST /api/room-mappings/suggest]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
