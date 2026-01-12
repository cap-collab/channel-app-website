'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFavorites, Favorite } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { getAllShows } from '@/lib/metadata';
import { Show } from '@/types';
import { getStationById, getStationByMetadataKey } from '@/lib/stations';

function getStation(stationId: string | undefined) {
  if (!stationId) return undefined;
  return getStationById(stationId) || getStationByMetadataKey(stationId);
}

function formatTimeUntil(startTime: string): string {
  const start = new Date(startTime);
  const now = new Date();
  const diffMs = start.getTime() - now.getTime();

  if (diffMs <= 0) return 'Now';

  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  if (diffHours > 24) {
    const diffDays = Math.floor(diffHours / 24);
    return `in ${diffDays}d`;
  } else if (diffHours > 0) {
    return `in ${diffHours}h ${remainingMins}m`;
  } else {
    return `in ${diffMins}m`;
  }
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

// Match a favorite against shows to find scheduled instances
function findMatchingShows(favorite: Favorite, allShows: Show[]): Show[] {
  const term = favorite.term.toLowerCase();
  const showName = favorite.showName?.toLowerCase();

  return allShows.filter((show) => {
    // Match by station if specified
    if (favorite.stationId) {
      const favStation = getStation(favorite.stationId);
      const showStation = getStation(show.stationId);
      if (favStation?.id !== showStation?.id) return false;
    }

    const showNameLower = show.name.toLowerCase();
    const showDjLower = show.dj?.toLowerCase();

    // Match by name (bidirectional - either contains the other)
    const nameMatch = showNameLower.includes(term) || term.includes(showNameLower);
    // Also try matching against the stored showName
    const storedNameMatch = showName && (showNameLower.includes(showName) || showName.includes(showNameLower));
    // Match by DJ
    const djMatch = showDjLower && (showDjLower.includes(term) || term.includes(showDjLower));

    return nameMatch || storedNameMatch || djMatch;
  });
}

interface NextFavoriteShowProps {
  onSearchClick?: () => void;
}

export function NextFavoriteShow({ onSearchClick }: NextFavoriteShowProps) {
  const { isAuthenticated } = useAuthContext();
  const { favorites, loading: favoritesLoading } = useFavorites();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(true);

  // Fetch all shows on mount
  useEffect(() => {
    getAllShows()
      .then(setAllShows)
      .catch(console.error)
      .finally(() => setShowsLoading(false));
  }, []);

  // Filter favorites to only station shows (not watchlist search terms)
  const stationShows = favorites.filter(
    (f) => (f.type === 'show' || f.type === 'dj') && f.stationId && f.stationId !== 'CHANNEL'
  );

  // Find the next upcoming favorite show
  const nextShow = useMemo(() => {
    const now = new Date();

    const upcomingMatches: { favorite: Favorite; show: Show }[] = [];

    for (const favorite of stationShows) {
      const matchingShows = findMatchingShows(favorite, allShows);

      // Find upcoming shows (future)
      const upcoming = matchingShows
        .filter((show) => new Date(show.startTime) > now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcoming.length > 0) {
        upcomingMatches.push({ favorite, show: upcoming[0] });
      }
    }

    // Sort by show start time and get the first one
    upcomingMatches.sort(
      (a, b) => new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime()
    );

    return upcomingMatches[0] || null;
  }, [stationShows, allShows]);

  // Loading state
  if (favoritesLoading || showsLoading) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // Not authenticated or no favorites - show prompt
  if (!isAuthenticated || stationShows.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium text-sm">Find your favorite DJ</p>
            <p className="text-gray-500 text-xs mt-0.5">
              Search above and add shows to your favorites to see when they&apos;re coming up
            </p>
          </div>
          {onSearchClick && (
            <button
              onClick={onSearchClick}
              className="text-accent text-sm font-medium hover:underline flex-shrink-0"
            >
              Search
            </button>
          )}
        </div>
      </div>
    );
  }

  // Has favorites but no upcoming shows
  if (!nextShow) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2">Your Next Show</h3>
        <p className="text-gray-400 text-sm">
          No upcoming shows from your favorites scheduled yet. Check back later!
        </p>
      </div>
    );
  }

  // Show the next favorite
  const { favorite, show } = nextShow;
  const station = getStation(show.stationId);
  const accentColor = station?.accentColor || '#fff';

  return (
    <div className="bg-surface-card rounded-xl p-4">
      <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">Your Next Show</h3>

      <div className="flex items-center gap-3">
        {/* Station accent bar */}
        <div
          className="w-1 h-14 rounded-full flex-shrink-0"
          style={{ backgroundColor: accentColor }}
        />

        {/* Show info */}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{favorite.showName || show.name}</p>
          <div className="flex items-center gap-2 text-sm text-gray-400 mt-0.5">
            <span style={{ color: accentColor }}>{station?.name || show.stationId}</span>
            <span>•</span>
            <span className="text-accent font-medium">{formatTimeUntil(show.startTime)}</span>
          </div>
          <p className="text-gray-500 text-xs mt-1">{formatShowTime(show.startTime)}</p>
        </div>

        {/* Open station button */}
        {station && station.id !== 'broadcast' && (
          <a
            href={station.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0"
            style={{
              backgroundColor: `${accentColor}20`,
              color: accentColor,
            }}
          >
            Open
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}
