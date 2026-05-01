import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';
import { makeOG } from '@/lib/og';
import { fetchSceneBySlugServer } from '@/lib/scenes';
import {
  ScenePublicClient,
  type SceneCollective,
  type SceneDj,
  type SceneEvent,
  type SceneResident,
  type SceneSlot,
  type ResidencyCadence,
} from './ScenePublicClient';
import type { SceneSerialized } from '@/types/scenes';
import type { ArchiveSerialized } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const scene = await fetchSceneBySlugServer(slug);
  if (!scene) {
    return makeOG({ title: 'Channel — Scene not found' });
  }
  return makeOG({
    title: `Channel — ${scene.emoji} ${scene.name}`,
    description: scene.description,
  });
}

interface ScenePageData {
  scene: SceneSerialized;
  djs: SceneDj[];
  residents: SceneResident[];
  collectives: SceneCollective[];
  archives: ArchiveSerialized[];
  upcomingEvents: SceneEvent[];
  pastEvents: SceneEvent[];
  upcomingSlots: SceneSlot[];
  pastSlots: SceneSlot[];
}

function toMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function resolveContentScenes(
  override: unknown,
  djScenes: Map<string, string[]>,
  collectiveScenes: Map<string, string[]>,
  djKeys: string[],
  collectiveKeys: string[]
): string[] {
  if (Array.isArray(override)) return override as string[];
  const merged = new Set<string>();
  for (const k of djKeys) for (const s of djScenes.get(k) ?? []) merged.add(s);
  for (const k of collectiveKeys) for (const s of collectiveScenes.get(k) ?? []) merged.add(s);
  return Array.from(merged);
}

