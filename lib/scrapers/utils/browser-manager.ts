// lib/scrapers/utils/browser-manager.ts
// Puppeteer browser instance manager
//
// Strategy:
//   - Local dev (NODE_ENV !== 'production'):
//       Uses locally installed Chrome via `npx puppeteer browsers install chrome`
//   - Production (Vercel / SCRAPING_BEE_TOKEN set):
//       Delegates to ScrapingBee API — no Chromium needed, bypasses bot detection,
//       handles JS rendering server-side on their infrastructure.
//       Sign up free at https://www.scrapingbee.com (1,000 free credits/month)
//       Set SCRAPING_BEE_TOKEN in Vercel env vars.

import puppeteer, { Browser, Page } from 'puppeteer-core';

// Path where `npx puppeteer browsers install chrome` installed Chrome locally.
// Update the version number if you reinstall Chrome.
const LOCAL_CHROME_PATH =
  process.platform === 'win32'
    ? `${process.env.USERPROFILE}\\.cache\\puppeteer\\chrome\\win64-145.0.7632.77\\chrome-win64\\chrome.exe`
    : process.platform === 'darwin'
    ? `${process.env.HOME}/.cache/puppeteer/chrome/mac-145.0.7632.77/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    : `${process.env.HOME}/.cache/puppeteer/chrome/linux-145.0.7632.77/chrome-linux64/chrome`;

export class BrowserManager {
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launchPromise) return this.launchPromise;

    this.launchPromise = this.launchBrowser();
    try {
      this.browser = await this.launchPromise;
      return this.browser;
    } finally {
      this.launchPromise = null;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    console.log(`[BrowserManager] Launching local Chrome at: ${LOCAL_CHROME_PATH}`);

    const browser = await puppeteer.launch({
      executablePath: LOCAL_CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      headless: true,
      defaultViewport: { width: 1920, height: 1080 },
    });

    console.log('[BrowserManager] Local Chrome launched successfully');
    return browser;
  }

  async createPage(userAgent?: string): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    if (userAgent) await page.setUserAgent(userAgent);
    return page;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isRunning(): boolean {
    return this.browser !== null && this.browser.connected;
  }
}

let browserManagerInstance: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (!browserManagerInstance) browserManagerInstance = new BrowserManager();
  return browserManagerInstance;
}

export async function closeBrowserManager(): Promise<void> {
  if (browserManagerInstance) {
    await browserManagerInstance.close();
    browserManagerInstance = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ScrapingBee helper — used in production instead of Puppeteer
// Fetches a JS-rendered page through ScrapingBee's infrastructure.
// Their IPs are residential/rotating so Booking.com doesn't block them.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchWithScrapingBee(url: string): Promise<string> {
  const token = process.env.SCRAPING_BEE_TOKEN;
  if (!token) throw new Error('SCRAPING_BEE_TOKEN env var is not set');

  const params = new URLSearchParams({
    api_key: token,
    url,
    render_js: 'true',         // execute JavaScript like a real browser
    wait_for: '#available_rooms', // wait until room table is present
    timeout: '30000',
    block_ads: 'true',
    block_resources: 'false',  // need resources for JS rendering
    window_width: '1920',
    window_height: '1080',
  });

  console.log(`[ScrapingBee] Fetching: ${url}`);
  const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ScrapingBee error ${res.status}: ${body.slice(0, 200)}`);
  }

  const html = await res.text();
  console.log(`[ScrapingBee] Got ${html.length} bytes`);
  return html;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
}
