import { NextResponse } from 'next/server';
import { ensureNextLoop } from '@/lib/archive-schedule-server';

export const dynamic = 'force-dynamic';

// POST /api/admin/archive-radio-loop/ensure-next
// Idempotent: ensures a loop exists with startTimeMs > now. Called both by
// the cron and as a listener-side fallback when the current loop is ending
// within ~6h and no next-loop doc exists yet.
async function handle() {
  try {
    const result = await ensureNextLoop({ generatedBy: 'cron' });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[ensure-next-loop] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to ensure next loop' },
      { status: 500 },
    );
  }
}

export async function POST() {
  return handle();
}

// Allow GET too — Vercel cron uses GET by default.
export async function GET() {
  return handle();
}
