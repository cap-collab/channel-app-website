'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchiveRadio } from '@/hooks/useArchiveRadio';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import type { ArchiveSerialized, ScheduleItem } from '@/types/broadcast';

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
  // Absolute Unix-ms timestamps for the current item's slot, derived from
  // the day's startTimeMs + item.startOffsetSec. Lets the player bar render
  // clock-time start/end (e.g. "9 PM → 10 PM") just like the live bar.
  itemStartMs: number | null;
  itemEndMs: number | null;
  toggle: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  // Which carousel slide the listener is looking at on /demo. Used by the
  // sticky bar to mirror the visible slide when nothing's actively playing.
  // 0 = slide 0 (live or radio), 1 = slide 1 (archive). Set by ArchiveHero.
  visibleSlide: 0 | 1;
  setVisibleSlide: (slide: 0 | 1) => void;
  // Resolved archive doc for the currently-playing radio item — looked up in
  // the archives list set by ArchiveHero. Single source of truth: scene,
  // username, photo, tip-link all come from here, no denormalization.
  currentArchive: ArchiveSerialized | null;
  setArchives: (archives: ArchiveSerialized[]) => void;
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
  // Live broadcast wins (we don't run two streams at once). The radio stays
  // "alive" even if a regular archive is loaded — we don't want the audio
  // elements to be torn down, otherwise the play button breaks after the
  // listener comes back from playing an archive. Coexistence (pause the
  // other side on play) is handled by the toggle/play callbacks below.
  const showLive = broadcast.isLive && broadcast.isStreaming;
  const radio = useArchiveRadio({
    active: enabled && !showLive,
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

  const [visibleSlide, setVisibleSlide] = useState<0 | 1>(0);
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);

  // Resolve the current archive doc from the schedule item's id. This is the
  // single source of truth for scene/username/photo/tip — same data the rest
  // of the hero uses, so when an admin edits a DJ profile the radio bar
  // picks it up without a schedule regen.
  const currentArchive = useMemo<ArchiveSerialized | null>(() => {
    const id = radio.currentItem?.archiveId;
    if (!id) return null;
    return archives.find((a) => a.id === id) ?? null;
  }, [radio.currentItem?.archiveId, archives]);

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
    itemStartMs: radio.itemStartMs,
    itemEndMs: radio.itemEndMs,
    toggle,
    play,
    pause: radio.pause,
    visibleSlide,
    setVisibleSlide,
    currentArchive,
    setArchives,
  }), [
    enabled, radio.ready, radio.isPlaying, radio.isLoading, radio.error,
    radio.currentItem, radio.nextItem, radio.itemSeekSec, radio.itemDurationSec,
    radio.itemStartMs, radio.itemEndMs, radio.pause, toggle, play, visibleSlide,
    currentArchive,
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
