import { buildCheck24Url } from '@/lib/scrapers/check24-url';

// Actual stored template shape in the DB — just the hotel slug + trailing slash.
const BASE_TEMPLATE =
  'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/';

describe('buildCheck24Url', () => {
  it('assembles dates and a 2-adult token after the hotel slug', () => {
    const url = buildCheck24Url(BASE_TEMPLATE, '2026-07-24', '2026-07-31', 2);
    expect(url).toBe(
      'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/2026-07-24/2026-07-31/[A|A]/hotel.html',
    );
  });

  it('supports a template without a trailing slash', () => {
    const noSlash = BASE_TEMPLATE.slice(0, -1);
    const url = buildCheck24Url(noSlash, '2026-07-24', '2026-07-31', 2);
    expect(url).toBe(
      'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/2026-07-24/2026-07-31/[A|A]/hotel.html',
    );
  });

  it('supports 3 adults using pipe-separated tokens', () => {
    const url = buildCheck24Url(BASE_TEMPLATE, '2026-07-24', '2026-07-31', 3);
    expect(url).toContain('/[A|A|A]/hotel.html');
  });

  it('supports 1 adult', () => {
    const url = buildCheck24Url(BASE_TEMPLATE, '2026-07-24', '2026-07-31', 1);
    expect(url).toContain('/[A]/hotel.html');
  });

  it('clamps adultCount to a minimum of 1', () => {
    const url = buildCheck24Url(BASE_TEMPLATE, '2026-07-24', '2026-07-31', 0);
    expect(url).toContain('/[A]/hotel.html');
  });

  it('is idempotent when the template already has dates/adults/hotel.html appended', () => {
    const alreadyBuilt =
      'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/2026-01-01/2026-01-08/[A|A]/hotel.html';
    const url = buildCheck24Url(alreadyBuilt, '2026-07-24', '2026-07-31', 2);
    expect(url).toBe(
      'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/2026-07-24/2026-07-31/[A|A]/hotel.html',
    );
  });

  it('throws on invalid checkIn/checkOut format', () => {
    expect(() => buildCheck24Url(BASE_TEMPLATE, 'not-a-date', '2026-07-31', 2)).toThrow();
  });

  it('throws on an empty template', () => {
    expect(() => buildCheck24Url('', '2026-07-24', '2026-07-31', 2)).toThrow();
  });

  it('throws on a template with an incomplete trailing date pair', () => {
    const partial = `${BASE_TEMPLATE}2026-01-01`;
    expect(() => buildCheck24Url(partial, '2026-07-24', '2026-07-31', 2)).toThrow();
  });
});
