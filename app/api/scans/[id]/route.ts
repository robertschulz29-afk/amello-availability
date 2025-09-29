import { NextRequest, NextResponse } from 'next/server';
const { rows } = await sql`SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone FROM scans ORDER BY scanned_at DESC`;
return NextResponse.json(rows);
}


// POST /api/scans → perform a new scan and persist results
export async function POST(req: NextRequest) {
const { startOffset = 5, endOffset = 90 } = await req.json().catch(() => ({}));
const scanAnchor = new Date();
const checkInDates = datesBerlin(startOffset, endOffset, scanAnchor);
const fixedCheckout = datesBerlin(12, 12, scanAnchor)[0];


const scanIns = await sql`
INSERT INTO scans (fixed_checkout, start_offset, end_offset, timezone)
VALUES (${fixedCheckout}, ${startOffset}, ${endOffset}, 'Europe/Berlin')
RETURNING id, scanned_at
`;
const scan = scanIns.rows[0] as { id: number; scanned_at: string };


const hotels = (await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`).rows as Array<{ id: number; name: string; code: string; }>;
const limit = pLimit(10);


const results: Record<string, Record<string, 'green' | 'red'>> = {};
const inserts: Array<Promise<any>> = [];


for (const h of hotels) {
results[h.code] = {};
for (const checkIn of checkInDates) {
const payload = {
hotelId: h.code,
departureDate: checkIn, // upstream expects this field; it's our check-in
returnDate: fixedCheckout,
currency: 'EUR',
roomConfigurations: [ { travellers: { id: 1, adultCount: 1, childrenAges: [] } } ],
locale: 'de_DE'
};


inserts.push(limit(async () => {
let status: 'green' | 'red' = 'red';
try {
const res = await fetch(`${BASE_URL}/hotel/offer`, {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload), cache: 'no-store'
});
if (res.status === 200) {
const text = (await res.text()).trim();
if (text.startsWith('data')) status = 'green';
else {
try { const j = JSON.parse(text); if (Object.prototype.hasOwnProperty.call(j, 'data')) status = 'green'; } catch {}
}
}
} catch {}
results[h.code][checkIn] = status;
await sql`INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status)
VALUES (${scan.id}, ${h.id}, ${checkIn}, ${status})
ON CONFLICT (scan_id, hotel_id, check_in_date) DO UPDATE SET status = EXCLUDED.status`;
}))
}
}


await Promise.all(inserts);


const lastUpdated = new Date().toISOString();
await sql`INSERT INTO meta(key, value) VALUES('last_updated', ${lastUpdated})
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;


return NextResponse.json({ scanId: scan.id, dates: checkInDates, results, scannedAt: scan.scanned_at });
}
