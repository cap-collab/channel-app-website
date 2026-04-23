'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode, type MutableRefObject } from 'react';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastLiveStatus } from '@/hooks/useBroadcastLiveStatus';
import { findActiveDjSlot } from '@/lib/broadcast-utils';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { getDatabase, ref, onValue } from 'firebase/database';
import { getApps, initializeApp } from 'firebase/app';

export interface BroadcastStreamContextValue {
  isPlaying: boolean;
  isLoading: boolean;
  isLive: boolean;
  /** Whether a DJ is actually publishing audio in the LiveKit room (not just scheduled) */
  isStreaming: boolean;
  currentShow: BroadcastSlotSerialized | null;
  currentDJ: string | null;
  error: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  listenerCount: number;

  audioStream: MediaStream | null;
  // From lightweight status hook (always available)
  showName: string | null;
  djName: string | null;
  // Resolved external tip link (tipButtonLink > bandcamp)
  tipLink: string | null;
  // Whether the hero sticky bar on /radio is currently visible
  heroBarVisible: boolean;
  setHeroBarVisible: (visible: boolean) => void;
  // Whether the IntersectionObserver for the hero bar has initialized
  heroBarObserverReady: boolean;
  setHeroBarObserverReady: (ready: boolean) => void;
  // Ref callback for "locked in" message — set by consuming component (GlobalBroadcastBar)
  onLockedInRef: MutableRefObject<(() => void) | null>;
  // Ref callback for 5-minute listen milestone (heart-nudge re-trigger)
  onListenMilestoneRef: MutableRefObject<(() => void) | null>;
}

export const BroadcastStreamContext = createContext<BroadcastStreamContextValue | null>(null);

const noopFn = () => {};
const noopRef = { current: null } as MutableRefObject<(() => void) | null>;

/** Resolve external tip link from broadcast slot data (single source of truth — no fallback chain) */
function resolveTipLink(show: BroadcastSlotSerialized | null): string | null {
  if (!show) return null;
  // Check active DJ slot first (venue/B3B shows)
  if (show.djSlots && show.djSlots.length > 0) {
    const slot = findActiveDjSlot(show.djSlots);
    if (slot) return slot.djTipButtonLink || null;
  }
  return show.liveDjTipButtonLink || null;
}

function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getApps()[0];
}

/**
 * Subscribes to RTDB `status/broadcast` for real-time isStreaming updates.
 * The LiveKit webhook writes to this path when a DJ publishes or unpublishes audio.
 *
 * Includes a 60-second grace period: when isStreaming drops to false while a show
 * is live (statusIsLive), keeps returning true for up to 60s to handle DJ transitions
 * without the player disappearing.
 *
 * For restream broadcasts, always returns true (audio comes from archive URL, not LiveKit).
 */
function useIsStreaming(statusIsLive: boolean, currentShow: BroadcastSlotSerialized | null): boolean {
  const [isStreaming, setIsStreaming] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up grace timer on unmount
  useEffect(() => {
    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!statusIsLive) {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      setIsStreaming(false);
      return;
    }

    // Restreams play from archive URL, not LiveKit — always "streaming"
    if (currentShow?.broadcastType === 'restream') {
      setIsStreaming(true);
      return;
    }

    const app = getFirebaseApp();
    const rtdb = getDatabase(app);
    const statusRef = ref(rtdb, 'status/broadcast');

    const unsubscribe = onValue(statusRef, (snapshot) => {
      const data = snapshot.val();

      // If RTDB has never been written to (null), assume streaming is true
      // when a slot is live. The webhook will write the real value on the
      // next track_published/unpublished event.
      if (data === null) {
        setIsStreaming(true);
        return;
      }

      const live = data?.isStreaming === true;

      if (live) {
        // DJ is publishing — clear any grace timer and set streaming
        if (graceTimerRef.current) {
          clearTimeout(graceTimerRef.current);
          graceTimerRef.current = null;
        }
        setIsStreaming(true);
      } else {
        // DJ stopped publishing — start grace period if we were streaming
        if (!graceTimerRef.current) {
          console.log('🔄 isStreaming: DJ stopped, entering 60s grace period');
          graceTimerRef.current = setTimeout(() => {
            console.log('🔄 isStreaming: grace period expired');
            graceTimerRef.current = null;
            setIsStreaming(false);
          }, 60_000);
        }
      }
    });

    return () => {
      unsubscribe();
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, [statusIsLive, currentShow?.broadcastType]);

  return isStreaming;
}

/**
 * Provider that initializes useBroadcastStream only when a broadcast is live.
 * This shares a single stream instance across the GlobalBroadcastBar + LiveBroadcastHero.
 *
 * IMPORTANT: We always render a single BroadcastStreamContext.Provider (never switch
 * between two different wrapper components) to avoid remounting the entire children tree
 * when isLive toggles. The useBroadcastStream hook is conditionally active inside.
 */
export function BroadcastStreamProvider({ children }: { children: ReactNode }) {
  const { isLive: statusIsLive, showName, djName } = useBroadcastLiveStatus();
  const [heroBarVisible, setHeroBarVisible] = useState(false);
  const setHeroBarVisibleCb = useCallback((v: boolean) => setHeroBarVisible(v), []);
  const [heroBarObserverReady, setHeroBarObserverReady] = useState(false);
  const setHeroBarObserverReadyCb = useCallback((v: boolean) => setHeroBarObserverReady(v), []);
  const onLockedInRef = useRef<(() => void) | null>(null);
  const onListenMilestoneRef = useRef<(() => void) | null>(null);

  // useBroadcastStream is always called (hooks can't be conditional),
  // but it should be a no-op internally when not live
  const stream = useBroadcastStream(statusIsLive, onLockedInRef, onListenMilestoneRef);

  // Check if DJ is actually publishing audio in the LiveKit room
  const isStreaming = useIsStreaming(statusIsLive, stream.currentShow);

  const value = useMemo<BroadcastStreamContextValue>(() => {
    if (statusIsLive) {
      const tipLink = resolveTipLink(stream.currentShow);
      return { ...stream, isStreaming, showName, djName, tipLink, heroBarVisible, setHeroBarVisible: setHeroBarVisibleCb, heroBarObserverReady, setHeroBarObserverReady: setHeroBarObserverReadyCb, onLockedInRef, onListenMilestoneRef };
    }
    return {
      isPlaying: false, isLoading: false, isLive: false, isStreaming: false,
      currentShow: null, currentDJ: null, error: null,
      play: noopFn, pause: noopFn, toggle: noopFn,
      listenerCount: 0, audioStream: null,
      showName: null, djName: null,
      tipLink: null,
      heroBarVisible, setHeroBarVisible: setHeroBarVisibleCb, heroBarObserverReady, setHeroBarObserverReady: setHeroBarObserverReadyCb,
      onLockedInRef: noopRef,
      onListenMilestoneRef: noopRef,
    };
  }, [statusIsLive, stream, isStreaming, showName, djName, heroBarVisible, setHeroBarVisibleCb, heroBarObserverReady, setHeroBarObserverReadyCb]);

  return (
    <BroadcastStreamContext.Provider value={value}>
      {children}
    </BroadcastStreamContext.Provider>
  );
}

export function useBroadcastStreamContext() {
  const ctx = useContext(BroadcastStreamContext);
  if (!ctx) {
    throw new Error('useBroadcastStreamContext must be used within BroadcastStreamProvider');
  }
  return ctx;
}
