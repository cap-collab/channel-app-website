'use client';

import { useMemo, useRef, useState } from 'react';
import { FieldNoteCaption } from '@/types/field-notes';

interface Props {
  src: string;                 // audio OR video URL — we only play the audio track
  createdAt: number;           // unix ms
  name?: string | null;        // admin-given tape name, shown in the header
  captions?: FieldNoteCaption[] | null;  // line-by-line captions, synced to playback
  waveform?: number[] | null;  // 160 loudness values 0..1 for the player bar (older tapes may have 80)
  upvotes: number;
  downvotes: number;
  myVote: 1 | -1 | 0;
  onVote: (value: 1 | -1) => void;   // parent handles auth + API + optimistic state
  onReply: () => void;               // parent opens the voice-reply capture
  onReached?: () => void;            // fired once when playback passes the 7s mark
}

// A tape counts as "played through" once the listener streams past this mark.
const REACHED_THRESHOLD_SEC = 7;

function fmtClock(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// "Tape Archive" style card (mirrors the DJ-profile recording card): transparent
// body with the tape's name + a line-style seek player. Self-contained local
// <audio> so it plays the audio track of an audio OR video file.
export function FieldNoteAudioPlayer({ src, name, captions, waveform, upvotes, downvotes, myVote, onVote, onReply, onReached }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const reachedFiredRef = useRef(false);   // fire the play-through count at most once
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Waveform bars for the player line. Use the real per-tape loudness when
  // present; else a stable pseudo-random shape derived from the src so the bar
  // still looks like a waveform (never flat) before a real one is computed.
  const bars = useMemo<number[]>(() => {
    if (waveform && waveform.length > 0) return waveform;
    const N = 160;
    let seed = 0;
    for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    return Array.from({ length: N }, () => 0.25 + rand() * 0.7);
  }, [waveform, src]);

  // The caption line active at the current playback position (film-subtitle
  // style, one at a time). Only shown while playing so an idle card stays clean.
  const activeCaption = useMemo(() => {
    if (!captions || captions.length === 0) return null;
    return captions.find((c) => currentTime >= c.from && currentTime < c.to) ?? null;
  }, [captions, currentTime]);

  const onTime = (t: number) => {
    setCurrentTime(t);
    if (!reachedFiredRef.current && t >= REACHED_THRESHOLD_SEC) {
      reachedFiredRef.current = true;
      onReached?.();
    }
  };

  const onPlayPause = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.pause();
    else a.play().catch(() => {});
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a) return;
    const t = parseFloat(e.target.value);
    a.currentTime = t;
    setCurrentTime(t);
  };

  const pct = Math.min(100, (currentTime / (duration || 100)) * 100);

  // While a caption is showing, it takes over the header slot — the title is
  // hidden so the card reads as the spoken line, centered and quoted.
  const showingCaption = isPlaying && !!activeCaption;

  return (
    <div className="border border-[#333] rounded-none overflow-hidden" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      {/* Body: the tape's name, a small lowercase label above the player line.
          Hidden while a caption is showing (the caption replaces it). */}
      {name && !showingCaption && (
        <div className="px-3 pt-2 pb-0.5">
          <p className="text-sm font-normal italic text-white/90 text-center lowercase">“{name}”</p>
        </div>
      )}

      {/* Captions: the active line, subtitle-style, synced to playback. Only
          rendered while playing and a cue is active — keeps an idle card clean.
          Centered, italic, and quoted; replaces the title while playing. */}
      {showingCaption && (
        <div className="px-3 pt-2 pb-0.5">
          <p className="text-sm leading-snug italic text-white/90 text-center">
            “{activeCaption.text}”
          </p>
        </div>
      )}

      {/* Player: line seek bar on the transparent body */}
      <div className="px-3 pb-2 pt-2">
        <div className="flex items-center">
          <button
            onClick={onPlayPause}
            className="w-6 h-6 flex items-center justify-center transition-colors flex-shrink-0 text-white"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 3h4v18H6V3zm8 0h4v18h-4V3z" /></svg>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M5 3v18l15-9z" /></svg>
            )}
          </button>
          {/* Waveform: vertical bars, height from loudness. Bars left of the
              playhead are white (played), the rest grey. The invisible range
              input rides on top so seeking still works. */}
          <div className="relative flex-1 min-w-0 h-6 flex items-center gap-px">
            {bars.map((h, i) => {
              const played = (i + 0.5) / bars.length <= pct / 100;
              // Slight per-bar jitter (deterministic on index) for a rough,
              // hand-made look; clamp so every bar stays visible.
              const jitter = ((i * 37) % 11) / 100 - 0.05;
              const height = Math.max(0.12, Math.min(1, h + jitter));
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-[1px] ${played ? 'bg-white' : 'bg-zinc-700'}`}
                  style={{ height: `${height * 100}%` }}
                />
              );
            })}
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={onSeek}
              className="absolute inset-0 w-full h-full appearance-none cursor-pointer bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-transparent [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:h-0 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent"
            />
          </div>
        </div>
        <div className="mt-1 pl-6 flex justify-between font-mono text-[10px] text-zinc-500 leading-none">
          <span>{fmtClock(currentTime)}</span>
          <span>{fmtClock(duration)}</span>
        </div>
      </div>

      {/* Action bar: full black — votes left, voice reply right */}
      <div className="flex items-center justify-between px-3 py-2 bg-black border-t border-[#333]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onVote(1)}
            aria-label="Upvote"
            className={`flex items-center gap-1 px-1.5 py-0.5 font-mono text-xs transition-colors ${myVote === 1 ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <svg className="w-4 h-4" fill={myVote === 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0-14 6 6m-6-6-6 6" />
            </svg>
            {upvotes}
          </button>
          <button
            onClick={() => onVote(-1)}
            aria-label="Downvote"
            className={`flex items-center gap-1 px-1.5 py-0.5 font-mono text-xs transition-colors ${myVote === -1 ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <svg className="w-4 h-4" fill={myVote === -1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 14 6-6m-6 6-6-6" />
            </svg>
            {downvotes}
          </button>
        </div>
        <button
          onClick={onReply}
          className="flex items-center gap-1.5 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
          </svg>
          Voice reply
        </button>
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
      />
    </div>
  );
}
