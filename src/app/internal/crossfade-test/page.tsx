'use client';

import { useEffect, useRef, useState } from 'react';
import { InterludeSlide } from '@/components/channel/ArchiveHero';

// Hardcoded test segment: end of archive A -> interlude -> start of archive B.
// Bookend archives picked from /api/archives (Close Encounters, dark sky
// backroads). Interlude is the one already uploaded to R2 via seed-interstitial.
//
// Each item plays its TRIMMED portion only -- for archive A we seek near its
// end so the crossfade boundary lands soon after start. Total run time:
// (A_PRE_SEC + CROSSFADE_SEC + INTERLUDE_PRE + CROSSFADE_SEC + B_SAMPLE_SEC).
const ARCHIVE_A_URL =
  'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-05-22T230251.mp4';
const ARCHIVE_A_DURATION_SEC = 7026; // from the API
const INTERLUDE_URL = '/interludes/toilet%20therapist%2023s.m4a';
const INTERLUDE_DURATION_SEC = 23;
const ARCHIVE_B_URL =
  'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-05-22T020003.mp4';

const CROSSFADE_MS = 5000;
// Interlude clips play at 80% gain when alone (shows play at 100%) so the
// interlude doesn't blast vs the music. During crossfades it ducks further:
// the interlude side ramps against INTERLUDE_GAIN * INTERLUDE_FADE_DUCK so it
// doesn't compete with the show that's fading in/out alongside it.
const INTERLUDE_GAIN = 0.52;
const INTERLUDE_FADE_DUCK = 0.8;
const INTERLUDE_FADE_GAIN = INTERLUDE_GAIN * INTERLUDE_FADE_DUCK; // = 0.42
// How much of archive A we play before transitioning. Keep short so the test
// runs fast.
const A_PRE_SEC = 10;

type Stage =
  | 'idle'
  | 'playing-a'
  | 'fading-a-to-interlude'
  | 'playing-interlude'
  | 'fading-interlude-to-b'
  | 'playing-b'
  | 'done';

// Preview state mirrors what prod components show. 'archive' = normal show
// playback UI (we don't render a fake one here, just collapse the preview).
// 'interlude' = the channel-radio interlude UI from GlobalBroadcastBar +
// InterludeSlide. Flips at the same moment prod would: when the schedule's
// currentItem.kind becomes 'interstitial'. In this test that moment is the
// end of the A->I crossfade (incoming has reached full volume).
type PreviewState = 'archive-a' | 'interlude' | 'archive-b';

