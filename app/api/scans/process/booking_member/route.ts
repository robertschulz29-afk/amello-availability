import { NextRequest } from 'next/server';
import { handleBookingJob } from '../booking/_handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handleBookingJob(req, 'booking_member');
}
