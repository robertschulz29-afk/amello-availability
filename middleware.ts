import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

/**
 * Next.js Middleware to ensure the Bello-Mandator header is present on API requests
 * 
 * This middleware intercepts all requests to /api/* routes and ensures that the
 * Bello-Mandator header is set to 'amello.en'. If the header is already present,
 * it is preserved. If missing, it is added.
 * 
 * This ensures that when API requests are proxied or forwarded to backend services,
 * the required Bello-Mandator header is always included.
 */
export function middleware(request: NextRequest) {
  // Clone the request headers
  const requestHeaders = new Headers(request.headers);
  
  // Check if Bello-Mandator header exists, if not add it
  if (!requestHeaders.has('Bello-Mandator')) {
    requestHeaders.set('Bello-Mandator', DEFAULT_BELLO_MANDATOR);
  }
  
  // Create a new response with the updated headers
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  
  return response;
}

/**
 * Configure which routes this middleware should run on
 * This matcher ensures the middleware only runs on /api/* routes
 */
export const config = {
  matcher: '/api/:path*',
};
