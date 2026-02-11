// lib/scrapers/utils/session-manager.ts
// Cookie jar and session persistence for maintaining state across requests

/**
 * Simple cookie storage interface
 */
export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
}

/**
 * Cookie jar to store and manage cookies
 */
export class CookieJar {
  private cookies: Map<string, Cookie> = new Map();

  /**
   * Add a cookie to the jar
   */
  addCookie(cookie: Cookie): void {
    const key = `${cookie.domain || ''}:${cookie.path || '/'}:${cookie.name}`;
    this.cookies.set(key, cookie);
  }

  /**
   * Add a cookie by name and value (simplified)
   */
  addSimple(name: string, value: string): void {
    this.addCookie({ name, value });
  }

  /**
   * Get all cookies
   */
  getAllCookies(): Cookie[] {
    return Array.from(this.cookies.values());
  }

  /**
   * Get cookies as a string for Cookie header
   */
  getCookieString(): string {
    return this.getAllCookies()
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  /**
   * Parse and add cookies from Set-Cookie header
   */
  parseCookieHeader(setCookieHeader: string): void {
    const parts = setCookieHeader.split(';');
    const [nameValue] = parts;
    const [name, value] = nameValue.split('=').map(s => s.trim());
    
    if (name && value) {
      this.addSimple(name, value);
    }
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Get number of cookies
   */
  size(): number {
    return this.cookies.size;
  }
}

/**
 * Session manager to handle cookie persistence and rotation
 * Maintains cookies within a batch of requests, then rotates session
 */
export class SessionManager {
  private currentSession: CookieJar;
  private requestCount: number = 0;
  private maxRequestsPerSession: number;
  private sessionStartTime: number;

  constructor(maxRequestsPerSession: number = 15) {
    this.maxRequestsPerSession = maxRequestsPerSession;
    this.currentSession = new CookieJar();
    this.sessionStartTime = Date.now();
  }

  /**
   * Get the current session's cookie jar
   * Automatically rotates if session has expired
   */
  getSession(): CookieJar {
    if (this.shouldRotate()) {
      this.rotateSession();
    }
    return this.currentSession;
  }

  /**
   * Increment request count and check if rotation is needed
   */
  incrementRequestCount(): void {
    this.requestCount++;
  }

  /**
   * Check if session should be rotated
   * Based on request count or timeout
   */
  private shouldRotate(): boolean {
    // Rotate after max requests
    if (this.requestCount >= this.maxRequestsPerSession) {
      return true;
    }

    // Rotate after 30 minutes
    const sessionAge = Date.now() - this.sessionStartTime;
    const maxSessionAge = 30 * 60 * 1000; // 30 minutes
    if (sessionAge >= maxSessionAge) {
      return true;
    }

    return false;
  }

  /**
   * Force session rotation
   * Clears cookies and resets request counter
   */
  rotateSession(): void {
    this.currentSession.clear();
    this.requestCount = 0;
    this.sessionStartTime = Date.now();
  }

  /**
   * Add a cookie to the current session
   */
  addCookie(name: string, value: string): void {
    this.currentSession.addSimple(name, value);
  }

  /**
   * Get session statistics
   */
  getStats(): { requestCount: number; sessionAge: number; cookieCount: number } {
    return {
      requestCount: this.requestCount,
      sessionAge: Date.now() - this.sessionStartTime,
      cookieCount: this.currentSession.size(),
    };
  }

  /**
   * Set max requests per session
   */
  setMaxRequestsPerSession(max: number): void {
    this.maxRequestsPerSession = max;
  }
}
