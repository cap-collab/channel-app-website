'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Client-side map of collective → photo, keyed by BOTH normalized name and
// slug. Used on /scene to self-heal followed-collective cards whose favorite
// doc was written before the follow path captured the collective photo
// (see useFavorites.addToWatchlist). Collectives are publicly readable.
//
// The map exposes a single `get(key)` that normalizes the lookup key the same
// way it normalizes the stored name/slug, so callers can pass a raw djName,
// djUsername, or search term.
export interface CollectivePhotoMap {
  get: (key: string | undefined | null) => string | undefined;
}

function norm(s: string): string {
  return s.replace(/[\s-]+/g, '').toLowerCase();
}

export function useCollectivePhotos(enabled: boolean): CollectivePhotoMap {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!enabled || !db) return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, 'collectives'));
        if (cancelled) return;
        const next = new Map<string, string>();
        snap.forEach((doc) => {
          const data = doc.data();
          const photo: string | undefined = data?.photo || undefined;
          if (!photo) return;
          if (typeof data?.name === 'string') next.set(norm(data.name), photo);
          if (typeof data?.slug === 'string') next.set(norm(data.slug), photo);
        });
        setMap(next);
      } catch (err) {
        console.warn('[useCollectivePhotos] failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Memoize on `map` identity so consumers can list the returned object in a
  // useMemo dependency array without re-running every render.
  return useMemo<CollectivePhotoMap>(
    () => ({ get: (key) => (key ? map.get(norm(key)) : undefined) }),
    [map]
  );
}
