'use client';

import { useEffect, useRef, useState } from 'react';
import { InterludeSlide } from '@/components/channel/ArchiveHero';

// Mirrors the new prod radio path: dual <audio> elements (A and B) with the
// standby preloading the next item. At boundary: pause active, play standby,
// swap roles. Gapless because standby is already buffered. No crossfade.
//
// Use "Force next boundary" to advance without waiting for natural duration.
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

const INTERLUDE_GAIN = 0.52;
// Seconds of archive A before the boundary fires naturally.
const A_PRE_SEC = 8;

type Stage = 'idle' | 'archive-a' | 'interlude' | 'archive-b' | 'done';

export default function CrossfadeTestPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [aVol, setAVol] = useState(0);
  const [bVol, setBVol] = useState(0);
  const [interludeIdx, setInterludeIdx] = useState(0);

  // Two <audio> elements that swap roles each boundary.
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeKeyRef = useRef<'A' | 'B'>('A');
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the next-up item so Force-next picks the right thing.
  const nextItemRef = useRef<{ url: string; gain: number; label: string; isInterlude: boolean } | null>(null);
  const lastItemRef = useRef<'archive-a' | 'interlude' | 'archive-b' | null>(null);

  const append = (msg: string) => {
    setLog((l) => [...l, `${new Date().toISOString().slice(11, 23)}  ${msg}`]);
  };

  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      audioARef.current?.pause();
      audioBRef.current?.pause();
    };
  }, []);

  const mkAudio = (label: string) => {
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.addEventListener('error', () => append(`${label} ERROR ${a.error?.code} ${a.error?.message ?? ''}`));
    a.addEventListener('pause', () => append(`${label} PAUSE currentTime=${a.currentTime.toFixed(2)} readyState=${a.readyState}`));
    a.addEventListener('play', () => append(`${label} PLAY currentTime=${a.currentTime.toFixed(2)} readyState=${a.readyState}`));
    return a;
  };

  const ensureAudio = () => {
    if (!audioARef.current) audioARef.current = mkAudio('A');
    if (!audioBRef.current) audioBRef.current = mkAudio('B');
    return { A: audioARef.current!, B: audioBRef.current! };
  };

  const getActive = () => (activeKeyRef.current === 'A' ? audioARef.current : audioBRef.current);
  const getStandby = () => (activeKeyRef.current === 'A' ? audioBRef.current : audioARef.current);
  const which = (el: HTMLAudioElement) => (el === audioARef.current ? 'A' : 'B');

  // Preload an item on the standby element. Mirrors the prod boundary effect's
  // `standby.src = next.url; standby.load();`.
  const preloadStandby = (url: string, label: string) => {
    const standby = getStandby();
    if (!standby) return;
    if (standby.src === url) {
      append(`standby (${which(standby)}) already has ${label}`);
      return;
    }
    append(`standby (${which(standby)}) preload ${label}`);
    standby.src = url;
    standby.load();
  };

  // Boundary swap: pause active, play standby (already buffered), flip roles.
  const swap = (nextGain: number, label: string) => {
    const active = getActive();
    const standby = getStandby();
    if (!active || !standby) return;
    append(`SWAP: pause ${which(active)} @${active.currentTime.toFixed(2)}, play ${which(standby)} (${label})`);
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

  const start = async () => {
    setLog([]);
    activeKeyRef.current = 'A';
    lastItemRef.current = 'archive-a';
    const interlude = INTERLUDES[interludeIdx];
    append(`user gesture: starting (interlude="${interlude.label}")`);

    const { A, B } = ensureAudio();
    void B; // B exists for later preload
    A.volume = 1;
    B.volume = 0;
    setAVol(1);
    setBVol(0);

    // Load + seek archive A.
    A.src = ARCHIVE_A_URL;
    await new Promise<void>((resolve) => {
      const onReady = () => { A.removeEventListener('loadedmetadata', onReady); resolve(); };
      A.addEventListener('loadedmetadata', onReady);
      setTimeout(() => { A.removeEventListener('loadedmetadata', onReady); resolve(); }, 5000);
    });
    const aSeekTarget = Math.max(0, ARCHIVE_A_DURATION_SEC - A_PRE_SEC - 1);
    try { A.currentTime = aSeekTarget; } catch (e) { append(`seek failed: ${e}`); }
    append(`A seeked to ${aSeekTarget.toFixed(1)}s of ${ARCHIVE_A_DURATION_SEC}s`);
    setStage('archive-a');
    try {
      await A.play();
    } catch (e) {
      append(`A play() rejected: ${(e as Error)?.name} ${(e as Error)?.message}`);
      return;
    }

    // Preload interlude on standby (B) — same as prod does in its boundary effect.
    preloadStandby(interlude.url, `interlude "${interlude.label}"`);
    nextItemRef.current = { url: interlude.url, gain: INTERLUDE_GAIN, label: interlude.label, isInterlude: true };

    // Schedule natural boundary at A_PRE_SEC.
    scheduleBoundary(A_PRE_SEC * 1000);
  };

  const scheduleBoundary = (delayMs: number) => {
    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    append(`boundary timer set in ${(delayMs / 1000).toFixed(1)}s`);
    boundaryTimerRef.current = setTimeout(() => {
      void advance();
    }, delayMs);
  };

  const advance = () => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    const nx = nextItemRef.current;
    if (!nx) return;
    if (nx.isInterlude) {
      swap(nx.gain, `interlude "${nx.label}"`);
      setStage('interlude');
      lastItemRef.current = 'interlude';
      // Now preload archive B on the new standby.
      preloadStandby(ARCHIVE_B_URL, 'archive B');
      nextItemRef.current = { url: ARCHIVE_B_URL, gain: 1, label: 'archive B', isInterlude: false };
      scheduleBoundary((INTERLUDES[interludeIdx].durationSec - 1) * 1000);
    } else {
      swap(nx.gain, nx.label);
      setStage('archive-b');
      lastItemRef.current = 'archive-b';
      nextItemRef.current = null;
      append('archive B playing — test complete');
      // After ~6s, mark done.
      setTimeout(() => setStage('done'), 6000);
    }
  };

  const stop = () => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    audioARef.current?.pause();
    audioBRef.current?.pause();
    setStage('done');
    append('stopped');
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Dual-element preload + hard-cut test</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Mirrors the new prod radio path: two &lt;audio&gt; elements (A and B), standby preloads next item, boundary pauses active + plays standby. Gapless. No crossfade.
        </p>

        <div className="mb-4 flex items-center gap-3">
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
          <div className="text-sm text-zinc-400 mb-1">Stage: <span className="text-white font-mono">{stage}</span> · active: <span className="text-white font-mono">{activeKeyRef.current}</span></div>
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
            <li>A_PRE_SEC: {A_PRE_SEC}s</li>
            <li>Interlude: {INTERLUDES[interludeIdx].url}</li>
            <li>Interlude duration: {INTERLUDES[interludeIdx].durationSec}s</li>
            <li>Archive B: {ARCHIVE_B_URL}</li>
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
