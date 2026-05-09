import { NextRequest, NextResponse } from 'next/server';
import { generateScheduleForDate } from '@/lib/archive-schedule-server';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/admin/archive-schedule/{YYYY-MM-DD}/regenerate
// Re-runs the auto-fill for a specific day (force=true bypasses locked).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ date: string }> }) {
  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD' }, { status: 400 });
  }
  try {
    const result = await generateScheduleForDate({
      dateId: date,
      force: true,
      generatedBy: 'admin',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[regenerate] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to regenerate' },
      { status: 500 },
    );
  }
}
