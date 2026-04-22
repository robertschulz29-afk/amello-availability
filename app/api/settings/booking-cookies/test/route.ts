import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';
const SCRAPINGANT_URL = 'https://api.scrapingant.com/v2/general';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cookies: string = body.cookies || '';

  if (!SCRAPINGANT_API_KEY) {
    return NextResponse.json({ error: 'SCRAPINGANT_API_KEY not set' }, { status: 500 });
  }

  const params = new URLSearchParams({
    url: 'https://www.booking.com',
    'x-api-key': SCRAPINGANT_API_KEY,
    browser: 'true',
    proxy_country: 'DE',
  });

  const fetchHeaders: Record<string, string> = { Accept: 'text/html' };
  if (cookies.trim()) {
    const cookieString = cookies.split(';').map((c: string) => c.trim()).filter(Boolean).join('; ');
    fetchHeaders['ant-Cookie'] = cookieString;
  }

  try {
    const response = await fetch(`${SCRAPINGANT_URL}?${params}`, {
      method: 'GET',
      headers: fetchHeaders,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return NextResponse.json({
        loggedIn: false,
        error: `ScrapingAnt error ${response.status}: ${body.slice(0, 200)}`,
      });
    }

    const html = await response.text();

    // Booking.com shows "Sign in" when logged out, and account-specific
    // elements (genius logo, profile menu) when logged in.
    const loggedOut =
      /sign[\s-]?in/i.test(html) &&
      !html.includes('genius-program') &&
      !html.includes('bui-avatar');

    const hasGenius = html.includes('genius') || html.includes('Genius');
    const hasAvatar = html.includes('bui-avatar') || html.includes('profile-picture');
    const loggedIn = hasGenius || hasAvatar || !loggedOut;

    return NextResponse.json({
      loggedIn,
      indicators: { hasGenius, hasAvatar, signInTextFound: /sign[\s-]?in/i.test(html) },
    });
  } catch (e: any) {
    return NextResponse.json({ loggedIn: false, error: e.message }, { status: 500 });
  }
}
