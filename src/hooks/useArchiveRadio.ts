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
  const crossfadeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTokenRef = useRef(0);
  // Crossfade timer worker — singleton for the hook lifetime, lazy-instantiated
  // on first runCrossfade. Drives volume-ramp progress at ~60Hz from a
  // background thread, which (unlike main-thread setInterval/rAF) is not
  // throttled when the tab is hidden or the screen is locked. Validated on
  // iOS Chrome locked-screen at /internal/crossfade-test before this port.
  // See src/workers/crossfade-timer.worker.ts.
  const workerRef = useRef<Worker | null>(null);
  // Handler ref so the singleton worker's onmessage can route to whichever
  // fade is currently in flight. Replaced on each new fade; stale fades' token
  // checks discard their messages even if the handler wasn't swapped yet.
  const workerHandlerRef = useRef<((m: { type: 'tick' | 'done'; token: number; elapsedMs?: number }) => void) | null>(null);
  // Separate timer for the standby preload-prime. Kept off the play() gesture
  // chain — iOS plays the standby audibly (ignoring muted=true) when the
  // prime fires too close to the user gesture that started the active.
  const preloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True only when the user explicitly started the radio. Gates the
  // MediaSession effect so internal crossfade `play` events (which flip
  // setIsPlaying(true) via the play-event listener) can't overwrite the
  // lock-screen metadata while the user is listening to a different source
  // (archive or live) on another page.
  const userInitiatedRef = useRef(false);

  const attachStateListeners = useCallback((el: HTMLAudioElement) => {
    // [audio-diag] tag for grep — investigating iOS audio session kills
    // where audio goes silent but paused stays false. Strip once root cause
    // is identified.
    const which = el === audioARef.current ? 'A' : el === audioBRef.current ? 'B' : '?';
    el.addEventListener('pause', () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      console.log('[audio-diag] radio.' + which + ' PAUSE ct=' + el.currentTime.toFixed(2) + ' ended=' + el.ended + ' rs=' + el.readyState + ' active=' + activeKeyRef.current);
      if (el === active) {
        // Natural end of the audio file (vs. user pause): leave the queued
        // boundary timer alone so the next fade can still fire. Two reasons
        // this matters:
        //   1) durationSec is stored as Math.ceil(probeDuration) — so the
        //      actual file is almost always slightly shorter than the
        //      schedule. The boundary timer was queued at duration-5s, but
        //      the file ends a fraction of a second early → pause fires
        //      first → without this guard, the timer was cleared and
        //      playback stopped forever.
        //   2) Backgrounded tabs throttle setTimeout. The timer may fire
        //      late, well after the audio has naturally ended — same
        //      failure mode.
        // Leaving isPlaying=true here is fine: the next fade's incoming.play
        // will fire the active-element 'play' handler and re-affirm it.
        if (el.ended) return;
        if (boundaryTimerRef.current) {
          clearTimeout(boundaryTimerRef.current);
          boundaryTimerRef.current = null;
        }
        setIsPlaying(false);
      }
    });
    el.addEventListener('play', () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      console.log('[audio-diag] radio.' + which + ' PLAY ct=' + el.currentTime.toFixed(2) + ' rs=' + el.readyState + ' active=' + activeKeyRef.current);
      if (el === active) {
        setIsPlaying(true);
        return;
      }
      // Guard suppressed during legitimate crossfades and preload prime.
      if (crossfadeInFlightRef.current || primingInFlightRef.current) return;
      try { el.pause(); } catch { /* ignore */ }
    });
    // iOS fires these when the audio session gets weird. Capture for diagnosis.
    el.addEventListener('error', () => {
      console.log('[audio-diag] radio.' + which + ' ERROR code=' + el.error?.code + ' msg=' + el.error?.message + ' ct=' + el.currentTime.toFixed(2));
    });
    el.addEventListener('stalled', () => {
      console.log('[audio-diag] radio.' + which + ' STALLED ct=' + el.currentTime.toFixed(2) + ' rs=' + el.readyState);
    });
    el.addEventListener('suspend', () => {
      console.log('[audio-diag] radio.' + which + ' SUSPEND ct=' + el.currentTime.toFixed(2) + ' rs=' + el.readyState);
    });
    el.addEventListener('waiting', () => {
      console.log('[audio-diag] radio.' + which + ' WAITING ct=' + el.currentTime.toFixed(2) + ' rs=' + el.readyState);
    });
    el.addEventListener('abort', () => {
      console.log('[audio-diag] radio.' + which + ' ABORT ct=' + el.currentTime.toFixed(2));
    });
    el.addEventListener('emptied', () => {
      console.log('[audio-diag] radio.' + which + ' EMPTIED');
    });
    el.addEventListener('ended', () => {
      console.log('[audio-diag] radio.' + which + ' ENDED ct=' + el.currentTime.toFixed(2));
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
    userInitiatedRef.current = true;
    setError(null);
    setStalled(false);
    await playCurrent();
  }, [playCurrent]);

  const pause = useCallback(() => {
    userInitiatedRef.current = false;
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    // Cancel any in-flight crossfade so a future resume starts clean.
    if (crossfadeWatchdogRef.current) {
      clearTimeout(crossfadeWatchdogRef.current);
      crossfadeWatchdogRef.current = null;
    }
    if (workerRef.current) {
      try { workerRef.current.postMessage({ type: 'cancel', token: fadeTokenRef.current }); } catch { /* ignore */ }
    }
    workerHandlerRef.current = null;
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
    // A previous fade still in flight. Synchronously snap it to final state
    // so its captured `outgoing` is paused and won't fight this new fade.
    if (crossfadeInFlightRef.current) {
      if (crossfadeWatchdogRef.current) {
        clearTimeout(crossfadeWatchdogRef.current);
        crossfadeWatchdogRef.current = null;
      }
      // Cancel the prior worker timer so its stale ticks stop arriving.
      if (workerRef.current) {
        try { workerRef.current.postMessage({ type: 'cancel', token: fadeTokenRef.current }); } catch { /* ignore */ }
      }
      workerHandlerRef.current = null;
      // Prior fade's outgoing = element BEFORE this fade's outgoing (which
      // is the prior fade's incoming, now active). Pause directly.
      const priorOutgoing = activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current;
      if (priorOutgoing) {
        try { priorOutgoing.pause(); } catch { /* ignore */ }
        priorOutgoing.volume = 0;
      }
      crossfadeInFlightRef.current = false;
    }

    // Lazy-instantiate the worker on first fade. Singleton for the hook
    // lifetime; subsequent fades reuse it. If the worker fails to load (e.g.
    // older browser), we fall through to the watchdog-only path — the fade
    // becomes a 5500ms hard cut instead of a smooth ramp, but it still
    // completes cleanly.
    if (!workerRef.current && typeof Worker !== 'undefined') {
      try {
        const w = new Worker(new URL('../workers/crossfade-timer.worker.ts', import.meta.url));
        w.onmessage = (e: MessageEvent<{ type: 'tick' | 'done'; token: number; elapsedMs?: number }>) => {
          const h = workerHandlerRef.current;
          if (h) h(e.data);
        };
        w.onerror = (e) => console.warn('[useArchiveRadio] crossfade worker error', e.message);
        workerRef.current = w;
        console.log('[audio-diag] worker CREATED at', new Date().toISOString());
      } catch (err) {
        console.warn('[useArchiveRadio] crossfade worker init failed', err);
      }
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

    let midLogged = false;
    let tickCount = 0;
    const finish = () => {
      // Stale: a newer fade's force-finish handled cleanup already. Bail.
      if (fadeTokenRef.current !== myToken) return;
      if (crossfadeWatchdogRef.current) {
        clearTimeout(crossfadeWatchdogRef.current);
        crossfadeWatchdogRef.current = null;
      }
      if (workerRef.current) {
        try { workerRef.current.postMessage({ type: 'cancel', token: myToken }); } catch { /* ignore */ }
      }
      workerHandlerRef.current = null;
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

    // Install handler for the worker's tick/done messages. Token check
    // discards messages from prior fades that haven't drained yet.
    workerHandlerRef.current = (m) => {
      if (m.token !== myToken) return;
      if (fadeTokenRef.current !== myToken) return;
      if (m.type === 'tick' && typeof m.elapsedMs === 'number') {
        // Clamp p to [0, 1] — negative p from clock skew makes pow(neg, frac)=NaN
        // which throws when assigned to audio.volume.
        const p = Math.min(1, Math.max(0, m.elapsedMs / CROSSFADE_MS));
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
        return;
      }
      if (m.type === 'done') {
        finish();
      }
    };

    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'start', token: myToken, durationMs: CROSSFADE_MS, tickHz: 60 });
    }
    // Watchdog: forces finish if the worker timer overran or the worker
    // failed to instantiate above. In the no-worker fallback, this becomes
    // the fade's only completion path — a 5500ms hard cut.
    crossfadeWatchdogRef.current = setTimeout(() => {
      if (crossfadeInFlightRef.current && fadeTokenRef.current === myToken) {
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
    // + item.duration IS the audible end moment. The actual timing math
    // is inside scheduleBoundary below.

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

    // Schedule fade N (current → next). Recursive: when fade N finishes,
    // its onFinish hook directly schedules fade N+1 (next → afterNext)
    // without waiting for the boundary-effect to re-run. The effect's
    // re-run trigger (currentKey change) depends on nowMs ticking at 1Hz,
    // which is throttled in backgrounded tabs — so without this self-
    // chaining, the second crossfade after backgrounding never fires.
    const scheduleBoundary = (
      cur: { loop: ArchiveRadioLoop; index: number; item: ScheduleItem; seekSec: number },
      nxt: { loop: ArchiveRadioLoop; index: number; item: ScheduleItem },
      nxtKey: string,
    ) => {
      const curBoundaryMs = cur.loop.startTimeMs + (cur.item.startOffsetSec + cur.item.durationSec) * 1000;
      const curFadeStartMs = curBoundaryMs - CROSSFADE_MS;
      const curDelay = Math.max(MIN_BOUNDARY_LEAD_MS, curFadeStartMs - Date.now());
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = setTimeout(() => {
        const outgoing = getActive();
        const incoming = getStandby();
        if (!outgoing || !incoming) return;
        const inCurve = cur.item.kind === 'interstitial' && nxt.item.kind === 'archive'
          ? smoothstep
          : sqrtCurve;
        runCrossfade(outgoing, incoming, inCurve, () => {
          playingKeyRef.current = nxtKey;
          // Compute the item AFTER nxt — becomes the next fade's incoming.
          const afterNext = getNext({ loop: nxt.loop, index: nxt.index }, nextLoop);
          if (!afterNext) return;
          const afterKey = itemKey(afterNext.loop, afterNext.index, afterNext.item);
          // Preload the after-next item on what is now the standby. Skip
          // if it's already the preload target (effect would have done it).
          if (preloadedNextKeyRef.current !== afterKey) {
            preloadedNextKeyRef.current = afterKey;
            void preloadStandby(afterNext.item.recordingUrl, afterNext.item.kind);
          }
          // Self-chain: schedule the (nxt → afterNext) fade directly. This
          // is the line that survives backgrounded tabs — no dependence on
          // the throttled 1Hz nowMs ticker to re-run the boundary effect.
          scheduleBoundary(
            { loop: nxt.loop, index: nxt.index, item: nxt.item, seekSec: 0 },
            afterNext,
            afterKey,
          );
        });
      }, curDelay);
    };

    scheduleBoundary(current, next, nextKey);

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
    // Internal crossfade `play` events can flip isPlaying true even when the
    // user is listening to a different source on another page. Skip the
    // MediaSession write unless the user explicitly started the radio.
    if (!userInitiatedRef.current) return;
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

  // [audio-diag] 10s heartbeat — log radio state snapshot + stuck detector.
  // The stuck detector compares each tick's currentTime to the previous tick;
  // if paused=false but ct hasn't advanced by ~5s, log STUCK so we catch
  // silent freezes that don't fire any error event. Strip with the rest of
  // the audio-diag logs when investigation wraps.
  const prevHeartbeatRef = useRef<{ ctA: number; ctB: number; t: number } | null>(null);
  useEffect(() => {
    if (!opts.active) return;
    const tick = () => {
      const a = audioARef.current;
      const b = audioBRef.current;
      const now = Date.now();
      const prev = prevHeartbeatRef.current;
      const fmt = (el: HTMLAudioElement | null, label: string) =>
        el
          ? label + ':ct=' + el.currentTime.toFixed(1) + ' paused=' + el.paused + ' vol=' + el.volume.toFixed(2) + ' muted=' + el.muted + ' rs=' + el.readyState + ' err=' + (el.error?.code ?? '-')
          : label + ':null';
      console.log(
        '[audio-diag] HB radio',
        'active=' + activeKeyRef.current,
        'isPlaying=' + isPlaying,
        'inFlight=' + crossfadeInFlightRef.current,
        'worker=' + (workerRef.current ? 'alive' : 'null'),
        'vis=' + (typeof document !== 'undefined' ? document.visibilityState : '?'),
        'playingKey=' + (playingKeyRef.current ? playingKeyRef.current.slice(0, 40) : 'null'),
        '|', fmt(a, 'A'),
        '|', fmt(b, 'B'),
      );
      // Stuck detector — only meaningful when the active element should be
      // advancing. Skip backgrounded tabs (iOS legitimately throttles audio
      // currentTime updates when hidden) and the first heartbeat (no prev).
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (prev && visible) {
        const wall = (now - prev.t) / 1000;
        const checkStuck = (el: HTMLAudioElement | null, prevCt: number, label: string) => {
          if (!el || el.paused) return;
          const delta = el.currentTime - prevCt;
          // Allow some slack for setInterval drift. If audio is playing,
          // ct should advance by at least ~80% of wall time.
          if (wall > 5 && delta < wall * 0.5) {
            console.log(
              '[audio-diag] STUCK radio.' + label,
              'wallDelta=' + wall.toFixed(1) + 's',
              'ctDelta=' + delta.toFixed(2) + 's',
              'ct=' + el.currentTime.toFixed(2),
              'paused=' + el.paused,
              'rs=' + el.readyState,
              'err=' + (el.error?.code ?? '-'),
            );
          }
        };
        checkStuck(a, prev.ctA, 'A');
        checkStuck(b, prev.ctB, 'B');
      }
      prevHeartbeatRef.current = {
        ctA: a?.currentTime ?? 0,
        ctB: b?.currentTime ?? 0,
        t: now,
      };
    };
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [opts.active, isPlaying]);

  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      if (preloadTimerRef.current) clearTimeout(preloadTimerRef.current);
      if (crossfadeWatchdogRef.current) clearTimeout(crossfadeWatchdogRef.current);
      if (workerRef.current) {
        try { workerRef.current.terminate(); } catch { /* ignore */ }
        workerRef.current = null;
      }
      workerHandlerRef.current = null;
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
