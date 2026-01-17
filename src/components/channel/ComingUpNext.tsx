'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useFavorites, Favorite } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Show } from '@/types';
import { getStationById, getStationByMetadataKey } from '@/lib/stations';
import { TipButton } from './TipButton';

function getStation(stationId: string | undefined) {
  if (!stationId) return undefined;
  return getStationById(stationId) || getStationByMetadataKey(stationId);
}

function formatShowTime(startTime: string): { day: string; time: string } {
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
    return { day: 'Today', time: timeStr };
  } else if (isTomorrow) {
    return { day: 'Tomorrow', time: timeStr };
  } else {
    const dayStr = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return { day: dayStr, time: timeStr };
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
  const { isAuthenticated, user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { favorites, loading: favoritesLoading, addToWatchlist, isInWatchlist } = useFavorites();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(true);
  const [addingToWatchlist, setAddingToWatchlist] = useState<string | null>(null);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);

  // Fetch all shows on mount
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => setAllShows(data.shows || []))
      .catch(console.error)
      .finally(() => setShowsLoading(false));
  }, []);

  const handleAddToWatchlist = useCallback(async (djName: string, djUserId?: string, djEmail?: string) => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setAddingToWatchlist(djName);
    await addToWatchlist(djName, djUserId, djEmail);
    setAddingToWatchlist(null);
  }, [isAuthenticated, onAuthRequired, addToWatchlist]);

  // Compute the next 2 shows: combine featured broadcast shows + user favorites
  const upcomingShows = useMemo(() => {
    const now = new Date();
    const results: Array<{ show: Show; source: 'broadcast' | 'favorite' }> = [];
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
        results.push({ show, source: 'broadcast' });
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
          results.push({ show, source: 'favorite' });
        }
      }
    }

    // Sort all by start time and take the first 2
    results.sort((a, b) => new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime());
    return results.slice(0, 2);
  }, [allShows, favorites]);

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
        {upcomingShows.map(({ show }) => {
          const station = getStation(show.stationId);
          const accentColor = station?.accentColor || '#D94099';
          const isExpanded = expandedShowId === show.id;
          const { day, time } = formatShowTime(show.startTime);
          const canTip = station?.id === 'broadcast' && show.dj && (show.djUserId || show.djEmail) && show.broadcastSlotId;
          const djInWatchlist = show.dj ? isInWatchlist(show.dj) : false;
          const isAdding = addingToWatchlist === show.dj;

          return (
            <div
              key={show.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/8 transition-colors cursor-pointer"
              onClick={() => setExpandedShowId(isExpanded ? null : show.id)}
            >
              {/* Station accent bar */}
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0"
                style={{ backgroundColor: accentColor }}
              />

              {/* Time - day on top, time below */}
              <div className="flex-shrink-0 w-20 text-center">
                <p className="text-gray-400 text-xs">{day}</p>
                <p className="text-gray-400 text-sm">{time}</p>
              </div>

              {/* Show info - name can wrap to 2 lines */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium line-clamp-2">{show.name}</p>
                {show.dj && (
                  <p className="text-gray-500 text-xs truncate">{show.dj}</p>
                )}
              </div>

              {/* Add to Watchlist button */}
              {show.dj && !djInWatchlist && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToWatchlist(show.dj!, show.djUserId, show.djEmail);
                  }}
                  disabled={isAdding}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-xs flex-shrink-0 disabled:opacity-50"
                  style={{ color: accentColor }}
                >
                  {isAdding ? (
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  <span className="text-white">Watchlist</span>
                </button>
              )}

              {/* Show checkmark if DJ already in watchlist */}
              {show.dj && djInWatchlist && (
                <div
                  className="flex items-center gap-1 px-2 py-1 text-xs flex-shrink-0"
                  style={{ color: accentColor }}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  <span className="text-gray-400">Watching</span>
                </div>
              )}

              {/* Popup modal for expanded show details */}
              {isExpanded && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 bg-black/60 z-40"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedShowId(null);
                    }}
                  />
                  {/* Popup */}
                  <div
                    className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#1a1a1a] border border-gray-700 rounded-xl p-5 max-w-md w-[90vw] shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Close button */}
                    <button
                      onClick={() => setExpandedShowId(null)}
                      className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    {/* Show name */}
                    <h3 className="text-white text-lg font-semibold pr-8 mb-1">
                      {show.name}
                    </h3>

                    {/* DJ name */}
                    {show.dj && (
                      <p className="text-gray-400 text-sm mb-3">
                        by {show.dj}
                      </p>
                    )}

                    {/* Station & time */}
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                      <span>{station?.name}</span>
                      <span>•</span>
                      <span>
                        {day} {time}
                      </span>
                    </div>

                    {/* DJ Photo and Bio */}
                    {(show.djPhotoUrl || show.djBio) && (
                      <div className="flex items-start gap-3 mb-4">
                        {show.djPhotoUrl && (
                          <Image
                            src={show.djPhotoUrl}
                            alt={show.dj || 'DJ'}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                            unoptimized
                          />
                        )}
                        {show.djBio && (
                          <p className="text-gray-300 text-sm">{show.djBio}</p>
                        )}
                      </div>
                    )}

                    {/* Description */}
                    {show.description && (
                      <p className="text-gray-400 text-sm leading-relaxed mb-4">{show.description}</p>
                    )}

                    {/* Promo section */}
                    {show.promoText && (
                      <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
                        <p className="text-gray-300 text-sm">{show.promoText}</p>
                        {show.promoUrl && (
                          <a
                            href={show.promoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-sm hover:underline"
                            style={{ color: accentColor }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Learn more
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-800">
                      {/* Add DJ to Watchlist button */}
                      {show.dj && !djInWatchlist && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToWatchlist(show.dj!, show.djUserId, show.djEmail);
                          }}
                          disabled={isAdding}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-sm"
                          style={{ color: accentColor }}
                        >
                          {isAdding ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                          <span className="text-white">Add {show.dj} to Watchlist</span>
                        </button>
                      )}

                      {/* Show checkmark if DJ already in watchlist */}
                      {show.dj && djInWatchlist && (
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-sm"
                          style={{ color: accentColor }}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                          <span className="text-gray-400">{show.dj} in Watchlist</span>
                        </div>
                      )}

                      {/* Tip button */}
                      {canTip && (
                        <TipButton
                          isAuthenticated={isAuthenticated}
                          tipperUserId={user?.uid}
                          tipperUsername={chatUsername || undefined}
                          djUserId={show.djUserId}
                          djEmail={show.djEmail}
                          djUsername={show.dj!}
                          broadcastSlotId={show.broadcastSlotId!}
                          showName={show.name}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
