import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { RoomServiceClient, EgressClient, IngressClient } from 'livekit-server-sdk';
import { getAdminAuth, getAdminDb, getAdminRtdb } from '@/lib/firebase-admin';
import { ROOM_NAME } from '@/types/broadcast';

// Single read-only aggregator for the admin Tech Health tab. Probes every
// workhorse (restream worker VPS, youtube-render worker VPS, LiveKit room,
// Firestore queues, R2-derived signals from Firestore docs) and returns one
// JSON snapshot. Each section catches its own errors so one failing probe
// doesn't blank the whole dashboard.

async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return { isAdmin: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return { isAdmin: role === 'admin' || role === 'broadcaster' };
  } catch {
    return { isAdmin: false };
  }
}

export interface WorkerHealth {
  name: string;
  url: string;
  reachable: boolean;
  disk?: { totalGb: number; usedGb: number; pct: number } | null;
  lastJob?: { at: number | null; ok: boolean | null; kind?: string | null; error?: string | null };
  lastCleanup?: { at: number | null; ok: boolean | null; error?: string | null };
  error?: string;
}

export interface LivekitHealth {
  reachable: boolean;
  isLive: boolean;
  currentDJ: string | null;
  participantCount: number;
  egressCount: number;
  ingressCount: number;
  staleEgressCount: number; // egresses older than 12h
  // Real listener count from Firebase RTDB presence (presence/broadcast). Covers
  // BOTH web (WebRTC) and mobile (HLS) listeners — unlike participantCount, which
  // only sees WebRTC + machinery. null if the presence read failed/unavailable.
  listenerCount: number | null;
  error?: string;
}

export interface NormalizeQueuePendingItem {
  id: string;
  showName: string;
  ageMin: number;
}

export interface NormalizeQueueHealth {
  pending: number;
  inProgress: number;
  oldestPendingAgeMin: number | null;
  doneLast24h: number;
  failedLast24h: number;
  // Pending entries with their resolved show name, oldest first. Show name is
  // joined from the archive (artist uploads carry archiveId) or the broadcast
  // slot (live recordings carry slotId); the queue doc itself has neither.
  pendingItems: NormalizeQueuePendingItem[];
}

export interface R2Stats {
  generatedAt: number;
  totalObjects: number;
  referenced: { count: number; bytes: number };
  hls: { count: number; bytes: number };
  test: { count: number; bytes: number };
  orphan: { count: number; bytes: number };
}

export interface R2BackupStatus {
  ranAt: number;
  totalOriginals: number;
  copiedCount: number;
  skippedExisting: number;
  missingFromSourceCount: number;
  missingFromSource: string[];
  errorCount: number;
  errors: { key: string; error: string }[];
}

export interface TechHealthResponse {
  generatedAt: number;
  workers: WorkerHealth[];
  livekit: LivekitHealth;
  normalizeQueue: NormalizeQueueHealth;
  upcomingSlots: { slotId: string; djName: string; startMs: number; type: string }[];
  r2Stats: R2Stats | null;
  r2Backup: R2BackupStatus | null;
}

async function probeWorker(name: string, url: string): Promise<WorkerHealth> {
  if (!url) return { name, url, reachable: false, error: 'URL not configured' };
  try {
    // 20s timeout: the worker's event loop can be briefly blocked during
    // ffmpeg spawn or large R2 stream pulls. A short timeout produces
    // misleading "unreachable" flashes during legitimate work — 20s gives
    // it room to answer while still catching real outages.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${url}/health`, { method: 'GET', signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { name, url, reachable: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      name,
      url,
      reachable: true,
      disk: body.disk ?? null,
      lastJob: body.lastJob,
      lastCleanup: body.lastCleanup,
    };
  } catch (e) {
    return { name, url, reachable: false, error: (e as Error).message };
  }
}

