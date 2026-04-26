import { getSetting } from '@/lib/app-settings';

export async function getBookingCookies(): Promise<string> {
  const dbVal = await getSetting('booking_com_cookies');
  return dbVal || process.env.BOOKING_COM_COOKIES || '';
}
