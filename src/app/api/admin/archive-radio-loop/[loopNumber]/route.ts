import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  loopDocId,
  LOOP_COLLECTION,
  reflowOffsets,
} from '@/lib/archive-schedule';
import type { ScheduleItem } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

function parseLoopNumber(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function badLoop() {
  return NextResponse.json({ error: 'Invalid loopNumber — expected positive integer' }, { status: 400 });
}

// GET /api/admin/archive-radio-loop/{loopNumber} — fetch a loop's items.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ loopNumber: string }> }) {
  const { loopNumber: raw } = await ctx.params;
  const loopNumber = parseLoopNumber(raw);
  if (loopNumber == null) return badLoop();
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  const snap = await db.collection(LOOP_COLLECTION).doc(loopDocId(loopNumber)).get();
  if (!snap.exists) {
    return NextResponse.json({ exists: false, loopNumber });
  }
  const data = snap.data() ?? {};
  return NextResponse.json({
    exists: true,
    loopNumber,
    startTimeMs: Number(data.startTimeMs ?? 0),
    totalDurationSec: Number(data.totalDurationSec ?? 0),
    generatedAtMs: Number(data.generatedAtMs ?? 0),
    generatedBy: data.generatedBy ?? 'cron',
    locked: Boolean(data.locked),
    catalogStats: data.catalogStats ?? null,
    items: Array.isArray(data.items) ? data.items : [],
  });
}

// PUT /api/admin/archive-radio-loop/{loopNumber} — overwrite a loop's items
// (admin edits in the UI). Recomputes startOffsetSec + totalDurationSec
// server-side so the client only needs to send an ordered list of items.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ loopNumber: string }> }) {
  const { loopNumber: raw } = await ctx.params;
  const loopNumber = parseLoopNumber(raw);
  if (loopNumber == null) return badLoop();

  let body: { items?: unknown; locked?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Metadata-only lock toggle: when no items are sent, update ONLY { locked }.
  // This MUST NOT rewrite items[] — doing so previously round-tripped the loop
  // through the serializer below and corrupted it (interludes relabeled
  // kind:'archive', offsets re-timed without crossfade → late anchor handoff).
  if (body.items === undefined) {
    if (typeof body.locked !== 'boolean') {
      return NextResponse.json({ error: 'items must be an array, or send { locked } alone' }, { status: 400 });
    }
    const docRef = db.collection(LOOP_COLLECTION).doc(loopDocId(loopNumber));
    await docRef.set({ locked: body.locked }, { merge: true });
    return NextResponse.json({ success: true, loopNumber, locked: body.locked });
  }

  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
  }

  // Coerce items, PRESERVING kind/interstitialId. Offsets are recomputed below
  // by reflowOffsets (the shared crossfade-aware pass) — NOT here, so we don't
  // re-derive the timing math and drift it.
  const items: ScheduleItem[] = [];
  for (const raw of body.items as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const recordingUrl = typeof raw.recordingUrl === 'string' ? raw.recordingUrl : '';
    const durationSec = Number(raw.durationSec ?? 0);
    if (!recordingUrl || !durationSec) continue;
    // Preserve the real kind. Default to 'archive' only when truly absent;
    // an item carrying an interstitialId is an interstitial regardless.
    const interstitialId = typeof raw.interstitialId === 'string' ? raw.interstitialId : undefined;
    const kind: ScheduleItem['kind'] =
      raw.kind === 'interstitial' || raw.kind === 'archive'
        ? raw.kind
        : interstitialId
          ? 'interstitial'
          : 'archive';
    const item: ScheduleItem = {
      kind,
      recordingUrl,
      durationSec,
      startOffsetSec: 0, // set by reflowOffsets below
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
      interstitialId,
    };
    items.push(item);
  }

  // Crossfade-aware cumulative offsets + total (same math as generateLoop).
  const totalDurationSec = reflowOffsets(items);

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

  const generatedAtMs = Date.now();
  const docRef = db.collection(LOOP_COLLECTION).doc(loopDocId(loopNumber));
  const update: Record<string, unknown> = {
    loopNumber,
    totalDurationSec,
    generatedAt: Timestamp.fromMillis(generatedAtMs),
    generatedAtMs,
    generatedBy: 'admin',
    items: cleanItems,
  };
  if (typeof body.locked === 'boolean') update.locked = body.locked;
  await docRef.set(update, { merge: true });

  return NextResponse.json({ success: true, loopNumber, itemCount: cleanItems.length, totalDurationSec });
}
