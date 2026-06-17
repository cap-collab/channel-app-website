import { NextRequest, NextResponse } from 'next/server';
import { backupOriginals } from '@/lib/r2-backup';
import { getAdminDb } from '@/lib/firebase-admin';

// Daily COPY-ONLY backup of original recordings (DJ uploads + live-egress
// originals, before worker processing) from the primary R2 bucket to
// channel-broadcast-backup. Runs on Vercel (isolated from the live-streaming /
// egress / restream VPS workers); copies are server-side R2→R2 so no audio
// flows through this function and there is no contention with live infra.
//
// ⚠️ This route NEVER deletes anything. It only copies. See src/lib/r2-backup.ts.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await backupOriginals({ dryRun: false });

    // Record a small status doc for the Tech Health tab / observability.
    const db = getAdminDb();
    if (db) {
      await db.collection('system').doc('r2-backup-status').set({
        ranAt: Date.now(),
        totalOriginals: result.totalOriginals,
        copiedCount: result.copied.length,
        skippedExisting: result.skippedExisting,
        missingFromSourceCount: result.missingFromSource.length,
        missingFromSource: result.missingFromSource.slice(0, 50),
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 20),
      });
    }

    return NextResponse.json({
      ok: true,
      totalOriginals: result.totalOriginals,
      copied: result.copied.length,
      skippedExisting: result.skippedExisting,
      missingFromSource: result.missingFromSource.length,
      errors: result.errors.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'backup failed';
    console.error('[backup-r2]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
