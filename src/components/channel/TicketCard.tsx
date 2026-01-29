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

function formatTicketDate(isoTime: string): { date: string; time: string } {
  const dateObj = new Date(isoTime);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = dateObj.toDateString() === now.toDateString();
  const isTomorrow = dateObj.toDateString() === tomorrow.toDateString();

  let dateStr: string;
  if (isToday) {
    dateStr = 'TODAY';
  } else if (isTomorrow) {
    dateStr = 'TOMORROW';
  } else {
    dateStr = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }).toUpperCase();
  }

  const timeStr = dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return { date: dateStr, time: timeStr };
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
  const { date, time } = formatTicketDate(show.startTime);

  return (
    <div className="w-full group">
      {/* Genre tags (left) and Date/Time (right) above image */}
      <div className="flex justify-between items-center mb-1 h-4">
        {show.djGenres && show.djGenres.length > 0 ? (
          <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter truncate">
            {show.djGenres.slice(0, 2).join(' · ')}
          </div>
        ) : (
          <div />
        )}
        <div className="text-[10px] font-mono text-zinc-400">
          {date} {time}
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
              {/* Gradient scrim - top left corner */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              {/* DJ Name Overlay on top-left */}
              <div className="absolute top-2 left-2 right-2">
                <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                  {djName}
                </span>
              </div>
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
              {/* Gradient scrim - top left corner */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              {/* DJ Name Overlay on top-left */}
              <div className="absolute top-2 left-2 right-2">
                <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                  {djName}
                </span>
              </div>
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
