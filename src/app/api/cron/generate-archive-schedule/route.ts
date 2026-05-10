import { NextRequest, NextResponse } from 'next/server';
import { ensureNextLoop } from '@/lib/archive-schedule-server';

export const dynamic = 'force-dynamic';

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Daily cron: ensures the next archive-radio loop exists. Idempotent — does
// nothing if a future-starting loop is already queued. Path kept as
// `/api/cron/generate-archive-schedule` so the existing vercel.json cron entry
// (0 23 * * *) doesn't need to be re-registered; the implementation now writes
// to the catalog-loop collection instead of the daily-schedule one.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await ensureNextLoop({ generatedBy: 'cron' });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[ensure-next-loop cron] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to ensure next loop' },
      { status: 500 },
    );
  }
}
