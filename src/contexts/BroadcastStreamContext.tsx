'use client';

import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastLiveStatus } from '@/hooks/useBroadcastLiveStatus';
import { BroadcastSlotSerialized, ROOM_NAME } from '@/types/broadcast';

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
  // Whether the current DJ is eligible for tips
  tipEligible: boolean;
  // Whether the hero sticky bar on /radio is currently visible
  heroBarVisible: boolean;
  setHeroBarVisible: (visible: boolean) => void;
}

export const BroadcastStreamContext = createContext<BroadcastStreamContextValue | null>(null);

const noopFn = () => {};

function isTipEligible(show: BroadcastSlotSerialized | null, currentDJ: string | null): boolean {
  if (!show || !currentDJ) return false;
  if (show.djSlots && show.djSlots.length > 0) {
    const now = Date.now();
    const slot = show.djSlots.find(s => s.startTime <= now && s.endTime > now);
    if (slot) return !!(slot.liveDjUserId || slot.djUserId || slot.djEmail);
  }
  return !!(show.liveDjUserId || show.djUserId || show.djEmail);
}

/**
 * Polls /api/livekit/room-status to check if a DJ is actually publishing audio.
 * Only polls when a broadcast slot is live (statusIsLive). For restream broadcasts,
 * audio comes from an archive URL (not LiveKit), so isStreaming is always true.
 */
function useIsStreaming(statusIsLive: boolean, currentShow: BroadcastSlotSerialized | null): boolean {
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!statusIsLive) {
      setIsStreaming(false);
      return;
    }

    // Restreams play from archive URL, not LiveKit — always "streaming"
    if (currentShow?.broadcastType === 'restream') {
      setIsStreaming(true);
      return;
    }

    let cancelled = false;

    async function checkRoomStatus() {
      try {
        const res = await fetch(`/api/livekit/room-status?room=${ROOM_NAME}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIsStreaming(data.isLive === true);
      } catch {
        // Network error — keep previous state
      }
    }

    // Check immediately, then poll every 10s
    checkRoomStatus();
    const interval = setInterval(checkRoomStatus, 10_000);

    return () => {
      cancelled = true;
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

  // useBroadcastStream is always called (hooks can't be conditional),
  // but it should be a no-op internally when not live
  const stream = useBroadcastStream(statusIsLive);

  // Check if DJ is actually publishing audio in the LiveKit room
  const isStreaming = useIsStreaming(statusIsLive, stream.currentShow);

  const value = useMemo<BroadcastStreamContextValue>(() => {
    if (statusIsLive) {
      return { ...stream, isStreaming, showName, djName, tipEligible: isTipEligible(stream.currentShow, stream.currentDJ), heroBarVisible, setHeroBarVisible: setHeroBarVisibleCb };
    }
    return {
      isPlaying: false, isLoading: false, isLive: false, isStreaming: false,
      currentShow: null, currentDJ: null, error: null,
      play: noopFn, pause: noopFn, toggle: noopFn,
      listenerCount: 0, audioStream: null,
      showName: null, djName: null,
      tipEligible: false,
      heroBarVisible: false, setHeroBarVisible: setHeroBarVisibleCb,
    };
  }, [statusIsLive, stream, isStreaming, showName, djName, heroBarVisible, setHeroBarVisibleCb]);

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
