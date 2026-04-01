'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastLiveStatus, hasScheduledSlotNow } from '@/hooks/useBroadcastLiveStatus';
import { BroadcastSlotSerialized, ROOM_NAME } from '@/types/broadcast';
import { collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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
  visitorCount: number;
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
}

export const BroadcastStreamContext = createContext<BroadcastStreamContextValue | null>(null);

const noopFn = () => {};

/** Resolve external tip link from broadcast slot data (single source of truth — no fallback chain) */
function resolveTipLink(show: BroadcastSlotSerialized | null): string | null {
  if (!show) return null;
  // Check active DJ slot first (venue/B3B shows)
  if (show.djSlots && show.djSlots.length > 0) {
    const now = Date.now();
    const slot = show.djSlots.find(s => s.startTime <= now && s.endTime > now);
    if (slot) return slot.djTipButtonLink || null;
  }
  return show.liveDjTipButtonLink || null;
}

/**
 * Polls /api/livekit/room-status to check if a DJ is actually publishing audio.
 * Only polls when a broadcast slot is live (statusIsLive). For restream broadcasts,
 * audio comes from an archive URL (not LiveKit), so isStreaming is always true.
 *
 * Includes a schedule-aware grace period: when the DJ stops publishing but a show is
 * scheduled for now, keeps isStreaming=true for up to 60s (matching the grace period
 * in useBroadcastLiveStatus). This prevents both players from vanishing during DJ transitions.
 */
function useIsStreaming(statusIsLive: boolean, currentShow: BroadcastSlotSerialized | null): boolean {
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const graceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync with state
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

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
    if (!statusIsLive) {
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
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

    let cancelled = false;
    let graceElapsed = 0;
    const MAX_GRACE_MS = 60_000;
    const GRACE_POLL_MS = 5_000;
    const NORMAL_POLL_MS = 10_000;

    function clearGrace() {
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      graceElapsed = 0;
    }

    async function startScheduleAwareGrace() {
      if (graceTimerRef.current) return; // already in grace

      // Check if a show is scheduled for now
      if (!db) {
        setIsStreaming(false);
        return;
      }
      const slotsRef = collection(db, 'broadcast-slots');
      const shouldGrace = await hasScheduledSlotNow(db, slotsRef);
      if (cancelled) return;

      if (!shouldGrace) {
        // No show scheduled for now — drop immediately
        setIsStreaming(false);
        return;
      }

      // A show is scheduled — keep isStreaming=true and poll faster
      console.log('🔄 isStreaming grace period: show scheduled, keeping player visible');
      graceTimerRef.current = setInterval(async () => {
        if (cancelled) { clearGrace(); return; }
        graceElapsed += GRACE_POLL_MS;

        if (graceElapsed >= MAX_GRACE_MS) {
          console.log('🔄 isStreaming grace period expired after 60s');
          clearGrace();
          if (!cancelled) setIsStreaming(false);
          return;
        }

        // Check if DJ is back
        try {
          const res = await fetch(`/api/livekit/room-status?room=${ROOM_NAME}`);
          if (!res.ok || cancelled) return;
          const data = await res.json();
          if (data.isLive === true) {
            console.log('🔄 isStreaming grace: DJ is back, exiting grace');
            clearGrace();
            if (!cancelled) setIsStreaming(true);
          } else {
            // Still no DJ — check if show is still scheduled
            if (db) {
              const stillScheduled = await hasScheduledSlotNow(db, slotsRef);
              if (!stillScheduled && !cancelled) {
                console.log('🔄 isStreaming grace: no show scheduled, ending grace');
                clearGrace();
                setIsStreaming(false);
              }
            }
          }
        } catch {
          // Network error — keep previous state
        }
      }, GRACE_POLL_MS);
    }

    async function checkRoomStatus() {
      try {
        const res = await fetch(`/api/livekit/room-status?room=${ROOM_NAME}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.isLive === true) {
          // DJ is publishing — clear any grace and set streaming
          clearGrace();
          setIsStreaming(true);
        } else if (isStreamingRef.current && !graceTimerRef.current) {
          // Was streaming, now not — enter schedule-aware grace
          startScheduleAwareGrace();
        } else if (!isStreamingRef.current && !graceTimerRef.current) {
          // Not streaming and not in grace — stay false
          setIsStreaming(false);
        }
        // If in grace, the grace timer handles polling — don't interfere
      } catch {
        // Network error — keep previous state
      }
    }

    // Check immediately, then poll every 10s
    checkRoomStatus();
    const interval = setInterval(() => {
      // Don't run normal poll while grace timer is active (grace polls faster)
      if (!graceTimerRef.current) {
        checkRoomStatus();
      }
    }, NORMAL_POLL_MS);

    return () => {
      cancelled = true;
      clearGrace();
      clearInterval(interval);
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

  // useBroadcastStream is always called (hooks can't be conditional),
  // but it should be a no-op internally when not live
  const stream = useBroadcastStream(statusIsLive);

  // Check if DJ is actually publishing audio in the LiveKit room
  const isStreaming = useIsStreaming(statusIsLive, stream.currentShow);

  const value = useMemo<BroadcastStreamContextValue>(() => {
    if (statusIsLive) {
      const tipLink = resolveTipLink(stream.currentShow);
      return { ...stream, isStreaming, showName, djName, tipLink, heroBarVisible, setHeroBarVisible: setHeroBarVisibleCb, heroBarObserverReady, setHeroBarObserverReady: setHeroBarObserverReadyCb };
    }
    return {
      isPlaying: false, isLoading: false, isLive: false, isStreaming: false,
      currentShow: null, currentDJ: null, error: null,
      play: noopFn, pause: noopFn, toggle: noopFn,
      listenerCount: stream.visitorCount, visitorCount: stream.visitorCount, audioStream: null,
      showName: null, djName: null,
      tipLink: null,
      heroBarVisible: false, setHeroBarVisible: setHeroBarVisibleCb, heroBarObserverReady: false, setHeroBarObserverReady: setHeroBarObserverReadyCb,
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
