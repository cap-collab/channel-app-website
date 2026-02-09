'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { IRLShowData } from '@/types';

interface IRLShowCardProps {
  show: IRLShowData;
  isFollowing: boolean;
  isAddingFollow: boolean;
  onFollow: () => void;
  matchLabel?: string;
}

export function IRLShowCard({
  show,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
}: IRLShowCardProps) {
  const [imageError, setImageError] = useState(false);

  const hasPhoto = show.djPhotoUrl && !imageError;

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* Top row: IRL badge left, Date right */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
          </svg>
          IRL
        </span>
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter drop-shadow-lg">
          {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>
      {/* DJ Name and Location - bottom left */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {show.djName}
        </span>
        {show.djLocation && (
          <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
            {show.djLocation}
          </span>
        )}
      </div>
    </>
  );

  return (
    <div className="w-full group">
      {/* Match label row */}
      {matchLabel && (
        <div className="flex items-center mb-1 h-4 px-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        </div>
      )}
      {/* Full width image with overlays - links to DJ profile */}
      {show.djUsername ? (
        <Link href={`/dj/${show.djUsername}`} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
          {hasPhoto ? (
            <>
              <Image
                src={show.djPhotoUrl!}
                alt={show.djName}
                fill
                className="object-cover"
                unoptimized
                onError={() => setImageError(true)}
              />
              {imageOverlays}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900">
              <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
                {show.djName}
              </h2>
            </div>
          )}
        </Link>
      ) : (
        <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10">
          {hasPhoto ? (
            <>
              <Image
                src={show.djPhotoUrl!}
                alt={show.djName}
                fill
                className="object-cover"
                unoptimized
                onError={() => setImageError(true)}
              />
              {imageOverlays}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900">
              <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
                {show.djName}
              </h2>
            </div>
          )}
        </div>
      )}

      {/* Event Info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.eventName}
        </h3>
        <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
          in {show.location}
        </p>
        {show.djGenres && show.djGenres.length > 0 && (
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5 uppercase tracking-tighter">
            {show.djGenres.join(' · ')}
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 mt-auto">
        <div className="flex gap-2">
          {/* Follow/Unfollow Button */}
          <button
            onClick={onFollow}
            disabled={isAddingFollow}
            className={`flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors ${
              isFollowing
                ? 'bg-white/10 hover:bg-white/20 text-white'
                : 'bg-white hover:bg-gray-100 text-gray-900'
            } disabled:opacity-50`}
          >
            {isAddingFollow ? (
              <div className={`w-4 h-4 border-2 ${isFollowing ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin mx-auto`} />
            ) : isFollowing ? (
              'Following'
            ) : (
              '+ Follow'
            )}
          </button>

          {/* Tickets Button */}
          <a
            href={show.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-2"
          >
            Tickets
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

      </div>
    </div>
  );
}
