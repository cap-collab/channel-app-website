import { getAdminDb } from '@/lib/firebase-admin';
import { findCurrentItemInLoop, LOOP_COLLECTION } from '@/lib/archive-schedule';
import { ArchiveSerialized, ArchiveRadioLoop, ScheduleItem } from '@/types/broadcast';

const MIN_DURATION_SECONDS = 2700; // 45 minutes
const PER_SCENE_LIMIT = 5; // last 5 high-priority archives per scene

export interface HeroSeed {
  archives: ArchiveSerialized[];
  // Pre-resolved hero picks so the spiral slide can paint before client-side
  // scene mappings finish loading. Each is one of `archives`.
  preferredHero: {
    spiral: ArchiveSerialized | null;
    star: ArchiveSerialized | null;
  };
  // Archive id of the radio item playing right now. Lets the hero render
  // the correct radio image on first paint, before the client subscribes
  // to the loop collection.
  currentRadioArchiveId: string | null;
}

function resolveScenes(
  archive: { sceneIdsOverride?: string[] | null; djs: Array<{ userId?: string; username?: string }> },
  byUserId: Map<string, string[]>,
  byUsername: Map<string, string[]>,
): string[] {
  if (Array.isArray(archive.sceneIdsOverride)) return archive.sceneIdsOverride;
  const out = new Set<string>();
  for (const dj of archive.djs) {
    if (dj.userId) {
      const s = byUserId.get(dj.userId);
      if (s) for (const id of s) out.add(id);
    }
    if (dj.username) {
      const s = byUsername.get(dj.username.toLowerCase().replace(/\s+/g, ''));
      if (s) for (const id of s) out.add(id);
    }
  }
  return Array.from(out);
}

// Read the latest 2 archive-radio loop docs and resolve which item is playing
// "now". The hero uses this to paint slide 0 with the correct radio archive on
// first render — otherwise we'd fall back to `featuredArchive` and flash a
// different image until the client's Firestore subscription resolves.
async function resolveCurrentRadioArchiveId(
  db: NonNullable<ReturnType<typeof getAdminDb>>,
): Promise<string | null> {
  try {
    const snap = await db
      .collection(LOOP_COLLECTION)
      .orderBy('loopNumber', 'desc')
      .limit(2)
      .get();
    if (snap.empty) return null;
    const now = Date.now();
    const loops: ArchiveRadioLoop[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const itemsRaw = data.items;
      if (!Array.isArray(itemsRaw)) continue;
      const items: ScheduleItem[] = [];
      for (const raw of itemsRaw as Array<Record<string, unknown>>) {
        const kind = raw.kind as ScheduleItem['kind'] | undefined;
        const recordingUrl = raw.recordingUrl as string | undefined;
        const durationSec = Number(raw.durationSec ?? 0);
        const startOffsetSec = Number(raw.startOffsetSec ?? 0);
        if (!kind || !recordingUrl || !durationSec) continue;
        items.push({
          kind,
          archiveId: raw.archiveId as string | undefined,
          interstitialId: raw.interstitialId as string | undefined,
          recordingUrl,
          durationSec,
          startOffsetSec,
        });
      }
      loops.push({
        loopNumber: Number(data.loopNumber ?? 0),
        startTimeMs: Number(data.startTimeMs ?? 0),
        totalDurationSec: Number(data.totalDurationSec ?? 0),
        generatedAtMs: Number(data.generatedAtMs ?? 0),
        generatedBy: (data.generatedBy as 'cron' | 'admin') ?? 'cron',
        locked: Boolean(data.locked),
        catalogStats: { highCount: 0, mediumCount: 0, interstitialCount: 0, totalItems: items.length },
        items,
      });
    }
    // Highest-numbered loop whose start <= now is the currently playing one.
    const playing = loops.find((l) => l.startTimeMs <= now);
    if (!playing) return null;
    const hit = findCurrentItemInLoop(playing, now);
    return hit?.item.archiveId ?? null;
  } catch (err) {
    console.warn('[getHeroArchives] radio loop lookup failed', err);
    return null;
  }
}