// Real listener count from Firebase RTDB presence. Each playing listener (web OR
// mobile/HLS) writes presence/broadcast/<sessionId>; the count is the number of
// children. RTDB is separate infra from LiveKit/audio, so this read adds zero load
// on the streams. Returns null on any failure (so the panel shows "n/a", never errors).
async function readListenerCount(): Promise<number | null> {
  try {
    const rtdb = getAdminRtdb();
    if (!rtdb) return null;
    const snap = await rtdb.ref('presence/broadcast').once('value');
    return snap.numChildren();
  } catch {
    return null;
  }
}

async function probeLivekit(): Promise<LivekitHealth> {
  // Read listener count independently of the LiveKit probe so a LiveKit failure
  // doesn't hide the listener number (and vice-versa).
  const listenerCount = await readListenerCount();
  const host = process.env.LIVEKIT_URL?.replace('wss://', 'https://') ?? '';
  const apiKey = process.env.LIVEKIT_API_KEY ?? '';
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  if (!host || !apiKey || !apiSecret) {
    return {
      reachable: false,
      isLive: false,
      currentDJ: null,
      participantCount: 0,
      egressCount: 0,
      ingressCount: 0,
      staleEgressCount: 0,
      listenerCount,
      error: 'LiveKit not configured',
    };
  }
  try {
    const roomService = new RoomServiceClient(host, apiKey, apiSecret);
    const egressClient = new EgressClient(host, apiKey, apiSecret);
    const ingressClient = new IngressClient(host, apiKey, apiSecret);
    const [participants, egresses, ingresses] = await Promise.all([
      roomService.listParticipants(ROOM_NAME),
      egressClient.listEgress({ roomName: ROOM_NAME }),
      ingressClient.listIngress({ roomName: ROOM_NAME }),
    ]);
    const publishing = participants.filter((p) => p.tracks.some((t) => !t.muted));
    const staleThresholdMs = Date.now() - 12 * 60 * 60 * 1000;
    const staleEgressCount = egresses.filter((e) => {
      const startedAt = Number(e.startedAt) / 1_000_000; // proto returns ns
      return startedAt > 0 && startedAt < staleThresholdMs;
    }).length;
    return {
      reachable: true,
      isLive: publishing.length > 0,
      currentDJ: publishing[0]?.identity ?? null,
      participantCount: participants.length,
      egressCount: egresses.length,
      ingressCount: ingresses.length,
      staleEgressCount,
      listenerCount,
    };
  } catch (e) {
    return {
      reachable: false,
      isLive: false,
      currentDJ: null,
      participantCount: 0,
      egressCount: 0,
      ingressCount: 0,
      staleEgressCount: 0,
      listenerCount,
      error: (e as Error).message,
    };
  }
}

async function probeNormalizeQueue(): Promise<NormalizeQueueHealth> {
  const db = getAdminDb();
  if (!db) {
    return { pending: 0, inProgress: 0, oldestPendingAgeMin: null, doneLast24h: 0, failedLast24h: 0, pendingItems: [] };
  }
  const snap = await db.collection('normalize-queue').get();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let pending = 0;
  let inProgress = 0;
  let oldestPendingMs = Infinity;
  let doneLast24h = 0;
  let failedLast24h = 0;
  const pendingDocs: Array<{ id: string; archiveId?: string; slotId?: string; queuedAt: number }> = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.status === 'pending') {
      pending++;
      const ts = Number(data.queuedAt || 0);
      if (ts > 0 && ts < oldestPendingMs) oldestPendingMs = ts;
      pendingDocs.push({ id: d.id, archiveId: data.archiveId, slotId: data.slotId, queuedAt: ts });
    } else if (data.status === 'in-progress') {
      inProgress++;
    } else if (data.status === 'done') {
      const ts = Number(data.doneAt || 0);
      if (ts >= dayAgo) doneLast24h++;
    } else if (data.status === 'failed') {
      const ts = Number(data.lastAttemptAt || 0);
      if (ts >= dayAgo) failedLast24h++;
    }
  }

  // Resolve a show name for each pending entry. Artist uploads carry archiveId
  // (archives doc has showName); live recordings carry slotId (broadcast-slots
  // doc has showName). Fall back to the id if the join comes up empty.
  const pendingItems: NormalizeQueuePendingItem[] = await Promise.all(
    pendingDocs
      .sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0)) // oldest first
      .map(async (entry) => {
        let showName = '';
        try {
          if (entry.archiveId) {
            const doc = await db.collection('archives').doc(entry.archiveId).get();
            showName = (doc.data()?.showName as string) || '';
          } else if (entry.slotId) {
            const doc = await db.collection('broadcast-slots').doc(entry.slotId).get();
            showName = (doc.data()?.showName as string) || '';
          }
        } catch {
          // leave showName empty; fall back below
        }
        return {
          id: entry.id,
          showName: showName || `(unknown — ${entry.id})`,
          ageMin: entry.queuedAt > 0 ? Math.round((now - entry.queuedAt) / 60000) : 0,
        };
      })
  );

  return {
    pending,
    inProgress,
    oldestPendingAgeMin: oldestPendingMs === Infinity ? null : Math.round((now - oldestPendingMs) / 60000),
    doneLast24h,
    failedLast24h,
    pendingItems,
  };
}

