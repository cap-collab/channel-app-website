'use client';

import { useState, useEffect, useRef } from 'react';
import { getFirestore, collection, query, where, limit, onSnapshot, Timestamp, getDocs } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

interface UseBroadcastLiveStatusReturn {
  isLive: boolean;
  showName: string | null;
  djName: string | null;
}

export function useBroadcastLiveStatus(): UseBroadcastLiveStatusReturn {
  const [isLive, setIsLive] = useState(false);
  const [showName, setShowName] = useState<string | null>(null);
  const [djName, setDjName] = useState<string | null>(null);

  // Grace period refs for show transitions
  const isLiveRef = useRef(false);
  const graceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync with state
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  // Clean up grace timer on unmount
  useEffect(() => {
    return () => {
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const slotsRef = collection(db, 'broadcast-slots');
    // Simple query - just check if any live slot exists
    // No orderBy to avoid needing a composite index
    const q = query(
      slotsRef,
      where('status', '==', 'live'),
      limit(1)
    );

    /** Clear any running grace period */
    function clearGrace() {
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    }

    /**
     * Check if a show is scheduled for right now (startTime <= now <= endTime),
     * regardless of its status. If so, keep isLive=true during the transition.
     * Re-checks every 5s for up to 60s, then gives up.
     */
    async function startScheduleAwareGrace() {
      if (graceTimerRef.current) return; // already in grace

      let elapsed = 0;
      const MAX_GRACE_MS = 60_000;
      const POLL_MS = 5_000;

      // Check once immediately
      const shouldGrace = await hasScheduledSlotNow(db, slotsRef);
      if (!shouldGrace) {
        // No show scheduled for now — tear down immediately
        setIsLive(false);
        setShowName(null);
        setDjName(null);
        return;
      }

      // A show is scheduled but not yet live — keep isLive=true and poll
      console.log('🔄 Show transition detected, entering grace period (schedule-aware)');
      graceTimerRef.current = setInterval(async () => {
        elapsed += POLL_MS;
        if (elapsed >= MAX_GRACE_MS) {
          console.log('🔄 Grace period expired after 60s');
          clearGrace();
          setIsLive(false);
          setShowName(null);
          setDjName(null);
          return;
        }
        // If the onSnapshot already picked up a new live slot, the grace
        // timer will have been cleared by the has-data branch — this is a safety check
        const stillNeeded = await hasScheduledSlotNow(db, slotsRef);
        if (!stillNeeded) {
          console.log('🔄 No scheduled show covers now, ending grace');
          clearGrace();
          setIsLive(false);
          setShowName(null);
          setDjName(null);
        }
      }, POLL_MS);
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          // Live slot found — cancel any grace period
          clearGrace();

          const doc = snapshot.docs[0];
          const data = doc.data();
          setIsLive(true);
          setShowName(data.showName || 'Live Broadcast');
          // Resolve current DJ name from djSlots or top-level fields
          let dj: string | null = null;
          if (data.djSlots && Array.isArray(data.djSlots) && data.djSlots.length > 0) {
            const now = Date.now();
            const slot = data.djSlots.find((s: { startTime: number; endTime: number }) => s.startTime <= now && s.endTime > now);
            if (slot) dj = slot.liveDjUsername || slot.djName || null;
          }
          // For restreams with multiple DJs, show all names (channel user first)
          if (data.restreamDjs && Array.isArray(data.restreamDjs) && data.restreamDjs.length > 1) {
            const sortedDjs = [...data.restreamDjs].sort((a: { userId?: string; username?: string }, b: { userId?: string; username?: string }) => {
              if (a.userId && !b.userId) return -1;
              if (!a.userId && b.userId) return 1;
              if (a.username && !b.username) return -1;
              if (!a.username && b.username) return 1;
              return 0;
            });
            dj = sortedDjs.map((d: { name: string }) => d.name).join(', ');
          }
          if (!dj) dj = data.liveDjUsername || data.djName || null;
          setDjName(dj);
        } else {
          // No live slot — check if we were live and a show is scheduled for now
          if (isLiveRef.current) {
            startScheduleAwareGrace();
          } else {
            setIsLive(false);
            setShowName(null);
            setDjName(null);
          }
        }
      },
      (err) => {
        console.error('Broadcast live status subscription error:', err);
        clearGrace();
        setIsLive(false);
        setShowName(null);
        setDjName(null);
      }
    );

    return () => {
      unsubscribe();
      clearGrace();
    };
  }, []);

  return { isLive, showName, djName };
}

/**
 * Check if any broadcast slot's time window covers the current moment,
 * regardless of status. This tells us a show *should* be on right now.
 */
export async function hasScheduledSlotNow(
  db: ReturnType<typeof getFirestore>,
  slotsRef: ReturnType<typeof collection>
): Promise<boolean> {
  try {
    const now = Timestamp.now();
    // Find slots where endTime > now (still within their window)
    // Then filter client-side for startTime <= now
    const q = query(
      slotsRef,
      where('endTime', '>', now),
      limit(5)
    );
    const snap = await getDocs(q);
    const nowMs = Date.now();
    return snap.docs.some(doc => {
      const data = doc.data();
      const startMs = (data.startTime as Timestamp).toMillis();
      return startMs <= nowMs;
    });
  } catch (err) {
    console.error('Schedule check failed:', err);
    return false;
  }
}
