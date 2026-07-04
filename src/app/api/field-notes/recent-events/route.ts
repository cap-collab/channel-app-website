import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { coerceSlotTimeMs } from '@/lib/broadcast-slots';
import { RecentEventCandidate } from '@/types/field-notes';
import { EventDJRef } from '@/types/events';

// Events that started today or in the past 7 days (not future).
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
// Open (the feature is only hidden from the menu, not secured).
export async function GET() {
  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const now = Date.now();
    const min = now - WINDOW_MS;
    const max = now + 6 * 60 * 60 * 1000; // small forward buffer for an ongoing/just-scheduled show today

    const [slotsSnap, archivesSnap, eventsSnap] = await Promise.all([
      db.collection('broadcast-slots').orderBy('startTime', 'desc').limit(80).get(),
      db.collection('archives').orderBy('recordedAt', 'desc').limit(60).get(),
      db.collection('events').orderBy('date', 'desc').limit(80).get(),
    ]);

    // Dedup key: same show + same primary DJ = the same event to a listener.
    // A live show appears both as broadcast-slot(s) and (once recorded) as an
    // archive; multiple loop slots can share a name. Collapse to one entry.
    const key = (name: string, djs: { djName?: string; djUsername?: string }[]): string => {
      const dj = djs[0];
      const djKey = dj?.djUsername || (dj?.djName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return `${(name || '').toLowerCase().trim()}|${djKey}`;
    };

    const seen = new Map<string, RecentEventCandidate>();
    const add = (c: RecentEventCandidate) => {
      const k = key(c.name, c.djs);
      const existing = seen.get(k);
      if (!existing) {
        seen.set(k, c);
        return;
      }
      // Prefer a slot (the live show the listener attended) over an archive of
      // the same show; otherwise keep the more recent one.
      const rank = (t: RecentEventCandidate['type']) => (t === 'slot' ? 2 : t === 'event' ? 1 : 0);
      if (rank(c.type) > rank(existing.type) || (rank(c.type) === rank(existing.type) && c.date > existing.date)) {
        seen.set(k, c);
      }
    };

    for (const doc of slotsSnap.docs) {
      const data = doc.data();
      const startMs = coerceSlotTimeMs(data.startTime);
      if (!startMs || startMs < min || startMs > max) continue;
      if (data.djUsername === 'channelbroadcast') continue; // hidden test account
      add({
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
      add({
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
      add({
        type: 'event',
        id: doc.id,
        name: (data.name as string) || 'Event',
        date: dateMs,
        djs: eventDjs(data),
      });
    }

    const candidates = Array.from(seen.values()).sort((a, b) => b.date - a.date);

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error('[field-notes recent-events]', error);
    return NextResponse.json({ error: 'Failed to load recent events' }, { status: 500 });
  }
}
