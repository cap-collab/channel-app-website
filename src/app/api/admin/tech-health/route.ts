import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { RoomServiceClient, EgressClient, IngressClient } from 'livekit-server-sdk';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
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
  diskUsedGb?: number;
  diskTotalGb?: number;
  diskPct?: number;
  containers?: { name: string; status: string; uptimeSec?: number }[];
  lastJobAt?: number;
  uptimeSec?: number;
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
  error?: string;
}

export interface NormalizeQueueHealth {
  pending: number;
  inProgress: number;
  oldestPendingAgeMin: number | null;
  doneLast24h: number;
  failedLast24h: number;
}

export interface RecentBroadcast {
  slotId: string;
  djName: string;
  startMs: number;
  endMs: number;
  status: string;
  hasIngressId: boolean;
  hasEgressId: boolean;
  hasRecording: boolean;
  isNormalized: boolean;
}

export interface TechHealthResponse {
  generatedAt: number;
  workers: WorkerHealth[];
  livekit: LivekitHealth;
  normalizeQueue: NormalizeQueueHealth;
  recentBroadcasts: RecentBroadcast[];
  upcomingSlots: { slotId: string; djName: string; startMs: number; type: string }[];
}

async function probeWorker(name: string, url: string, secret: string): Promise<WorkerHealth> {
  if (!url) return { name, url, reachable: false, error: 'URL not configured' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      return { name, url, reachable: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return {
      name,
      url,
      reachable: true,
      diskUsedGb: body.diskUsedGb,
      diskTotalGb: body.diskTotalGb,
      diskPct: body.diskPct,
      containers: body.containers,
      lastJobAt: body.lastJobAt,
      uptimeSec: body.uptimeSec,
    };
  } catch (e) {
    return { name, url, reachable: false, error: (e as Error).message };
  }
}

async function probeLivekit(): Promise<LivekitHealth> {
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
      error: (e as Error).message,
    };
  }
}

async function probeNormalizeQueue(): Promise<NormalizeQueueHealth> {
  const db = getAdminDb();
  if (!db) {
    return { pending: 0, inProgress: 0, oldestPendingAgeMin: null, doneLast24h: 0, failedLast24h: 0 };
  }
  const snap = await db.collection('normalize-queue').get();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let pending = 0;
  let inProgress = 0;
  let oldestPendingMs = Infinity;
  let doneLast24h = 0;
  let failedLast24h = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.status === 'pending') {
      pending++;
      const ts = Number(data.queuedAt || 0);
      if (ts > 0 && ts < oldestPendingMs) oldestPendingMs = ts;
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
  return {
    pending,
    inProgress,
    oldestPendingAgeMin: oldestPendingMs === Infinity ? null : Math.round((now - oldestPendingMs) / 60000),
    doneLast24h,
    failedLast24h,
  };
}

async function probeRecentBroadcasts(): Promise<RecentBroadcast[]> {
  const db = getAdminDb();
  if (!db) return [];
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000; // last 7 days
  const snap = await db.collection('broadcast-slots')
    .where('startTime', '>=', Timestamp.fromMillis(cutoff))
    .where('startTime', '<=', Timestamp.fromMillis(now))
    .get();
  const rows: RecentBroadcast[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    rows.push({
      slotId: d.id,
      djName: String(data.djName ?? data.djUsername ?? '?'),
      startMs: (data.startTime as Timestamp).toMillis(),
      endMs: (data.endTime as Timestamp).toMillis(),
      status: String(data.status ?? 'unknown'),
      hasIngressId: !!data.ingressId,
      hasEgressId: !!data.egressId,
      hasRecording: !!data.recordingUrl,
      isNormalized: typeof data.recordingUrl === 'string' && data.recordingUrl.includes('-normalized-v2'),
    });
  }
  rows.sort((a, b) => b.startMs - a.startMs);
  return rows.slice(0, 8);
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

  const cronSecret = process.env.CRON_SECRET ?? '';
  const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL ?? '';
  const youtubeWorkerUrl = process.env.YOUTUBE_RENDER_WORKER_URL ?? '';

  // Probes run in parallel; each one swallows its own errors so the dashboard
  // shows partial data when a probe fails rather than a 500.
  const [workersRestream, workersYoutube, livekit, normalizeQueue, recentBroadcasts, upcomingSlots] = await Promise.all([
    probeWorker('Restream + normalize', restreamWorkerUrl, cronSecret),
    probeWorker('YouTube render', youtubeWorkerUrl, cronSecret),
    probeLivekit(),
    probeNormalizeQueue().catch(() => ({ pending: 0, inProgress: 0, oldestPendingAgeMin: null, doneLast24h: 0, failedLast24h: 0 })),
    probeRecentBroadcasts().catch(() => []),
    probeUpcomingSlots().catch(() => []),
  ]);

  const body: TechHealthResponse = {
    generatedAt: Date.now(),
    workers: [workersRestream, workersYoutube],
    livekit,
    normalizeQueue,
    recentBroadcasts,
    upcomingSlots,
  };
  return NextResponse.json(body);
}
