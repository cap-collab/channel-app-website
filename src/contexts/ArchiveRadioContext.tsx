'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type MutableRefObject } from 'react';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchiveRadio } from '@/hooks/useArchiveRadio';
import { pauseSource } from '@/lib/audio-exclusive';
import { db } from '@/lib/firebase';
import { hasActiveOrImminentBroadcastSlot } from '@/hooks/useBroadcastLiveStatus';
import { collection } from 'firebase/firestore';
import type { ArchiveSerialized, ScheduleItem } from '@/types/broadcast';

interface ArchiveRadioContextValue {
  enabled: boolean;
  ready: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  stalled: boolean;
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
  // Which carousel slide the listener is looking at. Used by the sticky bar
  // to mirror the visible slide when nothing's actively playing.
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
  // radio DJ's chat handler; the context fires it at 15 min of
  // cumulative listen time on each radio archive (locked-in).
  onLockedInRef: MutableRefObject<(() => void) | null>;
}

const ArchiveRadioContext = createContext<ArchiveRadioContextValue | null>(null);

// Single hook instance for the whole tree — prevents the hero and the
// global sticky bar from each spinning up their own <audio> element.
//
// `enabled` controls whether the radio is allowed to play here at all.
// Mounted with enabled=true at the app root so radio audio follows the
// listener across pages.
export function ArchiveRadioProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { user } = useAuthContext();
  const archivePlayer = useArchivePlayer();
  // Radio audio elements stay "alive" as long as the provider is mounted —
  // not gated on live/archive state. Single-source coordination is handled
  // by the explicit user-action paths (toggle/play here pause the others,
  // ArchivePlayer.play pauses the radio) plus the auto-handoff coordinator
  // below, which swaps radio↔live when audio is verified to be flowing.
  const radio = useArchiveRadio({
    active: enabled,
  });
  const broadcast = useBroadcastStreamContext();

  const toggle = useCallback(async () => {
    const willPlay = !radio.isPlaying;
    if (willPlay && archivePlayer.isPlaying) archivePlayer.pause();
    if (willPlay && broadcast.isPlaying) broadcast.pause();
    await radio.toggle();
  }, [radio, archivePlayer, broadcast]);

  // Single-source rule: when a regular archive *actually starts playing*,
  // pause the radio. Mirrors archivePlayer.play→pauseBroadcast on the homepage.
  useEffect(() => {
    if (radio.isPlaying && archivePlayer.isPlaying) radio.pause();
  }, [archivePlayer.isPlaying, radio]);

  // Same rule for live: when the live broadcast actually starts playing,
  // pause the radio. Mirrors broadcast.play→pauseArchive in
  // ArchivePlayerContext (which pauses broadcast when archive plays).
  useEffect(() => {
    if (radio.isPlaying && broadcast.isPlaying) radio.pause();
  }, [broadcast.isPlaying, radio]);

  // Auto-handoff coordinator between radio loop and live broadcast.
  //
  // Rule A (radio → live): when `isStreaming` flips false→true (LiveKit
  // webhook confirmed audio is flowing), arm a handoff if the radio is
  // playing and no specific archive is playing. We call broadcast.play()
  // BUT DO NOT pause the radio yet — iOS Safari silently rejects play()
  // on the live <audio> element if it hasn't been gesture-unlocked, so
  // pausing the radio first would leave the listener in silence. Instead
  // we wait for broadcast.isPlaying to flip true (live audio actually
  // started), and only then pause the radio. If isPlaying never flips
  // within a short window, abort — the listener stays on the radio.
  //
  // Rule B (live → radio): when `isLive` flips true→false (schedule-aware
  // grace already determined no follow-up is coming), if live audio was
  // actively playing at the moment of the flip, resume the radio loop.
  // Applies to all live listeners regardless of how they joined. The
  // "was playing at flip" gate filters out users who manually paused.
  const prevIsStreamingRef = useRef(false);
  const prevIsLiveRef = useRef(false);
  const prevBroadcastPlayingRef = useRef(false);
  // True while waiting for broadcast.isPlaying to flip true after we
  // called broadcast.play(). Used to coordinate the deferred radio.pause().
  const handoffPendingRef = useRef(false);

  // Stable refs to radio/broadcast control functions so the rule effects only
  // re-run on actual state changes, not on every parent render. (radio is a
  // fresh object each render of useArchiveRadio; we don't want it as a dep.)
  const radioPlayRef = useRef(radio.play);
  const radioPauseRef = useRef(radio.pause);
  const broadcastPlayRef = useRef(broadcast.play);
  useEffect(() => { radioPlayRef.current = radio.play; }, [radio.play]);
  useEffect(() => { radioPauseRef.current = radio.pause; }, [radio.pause]);
  useEffect(() => { broadcastPlayRef.current = broadcast.play; }, [broadcast.play]);

  // Rule A — fire broadcast.play() when isStreaming flips true with radio
  // playing. Do NOT pause radio yet. Set a timeout: if live doesn't start
  // playing within 10s (covers iOS HLS manifest fetch), abandon the
  // handoff (listener stays on radio).
  // Gated by NEXT_PUBLIC_DISABLE_RADIO_TO_LIVE_AUTO_SWITCH — the handoff
  // doesn't work reliably on mobile yet, so kept off in prod.
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = broadcast.isStreaming;
    if (process.env.NEXT_PUBLIC_DISABLE_RADIO_TO_LIVE_AUTO_SWITCH === 'true') return;
    if (!wasStreaming && broadcast.isStreaming
        && radio.isPlaying
        && !archivePlayer.isPlaying) {
      handoffPendingRef.current = true;
      broadcastPlayRef.current();
      const abortTimer = setTimeout(() => {
        handoffPendingRef.current = false;
      }, 10000);
      return () => clearTimeout(abortTimer);
    }
  }, [broadcast.isStreaming, radio.isPlaying, archivePlayer.isPlaying]);

  // Rule B — Live → Radio: fire BEFORE the prevBroadcastPlayingRef tracking
  // effect below, so we read the previous value (from before this render's
  // update) rather than the value after.
  //
  // Gated by:
  //   1. 2s debounce: brief statusIsLive flips happen during live↔live
  //      transitions when Live A loses status='live' a beat before Live B's
  //      startTime <= now is recognized. If broadcast.isLive flips back to
  //      true within the debounce, cancel. (Effect cleanup fires on the
  //      next isLive change, which cancels the timer.)
  //   2. Schedule check: after the debounce, query Firestore for any slot
  //      active right now OR starting in the next 60s. If yes, hold off —
  //      let the user wait on (silent) live for the imminent show.
  useEffect(() => {
    const wasLive = prevIsLiveRef.current;
    prevIsLiveRef.current = broadcast.isLive;
    if (!(wasLive && !broadcast.isLive && prevBroadcastPlayingRef.current)) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled || !db) return;
      const slotsRef = collection(db, 'broadcast-slots');
      const hasNearby = await hasActiveOrImminentBroadcastSlot(db, slotsRef, 60_000);
      if (cancelled || hasNearby) return;
      // Tear down stale live audio at the listener side. useBroadcastStream
      // keeps a 60s internal grace alive (for live↔live continuity) but
      // here we've confirmed the live is truly over — silence the
      // <audio> element directly so the listener doesn't hear lingering
      // audio while we hand them off to radio. Auto-resume is gated on
      // statusIsLive too, so this pause sticks.
      console.log('[radio-debug] HANDOFF live→radio: pausing live, resuming radio (Rule B, +2s debounce)');
      pauseSource('live');
      radioPlayRef.current();
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [broadcast.isLive]);

  // Track broadcast.isPlaying. When it flips true while a handoff is
  // pending, pause the radio (live is now confirmed producing audio).
  // Must run AFTER Rule B so the ref still holds the pre-flip value when
  // Rule B reads it on the same render where isLive and isPlaying both
  // flip false (which happens when statusIsLive turns off — the context
  // returns a hardcoded {isPlaying:false,isLive:false} object).
  useEffect(() => {
    const wasPlaying = prevBroadcastPlayingRef.current;
    prevBroadcastPlayingRef.current = broadcast.isPlaying;
    if (!wasPlaying && broadcast.isPlaying && handoffPendingRef.current) {
      handoffPendingRef.current = false;
      radioPauseRef.current();
    }
  }, [broadcast.isPlaying]);

  const play = useCallback(async () => {
    if (archivePlayer.isPlaying) archivePlayer.pause();
    if (broadcast.isPlaying) broadcast.pause();
    await radio.play();
  }, [radio, archivePlayer, broadcast]);

  const [visibleSlide, setVisibleSlide] = useState<0 | 1>(0);
  // Defaults to true so the sticky stays hidden until ArchiveHero says
  // otherwise (avoids a flash of sticky on first paint).
  const [inlineCoversActive, setInlineCoversActive] = useState(true);
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);

  // Self-fetch archives so the sticky bar's scene/username/tip resolves
  // identically on every page — not just on / where ArchiveHero feeds the
  // list. ArchiveHero still calls setArchives, but this gives us the same
  // data everywhere else (DJ profiles, /studio, /broadcast/admin, etc.).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/archives');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data?.archives) ? data.archives as ArchiveSerialized[] : [];
        // Don't clobber a richer list set by ArchiveHero — only seed when empty.
        setArchives((prev) => prev.length > 0 ? prev : list);
      } catch {
        // Best-effort; sticky bar falls back to denormalized fields.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

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
  // cumulative timer. At 900s (15 min) we both record a stream count and
  // post the "locked in" chat message. Counters reset whenever the
  // schedule rolls to a new archive.
  const onLockedInRef = useRef<(() => void) | null>(null);
  const cumulativeSecRef = useRef(0);
  const streamCountedForRef = useRef<string | null>(null);
  const lockedInFiredForRef = useRef<string | null>(null);
  const playingArchiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = radio.currentItem?.archiveId ?? null;
    if (id !== playingArchiveIdRef.current) {
      // Schedule rolled to a new archive — reset the counters so the next
      // milestone triggers are fresh.
      playingArchiveIdRef.current = id;
      cumulativeSecRef.current = 0;
      streamCountedForRef.current = null;
      lockedInFiredForRef.current = null;
    }
  }, [radio.currentItem?.archiveId]);

  useEffect(() => {
    if (!radio.isPlaying) return;
    const interval = setInterval(() => {
      cumulativeSecRef.current += 1;
      const id = playingArchiveIdRef.current;
      if (!id) return;
      if (cumulativeSecRef.current >= 900 && streamCountedForRef.current !== id) {
        streamCountedForRef.current = id;
        const archive = currentArchive;
        if (archive) {
          fetch(`/api/archives/${archive.slug}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user?.uid || null }),
          }).catch(() => {});
        }
      }
      if (cumulativeSecRef.current >= 900 && lockedInFiredForRef.current !== id) {
        lockedInFiredForRef.current = id;
        onLockedInRef.current?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [radio.isPlaying, currentArchive, user?.uid]);

  const value = useMemo<ArchiveRadioContextValue>(() => ({
    enabled,
    ready: radio.ready,
    isPlaying: radio.isPlaying,
    isLoading: radio.isLoading,
    error: radio.error,
    stalled: radio.stalled,
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
  }), [
    enabled, radio.ready, radio.isPlaying, radio.isLoading, radio.error,
    radio.stalled, radio.currentItem, radio.nextItem, radio.itemSeekSec, radio.itemDurationSec,
    radio.itemStartMs, radio.itemEndMs, radio.pause, toggle, play, visibleSlide,
    inlineCoversActive, currentArchive,
  ]);

  return (
    <ArchiveRadioContext.Provider value={value}>
      {children}
    </ArchiveRadioContext.Provider>
  );
}

// Returns null when no provider is present. Callers should treat null as
// "no radio in this tree."
export function useArchiveRadioContext(): ArchiveRadioContextValue | null {
  return useContext(ArchiveRadioContext);
}
