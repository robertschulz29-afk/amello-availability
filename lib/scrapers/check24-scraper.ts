// Check24 Playwright scraper — scrapes one hotel's search-results page per
// (checkIn, checkOut, adultCount) cell using a real headless Chromium browser
// (Check24's results are JS-rendered, so ScrapingAnt's plain HTML fetch won't work).

import { getChromiumExecutablePath, LAUNCH_ARGS } from '@/lib/scrapers/browser-launch';
import { buildCheck24Url } from '@/lib/scrapers/check24-url';

export type Check24Rate = { name: string | null; actualPrice: number; currency: string };
export type Check24Room = { name: string; rates: Check24Rate[] };
export type Check24CellResult = {
  status: 'green' | 'red' | 'error';
  responseJson: { rooms: Check24Room[]; source: 'check24'; error?: string };
};

const READY_SELECTOR = '[data-test-id="room-rate-list"][data-search-finished="true"]';
const WAIT_TIMEOUT_MS = 20000;

// Extraction runs in the page context; classes carry a build-hash prefix
// (e.g. "a0eb7ab8e-roomRateGroup"), so we match by suffix on each individual
// class token rather than a literal CSS class/attribute selector — a naive
// substring match would also catch "-roomRateRow"/"-roomRateGroup" when
// looking for the exact "-roomRate" token.
function evaluateRooms(): Check24Room[] {
  function hasClassSuffix(el: Element, suffix: string): boolean {
    return Array.from(el.classList).some((c) => c.endsWith(suffix));
  }
  function hasExactClassSuffixToken(el: Element, re: RegExp): boolean {
    return Array.from(el.classList).some((c) => re.test(c));
  }
  function findDescendantByClassSuffix(root: Element, suffix: string): Element | null {
    const all = root.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (hasClassSuffix(el, suffix)) return el;
    }
    return null;
  }

  const rooms: Check24Room[] = [];
  const allEls = document.querySelectorAll('*');
  const roomGroups: Element[] = [];
  for (const el of Array.from(allEls)) {
    if (hasClassSuffix(el, '-roomRateGroup')) roomGroups.push(el);
  }

  for (const group of roomGroups) {
    const titleEl = findDescendantByClassSuffix(group, '-basketRoomTitle');
    const groupRoomName = (titleEl?.textContent || '').trim();

    const rateRowEls = Array.from(group.querySelectorAll('*')).filter((el) =>
      hasExactClassSuffixToken(el, /^[a-z0-9]+-roomRate$/),
    );

    for (const rateRow of rateRowEls) {
      const priceEl = Array.from(rateRow.querySelectorAll('[data-room-rate-price]')).find(
        (el) => (el as HTMLElement).getAttribute('data-test-id') === 'basket-room-rate',
      ) || rateRow.querySelector('[data-room-rate-price]');
      if (!priceEl) continue;

      const priceAttr = priceEl.getAttribute('data-room-rate-price');
      const price = priceAttr ? parseFloat(priceAttr) : NaN;
      if (!isFinite(price)) continue;

      const positiveDetailEl = findDescendantByClassSuffix(rateRow, '-rateGroupDetail__positive');
      let rateName: string | null = null;
      if (positiveDetailEl) {
        const labelEl = findDescendantByClassSuffix(positiveDetailEl, '-label');
        rateName = (labelEl?.textContent || positiveDetailEl.textContent || '').trim() || null;
      }

      // Prefer the per-rate provider room description over the aggregated
      // room-group title when present — it's more precise per rate.
      const providerDescEl = findDescendantByClassSuffix(rateRow, '-providerRoomDescription');
      const roomName = (providerDescEl?.textContent || '').trim() || groupRoomName;

      if (!rooms.find((r) => r.name === roomName)) {
        rooms.push({ name: roomName, rates: [] });
      }
      const target = rooms.find((r) => r.name === roomName)!;
      target.rates.push({ name: rateName, actualPrice: price, currency: 'EUR' });
    }
  }

  return rooms.filter((r) => r.rates.length > 0);
}

export async function scrapeCheck24Cell(
  context: any,
  template: string,
  checkIn: string,
  checkOut: string,
  adultCount: number,
): Promise<Check24CellResult> {
  let url: string;
  try {
    url = buildCheck24Url(template, checkIn, checkOut, adultCount);
  } catch (e: any) {
    return { status: 'error', responseJson: { rooms: [], source: 'check24', error: e.message } };
  }

  let page: any = null;
  try {
    page = await context.newPage();
    let pageCrashed = false;
    page.on('crash', () => { pageCrashed = true; });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      // partial load — still attempt to wait for the ready selector below
    }

    if (pageCrashed) throw new Error('Page crashed during navigation');

    const found = await page.waitForSelector(READY_SELECTOR, { timeout: WAIT_TIMEOUT_MS }).catch(() => null);
    if (!found) {
      throw new Error('Timed out waiting for Check24 search results');
    }

    const rooms: Check24Room[] = await page.evaluate(evaluateRooms);

    if (rooms.length === 0) {
      return { status: 'red', responseJson: { rooms: [], source: 'check24' } };
    }

    return { status: 'green', responseJson: { rooms, source: 'check24' } };
  } catch (e: any) {
    return { status: 'error', responseJson: { rooms: [], source: 'check24', error: e.message } };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function launchCheck24Browser() {
  const executablePath = await getChromiumExecutablePath();
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath, args: LAUNCH_ARGS, headless: true });
}
