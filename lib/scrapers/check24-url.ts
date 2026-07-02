// Builds a Check24 hotel search URL by substituting the date and adult-count
// segments of a stored template, without touching the fixed hotel-name/ID slug.
//
// Template shape:
//   https://hotel.check24.de/search/{hotel-name-and-id-slug}/{check-in}/{check-out}/{adults}/hotel.html
const DATE_SEGMENT_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADULTS_SEGMENT_RE = /^(\[A\])+$/;

export function buildCheck24Url(
  template: string,
  checkIn: string,
  checkOut: string,
  adultCount: number,
): string {
  const segments = template.split('/');

  const dateIndexes = segments.reduce<number[]>((acc, seg, i) => {
    if (DATE_SEGMENT_RE.test(seg)) acc.push(i);
    return acc;
  }, []);

  if (dateIndexes.length < 2) {
    throw new Error('Malformed check24_url: could not find check-in/check-out date segments');
  }

  const adultsIndex = segments.findIndex((seg) => ADULTS_SEGMENT_RE.test(seg));
  if (adultsIndex === -1) {
    throw new Error('Malformed check24_url: could not find adults ([A]...) segment');
  }

  const [checkInIndex, checkOutIndex] = dateIndexes;
  const clampedAdultCount = Math.max(1, Number.isFinite(adultCount) ? adultCount : 1);

  segments[checkInIndex] = checkIn;
  segments[checkOutIndex] = checkOut;
  segments[adultsIndex] = '[A]'.repeat(clampedAdultCount);

  return segments.join('/');
}
