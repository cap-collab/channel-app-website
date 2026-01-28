'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';

interface WhatNotToMissProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onRemindMe: (show: Show) => void;
}

function formatShowTime(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) {
    return `Today @ ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow @ ${timeStr}`;
  } else {
    const dayStr = date.toLocaleDateString('en-US', {
      weekday: 'short',
    });
    return `${dayStr} @ ${timeStr}`;
  }
}

export function WhatNotToMiss({
  shows,
  stations,
  isAuthenticated,
  onRemindMe,
}: WhatNotToMissProps) {
  const { isInWatchlist, addToWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingDj, setAddingDj] = useState<string | null>(null);

  // Filter to upcoming shows with DJ profiles only
  const upcomingShows = shows
    .filter((show) => {
      const now = new Date();
      const startDate = new Date(show.startTime);
      // Only upcoming, has DJ, and has profile (djUsername or djUserId)
      return startDate > now && show.dj && (show.djUsername || show.djUserId);
    })
    .slice(0, 5);

  if (upcomingShows.length === 0) {
    return null;
  }

  const handleRemindMe = async (show: Show) => {
    if (!isAuthenticated) {
      onRemindMe(show);
      return;
    }

    if (!show.dj) return;

    setAddingDj(show.dj);
    try {
      // Add DJ to watchlist
      await addToWatchlist(show.dj, show.djUserId, show.djEmail);
      // Also add this specific show to favorites
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingDj(null);
    }
  };

  return (
    <div className="mb-6">
      <h2 className="text-white text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="text-accent">&gt;</span> What Not To Miss
      </h2>

      <div className="space-y-3">
        {upcomingShows.map((show) => {
          const station = stations.get(show.stationId);
          const djName = show.dj || show.name;
          const djPhotoUrl = show.djPhotoUrl || show.imageUrl;
          const isFollowing = show.dj ? isInWatchlist(show.dj) : false;
          const isAdding = addingDj === show.dj;

          return (
            <div
              key={show.id}
              className="relative bg-surface-card rounded-xl overflow-hidden"
            >
              <div className="flex items-stretch">
                {/* DJ Photo */}
                <div className="relative w-24 h-24 flex-shrink-0">
                  {djPhotoUrl ? (
                    <Image
                      src={djPhotoUrl}
                      alt={djName}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gray-800 flex items-center justify-center text-white text-2xl font-bold">
                      {djName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                  <div>
                    {/* DJ Name */}
                    <h3 className="text-white font-semibold truncate">
                      {show.djUsername ? (
                        <Link
                          href={`/dj/${show.djUsername}`}
                          className="hover:underline"
                        >
                          {djName}
                        </Link>
                      ) : (
                        djName
                      )}
                    </h3>

                    {/* Time and Station */}
                    <p className="text-gray-400 text-sm">
                      {formatShowTime(show.startTime)}
                      {station && (
                        <span
                          className="ml-2"
                          style={{ color: station.accentColor }}
                        >
                          • {station.name}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Remind Me Button */}
                  <button
                    onClick={() => handleRemindMe(show)}
                    disabled={isAdding || isFollowing}
                    className={`mt-2 w-full py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                      isFollowing
                        ? 'bg-white/10 text-gray-400 cursor-default'
                        : 'bg-accent hover:bg-accent-hover text-white'
                    } disabled:opacity-50`}
                  >
                    {isAdding ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Adding...
                      </div>
                    ) : isFollowing ? (
                      "You're Following"
                    ) : (
                      'Remind Me'
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
