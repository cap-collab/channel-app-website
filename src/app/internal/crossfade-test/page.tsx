'use client';

import { useEffect, useRef, useState } from 'react';
import { InterludeSlide } from '@/components/channel/ArchiveHero';

// Mirrors the prod radio path: dual <audio> elements (A and B) with the
// standby preloading the next item. When the crossfade toggle is OFF the
// boundary is a hard-cut (pause active, play standby). When ON, the boundary
// starts a 5s overlap with per-transition volume curves:
//   archive → interlude: outgoing fades (1-p)² (fast drop), incoming peakTaper
//   interlude → archive: outgoing fades √(1-p), incoming smoothstep
//   (archive → archive uses equal-power √ on both sides; not exercised here.)
//
// The auto-pause-non-active guard is GATED by crossfadeInFlightRef so both
// elements are allowed to play during the 5s overlap.
// Archive A is high-priority "Celebrity Bitcrush" — DJ set with energy, easier
// to perceive a crossfade against than a soft mix.
const ARCHIVE_A_URL =
  'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-05-28T230003.mp4';
const ARCHIVE_A_DURATION_SEC = 3594;
// Archive B: "On the Wheelz of Steel" — another high-energy show so the
// archive→archive (well, interlude→archive here) transition lands on energy.
const ARCHIVE_B_URL =
  'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-05-08T230009.mp4';

const INTERLUDES = [
  { label: 'berlin clubs short 2', durationSec: 12, url: '/interludes/berlin-clubs-short-2.m4a' },
  { label: 'weed convo birds', durationSec: 24, url: 'https://media.channel-app.com/interludes/weed-convo-birds-1779973930315.m4a' },
  { label: 'toilet therapist', durationSec: 23, url: 'https://media.channel-app.com/interludes/toilet-therapist-1779907421108.m4a' },
  { label: 'water refill smoking area', durationSec: 20, url: 'https://media.channel-app.com/interludes/water-refill-smoking-area-1779973923793.m4a' },
];

const INTERLUDE_GAIN = 0.6;
const CROSSFADE_MS = 5000;
// Seconds of archive A before the fade STARTS. With crossfade ON the fade
// runs from A_PRE_SEC to A_PRE_SEC + 5s; with crossfade OFF the hard-cut
// happens at A_PRE_SEC.
const A_PRE_SEC = 10;

type Stage = 'idle' | 'archive-a' | 'interlude' | 'archive-b' | 'done';

// Curve fns (pure). p in [0, 1].
const sqrt = (p: number) => Math.sqrt(p);
const invSqrt = (p: number) => Math.sqrt(1 - p);
const quad = (p: number) => (1 - p) * (1 - p);
// Incoming-interlude curve for archive→interlude transition. Targets
// (multiplied by incomingTargetGain=INTERLUDE_GAIN=0.6):
//   p=0   → 0.33 (audible kick-in at 0.20 absolute, no silent fade-in)
//   p=0.4 → 0.83 (loud-ish peak at 2s, absolute 0.50)
//   p=1   → 1.00 (steady-state 0.60 by fade end)
// Two-segment: sublinear ramp up to PEAK_P, smoothstep gentle climb to 1.
const INTERLUDE_START_FRAC = 0.33;
const INTERLUDE_PEAK_FRAC = 0.83;
const PEAK_P = 0.4;
const peakTaper = (p: number): number => {
  if (p <= PEAK_P) {
    const local = p / PEAK_P; // 0..1
    // pow(local, 0.6) is sublinear — climbs fast early then eases into peak.
    return INTERLUDE_START_FRAC + (INTERLUDE_PEAK_FRAC - INTERLUDE_START_FRAC) * Math.pow(local, 0.6);
  }
  const local = (p - PEAK_P) / (1 - PEAK_P); // 0..1
  // Smoothstep gentle climb from peak fraction to 1.0.
  const ease = local * local * (3 - 2 * local);
  return INTERLUDE_PEAK_FRAC + (1 - INTERLUDE_PEAK_FRAC) * ease;
};
const smoothstep = (p: number): number => p * p * (3 - 2 * p);

