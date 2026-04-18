'use client';

import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';

export function useFavoriteScenes() {
  const { user } = useAuthContext();
  const [favoriteSceneIds, setFavoriteSceneIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !db) {
      setFavoriteSceneIds([]);
      setLoading(false);
      return;
    }
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        setFavoriteSceneIds(Array.isArray(data?.favoriteSceneIds) ? data!.favoriteSceneIds : []);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [user]);

  const isFavoriteScene = useCallback(
    (sceneId: string) => favoriteSceneIds.includes(sceneId),
    [favoriteSceneIds]
  );

  const toggleFavoriteScene = useCallback(
    async (sceneId: string): Promise<boolean> => {
      if (!user) return false;
      const currentlyFav = favoriteSceneIds.includes(sceneId);
      const method = currentlyFav ? 'DELETE' : 'POST';
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/scenes/favorite', {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sceneId }),
        });
        return res.ok;
      } catch (err) {
        console.error('[useFavoriteScenes] toggle failed', err);
        return false;
      }
    },
    [user, favoriteSceneIds]
  );

  return { favoriteSceneIds, isFavoriteScene, toggleFavoriteScene, loading };
}