async function probeR2Stats(): Promise<R2Stats | null> {
  const db = getAdminDb();
  if (!db) return null;
  const doc = await db.collection('system').doc('r2-stats').get();
  if (!doc.exists) return null;
  return doc.data() as R2Stats;
}

async function probeR2Backup(): Promise<R2BackupStatus | null> {
  const db = getAdminDb();
  if (!db) return null;
  const doc = await db.collection('system').doc('r2-backup-status').get();
  if (!doc.exists) return null;
  return doc.data() as R2BackupStatus;
}

async function probeUpcomingSlots(): Promise<{ slotId: string; djName: string; startMs: number; type: string }[]> {
  const db = getAdminDb();
  if (!db) return [];
  const now = Date.now();
  const horizon = now + 12 * 60 * 60 * 1000;
  const snap = await db.collection('broadcast-slots')
    .where('startTime', '>=', Timestamp.fromMillis(now))
    .where('startTime', '<=', Timestamp.fromMillis(horizon))
    .get();
  const rows: { slotId: string; djName: string; startMs: number; type: string }[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.status !== 'scheduled') continue;
    rows.push({
      slotId: d.id,
      djName: String(data.djName ?? data.djUsername ?? '?'),
      startMs: (data.startTime as Timestamp).toMillis(),
      type: String(data.broadcastType ?? 'live'),
    });
  }
  rows.sort((a, b) => a.startMs - b.startMs);
  return rows.slice(0, 6);
}

export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL ?? '';
  const youtubeWorkerUrl = process.env.YOUTUBE_RENDER_WORKER_URL ?? '';

  // Probes run in parallel; each one swallows its own errors so the dashboard
  // shows partial data when a probe fails rather than a 500.
  const [workersRestream, workersYoutube, livekit, normalizeQueue, upcomingSlots, r2Stats, r2Backup] = await Promise.all([
    probeWorker('Restream + normalize', restreamWorkerUrl),
    probeWorker('YouTube render', youtubeWorkerUrl),
    probeLivekit(),
    probeNormalizeQueue().catch(() => ({ pending: 0, inProgress: 0, oldestPendingAgeMin: null, doneLast24h: 0, failedLast24h: 0, pendingItems: [] })),
    probeUpcomingSlots().catch(() => []),
    probeR2Stats().catch(() => null),
    probeR2Backup().catch(() => null),
  ]);

  const body: TechHealthResponse = {
    generatedAt: Date.now(),
    workers: [workersRestream, workersYoutube],
    livekit,
    normalizeQueue,
    upcomingSlots,
    r2Stats,
    r2Backup,
  };
  return NextResponse.json(body);
}
