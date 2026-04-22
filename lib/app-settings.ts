import { sql } from '@/lib/db';

export async function getSetting(key: string): Promise<string | null> {
  try {
    const result = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
    return result.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function getBookingCookies(): Promise<string> {
  const dbVal = await getSetting('booking_com_cookies');
  return dbVal || process.env.BOOKING_COM_COOKIES || '';
}
