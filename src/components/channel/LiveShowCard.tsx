'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getContrastTextColor } from '@/lib/colorUtils';
import { getStationLogoUrl } from '@/lib/stations';

interface LiveShowCardProps {
  show: Show;
  station: Station;
  isFollowing: boolean;
  isAddingFollow: boolean;
  onFollow: () => void;
  matchLabel?: string;
}

export function LiveShowCard({
  show,
  station,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
}: LiveShowCardProps) {
  const [imageError, setImageError] = useState(false);
  const photoUrl = show.djPhotoUrl;
  const hasPhoto = photoUrl && !imageError;
  const djName = show.dj || show.name;
  const textColor = hasPhoto ? '#ffffff' : getContrastTextColor(station.accentColor);
  const stationLogo = getStationLogoUrl(station.id);

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* DJ Name and Location - bottom left */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {djName}
        </span>
        {show.djLocation && (
          <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
            {show.djLocation}
          </span>
        )}
      </div>
    </>
  );

  const stationLogoOverlay = stationLogo ? (
    <div className="absolute -bottom-4 right-3 w-8 h-8 rounded border border-white/30 overflow-hidden bg-black z-10">
      <Image
        src={stationLogo}
        alt={station.name}
        fill
        className="object-contain"
      />
    </div>
  ) : null;

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Match label on left, Live indicator on right */}
      <div className="flex items-center justify-between mb-1 h-4 px-0.5">
        {matchLabel ? (
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">{matchLabel}</span>
        ) : <div />}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
          </span>
          <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold">Live</span>
        </div>
      </div>

      {/* Full width 16:9 image with overlays */}
      <div className="relative">
        {show.djUsername ? (
          <Link href={`/dj/${show.djUsername}`} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={photoUrl}
                  alt={djName}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                {imageOverlays}
              </>
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: station.accentColor }}
              >
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4" style={{ color: textColor }}>
                  {djName}
                </h2>
              </div>
            )}
          </Link>
        ) : (
          <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={photoUrl}
                  alt={djName}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                {imageOverlays}
              </>
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: station.accentColor }}
              >
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4" style={{ color: textColor }}>
                  {djName}
                </h2>
              </div>
            )}
          </div>
        )}
        {stationLogoOverlay}
      </div>

      {/* Show Info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">
              {show.name}
            </Link>
          ) : (
            show.name
          )}
        </h3>
        <a
          href={station.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5 uppercase hover:text-zinc-300 transition"
        >
          at {station.name}
          <svg className="w-2 h-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        {show.djGenres && show.djGenres.length > 0 && (
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5 uppercase tracking-tighter">
            {show.djGenres.join(' · ')}
          </p>
        )}
      </div>

      {/* CTA Buttons */}
      <div className="space-y-2 mt-auto">
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onFollow(); }}
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
          <a
            href={station.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 px-4 rounded text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-1"
          >
            Join
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
