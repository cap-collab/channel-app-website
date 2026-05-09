import { NextRequest, NextResponse } from 'next/server';
import { generateScheduleForDate } from '@/lib/archive-schedule-server';
import { tomorrowUtcId } from '@/lib/archive-schedule';

export const dynamic = 'force-dynamic';

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Daily cron: builds tomorrow's archive-radio schedule.
// Optional ?date=YYYY-MM-DD overrides the target day; ?force=true bypasses
// the locked check (used by the future admin "Regenerate" button).
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get('date');
    const force = searchParams.get('force') === 'true';
    const dateId = requestedDate ?? tomorrowUtcId();

    const result = await generateScheduleForDate({
      dateId,
      force,
      generatedBy: 'cron',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[generate-archive-schedule] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate schedule' },
      { status: 500 },
    );
  }
}
