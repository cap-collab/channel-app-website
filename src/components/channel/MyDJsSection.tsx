'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useFavorites } from '@/hooks/useFavorites';
import { Show } from '@/types';
import { getStationById } from '@/lib/stations';
import { getContrastTextColor } from '@/lib/colorUtils';

// Cache for DJ profile lookups to avoid repeated queries
interface DJProfileCache {
  username: string;
  photoUrl?: string;
}
const djProfileCache = new Map<string, DJProfileCache | null>();

interface FavoriteItemStatus {
  name: string;
  displayName: string; // What to show to user (DJ name if available, else show name)
  username?: string;
  photoUrl?: string;
  isLive: boolean;
  liveOnStation?: string;
  nextShowTime?: string;
  stationId?: string;
  itemType: 'dj' | 'show';
}

interface MyDJsSectionProps {
  shows: Show[];
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
    return `Tomorrow ${timeStr}`;
  } else {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

export function MyDJsSection({ shows, isAuthenticated, isLoading }: MyDJsSectionProps) {
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

  // Find which followed DJs don't have shows in the schedule
  const djsWithoutShows = useMemo(() => {
    const djsWithShows = new Set<string>();
    for (const show of shows) {
      const showDjName = show.dj || show.name;
      if (!showDjName) continue;
      const djLower = showDjName.toLowerCase();
      for (const name of followedDJNames) {
        if (djLower.includes(name) || name.includes(djLower)) {
          djsWithShows.add(name);
        }
      }
    }
    return followedDJNames.filter((name) => !djsWithShows.has(name));
  }, [followedDJNames, shows]);

  // Look up DJ profiles from Firebase for DJs without shows
  useEffect(() => {
    async function lookupDJProfiles() {
      if (!db || djsWithoutShows.length === 0) return;

      const newProfiles = new Map<string, DJProfileCache>();

      for (const name of djsWithoutShows) {
        // Check cache first
        if (djProfileCache.has(name)) {
          const cached = djProfileCache.get(name);
          if (cached) newProfiles.set(name, cached);
          continue;
        }

        // Normalize the name the same way as chatUsernameNormalized
        const normalized = name.replace(/[\s-]+/g, '').toLowerCase();

        try {
          // Check pending-dj-profiles first
          const pendingRef = collection(db, 'pending-dj-profiles');
          const pendingQ = query(
            pendingRef,
            where('chatUsernameNormalized', '==', normalized)
          );
          const pendingSnapshot = await getDocs(pendingQ);
          const pendingDoc = pendingSnapshot.docs.find(
            (doc) => doc.data().status === 'pending'
          );

          if (pendingDoc) {
            const data = pendingDoc.data();
            const profile: DJProfileCache = {
              username: data.chatUsername,
              photoUrl: data.djProfile?.photoUrl || undefined,
            };
            djProfileCache.set(name, profile);
            newProfiles.set(name, profile);
            continue;
          }

          // Check users collection
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
  }, [djsWithoutShows]);

  // Cross-reference with shows to get status for both DJs and favorited shows
  const favoritesWithStatus = useMemo((): FavoriteItemStatus[] => {
    if (followedDJNames.length === 0 && favoritedShows.length === 0) return [];

    const now = new Date();
    const itemMap = new Map<string, FavoriteItemStatus>();

    // First pass: find all DJs from shows that match followed names
    for (const show of shows) {
      // Use show.dj if available, fall back to show.name (for NTS and other external radios)
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

      const key = `dj:${matchedFollow}`;
      const existing = itemMap.get(key);

      // Get photo URL - prefer djPhotoUrl, fall back to imageUrl, preserve existing if neither
      const newPhotoUrl = show.djPhotoUrl || show.imageUrl;
      const photoUrl = newPhotoUrl || existing?.photoUrl;

      // If this DJ is live, update their status
      if (isLive) {
        itemMap.set(key, {
          name: showDjName,
          displayName: showDjName,
          username: show.djUsername || existing?.username,
          photoUrl,
          isLive: true,
          liveOnStation: show.stationId === 'broadcast' ? 'Channel' : show.stationId,
          stationId: show.stationId,
          itemType: 'dj',
        });
      } else if (!existing || !existing.isLive) {
        // Only update if not already live and this show is sooner
        const existingNext = existing?.nextShowTime
          ? new Date(existing.nextShowTime)
          : null;

        if (startDate > now && (!existingNext || startDate < existingNext)) {
          itemMap.set(key, {
            name: showDjName,
            displayName: showDjName,
            username: show.djUsername || existing?.username,
            photoUrl,
            isLive: false,
            nextShowTime: show.startTime,
            stationId: show.stationId,
            itemType: 'dj',
          });
        }
      }
    }

    // Add any followed DJs that weren't found in shows
    for (const name of followedDJNames) {
      const key = `dj:${name}`;
      if (!itemMap.has(key)) {
        // Look up profile data from our fetched DJ profiles
        const profile = djProfiles.get(name);
        const displayName = profile?.username || name.charAt(0).toUpperCase() + name.slice(1);
        itemMap.set(key, {
          name: displayName,
          displayName,
          username: profile?.username,
          photoUrl: profile?.photoUrl,
          isLive: false,
          itemType: 'dj',
        });
      }
    }

    // Second pass: find all favorited shows
    for (const favShow of favoritedShows) {
      // Check if this show is already covered by a DJ watchlist entry
      const showNameLower = favShow.term;
      const isCoveredByDJ = followedDJNames.some((djName) =>
        showNameLower.includes(djName) || djName.includes(showNameLower)
      );
      if (isCoveredByDJ) continue;

      // Find matching shows in the schedule
      for (const show of shows) {
        const showNameMatch = show.name?.toLowerCase() === showNameLower ||
          (favShow.showName && show.name?.toLowerCase() === favShow.showName.toLowerCase());
        const stationMatch = !favShow.stationId || show.stationId === favShow.stationId;

        if (!showNameMatch || !stationMatch) continue;

        const startDate = new Date(show.startTime);
        const endDate = new Date(show.endTime);
        const isLive = now >= startDate && now <= endDate;

        const key = `show:${favShow.term}:${favShow.stationId || 'any'}`;
        const existing = itemMap.get(key);

        // Prefer DJ photo if available, then show image
        const newPhotoUrl = show.djPhotoUrl || show.imageUrl;
        const photoUrl = newPhotoUrl || existing?.photoUrl;

        // If show has a linked DJ profile, display DJ name; otherwise show name
        const hasDjProfile = show.djUsername || show.dj;
        const displayName = hasDjProfile ? (show.dj || show.name) : show.name;

        if (isLive) {
          itemMap.set(key, {
            name: show.name,
            displayName,
            username: show.djUsername || existing?.username,
            photoUrl,
            isLive: true,
            liveOnStation: show.stationId === 'broadcast' ? 'Channel' : show.stationId,
            stationId: show.stationId,
            itemType: 'show',
          });
        } else if (!existing || !existing.isLive) {
          const existingNext = existing?.nextShowTime
            ? new Date(existing.nextShowTime)
            : null;

          if (startDate > now && (!existingNext || startDate < existingNext)) {
            itemMap.set(key, {
              name: show.name,
              displayName,
              username: show.djUsername || existing?.username,
              photoUrl,
              isLive: false,
              nextShowTime: show.startTime,
              stationId: show.stationId,
              itemType: 'show',
            });
          }
        }
      }

      // Don't add favorited shows that have no live or upcoming instances
      // (past shows should not appear in favorites)
    }

    // Deduplicate by username - keep the best entry (live > upcoming > none)
    const byUsername = new Map<string, FavoriteItemStatus>();
    const allItems = Array.from(itemMap.values());
    for (const item of allItems) {
      // Use username as key if available, otherwise use lowercase name
      const dedupeKey = item.username?.toLowerCase() || item.name.toLowerCase();
      const existing = byUsername.get(dedupeKey);

      if (!existing) {
        byUsername.set(dedupeKey, item);
      } else {
        // Priority: live > upcoming show > no show
        const existingScore = existing.isLive ? 2 : existing.nextShowTime ? 1 : 0;
        const newScore = item.isLive ? 2 : item.nextShowTime ? 1 : 0;

        if (newScore > existingScore) {
          byUsername.set(dedupeKey, item);
        } else if (newScore === existingScore && newScore === 1) {
          // Both have upcoming shows - keep the one with earlier show time
          const existingTime = new Date(existing.nextShowTime!).getTime();
          const newTime = new Date(item.nextShowTime!).getTime();
          if (newTime < existingTime) {
            byUsername.set(dedupeKey, item);
          }
        } else if (newScore === existingScore) {
          // Same priority - prefer the one with more info (photo, username)
          const existingInfo = (existing.photoUrl ? 1 : 0) + (existing.username ? 1 : 0);
          const newInfo = (item.photoUrl ? 1 : 0) + (item.username ? 1 : 0);
          if (newInfo > existingInfo) {
            byUsername.set(dedupeKey, item);
          }
        }
      }
    }

    // Sort: live first, then by next show time
    return Array.from(byUsername.values()).sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      if (a.nextShowTime && b.nextShowTime) {
        return new Date(a.nextShowTime).getTime() - new Date(b.nextShowTime).getTime();
      }
      if (a.nextShowTime) return -1;
      if (b.nextShowTime) return 1;
      return 0;
    });
  }, [followedDJNames, favoritedShows, shows, djProfiles]);

  // Don't render if not authenticated, still loading, or no favorites
  if (!isAuthenticated || isLoading || favoritesWithStatus.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h2 className="text-white text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg> My Favorites
      </h2>

      <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {favoritesWithStatus.map((item) => (
          <Link
            key={`${item.itemType}-${item.name}`}
            href={item.username ? `/dj/${item.username}` : '/my-shows'}
            className="flex-shrink-0 flex flex-col items-center gap-2 group"
          >
            {/* Avatar with live indicator */}
            <div className="relative">
              <div
                className={`w-14 h-14 rounded-full overflow-hidden border-2 transition-colors ${
                  item.isLive
                    ? 'border-red-500'
                    : 'border-gray-700 group-hover:border-gray-500'
                }`}
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
              {item.isLive && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  LIVE
                </span>
              )}
            </div>

            {/* Name and status */}
            <div className="text-center max-w-[70px]">
              <p className="text-white text-xs font-medium truncate">{item.displayName}</p>
              {!item.isLive && item.nextShowTime && (
                <p className="text-gray-500 text-[10px] truncate">
                  {formatNextShowTime(item.nextShowTime)}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
