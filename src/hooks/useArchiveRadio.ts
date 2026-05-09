'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  findCurrentItem,
  SCHEDULE_COLLECTION,
  todayUtcId,
  tomorrowUtcId,
  utcDayStartMs,
} from '@/lib/archive-schedule';
import type {
  ArchiveScheduleDay,
  ScheduleItem,
} from '@/types/broadcast';

// Minimum lookahead when scheduling the boundary timer; avoids a 0ms timer if
// we're already past the boundary (e.g. tab was just unbackgrounded).
const MIN_BOUNDARY_LEAD_MS = 50;
// If the local <audio> drifts more than this from the schedule's expected
// position (after a tab regain, network stall, etc.), force a re-seek.
const RESYNC_DRIFT_SEC = 2;

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

function deserializeDay(id: string, data: Record<string, unknown> | undefined): ArchiveScheduleDay | null {
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
  return {
    date: id,
    startTimeMs: utcDayStartMs(id),
    generatedAtMs: Number(data.generatedAtMs ?? 0),
    generatedBy: (data.generatedBy as 'cron' | 'admin') ?? 'cron',
    locked: Boolean(data.locked),
    items,
  };
}

// Subscribe to today + tomorrow at once. The day rolls at 00:00 UTC; having
// tomorrow already in memory lets the boundary swap target the new day's
// first item without an extra round-trip.
function useScheduleDays(): {
  today: ArchiveScheduleDay | null;
  tomorrow: ArchiveScheduleDay | null;
  loading: boolean;
} {
  const [todayDoc, setTodayDoc] = useState<ArchiveScheduleDay | null>(null);
  const [tomorrowDoc, setTomorrowDoc] = useState<ArchiveScheduleDay | null>(null);
  const [todayId, setTodayId] = useState(() => todayUtcId());
  const [loading, setLoading] = useState(true);

  // Re-evaluate doc ids periodically so a day rollover swaps subscriptions.
  useEffect(() => {
    const interval = setInterval(() => {
      const id = todayUtcId();
      setTodayId((prev) => (prev === id ? prev : id));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const tId = todayId;
    const tomId = tomorrowUtcId();
    // Two parallel doc subscriptions. (where('__name__','in',…) needs full
    // DocumentReferences, not strings; cleaner to just use doc() directly.)
    let todayLoaded = false;
    let tomorrowLoaded = false;
    const settle = () => {
      if (todayLoaded && tomorrowLoaded) setLoading(false);
    };
    const unsubT = onSnapshot(doc(db, SCHEDULE_COLLECTION, tId), (snap) => {
      setTodayDoc(snap.exists() ? deserializeDay(snap.id, snap.data()) : null);
      todayLoaded = true;
      settle();
    }, (err) => {
      console.error('[useArchiveRadio] today subscribe error', err);
      todayLoaded = true;
      settle();
    });
    const unsubN = onSnapshot(doc(db, SCHEDULE_COLLECTION, tomId), (snap) => {
      setTomorrowDoc(snap.exists() ? deserializeDay(snap.id, snap.data()) : null);
      tomorrowLoaded = true;
      settle();
    }, (err) => {
      console.error('[useArchiveRadio] tomorrow subscribe error', err);
      tomorrowLoaded = true;
      settle();
    });
    return () => {
      unsubT();
      unsubN();
    };
  }, [todayId]);

  return { today: todayDoc, tomorrow: tomorrowDoc, loading };
}

// Compute "what should be playing right now" given today + tomorrow. Crossing
// midnight transparently picks tomorrow's first item once it's the current UTC
// day. If today's doc is missing or empty (e.g. admin only scheduled tomorrow,
// or the cron hasn't run yet), fall back to tomorrow's first item so the
// player still has something to play.
function resolveCurrent(
  today: ArchiveScheduleDay | null,
  tomorrow: ArchiveScheduleDay | null,
  nowMs: number,
): { day: ArchiveScheduleDay; index: number; item: ScheduleItem; seekSec: number } | null {
  for (const day of [today, tomorrow]) {
    if (!day) continue;
    const hit = findCurrentItem(day, nowMs);
    if (hit) return { day, ...hit };
  }
  // Nothing matches "now" in either doc. Fall back to the first item of any
  // non-empty day we have, starting from offset 0.
  for (const day of [today, tomorrow]) {
    if (day && day.items.length > 0) {
      return { day, index: 0, item: day.items[0], seekSec: 0 };
    }
  }
  return null;
}

function getNext(
  current: { day: ArchiveScheduleDay; index: number },
  tomorrow: ArchiveScheduleDay | null,
): { day: ArchiveScheduleDay; index: number; item: ScheduleItem } | null {
  if (current.index + 1 < current.day.items.length) {
    return {
      day: current.day,
      index: current.index + 1,
      item: current.day.items[current.index + 1],
    };
  }
  if (tomorrow && tomorrow.items.length > 0) {
    return { day: tomorrow, index: 0, item: tomorrow.items[0] };
  }
  return null;
}

export function useArchiveRadio(opts: { active: boolean }): UseArchiveRadioResult {
  const { today, tomorrow, loading: scheduleLoading } = useScheduleDays();
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

  const current = useMemo(() => resolveCurrent(today, tomorrow, nowMs), [today, tomorrow, nowMs]);
  const next = useMemo(() => (current ? getNext(current, tomorrow) : null), [current, tomorrow]);

  // Stable key for an item so we can detect changes across re-renders.
  const itemKey = useCallback((day: ArchiveScheduleDay, index: number, item: ScheduleItem) => {
    return `${day.date}#${index}#${item.recordingUrl}#${item.startOffsetSec}`;
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

    const key = itemKey(current.day, current.index, current.item);
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
      const live = resolveCurrent(today, tomorrow, Date.now());
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
  }, [current, ensureAudio, getActive, itemKey, opts.active, today, tomorrow]);

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
    const nextKey = itemKey(next.day, next.index, next.item);
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
    // current.item.durationSec elapses against the day's startTimeMs.
    const boundaryMs = current.day.startTimeMs + (current.item.startOffsetSec + current.item.durationSec) * 1000;
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

  // Re-sync on tab visibility regain. Background tabs throttle setTimeout, so
  // the swap timer may fire late; on resume we recompute "now" and either
  // re-seek the active element or rebuild from the new current item.
  useEffect(() => {
    if (!opts.active) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!isPlaying) return;
      const live = resolveCurrent(today, tomorrow, Date.now());
      if (!live) return;
      const liveKey = itemKey(live.day, live.index, live.item);
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
  }, [opts.active, isPlaying, today, tomorrow, getActive, itemKey, playCurrent]);

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

  // MediaSession metadata + control-center actions. Same iOS rules as
  // useBroadcastStream: ≤128x128 artwork via /_next/image, single entry,
  // disable skip/seek so listeners can't scrub through a synced stream.
  useEffect(() => {
    if (!opts.active) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!current || !isPlaying) return;
    const item = current.item;
    const artist = (item.djs?.length ? item.djs.map((d) => d.name).join(', ') : undefined);
    const fallback = `${window.location.origin}/apple-touch-icon.png`;
    const proxy = (url: string) =>
      url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=128&q=75`;
    const artworkSrc = item.artworkUrl ? proxy(item.artworkUrl) : fallback;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title || 'Archive radio',
        artist,
        album: 'channel — archive radio',
        artwork: [{ src: artworkSrc, sizes: '128x128', type: 'image/png' }],
      });
    } catch { /* ignore */ }
    const disable: MediaSessionAction[] = ['seekforward', 'seekbackward', 'previoustrack', 'nexttrack'];
    for (const a of disable) {
      try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
    }
    try { navigator.mediaSession.setActionHandler('seekto', () => {}); } catch { /* ignore */ }
    try { navigator.mediaSession.setActionHandler('play', () => { void play(); }); } catch { /* ignore */ }
    try { navigator.mediaSession.setActionHandler('pause', () => { pause(); }); } catch { /* ignore */ }
  }, [current, isPlaying, opts.active, play, pause]);

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
    ? current.day.startTimeMs + current.item.startOffsetSec * 1000
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
      ? Math.max(0, (nowMs - current.day.startTimeMs) / 1000 - current.item.startOffsetSec)
      : 0,
    itemDurationSec: current?.item.durationSec ?? 0,
    itemStartMs,
    itemEndMs,
    play,
    pause,
    toggle,
  };
}
