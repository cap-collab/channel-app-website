import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// Telemetry-only endpoint: writes publisher RTC stats to the slot doc's
// `publisherStats` field. Never touches status / recordingUrl / recordings.
// Always returns 200 — telemetry failure must not surface to the client.
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ ok: true, skipped: 'db-unavailable' });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: true, skipped: 'no-body' });
    }

    const { slotId, stats } = body as { slotId?: string; stats?: unknown };
    if (!slotId || typeof slotId !== 'string' || !stats) {
      return NextResponse.json({ ok: true, skipped: 'missing-fields' });
    }

    // Try broadcast-slots first, then studio-sessions (mirrors complete-slot).
    let slotRef = db.collection('broadcast-slots').doc(slotId);
    let exists = (await slotRef.get()).exists;
    if (!exists) {
      slotRef = db.collection('studio-sessions').doc(slotId);
      exists = (await slotRef.get()).exists;
    }
    if (!exists) {
      return NextResponse.json({ ok: true, skipped: 'slot-not-found' });
    }

    await slotRef.update({ publisherStats: stats });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn('[log-stats] non-fatal error:', err);
    return NextResponse.json({ ok: true, skipped: 'error' });
  }
}
