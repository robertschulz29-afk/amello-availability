// Edge-runtime compatible session verification (uses Web Crypto API)

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'changeme-set-SESSION_SECRET-in-env';
export const COOKIE_NAME = 'session';
export const MAX_AGE = 60 * 60 * 8; // 8 hours

async function getKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function verifySessionToken(token: string): Promise<{ username: string } | null> {
  try {
    const dot = token.lastIndexOf('.');
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const key = await getKey();
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await globalThis.crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
    if (!valid) return null;

    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (Date.now() > data.exp) return null;
    return { username: data.username };
  } catch {
    return null;
  }
}
