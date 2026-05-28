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
// Interlude clips play at this gain so they don't blast vs the surrounding
// archives. Archives play at 1.0.
const INTERLUDE_GAIN = 0.52;

interface UseArchiveRadioResult {
  ready: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  stalled: boolean;
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
      interstitialCount: Number(stats.interstitialCount ?? 0),
      alignedAnchorCount: stats.alignedAnchorCount === undefined ? undefined : Number(stats.alignedAnchorCount),
      missedAnchorCount: stats.missedAnchorCount === undefined ? undefined : Number(stats.missedAnchorCount),
      totalItems: Number(stats.totalItems ?? items.length),
    },
    items,
  };
}

// Subscribe to the loop currently playing + the loop after it.
function useScheduleLoops(): {
  current: ArchiveRadioLoop | null;
  next: ArchiveRadioLoop | null;
  loading: boolean;
} {
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

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { current, next } = useMemo(() => {
    const now = Date.now();
    const playing = latestLoops.find((l) => l.startTimeMs <= now) ?? null;
    if (!playing) return { current: null, next: null };
    const upcoming = latestLoops.find((l) => l.loopNumber === playing.loopNumber + 1) ?? null;
    return { current: playing, next: upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestLoops, tick]);

  return { current, next, loading };
}

function resolveCurrent(
  current: ArchiveRadioLoop | null,
  next: ArchiveRadioLoop | null,
  nowMs: number,
): { loop: ArchiveRadioLoop; index: number; item: ScheduleItem; seekSec: number } | null {
  if (current) {
    const hit = findCurrentItemInLoop(current, nowMs);
    if (hit) return { loop: current, ...hit };
    if (nowMs >= loopEndMs(current) && next) {
      const nextHit = findCurrentItemInLoop(next, nowMs);
      if (nextHit) return { loop: next, ...nextHit };
    }
  }
  if (next) {
    const hit = findCurrentItemInLoop(next, nowMs);
    if (hit) return { loop: next, ...hit };
  }
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
  const [stalled, setStalled] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!opts.active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [opts.active]);

  // Single <audio> element — hard-cut between items at each boundary. Same
  // pattern as useBroadcastStream (stable on iOS). Crossfade was attempted
  // via a dual-element model but dual <audio> elements transitioning state
  // in the same tick destabilize the iOS audio session (see
  // feedback_ios_gesture_unlock_dance).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The item we're currently playing — used to detect when the schedule has
  // advanced past the current item and we need to switch source.
  const playingKeyRef = useRef<string | null>(null);
  // Timer that fires at the next item boundary to start the next item.
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Belt-and-suspenders ensure-next-loop ping bookkeeping.
  const ensureNextPingedForRef = useRef<number | null>(null);
  // Last MediaSession metadata signature we wrote. Skipping no-op rewrites
  // matters on iOS: rapid metadata churn can destabilize the audio session.
  const lastMediaSessionSigRef = useRef<string | null>(null);

  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.setAttribute('webkit-playsinline', '');
      a.addEventListener('pause', () => {
        // Mirror external pause (audio-exclusive registry, OS audio session)
        // into React state. Cancel any pending boundary timer.
        if (boundaryTimerRef.current) {
          clearTimeout(boundaryTimerRef.current);
          boundaryTimerRef.current = null;
        }
        setIsPlaying(false);
      });
      a.addEventListener('play', () => setIsPlaying(true));
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const current = useMemo(() => resolveCurrent(currentLoop, nextLoop, nowMs), [currentLoop, nextLoop, nowMs]);
  const next = useMemo(() => (current ? getNext(current, nextLoop) : null), [current, nextLoop]);

  const itemKey = useCallback((loop: ArchiveRadioLoop, index: number, item: ScheduleItem) => {
    return `loop-${loop.loopNumber}#${index}#${item.recordingUrl}#${item.startOffsetSec}`;
  }, []);

  // Set src + seek + play the active item. Used on first play and on every
  // boundary. Single element, hard cut.
  const playCurrent = useCallback(async () => {
    if (!opts.active) return;
    if (!current) return;
    const active = ensureAudio();
    if (!active) return;

    const key = itemKey(current.loop, current.index, current.item);
    const needsLoad = playingKeyRef.current !== key || active.src !== current.item.recordingUrl;

    if (needsLoad) {
      setIsLoading(true);
      active.src = current.item.recordingUrl;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          active.removeEventListener('loadedmetadata', onReady);
          active.removeEventListener('error', onReady);
          clearTimeout(timer);
          resolve();
        };
        const onReady = () => finish();
        const timer = setTimeout(finish, 10000);
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
          try { active.currentTime = desiredOffset; } catch { /* ignore */ }
        }
      }
      // Interludes sit lower than archives so they don't blast.
      active.volume = current.item.kind === 'interstitial' ? INTERLUDE_GAIN : 1;
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
  }, [current, ensureAudio, itemKey, opts.active, currentLoop, nextLoop]);

  const play = useCallback(async () => {
    setError(null);
    setStalled(false);
    await playCurrent();
  }, [playCurrent]);

  const pause = useCallback(() => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    audioRef.current?.pause();
    setIsPlaying(false);
    setStalled(false);
  }, []);

  const toggle = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, pause, play]);

  // Schedule a boundary timer to advance to the next item when the current
  // item ends. Hard cut: pause current, set new src, play. Same element.
  useEffect(() => {
    if (!opts.active || !isPlaying) return;
    if (!current) return;

    const boundaryMs = current.loop.startTimeMs + (current.item.startOffsetSec + current.item.durationSec) * 1000;
    const delay = Math.max(MIN_BOUNDARY_LEAD_MS, boundaryMs - Date.now());

    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    boundaryTimerRef.current = setTimeout(() => {
      // playCurrent will resolve the now-current item against the live
      // schedule (not the captured `next` from this closure) so a slow
      // tab regain or a schedule update is handled correctly.
      void playCurrent();
    }, delay);

    return () => {
      if (boundaryTimerRef.current) {
        clearTimeout(boundaryTimerRef.current);
        boundaryTimerRef.current = null;
      }
    };
  }, [current, isPlaying, opts.active, playCurrent]);

  // Belt-and-suspenders ensure-next-loop trigger.
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

  // Re-sync on tab visibility regain. Background tabs throttle setTimeout so
  // the boundary timer may fire late; on resume we recompute "now" and either
  // re-seek the active element or switch to the live item.
  useEffect(() => {
    if (!opts.active) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isPlaying) return;
      const live = resolveCurrent(currentLoop, nextLoop, Date.now());
      if (!live) return;
      const liveKey = itemKey(live.loop, live.index, live.item);
      const active = audioRef.current;
      if (!active) return;
      if (playingKeyRef.current !== liveKey) {
        void playCurrent();
        return;
      }
      if (Math.abs(active.currentTime - live.seekSec) > RESYNC_DRIFT_SEC) {
        try { active.currentTime = live.seekSec; } catch { /* ignore */ }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [opts.active, isPlaying, currentLoop, nextLoop, itemKey, playCurrent]);

  // MediaSession metadata + control-center actions. Dedupe writes by a
  // signature ref so iOS doesn't see metadata churn on every re-render.
  useEffect(() => {
    if (!opts.active) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!current) return;
    if (!isPlaying) return;
    const item = current.item;
    const artist = (item.djs?.length ? item.djs.map((d) => d.name).join(', ') : undefined);
    const fallback = `${window.location.origin}/artwork-fallback.png`;
    const proxy = (url: string) =>
      url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=128&q=75`;
    const djPhoto = item.djs?.find((d) => d.photoUrl)?.photoUrl;
    const rawArtwork = item.artworkUrl || djPhoto;
    const artworkSrc = rawArtwork ? proxy(rawArtwork) : fallback;
    const title = item.title || 'Archive radio';
    const sig = `radio|${title}|${artist || ''}|${artworkSrc}`;
    if (sig !== lastMediaSessionSigRef.current) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album: 'channel — archive radio',
          artwork: [{ src: artworkSrc, sizes: '128x128', type: 'image/png' }],
        });
        lastMediaSessionSigRef.current = sig;
      } catch { /* ignore */ }
    }
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch { /* ignore */ }
    const disable: MediaSessionAction[] = ['seekforward', 'seekbackward', 'previoustrack', 'nexttrack'];
    for (const a of disable) {
      try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
    }
    try { navigator.mediaSession.setActionHandler('seekto', () => {}); } catch { /* ignore */ }
    try { navigator.mediaSession.setActionHandler('play', () => { void play(); }); } catch { /* ignore */ }
    try { navigator.mediaSession.setActionHandler('pause', () => { pause(); }); } catch { /* ignore */ }

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

  // When this player goes inactive (parent toggles `active=false`), pause.
  useEffect(() => {
    if (opts.active) return;
    pause();
  }, [opts.active, pause]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      const a = audioRef.current;
      try { a?.pause(); } catch { /* ignore */ }
      if (a) a.src = '';
      audioRef.current = null;
    };
  }, []);

  // Stall detector.
  useEffect(() => {
    if (!isPlaying) {
      if (stalled) setStalled(false);
      return;
    }
    let lastTime = -1;
    let stagnantTicks = 0;
    const id = setInterval(() => {
      const active = audioRef.current;
      if (!active) return;
      const t = active.currentTime;
      if (t === lastTime) {
        stagnantTicks += 1;
        if (stagnantTicks >= 2 && !stalled) setStalled(true);
      } else {
        stagnantTicks = 0;
        if (stalled) setStalled(false);
      }
      lastTime = t;
    }, 2000);
    return () => clearInterval(id);
  }, [isPlaying, stalled]);

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
    stalled,
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
