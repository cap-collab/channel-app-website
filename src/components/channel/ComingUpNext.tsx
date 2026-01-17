'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useFavorites, Favorite } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { Show } from '@/types';
import { getStationById, getStationByMetadataKey } from '@/lib/stations';

function getStation(stationId: string | undefined) {
  if (!stationId) return undefined;
  return getStationById(stationId) || getStationByMetadataKey(stationId);
}

function formatShowTime(startTime: string): string {
  const date = new Date(startTime);
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
    return `Today ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow ${timeStr}`;
  } else {
    const dayStr = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${dayStr} ${timeStr}`;
  }
}

// Check if text contains the search term as a whole word
function matchesAsWord(text: string, searchTerm: string): boolean {
  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, 'i');
  return wordBoundaryRegex.test(text);
}

// Match a favorite against shows to find scheduled instances
function findMatchingShows(favorite: Favorite, allShows: Show[]): Show[] {
  const term = favorite.term.toLowerCase();
  const showName = favorite.showName?.toLowerCase();
  const isStationScoped = !!favorite.stationId;

  return allShows.filter((show) => {
    const showNameLower = show.name.toLowerCase();

    if (isStationScoped) {
      const favStation = getStation(favorite.stationId);
      const showStation = getStation(show.stationId);
      if (favStation?.id !== showStation?.id) return false;
      return showNameLower === term || (showName && showNameLower === showName);
    } else {
      const showDjLower = show.dj?.toLowerCase();
      const nameMatch = matchesAsWord(showNameLower, term);
      const djMatch = showDjLower && matchesAsWord(showDjLower, term);
      return nameMatch || djMatch;
    }
  });
}

interface ComingUpNextProps {
  onAuthRequired?: () => void;
}

export function ComingUpNext({ onAuthRequired }: ComingUpNextProps) {
  const { isAuthenticated } = useAuthContext();
  const { favorites, loading: favoritesLoading, toggleFavorite, isShowFavorited } = useFavorites();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Fetch all shows on mount
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => setAllShows(data.shows || []))
      .catch(console.error)
      .finally(() => setShowsLoading(false));
  }, []);

  const handleToggleFavorite = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setTogglingId(show.id);
    await toggleFavorite(show);
    setTogglingId(null);
  }, [isAuthenticated, onAuthRequired, toggleFavorite]);

  // Compute the next 2 shows: combine featured broadcast shows + user favorites
  const upcomingShows = useMemo(() => {
    const now = new Date();
    const results: Array<{ show: Show; isFavorite: boolean; source: 'broadcast' | 'favorite' }> = [];
    const seenShowIds = new Set<string>();

    // 1. Get upcoming broadcast shows (Channel Broadcast station)
    const broadcastShows = allShows
      .filter((show) => {
        const station = getStation(show.stationId);
        return station?.id === 'broadcast' && new Date(show.startTime) > now;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5); // Get a few more than needed in case of overlap

    for (const show of broadcastShows) {
      if (!seenShowIds.has(show.id)) {
        seenShowIds.add(show.id);
        results.push({ show, isFavorite: isShowFavorited(show), source: 'broadcast' });
      }
    }

    // 2. Get upcoming shows from user's favorites
    const stationFavorites = favorites.filter(
      (f) => (f.type === 'show' || f.type === 'dj') && f.stationId
    );

    for (const favorite of stationFavorites) {
      const matchingShows = findMatchingShows(favorite, allShows);
      const upcomingMatches = matchingShows
        .filter((show) => new Date(show.startTime) > now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      for (const show of upcomingMatches) {
        if (!seenShowIds.has(show.id)) {
          seenShowIds.add(show.id);
          results.push({ show, isFavorite: true, source: 'favorite' });
        }
      }
    }

    // Sort all by start time and take the first 2
    results.sort((a, b) => new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime());
    return results.slice(0, 2);
  }, [allShows, favorites, isShowFavorited]);

  if (showsLoading || favoritesLoading) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">Coming Up Next</h3>
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (upcomingShows.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">Coming Up Next</h3>
        <p className="text-gray-500 text-sm">No upcoming shows scheduled</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-xl p-4">
      <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">Coming Up Next</h3>
      <div className="space-y-2">
        {upcomingShows.map(({ show, isFavorite }) => {
          const station = getStation(show.stationId);
          const accentColor = station?.accentColor || '#D94099';
          const isToggling = togglingId === show.id;

          return (
            <div
              key={show.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/8 transition-colors"
            >
              {/* Station accent bar */}
              <div
                className="w-1 h-10 rounded-full flex-shrink-0"
                style={{ backgroundColor: accentColor }}
              />

              {/* Time */}
              <div className="flex-shrink-0 w-24">
                <p className="text-gray-400 text-sm">{formatShowTime(show.startTime)}</p>
              </div>

              {/* Show info */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{show.name}</p>
                {show.dj && (
                  <p className="text-gray-500 text-xs truncate">{show.dj}</p>
                )}
              </div>

              {/* Favorite button (star) */}
              <button
                onClick={() => handleToggleFavorite(show)}
                disabled={isToggling}
                className="p-2 transition-colors disabled:opacity-50 flex-shrink-0"
                style={{ color: accentColor }}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                {isToggling ? (
                  <div className="w-5 h-5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill={isFavorite ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                    />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
