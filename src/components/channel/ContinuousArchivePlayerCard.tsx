'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useArchiveRadio } from '@/hooks/useArchiveRadio';
import { ScrollingShowName, ScrollingDJName } from './LiveBroadcastHero';

interface Props {
  active: boolean;
  // Optional: parent can listen for play to pause its own audio sources.
  onPlayStarted?: () => void;
}

// Header strip above the image — mirrors the restream indicator pattern from
// ArchiveHero (circular-arrow icon + uppercase label, zinc-400, animate-pulse).
function ArchiveRadioIndicator() {
  return (
    <div className="flex items-center justify-end gap-1.5 px-2 py-2 min-h-[28px]">
      <svg
        className="w-3 h-3 text-zinc-400 animate-pulse"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-400">
        Archive radio
      </span>
    </div>
  );
}

export function ContinuousArchivePlayerCard({ active, onPlayStarted }: Props) {
  const radio = useArchiveRadio({ active });
  const [imgError, setImgError] = useState(false);

  const item = radio.currentItem;
  const next = radio.nextItem;
  const djName = item?.djs?.map((d) => d.name).join(', ') || '';
  const photoUrl = item?.artworkUrl || item?.djs?.[0]?.photoUrl;
  const hasPhoto = Boolean(photoUrl) && !imgError;
  const showName = item?.title || (radio.ready ? 'No archive scheduled' : 'Loading…');

  const handleToggle = async () => {
    const wasPlaying = radio.isPlaying;
    await radio.toggle();
    if (!wasPlaying && onPlayStarted) onPlayStarted();
  };

  return (
    <div className="w-full">
      {/* Restream-style header strip above the image */}
      <ArchiveRadioIndicator />

      {/* Hero image — same dims as a regular slide */}
      <div className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10">
        {hasPhoto && photoUrl ? (
          <>
            <Image
              src={photoUrl}
              alt={djName || 'Archive radio'}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
              priority
              onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
            {/* Show name — top left, matching HeroSlide */}
            <div className="absolute top-2 left-2 drop-shadow-lg">
              <span className="text-sm font-bold text-white uppercase tracking-wide">
                {showName}
              </span>
            </div>
          </>
        ) : (
          <div className="w-full h-full relative flex items-center justify-center bg-white/5">
            <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4 text-white">
              {djName || showName}
            </h2>
          </div>
        )}
      </div>

      {/* Player bar — visually matches the live/archive player bar */}
      <div className="bg-black relative">
        <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
          <button
            onClick={handleToggle}
            className="w-8 h-8 ml-1 flex items-center justify-center transition-colors flex-shrink-0"
            aria-label={radio.isPlaying ? 'Pause' : 'Play'}
          >
            {radio.isLoading ? (
              <svg className="w-5 h-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : radio.isPlaying ? (
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <ScrollingShowName text={showName} className="text-sm font-bold leading-tight text-white" />
            {djName && (
              <ScrollingDJName text={djName} className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]" />
            )}
            {next && (
              <div className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em] truncate">
                Up next: {next.title || (next.kind === 'interstitial' ? 'Station ident' : 'Archive')}
                {next.djs?.length ? ` · ${next.djs.map((d) => d.name).join(', ')}` : ''}
              </div>
            )}
          </div>

          {/* Restream-style indicator — same icon as the header, kept here to
              mirror the live/restream player bar's right-side indicator. */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <svg className="w-3 h-3 text-zinc-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </div>
        </div>

        {radio.error && (
          <p className="text-red-400 text-xs pb-2 px-2">{radio.error}</p>
        )}

        {/* Item progress bar — analogous to ShowProgressBar but for the
            currently playing archive (always reserves the same vertical space
            so layout doesn't jitter between items). */}
        {item && radio.itemDurationSec > 0 ? (
          <div className="relative w-full h-[3px] bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-white"
              style={{ width: `${Math.min(100, (radio.itemSeekSec / radio.itemDurationSec) * 100)}%` }}
            />
          </div>
        ) : (
          <div className="relative w-full h-[3px] bg-white/10" />
        )}
      </div>
    </div>
  );
}
