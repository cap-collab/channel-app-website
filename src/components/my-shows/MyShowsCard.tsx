'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface MyShowsCardProps {
  // Common props
  showType: 'online' | 'irl';
  djName: string;
  djPhotoUrl?: string;
  djUsername?: string;
  accentColor: string;
  isLive?: boolean;

  // Online-specific
  showName?: string;
  stationName?: string;
  startTime?: string;
  djGenres?: string[];

  // IRL-specific
  eventName?: string;
  eventLocation?: string;
  eventDate?: string;
  ticketUrl?: string;

  // Actions
  onRemove: () => void;
  isRemoving: boolean;
}

function formatShowTime(startTime: string): string {
  const date = new Date(startTime);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) {
    return `Today ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow ${timeStr}`;
  } else {
    const dayStr = date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return `${dayStr} ${timeStr}`;
  }
}

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === now.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  } else {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
}

export function MyShowsCard({
  showType,
  djName,
  djPhotoUrl,
  djUsername,
  accentColor,
  isLive,
  showName,
  stationName,
  startTime,
  djGenres,
  eventName,
  eventLocation,
  eventDate,
  ticketUrl,
  onRemove,
  isRemoving,
}: MyShowsCardProps) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = djPhotoUrl && !imageError;

  const displayName = showType === 'irl' ? eventName : showName;
  const subtitle = showType === 'irl'
    ? `${djName}${eventLocation ? ` · in ${eventLocation}` : ''}`
    : `${djName}${stationName ? ` · on ${stationName}` : ''}`;
  const timeDisplay = showType === 'irl' && eventDate
    ? formatEventDate(eventDate)
    : startTime
    ? formatShowTime(startTime)
    : null;

  // Fallback gradient for IRL is green (like a tree), for online use station accent color
  const fallbackBg = showType === 'irl'
    ? 'bg-gradient-to-br from-green-900 to-emerald-800'
    : '';
  const fallbackStyle = showType === 'online' ? { backgroundColor: accentColor } : {};

  const photoContent = (
    <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 border border-gray-700">
      {hasPhoto ? (
        <Image
          src={djPhotoUrl}
          alt={djName}
          width={80}
          height={80}
          className="w-full h-full object-cover"
          unoptimized
          onError={() => setImageError(true)}
        />
      ) : (
        <div
          className={`w-full h-full flex items-center justify-center ${fallbackBg}`}
          style={fallbackStyle}
        >
          <span className="text-2xl font-bold text-white">
            {djName.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50 p-3 gap-3">
      {/* Photo - links to DJ profile if available */}
      {djUsername ? (
        <Link href={`/dj/${djUsername}`} className="flex-shrink-0">
          {photoContent}
        </Link>
      ) : (
        photoContent
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Top row: badge + star */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* IRL / Online badge */}
            {showType === 'irl' ? (
              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
                </svg>
                IRL
              </div>
            ) : (
              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                </svg>
                Online
              </div>
            )}
            {/* Live indicator */}
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] text-red-500 font-medium">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                LIVE
              </span>
            )}
          </div>

          {/* Star remove button */}
          <button
            onClick={onRemove}
            disabled={isRemoving}
            className="p-0.5 transition-colors disabled:opacity-50 hover:opacity-70"
            style={{ color: showType === 'irl' ? '#22c55e' : accentColor }}
            aria-label="Remove from favorites"
          >
            {isRemoving ? (
              <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            )}
          </button>
        </div>

        {/* Show/Event name */}
        <p className="font-medium text-white text-sm leading-snug line-clamp-1 mt-1">
          {djUsername ? (
            <Link href={`/dj/${djUsername}`} className="hover:underline">
              {displayName}
            </Link>
          ) : (
            displayName
          )}
        </p>

        {/* DJ + Station/Location */}
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
          {djUsername ? (
            <>
              <Link
                href={`/dj/${djUsername}`}
                className="hover:text-white hover:underline transition-colors inline-block py-1 -my-1"
              >
                {djName}
              </Link>
              {showType === 'irl' && eventLocation ? ` · in ${eventLocation}` : ''}
              {showType === 'online' && stationName ? ` · on ${stationName}` : ''}
            </>
          ) : (
            subtitle
          )}
        </p>

        {/* Genre tags */}
        {djGenres && djGenres.length > 0 && (
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-tighter mt-1 line-clamp-1">
            {djGenres.join(' · ')}
          </p>
        )}

        {/* Time + Tickets link for IRL */}
        <div className="flex items-center gap-2 mt-1.5">
          {timeDisplay && (
            <span className="text-xs text-gray-500">{timeDisplay}</span>
          )}
          {showType === 'irl' && ticketUrl && (
            <>
              {timeDisplay && <span className="text-gray-600">·</span>}
              <a
                href={ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                Tickets
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
