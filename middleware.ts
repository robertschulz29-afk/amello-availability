import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth-edge';

// Only these paths are accessible without authentication.
// Everything else requires a valid session token.
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/register',
];

// Cron-triggered paths are protected by CRON_SECRET bearer token (checked in route handlers).
// They bypass session auth so Vercel Cron — and our own server-to-server fan-out
// calls between these routes — can invoke them without a browser session cookie.
const CRON_PATHS = [
  '/api/scans/process-next',
  '/api/playwright-scan/process-next',
];

// Prefix-matched cron paths: per-source batch processors invoked server-to-server
// by the paths above (and by /api/scans/route.ts's first-batch trigger).
const CRON_PATH_PREFIXES = [
  '/api/scans/process/',
  '/api/playwright-scan/process',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths (login page + login API)
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return addBelloHeader(request);
  }

  // Allow cron paths — they authenticate via CRON_SECRET in the route handler
  if (CRON_PATHS.some(p => pathname === p) || CRON_PATH_PREFIXES.some(p => pathname.startsWith(p))) {
    return addBelloHeader(request);
  }

  // All other routes require a valid session
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !await verifySessionToken(token)) {
    // API routes get a 401 JSON response; pages get redirected to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  return addBelloHeader(request);
}

function addBelloHeader(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has('Bello-Mandator')) {
    requestHeaders.set('Bello-Mandator', DEFAULT_BELLO_MANDATOR);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