export default function CrossfadeTestPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [aVol, setAVol] = useState(0);
  const [bVol, setBVol] = useState(0);
  const [interludeIdx, setInterludeIdx] = useState(0);
  const [crossfadeOn, setCrossfadeOn] = useState(true);

  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeKeyRef = useRef<'A' | 'B'>('A');
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crossfadeInFlightRef = useRef(false);
  const crossfadeRafRef = useRef<number | null>(null);
  const crossfadeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When true, the auto-pause-non-active guard skips. Used during preload
  // priming (we intentionally play+pause a non-active element to force the
  // browser to actually buffer bytes; the guard would otherwise abort the
  // play() before any bytes are fetched).
  const primingInFlightRef = useRef(false);
  // Each fade gets a unique token. finish() checks this token before touching
  // elements — if a newer fade has already started, the old finish() is stale
  // and must NOT pause its captured `outgoing` (which may be the new fade's
  // incoming since elements swap roles every transition).
  const fadeTokenRef = useRef(0);
  const nextItemRef = useRef<
    { url: string; gain: number; label: string; kind: 'archive' | 'interlude' } | null
  >(null);
  // Mirror prod: stub MediaSession dedupe ref so the test exercises the same
  // surface area. We don't actually write to navigator.mediaSession here.
  const lastMediaSessionSigRef = useRef<string | null>(null);

  const append = (msg: string) => {
    setLog((l) => [...l, `${new Date().toISOString().slice(11, 23)}  ${msg}`]);
  };

  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      if (crossfadeWatchdogRef.current) clearTimeout(crossfadeWatchdogRef.current);
      if (crossfadeRafRef.current !== null) cancelAnimationFrame(crossfadeRafRef.current);
      audioARef.current?.pause();
      audioBRef.current?.pause();
    };
  }, []);

  // Mirror prod: visibilitychange listener stub (no resync in the simple test).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') append('visibilitychange → visible');
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const getActive = () => (activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current);
  const getStandby = () => (activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current);
  const which = (el: HTMLAudioElement) => (el === audioARef.current ? 'A' : 'B');

  const mkAudio = (label: string) => {
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.addEventListener('error', () => append(`${label} ERROR ${a.error?.code} ${a.error?.message ?? ''}`));
    a.addEventListener('pause', () => {
      append(`${label} PAUSE currentTime=${a.currentTime.toFixed(2)} readyState=${a.readyState}`);
    });
    a.addEventListener('play', () => {
      const isActive = a === getActive();
      // Auto-pause-non-active guard. Suppressed during legitimate crossfades
      // AND during preload priming (when we intentionally play+pause-muted
      // a non-active element to force the browser to buffer bytes).
      if (!isActive && !crossfadeInFlightRef.current && !primingInFlightRef.current) {
        append(`${label} PLAY (non-active, guard pausing) currentTime=${a.currentTime.toFixed(2)}`);
        try { a.pause(); } catch { /* noop */ }
        return;
      }
      append(`${label} PLAY currentTime=${a.currentTime.toFixed(2)} readyState=${a.readyState}`);
    });
    return a;
  };

  const ensureAudio = () => {
    if (!audioARef.current) audioARef.current = mkAudio('A');
    if (!audioBRef.current) audioBRef.current = mkAudio('B');
    return { A: audioARef.current!, B: audioBRef.current! };
  };

  // Preload the standby. iOS treats preload="auto" + .load() as hints, not
  // commands — the browser often defers the fetch until play() is called,
  // which means the first ~seconds of audio after fade-start are silent
  // while the network round-trip happens. Force the fetch by briefly
  // play()+pause()ing the element muted: that commits the browser to
  // buffering, and the pause prevents any audible playback. By the time
  // the real boundary fires, the buffer is ready and the fade is audible.
  const preloadStandby = async (url: string, label: string) => {
    const standby = getStandby();
    if (!standby) return;
    append(`standby (${which(standby)}) preload ${label}`);
    standby.src = url;
    standby.volume = 0;
    standby.muted = true;
    append(`  prime: muted=${standby.muted} vol=${standby.volume} ct=${standby.currentTime.toFixed(3)}`);
    standby.load();
    primingInFlightRef.current = true;
    try {
      await standby.play();
      append(`  prime: play() resolved, muted=${standby.muted} vol=${standby.volume} ct=${standby.currentTime.toFixed(3)} rs=${standby.readyState}`);
      standby.pause();
      append(`  prime: paused, ct=${standby.currentTime.toFixed(3)}`);
      standby.currentTime = 0;
      standby.muted = false;
      append(`standby (${which(standby)}) preload primed (readyState=${standby.readyState}, ct=${standby.currentTime.toFixed(3)})`);
    } catch (e) {
      standby.muted = false;
      append(`standby preload play() rejected: ${(e as Error)?.name}`);
    } finally {
      primingInFlightRef.current = false;
    }
  };

  // Hard-cut swap (crossfade OFF path).
  const hardSwap = (nextGain: number, label: string) => {
    const active = getActive();
    const standby = getStandby();
    if (!active || !standby) return;
    append(`HARD-SWAP: pause ${which(active)} @${active.currentTime.toFixed(2)}, play ${which(standby)} (${label})`);
    try { active.pause(); } catch { /* noop */ }
    activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
    try { standby.currentTime = 0; } catch { /* noop */ }
    standby.volume = nextGain;
    if (activeKeyRef.current === 'A') { setAVol(nextGain); setBVol(0); }
    else { setAVol(0); setBVol(nextGain); }
    const p = standby.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => append(`standby.play() rejected: ${(e as Error)?.name} ${(e as Error)?.message}`));
    }
  };

  // Pick curves for a transition.
  // Returns: outCurve(p), inCurve(p), outgoingPeakGain (cap on outgoing's
  // starting volume), incomingTargetGain (volume to snap incoming to at end).
  const curvesFor = (
    outgoingKind: 'archive' | 'interlude',
    incomingKind: 'archive' | 'interlude',
  ): {
    outCurve: (p: number) => number;
    inCurve: (p: number) => number;
    outgoingPeakGain: number;
    incomingTargetGain: number;
  } => {
    if (outgoingKind === 'archive' && incomingKind === 'interlude') {
      return { outCurve: quad, inCurve: peakTaper, outgoingPeakGain: 1, incomingTargetGain: INTERLUDE_GAIN };
    }
    if (outgoingKind === 'interlude' && incomingKind === 'archive') {
      return { outCurve: invSqrt, inCurve: smoothstep, outgoingPeakGain: INTERLUDE_GAIN, incomingTargetGain: 1 };
    }
    // archive ↔ archive: equal-power.
    return { outCurve: invSqrt, inCurve: sqrt, outgoingPeakGain: 1, incomingTargetGain: 1 };
  };

  // 5s overlapping crossfade. Outgoing keeps playing while incoming ramps up.
  // Both volumes ride the curves. At end: pause outgoing, lock incoming
  // volume at its target, clear the in-flight flag synchronously so the next
  // preload triggers the auto-pause guard again.
  const runCrossfade = (
    outgoing: HTMLAudioElement,
    incoming: HTMLAudioElement,
    outCurve: (p: number) => number,
    inCurve: (p: number) => number,
    outgoingPeakGain: number,
    incomingTargetGain: number,
    label: string,
    onFinish?: () => void,
  ) => {
    // If a previous fade is still in flight (rAF didn't reach p=1 before this
    // boundary fired — happens because the boundary is scheduled at
    // CROSSFADE_MS from fade-start but rAF takes slightly longer to complete),
    // snap it to its final state synchronously so its captured `outgoing` is
    // already paused and won't interfere with this new fade.
    if (crossfadeInFlightRef.current) {
      append('CROSSFADE-START: force-finishing prior fade');
      if (crossfadeRafRef.current !== null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
      if (crossfadeWatchdogRef.current) {
        clearTimeout(crossfadeWatchdogRef.current);
        crossfadeWatchdogRef.current = null;
      }
      // The prior fade's outgoing was the element BEFORE this fade's outgoing
      // (which is the prior fade's incoming, now active). Pause it directly.
      const priorOutgoing = activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current;
      if (priorOutgoing) {
        try { priorOutgoing.pause(); } catch { /* noop */ }
        priorOutgoing.volume = 0;
      }
      crossfadeInFlightRef.current = false;
    }
    const myToken = ++fadeTokenRef.current;
    append(`CROSSFADE-START outgoing=${which(outgoing)} incoming=${which(incoming)} → ${label} (token ${myToken})`);
    append(`  fade-start: incoming muted=${incoming.muted} vol=${incoming.volume} ct=${incoming.currentTime.toFixed(3)} paused=${incoming.paused} rs=${incoming.readyState}`);
    crossfadeInFlightRef.current = true;
    try { incoming.currentTime = 0; } catch { /* noop */ }
    incoming.volume = 0;
    // Flip active immediately so the rest of the code (and the auto-pause
    // guard) treats the new incoming as active. Both are allowed to play
    // during the overlap because of crossfadeInFlightRef.
    activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
    const inLabel = which(incoming);
    if (activeKeyRef.current === 'A') { setAVol(0); /* B keeps its current vol via rAF */ }
    else { setBVol(0); }
    const p = incoming.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => append(`incoming.play() rejected: ${(e as Error)?.name} ${(e as Error)?.message}`));
    }

    const startedAt = performance.now();
    let lastLog = startedAt;
    const finish = (reason: 'natural' | 'watchdog') => {
      // If a NEWER fade has started since this one began, this finish is
      // stale: a force-finish at that fade's start already handled cleanup.
      // Do NOT touch elements — `outgoing` here may now be the new fade's
      // incoming. Just clear our own refs and bail.
      if (fadeTokenRef.current !== myToken) {
        append(`CROSSFADE-END (${reason}, stale token ${myToken} ≠ ${fadeTokenRef.current}) — no-op`);
        return;
      }
      if (crossfadeRafRef.current !== null) {
        cancelAnimationFrame(crossfadeRafRef.current);
        crossfadeRafRef.current = null;
      }
      if (crossfadeWatchdogRef.current) {
        clearTimeout(crossfadeWatchdogRef.current);
        crossfadeWatchdogRef.current = null;
      }
      try { outgoing.pause(); } catch { /* noop */ }
      outgoing.volume = 0;
      incoming.volume = incomingTargetGain;
      if (inLabel === 'A') { setAVol(incomingTargetGain); setBVol(0); }
      else { setAVol(0); setBVol(incomingTargetGain); }
      crossfadeInFlightRef.current = false;
      append(`CROSSFADE-END (${reason}, token ${myToken}) — guard re-armed`);
      if (onFinish) {
        try { onFinish(); } catch (e) { append(`onFinish threw: ${e}`); }
      }
    };

    let tickCount = 0;
    const tick = (t: number) => {
      tickCount++;
      // Log the very first tick so we know rAF ran at all.
      if (tickCount === 1) append(`[tick] token ${myToken} FIRST FRAME at t=${(t - startedAt).toFixed(1)}ms`);
      // Stale token: a newer fade has taken over. Stop ticking.
      if (fadeTokenRef.current !== myToken) {
        append(`[tick] stale token ${myToken}≠${fadeTokenRef.current}, stopping after ${tickCount} frames`);
        return;
      }
      const elapsed = t - startedAt;
      // Clamp to [0, 1]. Negative `p` happens when the very first rAF
      // callback's timestamp is earlier than `startedAt` (rare clock skew).
      // pow(negative, fractional) is NaN, which then sets audio.volume=NaN
      // and throws in Chrome — killing the rAF loop.
      const p = Math.min(1, Math.max(0, elapsed / CROSSFADE_MS));
      const outV = outCurve(p) * outgoingPeakGain;
      const inV = inCurve(p) * incomingTargetGain;
      outgoing.volume = outV;
      incoming.volume = inV;
      if (which(outgoing) === 'A') { setAVol(outV); setBVol(inV); }
      else { setAVol(inV); setBVol(outV); }
      if (t - lastLog > 200) {
        append(`[fade] p=${p.toFixed(2)} outV=${outV.toFixed(2)} inV=${inV.toFixed(2)}`);
        lastLog = t;
      }
      if (p < 1) {
        crossfadeRafRef.current = requestAnimationFrame(tick);
      } else {
        finish('natural');
      }
    };
    append(`scheduling rAF for token ${myToken}`);
    crossfadeRafRef.current = requestAnimationFrame(tick);
    // Watchdog: if rAF was throttled (backgrounded tab) and we missed the
    // natural finish, force the final state ~500ms after the expected end.
    crossfadeWatchdogRef.current = setTimeout(() => {
      if (crossfadeInFlightRef.current) {
        append('CROSSFADE-WATCHDOG triggered (rAF likely throttled)');
        finish('watchdog');
      }
    }, CROSSFADE_MS + 500);
  };

  const transition = (
    incomingKind: 'archive' | 'interlude',
    nextGain: number,
    label: string,
    onFinish?: () => void,
  ) => {
    const outgoing = getActive();
    const incoming = getStandby();
    if (!outgoing || !incoming) return;
    if (!crossfadeOn) {
      hardSwap(nextGain, label);
      if (onFinish) onFinish();
      return;
    }
    const outgoingKind: 'archive' | 'interlude' = stage === 'interlude' ? 'interlude' : 'archive';
    const { outCurve, inCurve, outgoingPeakGain, incomingTargetGain } = curvesFor(outgoingKind, incomingKind);
    void nextGain;
    runCrossfade(outgoing, incoming, outCurve, inCurve, outgoingPeakGain, incomingTargetGain, label, onFinish);
  };

  const start = async () => {
    setLog([]);
    activeKeyRef.current = 'A';
    const interlude = INTERLUDES[interludeIdx];
    append(`user gesture: starting (interlude="${interlude.label}", crossfade=${crossfadeOn ? 'ON' : 'OFF'})`);

    const { A } = ensureAudio();
    A.volume = 1;
    if (audioBRef.current) audioBRef.current.volume = 0;
    setAVol(1);
    setBVol(0);

    // Load + seek archive A.
    A.src = ARCHIVE_A_URL;
    await new Promise<void>((resolve) => {
      const onReady = () => { A.removeEventListener('loadedmetadata', onReady); resolve(); };
      A.addEventListener('loadedmetadata', onReady);
      setTimeout(() => { A.removeEventListener('loadedmetadata', onReady); resolve(); }, 5000);
    });
    // Seek to near the end so the natural boundary fires fast.
    const aSeekTarget = Math.max(0, ARCHIVE_A_DURATION_SEC - A_PRE_SEC - CROSSFADE_MS / 1000 - 1);
    try { A.currentTime = aSeekTarget; } catch (e) { append(`seek failed: ${e}`); }
    append(`A seeked to ${aSeekTarget.toFixed(1)}s of ${ARCHIVE_A_DURATION_SEC}s`);
    setStage('archive-a');
    try {
      await A.play();
    } catch (e) {
      append(`A play() rejected: ${(e as Error)?.name} ${(e as Error)?.message}`);
      return;
    }

    // Preload interlude on standby — same as prod does in its boundary effect.
    preloadStandby(interlude.url, `interlude "${interlude.label}"`);
    nextItemRef.current = { url: interlude.url, gain: INTERLUDE_GAIN, label: interlude.label, kind: 'interlude' };

    // Mirror prod: stub MediaSession dedupe write.
    const sig = `radio|archive A| `;
    if (sig !== lastMediaSessionSigRef.current) {
      lastMediaSessionSigRef.current = sig;
      append('mediaSession metadata <- archive A (stubbed)');
    }

    // Schedule the boundary action. With crossfade ON the fade starts at
    // A_PRE_SEC. With it OFF, the hard-cut happens at A_PRE_SEC.
    scheduleBoundary(A_PRE_SEC * 1000);
  };

  const scheduleBoundary = (delayMs: number) => {
    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    append(`boundary timer set in ${(delayMs / 1000).toFixed(1)}s`);
    boundaryTimerRef.current = setTimeout(() => {
      advance();
    }, delayMs);
  };

  const advance = () => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    const nx = nextItemRef.current;
    if (!nx) return;

    if (nx.kind === 'interlude') {
      // Preload archive B AFTER the archive→interlude crossfade has fully
      // completed (outgoing paused). Doing it during the fade would set
      // .src on the now-standby element which is STILL playing archive A,
      // wiping its currentTime and killing archive A audio mid-fade.
      transition('interlude', nx.gain, `interlude "${nx.label}"`, () => {
        append('post-fade hook: preload archive B on standby');
        preloadStandby(ARCHIVE_B_URL, 'archive B');
      });
      setStage('interlude');
      const sig = `radio|interlude|channel radio`;
      if (sig !== lastMediaSessionSigRef.current) {
        lastMediaSessionSigRef.current = sig;
        append('mediaSession metadata <- interlude (stubbed)');
      }
      nextItemRef.current = { url: ARCHIVE_B_URL, gain: 1, label: 'archive B', kind: 'archive' };
      // Boundary for interlude→archive: schedule fade-start at end-of-interlude.
      // With crossfade ON the fade runs from this point for CROSSFADE_MS, so
      // we kick it CROSSFADE_MS before the interlude's natural end. With OFF
      // we hard-cut at the natural end.
      const interludeDurMs = INTERLUDES[interludeIdx].durationSec * 1000;
      const fadeStartMs = crossfadeOn ? Math.max(50, interludeDurMs - CROSSFADE_MS) : interludeDurMs;
      scheduleBoundary(fadeStartMs);
    } else {
      transition('archive', nx.gain, nx.label);
      setStage('archive-b');
      const sig = `radio|archive B| `;
      if (sig !== lastMediaSessionSigRef.current) {
        lastMediaSessionSigRef.current = sig;
        append('mediaSession metadata <- archive B (stubbed)');
      }
      nextItemRef.current = null;
      append('archive B playing — test complete (wait ~6s)');
      setTimeout(() => setStage('done'), 6000);
    }
  };

  const stop = () => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
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
    setStage('done');
    append('stopped');
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Dual-element preload + 5s gated crossfade test</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Mirrors prod (dual A/B elements, standby preload). With crossfade ON: 5s overlap with per-transition curves. The auto-pause-non-active guard is suppressed during the overlap, re-armed instantly at fade end.
        </p>

        <div className="mb-4 flex items-center gap-4 flex-wrap">
          <label className="text-sm text-zinc-300 flex items-center gap-2">
            Interlude:
            <select
              value={interludeIdx}
              onChange={(e) => setInterludeIdx(Number(e.target.value))}
              disabled={stage !== 'idle' && stage !== 'done'}
              className="bg-zinc-900 text-white border border-white/10 px-2 py-1 text-sm font-mono disabled:opacity-50"
            >
              {INTERLUDES.map((it, i) => (
                <option key={it.url} value={i}>{it.label} ({it.durationSec}s)</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zinc-300 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={crossfadeOn}
              onChange={(e) => setCrossfadeOn(e.target.checked)}
              disabled={stage !== 'idle' && stage !== 'done'}
              className="accent-white"
            />
            5s crossfade
          </label>
        </div>

        <div className="flex gap-3 mb-6 flex-wrap">
          <button
            onClick={start}
            className="px-4 py-2 bg-white text-black font-bold hover:bg-zinc-200 disabled:opacity-50"
            disabled={stage !== 'idle' && stage !== 'done'}
          >
            Start test
          </button>
          <button
            onClick={stop}
            className="px-4 py-2 bg-zinc-800 text-white font-bold hover:bg-zinc-700 disabled:opacity-50"
            disabled={stage === 'idle' || stage === 'done'}
          >
            Stop
          </button>
        </div>

        <div className="mb-6">
          <div className="text-sm text-zinc-400 mb-1">
            Stage: <span className="text-white font-mono">{stage}</span> · active:{' '}
            <span className="text-white font-mono">{activeKeyRef.current}</span> ·{' '}
            <span className="text-white font-mono">{crossfadeInFlightRef.current ? 'fading' : 'idle'}</span>
          </div>
          <VolumeBar label="element A" vol={aVol} color="bg-blue-500" />
          <VolumeBar label="element B" vol={bVol} color="bg-green-500" />
        </div>

        <div className="mb-6">
          <div className="text-sm text-zinc-400 mb-2">Preview (matches prod components):</div>
          <div className="border border-white/10">
            {stage === 'interlude' ? (
              <InterludeBarPreview />
            ) : (
              <div className="bg-black border-b border-white/10 py-2 px-3 text-xs text-zinc-500">
                (normal archive bar — not mounted in this test)
              </div>
            )}
            {stage === 'interlude' ? (
              <InterludeSlide onPlay={() => append('preview hero tapped (no-op)')} />
            ) : (
              <div className="w-full aspect-[16/9] lg:aspect-[5/2] bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
                (normal archive hero — not mounted in this test)
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-900 border border-white/10 p-3 text-xs font-mono max-h-80 overflow-y-auto">
          {log.length === 0 ? (
            <div className="text-zinc-500">Press Start to begin.</div>
          ) : (
            log.map((line, i) => <div key={i} className="text-zinc-300">{line}</div>)
          )}
        </div>

        <details className="mt-6 text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">Test parameters</summary>
          <ul className="mt-2 space-y-1 font-mono">
            <li>Archive A: {ARCHIVE_A_URL}</li>
            <li>Archive A duration: {ARCHIVE_A_DURATION_SEC}s</li>
            <li>A_PRE_SEC (audible before boundary): {A_PRE_SEC}s</li>
            <li>Interlude: {INTERLUDES[interludeIdx].url}</li>
            <li>Interlude duration: {INTERLUDES[interludeIdx].durationSec}s</li>
            <li>Archive B: {ARCHIVE_B_URL}</li>
            <li>CROSSFADE_MS: {CROSSFADE_MS}</li>
            <li>INTERLUDE_GAIN: {INTERLUDE_GAIN}</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

function InterludeBarPreview() {
  return (
    <div className="z-[99] bg-black border-b border-white/10 overflow-hidden">
      <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
        <div className="flex items-center ml-1 flex-shrink-0">
          <div className="w-[27px] h-[27px] flex-shrink-0" aria-hidden="true" />
          <button
            className="h-[27px] pl-2 pr-1 flex items-center justify-center transition-colors"
            aria-label="Pause"
          >
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 3h4v18H6V3zm8 0h4v18h-4V3z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold leading-tight text-white">interlude</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]">channel radio</div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <span className="relative flex h-4 w-4 sm:h-[18px] sm:w-[18px] items-center justify-center">
            <span className="animate-live-pulse absolute inline-flex h-2.5 w-2.5 sm:h-[11px] sm:w-[11px] rounded-full bg-red-400" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-[11px] sm:w-[11px] bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
          </span>
        </div>
      </div>
    </div>
  );
}

function VolumeBar({ label, vol, color }: { label: string; vol: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="w-20 text-xs text-zinc-400">{label}</div>
      <div className="flex-1 h-2 bg-zinc-900 relative overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${color} transition-none`} style={{ width: `${vol * 100}%` }} />
      </div>
      <div className="w-12 text-xs font-mono text-zinc-500 text-right">{(vol * 100).toFixed(0)}%</div>
    </div>
  );
}

