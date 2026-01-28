'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getContrastTextColor } from '@/lib/colorUtils';

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

  // For no-photo variant, use station color with contrast text
  const textColor = hasPhoto ? '#ffffff' : getContrastTextColor(station.accentColor);

  return (
    <div className="bg-surface-card rounded-xl overflow-hidden border border-white/5">
      {/* Ticket Header: Date + Time */}
      <div className="flex border-b border-white/10">
        <div className="flex-1 py-3 px-4 border-r border-white/10 bg-white/5">
          <span className="text-white text-sm font-bold tracking-wide">
            {date}
          </span>
        </div>
        <div className="flex-1 py-3 px-4 bg-white/5">
          <span className="text-white text-sm font-bold">
            {time}
          </span>
        </div>
      </div>

      {/* Photo / Graphic Area */}
      {hasPhoto ? (
        <div className="relative aspect-square">
          <Image
            src={photoUrl}
            alt={djName}
            fill
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
        </div>
      ) : (
        <div
          className="relative aspect-square flex items-center justify-center"
          style={{ backgroundColor: station.accentColor }}
        >
          <div
            className="text-center px-4"
            style={{ color: textColor }}
          >
            <h2 className="text-4xl font-black uppercase tracking-tight leading-none">
              {djName}
            </h2>
          </div>
        </div>
      )}

      {/* DJ Info */}
      <div className="p-4 space-y-1">
        <h3 className="text-white text-xl font-bold">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">
              {djName}
            </Link>
          ) : (
            djName
          )}
        </h3>
        <p
          className="text-sm"
          style={{ color: station.accentColor }}
        >
          on {station.name}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="px-4 pb-4 space-y-2">
        <div className="flex gap-2">
          {/* Follow Button */}
          <button
            onClick={onFollow}
            disabled={isAddingFollow || isFollowing}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${
              isFollowing
                ? 'bg-white/10 text-gray-400 cursor-default'
                : 'bg-white hover:bg-gray-100 text-gray-900'
            } disabled:opacity-50`}
          >
            {isAddingFollow ? (
              <div className="w-4 h-4 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto" />
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
