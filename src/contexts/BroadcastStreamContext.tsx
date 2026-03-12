'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastLiveStatus } from '@/hooks/useBroadcastLiveStatus';
import { BroadcastSlotSerialized } from '@/types/broadcast';

interface BroadcastStreamContextValue {
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
  // Whether the hero sticky bar on /radio is currently visible
  heroBarVisible: boolean;
  setHeroBarVisible: (visible: boolean) => void;
}

const BroadcastStreamContext = createContext<BroadcastStreamContextValue | null>(null);

/**
 * Provider that initializes useBroadcastStream only when a broadcast is live.
 * This shares a single stream instance across the GlobalBroadcastBar + LiveBroadcastHero.
 */
export function BroadcastStreamProvider({ children }: { children: ReactNode }) {
  const { isLive: statusIsLive, showName, djName } = useBroadcastLiveStatus();
  const [heroBarVisible, setHeroBarVisible] = useState(false);
  const setHeroBarVisibleCb = useCallback((v: boolean) => setHeroBarVisible(v), []);

  return statusIsLive ? (
    <BroadcastStreamInner showName={showName} djName={djName} heroBarVisible={heroBarVisible} setHeroBarVisible={setHeroBarVisibleCb}>
      {children}
    </BroadcastStreamInner>
  ) : (
    <BroadcastStreamContext.Provider value={{
      isPlaying: false, isLoading: false, isLive: false,
      currentShow: null, currentDJ: null, error: null,
      play: () => {}, pause: () => {}, toggle: () => {},
      listenerCount: 0, audioStream: null,
      showName: null, djName: null,
      heroBarVisible: false, setHeroBarVisible: setHeroBarVisibleCb,
    }}>
      {children}
    </BroadcastStreamContext.Provider>
  );
}

/** Inner component that only mounts useBroadcastStream when live */
function BroadcastStreamInner({
  children, showName, djName, heroBarVisible, setHeroBarVisible,
}: {
  children: ReactNode; showName: string | null; djName: string | null;
  heroBarVisible: boolean; setHeroBarVisible: (v: boolean) => void;
}) {
  const stream = useBroadcastStream();

  return (
    <BroadcastStreamContext.Provider value={{ ...stream, showName, djName, heroBarVisible, setHeroBarVisible }}>
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
