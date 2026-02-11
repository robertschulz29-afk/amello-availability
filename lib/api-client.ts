/**
 * Centralized API client utility for making requests with consistent headers
 */

/**
 * Get the API base URL from environment variable or fallback to empty string for relative paths
 * NEXT_PUBLIC_API_URL should be the full base URL of the backend API (e.g., https://api.example.com)
 */
function getApiBaseUrl(): string {
  // Check for NEXT_PUBLIC_API_URL for client-side access
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || '';
  }
  // On server-side, check both NEXT_PUBLIC_API_URL and API_BASE_URL
  return process.env.NEXT_PUBLIC_API_URL || process.env.API_BASE_URL || '';
}

/**
 * Constructs the full API URL by combining the base URL with the path
 * If no base URL is configured, returns the path as-is (backward compatible)
 * 
 * @param path - The API path (e.g., '/api/hotels')
 * @returns Full URL or original path
 */
function buildApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  
  // If no base URL configured or only whitespace, use the path as-is (backward compatible)
  if (!baseUrl || !baseUrl.trim()) {
    return path;
  }
  
  // Remove all trailing slashes from base URL if present
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  
  // Ensure path starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  return `${cleanBaseUrl}${cleanPath}`;
}

/**
 * Makes a fetch request with automatic JSON parsing and error handling.
 * Automatically includes the "Bello-Mandator: amello.en" header on all requests.
 * 
 * If NEXT_PUBLIC_API_URL or API_BASE_URL environment variable is set, it will be used
 * as the base URL for all API requests. Otherwise, relative paths are used.
 * 
 * @param input - The URL or Request object to fetch
 * @param init - Optional fetch initialization options
 * @returns Parsed JSON response or null if response is empty
 * @throws Error with message from server or status text
 */
export async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  // Build the full URL if input is a string
  const url = typeof input === 'string' ? buildApiUrl(input) : input;
  
  // Merge the Bello-Mandator header with any existing headers
  const headers = new Headers(init?.headers);
  headers.set('Bello-Mandator', 'amello.en');

  // Make the request with updated headers
  const r = await fetch(url, {
    ...init,
    headers,
  });

  const text = await r.text();
  if (!r.ok) {
    let errorMessage = r.statusText;
    try {
      const j = JSON.parse(text);
      errorMessage = j.error || r.statusText;
    } catch {
      // If JSON parsing fails, use the raw text or status text
      errorMessage = text || r.statusText;
    }
    throw new Error(errorMessage);
  }
  return text ? JSON.parse(text) : null;
}
