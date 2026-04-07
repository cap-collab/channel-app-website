'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { StreamHistoryDoc } from '@/types';

export function useStreamHistory() {
  const { user } = useAuthContext();
  const [streamHistory, setStreamHistory] = useState<(StreamHistoryDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !db) {
      setStreamHistory([]);
      setLoading(false);
      return;
    }

    const ref = collection(db, 'users', user.uid, 'streamHistory');
    const q = query(ref, orderBy('lastStreamedAt', 'desc'), limit(50));

    const unsub = onSnapshot(q, (snap) => {
      setStreamHistory(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as StreamHistoryDoc & { id: string }))
      );
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  const hasStreamed = useCallback(
    (archiveId: string) => streamHistory.some((s) => s.archiveId === archiveId),
    [streamHistory]
  );

  const getStreamCount = useCallback(
    (archiveId: string) => streamHistory.find((s) => s.archiveId === archiveId)?.streamCount || 0,
    [streamHistory]
  );

  return { streamHistory, loading, hasStreamed, getStreamCount };
}
