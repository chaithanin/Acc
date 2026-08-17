import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness probe for the load balancer or VM health check.
 *
 * Touches the database rather than only returning 200, so a container that
 * started but cannot reach its volume is reported unhealthy instead of being
 * sent traffic it cannot serve. Deliberately returns nothing about the data.
 */
export async function GET() {
  try {
    getDb().prepare('SELECT 1').get();
    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json(
      { status: 'unavailable', reason: (err as Error).message },
      { status: 503 },
    );
  }
}
