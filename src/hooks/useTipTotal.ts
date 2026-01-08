import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface UseTipTotalOptions {
  djUserId?: string;  // Optional - if not provided, will query by broadcastSlotId only
  broadcastSlotId?: string; // If provided, only count tips for this slot
}

interface UseTipTotalResult {
  totalCents: number;
  tipCount: number;
  loading: boolean;
  error: string | null;
}

export function useTipTotal({ djUserId, broadcastSlotId }: UseTipTotalOptions): UseTipTotalResult {
  const [totalCents, setTotalCents] = useState(0);
  const [tipCount, setTipCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Need at least one filter (djUserId or broadcastSlotId)
    if (!db || (!djUserId && !broadcastSlotId)) {
      setLoading(false);
      return;
    }

    let q;

    if (broadcastSlotId) {
      // Query by broadcastSlotId (primary for DJ broadcast page)
      q = query(
        collection(db, 'tips'),
        where('broadcastSlotId', '==', broadcastSlotId),
        where('status', '==', 'succeeded')
      );
    } else if (djUserId) {
      // Query by djUserId only (for DJ profile page)
      q = query(
        collection(db, 'tips'),
        where('djUserId', '==', djUserId),
        where('status', '==', 'succeeded')
      );
    } else {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let total = 0;
        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          total += data.tipAmountCents || 0;
        });
        setTotalCents(total);
        setTipCount(snapshot.docs.length);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching tips:', err);
        setError('Failed to load tips');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [djUserId, broadcastSlotId]);

  return { totalCents, tipCount, loading, error };
}
