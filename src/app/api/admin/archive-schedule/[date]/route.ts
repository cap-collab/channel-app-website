import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  SCHEDULE_COLLECTION,
  utcDayStartMs,
} from '@/lib/archive-schedule';
import type { ScheduleItem } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badDate() {
  return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD' }, { status: 400 });
}

// GET /api/admin/archive-schedule/{YYYY-MM-DD} — fetch a day's schedule.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ date: string }> }) {
  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) return badDate();
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  const snap = await db.collection(SCHEDULE_COLLECTION).doc(date).get();
  if (!snap.exists) {
    return NextResponse.json({ exists: false, date });
  }
  const data = snap.data() ?? {};
  return NextResponse.json({
    exists: true,
    date,
    startTimeMs: Number(data.startTimeMs ?? utcDayStartMs(date)),
    generatedAtMs: Number(data.generatedAtMs ?? 0),
    generatedBy: data.generatedBy ?? 'cron',
    locked: Boolean(data.locked),
    items: Array.isArray(data.items) ? data.items : [],
    eligibleArchiveCount: data.eligibleArchiveCount ?? null,
  });
}

// PUT /api/admin/archive-schedule/{YYYY-MM-DD} — overwrite a day's items
// (admin edits in the UI). Recomputes startOffsetSec server-side so the
// client only needs to send an ordered list of items.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ date: string }> }) {
  const { date } = await ctx.params;
  if (!DATE_RE.test(date)) return badDate();

  let body: { items?: unknown; locked?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Coerce + recompute offsets. We accept whatever the client sends but
  // sanitize against missing fields so a buggy edit can't poison the doc.
  let cursor = 0;
  const SLOT_SEC = 3600;
  const items: ScheduleItem[] = [];
  for (const raw of body.items as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const recordingUrl = typeof raw.recordingUrl === 'string' ? raw.recordingUrl : '';
    const durationSec = Number(raw.durationSec ?? 0);
    if (!recordingUrl || !durationSec) continue;
    const kind = (raw.kind as ScheduleItem['kind']) ?? 'archive';
    const item: ScheduleItem = {
      kind,
      recordingUrl,
      durationSec,
      startOffsetSec: cursor,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      artworkUrl: typeof raw.artworkUrl === 'string' ? raw.artworkUrl : undefined,
      djs: Array.isArray(raw.djs)
        ? (raw.djs as Array<Record<string, unknown>>)
            .filter((d) => typeof d?.name === 'string')
            .map((d) => ({
              name: String(d.name),
              username: typeof d.username === 'string' ? d.username : undefined,
              photoUrl: typeof d.photoUrl === 'string' ? d.photoUrl : undefined,
            }))
        : undefined,
      sceneSlugs: Array.isArray(raw.sceneSlugs)
        ? (raw.sceneSlugs as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined,
      archiveId: typeof raw.archiveId === 'string' ? raw.archiveId : undefined,
      interstitialId: typeof raw.interstitialId === 'string' ? raw.interstitialId : undefined,
    };
    items.push(item);
    // Slotted layout: each archive consumes whole-hour slots based on its
    // duration, matching the cron's auto-fill behaviour.
    const span = Math.max(1, Math.round(durationSec / SLOT_SEC));
    cursor += span * SLOT_SEC;
  }

  const cleanItems = items.map((it) => {
    const obj: Record<string, unknown> = {
      kind: it.kind,
      recordingUrl: it.recordingUrl,
      durationSec: it.durationSec,
      startOffsetSec: it.startOffsetSec,
    };
    if (it.archiveId) obj.archiveId = it.archiveId;
    if (it.interstitialId) obj.interstitialId = it.interstitialId;
    if (it.title) obj.title = it.title;
    if (it.djs?.length) obj.djs = it.djs.map((dj) => {
      const o: Record<string, unknown> = { name: dj.name };
      if (dj.username) o.username = dj.username;
      if (dj.photoUrl) o.photoUrl = dj.photoUrl;
      return o;
    });
    if (it.artworkUrl) obj.artworkUrl = it.artworkUrl;
    if (it.sceneSlugs?.length) obj.sceneSlugs = it.sceneSlugs;
    return obj;
  });

  const startTimeMs = utcDayStartMs(date);
  const generatedAtMs = Date.now();
  const docRef = db.collection(SCHEDULE_COLLECTION).doc(date);
  const update: Record<string, unknown> = {
    date,
    startTime: Timestamp.fromMillis(startTimeMs),
    startTimeMs,
    generatedAt: Timestamp.fromMillis(generatedAtMs),
    generatedAtMs,
    generatedBy: 'admin',
    items: cleanItems,
  };
  if (typeof body.locked === 'boolean') update.locked = body.locked;
  await docRef.set(update, { merge: true });

  return NextResponse.json({ success: true, date, itemCount: cleanItems.length });
}
