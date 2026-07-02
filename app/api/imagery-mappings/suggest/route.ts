// app/api/imagery-mappings/suggest/route.ts
// Uses Claude to suggest imagery room mappings for scan rooms.
// Only suggests — never saves automatically. Frontend confirms before saving.
// Never overwrites existing mappings (any source).

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIDENCE_THRESHOLD = 0.75; // Below this → skipped, highlighted for manual review

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const hotelId = Number(body?.hotelId);

    if (!hotelId || !Number.isFinite(hotelId)) {
      return NextResponse.json({ error: 'hotelId is required' }, { status: 400 });
    }

    // Load existing mappings so we skip already-mapped scan rooms
    const existingMappings = await sql`
      SELECT scan_room_name
      FROM imagery_mappings
      WHERE hotel_id = ${hotelId}
    `;
    const alreadyMapped = new Set(existingMappings.rows.map((r: any) => r.scan_room_name));

    // Scan rooms from actual price scan responses (same source as room-mappings/suggest)
    const scanRoomsQ = await sql`
      SELECT DISTINCT elem->>'name' AS room_name
      FROM scan_results sr,
           jsonb_array_elements(sr.response_json->'rooms') AS elem
      WHERE sr.hotel_id = ${hotelId}
        AND sr.source   = 'amello'
        AND sr.status   = 'green'
        AND elem->>'name' IS NOT NULL
      ORDER BY room_name
    `;

    // Imagery rooms from cr_api_rooms
    const imageryRoomsQ = await sql`
      SELECT name AS room_name
      FROM cr_api_rooms
      WHERE hotel_id = ${hotelId}
      ORDER BY name
    `;

    const scanRooms: string[] = scanRoomsQ.rows.map((r: any) => r.room_name);
    const imageryRooms: string[] = imageryRoomsQ.rows.map((r: any) => r.room_name);

    if (!scanRooms.length || !imageryRooms.length) {
      return NextResponse.json({
        suggestions: [],
        skipped: [],
        message: 'Not enough room data to make suggestions. Run a scan or hotel sync first.',
      });
    }

    // Filter out scan rooms that already have any mapping
    const unmappedScanRooms = scanRooms.filter(r => !alreadyMapped.has(r));

    if (!unmappedScanRooms.length) {
      return NextResponse.json({
        suggestions: [],
        skipped: [],
        message: 'All scan rooms already have imagery mappings.',
      });
    }

    // Call Claude API
    const prompt = `You are a hotel room name matching assistant. Your job is to match hotel room names across two systems for the same hotel.

IMPORTANT: The scan names are in ENGLISH. The TUI imagery names are in GERMAN. You must match across languages by room type and attributes, not by literal string similarity.

Common translations to guide you:
- Suite = Suite
- Junior Suite = Junior Suite
- Superior = Superior / Deluxe
- Executive = Executive / Premium
- Ocean View / Sea View = Meerblick / Seeblick
- Garden View = Gartenblick
- Pool View = Poolblick
- Private Pool = Privater Pool / Eigenem Pool
- Whirlpool / Jacuzzi = Whirlpool / Jacuzzi
- Family = Familie / Familien
- Bedroom = Schlafzimmer
- King = King / Kingsize
- Two Bedroom = Zwei Schlafzimmer / 2-Schlafzimmer
- Promotion = Promotion / Aktions

Scan room names (English, from price scan):
${unmappedScanRooms.map((r, i) => `${i + 1}. ${r}`).join('\n')}

TUI imagery room names (German, from hotel content):
${imageryRooms.map((r, i) => `${i + 1}. ${r}`).join('\n')}

For each scan room, find the best matching TUI imagery room based on room type, category, view, and features — ignoring language differences.

Rules:
- Match by room concept, not by string similarity — these are translations of the same rooms
- A TUI imagery room can match multiple scan rooms if appropriate
- Set confidence to 0 if genuinely no match exists
- confidence is a float between 0 and 1
- Prefer higher confidence when the key attributes (room type + view + special features) all align

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {
    "scan_room": "exact scan room name from the list above",
    "imagery_room": "exact TUI imagery room name from the list above",
    "confidence": 0.95,
    "reasoning": "brief explanation of why these match across languages"
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
      scan_room: string;
      imagery_room: string;
      confidence: number;
      reasoning: string;
    }> = [];

    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      allSuggestions = JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Validate that room names exist in our lists
    const scanSet = new Set(scanRooms);
    const imagerySet = new Set(imageryRooms);

    const validated = allSuggestions.filter(s =>
      scanSet.has(s.scan_room) &&
      imagerySet.has(s.imagery_room) &&
      typeof s.confidence === 'number'
    );

    // Split into confident (save-ready) and low-confidence (needs review)
    const suggestions = validated.filter(s => s.confidence >= CONFIDENCE_THRESHOLD);
    const skipped = validated.filter(s => s.confidence < CONFIDENCE_THRESHOLD && s.confidence > 0);

    console.log(`[imagery-suggest] Hotel ${hotelId}: ${suggestions.length} confident, ${skipped.length} low-confidence, ${allSuggestions.length - validated.length} invalid`);

    return NextResponse.json({ suggestions, skipped, threshold: CONFIDENCE_THRESHOLD });

  } catch (e: any) {
    console.error('[POST /api/imagery-mappings/suggest]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
