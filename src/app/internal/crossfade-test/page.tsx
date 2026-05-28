'use client';

import { useEffect, useRef, useState } from 'react';
import { InterludeSlide } from '@/components/channel/ArchiveHero';

// Reproduces the PROD radio's 2-element crossfade exactly:
// - Two <audio> elements A and B that swap roles between items.
// - Only the *active* element gets src + play() inside the user gesture chain.
// - The *standby* element's src is assigned later, in a non-gesture path,
//   then .play() fires from a setTimeout. This is what breaks on iOS.
//
// Toggle "pre-warm standby" to apply the fix: during the user gesture,
// we play+pause the standby element (with no src or muted) to consume the
// gesture credit. Subsequent .play() with a real src then succeeds.
const ARCHIVE_A_URL =
  'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-05-16T022806.mp4';
const ARCHIVE_A_DURATION_SEC = 5512;
const ARCHIVE_B_URL =
  'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-05-28T010419.mp4';

const INTERLUDES = [
  { label: 'berlin clubs', durationSec: 10, url: 'https://media.channel-app.com/interludes/berlin-clubs-1779974220976.m4a' },
  { label: 'weed convo birds', durationSec: 24, url: 'https://media.channel-app.com/interludes/weed-convo-birds-1779973930315.m4a' },
  { label: 'toilet therapist', durationSec: 23, url: 'https://media.channel-app.com/interludes/toilet-therapist-1779907421108.m4a' },
  { label: 'water refill smoking area', durationSec: 20, url: 'https://media.channel-app.com/interludes/water-refill-smoking-area-1779973923793.m4a' },
];

const CROSSFADE_MS = 5000;
const INTERLUDE_GAIN = 0.52;
// Seconds of archive A before the first crossfade kicks off.
const A_PRE_SEC = 8;

type Stage =
  | 'idle'
  | 'playing-a'
  | 'fading-a-to-interlude'
  | 'playing-interlude'
  | 'fading-interlude-to-b'
  | 'playing-b'
  | 'done';

type PreviewState = 'archive-a' | 'interlude' | 'archive-b';

