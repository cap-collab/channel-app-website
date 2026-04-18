'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { SceneSerialized } from '@/types/scenes';

// Client-side scene data: the list of scenes + a map of DJ keys (userId AND
// normalized chatUsername) to their sceneIds. Used on /radio to decorate
// archive cards with scene emojis and filter by scene.
export interface DjSceneMap {
  byUserId: Map<string, string[]>;
  byUsername: Map<string, string[]>; // normalized (lowercase, no whitespace)
}

export function useScenesData() {
  const [scenes, setScenes] = useState<SceneSerialized[]>([]);
  const [djSceneMap, setDjSceneMap] = useState<DjSceneMap>({
    byUserId: new Map(),
    byUsername: new Map(),
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
          setDjSceneMap({ byUserId: new Map(), byUsername: new Map() });
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
        snap.forEach((doc) => {
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
        setDjSceneMap({ byUserId, byUsername });
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
    djs: Array<{ userId?: string; username?: string }>;
  },
  djSceneMap: DjSceneMap
): string[] {
  if (Array.isArray(archive.sceneIdsOverride)) {
    return archive.sceneIdsOverride;
  }
  const out = new Set<string>();
  for (const dj of archive.djs) {
    if (dj.userId) {
      const s = djSceneMap.byUserId.get(dj.userId);
      if (s) for (const id of s) out.add(id);
    }
    if (dj.username) {
      const s = djSceneMap.byUsername.get(dj.username.toLowerCase().replace(/\s+/g, ''));
      if (s) for (const id of s) out.add(id);
    }
  }
  return Array.from(out);
}
