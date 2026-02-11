// lib/scrapers/utils/headers.ts
// Header spoofing utilities to mimic real browser traffic

import { getRandomUserAgent } from './user-agents';

export interface HeaderOptions {
  userAgent?: string;
  referer?: string;
  acceptLanguage?: string;
  cacheControl?: string;
}

/**
 * List of Accept-Language values to rotate
 */
const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'de-DE,de;q=0.8,en-US;q=0.7,en;q=0.6',
  'fr-FR,fr;q=0.8,en-US;q=0.7,en;q=0.6',
  'es-ES,es;q=0.9,en;q=0.8',
  'it-IT,it;q=0.9,en;q=0.8',
  'en-GB,en;q=0.9',
];

/**
 * List of Referer values to rotate (or null for direct)
 */
const REFERERS = [
  'https://www.google.com/',
  'https://duckduckgo.com/',
  'https://www.bing.com/',
  null, // Direct navigation (no referer)
  null, // Increase probability of direct
];

/**
 * Cache-Control header values
 */
const CACHE_CONTROLS = [
  'no-cache',
  'max-age=0',
  'no-cache, no-store',
];

/**
 * Get a random Accept-Language header value
 */
export function getRandomAcceptLanguage(): string {
  return ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)];
}

/**
 * Get a random Referer header value (or null for direct)
 */
export function getRandomReferer(): string | null {
  return REFERERS[Math.floor(Math.random() * REFERERS.length)];
}

/**
 * Get a random Cache-Control header value
 */
export function getRandomCacheControl(): string {
  return CACHE_CONTROLS[Math.floor(Math.random() * CACHE_CONTROLS.length)];
}

/**
 * Generate spoofed HTTP headers that mimic real browser traffic
 * Headers vary on each request to avoid fingerprinting
 * 
 * @param options - Optional overrides for specific headers
 * @returns Object containing HTTP headers
 */
export function getSpoofedHeaders(options: HeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': options.acceptLanguage || getRandomAcceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': options.cacheControl || getRandomCacheControl(),
    'User-Agent': options.userAgent || getRandomUserAgent(),
  };

  // Add Referer if provided or randomly selected
  const referer = options.referer !== undefined ? options.referer : getRandomReferer();
  if (referer) {
    headers['Referer'] = referer;
  }

  return headers;
}
