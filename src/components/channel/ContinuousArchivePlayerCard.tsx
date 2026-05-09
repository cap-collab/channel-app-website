'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { ScheduleItem } from '@/types/broadcast';

interface Props {
  currentItem: ScheduleItem | null;
}

// Image-only slide for the continuous archive radio. Looks just like a
// regular HeroSlide so the carousel doesn't double up on player chrome —
// playback controls live in the parent ArchiveHero's player bar.
export function ContinuousArchiveSlide({ currentItem }: Props) {
  const [imgError, setImgError] = useState(false);
  const djName = currentItem?.djs?.map((d) => d.name).join(', ') || '';
  const photoUrl = currentItem?.artworkUrl || currentItem?.djs?.[0]?.photoUrl;
  const hasPhoto = Boolean(photoUrl) && !imgError;
  const showName = currentItem?.title || 'Archive radio';

  return (
    <div className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10 flex-shrink-0">
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
          <div className="absolute top-2 left-2 drop-shadow-lg">
            <span className="text-sm font-bold text-white uppercase tracking-wide">
              {showName}
            </span>
          </div>
          {/* Restream-style indicator — circular arrow + "Restream" label,
              same treatment as on the existing live/restream hero. */}
          <div className="absolute top-2 right-2 flex items-center gap-1.5 drop-shadow-lg">
            <svg
              className="w-3 h-3 text-zinc-300 animate-pulse"
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
            <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-200">
              Restream
            </span>
          </div>
        </>
      ) : (
        <div className="w-full h-full relative flex items-center justify-center bg-white/5">
          <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4 text-white">
            {djName || showName}
          </h2>
          {/* Same restream pill so the indicator survives even when the photo
              isn't available yet. */}
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <svg
              className="w-3 h-3 text-zinc-300 animate-pulse"
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
            <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-300">
              Restream
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
