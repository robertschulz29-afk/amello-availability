import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth-edge';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/scans',          // scan creation, listing, stop, delete
  '/api/scan-sources',   // source toggle
  '/api/hotels',         // hotel data
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth check — skip public paths and static assets
  if (!PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token || !await verifySessionToken(token)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }
  }

  // Add Bello-Mandator header to API requests
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has('Bello-Mandator')) {
    requestHeaders.set('Bello-Mandator', DEFAULT_BELLO_MANDATOR);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
