// app/api/room-mappings/suggest/route.ts
// Uses Claude to suggest room name mappings between ALL pairs of scan sources
// that have unmapped room_names for a given hotel (generalized from the old
// hardcoded amello/booking pair). Only suggests — never saves automatically.
// Frontend confirms before saving (via the group/member CRUD endpoints).
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIDENCE_THRESHOLD = 0.75; // Below this → skip, highlight for manual review

type RoomNameRow = { id: number; source: string; room_name: string };

async function suggestForPair(
  sourceA: string,
  roomsA: RoomNameRow[],
  sourceB: string,
  roomsB: RoomNameRow[]
) {
  const prompt = `You are a hotel room name matching assistant. Your job is to match room names from two different booking systems for the same hotel.

${sourceA} room names:
${roomsA.map((r, i) => `${i + 1}. ${r.room_name}`).join('\n')}

${sourceB} room names:
${roomsB.map((r, i) => `${i + 1}. ${r.room_name}`).join('\n')}

For each ${sourceA} room name, find the best matching ${sourceB} room name. Room names may be in different languages (German, Spanish, English) but describe the same room type.

Rules:
- Only match rooms that genuinely refer to the same room type
- A ${sourceB} room can be matched to multiple ${sourceA} rooms if appropriate
- If no good match exists for a ${sourceA} room, set confidence to 0
- confidence is a float between 0 and 1

Respond ONLY with a JSON array, no markdown, no explanation:
[
  {
    "a_room": "exact ${sourceA} room name",
    "b_room": "exact ${sourceB} room name",
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

  let raw: Array<{ a_room: string; b_room: string; confidence: number; reasoning: string }> = [];
  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error('Failed to parse Claude response as JSON');
  }

  const roomsAByName = new Map(roomsA.map(r => [r.room_name, r]));
  const roomsBByName = new Map(roomsB.map(r => [r.room_name, r]));

  const validated = raw.filter(s =>
    roomsAByName.has(s.a_room) &&
    roomsBByName.has(s.b_room) &&
    typeof s.confidence === 'number'
  ).map(s => ({
    sourceA,
    sourceB,
    roomNameIdA: roomsAByName.get(s.a_room)!.id,
    roomNameA: s.a_room,
    roomNameIdB: roomsBByName.get(s.b_room)!.id,
    roomNameB: s.b_room,
    confidence: s.confidence,
    reasoning: s.reasoning,
  }));

  return {
    suggestions: validated.filter(s => s.confidence >= CONFIDENCE_THRESHOLD),
    skipped: validated.filter(s => s.confidence < CONFIDENCE_THRESHOLD && s.confidence > 0),
  };
}

// POST /api/room-mappings/suggest
// Body: { hotelId }
// Iterates every pair of sources that both have unmapped room_names for this
// hotel and asks Claude to propose matches for each pair.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const hotelId = Number(body?.hotelId);

    if (!hotelId || !Number.isFinite(hotelId)) {
      return NextResponse.json({ error: 'hotelId is required' }, { status: 400 });
    }

    // Unmapped room_names (not currently claimed by any group), grouped by source.
    const unmappedQ = await sql<RoomNameRow>`
      SELECT rn.id, rn.source, rn.room_name
      FROM room_names rn
      WHERE rn.hotel_id = ${hotelId}
        AND NOT EXISTS (
          SELECT 1 FROM room_mapping_members m WHERE m.room_name_id = rn.id
        )
      ORDER BY rn.source, rn.room_name
    `;

    const bySource = new Map<string, RoomNameRow[]>();
    for (const row of unmappedQ.rows) {
      if (!bySource.has(row.source)) bySource.set(row.source, []);
      bySource.get(row.source)!.push(row);
    }

    const sources = Array.from(bySource.keys());
    if (sources.length < 2) {
      return NextResponse.json({
        suggestions: [],
        skipped: [],
        message: 'Not enough unmapped room data across sources to make suggestions.',
      });
    }

    const suggestions: any[] = [];
    const skipped: any[] = [];

    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const sourceA = sources[i];
        const sourceB = sources[j];
        const roomsA = bySource.get(sourceA)!;
        const roomsB = bySource.get(sourceB)!;
        if (!roomsA.length || !roomsB.length) continue;

        try {
          const result = await suggestForPair(sourceA, roomsA, sourceB, roomsB);
          suggestions.push(...result.suggestions);
          skipped.push(...result.skipped);
        } catch (e: any) {
          console.error(`[suggest] pair ${sourceA}/${sourceB} failed:`, e.message);
          // Continue with other pairs rather than failing the whole request.
        }
      }
    }

    console.log(`[suggest] Hotel ${hotelId}: ${suggestions.length} confident, ${skipped.length} low-confidence across ${sources.length} sources`);

    return NextResponse.json({ suggestions, skipped, threshold: CONFIDENCE_THRESHOLD });

  } catch (e: any) {
    console.error('[POST /api/room-mappings/suggest]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
