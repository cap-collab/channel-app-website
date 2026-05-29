'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  doc,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';

// Per-user, per-DJ "stop emailing me when this DJ goes live" list.
// Single source of truth for both:
//   - the /api/go-live-mute endpoint (email footer link), and
//   - the /explore card "x" overlay (when removing an engagement-added card).
// Re-engagement (a heart or lock-in) clears the entry — see unmute().
export function useGoLiveMutes() {
  const { user } = useAuthContext();
  const [mutes, setMutes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !db) {
      setMutes(new Set());
      return;
    }
    const ref = doc(db, 'users', user.uid);
    return onSnapshot(ref, (snap) => {
      const data = snap.data();
      const arr = (data?.goLiveMutes as string[] | undefined) || [];
      setMutes(new Set(arr));
    });
  }, [user]);

  const mute = useCallback(
    async (djUsername: string) => {
      if (!user || !db || !djUsername) return false;
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          goLiveMutes: arrayUnion(djUsername),
        });
        return true;
      } catch (err) {
        console.error('[useGoLiveMutes] mute failed', err);
        return false;
      }
    },
    [user],
  );

  const unmute = useCallback(
    async (djUsername: string) => {
      if (!user || !db || !djUsername) return false;
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          goLiveMutes: arrayRemove(djUsername),
        });
        return true;
      } catch (err) {
        console.error('[useGoLiveMutes] unmute failed', err);
        return false;
      }
    },
    [user],
  );

  const isMuted = useCallback(
    (djUsername: string) => mutes.has(djUsername),
    [mutes],
  );

  return { mutes, isMuted, mute, unmute };
}