async function getScenePageData(slug: string): Promise<ScenePageData | null> {
  const scene = await fetchSceneBySlugServer(slug);
  if (!scene) return null;

  const db = getAdminDb();
  if (!db) {
    return {
      scene,
      djs: [],
      residents: [],
      collectives: [],
      archives: [],
      upcomingEvents: [],
      pastEvents: [],
      upcomingSlots: [],
      pastSlots: [],
    };
  }

  // DJs tagged directly with this scene (users collection only, role-filtered).
  const djUsersSnap = await db
    .collection('users')
    .where('djProfile.sceneIds', 'array-contains', slug)
    .get();

  const djs: SceneDj[] = [];
  // Scene-DJ residency state, indexed both by userId and lowercase username so we
  // can match slots regardless of which identifier they carry.
  const residencyByUserId = new Map<string, ResidencyCadence>();
  const residencyByUsername = new Map<string, ResidencyCadence>();
  // Keep the SceneDj record for residents so the section below can render
  // photo + name without re-querying the user doc.
  const residentDjBase = new Map<string, SceneDj>();
  djUsersSnap.forEach((doc) => {
    const data = doc.data();
    const role = data.role;
    if (role !== 'dj' && role !== 'broadcaster' && role !== 'admin') return;
    // Prefer the DJ name (chatUsername / stage name). Fall back to displayName only
    // if there is no chatUsername.
    const sceneDj: SceneDj = {
      userId: doc.id,
      name: data.chatUsername || data.displayName || '(no name)',
      username: data.chatUsername,
      photoUrl: data.djProfile?.photoUrl,
    };
    djs.push(sceneDj);

    const cadenceRaw = data.djProfile?.residency?.cadence;
    if (cadenceRaw === 'monthly' || cadenceRaw === 'quarterly') {
      residencyByUserId.set(doc.id, cadenceRaw);
      const username = (data.chatUsernameNormalized || data.chatUsername || '').toLowerCase();
      if (username) residencyByUsername.set(username, cadenceRaw);
      residentDjBase.set(doc.id, sceneDj);
    }
  });
  djs.sort((a, b) => a.name.localeCompare(b.name));

  // Collectives tagged with this scene.
  const collectivesSnap = await db
    .collection('collectives')
    .where('sceneIds', 'array-contains', slug)
    .get();

  const collectives: SceneCollective[] = [];
  collectivesSnap.forEach((doc) => {
    const data = doc.data();
    collectives.push({
      id: doc.id,
      slug: data.slug || doc.id,
      name: data.name || doc.id,
      photo: data.photo ?? null,
      location: data.location ?? null,
    });
  });
  collectives.sort((a, b) => a.name.localeCompare(b.name));

  // For inheritance resolution on content, load every scene-tagged DJ and collective once.
  const allDjScenesByUsername = new Map<string, string[]>();
  const allDjScenesByUserId = new Map<string, string[]>();
  const allDjPhotoByUsername = new Map<string, string>();
  const allDjPhotoByUserId = new Map<string, string>();

  const allDjsSnap = await db.collection('users').get();
  allDjsSnap.forEach((doc) => {
    const data = doc.data();
    const sceneIds: string[] = data.djProfile?.sceneIds ?? [];
    const username = (data.chatUsernameNormalized || data.chatUsername || '').toLowerCase();
    const photo = data.djProfile?.photoUrl;
    if (sceneIds.length > 0) {
      allDjScenesByUserId.set(doc.id, sceneIds);
      if (username) allDjScenesByUsername.set(username, sceneIds);
    }
    if (photo) {
      allDjPhotoByUserId.set(doc.id, photo);
      if (username) allDjPhotoByUsername.set(username, photo);
    }
  });

  const allCollectiveScenesById = new Map<string, string[]>();
  const allCollectiveScenesBySlug = new Map<string, string[]>();
  const allCollectivesSnap = await db.collection('collectives').get();
  allCollectivesSnap.forEach((doc) => {
    const data = doc.data();
    const sceneIds: string[] = data.sceneIds ?? [];
    if (sceneIds.length === 0) return;
    allCollectiveScenesById.set(doc.id, sceneIds);
    if (data.slug) allCollectiveScenesBySlug.set(data.slug, sceneIds);
  });

  // Archives in this scene + a global index of which slots already have a recording.
  const archivesSnap = await db.collection('archives').get();
  const archives: ArchiveSerialized[] = [];
  const slotIdsWithRecording = new Set<string>();
  archivesSnap.forEach((doc) => {
    const data = doc.data();
    if (typeof data.broadcastSlotId === 'string' && data.broadcastSlotId) {
      slotIdsWithRecording.add(data.broadcastSlotId);
    }
  });
  archivesSnap.forEach((doc) => {
    const data = doc.data();
    const djList: Array<{
      name: string;
      username?: string;
      userId?: string;
      email?: string;
      photoUrl?: string;
      genres?: string[];
      location?: string;
    }> = data.djs ?? [];
    const djUsernames = djList.map((d) => d.username).filter(Boolean) as string[];
    const djUserIds = djList.map((d) => d.userId).filter(Boolean) as string[];

    const djKeys = [
      ...djUserIds.map((id) => `u:${id}`),
      ...djUsernames.map((u) => `n:${u.toLowerCase()}`),
    ];
    const djScenesLookup = new Map<string, string[]>();
    djUserIds.forEach((id) => {
      const s = allDjScenesByUserId.get(id);
      if (s) djScenesLookup.set(`u:${id}`, s);
    });
    djUsernames.forEach((u) => {
      const s = allDjScenesByUsername.get(u.toLowerCase());
      if (s) djScenesLookup.set(`n:${u.toLowerCase()}`, s);
    });

    const effective = resolveContentScenes(
      data.sceneIdsOverride,
      djScenesLookup,
      new Map(),
      djKeys,
      []
    );
    if (!effective.includes(slug)) return;

    // Hidden archives are the strongest exclusion tier — drop them from
    // public scene pages entirely (admin keeps visibility via the Archives
    // tab, which calls /api/archives?includeHidden=true).
    if (data.priority === 'hidden') return;

    const enrichedDjs = djList.map((d) => ({
      name: d.name,
      username: d.username,
      userId: d.userId,
      email: d.email,
      photoUrl:
        d.photoUrl ||
        (d.userId && allDjPhotoByUserId.get(d.userId)) ||
        (d.username && allDjPhotoByUsername.get(d.username.toLowerCase())) ||
        undefined,
      genres: d.genres,
      location: d.location,
    }));

    archives.push({
      id: doc.id,
      slug: data.slug || doc.id,
      broadcastSlotId: data.broadcastSlotId || '',
      showName: data.showName || '(untitled)',
      djs: enrichedDjs,
      recordingUrl: data.recordingUrl || '',
      duration: typeof data.duration === 'number' ? data.duration : 0,
      recordedAt: typeof data.recordedAt === 'number' ? data.recordedAt : 0,
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
      stationId: data.stationId || 'channel-main',
      showImageUrl: data.showImageUrl,
      streamCount: typeof data.streamCount === 'number' ? data.streamCount : undefined,
      isPublic: typeof data.isPublic === 'boolean' ? data.isPublic : undefined,
      sourceType: data.sourceType,
      publishedAt: typeof data.publishedAt === 'number' ? data.publishedAt : undefined,
      priority: data.priority,
    });
  });
  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, hidden: 3 };
  archives.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority || 'medium'] ?? 1;
    const pb = PRIORITY_ORDER[b.priority || 'medium'] ?? 1;
    if (pa !== pb) return pa - pb;
    return b.recordedAt - a.recordedAt;
  });

  // Events in this scene (past + upcoming, all types).
  const eventsSnap = await db.collection('events').get();
  const now = Date.now();
  const upcomingEvents: SceneEvent[] = [];
  const pastEvents: SceneEvent[] = [];

  eventsSnap.forEach((doc) => {
    const data = doc.data();
    const djList: Array<{
      djName: string;
      djUsername?: string;
      djUserId?: string;
      djPhotoUrl?: string;
    }> = data.djs ?? [];
    const linkedCollectives: Array<{ id?: string; slug?: string; name?: string }> =
      data.linkedCollectives ?? [];

    const djKeys: string[] = [];
    const djScenesLookup = new Map<string, string[]>();
    djList.forEach((d) => {
      if (d.djUserId) {
        const key = `u:${d.djUserId}`;
        djKeys.push(key);
        const s = allDjScenesByUserId.get(d.djUserId);
        if (s) djScenesLookup.set(key, s);
      }
      if (d.djUsername) {
        const key = `n:${d.djUsername.toLowerCase()}`;
        djKeys.push(key);
        const s = allDjScenesByUsername.get(d.djUsername.toLowerCase());
        if (s) djScenesLookup.set(key, s);
      }
    });

    const collectiveKeys: string[] = [];
    const collectiveScenesLookup = new Map<string, string[]>();
    if (data.collectiveId) {
      const key = `c:${data.collectiveId}`;
      collectiveKeys.push(key);
      const s = allCollectiveScenesById.get(data.collectiveId);
      if (s) collectiveScenesLookup.set(key, s);
    }
    linkedCollectives.forEach((c) => {
      if (c.id) {
        const key = `c:${c.id}`;
        collectiveKeys.push(key);
        const s = allCollectiveScenesById.get(c.id);
        if (s) collectiveScenesLookup.set(key, s);
      } else if (c.slug) {
        const key = `cs:${c.slug}`;
        collectiveKeys.push(key);
        const s = allCollectiveScenesBySlug.get(c.slug);
        if (s) collectiveScenesLookup.set(key, s);
      }
    });

    const effective = resolveContentScenes(
      data.sceneIdsOverride,
      djScenesLookup,
      collectiveScenesLookup,
      djKeys,
      collectiveKeys
    );
    if (!effective.includes(slug)) return;

    const date = typeof data.date === 'number' ? data.date : 0;
    const isPast = date < now;

    const enrichedDjs = djList.map((d) => ({
      djName: d.djName,
      djUsername: d.djUsername,
      djPhotoUrl:
        d.djPhotoUrl ||
        (d.djUserId && allDjPhotoByUserId.get(d.djUserId)) ||
        (d.djUsername && allDjPhotoByUsername.get(d.djUsername.toLowerCase())) ||
        undefined,
    }));

    const linkedCollectivesForClient = (
      data.linkedCollectives as
        | Array<{ collectiveId?: string; collectiveName?: string; collectiveSlug?: string }>
        | undefined
    )?.map((c) => ({
      collectiveId: c.collectiveId,
      collectiveName: c.collectiveName,
      collectiveSlug: c.collectiveSlug,
    }));

    const evt: SceneEvent = {
      id: doc.id,
      slug: data.slug || doc.id,
      name: data.name || '(untitled event)',
      date,
      endDate: typeof data.endDate === 'number' ? data.endDate : undefined,
      photo: data.photo ?? null,
      venueName: data.venueName ?? null,
      collectiveName: data.collectiveName ?? null,
      collectiveSlug: null,
      location: data.location ?? null,
      ticketLink: data.ticketLink ?? null,
      djs: enrichedDjs,
      linkedCollectives: linkedCollectivesForClient,
      isPast,
    };
    (isPast ? pastEvents : upcomingEvents).push(evt);
  });
  upcomingEvents.sort((a, b) => a.date - b.date);
  pastEvents.sort((a, b) => b.date - a.date);

  // Broadcast slots in this scene (upcoming next 60 days + past 90 days).
  const in60Days = now + 60 * 24 * 60 * 60 * 1000;
  const since90Days = now - 90 * 24 * 60 * 60 * 1000;
  const slotsSnap = await db.collection('broadcast-slots').get();
  const upcomingSlots: SceneSlot[] = [];
  const pastSlots: SceneSlot[] = [];
  slotsSnap.forEach((doc) => {
    const data = doc.data();
    const startTime = toMs(data.startTime);
    const endTime = toMs(data.endTime);
    if (endTime < since90Days || startTime > in60Days) return;
    if (data.status === 'cancelled' || data.broadcastType === 'recording') return;

    const djKeys: string[] = [];
    const djScenesLookup = new Map<string, string[]>();
    if (data.djUserId) {
      const key = `u:${data.djUserId}`;
      djKeys.push(key);
      const s = allDjScenesByUserId.get(data.djUserId);
      if (s) djScenesLookup.set(key, s);
    }
    if (data.djUsername) {
      const key = `n:${data.djUsername.toLowerCase()}`;
      djKeys.push(key);
      const s = allDjScenesByUsername.get(data.djUsername.toLowerCase());
      if (s) djScenesLookup.set(key, s);
    }
    const djSlots: Array<{ djUserId?: string; djUsername?: string }> = data.djSlots ?? [];
    djSlots.forEach((d) => {
      if (d.djUserId) {
        const key = `u:${d.djUserId}`;
        djKeys.push(key);
        const s = allDjScenesByUserId.get(d.djUserId);
        if (s) djScenesLookup.set(key, s);
      }
      if (d.djUsername) {
        const key = `n:${d.djUsername.toLowerCase()}`;
        djKeys.push(key);
        const s = allDjScenesByUsername.get(d.djUsername.toLowerCase());
        if (s) djScenesLookup.set(key, s);
      }
    });

    const effective = resolveContentScenes(
      data.sceneIdsOverride,
      djScenesLookup,
      new Map(),
      djKeys,
      []
    );
    if (!effective.includes(slug)) return;

    const djUsernameRaw = (data.djUsername || data.liveDjUsername) as string | undefined;
    const djUsernameLower = djUsernameRaw?.toLowerCase();
    const djPhotoResolved =
      (data.liveDjPhotoUrl as string | undefined) ||
      (data.djUserId && allDjPhotoByUserId.get(data.djUserId)) ||
      (djUsernameLower && allDjPhotoByUsername.get(djUsernameLower)) ||
      undefined;

    const isPastSlot = endTime < now;
    // Hide past Channel broadcasts that already have a recording — the archive row
    // (rendered as a "Recording" card above) already represents them.
    if (isPastSlot && slotIdsWithRecording.has(doc.id)) return;

    const slot: SceneSlot = {
      id: doc.id,
      showName: data.showName || '(show)',
      showImageUrl: data.showImageUrl,
      startTime,
      endTime,
      djName: data.djName || data.liveDjUsername,
      djUsername: djUsernameRaw,
      djPhotoUrl: djPhotoResolved,
      isPast: isPastSlot,
    };
    (slot.isPast ? pastSlots : upcomingSlots).push(slot);
  });
  upcomingSlots.sort((a, b) => a.startTime - b.startTime);
  pastSlots.sort((a, b) => b.startTime - a.startTime);

  // Compute residents — DJs in this scene with a residency cadence set, plus
  // their next-slot status. We sweep slotsSnap once and pick the soonest
  // upcoming slot per resident (any scene/show counts; the marker only signals
  // whether the resident is on Channel's calendar at all).
  const nextSlotByUserId = new Map<string, number>();
  const nextSlotByUsername = new Map<string, number>();
  const recordHit = (key: string, ts: number, map: Map<string, number>) => {
    const existing = map.get(key);
    if (existing === undefined || ts < existing) map.set(key, ts);
  };
  slotsSnap.forEach((doc) => {
    const data = doc.data();
    const startTime = toMs(data.startTime);
    if (startTime <= now) return;
    if (data.status === 'cancelled' || data.broadcastType === 'recording') return;

    if (data.djUserId && residencyByUserId.has(data.djUserId)) {
      recordHit(data.djUserId, startTime, nextSlotByUserId);
    }
    if (data.djUsername) {
      const u = (data.djUsername as string).toLowerCase();
      if (residencyByUsername.has(u)) recordHit(u, startTime, nextSlotByUsername);
    }
    const djSlots: Array<{ djUserId?: string; djUsername?: string }> = data.djSlots ?? [];
    djSlots.forEach((d) => {
      if (d.djUserId && residencyByUserId.has(d.djUserId)) {
        recordHit(d.djUserId, startTime, nextSlotByUserId);
      }
      if (d.djUsername) {
        const u = d.djUsername.toLowerCase();
        if (residencyByUsername.has(u)) recordHit(u, startTime, nextSlotByUsername);
      }
    });
  });

  const CADENCE_WINDOW_MS: Record<ResidencyCadence, number> = {
    monthly: 35 * 24 * 60 * 60 * 1000,
    quarterly: 95 * 24 * 60 * 60 * 1000,
  };

  const residents: SceneResident[] = [];
  for (const [userId, base] of Array.from(residentDjBase.entries())) {
    const cadence = residencyByUserId.get(userId);
    if (!cadence) continue;
    const usernameLower = base.username?.toLowerCase();
    const candidates: number[] = [];
    const a = nextSlotByUserId.get(userId);
    if (a !== undefined) candidates.push(a);
    if (usernameLower) {
      const b = nextSlotByUsername.get(usernameLower);
      if (b !== undefined) candidates.push(b);
    }
    const next = candidates.length ? Math.min(...candidates) : undefined;
    const inWindow = next !== undefined && next - now <= CADENCE_WINDOW_MS[cadence];
    residents.push({
      userId,
      name: base.name,
      username: base.username,
      photoUrl: base.photoUrl,
      cadence,
      status: inWindow ? 'scheduled' : 'pending',
      nextSlotStart: inWindow ? next : undefined,
    });
  }
  residents.sort((a, b) => {
    // Scheduled first (sorted by soonest slot), pending after (alpha).
    if (a.status !== b.status) return a.status === 'scheduled' ? -1 : 1;
    if (a.status === 'scheduled') return (a.nextSlotStart ?? 0) - (b.nextSlotStart ?? 0);
    return a.name.localeCompare(b.name);
  });

  return {
    scene,
    djs,
    residents,
    collectives,
    archives,
    upcomingEvents,
    pastEvents,
    upcomingSlots,
    pastSlots,
  };
}

export default async function ScenePage({ params }: Props) {
  const { slug } = await params;
  const data = await getScenePageData(slug);
  if (!data) notFound();
  return <ScenePublicClient data={data} />;
}
