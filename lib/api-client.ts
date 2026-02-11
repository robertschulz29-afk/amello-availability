/**
 * Centralized API client utility for making requests with consistent headers
 */

/**
 * Makes a fetch request with automatic JSON parsing and error handling.
 * Automatically includes the "Bello-Mandator: amello.en" header on all requests.
 * 
 * @param input - The URL or Request object to fetch
 * @param init - Optional fetch initialization options
 * @returns Parsed JSON response or null if response is empty
 * @throws Error with message from server or status text
 */
export async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  // Merge the Bello-Mandator header with any existing headers
  const headers = new Headers(init?.headers);
  headers.set('Bello-Mandator', 'amello.en');

  // Make the request with updated headers
  const r = await fetch(input, {
    ...init,
    headers,
  });

  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || r.statusText);
    } catch {
      throw new Error(text || r.statusText);
    }
  }
  return text ? JSON.parse(text) : null;
}
