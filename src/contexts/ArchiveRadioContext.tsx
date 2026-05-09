'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchiveRadio } from '@/hooks/useArchiveRadio';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import type { ScheduleItem } from '@/types/broadcast';

interface ArchiveRadioContextValue {
  enabled: boolean;
  ready: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentItem: ScheduleItem | null;
  nextItem: ScheduleItem | null;
  itemSeekSec: number;
  itemDurationSec: number;
  toggle: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
}

const ArchiveRadioContext = createContext<ArchiveRadioContextValue | null>(null);

// Single hook instance for the whole tree — prevents the demo hero and the
// global sticky bar from each spinning up their own <audio> element.
//
// `enabled` controls whether the radio is allowed to play here at all.
// On /radio/demo we mount this with enabled=true; on /radio (legacy) we just
// don't render the provider, so consumers see null and behave as before.
export function ArchiveRadioProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const archivePlayer = useArchivePlayer();
  const broadcast = useBroadcastStreamContext();
  // Live broadcast (or restream) wins; a regular archive picked by the
  // listener also pre-empts the radio. Otherwise the radio is active.
  const showLive = broadcast.isLive && broadcast.isStreaming;
  const radio = useArchiveRadio({
    active: enabled && !showLive && !archivePlayer.currentArchive,
  });
  const toggle = useCallback(async () => {
    const willPlay = !radio.isPlaying;
    if (willPlay && archivePlayer.isPlaying) archivePlayer.pause();
    await radio.toggle();
  }, [radio, archivePlayer]);
  const play = useCallback(async () => {
    if (archivePlayer.isPlaying) archivePlayer.pause();
    await radio.play();
  }, [radio, archivePlayer]);

  const value = useMemo<ArchiveRadioContextValue>(() => ({
    enabled,
    ready: radio.ready,
    isPlaying: radio.isPlaying,
    isLoading: radio.isLoading,
    error: radio.error,
    currentItem: radio.currentItem,
    nextItem: radio.nextItem,
    itemSeekSec: radio.itemSeekSec,
    itemDurationSec: radio.itemDurationSec,
    toggle,
    play,
    pause: radio.pause,
  }), [
    enabled, radio.ready, radio.isPlaying, radio.isLoading, radio.error,
    radio.currentItem, radio.nextItem, radio.itemSeekSec, radio.itemDurationSec,
    radio.pause, toggle, play,
  ]);

  return (
    <ArchiveRadioContext.Provider value={value}>
      {children}
    </ArchiveRadioContext.Provider>
  );
}

// Returns null when no provider is present (i.e. on /radio, where the radio
// isn't surfaced yet). Callers should treat null as "no radio in this tree."
export function useArchiveRadioContext(): ArchiveRadioContextValue | null {
  return useContext(ArchiveRadioContext);
}
