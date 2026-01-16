'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useFavorites, Favorite, isRecurringFavorite } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { searchShows } from '@/lib/metadata';
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

// Check if text contains the search term as a whole word (word boundary matching)
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
      // Station-scoped favorite: exact match on show name + same station
      const favStation = getStation(favorite.stationId);
      const showStation = getStation(show.stationId);
      if (favStation?.id !== showStation?.id) return false;

      // Exact match on show name only (no DJ matching)
      return showNameLower === term || (showName && showNameLower === showName);
    } else {
      // Watchlist (cross-station): word boundary matching on show name OR DJ
      const showDjLower = show.dj?.toLowerCase();
      const nameMatch = matchesAsWord(showNameLower, term);
      const djMatch = showDjLower && matchesAsWord(showDjLower, term);
      return nameMatch || djMatch;
    }
  });
}

interface NextFavoriteShowProps {
  onAuthRequired?: () => void;
  currentShow?: Show | null;
  currentDJ?: string | null;
}

export function NextFavoriteShow({ onAuthRequired, currentShow, currentDJ }: NextFavoriteShowProps) {
  const { isAuthenticated } = useAuthContext();
  const { favorites, loading: favoritesLoading, toggleFavorite, isShowFavorited, addToWatchlist, isInWatchlist } = useFavorites();
  const [addingShowToFavorites, setAddingShowToFavorites] = useState(false);
  const [addingDJToWatchlist, setAddingDJToWatchlist] = useState(false);
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(true);

  // Search state
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Show[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addingWatchlist, setAddingWatchlist] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all shows on mount via API route (avoids CORS issues with Newtown scraping)
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => setAllShows(data.shows || []))
      .catch(console.error)
      .finally(() => setShowsLoading(false));
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchShows(query);
        const now = new Date();
        const filtered = results.filter((show) => new Date(show.endTime) > now);
        setSearchResults(filtered.slice(0, 15));
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const handleAddToWatchlist = useCallback(async () => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    if (!query.trim()) return;
    setAddingWatchlist(true);
    await addToWatchlist(query.trim());
    setAddingWatchlist(false);
  }, [isAuthenticated, onAuthRequired, query, addToWatchlist]);

  const clearSearch = () => {
    setQuery('');
    setSearchResults([]);
    setIsOpen(false);
  };

  // Handler to add current show to favorites
  const handleAddCurrentShowToFavorites = useCallback(async () => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    if (!currentShow) return;
    setAddingShowToFavorites(true);
    await toggleFavorite(currentShow);
    setAddingShowToFavorites(false);
  }, [isAuthenticated, onAuthRequired, currentShow, toggleFavorite]);

  // Handler to add current DJ to watchlist
  const handleAddDJToWatchlist = useCallback(async () => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    const djName = currentDJ || currentShow?.dj;
    if (!djName) return;
    setAddingDJToWatchlist(true);
    await addToWatchlist(djName);
    setAddingDJToWatchlist(false);
  }, [isAuthenticated, onAuthRequired, currentDJ, currentShow, addToWatchlist]);

  const watchlistHasTerm = isInWatchlist(query.trim());
  const showDropdown = isOpen && query.trim().length > 0;

  // Check if current show is favorited
  const isCurrentShowFavorited = currentShow ? isShowFavorited(currentShow) : false;

  // Check if current DJ is in watchlist
  const djName = currentDJ || currentShow?.dj;
  const isDJInWatchlist = djName ? isInWatchlist(djName) : false;

  // Expanded state
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter favorites by type
  const stationShows = favorites.filter(
    (f) => (f.type === 'show' || f.type === 'dj') && f.stationId && f.stationId !== 'CHANNEL'
  );
  const watchlist = favorites.filter((f) => f.type === 'search');

  // Find live, upcoming, and returning soon shows
  const { liveShows, upcomingShows, returningSoon } = useMemo(() => {
    const now = new Date();
    const live: { favorite: Favorite; show: Show }[] = [];
    const upcoming: { favorite: Favorite; show: Show }[] = [];
    const returning: Favorite[] = [];

    for (const favorite of stationShows) {
      const matchingShows = findMatchingShows(favorite, allShows);

      // Find currently live shows
      const currentlyLive = matchingShows.filter((show) => {
        const start = new Date(show.startTime);
        const end = new Date(show.endTime);
        return start <= now && end > now;
      });

      if (currentlyLive.length > 0) {
        live.push({ favorite, show: currentlyLive[0] });
      }

      // Find upcoming shows (future)
      const upcomingMatches = matchingShows
        .filter((show) => new Date(show.startTime) > now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcomingMatches.length > 0) {
        upcoming.push({ favorite, show: upcomingMatches[0] });
      } else if (isRecurringFavorite(favorite) && currentlyLive.length === 0) {
        // No upcoming or live shows but it's a recurring favorite
        returning.push(favorite);
      }
    }

    // Sort upcoming by show start time
    upcoming.sort(
      (a, b) => new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime()
    );

    return {
      liveShows: live,
      upcomingShows: upcoming,
      returningSoon: returning,
    };
  }, [stationShows, allShows]);

  // Check if there's content to show
  const hasLiveShows = liveShows.length > 0;
  const hasUpcomingShows = upcomingShows.length > 0;
  const hasReturningSoon = returningSoon.length > 0;
  const hasWatchlist = watchlist.length > 0;
  // Show the favorites section if there's content, OR if there's a current show/DJ to add
  const hasShowToAdd = currentShow && !isCurrentShowFavorited;
  // Show "Follow DJ" button if there's a DJ and either not authenticated OR not already in watchlist
  const hasDJToFollow = djName && (!isAuthenticated || !isDJInWatchlist);
  const hasContent = hasLiveShows || hasUpcomingShows || hasReturningSoon || hasWatchlist || hasShowToAdd || hasDJToFollow;

  return (
    <div ref={containerRef} className="relative">
      {/* Search Bar */}
      <div className="relative">
        <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2.5 border border-white/20 focus-within:border-accent focus-within:bg-white/15 transition-colors">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search for a DJ or show..."
            className="w-full bg-transparent text-white text-sm placeholder-gray-400 focus:outline-none"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Search Dropdown Results - inside the relative container */}
        {showDropdown && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Results Panel */}
            <div className="absolute top-full left-0 right-0 mt-2 bg-surface-elevated rounded-xl border border-gray-800 shadow-xl z-50 max-h-[60vh] overflow-y-auto">
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Shows Section */}
                {searchResults.length > 0 && (
                  <div className="p-3">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                      Shows ({searchResults.length})
                    </h3>
                    <div className="space-y-1">
                      {searchResults.map((show) => {
                        const station = getStation(show.stationId);
                        const accentColor = station?.accentColor || '#fff';
                        const isFavorited = isShowFavorited(show);
                        const isToggling = togglingId === show.id;

                        return (
                          <div
                            key={show.id}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                          >
                            {/* Station accent bar */}
                            <div
                              className="w-1 h-10 rounded-full flex-shrink-0"
                              style={{ backgroundColor: accentColor }}
                            />

                            {/* Show info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium truncate">
                                {show.name}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span style={{ color: accentColor }}>{station?.name || show.stationId}</span>
                                {show.dj && (
                                  <>
                                    <span>•</span>
                                    <span className="truncate">{show.dj}</span>
                                  </>
                                )}
                                <span>•</span>
                                <span>{formatShowTime(show.startTime)}</span>
                              </div>
                            </div>

                            {/* Favorite button */}
                            <button
                              onClick={() => handleToggleFavorite(show)}
                              disabled={isToggling}
                              className="p-1.5 transition-colors disabled:opacity-50 flex-shrink-0"
                              style={{ color: accentColor }}
                            >
                              {isToggling ? (
                                <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                              ) : (
                                <svg
                                  className="w-4 h-4"
                                  fill={isFavorited ? 'currentColor' : 'none'}
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
                )}

                {/* No results */}
                {searchResults.length === 0 && !isSearching && (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No upcoming shows found for &quot;{query}&quot;
                  </div>
                )}

                {/* Watchlist option */}
                <div className="border-t border-gray-800 p-3">
                  {watchlistHasTerm ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 px-2">
                      <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                      <span>&quot;{query}&quot; is in your watchlist</span>
                    </div>
                  ) : (
                    <button
                      onClick={handleAddToWatchlist}
                      disabled={addingWatchlist}
                      className="w-full flex items-center gap-2 px-2 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {addingWatchlist ? (
                        <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                      <span>Add &quot;{query}&quot; to watchlist</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
        )}
      </div>

      {/* Favorites Content - only show if there's content and NOT showing search dropdown */}
      {hasContent && !showsLoading && !favoritesLoading && !showDropdown && (
        <div className={`bg-surface-card rounded-xl p-3 mt-2 ${!isExpanded ? 'max-h-[160px] overflow-hidden' : ''}`}>
          {/* Header row with both titles and expand button */}
          <div className="flex items-center mb-2">
            {/* Left: Favorite Shows title */}
            <div className="flex-1 min-w-0">
              <h3 className="text-gray-500 text-[10px] uppercase tracking-wide flex items-center gap-1">
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                Favorite Shows
              </h3>
            </div>
            {/* Right: Watchlist title - show if watchlist exists OR if there's a DJ to follow */}
            {(hasWatchlist || hasDJToFollow) && (
              <div className="flex-1 min-w-0">
                <h3 className="text-gray-500 text-[10px] uppercase tracking-wide flex items-center gap-1">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Watchlist
                </h3>
              </div>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-500 hover:text-white transition-colors p-1 flex-shrink-0"
            >
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Two column layout: Shows on left, Watchlist on right */}
          <div className="flex gap-4">
            {/* Left column: Shows (Live, Coming Up, Returning Soon) */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Live Now Section */}
              {hasLiveShows && (
                <div>
                  <p className="text-red-400 text-[10px] uppercase tracking-wide mb-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    Live Now
                  </p>
                  <div className="space-y-1">
                    {(isExpanded ? liveShows : liveShows.slice(0, 2)).map(({ favorite, show }) => {
                      const station = getStation(show.stationId);
                      const accentColor = station?.accentColor || '#fff';
                      return (
                        <div key={show.id} className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full flex-shrink-0"
                            style={{ backgroundColor: accentColor }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-xs truncate"><span className="font-medium">{favorite.showName || show.name}</span>{show.dj && <span className="text-gray-400"> · {show.dj}</span>}</p>
                            <p className="text-[10px]" style={{ color: accentColor }}>
                              {station?.name || show.stationId}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {!isExpanded && liveShows.length > 2 && (
                      <p className="text-gray-500 text-[10px]">+{liveShows.length - 2} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Coming Up Section */}
              {hasUpcomingShows && (
                <div>
                  <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Coming Up</p>
                  <div className="space-y-1">
                    {(isExpanded ? upcomingShows : upcomingShows.slice(0, 3)).map(({ favorite, show }) => {
                      const station = getStation(show.stationId);
                      const accentColor = station?.accentColor || '#fff';
                      return (
                        <div key={show.id} className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full flex-shrink-0"
                            style={{ backgroundColor: accentColor }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-xs truncate"><span className="font-medium">{favorite.showName || show.name}</span>{show.dj && <span className="text-gray-400"> · {show.dj}</span>}</p>
                            <div className="flex items-center gap-1 text-[10px]">
                              <span style={{ color: accentColor }}>{station?.name || show.stationId}</span>
                              <span className="text-gray-600">·</span>
                              <span className="text-gray-400">{formatShowTime(show.startTime)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!isExpanded && upcomingShows.length > 3 && (
                      <p className="text-gray-500 text-[10px]">+{upcomingShows.length - 3} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Returning Soon Section */}
              {hasReturningSoon && (isExpanded || (!hasLiveShows && !hasUpcomingShows)) && (
                <div>
                  <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Returning Soon</p>
                  <div className="flex flex-wrap gap-1">
                    {(isExpanded ? returningSoon : returningSoon.slice(0, 3)).map((fav) => {
                      const station = getStation(fav.stationId);
                      const accentColor = station?.accentColor || '#fff';
                      return (
                        <div
                          key={fav.id}
                          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-white/5"
                        >
                          <div
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: accentColor }}
                          />
                          <span className="text-white text-[10px] truncate max-w-[100px]">
                            {fav.showName || fav.term}
                          </span>
                        </div>
                      );
                    })}
                    {!isExpanded && returningSoon.length > 3 && (
                      <span className="text-gray-500 text-[10px] self-center">
                        +{returningSoon.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Add current show to favorites button */}
              {currentShow && !isCurrentShowFavorited && (
                <button
                  onClick={handleAddCurrentShowToFavorites}
                  disabled={addingShowToFavorites}
                  className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  {addingShowToFavorites ? (
                    <div className="w-3 h-3 border border-gray-600 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  <span>Add &quot;{currentShow.name}&quot; to favorites</span>
                </button>
              )}
            </div>

            {/* Right column: Watchlist */}
            {hasWatchlist ? (
              <div className="flex-1 min-w-0">
                <div className="grid grid-cols-2 gap-1">
                  {(isExpanded ? watchlist : watchlist.slice(0, 6)).map((fav) => (
                    <div key={fav.id} className="flex items-center gap-1.5">
                      <div className="w-1 h-5 rounded-full flex-shrink-0 bg-gray-700" />
                      <span className="text-white text-xs font-medium truncate">
                        {fav.term}
                      </span>
                    </div>
                  ))}
                  {!isExpanded && watchlist.length > 6 && (
                    <span className="text-gray-500 text-[10px]">
                      +{watchlist.length - 6} more
                    </span>
                  )}
                </div>

                {/* Follow current DJ button */}
                {hasDJToFollow && (
                  <button
                    onClick={handleAddDJToWatchlist}
                    disabled={addingDJToWatchlist}
                    className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {addingDJToWatchlist ? (
                      <div className="w-3 h-3 border border-gray-600 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    )}
                    <span>+ add {djName} to watchlist</span>
                  </button>
                )}
              </div>
            ) : hasDJToFollow ? (
              /* Show Follow DJ button even if no watchlist items exist yet */
              <div className="flex-1 min-w-0">
                <button
                  onClick={handleAddDJToWatchlist}
                  disabled={addingDJToWatchlist}
                  className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  {addingDJToWatchlist ? (
                    <div className="w-3 h-3 border border-gray-600 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  <span>+ add {djName} to watchlist</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
