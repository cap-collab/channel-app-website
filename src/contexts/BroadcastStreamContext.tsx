'use client';

import { createContext, useContext, ReactNode } from 'react';
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
}

const BroadcastStreamContext = createContext<BroadcastStreamContextValue | null>(null);

/**
 * Provider that initializes useBroadcastStream only when a broadcast is live.
 * This shares a single stream instance across the GlobalBroadcastBar + LiveBroadcastHero.
 */
export function BroadcastStreamProvider({ children }: { children: ReactNode }) {
  const { isLive: statusIsLive, showName, djName } = useBroadcastLiveStatus();

  return statusIsLive ? (
    <BroadcastStreamInner showName={showName} djName={djName}>
      {children}
    </BroadcastStreamInner>
  ) : (
    <BroadcastStreamContext.Provider value={{
      isPlaying: false, isLoading: false, isLive: false,
      currentShow: null, currentDJ: null, error: null,
      play: () => {}, pause: () => {}, toggle: () => {},
      listenerCount: 0, audioStream: null,
      showName: null, djName: null,
    }}>
      {children}
    </BroadcastStreamContext.Provider>
  );
}

/** Inner component that only mounts useBroadcastStream when live */
function BroadcastStreamInner({
  children, showName, djName,
}: {
  children: ReactNode; showName: string | null; djName: string | null;
}) {
  const stream = useBroadcastStream();

  return (
    <BroadcastStreamContext.Provider value={{ ...stream, showName, djName }}>
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
