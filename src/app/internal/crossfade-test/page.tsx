'use client';

import { useEffect, useRef, useState } from 'react';
import { InterludeSlide } from '@/components/channel/ArchiveHero';

// Mirrors the PROD radio path after the dual-element crossfade was removed:
// one <audio> element, hard-cut at item boundaries. No fade, no second
// element. This is what useBroadcastStream does too (stable on iOS).
//
// Use "Force next boundary" to advance to the next item without waiting
// for the natural end.
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
// Seconds of archive A before we hand off to the interlude when not forced.
const A_PRE_SEC = 8;

type Stage = 'idle' | 'archive-a' | 'interlude' | 'archive-b' | 'done';

type Item =
  | { kind: 'archive'; label: string; url: string; gain: number }
  | { kind: 'interlude'; label: string; url: string; gain: number; durationSec: number };

export default function CrossfadeTestPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [vol, setVol] = useState(0);
  const [interludeIdx, setInterludeIdx] = useState(0);

  // Single <audio> element — same as new prod path.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const boundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const append = (msg: string) => {
    setLog((l) => [...l, `${new Date().toISOString().slice(11, 23)}  ${msg}`]);
  };

  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
      audioRef.current?.pause();
    };
  }, []);

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.addEventListener('pause', () => append(`PAUSE event currentTime=${a.currentTime.toFixed(2)} readyState=${a.readyState}`));
    a.addEventListener('error', () => append(`ERROR ${a.error?.code} ${a.error?.message ?? ''}`));
    audioRef.current = a;
    return a;
  };

  // Hard-cut to a new item: set src, wait for metadata, play.
  const playItem = async (item: Item) => {
    const a = ensureAudio();
    append(`hard-cut → ${item.kind}: ${item.label}`);
    a.src = item.url;
    await new Promise<void>((resolve) => {
      const onReady = () => { a.removeEventListener('loadedmetadata', onReady); resolve(); };
      a.addEventListener('loadedmetadata', onReady);
      setTimeout(() => { a.removeEventListener('loadedmetadata', onReady); resolve(); }, 5000);
    });
    a.volume = item.gain;
    setVol(item.gain);
    try {
      await a.play();
      append(`PLAY resolved, readyState=${a.readyState}, currentTime=${a.currentTime.toFixed(2)}`);
    } catch (e) {
      append(`PLAY rejected: ${(e as Error)?.name} ${(e as Error)?.message}`);
    }
  };

  const start = async () => {
    setLog([]);
    setStage('idle');
    const interlude = INTERLUDES[interludeIdx];
    append(`user gesture: starting test (interlude="${interlude.label}")`);

    // Step 1: play archive A. Seek to near the end so the natural boundary
    // also exercises the hard-cut after A_PRE_SEC.
    const a = ensureAudio();
    a.src = ARCHIVE_A_URL;
    await new Promise<void>((resolve) => {
      const onReady = () => { a.removeEventListener('loadedmetadata', onReady); resolve(); };
      a.addEventListener('loadedmetadata', onReady);
      setTimeout(() => { a.removeEventListener('loadedmetadata', onReady); resolve(); }, 5000);
    });
    const aSeekTarget = Math.max(0, ARCHIVE_A_DURATION_SEC - A_PRE_SEC - 1);
    try { a.currentTime = aSeekTarget; } catch (e) { append(`seek failed: ${e}`); }
    append(`A seeked to ${aSeekTarget.toFixed(1)}s of ${ARCHIVE_A_DURATION_SEC}s`);
    a.volume = 1;
    setVol(1);
    setStage('archive-a');
    try {
      await a.play();
      append(`A playing — will hard-cut in ${A_PRE_SEC}s (or tap Force next)`);
    } catch (e) {
      append(`A play() rejected: ${(e as Error)?.name} ${(e as Error)?.message}`);
      return;
    }

    // Schedule a natural boundary after A_PRE_SEC. The "force next" button
    // can also trigger this manually.
    scheduleNext('interlude');
  };

  const scheduleNext = (target: 'interlude' | 'archive-b') => {
    if (boundaryTimerRef.current) clearTimeout(boundaryTimerRef.current);
    const delay = target === 'interlude' ? A_PRE_SEC * 1000 : (INTERLUDES[interludeIdx].durationSec - 1) * 1000;
    append(`boundary timer set: ${target} in ${(delay / 1000).toFixed(1)}s`);
    boundaryTimerRef.current = setTimeout(() => advance(target), delay);
  };

  const advance = async (target: 'interlude' | 'archive-b') => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    if (target === 'interlude') {
      const interlude = INTERLUDES[interludeIdx];
      setStage('interlude');
      await playItem({
        kind: 'interlude',
        label: interlude.label,
        url: interlude.url,
        gain: INTERLUDE_GAIN,
        durationSec: interlude.durationSec,
      });
      scheduleNext('archive-b');
    } else {
      setStage('archive-b');
      await playItem({
        kind: 'archive',
        label: 'archive B',
        url: ARCHIVE_B_URL,
        gain: 1,
      });
      append('archive B playing — test complete');
      setStage('done');
    }
  };

  const forceNext = () => {
    if (stage === 'archive-a') void advance('interlude');
    else if (stage === 'interlude') void advance('archive-b');
  };

  const stop = () => {
    if (boundaryTimerRef.current) {
      clearTimeout(boundaryTimerRef.current);
      boundaryTimerRef.current = null;
    }
    audioRef.current?.pause();
    setStage('done');
    append('stopped');
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Single-element hard-cut test</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Mirrors the new prod radio path: one &lt;audio&gt; element, hard-cut between items. Use &quot;Force next boundary&quot; to advance without waiting.
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
            onClick={forceNext}
            className="px-4 py-2 bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-50"
            disabled={stage !== 'archive-a' && stage !== 'interlude'}
          >
            Force next boundary
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
          <VolumeBar label="audio" vol={vol} color="bg-blue-500" />
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
