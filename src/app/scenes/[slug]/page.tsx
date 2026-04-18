import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';
import { makeOG } from '@/lib/og';
import { fetchSceneBySlugServer } from '@/lib/scenes';
import { ScenePublicClient, type SceneCollective, type SceneDj } from './ScenePublicClient';
import type { SceneSerialized } from '@/types/scenes';

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

interface SceneArchive {
  id: string;
  slug: string;
  showName: string;
  showImageUrl?: string;
  recordedAt: number;
  duration: number;
  djs: Array<{ name: string; username?: string; photoUrl?: string }>;
  effectiveScenes: string[];
}

interface SceneEvent {
  id: string;
  slug: string;
  name: string;
  date: number;
  endDate?: number;
  photo?: string | null;
  venueName?: string | null;
  collectiveName?: string | null;
  location?: string | null;
  ticketLink?: string | null;
  djs: Array<{ djName: string; djUsername?: string; djPhotoUrl?: string }>;
  isPast: boolean;
  effectiveScenes: string[];
}

interface SceneSlot {
  id: string;
  showName: string;
  showImageUrl?: string;
  startTime: number;
  endTime: number;
  djName?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  effectiveScenes: string[];
}

interface ScenePageData {
  scene: SceneSerialized;
  djs: SceneDj[];
  collectives: SceneCollective[];
  archives: SceneArchive[];
  upcomingEvents: SceneEvent[];
  pastEvents: SceneEvent[];
  upcomingSlots: SceneSlot[];
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
      collectives: [],
      archives: [],
      upcomingEvents: [],
      pastEvents: [],
      upcomingSlots: [],
    };
  }

  // DJs (users collection only, role-filtered)
  const djUsersSnap = await db
    .collection('users')
    .where('djProfile.sceneIds', 'array-contains', slug)
    .get();

  const djs: SceneDj[] = [];
  const djScenesByUserId = new Map<string, string[]>();
  const djScenesByUsername = new Map<string, string[]>();
  djUsersSnap.forEach((doc) => {
    const data = doc.data();
    const role = data.role;
    if (role !== 'dj' && role !== 'broadcaster' && role !== 'admin') return;
    const sceneIds: string[] = data.djProfile?.sceneIds ?? [];
    djScenesByUserId.set(doc.id, sceneIds);
    if (data.chatUsernameNormalized) djScenesByUsername.set(data.chatUsernameNormalized, sceneIds);
    djs.push({
      userId: doc.id,
      name: data.displayName || data.chatUsername || '(no name)',
      username: data.chatUsername,
      photoUrl: data.djProfile?.photoUrl,
    });
  });
  djs.sort((a, b) => a.name.localeCompare(b.name));

  // Collectives
  const collectivesSnap = await db
    .collection('collectives')
    .where('sceneIds', 'array-contains', slug)
    .get();

  const collectives: SceneCollective[] = [];
  const collectiveScenesById = new Map<string, string[]>();
  const collectiveScenesBySlug = new Map<string, string[]>();
  collectivesSnap.forEach((doc) => {
    const data = doc.data();
    const sceneIds: string[] = data.sceneIds ?? [];
    collectiveScenesById.set(doc.id, sceneIds);
    if (data.slug) collectiveScenesBySlug.set(data.slug, sceneIds);
    collectives.push({
      id: doc.id,
      slug: data.slug || doc.id,
      name: data.name || doc.id,
      photo: data.photo ?? null,
      location: data.location ?? null,
    });
  });
  collectives.sort((a, b) => a.name.localeCompare(b.name));

  // For archives/events/slots we also need scenes of DJs/collectives that aren't in this
  // scene but might be co-credited with one that is. Simpler approach: load all scene-tagged
  // users+collectives once so inheritance works across multiple scenes.
  const allDjsSnap = await db.collection('users').get();
  const allDjScenesByUsername = new Map<string, string[]>();
  const allDjScenesByUserId = new Map<string, string[]>();
  allDjsSnap.forEach((doc) => {
    const data = doc.data();
    const sceneIds: string[] = data.djProfile?.sceneIds ?? [];
    if (sceneIds.length === 0) return;
    allDjScenesByUserId.set(doc.id, sceneIds);
    if (data.chatUsernameNormalized) allDjScenesByUsername.set(data.chatUsernameNormalized, sceneIds);
  });

  const allCollectivesSnap = await db.collection('collectives').get();
  const allCollectiveScenesById = new Map<string, string[]>();
  const allCollectiveScenesBySlug = new Map<string, string[]>();
  allCollectivesSnap.forEach((doc) => {
    const data = doc.data();
    const sceneIds: string[] = data.sceneIds ?? [];
    if (sceneIds.length === 0) return;
    allCollectiveScenesById.set(doc.id, sceneIds);
    if (data.slug) allCollectiveScenesBySlug.set(data.slug, sceneIds);
  });

  // Archives
  const archivesSnap = await db.collection('archives').get();
  const archives: SceneArchive[] = [];
  archivesSnap.forEach((doc) => {
    const data = doc.data();
    const djList: Array<{ name: string; username?: string; userId?: string; photoUrl?: string }> =
      data.djs ?? [];
    const djUsernames = djList.map((d) => d.username).filter(Boolean) as string[];
    const djUserIds = djList.map((d) => d.userId).filter(Boolean) as string[];

    const djKeys = [
      ...djUserIds.map((id) => `u:${id}`),
      ...djUsernames.map((u) => `n:${u.toLowerCase()}`),
    ];

    // Combine per-archive DJ scenes via username OR userId
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

    archives.push({
      id: doc.id,
      slug: data.slug || doc.id,
      showName: data.showName || '(untitled)',
      showImageUrl: data.showImageUrl,
      recordedAt: typeof data.recordedAt === 'number' ? data.recordedAt : 0,
      duration: typeof data.duration === 'number' ? data.duration : 0,
      djs: djList.map((d) => ({ name: d.name, username: d.username, photoUrl: d.photoUrl })),
      effectiveScenes: effective,
    });
  });
  archives.sort((a, b) => b.recordedAt - a.recordedAt);

  // Events
  const eventsSnap = await db.collection('events').get();
  const now = Date.now();
  const upcomingEvents: SceneEvent[] = [];
  const pastEvents: SceneEvent[] = [];

  eventsSnap.forEach((doc) => {
    const data = doc.data();
    const djList: Array<{ djName: string; djUsername?: string; djUserId?: string; djPhotoUrl?: string }> =
      data.djs ?? [];
    const linkedCollectives: Array<{ id?: string; slug?: string }> = data.linkedCollectives ?? [];

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
    const evt: SceneEvent = {
      id: doc.id,
      slug: data.slug || doc.id,
      name: data.name || '(untitled event)',
      date,
      endDate: typeof data.endDate === 'number' ? data.endDate : undefined,
      photo: data.photo ?? null,
      venueName: data.venueName ?? null,
      collectiveName: data.collectiveName ?? null,
      location: data.location ?? null,
      ticketLink: data.ticketLink ?? null,
      djs: djList.map((d) => ({ djName: d.djName, djUsername: d.djUsername, djPhotoUrl: d.djPhotoUrl })),
      isPast,
      effectiveScenes: effective,
    };
    (isPast ? pastEvents : upcomingEvents).push(evt);
  });
  upcomingEvents.sort((a, b) => a.date - b.date);
  pastEvents.sort((a, b) => b.date - a.date);

  // Upcoming broadcast slots (in the next 60 days)
  const in60Days = now + 60 * 24 * 60 * 60 * 1000;
  const slotsSnap = await db.collection('broadcast-slots').get();
  const upcomingSlots: SceneSlot[] = [];
  slotsSnap.forEach((doc) => {
    const data = doc.data();
    const startTime = toMs(data.startTime);
    const endTime = toMs(data.endTime);
    if (endTime < now || startTime > in60Days) return;

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

    upcomingSlots.push({
      id: doc.id,
      showName: data.showName || '(show)',
      showImageUrl: data.showImageUrl,
      startTime,
      endTime,
      djName: data.djName || data.liveDjUsername,
      djUsername: data.djUsername || data.liveDjUsername,
      djPhotoUrl: data.liveDjPhotoUrl,
      effectiveScenes: effective,
    });
  });
  upcomingSlots.sort((a, b) => a.startTime - b.startTime);

  return { scene, djs, collectives, archives, upcomingEvents, pastEvents, upcomingSlots };
}

export default async function ScenePage({ params }: Props) {
  const { slug } = await params;
  const data = await getScenePageData(slug);
  if (!data) notFound();
  return <ScenePublicClient data={data} />;
}
