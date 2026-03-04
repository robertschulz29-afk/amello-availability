// lib/scrapers/utils/browser-manager.ts
import puppeteer, { Browser, Page } from 'puppeteer-core';

// Must match your installed @sparticuz/chromium-min version.
// Check node_modules/@sparticuz/chromium-min/package.json → "version"
// Then find the matching release at https://github.com/Sparticuz/chromium/releases
const CHROMIUM_REMOTE_EXEC_PATH =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

// Path where `npx puppeteer browsers install chrome` installed Chrome locally.
// Only used when NODE_ENV !== 'production'.
const LOCAL_CHROME_PATH =
  process.platform === 'win32'
    ? `C:\\Users\\ro_sc\\.cache\\puppeteer\\chrome\\win64-145.0.7632.77\\chrome-win64\\chrome.exe`
    : process.platform === 'darwin'
    ? `/Users/${process.env.USER ?? 'user'}/.cache/puppeteer/chrome/mac-145.0.7632.77/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
    : `/home/${process.env.USER ?? 'user'}/.cache/puppeteer/chrome/linux-145.0.7632.77/chrome-linux64/chrome`;

// Vercel sets NODE_ENV=production on all deployments — this is the most reliable check.
// Do NOT rely on process.env.VERCEL or process.env.HOME as these may not be set.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
    console.log('[BrowserManager] NODE_ENV:', process.env.NODE_ENV);
    console.log('[BrowserManager] IS_PRODUCTION:', IS_PRODUCTION);
    console.log('[BrowserManager] platform:', process.platform);

    if (IS_PRODUCTION) {
      console.log('[BrowserManager] Production: launching via @sparticuz/chromium-min...');

      const chromium = await import('@sparticuz/chromium-min');

      const executablePath = await chromium.default.executablePath(CHROMIUM_REMOTE_EXEC_PATH);
      console.log('[BrowserManager] Chromium executable path:', executablePath);

      const browser = await puppeteer.launch({
        args: chromium.default.args,
        executablePath,
        headless: true,
        defaultViewport: { width: 1920, height: 1080 },
      });

      console.log('[BrowserManager] Browser launched (production)');
      return browser;

    } else {
      console.log('[BrowserManager] Development: launching local Chrome...');
      console.log('[BrowserManager] Local Chrome path:', LOCAL_CHROME_PATH);

      const browser = await puppeteer.launch({
        executablePath: LOCAL_CHROME_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true,
        defaultViewport: { width: 1920, height: 1080 },
      });

      console.log('[BrowserManager] Browser launched (development)');
      return browser;
    }
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