export default function CrossfadeTestPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [aVol, setAVol] = useState(1);
  const [iVol, setIVol] = useState(0);
  const [bVol, setBVol] = useState(0);
  const [preview, setPreview] = useState<PreviewState>('archive-a');

  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioIRef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
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
      audioIRef.current?.pause();
      audioBRef.current?.pause();
    };
  }, []);

  // Mirrors the crossfade rAF in useArchiveRadio. outGain / inGain are the
  // max gains for each side -- normally 1.0 for shows, INTERLUDE_GAIN for
  // an interlude clip so it sits quieter than the surrounding shows.
  const crossfade = (
    outgoing: HTMLAudioElement,
    incoming: HTMLAudioElement,
    onOutgoingVol: (v: number) => void,
    onIncomingVol: (v: number) => void,
    onDone: () => void,
    outGain = 1,
    inGain = 1,
  ) => {
    incoming.volume = 0;
    onIncomingVol(0);
    const p = incoming.play();
    if (p && typeof p.catch === 'function') p.catch((e) => append(`incoming.play() rejected: ${e}`));
    const startedAt = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - startedAt) / CROSSFADE_MS));
      // Equal-power crossfade curve scaled by each side's max gain.
      const outV = outGain * Math.sqrt(1 - p);
      const inV = inGain * Math.sqrt(p);
      outgoing.volume = outV;
      incoming.volume = inV;
      onOutgoingVol(outV);
      onIncomingVol(inV);
      if (p < 1) {
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
    append('user gesture: starting test');

    // Lazily create all three elements (same iOS attrs as useArchiveRadio).
    const mkAudio = (label: string) => {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.setAttribute('webkit-playsinline', '');
      a.addEventListener('error', () => append(`${label} error: ${a.error?.code} ${a.error?.message ?? ''}`));
      return a;
    };
    const A = audioARef.current ?? mkAudio('A');
    const I = audioIRef.current ?? mkAudio('I');
    const B = audioBRef.current ?? mkAudio('B');
    audioARef.current = A;
    audioIRef.current = I;
    audioBRef.current = B;

    // Reset volumes
    A.volume = 1;
    I.volume = 0;
    B.volume = 0;
    setAVol(1);
    setIVol(0);
    setBVol(0);

    // Load all three sources fresh so a re-run starts clean.
    A.src = ARCHIVE_A_URL;
    I.src = INTERLUDE_URL;
    B.src = ARCHIVE_B_URL;
    I.load();
    B.load();
    // Seek archive A to near the end so we don't wait through the whole show.
    const aSeekTarget = Math.max(0, ARCHIVE_A_DURATION_SEC - (A_PRE_SEC + CROSSFADE_MS / 1000) - 1);
    A.src = ARCHIVE_A_URL;
    A.load();
    await new Promise<void>((resolve) => {
      const onReady = () => { A.removeEventListener('loadedmetadata', onReady); resolve(); };
      A.addEventListener('loadedmetadata', onReady);
      setTimeout(() => { A.removeEventListener('loadedmetadata', onReady); resolve(); }, 5000);
    });
    try { A.currentTime = aSeekTarget; } catch (e) { append(`A seek failed: ${e}`); }
    append(`A seeked to ${aSeekTarget.toFixed(1)}s of ${ARCHIVE_A_DURATION_SEC}s`);

    // Play A
    setStage('playing-a');
    await A.play();
    append(`A playing -- will fade in ${A_PRE_SEC}s`);

    // Schedule fade A -> interlude. Interlude side ramps to INTERLUDE_FADE_GAIN
    // (ducked vs its alone-volume); A ramps from 1.0.
    const t1 = setTimeout(() => {
      setStage('fading-a-to-interlude');
      append('fade-start: A -> interlude');
      crossfade(A, I, setAVol, setIVol, () => {
        try { A.pause(); A.removeAttribute('src'); A.load(); } catch { /* noop */ }
        setAVol(0);
        // Snap interlude up from ducked fade-gain to its alone-volume.
        I.volume = INTERLUDE_GAIN;
        setIVol(INTERLUDE_GAIN);
        setStage('playing-interlude');
        setPreview('interlude');
        append(`interlude playing alone at ${(INTERLUDE_GAIN * 100).toFixed(0)}% (${INTERLUDE_DURATION_SEC}s total, fade-out in ${INTERLUDE_DURATION_SEC - CROSSFADE_MS / 1000}s) -- preview swapped to interlude`);
      }, 1, INTERLUDE_FADE_GAIN);
    }, A_PRE_SEC * 1000);
    timersRef.current.push(t1);

    // Schedule fade interlude -> B (CROSSFADE_MS before interlude ends).
    // Just before the fade starts, drop the interlude from alone-volume back
    // to the ducked fade-gain so it doesn't compete with B coming in.
    const interludeFadeStartMs = (A_PRE_SEC + INTERLUDE_DURATION_SEC) * 1000 - CROSSFADE_MS;
    const t2 = setTimeout(() => {
      setStage('fading-interlude-to-b');
      append('fade-start: interlude -> B');
      I.volume = INTERLUDE_FADE_GAIN;
      setIVol(INTERLUDE_FADE_GAIN);
      crossfade(I, B, setIVol, setBVol, () => {
        try { I.pause(); I.removeAttribute('src'); I.load(); } catch { /* noop */ }
        setIVol(0);
        setStage('playing-b');
        setPreview('archive-b');
        append('B playing -- test complete -- preview swapped to archive-b');
      }, INTERLUDE_FADE_GAIN, 1);
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
    audioIRef.current?.pause();
    audioBRef.current?.pause();
    setStage('done');
    append('stopped');
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Crossfade test</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Plays end of archive A, 5s crossfade, interlude, 5s crossfade, start of archive B. Local-only, no Firestore.
        </p>

        <div className="flex gap-3 mb-6">
          <button
            onClick={start}
            className="px-4 py-2 bg-white text-black font-bold hover:bg-zinc-200"
            disabled={stage !== 'idle' && stage !== 'done'}
          >
            Start test
          </button>
          <button
            onClick={stop}
            className="px-4 py-2 bg-zinc-800 text-white font-bold hover:bg-zinc-700"
            disabled={stage === 'idle' || stage === 'done'}
          >
            Stop
          </button>
        </div>

        <div className="mb-6">
          <div className="text-sm text-zinc-400 mb-1">Stage: <span className="text-white font-mono">{stage}</span></div>
          <VolumeBar label="archive A" vol={aVol} color="bg-blue-500" />
          <VolumeBar label="interlude" vol={iVol} color="bg-yellow-500" />
          <VolumeBar label="archive B" vol={bVol} color="bg-green-500" />
        </div>

        {/* Preview: production-matched UI. Swaps state at the same moment
            prod would (when the schedule's currentItem becomes the interlude
            -- i.e. at the end of the first crossfade). */}
        <div className="mb-6">
          <div className="text-sm text-zinc-400 mb-2">Preview (matches prod components):</div>
          <div className="border border-white/10">
            {/* Bar mock -- copy of GlobalBroadcastBar's interlude branch. */}
            {preview === 'interlude' ? (
              <InterludeBarPreview />
            ) : (
              <div className="bg-black border-b border-white/10 py-2 px-3 text-xs text-zinc-500">
                (normal archive bar -- not mounted in this test; verify in /broadcast)
              </div>
            )}
            {/* Hero mock -- uses the real exported InterludeSlide. */}
            {preview === 'interlude' ? (
              <InterludeSlide onPlay={() => append('preview hero tapped (no-op in test)')} />
            ) : (
              <div className="w-full aspect-[16/9] lg:aspect-[5/2] bg-zinc-900 flex items-center justify-center text-zinc-500 text-sm">
                (normal archive hero -- not mounted in this test; verify on /)
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
            <li>Interlude: {INTERLUDE_URL}</li>
            <li>Interlude duration: {INTERLUDE_DURATION_SEC}s</li>
            <li>Archive B: {ARCHIVE_B_URL}</li>
            <li>CROSSFADE_MS: {CROSSFADE_MS}</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

// Mirrors the interlude branch of GlobalBroadcastBar so the preview matches
// what users see. Static (no toggle, no live state) -- it's a preview.
function InterludeBarPreview() {
  return (
    <div className="z-[99] bg-black border-b border-white/10 overflow-hidden">
      <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
        <div className="flex items-center ml-1 flex-shrink-0">
          {/* Reserved 27x27 slot to keep layout from jumping vs scene-glyph archives. */}
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
        {/* Love/tip/profile intentionally hidden during interlude -- matches GlobalBroadcastBar. */}
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
