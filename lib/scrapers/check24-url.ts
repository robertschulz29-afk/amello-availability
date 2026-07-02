// Builds a Check24 hotel search URL by appending the date and adult-count
// segments after the stored per-hotel template, without touching the fixed
// hotel-name/ID slug.
//
// Stored template shape (fixed, per hotel, never regenerated):
//   https://hotel.check24.de/search/{hotel-name-and-id-slug}/
//
// Assembled URL shape:
//   https://hotel.check24.de/search/{hotel-name-and-id-slug}/{check-in}/{check-out}/[A|A|...]/hotel.html
//
// Adults are pipe-separated inside a single bracket pair — e.g. 2 adults is
// "[A|A]", not "[A][A]".
const DATE_SEGMENT_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADULTS_SEGMENT_RE = /^\[A(\|A)*\]$/;
const HOTEL_HTML_SEGMENT = 'hotel.html';

export function buildCheck24Url(
  template: string,
  checkIn: string,
  checkOut: string,
  adultCount: number,
): string {
  if (!DATE_SEGMENT_RE.test(checkIn) || !DATE_SEGMENT_RE.test(checkOut)) {
    throw new Error('Malformed check24_url: checkIn/checkOut must be YYYY-MM-DD');
  }

  const segments = template.split('/');

  // Trim a trailing empty segment (from a trailing "/").
  while (segments.length && segments[segments.length - 1] === '') segments.pop();

  // Strip a trailing "hotel.html" if already present.
  if (segments.length && segments[segments.length - 1] === HOTEL_HTML_SEGMENT) {
    segments.pop();
  }

  // Strip a trailing pre-existing adults segment if already present.
  if (segments.length && ADULTS_SEGMENT_RE.test(segments[segments.length - 1])) {
    segments.pop();
  }

  // Strip trailing pre-existing check-out/check-in date segments if present.
  // If only one of the last two segments is date-shaped, the template is in
  // an inconsistent state — fail loudly rather than silently appending new
  // dates after a stray leftover one and scraping the wrong dates.
  const lastIsDate = segments.length >= 1 && DATE_SEGMENT_RE.test(segments[segments.length - 1]);
  const secondLastIsDate = segments.length >= 2 && DATE_SEGMENT_RE.test(segments[segments.length - 2]);
  if (lastIsDate && secondLastIsDate) {
    segments.pop();
    segments.pop();
  } else if (lastIsDate !== secondLastIsDate) {
    throw new Error('Malformed check24_url: incomplete trailing date segment');
  }

  if (!segments.length) {
    throw new Error('Malformed check24_url: empty template');
  }

  const clampedAdultCount = Math.max(1, Number.isFinite(adultCount) ? Math.trunc(adultCount) : 1);
  const adultsSegment = `[${Array(clampedAdultCount).fill('A').join('|')}]`;

  return [...segments, checkIn, checkOut, adultsSegment, HOTEL_HTML_SEGMENT].join('/');
}
