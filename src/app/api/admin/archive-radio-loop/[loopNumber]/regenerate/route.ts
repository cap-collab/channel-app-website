import { NextRequest, NextResponse } from 'next/server';
import { generateLoop } from '@/lib/archive-schedule-server';

export const dynamic = 'force-dynamic';

// POST /api/admin/archive-radio-loop/{loopNumber}/regenerate
// Re-runs buildLoop for a specific loop (force=true bypasses locked).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ loopNumber: string }> }) {
  const { loopNumber: raw } = await ctx.params;
  const loopNumber = Number(raw);
  if (!Number.isInteger(loopNumber) || loopNumber < 1) {
    return NextResponse.json({ error: 'Invalid loopNumber — expected positive integer' }, { status: 400 });
  }
  try {
    const result = await generateLoop({
      loopNumber,
      force: true,
      generatedBy: 'admin',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[regenerate-loop] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to regenerate loop' },
      { status: 500 },
    );
  }
}
