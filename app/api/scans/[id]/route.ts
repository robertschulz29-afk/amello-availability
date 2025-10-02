// after you determine `status` and (optionally) `responseJson`
let responseJson: any = null;
try {
  // if you parsed JSON from the upstream res, store it:
  // e.g. const j = await res.json(); responseJson = j;
  // if you never parsed JSON (non-JSON or error), keep null
} catch {
  responseJson = null;
}

// persist response JSON (jsonb) together with status
try {
  await sql`
    INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json)
    VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${responseJson})
    ON CONFLICT (scan_id, hotel_id, check_in_date)
    DO UPDATE
      SET status = EXCLUDED.status,
          response_json = EXCLUDED.response_json
  `;
} catch (e) {
  console.error('[process] DB write error', e, { scanId, hotelId: cell.hotelId, checkIn: cell.checkIn });
}
