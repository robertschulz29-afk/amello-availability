// lib/scrapers/utils/html-parser.ts
// HTML parsing utilities using cheerio

import * as cheerio from 'cheerio';

/**
 * Parse HTML string and return a cheerio instance
 */
export function parseHTML(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

/**
 * Extract text content from HTML using a CSS selector
 * @param html - HTML string to parse
 * @param selector - CSS selector
 * @returns Extracted text or null if not found
 */
export function extractText(html: string, selector: string): string | null {
  try {
    const $ = cheerio.load(html);
    const element = $(selector).first();
    return element.length > 0 ? element.text().trim() : null;
  } catch (error) {
    console.error('[extractText] Error:', error);
    return null;
  }
}

/**
 * Extract attribute value from HTML using a CSS selector
 * @param html - HTML string to parse
 * @param selector - CSS selector
 * @param attribute - Attribute name to extract
 * @returns Attribute value or null if not found
 */
export function extractAttribute(
  html: string,
  selector: string,
  attribute: string
): string | null {
  try {
    const $ = cheerio.load(html);
    const element = $(selector).first();
    if (element.length > 0) {
      const value = element.attr(attribute);
      return value !== undefined ? value : null;
    }
    return null;
  } catch (error) {
    console.error('[extractAttribute] Error:', error);
    return null;
  }
}

/**
 * Extract all matching elements as text array
 * @param html - HTML string to parse
 * @param selector - CSS selector
 * @returns Array of text values
 */
export function extractAll(html: string, selector: string): string[] {
  try {
    const $ = cheerio.load(html);
    const elements = $(selector);
    const results: string[] = [];
    
    elements.each((_, element) => {
      const text = $(element).text().trim();
      if (text) {
        results.push(text);
      }
    });
    
    return results;
  } catch (error) {
    console.error('[extractAll] Error:', error);
    return [];
  }
}

/**
 * Check if a selector exists in the HTML
 * @param html - HTML string to parse
 * @param selector - CSS selector
 * @returns True if selector matches at least one element
 */
export function selectorExists(html: string, selector: string): boolean {
  try {
    const $ = cheerio.load(html);
    return $(selector).length > 0;
  } catch (error) {
    console.error('[selectorExists] Error:', error);
    return false;
  }
}

/**
 * Extract data using multiple selectors
 * @param html - HTML string to parse
 * @param selectors - Object with selector mappings
 * @returns Object with extracted data
 */
export function extractMultiple(
  html: string,
  selectors: Record<string, string>
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  
  for (const [key, selector] of Object.entries(selectors)) {
    result[key] = extractText(html, selector);
  }
  
  return result;
}