// Server-side fetch for the hero carousel. Returns the high-priority archives
// the page seeds with, plus pre-resolved spiral / star picks so those slides
// can render on first paint instead of waiting for client-side scene data.
export async function getHeroArchives(): Promise<HeroSeed> {
  const db = getAdminDb();
  if (!db) return { archives: [], preferredHero: { spiral: null, star: null }, currentRadioArchiveId: null };

  try {
    const [archivesSnap, usersSnap, currentRadioArchiveId] = await Promise.all([
      db.collection('archives').where('priority', '==', 'high').get(),
      db.collection('users').where('role', 'in', ['dj', 'broadcaster', 'admin']).get(),
      resolveCurrentRadioArchiveId(db),
    ]);

    const byUserId = new Map<string, string[]>();
    const byUsername = new Map<string, string[]>();
    usersSnap.forEach((doc) => {
      const data = doc.data();
      const sceneIds: string[] = data?.djProfile?.sceneIds ?? [];
      if (!Array.isArray(sceneIds) || sceneIds.length === 0) return;
      byUserId.set(doc.id, sceneIds);
      const normalized =
        typeof data?.chatUsernameNormalized === 'string'
          ? data.chatUsernameNormalized
          : typeof data?.chatUsername === 'string'
            ? data.chatUsername.toLowerCase().replace(/\s+/g, '')
            : null;
      if (normalized) byUsername.set(normalized, sceneIds);
    });

    const archives: ArchiveSerialized[] = archivesSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          slug: data.slug,
          broadcastSlotId: data.broadcastSlotId,
          showName: data.showName,
          djs: data.djs || [],
          recordingUrl: data.recordingUrl,
          duration: data.duration || 0,
          recordedAt: data.recordedAt,
          createdAt: data.createdAt,
          stationId: data.stationId || 'channel-main',
          showImageUrl: data.showImageUrl,
          streamCount: data.streamCount,
          isPublic: data.isPublic,
          sourceType: data.sourceType,
          publishedAt: data.publishedAt,
          priority: data.priority || 'medium',
          sceneIdsOverride: data.sceneIdsOverride ?? null,
          uploadStatus: data.uploadStatus,
        } as ArchiveSerialized & { uploadStatus?: string };
      })
      .filter((a) => {
        const withStatus = a as ArchiveSerialized & { uploadStatus?: string };
        if (withStatus.uploadStatus === 'uploading') return false;
        if (a.isPublic === false) return false;
        if (a.duration < MIN_DURATION_SECONDS) return false;
        return true;
      })
      .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    const pickFromScene = (slug: string, excludeId?: string): ArchiveSerialized | null => {
      const pool = archives
        .filter((a) => a.id !== excludeId && resolveScenes(a, byUserId, byUsername).includes(slug))
        .slice(0, PER_SCENE_LIMIT);
      if (pool.length === 0) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const spiral = pickFromScene('spiral');
    const star = pickFromScene('star', spiral?.id);

    // Seed list: spiral + star first (so client renders them immediately),
    // then the rest of the high-priority pool capped at 10 total.
    const seedList: ArchiveSerialized[] = [];
    if (spiral) seedList.push(spiral);
    if (star) seedList.push(star);
    for (const a of archives) {
      if (seedList.length >= 10) break;
      if (a.id === spiral?.id || a.id === star?.id) continue;
      seedList.push(a);
    }

    // Make sure the currently-playing radio archive is in the seed list, so
    // slide 0 can render its image on first paint. The loop builder accepts
    // medium-priority archives too, so the radio item may not be in `archives`
    // (which is filtered to high-priority + 45-min+ duration). Fetch the doc
    // directly when missing.
    let resolvedRadioId = currentRadioArchiveId;
    if (currentRadioArchiveId && !seedList.some((a) => a.id === currentRadioArchiveId)) {
      try {
        const doc = await db.collection('archives').doc(currentRadioArchiveId).get();
        if (doc.exists) {
          const data = doc.data() ?? {};
          const archive = {
            id: doc.id,
            slug: data.slug,
            broadcastSlotId: data.broadcastSlotId,
            showName: data.showName,
            djs: data.djs || [],
            recordingUrl: data.recordingUrl,
            duration: data.duration || 0,
            recordedAt: data.recordedAt,
            createdAt: data.createdAt,
            stationId: data.stationId || 'channel-main',
            showImageUrl: data.showImageUrl,
            streamCount: data.streamCount,
            isPublic: data.isPublic,
            sourceType: data.sourceType,
            publishedAt: data.publishedAt,
            priority: data.priority || 'medium',
            sceneIdsOverride: data.sceneIdsOverride ?? null,
          } as ArchiveSerialized;
          seedList.push(archive);
        } else {
          resolvedRadioId = null;
        }
      } catch (err) {
        console.warn('[getHeroArchives] radio archive fetch failed', err);
        resolvedRadioId = null;
      }
    }

    return {
      archives: seedList,
      preferredHero: { spiral, star },
      currentRadioArchiveId: resolvedRadioId,
    };
  } catch (err) {
    console.error('[getHeroArchives] Error:', err);
    return { archives: [], preferredHero: { spiral: null, star: null }, currentRadioArchiveId: null };
  }
}
