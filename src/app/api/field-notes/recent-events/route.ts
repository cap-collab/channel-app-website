import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { coerceSlotTimeMs } from '@/lib/broadcast-slots';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import { requireFieldNotesAccess } from '@/lib/field-notes';
import { RecentEventCandidate } from '@/types/field-notes';
import { EventDJRef } from '@/types/events';

const WINDOW_MS = 48 * 60 * 60 * 1000;

function slotDjs(data: Record<string, unknown>): EventDJRef[] {
  const arr = (data.djs as Array<Record<string, unknown>>) || [];
  if (arr.length > 0) {
    return arr
      .filter((d) => d && d.djName)
      .map((d) => ({
        djName: d.djName as string,
        djUserId: (d.djUserId as string) || undefined,
        djUsername: (d.djUsername as string) || undefined,
        djPhotoUrl: (d.djPhotoUrl as string) || undefined,
      }));
  }
  const name = data.djName as string | undefined;
  if (!name) return [];
  return [{
    djName: name,
    djUserId: (data.djUserId as string) || undefined,
    djUsername: (data.djUsername as string) || undefined,
  }];
}

function archiveDjs(data: Record<string, unknown>): EventDJRef[] {
  const arr = (data.djs as Array<Record<string, unknown>>) || [];
  return arr
    .filter((d) => d && d.name)
    .map((d) => ({
      djName: d.name as string,
      djUserId: (d.userId as string) || undefined,
      djUsername: (d.username as string) || undefined,
      djPhotoUrl: (d.photoUrl as string) || undefined,
    }));
}

function eventDjs(data: Record<string, unknown>): EventDJRef[] {
  const arr = (data.djs as EventDJRef[]) || [];
  return arr.filter((d) => d && d.djName);
}

// GET — "ongoing or last 48h" candidates from broadcast-slots + archives +
// events, merged and sorted newest-first, for the "link a recent event" picker.
export async function GET(request: NextRequest) {
  if (FIELD_NOTES_ADMIN_ONLY) {
    const access = await requireFieldNotesAccess(request, true);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  }

  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const now = Date.now();
    const min = now - WINDOW_MS;
    const max = now + WINDOW_MS;

    const [slotsSnap, archivesSnap, eventsSnap] = await Promise.all([
      db.collection('broadcast-slots').orderBy('startTime', 'desc').limit(80).get(),
      db.collection('archives').orderBy('recordedAt', 'desc').limit(60).get(),
      db.collection('events').orderBy('date', 'desc').limit(80).get(),
    ]);

    const candidates: RecentEventCandidate[] = [];

    for (const doc of slotsSnap.docs) {
      const data = doc.data();
      const startMs = coerceSlotTimeMs(data.startTime);
      if (!startMs || startMs < min || startMs > max) continue;
      if (data.djUsername === 'channelbroadcast') continue; // hidden test account
      candidates.push({
        type: 'slot',
        id: doc.id,
        name: (data.showName as string) || 'Live show',
        date: startMs,
        djs: slotDjs(data),
      });
    }

    for (const doc of archivesSnap.docs) {
      const data = doc.data();
      const recMs = coerceSlotTimeMs(data.recordedAt);
      if (!recMs || recMs < min || recMs > max) continue;
      candidates.push({
        type: 'archive',
        id: doc.id,
        name: (data.showName as string) || 'Recorded show',
        date: recMs,
        djs: archiveDjs(data),
      });
    }

    for (const doc of eventsSnap.docs) {
      const data = doc.data();
      const dateMs = coerceSlotTimeMs(data.date);
      if (!dateMs || dateMs < min || dateMs > max) continue;
      candidates.push({
        type: 'event',
        id: doc.id,
        name: (data.name as string) || 'Event',
        date: dateMs,
        djs: eventDjs(data),
      });
    }

    candidates.sort((a, b) => b.date - a.date);

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error('[field-notes recent-events]', error);
    return NextResponse.json({ error: 'Failed to load recent events' }, { status: 500 });
  }
}
