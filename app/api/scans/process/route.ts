// app/api/scans/process/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const { scanId, startIndex = 0, size = 50 } = await req.json();

  // Load hotels + dates for that scan (same generator logic you already have)
  // Build the flat list of {hotelId, hotelCode, checkIn, checkOut}
  // slice = work.slice(startIndex, startIndex + size)

  // p-limit concurrency to ~5–10
  // For each cell → call upstream → compute green/red → UPSERT into scan_results
  // Count successes and update scans.done_cells += processed

  // Return { processed, nextIndex: startIndex + size, done: nextIndex >= total_cells }
}
