// lib/scrapers/utils/browser-manager.ts
// Puppeteer browser instance manager for scraping

import puppeteer, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

/**
 * Simple browser manager for Puppeteer
 * Handles browser instance lifecycle with lazy initialization
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  /**
   * Get or create browser instance
   */
  async getBrowser(): Promise<Browser> {
    // If browser exists and is connected, return it
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    // If launch is in progress, wait for it
    if (this.launchPromise) {
      return this.launchPromise;
    }

    // Launch new browser
    this.launchPromise = this.launchBrowser();
    
    try {
      this.browser = await this.launchPromise;
      return this.browser;
    } finally {
      this.launchPromise = null;
    }
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    console.log('[BrowserManager] Launching Puppeteer browser...');
    
    // Detect if we're running in a serverless environment (Vercel/Lambda)
    const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
    
    console.log('[BrowserManager] Environment:', isServerless ? 'Serverless (Vercel/Lambda)' : 'Local/Standard');
    
    // Get the executable path - for serverless, use without arguments
    // This allows @sparticuz/chromium to use its internal binaries correctly
    let executablePath: string;
    try {
      executablePath = await chromium.executablePath();
      console.log('[BrowserManager] Chromium executable path:', executablePath);
    } catch (error: any) {
      console.error('[BrowserManager] Failed to get chromium executable path:', error.message);
      throw new Error(`Failed to locate Chromium binary: ${error.message}`);
    }

    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: executablePath,
      headless: true,
    });

    console.log('[BrowserManager] Browser launched successfully');
    return browser;
  }

  /**
   * Create a new page with common settings
   */
  async createPage(userAgent?: string): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    // Set viewport to mimic real browser
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    });

    // Set user agent if provided
    if (userAgent) {
      await page.setUserAgent(userAgent);
    }

    return page;
  }

  /**
   * Close the browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      console.log('[BrowserManager] Closing browser...');
      await this.browser.close();
      this.browser = null;
      console.log('[BrowserManager] Browser closed');
    }
  }

  /**
   * Check if browser is running
   */
  isRunning(): boolean {
    return this.browser !== null && this.browser.connected;
  }
}

// Singleton instance for reuse across scraping sessions
let browserManagerInstance: BrowserManager | null = null;

/**
 * Get shared browser manager instance
 */
export function getBrowserManager(): BrowserManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager();
  }
  return browserManagerInstance;
}

/**
 * Close shared browser manager instance
 */
export async function closeBrowserManager(): Promise<void> {
  if (browserManagerInstance) {
    await browserManagerInstance.close();
    browserManagerInstance = null;
  }
}
