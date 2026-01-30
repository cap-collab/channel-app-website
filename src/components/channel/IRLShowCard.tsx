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
}

function formatIRLDate(isoDate: string): string {
  const dateObj = new Date(isoDate + 'T00:00:00'); // Parse as local date
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = dateObj.toDateString() === now.toDateString();
  const isTomorrow = dateObj.toDateString() === tomorrow.toDateString();

  if (isToday) {
    return 'TODAY';
  } else if (isTomorrow) {
    return 'TOMORROW';
  } else {
    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }).toUpperCase();
  }
}

export function IRLShowCard({
  show,
  isFollowing,
  isAddingFollow,
  onFollow,
}: IRLShowCardProps) {
  const [imageError, setImageError] = useState(false);

  const hasPhoto = show.djPhotoUrl && !imageError;
  const dateStr = formatIRLDate(show.date);

  return (
    <div className="w-full group">
      {/* Date (left) and IRL Event badge (right) above image */}
      <div className="flex justify-between items-center mb-1 h-4">
        <div className="text-[10px] font-mono text-zinc-400">
          {dateStr}
        </div>
        <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
          IRL Event
        </div>
      </div>

      {/* Full width image with DJ overlay - links to DJ profile */}
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
              {/* Gradient scrims - top left and bottom left corners */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              {/* DJ Name Overlay on top-left */}
              <div className="absolute top-2 left-2 right-2">
                <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                  {show.djName}
                </span>
              </div>
              {/* Genre tags on bottom-left */}
              {show.djGenres && show.djGenres.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter drop-shadow-lg">
                    {show.djGenres.slice(0, 2).join(' · ')}
                  </span>
                </div>
              )}
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
              {/* Gradient scrims - top left and bottom left corners */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              {/* DJ Name Overlay on top-left */}
              <div className="absolute top-2 left-2 right-2">
                <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                  {show.djName}
                </span>
              </div>
              {/* Genre tags on bottom-left */}
              {show.djGenres && show.djGenres.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter drop-shadow-lg">
                    {show.djGenres.slice(0, 2).join(' · ')}
                  </span>
                </div>
              )}
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
      <div className="h-14 flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.eventName}
        </h3>
        <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
          in {show.location}
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

          {/* Tickets Button */}
          <a
            href={show.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-2"
          >
            Tickets
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        {/* Helper text */}
        {!isFollowing && (
          <p className="text-gray-500 text-xs text-center">Follow to get live alerts</p>
        )}
      </div>
    </div>
  );
}