export default function CrossfadeTestPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [aVol, setAVol] = useState(0);
  const [bVol, setBVol] = useState(0);
  const [preview, setPreview] = useState<PreviewState>('archive-a');
  const [interludeIdx, setInterludeIdx] = useState(0);
  const [preWarm, setPreWarm] = useState(true);

  // Two-element prod-style setup. A and B swap roles each transition.
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  // Which element is currently active. Starts on A.
  const activeKeyRef = useRef<'A' | 'B'>('A');
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const append = (msg: string) => {
    setLog((l) => [...l, `${new Date().toISOString().slice(11, 23)}  ${msg}`]);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      for (const t of timersRef.current) clearTimeout(t);
      audioARef.current?.pause();
      audioBRef.current?.pause();
    };
  }, []);

  const getActive = () => (activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current);
  const getStandby = () => (activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current);
  const setActiveVol = (v: number) => {
    if (activeKeyRef.current === 'A') setAVol(v); else setBVol(v);
  };
  const setStandbyVol = (v: number) => {
    if (activeKeyRef.current === 'A') setBVol(v); else setAVol(v);
  };

  // Mirrors the prod crossfade rAF in useArchiveRadio. Outgoing fades out,
  // incoming fades in. inGain caps the incoming's peak (interludes peak
  // lower than shows).
  const crossfade = (
    outgoing: HTMLAudioElement,
    incoming: HTMLAudioElement,
    onOutgoingVol: (v: number) => void,
    onIncomingVol: (v: number) => void,
    onDone: () => void,
    outGain = 1,
    inGain = 1,
  ) => {
    const which = (el: HTMLAudioElement) => (el === audioARef.current ? 'A' : 'B');
    console.log('[radio-debug] FADE-START outgoing=', which(outgoing), 'incoming=', which(incoming),
      'in.readyState=', incoming.readyState, 'in.paused=', incoming.paused,
      'in.src=', incoming.src.slice(-40), 'in.currentTime=', incoming.currentTime.toFixed(2),
      'out.paused=', outgoing.paused);
    incoming.volume = 0;
    onIncomingVol(0);
    const p = incoming.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        console.log('[radio-debug] in.play() RESOLVED in.paused=', incoming.paused,
          'in.readyState=', incoming.readyState, 'in.currentTime=', incoming.currentTime.toFixed(2));
      });
    }
    if (p && typeof p.catch === 'function') {
      p.catch((e) => {
        console.warn('[radio-debug] in.play() REJECTED', (e as Error)?.name, (e as Error)?.message);
        append(`incoming.play() rejected: ${(e as Error)?.name} — ${(e as Error)?.message}`);
      });
    }
    const checkpoints = [200, 1000, 2000];
    for (const ms of checkpoints) {
      setTimeout(() => {
        console.log(`[radio-debug] FADE+${ms}ms in.paused=`, incoming.paused,
          'in.currentTime=', incoming.currentTime.toFixed(2),
          'in.readyState=', incoming.readyState);
      }, ms);
    }
    const startedAt = performance.now();
    const tick = (t: number) => {
      const pp = Math.min(1, Math.max(0, (t - startedAt) / CROSSFADE_MS));
      const outV = outGain * Math.sqrt(1 - pp);
      const inV = inGain * Math.sqrt(pp);
      outgoing.volume = outV;
      incoming.volume = inV;
      onOutgoingVol(outV);
      onIncomingVol(inV);
      if (pp < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        onDone();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const start = async () => {
    setLog([]);
    setStage('idle');
    setPreview('archive-a');
    activeKeyRef.current = 'A';
    const interlude = INTERLUDES[interludeIdx];
    append(`user gesture: starting test (interlude="${interlude.label}", pre-warm=${preWarm ? 'ON' : 'OFF'})`);

    // Lazily create both elements with prod iOS attrs.
    const mkAudio = (label: string) => {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.setAttribute('webkit-playsinline', '');
      a.addEventListener('error', () => append(`${label} error: ${a.error?.code} ${a.error?.message ?? ''}`));
      a.addEventListener('pause', () => {
        const whichEl = a === audioARef.current ? 'A' : 'B';
        console.log('[radio-debug] PAUSE on', whichEl, 'currentTime=', a.currentTime.toFixed(2));
      });
      return a;
    };
    const A = audioARef.current ?? mkAudio('A');
    const B = audioBRef.current ?? mkAudio('B');
    audioARef.current = A;
    audioBRef.current = B;

    A.volume = 1;
    B.volume = 0;
    setAVol(1);
    setBVol(0);

    // ─────────────────────────────────────────────────────────────────
    // PROD-STYLE GESTURE CHAIN — only the active element gets src + play.
    // The standby (B) is intentionally NOT touched here, mirroring the
    // bug in useArchiveRadio.playCurrent (it only writes to active).
    // ─────────────────────────────────────────────────────────────────
    A.src = ARCHIVE_A_URL;
    A.load();
    await new Promise<void>((resolve) => {
      const onReady = () => { A.removeEventListener('loadedmetadata', onReady); resolve(); };
      A.addEventListener('loadedmetadata', onReady);
      setTimeout(() => { A.removeEventListener('loadedmetadata', onReady); resolve(); }, 5000);
    });
    const aSeekTarget = Math.max(0, ARCHIVE_A_DURATION_SEC - (A_PRE_SEC + CROSSFADE_MS / 1000) - 1);
    try { A.currentTime = aSeekTarget; } catch (e) { append(`A seek failed: ${e}`); }
    append(`A seeked to ${aSeekTarget.toFixed(1)}s of ${ARCHIVE_A_DURATION_SEC}s`);
    setStage('playing-a');
    await A.play();
    append(`A playing — will fade in ${A_PRE_SEC}s`);

    // THE FIX: pre-warm the standby element by play()+pause() during the
    // gesture. This is what the prod fix added to playCurrent.
    if (preWarm) {
      try {
        B.muted = true;
        await B.play();
        B.pause();
        B.muted = false;
        append('pre-warm: B unlocked via gesture (play+pause)');
      } catch (e) {
        append(`pre-warm: B play() rejected (expected if no src) — ${(e as Error)?.name}`);
      }
    } else {
      append('pre-warm: SKIPPED — B is not gesture-unlocked');
    }

    // ─── Outside the gesture from here on — same as prod boundary effect ───

    // Schedule fade A -> interlude (incoming = B with interlude src).
    const t1 = setTimeout(() => {
      // Assign interlude src to standby, NOT inside any gesture. This mirrors
      // the prod boundary effect that does `standby.src = next.item.recordingUrl`.
      const standby = getStandby();
      if (!standby) return;
      standby.src = interlude.url;
      standby.load();
      append(`(non-gesture) assigned interlude src to standby; about to fade`);
      setStage('fading-a-to-interlude');
      const outgoing = getActive();
      if (!outgoing) return;
      crossfade(outgoing, standby, setActiveVol, setStandbyVol, () => {
        try { outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load(); } catch { /* noop */ }
        // Swap roles — standby becomes active.
        activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
        // Snap to alone-volume.
        standby.volume = INTERLUDE_GAIN;
        setActiveVol(INTERLUDE_GAIN);
        setStage('playing-interlude');
        setPreview('interlude');
        append(`interlude playing — fade-out in ${(interlude.durationSec - CROSSFADE_MS / 1000).toFixed(1)}s`);
      }, 1, INTERLUDE_GAIN);
    }, A_PRE_SEC * 1000);
    timersRef.current.push(t1);

    // Schedule fade interlude -> B-archive.
    const interludeFadeStartMs = (A_PRE_SEC + interlude.durationSec) * 1000 - CROSSFADE_MS;
    const t2 = setTimeout(() => {
      // Now active is what was the standby (B if we started on A, A otherwise).
      // New standby gets the archive-B src — again, outside any gesture.
      const standby = getStandby();
      if (!standby) return;
      standby.src = ARCHIVE_B_URL;
      standby.load();
      append('(non-gesture) assigned archive-B src to standby; about to fade');
      setStage('fading-interlude-to-b');
      const outgoing = getActive();
      if (!outgoing) return;
      crossfade(outgoing, standby, setActiveVol, setStandbyVol, () => {
        try { outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load(); } catch { /* noop */ }
        activeKeyRef.current = activeKeyRef.current === 'A' ? 'B' : 'A';
        standby.volume = 1;
        setActiveVol(1);
        setStage('playing-b');
        setPreview('archive-b');
        append('B playing — test complete');
      }, INTERLUDE_GAIN, 1);
    }, interludeFadeStartMs);
    timersRef.current.push(t2);
  };

  const stop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    audioARef.current?.pause();
    audioBRef.current?.pause();
    setStage('done');
    append('stopped');
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Crossfade test (prod-style 2-element)</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Reproduces the prod radio&apos;s 2-element A/B swap pattern. Standby element gets its src assigned outside the user gesture — same as prod. Toggle &quot;pre-warm&quot; to apply the iOS gesture-unlock fix.
        </p>

        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-300">Interlude:</label>
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
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={preWarm}
              onChange={(e) => setPreWarm(e.target.checked)}
              disabled={stage !== 'idle' && stage !== 'done'}
              className="accent-white"
            />
            Pre-warm standby element inside user gesture (the iOS fix)
          </label>
        </div>

        <div className="flex gap-3 mb-6">
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
          <div className="text-sm text-zinc-400 mb-1">Stage: <span className="text-white font-mono">{stage}</span></div>
          <VolumeBar label="element A" vol={aVol} color="bg-blue-500" />
          <VolumeBar label="element B" vol={bVol} color="bg-green-500" />
          <div className="text-xs text-zinc-500 mt-1 font-mono">active = {activeKeyRef.current}</div>
        </div>

        <div className="mb-6">
          <div className="text-sm text-zinc-400 mb-2">Preview (matches prod components):</div>
          <div className="border border-white/10">
            {preview === 'interlude' ? (
              <InterludeBarPreview />
            ) : (
              <div className="bg-black border-b border-white/10 py-2 px-3 text-xs text-zinc-500">
                (normal archive bar — not mounted in this test)
              </div>
            )}
            {preview === 'interlude' ? (
              <InterludeSlide onPlay={() => append('preview hero tapped (no-op in test)')} />
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
            <li>A_PRE_SEC (audible before fade): {A_PRE_SEC}s</li>
            <li>Interlude: {INTERLUDES[interludeIdx].url}</li>
            <li>Interlude duration: {INTERLUDES[interludeIdx].durationSec}s</li>
            <li>Archive B: {ARCHIVE_B_URL}</li>
            <li>CROSSFADE_MS: {CROSSFADE_MS}</li>
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
