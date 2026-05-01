import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveSerialized } from '@/types/broadcast';

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

// Server-side fetch for the hero carousel. Returns the high-priority archives
// the page seeds with, plus pre-resolved spiral / star picks so those slides
// can render on first paint instead of waiting for client-side scene data.
export async function getHeroArchives(): Promise<HeroSeed> {
  const db = getAdminDb();
  if (!db) return { archives: [], preferredHero: { spiral: null, star: null } };

  try {
    const [archivesSnap, usersSnap] = await Promise.all([
      db.collection('archives').where('priority', '==', 'high').get(),
      db.collection('users').where('role', 'in', ['dj', 'broadcaster', 'admin']).get(),
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

    return {
      archives: seedList,
      preferredHero: { spiral, star },
    };
  } catch (err) {
    console.error('[getHeroArchives] Error:', err);
    return { archives: [], preferredHero: { spiral: null, star: null } };
  }
}
