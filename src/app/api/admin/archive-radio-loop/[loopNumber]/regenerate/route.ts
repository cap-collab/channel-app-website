import { NextRequest, NextResponse } from 'next/server';
import { generateLoop } from '@/lib/archive-schedule-server';

export const dynamic = 'force-dynamic';

// The overnight cron generates loops while "now" sits in the 1-3am PT dead
// zone, which is what lets the anchor alignment place a pre-anchor block that
// ends on tonight's live block without tripping the MAX_OVERLAP_MS clamp. A
// manual daytime regen has now = mid-morning/afternoon, so earliestStartMs is
// hours past the dead zone; the anchor-aligned start (which must be early
// morning so the ~17h pre-anchor block ends at the live block) lands >4h
// before earliestStartMs and gets clamped forward — shoving the whole loop
// (and the anchor) late. Default the simulated "now" to 1am PT of the current
// PT day so an admin regen reproduces the cron's behavior automatically.
// PT is approximated as UTC-7 to match the window math in archive-schedule-server.
const PT_OFFSET_MS = 7 * 3600 * 1000;
function oneAmPtToday(realNowMs: number): number {
  const ptMs = realNowMs - PT_OFFSET_MS;          // shift into PT-local wall clock
  const ptDayStart = Math.floor(ptMs / 86_400_000) * 86_400_000; // midnight PT
  const onePtMs = ptDayStart + 1 * 3600 * 1000;   // 1am PT (PT-local)
  return onePtMs + PT_OFFSET_MS;                   // back to real UTC epoch
}

// POST /api/admin/archive-radio-loop/{loopNumber}/regenerate
// Re-runs buildLoop for a specific loop (force=true bypasses locked).
//
// Optional body: { nowMs?: number }
//   Explicit simulated "now" (epoch ms). When omitted, defaults to 1am PT of
//   today so a daytime admin regen reproduces the overnight cron (see above).
//   Pass nowMs only to target a different run-time. Pass { nowMs: 0 } is
//   rejected; pass nothing to get the auto 1am-PT default.
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
    // No/invalid body — fall through to the auto default below.
  }

  // Auto-simulate the overnight cron when no explicit nowMs was given.
  const autoDefaulted = nowMsOverride == null;
  const effectiveNowMs = nowMsOverride ?? oneAmPtToday(Date.now());

  try {
    const result = await generateLoop({
      loopNumber,
      force: true,
      generatedBy: 'admin',
      nowMsOverride: effectiveNowMs,
    });
    return NextResponse.json({
      success: true,
      simulatedNow: new Date(effectiveNowMs).toISOString(),
      simulatedNowAuto: autoDefaulted,
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
