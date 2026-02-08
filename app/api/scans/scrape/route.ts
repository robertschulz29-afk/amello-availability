// app/api/scans/scrape/route.ts
// API endpoint to trigger web scraping for selected sources

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { ScanSource, ScanResultExtended } from '@/lib/scrapers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/scans/scrape
 * Trigger scraping for selected sources
 * 
 * Body:
 * {
 *   scanId: number,
 *   sourceIds: number[], // Array of scan_source IDs to use
 *   hotelIds?: number[], // Optional: specific hotels to scrape (defaults to all)
 *   startIndex?: number, // For pagination
 *   size?: number // Batch size
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    
    const scanId = Number(body?.scanId);
    const sourceIds: number[] = Array.isArray(body?.sourceIds) ? body.sourceIds : [];
    const hotelIds: number[] = Array.isArray(body?.hotelIds) ? body.hotelIds : [];
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(50, Number.isFinite(body?.size) ? Number(body.size) : 10));

    // Validate scanId
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json(
        { error: 'Valid scanId is required' },
        { status: 400 }
      );
    }

    // Validate sourceIds
    if (sourceIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one sourceId is required' },
        { status: 400 }
      );
    }

    // Load scan parameters
    const scanResult = await sql`
      SELECT 
        id, 
        base_checkin, 
        days, 
        stay_nights, 
        status
      FROM scans 
      WHERE id = ${scanId}
    `;

    if (scanResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Scan not found' },
        { status: 404 }
      );
    }

    const scan = scanResult.rows[0] as any;
    const baseCheckIn = scan.base_checkin;
    const days = Number(scan.days);
    const stayNights = Number(scan.stay_nights);

    // Validate scan parameters
    if (!baseCheckIn || !Number.isFinite(days) || days <= 0) {
      return NextResponse.json(
        { error: 'Invalid scan parameters' },
        { status: 400 }
      );
    }

    // Load enabled sources
    // Fetch all enabled sources first, then filter in JavaScript
    const allSourcesQuery = await sql<ScanSource>`
      SELECT * FROM scan_sources
      WHERE enabled = true
      ORDER BY id ASC
    `;
    
    const sources = allSourcesQuery.rows.filter(s => sourceIds.includes(s.id));
    if (sources.length === 0) {
      return NextResponse.json(
        { error: 'No enabled sources found with provided IDs' },
        { status: 400 }
      );
    }

    // Load hotels
    let hotels;
    if (hotelIds.length > 0) {
      // Fetch all hotels and filter in JavaScript
      const allHotelsQuery = await sql`
        SELECT id, code, name 
        FROM hotels 
        ORDER BY id ASC
      `;
      hotels = allHotelsQuery.rows.filter((h: any) => hotelIds.includes(h.id));
    } else {
      const hotelsQuery = await sql`
        SELECT id, code, name 
        FROM hotels 
        ORDER BY id ASC
      `;
      hotels = hotelsQuery.rows;
    }

    if (hotels.length === 0) {
      return NextResponse.json(
        { error: 'No hotels found' },
        { status: 400 }
      );
    }

    // Generate dates array
    const dates: string[] = [];
    const baseDate = new Date(baseCheckIn);
    for (let i = 0; i < days; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }

    // Calculate checkout date
    const calculateCheckout = (checkIn: string): string => {
      const date = new Date(checkIn);
      date.setDate(date.getDate() + stayNights);
      return date.toISOString().split('T')[0];
    };

    // Create work items (hotel x date x source combinations)
    type WorkItem = {
      hotelId: number;
      hotelCode: string;
      hotelName: string;
      sourceId: number;
      sourceName: string;
      checkIn: string;
      checkOut: string;
    };

    const allWorkItems: WorkItem[] = [];
    for (const hotel of hotels) {
      for (const date of dates) {
        for (const source of sources) {
          allWorkItems.push({
            hotelId: hotel.id,
            hotelCode: hotel.code,
            hotelName: hotel.name,
            sourceId: source.id,
            sourceName: source.name,
            checkIn: date,
            checkOut: calculateCheckout(date),
          });
        }
      }
    }

    // Slice work items for this batch
    const total = allWorkItems.length;
    const endIndex = Math.min(total, startIndex + size);
    const batch = allWorkItems.slice(startIndex, endIndex);

    // Process batch (framework only - actual scraping would happen here)
    // For now, just insert placeholder results
    let processed = 0;
    let failures = 0;

    for (const item of batch) {
      try {
        // Placeholder: In a real implementation, you would:
        // 1. Create a scraper instance for the source
        // 2. Call scraper.scrape({ hotelCode, checkInDate, checkOutDate, ... })
        // 3. Store the result in scan_results_extended
        
        const result: ScanResultExtended = {
          scan_id: scanId,
          hotel_id: item.hotelId,
          source_id: item.sourceId,
          check_in_date: item.checkIn,
          check_out_date: item.checkOut,
          status: 'pending', // Would be 'green', 'red', or 'error' from actual scraping
          scraped_data: {
            placeholder: true,
            message: 'Scraping infrastructure ready. Implement source-specific scrapers.',
            source: item.sourceName,
            hotel: item.hotelName,
          },
        };

        // Insert result into database
        await sql`
          INSERT INTO scan_results_extended (
            scan_id,
            hotel_id,
            source_id,
            check_in_date,
            check_out_date,
            status,
            scraped_data
          )
          VALUES (
            ${result.scan_id},
            ${result.hotel_id},
            ${result.source_id},
            ${result.check_in_date},
            ${result.check_out_date || null},
            ${result.status},
            ${result.scraped_data}
          )
          ON CONFLICT (scan_id, hotel_id, source_id, check_in_date)
          DO UPDATE SET
            check_out_date = EXCLUDED.check_out_date,
            status = EXCLUDED.status,
            scraped_data = EXCLUDED.scraped_data,
            scraped_at = CURRENT_TIMESTAMP
        `;

        processed++;
      } catch (error: any) {
        console.error('[scrape] Error processing item:', error, item);
        failures++;
      }
    }

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    return NextResponse.json({
      processed,
      failures,
      nextIndex,
      done,
      total,
      batchSize: batch.length,
      sources: sources.map(s => ({ id: s.id, name: s.name })),
      message: 'Scraping infrastructure ready. Placeholder results inserted.',
    });
  } catch (error: any) {
    console.error('[POST /api/scans/scrape] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Scraping failed' },
      { status: 500 }
    );
  }
}
