'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  findCurrentItemInLoop,
  loopEndMs,
  LOOP_COLLECTION,
} from '@/lib/archive-schedule';
import type {
  ArchiveRadioLoop,
  ScheduleItem,
} from '@/types/broadcast';

// Minimum lookahead when scheduling the boundary timer; avoids a 0ms timer if
// we're already past the boundary (e.g. tab was just unbackgrounded).
const MIN_BOUNDARY_LEAD_MS = 50;
// If the local <audio> drifts more than this from the schedule's expected
// position (after a tab regain, network stall, etc.), force a re-seek.
const RESYNC_DRIFT_SEC = 2;
// When the current loop has less than this remaining, ask the server to make
// sure the next loop exists. Belt-and-suspenders for the cron.
const ENSURE_NEXT_LEAD_MS = 6 * 60 * 60 * 1000;

interface UseArchiveRadioResult {
  ready: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentItem: ScheduleItem | null;
  nextItem: ScheduleItem | null;
  itemSeekSec: number;
  itemDurationSec: number;
  itemStartMs: number | null;
  itemEndMs: number | null;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
}

function deserializeLoop(id: string, data: Record<string, unknown> | undefined): ArchiveRadioLoop | null {
  if (!data) return null;
  const itemsRaw = data.items;
  if (!Array.isArray(itemsRaw)) return null;
  const items: ScheduleItem[] = [];
  for (const raw of itemsRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind = r.kind as ScheduleItem['kind'] | undefined;
    const recordingUrl = r.recordingUrl as string | undefined;
    const durationSec = Number(r.durationSec ?? 0);
    const startOffsetSec = Number(r.startOffsetSec ?? 0);
    if (!kind || !recordingUrl || !durationSec) continue;
    items.push({
      kind,
      archiveId: r.archiveId as string | undefined,
      interstitialId: r.interstitialId as string | undefined,
      recordingUrl,
      durationSec,
      startOffsetSec,
      title: r.title as string | undefined,
      djs: Array.isArray(r.djs) ? (r.djs as { name: string; username?: string; photoUrl?: string }[]) : undefined,
      artworkUrl: r.artworkUrl as string | undefined,
      sceneSlugs: Array.isArray(r.sceneSlugs)
        ? (r.sceneSlugs as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined,
    });
  }
  const loopNumber = Number(data.loopNumber ?? Number(id.replace('loop-', '')) ?? 0);
  const stats = (data.catalogStats as Record<string, unknown> | undefined) ?? {};
  return {
    loopNumber,
    startTimeMs: Number(data.startTimeMs ?? 0),
    totalDurationSec: Number(data.totalDurationSec ?? 0),
    generatedAtMs: Number(data.generatedAtMs ?? 0),
    generatedBy: (data.generatedBy as 'cron' | 'admin') ?? 'cron',
    locked: Boolean(data.locked),
    catalogStats: {
      highCount: Number(stats.highCount ?? 0),
      mediumCount: Number(stats.mediumCount ?? 0),
      totalItems: Number(stats.totalItems ?? items.length),
    },
    items,
  };
}

// Subscribe to the loop currently playing + the loop after it. Logic:
//   1. Find the most recent loop whose startTimeMs <= now (the candidate).
//   2. Subscribe to that loop AND to loopNumber + 1 for the preload.
//   3. When the current loop's end-time passes, the candidate query naturally
//      picks up the new latest, so we just re-resolve every minute.
function useScheduleLoops(): {
  current: ArchiveRadioLoop | null;
  next: ArchiveRadioLoop | null;
  loading: boolean;
} {
  // We subscribe to the latest 5 loops by loopNumber. The "currently playing"
  // loop is derived from this list + a 1-min tick (so a loop boundary crossing
  // mid-session advances the currentNumber even if no new doc is written).
  const [latestLoops, setLatestLoops] = useState<ArchiveRadioLoop[]>([]);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;
    const q = query(
      collection(db, LOOP_COLLECTION),
      orderBy('loopNumber', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      const loops: ArchiveRadioLoop[] = [];
      for (const d of snap.docs) {
        const loop = deserializeLoop(d.id, d.data());
        if (loop) loops.push(loop);
      }
      setLatestLoops(loops);
      setLoading(false);
    }, (err) => {
      console.error('[useArchiveRadio] loops subscribe error', err);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Re-derive every minute so a loop boundary advances `current` without
  // requiring a new doc to land in the snapshot.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { current, next } = useMemo(() => {
    const now = Date.now();
    // latestLoops is sorted desc by loopNumber. Find the highest-numbered loop
    // whose start is <= now; that's the currently playing one.
    const playing = latestLoops.find((l) => l.startTimeMs <= now) ?? null;
    if (!playing) return { current: null, next: null };
    const upcoming = latestLoops.find((l) => l.loopNumber === playing.loopNumber + 1) ?? null;
    return { current: playing, next: upcoming };
    // tick deliberately included so this re-evaluates each minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestLoops, tick]);

  return { current, next, loading };
}

// Compute "what should be playing right now" given current + next loops. If
// the current loop has ended (nowMs > endMs), advance to the next loop's
// first item. If neither loop matches, fall back to the first item of any
// non-empty loop we have (so the player still has something).
function resolveCurrent(
  current: ArchiveRadioLoop | null,
  next: ArchiveRadioLoop | null,
  nowMs: number,
): { loop: ArchiveRadioLoop; index: number; item: ScheduleItem; seekSec: number } | null {
  if (current) {
    const hit = findCurrentItemInLoop(current, nowMs);
    if (hit) return { loop: current, ...hit };
    // Current loop has ended (or hasn't started yet — unlikely since we
    // selected it for startTimeMs <= now).
    if (nowMs >= loopEndMs(current) && next) {
      const nextHit = findCurrentItemInLoop(next, nowMs);
      if (nextHit) return { loop: next, ...nextHit };
    }
  }
  if (next) {
    const hit = findCurrentItemInLoop(next, nowMs);
    if (hit) return { loop: next, ...hit };
  }
  // Nothing matches "now". Fall back to the first item of either loop.
  for (const loop of [current, next]) {
    if (loop && loop.items.length > 0) {
      return { loop, index: 0, item: loop.items[0], seekSec: 0 };
    }
  }
  return null;
}

function getNext(
  current: { loop: ArchiveRadioLoop; index: number },
  nextLoop: ArchiveRadioLoop | null,
): { loop: ArchiveRadioLoop; index: number; item: ScheduleItem } | null {
  if (current.index + 1 < current.loop.items.length) {
    return {
      loop: current.loop,
      index: current.index + 1,
      item: current.loop.items[current.index + 1],
    };
  }
  if (nextLoop && nextLoop.items.length > 0) {
    return { loop: nextLoop, index: 0, item: nextLoop.items[0] };
  }
  return null;
}

export function useArchiveRadio(opts: { active: boolean }): UseArchiveRadioResult {
  const { current: currentLoop, next: nextLoop, loading: scheduleLoading } = useScheduleLoops();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tick once per second to drive UI updates (progress bar, current/next).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!opts.active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [opts.active]);

  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  // Which element is the *active* (playing) one. The other holds the preload.
  const activeKeyRef = useRef<'A' | 'B'>('A');
  // Remember the current item's id+offset so we can detect when the schedule
  // mutates the *currently playing* slot (rare; admin reorder edge case).
  const playingKeyRef = useRef<string | null>(null);
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadedNextKeyRef = useRef<string | null>(null);
  // Belt-and-suspenders: we ping `/api/admin/archive-radio-loop/ensure-next`
  // when the current loop is within ENSURE_NEXT_LEAD_MS of its end and no
  // next-loop doc exists. Track which loopNumber we've already pinged for so
  // we don't spam the endpoint every second.
  const ensureNextPingedForRef = useRef<number | null>(null);

  // Lazily create both audio elements on first activation. Created with iOS
  // attrs set up-front (matches feedback_ios_mediasession + the existing
  // useBroadcastStream pattern: playsinline + crossOrigin must be set before
  // the first .play()).
  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!audioARef.current) {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.setAttribute('webkit-playsinline', '');
      audioARef.current = a;
    }
    if (!audioBRef.current) {
      const b = new Audio();
      b.crossOrigin = 'anonymous';
      b.preload = 'auto';
      b.setAttribute('playsinline', '');
      b.setAttribute('webkit-playsinline', '');
      audioBRef.current = b;
    }
    return { a: audioARef.current, b: audioBRef.current };
  }, []);

  const getActive = useCallback(() => {
    return activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
  }, []);
  const getStandby = useCallback(() => {
    return activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current;
  }, []);

  const current = useMemo(() => resolveCurrent(currentLoop, nextLoop, nowMs), [currentLoop, nextLoop, nowMs]);
  const next = useMemo(() => (current ? getNext(current, nextLoop) : null), [current, nextLoop]);

  // Stable key for an item so we can detect changes across re-renders.
  const itemKey = useCallback((loop: ArchiveRadioLoop, index: number, item: ScheduleItem) => {
    return `loop-${loop.loopNumber}#${index}#${item.recordingUrl}#${item.startOffsetSec}`;
  }, []);

  // Drive the active element to play `current.item` from the right offset.
  const playCurrent = useCallback(async () => {
    if (!opts.active) return;
    if (!current) {
      setError('No archive scheduled right now.');
      return;
    }
    const els = ensureAudio();
    if (!els) return;
    const active = getActive();
    if (!active) return;

    const key = itemKey(current.loop, current.index, current.item);
    const needsLoad = playingKeyRef.current !== key || active.src !== current.item.recordingUrl;

    if (needsLoad) {
      setIsLoading(true);
      active.src = current.item.recordingUrl;
      // Wait for metadata so seek works reliably (esp. on Safari/iOS).
      await new Promise<void>((resolve) => {
        const onReady = () => {
          active.removeEventListener('loadedmetadata', onReady);
          active.removeEventListener('error', onReady);
          resolve();
        };
        active.addEventListener('loadedmetadata', onReady);
        active.addEventListener('error', onReady);
      });
    }

    try {
      // Re-resolve "now" right before play to minimize sync drift.
      const live = resolveCurrent(currentLoop, nextLoop, Date.now());
      if (live) {
        const desiredOffset = live.seekSec;
        if (Math.abs(active.currentTime - desiredOffset) > RESYNC_DRIFT_SEC) {
          try { active.currentTime = desiredOffset; } catch { /* ignore seek errors */ }
        }
      }
      await active.play();
      playingKeyRef.current = key;
      setIsPlaying(true);
      setError(null);
    } catch (err) {
      setIsPlaying(false);
      setError(err instanceof Error ? err.message : 'Playback failed.');
    } finally {
      setIsLoading(false);
    }
  }, [current, ensureAudio, getActive, itemKey, opts.active, currentLoop, nextLoop]);

  // Public play() — only allowed in response to a user gesture so iOS unlocks.
  const play = useCallback(async () => {
    setError(null);
    await playCurrent();
  }, [playCurrent]);

  const pause = useCallback(() => {
    const a = audioARef.current;
    const b = audioBRef.current;
    a?.pause();
    b?.pause();
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, pause, play]);

  // Preload the next item ~PRELOAD_LEAD_SEC before its boundary, then schedule
  // a swap timer that pauses the current element and starts the standby one.
  useEffect(() => {
    if (!opts.active || !isPlaying) return;
    if (!current || !next) return;
    const standby = getStandby();
    if (!standby) return;
    const nextKey = itemKey(next.loop, next.index, next.item);
    if (preloadedNextKeyRef.current !== nextKey) {
      try {
        standby.src = next.item.recordingUrl;
        standby.preload = 'auto';
        // .load() warms the buffer without playing.
        standby.load();
        preloadedNextKeyRef.current = nextKey;
      } catch (err) {
        console.warn('[useArchiveRadio] preload failed', err);
      }
    }

    // Schedule the swap. The boundary is when current.item.startOffsetSec +
    // current.item.durationSec elapses against the loop's startTimeMs.
    const boundaryMs = current.loop.startTimeMs + (current.item.startOffsetSec + current.item.durationSec) * 1000;
    const delay = Math.max(MIN_BOUNDARY_LEAD_MS, boundaryMs - Date.now());
    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    boundaryTimerRef.current = setTimeout(() => {
      const active = getActive();
      const standbyEl = getStandby();
      if (!active || !standbyEl) return;
      try {
        active.pause();
        active.removeAttribute('src');
        active.load(); // free decoder
      } catch { /* ignore */ }
      // Swap which element is "active".
      activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
      try {
        standbyEl.currentTime = 0;
        const p = standbyEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('[useArchiveRadio] boundary play() rejected', err);
          });
        }
        playingKeyRef.current = nextKey;
        preloadedNextKeyRef.current = null;
      } catch (err) {
        console.warn('[useArchiveRadio] boundary swap failed', err);
      }
    }, delay);

    return () => {
      if (boundaryTimerRef.current) {
        clearTimeout(boundaryTimerRef.current);
        boundaryTimerRef.current = null;
      }
    };
  }, [current, next, isPlaying, opts.active, getActive, getStandby, itemKey]);

  // Belt-and-suspenders ensure-next-loop trigger. When the current loop is
  // within ENSURE_NEXT_LEAD_MS of ending and we don't have a next loop yet,
  // POST to the listener-side endpoint to generate it. The cron is the
  // primary path; this is the fallback for cron misses.
  useEffect(() => {
    if (!opts.active) return;
    if (!currentLoop) return;
    if (nextLoop) return;
    const remaining = loopEndMs(currentLoop) - nowMs;
    if (remaining > ENSURE_NEXT_LEAD_MS) return;
    if (ensureNextPingedForRef.current === currentLoop.loopNumber) return;
    ensureNextPingedForRef.current = currentLoop.loopNumber;
    void fetch('/api/admin/archive-radio-loop/ensure-next', { method: 'POST' }).catch((err) => {
      console.warn('[useArchiveRadio] ensure-next ping failed', err);
    });
  }, [currentLoop, nextLoop, nowMs, opts.active]);

  // Re-sync on tab visibility regain. Background tabs throttle setTimeout, so
  // the swap timer may fire late; on resume we recompute "now" and either
  // re-seek the active element or rebuild from the new current item.
  useEffect(() => {
    if (!opts.active) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isPlaying) return;
      const live = resolveCurrent(currentLoop, nextLoop, Date.now());
      if (!live) return;
      const liveKey = itemKey(live.loop, live.index, live.item);
      const active = getActive();
      if (!active) return;
      if (playingKeyRef.current !== liveKey) {
        // We slept past one or more boundaries — restart from the live item.
        void playCurrent();
        return;
      }
      if (Math.abs(active.currentTime - live.seekSec) > RESYNC_DRIFT_SEC) {
        try { active.currentTime = live.seekSec; } catch { /* ignore */ }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [opts.active, isPlaying, currentLoop, nextLoop, getActive, itemKey, playCurrent]);

  // Keep the user's play state honest if the browser pauses us (network drop,
  // OS audio session loss). We don't auto-resume — that surprises listeners.
  useEffect(() => {
    if (!opts.active) return;
    const a = audioARef.current;
    const b = audioBRef.current;
    if (!a || !b) return;
    const onPause = (el: HTMLAudioElement) => () => {
      // Only treat as a real pause if the element was supposed to be active.
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      if (el === active) setIsPlaying(false);
    };
    const onPlay = (el: HTMLAudioElement) => () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      if (el === active) setIsPlaying(true);
    };
    const aPause = onPause(a); const aPlay = onPlay(a);
    const bPause = onPause(b); const bPlay = onPlay(b);
    a.addEventListener('pause', aPause);
    a.addEventListener('play', aPlay);
    b.addEventListener('pause', bPause);
    b.addEventListener('play', bPlay);
    return () => {
      a.removeEventListener('pause', aPause);
      a.removeEventListener('play', aPlay);
      b.removeEventListener('pause', bPause);
      b.removeEventListener('play', bPlay);
    };
  }, [opts.active]);

  // MediaSession metadata + control-center actions. Mirrors the live
  // broadcast's setup (useBroadcastStream): multi-size artwork via
  // /_next/image so iOS can pick the largest its Control Center will render
  // (smaller sizes remain as a fallback), all skip/seek actions nulled
  // (radio is a synced stream, not scrubbable), and a position state
  // published from the schedule so the lock screen shows the current item's
  // progress through its own duration (just like live shows the
  // show-startTime → endTime progress).
  useEffect(() => {
    if (!opts.active) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!current) return;
    const item = current.item;
    const artist = (item.djs?.length ? item.djs.map((d) => d.name).join(', ') : undefined);
    const fallback = `${window.location.origin}/apple-touch-icon.png`;
    const proxy = (url: string, w: number) =>
      url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75`;
    // Cascade like live (useBroadcastStream): show image → first DJ photo →
    // logo fallback. Some archives don't have showImageUrl set, so without
    // the DJ-photo step the Control Center shows the generic logo.
    const djPhoto = item.djs?.find((d) => d.photoUrl)?.photoUrl;
    const rawArtwork = item.artworkUrl || djPhoto;
    const baseArtwork = rawArtwork || fallback;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || 'Archive radio',
        artist,
        album: 'channel — archive radio',
        artwork: [
          { src: proxy(baseArtwork, 512), sizes: '512x512', type: 'image/png' },
          { src: proxy(baseArtwork, 256), sizes: '256x256', type: 'image/png' },
          { src: proxy(baseArtwork, 128), sizes: '128x128', type: 'image/png' },
        ],
      });
    } catch { /* ignore */ }
    // Reflect intent via playbackState so iOS Control Center keeps the Now
    // Playing entry visible while paused (instead of dropping it when the
    // <audio> element pauses).
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch { /* ignore */ }
    const disable: MediaSessionAction[] = ['seekforward', 'seekbackward', 'previoustrack', 'nexttrack'];
    for (const a of disable) {
      try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
    }
    try { navigator.mediaSession.setActionHandler('seekto', () => {}); } catch { /* ignore */ }
    try { navigator.mediaSession.setActionHandler('play', () => { void play(); }); } catch { /* ignore */ }
    try { navigator.mediaSession.setActionHandler('pause', () => { pause(); }); } catch { /* ignore */ }

    // Position state — same shape as live: a clock-time progress bar that
    // ticks through the current item's slot. Update every 2 minutes (live's
    // cadence) since the scrubber is read-only anyway. Only tick while
    // playing; when paused, leave the last position in place.
    if (isPlaying && current.item.durationSec > 0) {
      const updatePosition = () => {
        const live = resolveCurrent(currentLoop, nextLoop, Date.now());
        if (!live) return;
        try {
          navigator.mediaSession.setPositionState({
            duration: live.item.durationSec,
            position: Math.min(live.seekSec, live.item.durationSec),
            playbackRate: 1,
          });
        } catch { /* ignore */ }
      };
      updatePosition();
      const interval = setInterval(updatePosition, 120_000);
      return () => clearInterval(interval);
    }
  }, [current, isPlaying, opts.active, play, pause, currentLoop, nextLoop]);

  // When this player goes inactive (parent toggles `active=false`, e.g. live
  // mode took over the demo), pause cleanly so audio doesn't double up.
  useEffect(() => {
    if (opts.active) return;
    pause();
  }, [opts.active, pause]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      const a = audioARef.current;
      const b = audioBRef.current;
      try { a?.pause(); } catch { /* ignore */ }
      try { b?.pause(); } catch { /* ignore */ }
      if (a) a.src = '';
      if (b) b.src = '';
      audioARef.current = null;
      audioBRef.current = null;
    };
  }, []);

  const itemStartMs = current
    ? current.loop.startTimeMs + current.item.startOffsetSec * 1000
    : null;
  const itemEndMs = current && itemStartMs !== null
    ? itemStartMs + current.item.durationSec * 1000
    : null;

  return {
    ready: !scheduleLoading,
    isPlaying,
    isLoading,
    error,
    currentItem: current?.item ?? null,
    nextItem: next?.item ?? null,
    itemSeekSec: current
      ? Math.max(0, (nowMs - current.loop.startTimeMs) / 1000 - current.item.startOffsetSec)
      : 0,
    itemDurationSec: current?.item.durationSec ?? 0,
    itemStartMs,
    itemEndMs,
    play,
    pause,
    toggle,
  };
}
