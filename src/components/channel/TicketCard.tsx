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
      {/* Genre Tag */}
      <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-2">
        #{station.name.replace(/\s+/g, '')}
      </div>

      {/* Full width image with DJ overlay */}
      <div className="relative w-full aspect-[16/9] mb-3 overflow-hidden border border-white/10">
        {hasPhoto ? (
          <Image
            src={photoUrl}
            alt={djName}
            fill
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
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
        {/* Gradient scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {/* DJ Name Overlay */}
        <div className="absolute bottom-2 left-2">
          <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg">
            {djName}
          </span>
        </div>
        {/* Scheduled time badge */}
        <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded">
          <span className="text-[10px] font-mono text-white uppercase">
            {date} {time}
          </span>
        </div>
      </div>

      {/* Show Info */}
      <div className="mb-3">
        <h3 className="text-sm sm:text-base font-bold leading-tight line-clamp-2 group-hover:text-blue-400 transition">
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
          className="text-[10px] text-zinc-500 flex items-center gap-1 mt-1 uppercase hover:text-zinc-300 transition"
        >
          on {station.name}
          <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2">
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
