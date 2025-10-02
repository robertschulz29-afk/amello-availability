// app/api/scans/route.ts (POST)
const scanIns = await sql`
  INSERT INTO scans (fixed_checkout, start_offset, end_offset, stay_nights, timezone, total_cells, done_cells, status)
  VALUES (${firstCheckout}, ${startOffset}, ${endOffset}, ${stayNights}, 'Europe/Berlin', ${hotels.length * checkIns.length}, 0, 'running')
  RETURNING id
`;
return NextResponse.json({ scanId: scanIns.rows[0].id });
