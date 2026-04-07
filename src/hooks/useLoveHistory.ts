'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { LoveHistoryDoc } from '@/types';

export function useLoveHistory() {
  const { user } = useAuthContext();
  const [loveHistory, setLoveHistory] = useState<(LoveHistoryDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !db) {
      setLoveHistory([]);
      setLoading(false);
      return;
    }

    const ref = collection(db, 'users', user.uid, 'loveHistory');
    const q = query(ref, orderBy('lastLovedAt', 'desc'), limit(50));

    const unsub = onSnapshot(q, (snap) => {
      setLoveHistory(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as LoveHistoryDoc & { id: string }))
      );
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  const hasLoved = useCallback(
    (djUsername: string) => loveHistory.some((l) => l.djUsername === djUsername),
    [loveHistory]
  );

  return { loveHistory, loading, hasLoved };
}
