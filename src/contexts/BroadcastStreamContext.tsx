'use client';

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastLiveStatus } from '@/hooks/useBroadcastLiveStatus';
import { BroadcastSlotSerialized } from '@/types/broadcast';

export interface BroadcastStreamContextValue {
  isPlaying: boolean;
  isLoading: boolean;
  isLive: boolean;
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

  const value = useMemo<BroadcastStreamContextValue>(() => {
    if (statusIsLive) {
      return { ...stream, showName, djName, tipEligible: isTipEligible(stream.currentShow, stream.currentDJ), heroBarVisible, setHeroBarVisible: setHeroBarVisibleCb };
    }
    return {
      isPlaying: false, isLoading: false, isLive: false,
      currentShow: null, currentDJ: null, error: null,
      play: noopFn, pause: noopFn, toggle: noopFn,
      listenerCount: 0, audioStream: null,
      showName: null, djName: null,
      tipEligible: false,
      heroBarVisible: false, setHeroBarVisible: setHeroBarVisibleCb,
    };
  }, [statusIsLive, stream, showName, djName, heroBarVisible, setHeroBarVisibleCb]);

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
