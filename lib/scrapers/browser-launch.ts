// Shared Playwright/Chromium launch wiring for Vercel serverless.
// Used by both the CR-API playwright scan runner and the Check24 scraper.

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';

export const LAUNCH_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--no-zygote',
  '--disable-dev-shm-usage', '--disable-gpu',
  '--disk-cache-size=0', '--media-cache-size=0', '--disable-application-cache',
];

export async function getChromiumExecutablePath(): Promise<string> {
  const chromium = (await import('@sparticuz/chromium-min')).default;
  return chromium.executablePath(CHROMIUM_URL);
}
