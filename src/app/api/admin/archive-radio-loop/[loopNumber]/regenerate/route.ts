import { NextRequest, NextResponse } from 'next/server';
import { generateLoop } from '@/lib/archive-schedule-server';

export const dynamic = 'force-dynamic';

// POST /api/admin/archive-radio-loop/{loopNumber}/regenerate
// Re-runs buildLoop for a specific loop (force=true bypasses locked).
//
// Optional body: { nowMs?: number }
//   The anchor start/end windows are derived from the run-time "now" (the
//   design assumes the overnight cron fires in the 1-3am PT dead zone). A
//   manual regen during the day sits outside that window, so the pre-anchor
//   subset search can't place a valid start and the anchor gets dropped. Pass
//   nowMs (epoch ms) to simulate the cron's overnight run-time so the windows
//   line up and the anchor is applied. Omit it for a normal now=Date.now() run.
export async function POST(req: NextRequest, ctx: { params: Promise<{ loopNumber: string }> }) {
  const { loopNumber: raw } = await ctx.params;
  const loopNumber = Number(raw);
  if (!Number.isInteger(loopNumber) || loopNumber < 1) {
    return NextResponse.json({ error: 'Invalid loopNumber — expected positive integer' }, { status: 400 });
  }

  let nowMsOverride: number | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && body.nowMs != null) {
      const n = Number(body.nowMs);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'Invalid nowMs — expected positive epoch milliseconds' }, { status: 400 });
      }
      nowMsOverride = n;
    }
  } catch {
    // No/invalid body — treat as a normal regen (nowMsOverride stays undefined).
  }

  try {
    const result = await generateLoop({
      loopNumber,
      force: true,
      generatedBy: 'admin',
      ...(nowMsOverride != null ? { nowMsOverride } : {}),
    });
    return NextResponse.json({
      success: true,
      ...(nowMsOverride != null ? { simulatedNow: new Date(nowMsOverride).toISOString() } : {}),
      ...result,
    });
  } catch (err) {
    console.error('[regenerate-loop] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to regenerate loop' },
      { status: 500 },
    );
  }
}
