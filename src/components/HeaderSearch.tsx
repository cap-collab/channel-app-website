'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { searchShows } from '@/lib/metadata';
import { useFavorites } from '@/hooks/useFavorites';
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

interface HeaderSearchProps {
  onAuthRequired?: () => void;
}

export function HeaderSearch({ onAuthRequired }: HeaderSearchProps) {
  const { isAuthenticated } = useAuthContext();
  const { toggleFavorite, isShowFavorited, addToWatchlist, isInWatchlist } = useFavorites();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Show[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addingWatchlistForQuery, setAddingWatchlistForQuery] = useState(false);
  const [addingDjToWatchlist, setAddingDjToWatchlist] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const searchResults = await searchShows(query);
        const now = new Date();
        // Filter to only upcoming shows
        const filtered = searchResults.filter((show) => new Date(show.endTime) > now);
        setResults(filtered.slice(0, 15));
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setIsLoading(false);
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

  const handleToggleFavorite = useCallback(async (show: Show, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setTogglingId(show.id);
    await toggleFavorite(show);
    setTogglingId(null);
  }, [isAuthenticated, onAuthRequired, toggleFavorite]);


  const handleAddQueryToWatchlist = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    if (!query.trim()) return;
    setAddingWatchlistForQuery(true);
    await addToWatchlist(query.trim());
    setAddingWatchlistForQuery(false);
  }, [isAuthenticated, onAuthRequired, query, addToWatchlist]);

  // Extract unique DJs from search results
  const uniqueDjs = useMemo(() => {
    const djMap = new Map<string, { name: string; photoUrl?: string }>();
    for (const show of results) {
      if (show.dj) {
        const key = show.dj.toLowerCase();
        if (!djMap.has(key)) {
          djMap.set(key, {
            name: show.dj,
            photoUrl: show.djPhotoUrl,
          });
        }
      }
    }
    return Array.from(djMap.values()).slice(0, 10);
  }, [results]);

  const handleFollowDj = useCallback(async (djName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setAddingDjToWatchlist(djName);
    await addToWatchlist(djName);
    setAddingDjToWatchlist(null);
  }, [isAuthenticated, onAuthRequired, addToWatchlist]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const showDropdown = isOpen && query.trim().length > 0;
  const queryInWatchlist = isInWatchlist(query.trim());


  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      {/* Search Input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
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
          placeholder="Search DJs or shows..."
          className="w-full pl-10 pr-10 py-2 bg-white/10 rounded-lg text-white text-base md:text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent focus:bg-white/15 transition-colors border border-white/10"
        />
        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown Results */}
      {showDropdown && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Results Panel - positioned below header */}
          <div className="absolute top-full left-0 right-0 mt-2 bg-surface-elevated rounded-xl border border-gray-800 shadow-2xl z-50 max-h-[70vh] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Add to Watchlist Section - always show when there's a query */}
                <div className="p-3 border-b border-gray-800">
                  <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                    Add to Watchlist
                  </h3>
                  <div className="space-y-1">
                    {/* Add search query to watchlist */}
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">&quot;{query}&quot;</p>
                      </div>
                      <button
                        onClick={handleAddQueryToWatchlist}
                        disabled={addingWatchlistForQuery || queryInWatchlist}
                        className={`p-1.5 rounded transition-colors ${
                          queryInWatchlist
                            ? 'text-accent cursor-default'
                            : 'text-gray-500 hover:text-white hover:bg-white/10'
                        } disabled:opacity-50`}
                        title={queryInWatchlist ? `"${query}" is in your watchlist` : `Add "${query}" to watchlist`}
                      >
                        {addingWatchlistForQuery ? (
                          <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                        ) : queryInWatchlist ? (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* DJs Section */}
                {uniqueDjs.length > 0 && (
                  <div className="p-3 border-b border-gray-800">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                      DJs ({uniqueDjs.length})
                    </h3>
                    <div className="space-y-1">
                      {uniqueDjs.map((dj) => {
                        const djInWatchlist = isInWatchlist(dj.name);
                        const isAddingThisDj = addingDjToWatchlist === dj.name;

                        return (
                          <div
                            key={dj.name}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                          >
                            {/* DJ Avatar */}
                            <div className="w-8 h-8 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {dj.photoUrl ? (
                                <Image
                                  src={dj.photoUrl}
                                  alt={dj.name}
                                  width={32}
                                  height={32}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-white text-sm font-medium">
                                  {dj.name.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>

                            {/* DJ name */}
                            <p className="flex-1 text-white text-sm font-medium truncate">{dj.name}</p>

                            {/* Follow button */}
                            <button
                              onClick={(e) => handleFollowDj(dj.name, e)}
                              disabled={isAddingThisDj || djInWatchlist}
                              className={`p-1.5 rounded transition-colors ${
                                djInWatchlist
                                  ? 'text-accent cursor-default'
                                  : 'text-gray-500 hover:text-white hover:bg-white/10'
                              } disabled:opacity-50`}
                              title={djInWatchlist ? `Following ${dj.name}` : `Follow ${dj.name}`}
                            >
                              {isAddingThisDj ? (
                                <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                              ) : djInWatchlist ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Shows Section */}
                {results.length > 0 && (
                  <div className="p-3">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                      Shows ({results.length})
                    </h3>
                    <div className="space-y-1">
                      {results.map((show) => {
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
                              className="w-1 h-12 rounded-full flex-shrink-0"
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
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {formatShowTime(show.startTime)}
                              </div>
                            </div>

                            {/* Favorite button (star) */}
                            <button
                              onClick={(e) => handleToggleFavorite(show, e)}
                              disabled={isToggling}
                              className="p-1.5 transition-colors disabled:opacity-50"
                              style={{ color: accentColor }}
                              title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
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

                {/* No results message for shows */}
                {results.length === 0 && !isLoading && (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No upcoming shows found for &quot;{query}&quot;
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
