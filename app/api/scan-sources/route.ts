// app/api/scan-sources/route.ts
// API endpoints for managing scan sources (Booking.com, Expedia, etc.)

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { ScanSource } from '@/lib/scrapers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/scan-sources
 * List all scan sources
 */
export async function GET() {
  try {
    const { rows } = await sql<ScanSource>`
      SELECT 
        id,
        name,
        enabled,
        base_url,
        css_selectors,
        rate_limit_ms,
        user_agent_rotation,
        created_at,
        updated_at
      FROM scan_sources
      ORDER BY name ASC
    `;

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error('[GET /api/scan-sources] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scan sources' },
      { status: 500 }
    );
  }
}




export async function GET(req: NextRequest) {
  return POST(req);
}
/**
 * POST /api/scan-sources
 * Create or update a scan source
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required and must be a string' },
        { status: 400 }
      );
    }

    const name = body.name.trim();
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : true;
    const baseUrl = body.base_url || body.baseUrl || null;
    const cssSelectors = body.css_selectors || body.cssSelectors || null;
    const rateLimitMs = Number.isFinite(body.rate_limit_ms) 
      ? body.rate_limit_ms 
      : (Number.isFinite(body.rateLimitMs) ? body.rateLimitMs : 2000);
    const userAgentRotation = body.user_agent_rotation !== undefined
      ? Boolean(body.user_agent_rotation)
      : (body.userAgentRotation !== undefined ? Boolean(body.userAgentRotation) : true);

    // Validate CSS selectors if provided
    if (cssSelectors !== null && typeof cssSelectors !== 'object') {
      return NextResponse.json(
        { error: 'css_selectors must be an object or null' },
        { status: 400 }
      );
    }

    // Upsert the scan source
    const { rows } = await sql<ScanSource>`
      INSERT INTO scan_sources (
        name,
        enabled,
        base_url,
        css_selectors,
        rate_limit_ms,
        user_agent_rotation
      )
      VALUES (
        ${name},
        ${enabled},
        ${baseUrl},
        ${cssSelectors},
        ${rateLimitMs},
        ${userAgentRotation}
      )
      ON CONFLICT (name)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        base_url = EXCLUDED.base_url,
        css_selectors = EXCLUDED.css_selectors,
        rate_limit_ms = EXCLUDED.rate_limit_ms,
        user_agent_rotation = EXCLUDED.user_agent_rotation,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return NextResponse.json(rows[0]);
  } catch (error: any) {
    console.error('[POST /api/scan-sources] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save scan source' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/scan-sources
 * Update multiple scan sources (bulk enable/disable)
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    if (!Array.isArray(body.sources)) {
      return NextResponse.json(
        { error: 'sources array is required' },
        { status: 400 }
      );
    }

    // Update each source
    for (const source of body.sources) {
      if (!source.id) continue;

      await sql`
        UPDATE scan_sources
        SET 
          enabled = ${source.enabled !== undefined ? Boolean(source.enabled) : true},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${source.id}
      `;
    }

    // Return updated sources
    const { rows } = await sql<ScanSource>`
      SELECT * FROM scan_sources ORDER BY name ASC
    `;

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error('[PATCH /api/scan-sources] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update scan sources' },
      { status: 500 }
    );
  }
}
