'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizeUsername } from '@/lib/dj-matching';
import type { SceneSerialized } from '@/types/scenes';

// Client-side scene data: the list of scenes + a map of DJ keys (userId AND
// normalized chatUsername) to their sceneIds. Used on the homepage to decorate
// archive cards with scene emojis and filter by scene.
export interface DjSceneMap {
  byUserId: Map<string, string[]>;
  byUsername: Map<string, string[]>; // normalized (lowercase, no whitespace)
  // Collective slug (normalized) → owner's sceneIds. Lets a collective/B2B
  // archive (whose djs[].username is the collective slug, not a real
  // chatUsername) inherit the owner's scene without needing djs[].userId on the
  // payload (which is stripped as PII).
  byCollectiveSlug: Map<string, string[]>;
}

export function useScenesData() {
  const [scenes, setScenes] = useState<SceneSerialized[]>([]);
  const [djSceneMap, setDjSceneMap] = useState<DjSceneMap>({
    byUserId: new Map(),
    byUsername: new Map(),
    byCollectiveSlug: new Map(),
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const scenesRes = await fetch('/api/admin/scenes');
        const scenesData = await scenesRes.json();
        const scenesList: SceneSerialized[] = scenesData.scenes || [];
        if (cancelled) return;
        setScenes(scenesList);

        if (!db || scenesList.length === 0) {
          setDjSceneMap({ byUserId: new Map(), byUsername: new Map(), byCollectiveSlug: new Map() });
          setLoading(false);
          return;
        }

        // Query users who have any scene tag — public read allowed by rules
        // for DJ/broadcaster/admin roles.
        const q = query(
          collection(db, 'users'),
          where('role', 'in', ['dj', 'broadcaster', 'admin'])
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const byUserId = new Map<string, string[]>();
        const byUsername = new Map<string, string[]>();
        const byCollectiveSlug = new Map<string, string[]>();
        snap.forEach((doc) => {
          const data = doc.data();
          const sceneIds: string[] = data?.djProfile?.sceneIds ?? [];
          if (!Array.isArray(sceneIds) || sceneIds.length === 0) return;
          byUserId.set(doc.id, sceneIds);
          const normalized =
            typeof data?.chatUsernameNormalized === 'string'
              ? data.chatUsernameNormalized
              : typeof data?.chatUsername === 'string'
                ? normalizeUsername(data.chatUsername)
                : null;
          if (normalized) byUsername.set(normalized, sceneIds);
          // Owned collectives inherit this owner's scene. Keyed by normalized
          // slug so it matches an archive's djs[].username (the collective slug).
          const owned = data?.ownedCollectiveSlugs;
          if (Array.isArray(owned)) {
            for (const slug of owned) {
              if (typeof slug !== 'string' || !slug) continue;
              const key = normalizeUsername(slug);
              if (!key) continue;
              // Union in case multiple owners of one collective have scenes.
              const existing = byCollectiveSlug.get(key) ?? [];
              byCollectiveSlug.set(key, Array.from(new Set([...existing, ...sceneIds])));
            }
          }
        });
        setDjSceneMap({ byUserId, byUsername, byCollectiveSlug });
      } catch (err) {
        console.warn('[useScenesData] failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { scenes, djSceneMap, loading };
}

// Resolve effective scenes for an archive given its DJ list + an override.
export function resolveArchiveScenes(
  archive: {
    sceneIdsOverride?: string[] | null;
    sceneSlugs?: string[];
    djs: Array<{ userId?: string; username?: string }>;
  },
  djSceneMap: DjSceneMap
): string[] {
  if (Array.isArray(archive.sceneIdsOverride)) {
    return archive.sceneIdsOverride;
  }
  const out = new Set<string>();
  for (const dj of archive.djs) {
    // userId may be absent on listener payloads (stripped as PII) — kept here
    // for callers that still have it (admin/server).
    if (dj.userId) {
      const s = djSceneMap.byUserId.get(dj.userId);
      if (s) for (const id of s) out.add(id);
    }
    if (dj.username) {
      const norm = normalizeUsername(dj.username);
      const s = djSceneMap.byUsername.get(norm);
      if (s) for (const id of s) out.add(id);
      // Collective/B2B archives credit the collective slug in username — resolve
      // the scene via the owning DJ(s) so the glyph shows without djs[].userId.
      const c = djSceneMap.byCollectiveSlug.get(norm);
      if (c) for (const id of c) out.add(id);
    }
  }
  // Belt-and-suspenders: if the DJ/collective lookup found nothing (e.g. a
  // collective with no owned-slug mapping, or a DJ not yet in the scene map),
  // fall back to the archive's own denormalized sceneSlugs snapshot — the same
  // fallback the server recs path (normalize.ts effectiveScenes) uses.
  if (out.size === 0 && Array.isArray(archive.sceneSlugs)) {
    for (const id of archive.sceneSlugs) out.add(id);
  }
  return Array.from(out);
}
