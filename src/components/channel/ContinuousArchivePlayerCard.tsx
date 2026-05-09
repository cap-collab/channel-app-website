'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useArchiveRadio } from '@/hooks/useArchiveRadio';

interface Props {
  active: boolean;
  // Optional: parent can listen for play to pause its own audio sources.
  onPlayStarted?: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ContinuousArchivePlayerCard({ active, onPlayStarted }: Props) {
  const radio = useArchiveRadio({ active });
  const [imgError, setImgError] = useState(false);

  const item = radio.currentItem;
  const next = radio.nextItem;
  const djName = item?.djs?.map((d) => d.name).join(', ') || '';
  const photoUrl = item?.artworkUrl || item?.djs?.[0]?.photoUrl;
  const hasPhoto = Boolean(photoUrl) && !imgError;

  const handleToggle = async () => {
    const wasPlaying = radio.isPlaying;
    await radio.toggle();
    if (!wasPlaying && onPlayStarted) onPlayStarted();
  };

  return (
    <div className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10 flex-shrink-0 text-left">
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
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/85" />
        </>
      ) : (
        <div className="w-full h-full absolute inset-0 bg-gradient-to-br from-zinc-800 to-black" />
      )}

      {/* Top-left badge: ARCHIVE RADIO so it's distinct from a single-archive card */}
      <div className="absolute top-2 left-2 drop-shadow-lg flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/90 px-2 py-0.5 border border-white/30 rounded-full">
          Archive radio
        </span>
        {item?.title && (
          <span className="text-sm font-bold text-white uppercase tracking-wide">{item.title}</span>
        )}
      </div>

      {/* Bottom block: play/pause + DJ + up-next + progress */}
      <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 text-white">
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            disabled={!radio.ready && !radio.error}
            className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-white text-black hover:bg-white/90 transition-colors flex-shrink-0 disabled:opacity-50"
            aria-label={radio.isPlaying ? 'Pause' : 'Play'}
          >
            {radio.isLoading ? (
              <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : radio.isPlaying ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 4.5v15a1 1 0 0 0 1.55.84l11.5-7.5a1 1 0 0 0 0-1.68l-11.5-7.5A1 1 0 0 0 7 4.5z" />
              </svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-base sm:text-lg font-semibold truncate">
              {item?.title || (radio.ready ? 'No archive scheduled' : 'Loading…')}
            </div>
            <div className="text-xs sm:text-sm text-white/80 truncate">
              {djName || (radio.ready ? '—' : '')}
            </div>
            {next && (
              <div className="text-[11px] sm:text-xs text-white/60 truncate mt-0.5">
                Up next: {next.title || (next.kind === 'interstitial' ? 'Station ident' : 'Archive')}
                {next.djs?.length ? ` — ${next.djs.map((d) => d.name).join(', ')}` : ''}
              </div>
            )}
          </div>
          {item && radio.itemDurationSec > 0 && (
            <div className="text-[10px] sm:text-xs text-white/70 tabular-nums flex-shrink-0">
              {formatTime(radio.itemSeekSec)} / {formatTime(radio.itemDurationSec)}
            </div>
          )}
        </div>
        {item && radio.itemDurationSec > 0 && (
          <div className="mt-2 h-[3px] w-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-white"
              style={{ width: `${Math.min(100, (radio.itemSeekSec / radio.itemDurationSec) * 100)}%` }}
            />
          </div>
        )}
        {radio.error && (
          <div className="mt-2 text-xs text-red-300/90">{radio.error}</div>
        )}
      </div>
    </div>
  );
}
