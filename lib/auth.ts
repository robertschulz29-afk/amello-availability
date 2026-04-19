// Node.js-only auth helpers (password hashing + session token creation)
import crypto from 'crypto';

export { COOKIE_NAME, MAX_AGE } from './auth-edge';

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'changeme-set-SESSION_SECRET-in-env';
const MAX_AGE = 60 * 60 * 8;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
}

// Creates a token compatible with the Edge verifier in auth-edge.ts
export async function createSessionToken(username: string): Promise<string> {
  const payload = btoa(JSON.stringify({ username, exp: Date.now() + MAX_AGE * 1000 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${payload}.${sig}`;
}
