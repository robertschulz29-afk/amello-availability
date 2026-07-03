// Shared Playwright/Chromium launch wiring for Vercel serverless.
// Used by both the CR-API playwright scan runner and the Check24 scraper.

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';

export const LAUNCH_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--no-zygote',
  '--disable-dev-shm-usage', '--disable-gpu',
  '--disk-cache-size=0', '--media-cache-size=0', '--disable-application-cache',
];

// Common local browser install locations, checked only outside Vercel (see below).
const LOCAL_BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

export async function getChromiumExecutablePath(): Promise<string> {
  // @sparticuz/chromium-min downloads a Linux-only binary meant for Vercel's
  // serverless runtime. On Windows, its own executablePath() recursion treats
  // the extracted local path as a URL again — `new URL("C:\\...")` parses with
  // protocol "c:" instead of throwing — which follow-redirects then rejects
  // with "protocol mismatch". It also wouldn't run a Linux binary locally
  // anyway, so outside Vercel we point Playwright at a real installed browser.
  if (!process.env.VERCEL) {
    const { existsSync } = await import('node:fs');
    const local = LOCAL_BROWSER_CANDIDATES.find(p => existsSync(p));
    if (local) return local;
    throw new Error(
      'No local Chrome/Edge install found for Playwright. Install Chrome or Edge, ' +
      'or set VERCEL=1 to force the serverless Chromium download path.',
    );
  }

  const chromium = (await import('@sparticuz/chromium-min')).default;
  return chromium.executablePath(CHROMIUM_URL);
}
