'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldNoteCaption } from '@/types/field-notes';

interface Props {
  // Loudness waveform (160 values 0..1; older tapes 80). When absent, a stable
  // pseudo-random shape derived from `seed` is used so the bar still reads as a
  // waveform (never flat) before a real one is backfilled.
  waveform?: number[] | null;
  // Line-by-line captions synced to playback, denormalized from the interlude's
  // matching tape. Absent until backfilled → no subtitle shown.
  captions?: FieldNoteCaption[] | null;
  // Elapsed within the current interlude (seconds) and its total duration, from
  // the archive-radio hook. Arrives at ~1 Hz; we interpolate between ticks so
  // the fill advances one bar at a time rather than jumping ~5 bars per second.
  itemSeekSec: number;
  itemDurationSec: number;
  isPlaying: boolean;
  // Stable string (interstitialId / recordingUrl) seeding the fallback shape.
  seed?: string;
}

// Overlay painted ON the interlude hero image: a static loudness waveform whose
// bars fill white left-of-playhead / grey right (advancing with radio playback),
// plus a film-subtitle-style caption line below the bars. Non-interactive — it
// lives inside the slide's <button>, so the whole thing is pointer-events-none
// and the tap falls through to the slide's play/pause. Mirrors the /tape
// FieldNoteAudioPlayer look (bars + captions), driven by the schedule's
// itemSeekSec. Occupies the same box as the DancingBars it replaces.
export function InterludeWaveform({
  waveform,
  captions,
  itemSeekSec,
  itemDurationSec,
  isPlaying,
  seed = 'interlude',
}: Props) {
  // Real per-interlude loudness when present; else a stable pseudo-random shape
  // seeded off `seed` (same fallback as FieldNoteAudioPlayer).
  const bars = useMemo<number[]>(() => {
    if (waveform && waveform.length > 0) return waveform;
    const N = 160;
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    return Array.from({ length: N }, () => 0.25 + rand() * 0.7);
  }, [waveform, seed]);

  // itemSeekSec ticks at 1 Hz, but with ~160 bars over a short clip that's ~5
  // bars per jump. Interpolate: on each new seek value, note the wall-clock
  // anchor, then tick locally at one-bar cadence (barCount/duration Hz) and
  // extrapolate elapsed = seek + (now - anchor). Clamped to the next whole
  // second so we never run ahead of the real playhead. This is a display-only
  // smoothing of a value we already have — no audio access, no rAF.
  const anchorRef = useRef({ seek: itemSeekSec, at: 0 });
  const [displaySec, setDisplaySec] = useState(itemSeekSec);
  useEffect(() => {
    anchorRef.current = { seek: itemSeekSec, at: performance.now() };
    setDisplaySec(itemSeekSec);
  }, [itemSeekSec]);
  useEffect(() => {
    if (!isPlaying) { setDisplaySec(itemSeekSec); return; }
    const barCount = bars.length || 160;
    // One tick per bar: barCount/duration bars per second → interval per bar.
    const perBarMs = Math.max(60, ((itemDurationSec || 30) / barCount) * 1000);
    const id = setInterval(() => {
      const { seek, at } = anchorRef.current;
      const extrapolated = seek + (performance.now() - at) / 1000;
      // Don't overshoot the next 1 Hz tick (seek+1) — stay ≤ the real playhead.
      setDisplaySec(Math.min(extrapolated, seek + 1));
    }, perBarMs);
    return () => clearInterval(id);
  }, [isPlaying, itemSeekSec, itemDurationSec, bars.length]);

  const pct = Math.min(100, (displaySec / (itemDurationSec || 1)) * 100);

  // The caption line active at the current position (one at a time). Only shown
  // while playing so a paused/idle slide stays clean. Uses displaySec too so it
  // swaps at the smoothed playhead.
  const activeCaption = useMemo(() => {
    if (!captions || captions.length === 0) return null;
    return captions.find((c) => displaySec >= c.from && displaySec < c.to) ?? null;
  }, [captions, displaySec]);
  const showingCaption = isPlaying && !!activeCaption;

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Bar row — same box + geometry as DancingBars so layout doesn't shift. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 bottom-[40%] w-4/5 h-[46px] lg:h-[64px] flex items-center gap-px"
      >
        {bars.map((h, i) => {
          const played = (i + 0.5) / bars.length <= pct / 100;
          // Slight deterministic per-bar jitter for a rough, hand-made look;
          // clamp so every bar stays visible.
          const jitter = ((i * 37) % 11) / 100 - 0.05;
          const height = Math.max(0.12, Math.min(1, h + jitter));
          return (
            <div
              key={i}
              className={`flex-1 rounded-[1px] ${played ? 'bg-white' : 'bg-white/25'}`}
              style={{ height: `${height * 100}%` }}
            />
          );
        })}
      </div>

      {/* Subtitle line — horizontally centered, and vertically centered in the
          band between the bars (their bottom sits at 40% of the image height)
          and the bottom edge. The band is the lower 40% of the image; a flex
          container over exactly that band centers the text in it. */}
      {showingCaption && (
        <div className="absolute inset-x-0 bottom-0 h-[40%] flex items-center justify-center px-4 drop-shadow-lg">
          <p className="text-sm leading-snug italic text-white/90 text-center max-w-[80%]">“{activeCaption.text}”</p>
        </div>
      )}
    </div>
  );
}
