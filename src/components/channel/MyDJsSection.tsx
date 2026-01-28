'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useFavorites } from '@/hooks/useFavorites';
import { Show } from '@/types';
import { getStationById } from '@/lib/stations';
import { getContrastTextColor } from '@/lib/colorUtils';

interface FollowedDJStatus {
  name: string;
  username?: string;
  photoUrl?: string;
  isLive: boolean;
  liveOnStation?: string;
  nextShowTime?: string;
  stationId?: string;
}

interface MyDJsSectionProps {
  shows: Show[];
  isAuthenticated: boolean;
}

function formatNextShowTime(isoTime: string): string {
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
    return timeStr;
  } else if (isTomorrow) {
    return `Tomorrow ${timeStr}`;
  } else {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

export function MyDJsSection({ shows, isAuthenticated }: MyDJsSectionProps) {
  const { favorites } = useFavorites();

  // Get watchlist items (type="search" = followed DJs)
  const followedDJNames = useMemo(() => {
    return favorites
      .filter((f) => f.type === 'search')
      .map((f) => f.term.toLowerCase());
  }, [favorites]);

  // Cross-reference with shows to get DJ status
  const djsWithStatus = useMemo((): FollowedDJStatus[] => {
    if (followedDJNames.length === 0) return [];

    const now = new Date();
    const djMap = new Map<string, FollowedDJStatus>();

    // First pass: find all DJs from shows that match followed names
    for (const show of shows) {
      if (!show.dj) continue;

      const djLower = show.dj.toLowerCase();
      const matchedFollow = followedDJNames.find((name) =>
        djLower.includes(name) || name.includes(djLower)
      );

      if (!matchedFollow) continue;

      const startDate = new Date(show.startTime);
      const endDate = new Date(show.endTime);
      const isLive = now >= startDate && now <= endDate;

      const existing = djMap.get(matchedFollow);

      // If this DJ is live, update their status
      if (isLive) {
        djMap.set(matchedFollow, {
          name: show.dj,
          username: show.djUsername,
          photoUrl: show.djPhotoUrl || show.imageUrl,
          isLive: true,
          liveOnStation: show.stationId === 'broadcast' ? 'Channel' : show.stationId,
          stationId: show.stationId,
        });
      } else if (!existing || !existing.isLive) {
        // Only update if not already live and this show is sooner
        const existingNext = existing?.nextShowTime
          ? new Date(existing.nextShowTime)
          : null;

        if (startDate > now && (!existingNext || startDate < existingNext)) {
          djMap.set(matchedFollow, {
            name: show.dj,
            username: show.djUsername,
            photoUrl: show.djPhotoUrl || show.imageUrl,
            isLive: false,
            nextShowTime: show.startTime,
            stationId: show.stationId,
          });
        }
      }
    }

    // Add any followed DJs that weren't found in shows
    for (const name of followedDJNames) {
      if (!djMap.has(name)) {
        djMap.set(name, {
          name: name.charAt(0).toUpperCase() + name.slice(1),
          isLive: false,
        });
      }
    }

    // Sort: live first, then by next show time
    return Array.from(djMap.values()).sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      if (a.nextShowTime && b.nextShowTime) {
        return new Date(a.nextShowTime).getTime() - new Date(b.nextShowTime).getTime();
      }
      if (a.nextShowTime) return -1;
      if (b.nextShowTime) return 1;
      return 0;
    });
  }, [followedDJNames, shows]);

  // Don't render if not authenticated or no followed DJs
  if (!isAuthenticated || djsWithStatus.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h2 className="text-white text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="text-accent">@</span> My DJs
      </h2>

      <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {djsWithStatus.map((dj) => (
          <Link
            key={dj.name}
            href={dj.username ? `/dj/${dj.username}` : '/my-shows'}
            className="flex-shrink-0 flex flex-col items-center gap-2 group"
          >
            {/* Avatar with live indicator */}
            <div className="relative">
              <div
                className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-colors ${
                  dj.isLive
                    ? 'border-red-500'
                    : 'border-gray-700 group-hover:border-gray-500'
                }`}
              >
                {dj.photoUrl ? (
                  <Image
                    src={dj.photoUrl}
                    alt={dj.name}
                    width={56}
                    height={56}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                ) : (
                  (() => {
                    const station = dj.stationId ? getStationById(dj.stationId) : null;
                    const bgColor = station?.accentColor || '#374151';
                    const textColor = getContrastTextColor(bgColor);
                    return (
                      <div
                        className="w-full h-full flex items-center justify-center text-lg font-bold"
                        style={{ backgroundColor: bgColor, color: textColor }}
                      >
                        {dj.name.charAt(0).toUpperCase()}
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Live indicator */}
              {dj.isLive && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  LIVE
                </span>
              )}
            </div>

            {/* Name and status */}
            <div className="text-center max-w-[70px]">
              <p className="text-white text-xs font-medium truncate">{dj.name}</p>
              {!dj.isLive && dj.nextShowTime && (
                <p className="text-gray-500 text-[10px] truncate">
                  {formatNextShowTime(dj.nextShowTime)}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
