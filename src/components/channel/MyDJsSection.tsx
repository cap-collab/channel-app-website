'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useFavorites } from '@/hooks/useFavorites';
import { Show, IRLShowData } from '@/types';
import { getStationById } from '@/lib/stations';
import { getContrastTextColor } from '@/lib/colorUtils';

// Cache for DJ profile lookups to avoid repeated queries
interface DJProfileCache {
  username: string;
  photoUrl?: string;
}
const djProfileCache = new Map<string, DJProfileCache | null>();

// Each item represents a single event (show or IRL) or a DJ without events
interface FavoriteTimelineItem {
  // DJ info
  djName: string;
  displayName: string;
  username?: string;
  photoUrl?: string;
  // Event info
  eventType: 'live' | 'show' | 'irl' | 'none'; // 'none' = DJ with no upcoming events
  eventTime?: number; // timestamp for sorting
  // Show-specific
  showStartTime?: string;
  stationId?: string;
  liveOnStation?: string;
  // IRL-specific
  irlDate?: string;
  irlEventName?: string;
  irlLocation?: string;
  // For unique keys
  eventId: string;
}

interface MyDJsSectionProps {
  shows: Show[];
  irlShows: IRLShowData[];
  isAuthenticated: boolean;
  isLoading?: boolean;
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
    return `Tom ${timeStr}`;
  } else {
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${weekday} ${timeStr}`;
  }
}

function formatIRLDate(isoDate: string): string {
  const date = new Date(isoDate + 'T00:00:00'); // Parse as local date
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  if (isToday) {
    return 'Today';
  } else if (isTomorrow) {
    return 'Tom';
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
}

export function MyDJsSection({ shows, irlShows, isAuthenticated, isLoading }: MyDJsSectionProps) {
  const { favorites } = useFavorites();
  const [djProfiles, setDjProfiles] = useState<Map<string, DJProfileCache>>(new Map());

  // Get watchlist items (type="search" = followed DJs)
  const followedDJNames = useMemo(() => {
    return favorites
      .filter((f) => f.type === 'search')
      .map((f) => f.term.toLowerCase());
  }, [favorites]);

  // Get favorited shows (type="show")
  const favoritedShows = useMemo(() => {
    return favorites
      .filter((f) => f.type === 'show')
      .map((f) => ({
        term: f.term.toLowerCase(),
        showName: f.showName,
        stationId: f.stationId,
      }));
  }, [favorites]);

  // Find which followed DJs don't have shows in the schedule or IRL events
  const djsWithoutEvents = useMemo(() => {
    const djsWithEvents = new Set<string>();

    // Check shows
    for (const show of shows) {
      const showDjName = show.dj || show.name;
      if (!showDjName) continue;
      const djLower = showDjName.toLowerCase();
      for (const name of followedDJNames) {
        if (djLower.includes(name) || name.includes(djLower)) {
          djsWithEvents.add(name);
        }
      }
    }

    // Check IRL events
    for (const irlShow of irlShows) {
      const djLower = irlShow.djName.toLowerCase();
      for (const name of followedDJNames) {
        if (djLower.includes(name) || name.includes(djLower)) {
          djsWithEvents.add(name);
        }
      }
    }

    return followedDJNames.filter((name) => !djsWithEvents.has(name));
  }, [followedDJNames, shows, irlShows]);

  // Look up DJ profiles from Firebase for DJs without events
  useEffect(() => {
    async function lookupDJProfiles() {
      if (!db || djsWithoutEvents.length === 0) return;

      const newProfiles = new Map<string, DJProfileCache>();

      for (const name of djsWithoutEvents) {
        // Check cache first
        if (djProfileCache.has(name)) {
          const cached = djProfileCache.get(name);
          if (cached) newProfiles.set(name, cached);
          continue;
        }

        // Normalize the name the same way as chatUsernameNormalized
        const normalized = name.replace(/[\s-]+/g, '').toLowerCase();

        try {
          // Check pending-dj-profiles FIRST (has public read, avoids permission issues)
          const pendingRef = collection(db, 'pending-dj-profiles');
          const pendingQ = query(
            pendingRef,
            where('chatUsernameNormalized', '==', normalized)
          );
          const pendingSnapshot = await getDocs(pendingQ);

          if (!pendingSnapshot.empty) {
            // Use first matching doc regardless of status
            const data = pendingSnapshot.docs[0].data();
            const profile: DJProfileCache = {
              username: data.chatUsername,
              photoUrl: data.djProfile?.photoUrl || undefined,
            };
            djProfileCache.set(name, profile);
            newProfiles.set(name, profile);
            continue;
          }

          // Fall back to users collection (approved DJs)
          const usersRef = collection(db, 'users');
          const usersQ = query(
            usersRef,
            where('chatUsernameNormalized', '==', normalized),
            where('role', 'in', ['dj', 'broadcaster', 'admin'])
          );
          const usersSnapshot = await getDocs(usersQ);

          if (!usersSnapshot.empty) {
            const data = usersSnapshot.docs[0].data();
            const profile: DJProfileCache = {
              username: data.chatUsername,
              photoUrl: data.djProfile?.photoUrl || undefined,
            };
            djProfileCache.set(name, profile);
            newProfiles.set(name, profile);
          } else {
            // Cache the miss to avoid repeated lookups
            djProfileCache.set(name, null);
          }
        } catch (error) {
          console.error(`Error looking up DJ profile for ${name}:`, error);
          djProfileCache.set(name, null);
        }
      }

      if (newProfiles.size > 0) {
        setDjProfiles((prev) => {
          const merged = new Map(prev);
          newProfiles.forEach((value, key) => merged.set(key, value));
          return merged;
        });
      }
    }

    lookupDJProfiles();
  }, [djsWithoutEvents]);

  // Build timeline: one entry per event, sorted chronologically, DJs without events at end
  const timelineItems = useMemo((): FavoriteTimelineItem[] => {
    if (followedDJNames.length === 0 && favoritedShows.length === 0) return [];

    const now = new Date();
    const items: FavoriteTimelineItem[] = [];

    // Track DJ info for profile data (photo, username)
    const djInfoMap = new Map<string, { username?: string; photoUrl?: string }>();

    // First: Add all shows from followed DJs (one entry per show)
    for (const show of shows) {
      const showDjName = show.dj || show.name;
      if (!showDjName) continue;

      const djLower = showDjName.toLowerCase();
      const matchedFollow = followedDJNames.find((name) =>
        djLower.includes(name) || name.includes(djLower)
      );

      if (!matchedFollow) continue;

      const startDate = new Date(show.startTime);
      const endDate = new Date(show.endTime);
      const isLive = now >= startDate && now <= endDate;
      const isUpcoming = startDate > now;

      // Skip past shows
      if (!isLive && !isUpcoming) continue;

      const photoUrl = show.djPhotoUrl || show.imageUrl;

      // Update DJ info map
      if (show.djUsername || photoUrl) {
        const existing = djInfoMap.get(matchedFollow) || {};
        djInfoMap.set(matchedFollow, {
          username: show.djUsername || existing.username,
          photoUrl: photoUrl || existing.photoUrl,
        });
      }

      items.push({
        djName: showDjName,
        displayName: showDjName,
        username: show.djUsername,
        photoUrl,
        eventType: isLive ? 'live' : 'show',
        eventTime: isLive ? 0 : startDate.getTime(), // Live shows sort first
        showStartTime: show.startTime,
        stationId: show.stationId,
        liveOnStation: isLive ? (show.stationId === 'broadcast' ? 'Channel' : show.stationId) : undefined,
        eventId: `show-${show.id}-${show.startTime}`,
      });
    }

    // Second: Add favorited shows that aren't covered by DJ follows
    for (const favShow of favoritedShows) {
      const showNameLower = favShow.term;
      const isCoveredByDJ = followedDJNames.some((djName) =>
        showNameLower.includes(djName) || djName.includes(showNameLower)
      );
      if (isCoveredByDJ) continue;

      for (const show of shows) {
        const showNameMatch = show.name?.toLowerCase() === showNameLower ||
          (favShow.showName && show.name?.toLowerCase() === favShow.showName.toLowerCase());
        const stationMatch = !favShow.stationId || show.stationId === favShow.stationId;

        if (!showNameMatch || !stationMatch) continue;

        const startDate = new Date(show.startTime);
        const endDate = new Date(show.endTime);
        const isLive = now >= startDate && now <= endDate;
        const isUpcoming = startDate > now;

        if (!isLive && !isUpcoming) continue;

        const photoUrl = show.djPhotoUrl || show.imageUrl;
        const hasDjProfile = show.djUsername || show.dj;
        const displayName = hasDjProfile ? (show.dj || show.name) : show.name;

        items.push({
          djName: show.name,
          displayName,
          username: show.djUsername,
          photoUrl,
          eventType: isLive ? 'live' : 'show',
          eventTime: isLive ? 0 : startDate.getTime(),
          showStartTime: show.startTime,
          stationId: show.stationId,
          liveOnStation: isLive ? (show.stationId === 'broadcast' ? 'Channel' : show.stationId) : undefined,
          eventId: `favshow-${show.id}-${show.startTime}`,
        });
      }
    }

    // Third: Add all IRL events from followed DJs (one entry per IRL event)
    for (const irlShow of irlShows) {
      const djNameLower = irlShow.djName.toLowerCase();
      const matchedFollow = followedDJNames.find((name) =>
        djNameLower.includes(name) || name.includes(djNameLower)
      );

      if (!matchedFollow) continue;

      const irlTime = new Date(irlShow.date + 'T00:00:00').getTime();

      // Update DJ info map
      if (irlShow.djUsername || irlShow.djPhotoUrl) {
        const existing = djInfoMap.get(matchedFollow) || {};
        djInfoMap.set(matchedFollow, {
          username: irlShow.djUsername || existing.username,
          photoUrl: irlShow.djPhotoUrl || existing.photoUrl,
        });
      }

      items.push({
        djName: irlShow.djName,
        displayName: irlShow.djName,
        username: irlShow.djUsername,
        photoUrl: irlShow.djPhotoUrl,
        eventType: 'irl',
        eventTime: irlTime,
        irlDate: irlShow.date,
        irlEventName: irlShow.eventName,
        irlLocation: irlShow.location,
        eventId: `irl-${irlShow.djUsername}-${irlShow.date}-${irlShow.location}`,
      });
    }

    // Fourth: Add DJs without any events at the end
    for (const name of djsWithoutEvents) {
      const profile = djProfiles.get(name);
      const displayName = profile?.username || name.charAt(0).toUpperCase() + name.slice(1);

      items.push({
        djName: displayName,
        displayName,
        username: profile?.username,
        photoUrl: profile?.photoUrl,
        eventType: 'none',
        eventTime: undefined, // Will sort to the end
        eventId: `dj-${name}`,
      });
    }

    // Sort: live first (eventTime=0), then by event time ascending, then DJs without events (no eventTime)
    return items.sort((a, b) => {
      // Items with events come before items without
      if (a.eventTime !== undefined && b.eventTime === undefined) return -1;
      if (a.eventTime === undefined && b.eventTime !== undefined) return 1;

      // Both have events - sort by time
      if (a.eventTime !== undefined && b.eventTime !== undefined) {
        return a.eventTime - b.eventTime;
      }

      // Both without events - sort by photo presence, then alphabetically
      if (a.photoUrl && !b.photoUrl) return -1;
      if (!a.photoUrl && b.photoUrl) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [followedDJNames, favoritedShows, shows, irlShows, djsWithoutEvents, djProfiles]);

  // Don't render if not authenticated, still loading, or no favorites
  if (!isAuthenticated || isLoading || timelineItems.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 md:mb-6">
      <h2 className="text-white text-sm font-semibold uppercase tracking-wide mb-2 md:mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg> My Favorites
      </h2>

      <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {timelineItems.map((item) => (
          <Link
            key={item.eventId}
            href={item.username ? `/dj/${item.username}` : '/my-shows'}
            className="flex-shrink-0 flex flex-col items-center gap-2 group"
          >
            {/* Avatar with live/IRL indicator */}
            <div className="relative">
              <div
                className="w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors border-gray-700 group-hover:border-gray-500"
              >
                {item.photoUrl ? (
                  <Image
                    src={item.photoUrl}
                    alt={item.displayName}
                    width={56}
                    height={56}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                ) : (
                  (() => {
                    const station = item.stationId ? getStationById(item.stationId) : null;
                    const bgColor = station?.accentColor || '#374151';
                    const textColor = getContrastTextColor(bgColor);
                    return (
                      <div
                        className="w-full h-full flex items-center justify-center text-lg font-bold"
                        style={{ backgroundColor: bgColor, color: textColor }}
                      >
                        {item.displayName.charAt(0).toUpperCase()}
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Live indicator */}
              {item.eventType === 'live' && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-[#ff0000] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  LIVE
                </span>
              )}

              {/* IRL indicator */}
              {item.eventType === 'irl' && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  IRL
                </span>
              )}
            </div>

            {/* Name and status */}
            <div className="text-center max-w-[70px]">
              <p className="text-white text-xs font-medium truncate">{item.displayName}</p>
              {item.eventType === 'show' && item.showStartTime && (
                <p className="text-gray-500 text-[10px] truncate">
                  {formatNextShowTime(item.showStartTime)}
                </p>
              )}
              {item.eventType === 'irl' && item.irlDate && (
                <p className="text-green-400 text-[10px] truncate">
                  {formatIRLDate(item.irlDate)}
                </p>
              )}
              {item.eventType === 'none' && (
                <p className="text-gray-600 text-[10px] truncate">
                  No shows
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
