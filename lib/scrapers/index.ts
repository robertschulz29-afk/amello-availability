// lib/scrapers/index.ts
// Main exports for the scraping infrastructure

export { BaseScraper } from './BaseScraper';
export { BookingComScraper } from './BookingComScraper';
export * from './types';
export * from './utils/user-agents';
export * from './utils/delays';
export * from './utils/html-parser';
export * from './utils/retry';
export * from './utils/browser-manager';
