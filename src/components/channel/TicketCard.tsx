'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getStationLogoUrl } from '@/lib/stations';

interface TicketCardProps {
  show: Show;
  station: Station;
  isAuthenticated: boolean;
  isFollowing: boolean;
  isShowFavorited: boolean;
  isAddingFollow: boolean;
  isAddingReminder: boolean;
  onFollow: () => void;
  onRemindMe: () => void;
  matchLabel?: string;
}

export function TicketCard({
  show,
  station,
  isFollowing,
  isShowFavorited,
  isAddingFollow,
  isAddingReminder,
  onFollow,
  onRemindMe,
  matchLabel,
}: TicketCardProps) {
  const [imageError, setImageError] = useState(false);

  const djName = show.dj || show.name;
  const photoUrl = show.djPhotoUrl || show.imageUrl;
  const hasPhoto = photoUrl && !imageError;
  const stationLogo = getStationLogoUrl(station.id);

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* Top row: Online badge left, Date right */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
          </svg>
          Online
        </span>
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter drop-shadow-lg">
          {new Date(show.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(show.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      {/* DJ Name and Location - bottom left */}
      <div className="absolute bottom-2 left-2 right-12">
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
      {/* Match label row */}
      {matchLabel && (
        <div className="flex items-center mb-1 h-4 px-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        </div>
      )}
      {/* Full width image with overlays - links to DJ profile if available */}
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
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
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
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
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
        <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
          Selected by {station.name}
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

          {/* Remind Me Button */}
          <button
            onClick={onRemindMe}
            disabled={isAddingReminder || isShowFavorited}
            className={`flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors ${
              isShowFavorited
                ? 'bg-white/10 text-gray-400 cursor-default'
                : 'bg-white/10 hover:bg-white/20 text-white'
            } disabled:opacity-50`}
          >
            {isAddingReminder ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
            ) : isShowFavorited ? (
              'Reminded'
            ) : (
              'Remind Me'
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
