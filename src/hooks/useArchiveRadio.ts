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
// Crossfade duration between consecutive items (archive↔interlude↔archive).
// We start the next item playing CROSSFADE_MS before the current item ends,
// ramping volumes in opposite directions over this window. Shorter items
// still get the fade — see plan for edge cases at very short durations.
const CROSSFADE_MS = 5000;
// Interlude clips play at this gain when alone (shows play at 100%) so the
// interlude doesn't blast vs music. No additional duck during the crossfade —
// the per-transition curves (peakTaper for incoming-interlude, fastDrop for
// outgoing-archive) handle the "don't compete with the show" feeling.
const INTERLUDE_GAIN = 0.52;
const INTERLUDE_FADE_GAIN = INTERLUDE_GAIN;

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
  // True when audio.currentTime hasn't advanced for a few seconds despite
  // isPlaying being true — usually iOS Chrome (WKWebView) preempting our
  // audio session under memory pressure mid-scroll. UI shows a tap-to-resume
  // affordance so the user's tap counts as a fresh gesture for play().
  const [stalled, setStalled] = useState(false);
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
  // Crossfade scheduling: two timers + a rAF for the volume ramp.
  //   fadeStartTimer fires CROSSFADE_MS before the boundary — starts the next
  //     element playing at volume 0 and kicks off the ramp.
  //   hardSwapTimer fires at the boundary — cleans up the outgoing element
  //     and flips activeKey regardless of ramp state.
  //   rafId tracks the ongoing volume ramp.
  const fadeStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Set when a fade has been kicked off for a given incoming item, cleared at
  // hard-swap. Prevents the per-second effect re-run from starting a second
  // fade-start timer for the same boundary.
  const fadeInFlightForKeyRef = useRef<string | null>(null);
  const preloadedNextKeyRef = useRef<string | null>(null);
  // Belt-and-suspenders: we ping `/api/admin/archive-radio-loop/ensure-next`
  // when the current loop is within ENSURE_NEXT_LEAD_MS of its end and no
  // next-loop doc exists. Track which loopNumber we've already pinged for so
  // we don't spam the endpoint every second.
  const ensureNextPingedForRef = useRef<number | null>(null);
  // Last MediaSession metadata signature we wrote. Skipping no-op rewrites
  // matters on iOS: rapid `navigator.mediaSession.metadata = ...` churn can
  // make iOS think the audio session is unstable and unilaterally pause it.
  const lastMediaSessionSigRef = useRef<string | null>(null);

  // Lazily create both audio elements on first activation. Created with iOS
  // attrs set up-front (matches feedback_ios_mediasession + the existing
  // useBroadcastStream pattern: playsinline + crossOrigin must be set before
  // the first .play()).
  // Attach play/pause listeners that mirror the audio element's actual
  // state back into React state. Critical when another source pauses us
  // via the audio-exclusive registry (registry calls el.pause() directly,
  // bypassing our play()/pause() helpers) — without these listeners, the
  // radio's isPlaying state would stay true while the audio was silent,
  // and the sticky bar would show the wrong source.
  const attachStateListeners = useCallback((el: HTMLAudioElement) => {
    el.addEventListener('pause', () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      const whichEl = el === audioARef.current ? 'A' : el === audioBRef.current ? 'B' : '?';
      // [radio-debug] iOS may silently auto-pause an element when the other
      // starts playing. Log every pause event to detect that.
      console.log('[radio-debug] PAUSE event on', whichEl, 'isActive=', el === active, 'currentTime=', el.currentTime.toFixed(2), 'src=', el.src.slice(-40), 'readyState=', el.readyState);
      if (el === active) {
        // Mirror onPause cleanup from the belt-and-suspenders effect below —
        // an externally driven pause (registry, OS audio session) must also
        // cancel any in-flight crossfade.
        if (fadeStartTimerRef.current) { clearTimeout(fadeStartTimerRef.current); fadeStartTimerRef.current = null; }
        if (hardSwapTimerRef.current) { clearTimeout(hardSwapTimerRef.current); hardSwapTimerRef.current = null; }
        if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
        fadeInFlightForKeyRef.current = null;
        if (audioARef.current) audioARef.current.volume = 1;
        if (audioBRef.current) audioBRef.current.volume = 1;
        setIsPlaying(false);
      }
    });
    el.addEventListener('play', () => {
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      if (el === active) setIsPlaying(true);
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

  // Stable key for an item so we can detect changes across re-renders.
  const itemKey = useCallback((loop: ArchiveRadioLoop, index: number, item: ScheduleItem) => {
    return `loop-${loop.loopNumber}#${index}#${item.recordingUrl}#${item.startOffsetSec}`;
  }, []);

  // Drive the active element to play `current.item` from the right offset.
  const playCurrent = useCallback(async () => {
    if (!opts.active) return;
    if (!current) {
      // Schedule not loaded yet (or no archive scheduled at all — rare,
      // since the bar wouldn't render in that case). Stay silent; the user
      // can re-tap once the schedule resolves. Avoids the misleading "No
      // archive scheduled right now" message during the brief load window.
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
      // 10s timeout guards against stalled fetches on flaky mobile
      // networks — without it the spinner would hang forever because
      // neither loadedmetadata nor error fires. On timeout we proceed
      // to play() anyway; if the network is truly broken, play()
      // rejects and the catch below surfaces a recoverable error.
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
          try { active.currentTime = desiredOffset; } catch { /* ignore seek errors */ }
        }
      }
      // .volume survives src changes — reset before play in case a prior fade
      // left this element at a partial volume.
      active.volume = 1;
      await active.play();
      // iOS gesture-unlock the standby element. The crossfade fires .play() on
      // standby from a setTimeout — outside any user gesture — and iOS rejects
      // that unless the element has been play()ed at least once in a gesture
      // chain. Play+pause with a muted, srcless element consumes the gesture
      // credit; subsequent .play() calls (with a real src) then succeed.
      // See feedback_ios_play_gesture_chain.
      const standby = getStandby();
      if (standby && !standby.dataset.gestureUnlocked) {
        try {
          standby.muted = true;
          await standby.play();
          standby.pause();
          standby.muted = false;
          standby.dataset.gestureUnlocked = '1';
        } catch { /* ignore — play() may reject on empty src; that's fine, the gesture still counts */ }
      }
      playingKeyRef.current = key;
      setIsPlaying(true);
      setError(null);
    } catch (err) {
      setIsPlaying(false);
      setError(err instanceof Error ? err.message : 'Playback failed.');
    } finally {
      setIsLoading(false);
    }
  }, [current, ensureAudio, getActive, getStandby, itemKey, opts.active, currentLoop, nextLoop]);

  // Public play() — only allowed in response to a user gesture so iOS unlocks.
  const play = useCallback(async () => {
    setError(null);
    setStalled(false);
    await playCurrent();
  }, [playCurrent]);

  const pause = useCallback(() => {
    const a = audioARef.current;
    const b = audioBRef.current;
    // Cancel any in-flight crossfade so a future resume starts cleanly.
    if (fadeStartTimerRef.current) { clearTimeout(fadeStartTimerRef.current); fadeStartTimerRef.current = null; }
    if (hardSwapTimerRef.current) { clearTimeout(hardSwapTimerRef.current); hardSwapTimerRef.current = null; }
    if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
    fadeInFlightForKeyRef.current = null;
    a?.pause();
    b?.pause();
    // Reset volumes so a future play() doesn't start silent.
    if (a) a.volume = 1;
    if (b) b.volume = 1;
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

  // Preload the next item, then schedule a 5s crossfade ending at the boundary.
  // Two timers split the work:
  //   1. fadeStart (boundary − CROSSFADE_MS): start standby at volume 0, kick
  //      off the rAF ramp, swap playingKeyRef to the incoming item.
  //   2. hardSwap (boundary): clean up outgoing, lock incoming at full volume,
  //      flip activeKeyRef. Runs regardless of ramp state — ensures clean
  //      handoff even if the rAF was throttled/cancelled.
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

    const boundaryMs = current.loop.startTimeMs + (current.item.startOffsetSec + current.item.durationSec) * 1000;
    const fadeStartMs = boundaryMs - CROSSFADE_MS;
    const fadeDelay = Math.max(MIN_BOUNDARY_LEAD_MS, fadeStartMs - Date.now());
    const swapDelay = Math.max(MIN_BOUNDARY_LEAD_MS, boundaryMs - Date.now());

    // Per-side max gain for this crossfade. No duck — interlude peaks at
    // INTERLUDE_GAIN during the fade.
    const outGain = current.item.kind === 'interstitial' ? INTERLUDE_FADE_GAIN : 1;
    const inFadeGain = next.item.kind === 'interstitial' ? INTERLUDE_FADE_GAIN : 1;
    const inAloneGain = next.item.kind === 'interstitial' ? INTERLUDE_GAIN : 1;

    // Per-transition curve choices (tuned via /internal/crossfade-test):
    //   archive -> interlude: outgoing archive drops fast so it gets out of
    //     the way; incoming interlude rises fast to peak (at p=0.4) then
    //     tapers slightly to ~77% of peak by p=1, then snaps to alone-volume.
    //   interlude -> archive: outgoing interlude stays sqrt; incoming archive
    //     uses smoothstep so it eases in gradually (gentle at both start
    //     and end).
    //   archive <-> archive, interlude <-> interlude: default sqrt
    //     equal-power on both sides.
    const isArchiveToInterlude = current.item.kind === 'archive' && next.item.kind === 'interstitial';
    const isInterludeToArchive = current.item.kind === 'interstitial' && next.item.kind === 'archive';

    // If a fade has already started for this incoming item (this effect
    // re-runs every second as nowMs ticks), don't reschedule the fade-start.
    // The hard-swap timer is idempotent — safe to re-set.
    const fadeAlreadyStarted = fadeInFlightForKeyRef.current === nextKey;

    if (!fadeAlreadyStarted && fadeStartTimerRef.current) clearTimeout(fadeStartTimerRef.current);
    if (hardSwapTimerRef.current) clearTimeout(hardSwapTimerRef.current);

    if (!fadeAlreadyStarted) fadeStartTimerRef.current = setTimeout(() => {
      const outgoing = getActive();
      const incoming = getStandby();
      if (!outgoing || !incoming) return;
      // [radio-debug] log full state at fade-start so we can correlate with
      // pause events. Key signals: incoming.paused before/after play(),
      // any rejection on the play() promise, and whether outgoing.paused
      // flips during the next ~100ms (iOS auto-pause).
      const outWhich = outgoing === audioARef.current ? 'A' : 'B';
      const inWhich = incoming === audioARef.current ? 'A' : 'B';
      console.log('[radio-debug] FADE-START outgoing=', outWhich, 'incoming=', inWhich,
        'out.kind=', current.item.kind, 'in.kind=', next.item.kind,
        'in.src=', next.item.recordingUrl.slice(-40),
        'in.readyState(before)=', incoming.readyState,
        'in.paused(before)=', incoming.paused,
        'out.paused(before)=', outgoing.paused);
      try {
        incoming.currentTime = 0;
        incoming.volume = 0;
        const p = incoming.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            console.log('[radio-debug] in.play() RESOLVED. in.paused=', incoming.paused, 'in.currentTime=', incoming.currentTime.toFixed(2), 'out.paused=', outgoing.paused);
          });
        }
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('[radio-debug] in.play() REJECTED name=', (err as Error)?.name, 'msg=', (err as Error)?.message);
          });
        }
        // Snapshot 100ms later to see if iOS silently flipped state.
        setTimeout(() => {
          console.log('[radio-debug] FADE+100ms in.paused=', incoming.paused, 'in.currentTime=', incoming.currentTime.toFixed(2), 'in.readyState=', incoming.readyState, 'out.paused=', outgoing.paused, 'out.currentTime=', outgoing.currentTime.toFixed(2));
        }, 100);
      } catch (err) {
        console.warn('[radio-debug] fade-start try/catch threw', err);
        return;
      }
      // Mark the incoming as the perceived current — re-syncs key off it.
      playingKeyRef.current = nextKey;
      fadeInFlightForKeyRef.current = nextKey;

      const startedAt = performance.now();
      const PEAK_P = 0.4;          // peak at 40% of fade (= 2s of 5s)
      const TAPER_END_FRAC = 0.77; // taper to 77% of peak by end of fade
      const peakTaper = (p: number): number => {
        if (p <= PEAK_P) return Math.sqrt(p / PEAK_P);
        const tapP = (p - PEAK_P) / (1 - PEAK_P);
        return 1 - tapP * (1 - TAPER_END_FRAC);
      };
      const smoothstep = (p: number): number => p * p * (3 - 2 * p);
      const tick = (t: number) => {
        const p = Math.min(1, Math.max(0, (t - startedAt) / CROSSFADE_MS));
        // Outgoing curve: archive -> interlude uses (1-p)² (fast drop).
        // Everything else uses sqrt(1-p) (equal-power).
        const outV = outGain * (isArchiveToInterlude
          ? (1 - p) * (1 - p)
          : Math.sqrt(1 - p));
        // Incoming curve: archive -> interlude uses peakTaper (fast rise,
        // peak at 2s, slight taper). interlude -> archive uses smoothstep
        // (gradual at start and end). Everything else uses sqrt(p).
        const inV = inFadeGain * (isArchiveToInterlude
          ? peakTaper(p)
          : isInterludeToArchive
          ? smoothstep(p)
          : Math.sqrt(p));
        outgoing.volume = outV;
        incoming.volume = inV;
        if (p < 1) {
          rafIdRef.current = requestAnimationFrame(tick);
        } else {
          rafIdRef.current = null;
        }
      };
      rafIdRef.current = requestAnimationFrame(tick);
    }, fadeDelay);

    hardSwapTimerRef.current = setTimeout(() => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const outgoing = getActive();
      const incoming = getStandby();
      if (!outgoing || !incoming) return;
      // [radio-debug] hard-swap point.
      const outWhich = outgoing === audioARef.current ? 'A' : 'B';
      const inWhich = incoming === audioARef.current ? 'A' : 'B';
      console.log('[radio-debug] HARD-SWAP outgoing=', outWhich, 'incoming=', inWhich, 'in.paused=', incoming.paused, 'in.currentTime=', incoming.currentTime.toFixed(2), 'out.paused=', outgoing.paused, 'out.currentTime=', outgoing.currentTime.toFixed(2), 'inAloneGain=', inAloneGain);
      try {
        outgoing.volume = 0;
        outgoing.pause();
        // Intentionally NOT removing src or calling load() here. On iOS,
        // .load() after a successful gesture-unlocked play() can revoke
        // that unlock — the next standby.play() (the *next* crossfade)
        // would then silently fail. The next boundary effect overwrites
        // src naturally, so leaving the old src in place is harmless.
      } catch { /* ignore */ }
      try {
        // Snap incoming to its alone-volume (interludes sit at INTERLUDE_GAIN,
        // shows at 1.0). This is the "after the fade" steady-state level.
        incoming.volume = inAloneGain;
      } catch { /* ignore */ }
      // Flip which element is "active".
      activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
      playingKeyRef.current = nextKey;
      preloadedNextKeyRef.current = null;
      fadeInFlightForKeyRef.current = null;
      // [radio-debug] snapshot 200ms after swap.
      setTimeout(() => {
        console.log('[radio-debug] HARD-SWAP+200ms now-active=', activeKeyRef.current, 'in.paused=', incoming.paused, 'in.currentTime=', incoming.currentTime.toFixed(2));
      }, 200);
    }, swapDelay);

    return () => {
      if (fadeStartTimerRef.current) {
        clearTimeout(fadeStartTimerRef.current);
        fadeStartTimerRef.current = null;
      }
      if (hardSwapTimerRef.current) {
        clearTimeout(hardSwapTimerRef.current);
        hardSwapTimerRef.current = null;
      }
      // Note: leave rafIdRef alone here. The effect re-runs on every
      // current/next/isPlaying change including mid-fade ticks; cancelling
      // the rAF on every re-run would kill a live fade. The rAF tears down
      // naturally when it reaches p=1, or via pause()/unmount.
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
      // If we backgrounded mid-crossfade, the rAF was paused and elements may
      // be stuck at partial volume. Snap the fade to completion so we land in
      // a sane state before running the standard drift/key-mismatch checks.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
        const outgoing = getActive();
        const incoming = getStandby();
        if (outgoing) {
          // Same as hard-swap: don't strip src or call load() — preserves iOS
          // gesture-unlock so the next crossfade's play() succeeds.
          try { outgoing.volume = 0; outgoing.pause(); } catch { /* ignore */ }
        }
        if (incoming) {
          try { incoming.volume = 1; } catch { /* ignore */ }
        }
        activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
        if (fadeInFlightForKeyRef.current) {
          playingKeyRef.current = fadeInFlightForKeyRef.current;
        }
        fadeInFlightForKeyRef.current = null;
        preloadedNextKeyRef.current = null;
        if (hardSwapTimerRef.current) { clearTimeout(hardSwapTimerRef.current); hardSwapTimerRef.current = null; }
      }
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
  }, [opts.active, isPlaying, currentLoop, nextLoop, getActive, getStandby, itemKey, playCurrent]);

  // Keep the user's play state honest if the browser pauses us (network drop,
  // OS audio session loss). We don't auto-resume — that surprises listeners.
  useEffect(() => {
    if (!opts.active) return;
    const a = audioARef.current;
    const b = audioBRef.current;
    if (!a || !b) return;
    // Note: registry coordination (registerAudio/pauseOthers) happens in
    // play()/pause() directly, not here. This effect only runs on mount
    // when audio elements may not exist yet, and never re-attaches —
    // depending on it for the single-source rule would silently fail.
    const onPause = (el: HTMLAudioElement) => () => {
      // Only treat as a real pause if the element was supposed to be active.
      const active = activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current;
      if (el === active) {
        // If something paused us mid-crossfade (audio-exclusive registry,
        // OS audio session loss), cancel the fade plumbing so a future
        // resume doesn't fight a still-running ramp.
        if (fadeStartTimerRef.current) { clearTimeout(fadeStartTimerRef.current); fadeStartTimerRef.current = null; }
        if (hardSwapTimerRef.current) { clearTimeout(hardSwapTimerRef.current); hardSwapTimerRef.current = null; }
        if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
        fadeInFlightForKeyRef.current = null;
        if (audioARef.current) audioARef.current.volume = 1;
        if (audioBRef.current) audioBRef.current.volume = 1;
        setIsPlaying(false);
      }
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
  // broadcast's setup (useBroadcastStream lines 880-924): ≤128x128 artwork
  // via /_next/image, single entry, all skip/seek actions nulled (radio is
  // a synced stream, not scrubbable), and a position state published from
  // the schedule so the lock screen shows the current item's progress
  // through its own duration (just like live shows the show-startTime →
  // endTime progress).
  useEffect(() => {
    if (!opts.active) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!current) return;
    // Only own the mediaSession while radio is actually playing. When the
    // radio is paused (e.g. live took over via auto-handoff, or user paused),
    // leave mediaSession alone so the active source can write its own
    // metadata without us overwriting it.
    if (!isPlaying) return;
    const item = current.item;
    const artist = (item.djs?.length ? item.djs.map((d) => d.name).join(', ') : undefined);
    const fallback = `${window.location.origin}/artwork-fallback.png`;
    const proxy = (url: string) =>
      url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=128&q=75`;
    // Cascade like live (useBroadcastStream): show image → first DJ photo →
    // logo fallback. Some archives don't have showImageUrl set, so without
    // the DJ-photo step the Control Center shows the generic logo.
    const djPhoto = item.djs?.find((d) => d.photoUrl)?.photoUrl;
    const rawArtwork = item.artworkUrl || djPhoto;
    const artworkSrc = rawArtwork ? proxy(rawArtwork) : fallback;
    const title = item.title || 'Archive radio';
    const sig = `radio|${title}|${artist || ''}|${artworkSrc}`;
    if (sig !== lastMediaSessionSigRef.current) {
      try {
        console.log('[radio-debug] mediaSession.metadata <-', item.kind, '"' + title + '"', 'artwork=', artworkSrc.slice(-40));
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album: 'channel — archive radio',
          artwork: [{ src: artworkSrc, sizes: '128x128', type: 'image/png' }],
        });
        lastMediaSessionSigRef.current = sig;
      } catch { /* ignore */ }
    }
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
      if (fadeStartTimerRef.current) clearTimeout(fadeStartTimerRef.current);
      if (hardSwapTimerRef.current) clearTimeout(hardSwapTimerRef.current);
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
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

  // Stall detector: while isPlaying, check that the active element's
  // currentTime is actually advancing. If it stops moving for ~4s, flip
  // `stalled` so the UI can surface a tap-to-resume affordance. Common
  // trigger: Chrome iOS (WKWebView) preempting our audio session during
  // memory-heavy scroll. iOS won't let us silently restart playback —
  // it needs a fresh user gesture.
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
