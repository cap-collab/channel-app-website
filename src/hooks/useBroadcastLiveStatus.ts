'use client';

import { useState, useEffect, useRef } from 'react';
import { getFirestore, collection, query, where, limit, onSnapshot, Timestamp, getDocs } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';
import { normalizeUsername } from '@/lib/dj-matching';

// The admin account (cap@channel-app.com, chatUsername "channelbroadcast") uses
// real go-live to test broadcasting + recording without showing up on the public
// site. Any live slot resolving to this DJ is treated as "not live" everywhere
// downstream of useBroadcastStreamContext (homepage hero, chat, global bar) — the
// broadcast itself (LiveKit/egress/recording) runs normally so it's still testable.
// This can only ever hide THIS account; it never affects a real DJ's show.
const HIDDEN_TEST_DJ = normalizeUsername('channelbroadcast');

function isHiddenTestDj(...candidates: Array<string | null | undefined>): boolean {
  return candidates.some(c => typeof c === 'string' && c.length > 0 && normalizeUsername(c) === HIDDEN_TEST_DJ);
}

// Private "test mode": visit any page with ?testmode=1 to opt this browser in
// (persisted in localStorage), ?testmode=0 to opt out. While on, the
// channelbroadcast admin test broadcast is treated as a real live show on THIS
// browser only — so go-live, back-to-back, and transitions can be watched and
// heard exactly as the public would, without ever showing up for anyone else.
// Only ever un-hides the channelbroadcast account; never affects a real DJ.
const TEST_MODE_KEY = 'channelTestMode';

function readTestMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const param = params.get('testmode');
    if (param === '1' || param === 'true') {
      window.localStorage.setItem(TEST_MODE_KEY, '1');
      return true;
    }
    if (param === '0' || param === 'false') {
      window.localStorage.removeItem(TEST_MODE_KEY);
      return false;
    }
    return window.localStorage.getItem(TEST_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

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
    const testMode = readTestMode();
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

          // Admin test broadcast — keep it off the public site (recording still runs).
          // In private test mode (?testmode=1 on this browser) we let it through
          // so the broadcast can be watched/heard like a real show.
          if (!testMode && isHiddenTestDj(data.liveDjUsername, data.liveDjChatUsername, data.djUsername, data.djName)) {
            setIsLive(false);
            setShowName(null);
            setDjName(null);
            return;
          }

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
      // Anchors never take over the player, so they must NOT sustain the live
      // grace period. Also skip recordings and cancelled slots (never live).
      if (data.broadcastType === 'anchor' || data.broadcastType === 'recording' || data.status === 'cancelled') return false;
      const startMs = (data.startTime as Timestamp).toMillis();
      return startMs <= nowMs;
    });
  } catch (err) {
    console.error('Schedule check failed:', err);
    return false;
  }
}

/**
 * Check if any broadcast slot is either currently active (covers now) OR
 * starts within the next `lookaheadMs` milliseconds. Used by Rule B to
 * decide whether to hand the listener off to radio: if a show is on or
 * imminent, hold off (avoids handing off during the brief statusIsLive
 * flip race in a live↔live transition, and during normal back-to-back
 * gaps shorter than the lookahead).
 */
export async function hasActiveOrImminentBroadcastSlot(
  db: ReturnType<typeof getFirestore>,
  slotsRef: ReturnType<typeof collection>,
  lookaheadMs: number,
): Promise<boolean> {
  try {
    const now = Timestamp.now();
    const q = query(
      slotsRef,
      where('endTime', '>', now),
      limit(5)
    );
    const snap = await getDocs(q);
    const nowMs = Date.now();
    const horizonMs = nowMs + lookaheadMs;
    return snap.docs.some(doc => {
      const data = doc.data();
      // Anchors never take over the player; they must NOT suppress the hand-off
      // to archive radio. Skip recordings/cancelled too (never live).
      if (data.broadcastType === 'anchor' || data.broadcastType === 'recording' || data.status === 'cancelled') return false;
      const startMs = (data.startTime as Timestamp).toMillis();
      return startMs <= horizonMs;
    });
  } catch (err) {
    console.error('Schedule lookahead check failed:', err);
    return false;
  }
}
