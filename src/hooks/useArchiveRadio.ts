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
// 5s overlap crossfade. Outgoing fades down while incoming rises. Curves are
// per-transition (peakTaper for incoming interlude, smoothstep for incoming
// archive). Schedule offsets are -CROSSFADE_SEC-compressed in
// archive-schedule.ts so the audible boundary lines up with schedule time.
const CROSSFADE_MS = 5000;

// Curve fns (pure). p in [0, 1]. Equal-power crossfade: outV² + inV² = 1.
const sqrtCurve = (p: number) => Math.sqrt(p);
const invSqrt = (p: number) => Math.sqrt(1 - p);
// Smoothstep — gentler in-ramp for incoming archive after an interlude.
// √p hits 0.45 at p=0.2 (1s); smoothstep hits 0.10. Soft enough that the
// archive sneaks in over the interlude's tail rather than punching in.
const smoothstep = (p: number) => p * p * (3 - 2 * p);

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

  // Dual <audio> elements: A and B swap roles between items so the standby
  // can preload the next file's buffer while the active is playing. At
  // boundary we pause active + play standby — gapless because the standby
  // is already at readyState >= 3. This is the pattern that worked on
  // mobile before interludes were added. No crossfade, no rAF, no
  // gesture-unlock dance — those were the iOS-destabilizing additions, not
  // the dual-element itself.
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeKeyRef = useRef<'A' | 'B'>('A');
  const playingKeyRef = useRef<string | null>(null);
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadedNextKeyRef = useRef<string | null>(null);
  const ensureNextPingedForRef = useRef<number | null>(null);
  // Last MediaSession metadata signature we wrote. Dedupe avoids iOS yanking
  // the audio session under rapid metadata churn.
  const lastMediaSessionSigRef = useRef<string | null>(null);
  // Crossfade state. crossfadeInFlightRef gates the auto-pause-non-active
  // guard so both elements legitimately play during the 5s overlap.
  // primingInFlightRef does the same for the preload-prime play+pause.
  // fadeTokenRef tags each fade so stale finish()/tick() callbacks bail
  // when a newer fade has started (rAF takes slightly longer than the
  // CROSSFADE_MS boundary timer, so the next fade can start before the
  // current one's natural finish runs).
  const crossfadeInFlightRef = useRef(false);
  const primingInFlightRef = useRef(false);
  const crossfadeRafRef = useRef<number | null>(null);
  const crossfadeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTokenRef = useRef(0);
  // Separate timer for the standby preload-prime. Kept off the play() gesture
  // chain — iOS plays the standby audibly (ignoring muted=true) when the
  // prime fires too close to the user gesture that started the active.
  const preloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attachStateListeners = useCallback((el: HTMLAudioElement) => {
    el.addEventListener('pause', () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      if (el === active) {
        if (boundaryTimerRef.current) {
          clearTimeout(boundaryTimerRef.current);
          boundaryTimerRef.current = null;
        }
        setIsPlaying(false);
      }
    });
    el.addEventListener('play', () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      if (el === active) {
        setIsPlaying(true);
        return;
      }
      // Guard suppressed during legitimate crossfades and preload prime.
      if (crossfadeInFlightRef.current || primingInFlightRef.current) return;
      try { el.pause(); } catch { /* ignore */ }
    });
  }, []);

  const ensureAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!audioARef.current) {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.setAttribute('webkit-playsinline', '');
      attachStateListeners(a);
      audioARef.current = a;
    }
    if (!audioBRef.current) {
      const b = new Audio();
      b.crossOrigin = 'anonymous';
      b.preload = 'auto';
      b.setAttribute('playsinline', '');
      b.setAttribute('webkit-playsinline', '');
      attachStateListeners(b);
      audioBRef.current = b;
    }
    return { a: audioARef.current, b: audioBRef.current };
  }, [attachStateListeners]);

  const getActive = useCallback(() => {
    return activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
  }, []);
  const getStandby = useCallback(() => {
    return activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current;
  }, []);

  const current = useMemo(() => resolveCurrent(currentLoop, nextLoop, nowMs), [currentLoop, nextLoop, nowMs]);
  const next = useMemo(() => (current ? getNext(current, nextLoop) : null), [current, nextLoop]);

  const itemKey = useCallback((loop: ArchiveRadioLoop, index: number, item: ScheduleItem) => {
    return `loop-${loop.loopNumber}#${index}#${item.recordingUrl}#${item.startOffsetSec}`;
  }, []);

  // Drive the active element to play `current.item` from the right offset.
  const playCurrent = useCallback(async () => {
    if (!opts.active) return;
    if (!current) return;
    const els = ensureAudio();
    if (!els) return;
    const active = getActive();
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
      const live = resolveCurrent(currentLoop, nextLoop, Date.now());
      if (live) {
        const desiredOffset = live.seekSec;
        if (Math.abs(active.currentTime - desiredOffset) > RESYNC_DRIFT_SEC) {
          try { active.currentTime = desiredOffset; } catch { /* ignore */ }
        }
      }
      active.volume = 1;
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
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    // Cancel any in-flight crossfade so a future resume starts clean.
    if (crossfadeRafRef.current !== null) {
      cancelAnimationFrame(crossfadeRafRef.current);
      crossfadeRafRef.current = null;
    }
    if (crossfadeWatchdogRef.current) {
      clearTimeout(crossfadeWatchdogRef.current);
      crossfadeWatchdogRef.current = null;
    }
    crossfadeInFlightRef.current = false;
    audioARef.current?.pause();
    audioBRef.current?.pause();
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

  // Preload the standby element. Split by kind to match the verified
  // test-page pattern:
  //   - Interlude (small file ~100-250KB): plain .src + .load(), NO prime.
  //     The prime's play() leaks audibly on iOS because tiny files decode
  //     faster than our pause() lands. .load() + preload="auto" with a few
  //     seconds lead is enough for the browser to fetch.
  //   - Archive (large file ~50-100MB): play+pause-muted prime. iOS lazy-
  //     fetches without it, so fade starts silent for several seconds. The
  //     prime doesn't leak audibly here — large files take long enough to
  //     decode that no audible output happens before our pause() lands.
  const preloadStandby = useCallback(async (url: string, kind: ScheduleItem['kind']) => {
    const standby = getStandby();
    if (!standby) return;
    if (kind === 'interstitial') {
      standby.src = url;
      standby.volume = 0;
      standby.muted = false;
      standby.preload = 'auto';
      standby.load();
      return;
    }
    // archive: full prime
    standby.src = url;
    standby.volume = 0;
    standby.muted = true;
    standby.load();
    primingInFlightRef.current = true;
    try {
      await standby.play();
      standby.pause();
      standby.currentTime = 0;
      standby.muted = false;
    } catch {
      standby.muted = false;
    } finally {
      primingInFlightRef.current = false;
    }
  }, [getStandby]);

  // 5s equal-power crossfade. Flip activeKeyRef so the new incoming is treated
  // as active, start incoming.play() while outgoing is still playing, rAF tick
  // ramps volumes via invSqrt out + caller-chosen in curve. Default is sqrt
  // (equal-power). interlude→archive passes smoothstep so the archive doesn't
  // punch in over the interlude's tail. Watchdog forces finish if rAF was
  // throttled. Token-tagged so a newer fade's force-finish doesn't have its
  // captured `outgoing` paused by a stale finish() callback.
  const runCrossfade = useCallback((
    outgoing: HTMLAudioElement,
    incoming: HTMLAudioElement,
    inCurve: (p: number) => number,
    onFinish?: () => void,
  ) => {
    // A previous fade still in flight (rAF takes slightly longer than
    // CROSSFADE_MS to reach p=1). Synchronously snap it to final state so
    // its captured `outgoing` is paused and won't fight this new fade.
    if (crossfadeInFlightRef.current) {
      if (crossfadeRafRef.current !== null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
      if (crossfadeWatchdogRef.current) {
        clearTimeout(crossfadeWatchdogRef.current);
        crossfadeWatchdogRef.current = null;
      }
      // Prior fade's outgoing = element BEFORE this fade's outgoing (which
      // is the prior fade's incoming, now active). Pause directly.
      const priorOutgoing = activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current;
      if (priorOutgoing) {
        try { priorOutgoing.pause(); } catch { /* ignore */ }
        priorOutgoing.volume = 0;
      }
      crossfadeInFlightRef.current = false;
    }

    const myToken = ++fadeTokenRef.current;
    crossfadeInFlightRef.current = true;
    try { incoming.currentTime = 0; } catch { /* ignore */ }
    incoming.volume = 0;
    const fromSide = activeKeyRef.current;
    // Flip active immediately. Guard is gated by crossfadeInFlightRef.
    activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
    const toSide = activeKeyRef.current;
    console.log(
      '[radio-debug] CROSSFADE-START token=' + myToken,
      'out=' + fromSide + '(ct=' + outgoing.currentTime.toFixed(2) + ' paused=' + outgoing.paused + ')',
      'in=' + toSide + '(rs=' + incoming.readyState + ' paused=' + incoming.paused + ')',
    );
    const p = incoming.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => console.warn('[useArchiveRadio] crossfade play() rejected', err));
    }

    const startedAt = performance.now();
    let midLogged = false;
    let tickCount = 0;
    const finish = () => {
      // Stale: a newer fade's force-finish handled cleanup already. Bail.
      if (fadeTokenRef.current !== myToken) return;
      if (crossfadeRafRef.current !== null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
      if (crossfadeWatchdogRef.current) {
        clearTimeout(crossfadeWatchdogRef.current);
        crossfadeWatchdogRef.current = null;
      }
      console.log(
        '[radio-debug] CROSSFADE-END token=' + myToken,
        'ticks=' + tickCount,
        'out.ct=' + outgoing.currentTime.toFixed(2),
        'in.ct=' + incoming.currentTime.toFixed(2),
      );
      try { outgoing.pause(); } catch { /* ignore */ }
      outgoing.volume = 0;
      incoming.volume = 1;
      crossfadeInFlightRef.current = false;
      if (onFinish) {
        try { onFinish(); } catch (e) { console.warn('[useArchiveRadio] crossfade onFinish threw', e); }
      }
    };

    const tick = (t: number) => {
      if (fadeTokenRef.current !== myToken) return;
      const elapsed = t - startedAt;
      // Clamp p to [0, 1] — negative p from clock skew makes pow(neg, frac)=NaN
      // which throws when assigned to audio.volume, killing the rAF loop.
      const p = Math.min(1, Math.max(0, elapsed / CROSSFADE_MS));
      const outV = invSqrt(p);
      const inV = inCurve(p);
      outgoing.volume = outV;
      incoming.volume = inV;
      tickCount++;
      if (!midLogged && p >= 0.5) {
        midLogged = true;
        console.log(
          '[radio-debug] CROSSFADE-MID token=' + myToken,
          'outV=' + outV.toFixed(2),
          'inV=' + inV.toFixed(2),
          'out.paused=' + outgoing.paused,
          'in.paused=' + incoming.paused,
        );
      }
      if (p < 1) {
        crossfadeRafRef.current = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    crossfadeRafRef.current = requestAnimationFrame(tick);
    crossfadeWatchdogRef.current = setTimeout(() => {
      if (crossfadeInFlightRef.current) {
        finish();
      }
    }, CROSSFADE_MS + 500);
  }, []);

  // Boundary effect: schedule the fade-start CROSSFADE_MS before the
  // current item's audible end. Preloads `next` on the standby; fires the
  // 5s crossfade at the right moment. Post-fade onFinish updates the
  // playingKey; the next pass of this effect picks up the new `current`.
  //
  // CRITICAL: this effect MUST NOT re-run every nowMs tick (1 Hz). Each
  // re-run computes `delay = fadeStartMs - Date.now()`, and once we're
  // past fadeStartMs (during the in-flight fade and until `current`
  // flips), that becomes negative → clamped to MIN_BOUNDARY_LEAD_MS=50ms
  // → boundary timer re-fires every 50ms → runCrossfade called over and
  // over → incoming.currentTime=0 + incoming.play() repeatedly →
  // "0.25s repeating he-he-he" sound the user reported.
  //
  // Solution: depend on stable IDENTIFIERS of current/next, not the
  // objects themselves. `current` is a useMemo that returns a new object
  // each nowMs tick even when the underlying item hasn't changed. By
  // keying on currentKey/nextKey/loop.startTimeMs strings, the effect
  // re-runs ONLY when the schedule actually advances (boundary crossed)
  // or the loop doc itself changes (admin regen, cron rollover).
  // This mirrors the test page, where there is no 1 Hz ticker at all.
  const currentKey = current ? itemKey(current.loop, current.index, current.item) : null;
  const nextKey = next ? itemKey(next.loop, next.index, next.item) : null;
  const currentLoopStartMs = current?.loop.startTimeMs ?? null;

  useEffect(() => {
    if (!opts.active || !isPlaying) return;
    if (!current || !next || !currentKey || !nextKey) return;

    // Boundary in clock-time = current item's audible end. The crossfade
    // starts CROSSFADE_MS before that. Schedule offsets in Firestore are
    // already -CROSSFADE_SEC-compressed by buildLoop, so item.startOffset
    // + item.duration IS the audible end moment.
    const boundaryMs = current.loop.startTimeMs + (current.item.startOffsetSec + current.item.durationSec) * 1000;
    const fadeStartMs = boundaryMs - CROSSFADE_MS;

    // Preload `next` on the standby. Both kinds preload here when this
    // effect runs (which is only at boundaries thanks to our key-stable
    // deps). The kind-split happens INSIDE preloadStandby:
    //   - Interlude: plain .src + .load(), no prime
    //   - Archive: .src + .load() + play+pause-muted prime
    // The onFinish callback below ALSO preloads the item-after-next, so
    // by the time we hit the next boundary's effect run, that item is
    // already preloaded and preloadedNextKeyRef will short-circuit here.
    if (preloadedNextKeyRef.current !== nextKey) {
      // CRITICAL: do NOT preload if a fade is in flight. The "standby"
      // element returned by getStandby() at this moment is actually the
      // OUTGOING side of the in-flight fade (activeKey already flipped at
      // fade-start, so what's playing as outgoing is now categorized as
      // standby). Setting .src on it wipes its currentTime → kills the
      // archive that's supposed to be fading out. The fade's onFinish
      // hook below handles the after-next preload safely.
      if (!crossfadeInFlightRef.current) {
        preloadedNextKeyRef.current = nextKey;
        void preloadStandby(next.item.recordingUrl, next.item.kind);
      }
    }

    const delay = Math.max(MIN_BOUNDARY_LEAD_MS, fadeStartMs - Date.now());
    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    boundaryTimerRef.current = setTimeout(() => {
      const outgoing = getActive();
      const incoming = getStandby();
      if (!outgoing || !incoming) return;
      // Gentler in-curve when bringing an archive in after an interlude —
      // music punching in over speech is harsh; smoothstep eases it.
      const inCurve = current.item.kind === 'interstitial' && next.item.kind === 'archive'
        ? smoothstep
        : sqrtCurve;
      runCrossfade(outgoing, incoming, inCurve, () => {
        playingKeyRef.current = nextKey;
        const afterNext = getNext({ loop: next.loop, index: next.index }, nextLoop);
        if (!afterNext) return;
        const afterKey = itemKey(afterNext.loop, afterNext.index, afterNext.item);
        if (preloadedNextKeyRef.current === afterKey) return;
        preloadedNextKeyRef.current = afterKey;
        void preloadStandby(afterNext.item.recordingUrl, afterNext.item.kind);
      });
    }, delay);

    return () => {
      if (boundaryTimerRef.current) {
        clearTimeout(boundaryTimerRef.current);
        boundaryTimerRef.current = null;
      }
    };
    // Effect re-runs ONLY when the schedule advances (currentKey/nextKey
    // change) or the loop doc itself changes (currentLoopStartMs change).
    // It deliberately does NOT depend on `current`/`next` object refs (which
    // change every nowMs tick) — see the long comment above the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, nextKey, currentLoopStartMs, isPlaying, opts.active]);

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

  // Re-sync on tab visibility regain.
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

  useEffect(() => {
    if (opts.active) return;
    pause();
  }, [opts.active, pause]);

  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
      if (crossfadeRafRef.current !== null) cancelAnimationFrame(crossfadeRafRef.current);
      if (crossfadeWatchdogRef.current) clearTimeout(crossfadeWatchdogRef.current);
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

  useEffect(() => {
    if (!isPlaying) {
      if (stalled) setStalled(false);
      return;
    }
    let lastTime = -1;
    let stagnantTicks = 0;
    const id = setInterval(() => {
      const active = getActive();
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
  }, [isPlaying, stalled, getActive]);

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
