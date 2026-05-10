'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type MutableRefObject } from 'react';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchiveRadio } from '@/hooks/useArchiveRadio';
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
  // True when the inline player below the visible slide represents the
  // currently-playing source (so the sticky bar can stay hidden). False
  // when the inline shows a different source than what's actually playing
  // (sticky bar should appear with the active source's info).
  inlineCoversActive: boolean;
  setInlineCoversActive: (covers: boolean) => void;
  // Resolved archive doc for the currently-playing radio item — looked up in
  // the archives list set by ArchiveHero. Single source of truth: scene,
  // username, photo, tip-link all come from here, no denormalization.
  currentArchive: ArchiveSerialized | null;
  setArchives: (archives: ArchiveSerialized[]) => void;
  // Listen-milestone refs — same shape as ArchivePlayerContext +
  // BroadcastStreamContext. GlobalBroadcastBar populates these with the
  // radio DJ's chat handlers; the context fires them at 5 min (nudge) and
  // 15 min (locked-in) of cumulative listen time on each radio archive.
  onLockedInRef: MutableRefObject<(() => void) | null>;
  onListenMilestoneRef: MutableRefObject<(() => void) | null>;
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
  // Radio audio elements stay "alive" as long as the provider is mounted.
  // Don't gate on live or archive state — tearing down the audio on
  // showLive flips false would pause the radio when a live broadcast goes
  // live, which contradicts the rule "live becoming live must NEVER
  // interrupt the radio". Single-source coordination is handled by the
  // explicit user-action paths (toggle/play in this context pause the
  // others, and ArchivePlayer.play pauses the radio via the playArchive
  // helper).
  const radio = useArchiveRadio({
    active: enabled,
  });
  const toggle = useCallback(async () => {
    const willPlay = !radio.isPlaying;
    if (willPlay && archivePlayer.isPlaying) archivePlayer.pause();
    await radio.toggle();
  }, [radio, archivePlayer]);

  // Single-source rule: when a regular archive *actually starts playing*,
  // pause the radio. Mirrors archivePlayer.play→pauseBroadcast on /radio.
  //
  // We do NOT auto-pause the radio when:
  //   - broadcast.isLive flips true (live merely becomes available)
  //   - broadcast.isPlaying flips true (live audio starts — could be a
  //     show-transition auto-resume that the listener didn't request)
  // Live starting/playing must NEVER interrupt the listener's current
  // radio stream. They switch to live manually via the "Switch to Live
  // Radio" button or the slide overlay. The single-source rule only
  // applies when an *archive* (a finite recording the listener picked)
  // starts playing.
  useEffect(() => {
    if (radio.isPlaying && archivePlayer.isPlaying) radio.pause();
  }, [archivePlayer.isPlaying, radio]);

  const play = useCallback(async () => {
    if (archivePlayer.isPlaying) archivePlayer.pause();
    await radio.play();
  }, [radio, archivePlayer]);

  const [visibleSlide, setVisibleSlide] = useState<0 | 1>(0);
  // Defaults to true so the sticky stays hidden until ArchiveHero says
  // otherwise (avoids a flash of sticky on first paint).
  const [inlineCoversActive, setInlineCoversActive] = useState(true);
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

  // Listen-milestone tracking — mirrors ArchivePlayerContext's per-archive
  // cumulative timer. Each radio archive ticks while the radio is playing;
  // at 5 min fire the heart-nudge, at 15 min fire the locked-in message.
  // Counters reset whenever the schedule rolls to a new archive.
  const onLockedInRef = useRef<(() => void) | null>(null);
  const onListenMilestoneRef = useRef<(() => void) | null>(null);
  const cumulativeSecRef = useRef(0);
  const milestoneFiredForRef = useRef<string | null>(null);
  const lockedInFiredForRef = useRef<string | null>(null);
  const playingArchiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = radio.currentItem?.archiveId ?? null;
    if (id !== playingArchiveIdRef.current) {
      // Schedule rolled to a new archive — reset the counters so the next
      // 5/15-min triggers are fresh.
      playingArchiveIdRef.current = id;
      cumulativeSecRef.current = 0;
    }
  }, [radio.currentItem?.archiveId]);
  useEffect(() => {
    if (!radio.isPlaying) return;
    const interval = setInterval(() => {
      cumulativeSecRef.current += 1;
      const id = playingArchiveIdRef.current;
      if (!id) return;
      if (cumulativeSecRef.current >= 300 && milestoneFiredForRef.current !== id) {
        milestoneFiredForRef.current = id;
        onListenMilestoneRef.current?.();
      }
      if (cumulativeSecRef.current >= 900 && lockedInFiredForRef.current !== id) {
        lockedInFiredForRef.current = id;
        onLockedInRef.current?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [radio.isPlaying]);

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
    inlineCoversActive,
    setInlineCoversActive,
    currentArchive,
    setArchives,
    onLockedInRef,
    onListenMilestoneRef,
  }), [
    enabled, radio.ready, radio.isPlaying, radio.isLoading, radio.error,
    radio.currentItem, radio.nextItem, radio.itemSeekSec, radio.itemDurationSec,
    radio.itemStartMs, radio.itemEndMs, radio.pause, toggle, play, visibleSlide,
    inlineCoversActive, currentArchive,
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
