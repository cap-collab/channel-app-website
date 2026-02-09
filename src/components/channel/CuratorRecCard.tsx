'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { CuratorRec } from '@/types';

interface CuratorRecCardProps {
  rec: CuratorRec;
  matchLabel?: string;
}

export function CuratorRecCard({ rec, matchLabel }: CuratorRecCardProps) {
  const [imageError, setImageError] = useState(false);

  const cleanUrl = rec.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const hasPhoto = rec.djPhotoUrl && !imageError;

  return (
    <div className="w-full group">
      {matchLabel && (
        <div className="flex items-center mb-1 h-4 px-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        </div>
      )}
      <a
        href={rec.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10"
      >
        {hasPhoto ? (
          <>
            <Image
              src={rec.djPhotoUrl!}
              alt={rec.djName}
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900" />
        )}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {rec.type === 'bandcamp' ? 'Music' : 'Event'}
          </span>
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
            {rec.djName}
          </span>
        </div>
      </a>

      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          <a href={rec.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {cleanUrl}
          </a>
        </h3>
        <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
          Rec&apos;d by{' '}
          <Link href={`/dj/${rec.djUsername}`} className="hover:underline">
            {rec.djName}
          </Link>
        </p>
      </div>
    </div>
  );
}
