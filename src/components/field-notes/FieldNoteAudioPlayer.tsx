'use client';

import { useRef, useState } from 'react';

interface Props {
  src: string;      // audio OR video URL — we only play the audio track
  dateLabel: string;
}

// Self-contained audio player styled like the archive recording player card
// (play/pause circle + seek bar + time). Uses a local <audio> so it plays the
// audio track of any file (audio or video) across mobile + desktop browsers.
export function FieldNoteAudioPlayer({ src, dateLabel }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.pause();
    else a.play().catch(() => {});
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a) return;
    const t = Number(e.target.value);
    a.currentTime = t;
    setCurrentTime(t);
  };

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-10 h-10 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-500 text-xs tabular-nums">
              {fmtTime(currentTime)}{duration ? ` / ${fmtTime(duration)}` : ''}
            </span>
            <span className="text-zinc-500 text-[10px]">{dateLabel}</span>
          </div>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={onSeek}
            className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer mt-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
        </div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
    </div>
  );
}

function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
