import { buildCheck24Url } from '@/lib/scrapers/check24-url';

const TEMPLATE =
  'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/2026-07-24/2026-07-31/[A][A]/hotel.html';

describe('buildCheck24Url', () => {
  it('substitutes dates and 2-adult token without touching the hotel slug', () => {
    const url = buildCheck24Url(TEMPLATE, '2026-08-01', '2026-08-08', 2);
    expect(url).toBe(
      'https://hotel.check24.de/search/Robinson%20Sarigerme%20Park%20-%20All%20Inclusive-8509304/2026-08-01/2026-08-08/[A][A]/hotel.html',
    );
  });

  it('supports 3 adults', () => {
    const url = buildCheck24Url(TEMPLATE, '2026-08-01', '2026-08-08', 3);
    expect(url).toContain('/[A][A][A]/hotel.html');
  });

  it('clamps adultCount to a minimum of 1', () => {
    const url = buildCheck24Url(TEMPLATE, '2026-08-01', '2026-08-08', 0);
    expect(url).toContain('/[A]/hotel.html');
  });

  it('throws on malformed template missing date segments', () => {
    const bad = 'https://hotel.check24.de/search/foo-123/[A][A]/hotel.html';
    expect(() => buildCheck24Url(bad, '2026-08-01', '2026-08-08', 2)).toThrow();
  });

  it('throws on malformed template missing adults segment', () => {
    const bad = 'https://hotel.check24.de/search/foo-123/2026-07-24/2026-07-31/hotel.html';
    expect(() => buildCheck24Url(bad, '2026-08-01', '2026-08-08', 2)).toThrow();
  });
});
