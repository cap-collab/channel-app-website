'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';

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
}: TicketCardProps) {
  const [imageError, setImageError] = useState(false);

  const djName = show.dj || show.name;
  const photoUrl = show.djPhotoUrl || show.imageUrl;
  const hasPhoto = photoUrl && !imageError;

  return (
    <div className="w-full group">
      {/* Online badge centered above image */}
      <div className="flex justify-center items-center mb-1 h-4">
        <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          Online
        </div>
      </div>

      {/* Full width image with DJ overlay - links to DJ profile if available */}
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
              {/* Gradient scrims - top left and bottom left corners */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              {/* DJ Name and Location Overlay on top-left */}
              <div className="absolute top-2 left-2 right-2">
                <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                  {djName}
                </span>
                {show.djLocation && (
                  <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
                    {show.djLocation}
                  </span>
                )}
              </div>
              {/* Genre tags on bottom-left */}
              {show.djGenres && show.djGenres.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter drop-shadow-lg">
                    {show.djGenres.join(' · ')}
                  </span>
                </div>
              )}
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
              {/* Gradient scrims - top left and bottom left corners */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              {/* DJ Name and Location Overlay on top-left */}
              <div className="absolute top-2 left-2 right-2">
                <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                  {djName}
                </span>
                {show.djLocation && (
                  <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
                    {show.djLocation}
                  </span>
                )}
              </div>
              {/* Genre tags on bottom-left */}
              {show.djGenres && show.djGenres.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter drop-shadow-lg">
                    {show.djGenres.join(' · ')}
                  </span>
                </div>
              )}
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

      {/* Show Info */}
      <div className="h-14 flex flex-col justify-start py-2">
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
          on {station.name}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 mt-auto">
        <div className="flex gap-2">
          {/* Follow/Unfollow Button */}
          <button
            onClick={onFollow}
            disabled={isAddingFollow}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${
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
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${
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

        {/* Helper text */}
        {!isFollowing && (
          <p className="text-gray-500 text-xs text-center">Follow to get live alerts</p>
        )}
      </div>
    </div>
  );
}
