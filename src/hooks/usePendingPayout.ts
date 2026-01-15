import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const CLAIM_WINDOW_DAYS = 60;

interface UsePendingPayoutOptions {
  djUserId: string;
}

interface UsePendingPayoutResult {
  pendingCents: number;
  pendingCount: number;
  transferredCents: number;
  transferredCount: number;
  oldestPendingTipDate: Date | null;
  daysUntilExpiry: number | null;
  loading: boolean;
  error: string | null;
}

export function usePendingPayout({ djUserId }: UsePendingPayoutOptions): UsePendingPayoutResult {
  const [pendingCents, setPendingCents] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [transferredCents, setTransferredCents] = useState(0);
  const [transferredCount, setTransferredCount] = useState(0);
  const [oldestPendingTipDate, setOldestPendingTipDate] = useState<Date | null>(null);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!djUserId || !db) {
      setLoading(false);
      return;
    }

    // Listen to all successful tips for this DJ
    const q = query(
      collection(db, 'tips'),
      where('djUserId', '==', djUserId),
      where('status', '==', 'succeeded')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let pending = 0;
        let pendingNum = 0;
        let transferred = 0;
        let transferredNum = 0;
        let oldestDate: Date | null = null;

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          const amount = data.tipAmountCents || 0;

          if (data.payoutStatus === 'pending' || data.payoutStatus === 'pending_dj_account') {
            pending += amount;
            pendingNum++;

            // Track oldest pending tip date
            const tipDate = (data.createdAt as Timestamp)?.toDate();
            if (tipDate && (!oldestDate || tipDate < oldestDate)) {
              oldestDate = tipDate;
            }
          } else if (data.payoutStatus === 'transferred') {
            transferred += amount;
            transferredNum++;
          }
        });

        setPendingCents(pending);
        setPendingCount(pendingNum);
        setTransferredCents(transferred);
        setTransferredCount(transferredNum);
        setOldestPendingTipDate(oldestDate);

        // Calculate days until expiry based on oldest pending tip
        if (oldestDate) {
          const expiryDate = new Date(oldestDate);
          expiryDate.setDate(expiryDate.getDate() + CLAIM_WINDOW_DAYS);
          const now = new Date();
          const diffTime = expiryDate.getTime() - now.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          setDaysUntilExpiry(Math.max(0, diffDays));
        } else {
          setDaysUntilExpiry(null);
        }

        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching payout status:', err);
        setError('Failed to load payout info');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [djUserId]);

  return {
    pendingCents,
    pendingCount,
    transferredCents,
    transferredCount,
    oldestPendingTipDate,
    daysUntilExpiry,
    loading,
    error,
  };
}
