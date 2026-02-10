'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { collection, query as fbQuery, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { searchShows } from '@/lib/metadata';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { Show } from '@/types';
import { getStationById, getStationByMetadataKey, STATIONS } from '@/lib/stations';
import { ExpandedShowCard } from './channel/ExpandedShowCard';

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
  const { toggleFavorite, isShowFavorited, addToWatchlist, isInWatchlist, isExactlyInWatchlist, followDJ } = useFavorites();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Show[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addingWatchlistForQuery, setAddingWatchlistForQuery] = useState(false);
  const [addingDjToWatchlist, setAddingDjToWatchlist] = useState<string | null>(null);
  const [pendingDjs, setPendingDjs] = useState<Array<{ name: string; photoUrl?: string; username: string; odId?: string; email?: string }>>([]);
  const [registeredDjs, setRegisteredDjs] = useState<Array<{ name: string; photoUrl?: string; username: string; odId?: string; email?: string }>>([]);
  const [expandedShow, setExpandedShow] = useState<Show | null>(null);
  const [togglingExpandedFavorite, setTogglingExpandedFavorite] = useState(false);

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

  // Search pending DJ profiles and registered DJ profiles
  useEffect(() => {
    if (!query.trim() || !db) {
      setPendingDjs([]);
      setRegisteredDjs([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (!db) return;
      const queryLower = query.toLowerCase();

      // Search pending DJ profiles
      try {
        const pendingRef = collection(db, 'pending-dj-profiles');
        const pendingQ = fbQuery(pendingRef, where('status', '==', 'pending'));
        const snapshot = await getDocs(pendingQ);

        const matchingPendingDjs: Array<{ name: string; photoUrl?: string; username: string; odId?: string; email?: string }> = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const username = data.chatUsername || '';
          if (username.toLowerCase().includes(queryLower)) {
            matchingPendingDjs.push({
              name: username,
              photoUrl: data.djProfile?.photoUrl || undefined,
              username: data.chatUsernameNormalized || username.toLowerCase(),
              odId: docSnap.id,
              email: data.email || undefined,
            });
          }
        });

        setPendingDjs(matchingPendingDjs.slice(0, 5));
      } catch (error) {
        console.error('Error searching pending DJs:', error);
        setPendingDjs([]);
      }

      // Search registered DJ profiles (users with DJ role or djProfile)
      try {
        const usersRef = collection(db, 'users');
        // Search users who have role 'dj' or djProfile
        const djRoleQ = fbQuery(usersRef, where('role', '==', 'dj'));
        const djRoleSnapshot = await getDocs(djRoleQ);

        const matchingRegisteredDjs: Array<{ name: string; photoUrl?: string; username: string; odId?: string; email?: string }> = [];
        const seenUsernames = new Set<string>();

        djRoleSnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const username = data.chatUsername || data.displayName || '';
          const normalizedUsername = data.chatUsernameNormalized || username.replace(/[\s-]+/g, '').toLowerCase();

          // Check if username matches query
          if (username.toLowerCase().includes(queryLower) && !seenUsernames.has(normalizedUsername)) {
            seenUsernames.add(normalizedUsername);
            matchingRegisteredDjs.push({
              name: username,
              photoUrl: data.djProfile?.photoUrl || undefined,
              username: normalizedUsername,
              odId: docSnap.id,
              email: data.email || undefined,
            });
          }
        });

        setRegisteredDjs(matchingRegisteredDjs.slice(0, 10));
      } catch (error) {
        console.error('Error searching registered DJs:', error);
        setRegisteredDjs([]);
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

  // Combine all DJ profiles (pending + registered) - deduplicated
  const allDjProfiles = useMemo(() => {
    const djMap = new Map<string, { name: string; photoUrl?: string; username: string; odId?: string; email?: string }>();

    // Add registered DJs first (they take priority)
    for (const dj of registeredDjs) {
      const key = dj.username.toLowerCase();
      if (!djMap.has(key)) {
        djMap.set(key, dj);
      }
    }

    // Add pending DJs (won't overwrite registered ones)
    for (const dj of pendingDjs) {
      const key = dj.username.toLowerCase();
      if (!djMap.has(key)) {
        djMap.set(key, dj);
      }
    }

    return Array.from(djMap.values()).slice(0, 10);
  }, [pendingDjs, registeredDjs]);

  // DJs list: only show DJ profiles (registered + pending)
  const combinedDjs = useMemo(() => {
    return allDjProfiles.map(dj => ({
      ...dj,
      hasProfile: true,
      firstShow: undefined as Show | undefined,
    }));
  }, [allDjProfiles]);

  // Check if query exactly matches a DJ profile name (for hiding watchlist section)
  const queryMatchesDjProfile = useMemo(() => {
    const queryLower = query.trim().toLowerCase();
    return allDjProfiles.some(dj => dj.name.toLowerCase() === queryLower);
  }, [query, allDjProfiles]);

  const handleFollowDj = useCallback(async (djName: string, djUserId?: string, djEmail?: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setAddingDjToWatchlist(djName);
    // Use unified followDJ function with DJ profile data for reliable matching
    await followDJ(djName, djUserId, djEmail);
    setAddingDjToWatchlist(null);
  }, [isAuthenticated, onAuthRequired, followDJ]);

  const handleShowClick = useCallback((show: Show) => {
    setExpandedShow(show);
  }, []);

  const handleExpandedToggleFavorite = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!expandedShow) return;
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setTogglingExpandedFavorite(true);
    await toggleFavorite(expandedShow);
    setTogglingExpandedFavorite(false);
  }, [expandedShow, isAuthenticated, onAuthRequired, toggleFavorite]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const showDropdown = isOpen && query.trim().length > 0;
  // Use exact match for search query to avoid false positives
  // e.g. "skee" should not show as in watchlist just because "skee mask" is
  const queryInWatchlist = isExactlyInWatchlist(query.trim());


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
          placeholder="Search DJs"
          className={`w-full pl-10 py-2 bg-white/10 rounded-none text-white text-base md:text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent focus:bg-white/15 transition-colors border border-white/10 ${query ? 'pr-10' : 'pr-4'}`}
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
          {/* Backdrop - starts below header to not block header clicks */}
          <div
            className="fixed inset-0 top-[60px] z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Results Panel - fixed full-width on mobile, absolute on desktop */}
          <div className="fixed md:absolute inset-x-4 md:inset-x-auto md:left-0 md:right-0 top-[60px] md:top-full mt-0 md:mt-2 bg-surface-elevated rounded-xl border border-gray-800 shadow-2xl z-50 max-h-[70vh] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Add to Watchlist Section - hide if query exactly matches a DJ profile */}
                {!queryMatchesDjProfile && (
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
                )}

                {/* DJs Section - combines DJ profiles and DJs with upcoming shows */}
                {combinedDjs.length > 0 && (
                  <div className="p-3 border-b border-gray-800">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                      DJs ({combinedDjs.length})
                    </h3>
                    <div className="space-y-1">
                      {combinedDjs.map((dj) => {
                        const djInWatchlist = isInWatchlist(dj.name);
                        const isAddingThisDj = addingDjToWatchlist === dj.name;

                        // For DJs with profiles: clicking opens profile page
                        // For DJs without profiles: clicking opens their first show's expanded card
                        const content = (
                          <>
                            <div className="w-8 h-8 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {dj.photoUrl ? (
                                <Image
                                  src={dj.photoUrl}
                                  alt={dj.name}
                                  width={32}
                                  height={32}
                                  className="w-full h-full object-cover"
                                  unoptimized
                                />
                              ) : (
                                <span className="text-white text-sm font-medium">
                                  {dj.name.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <p className="flex-1 text-white text-sm font-medium truncate">{dj.name}</p>
                          </>
                        );

                        return (
                          <div
                            key={dj.username}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                          >
                            {dj.hasProfile ? (
                              <Link
                                href={`/dj/${dj.username}`}
                                onClick={() => setIsOpen(false)}
                                className="flex items-center gap-3 flex-1 min-w-0"
                              >
                                {content}
                              </Link>
                            ) : (
                              <button
                                onClick={() => {
                                  if (dj.firstShow) {
                                    handleShowClick(dj.firstShow);
                                  }
                                }}
                                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                              >
                                {content}
                              </button>
                            )}

                            {/* Follow button */}
                            <button
                              onClick={(e) => handleFollowDj(dj.name, dj.odId, dj.email, e)}
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
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                            onClick={() => handleShowClick(show)}
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

      {/* Expanded Show Card */}
      {/* Expanded Show Card - rendered via portal to escape stacking context */}
      {expandedShow && typeof document !== 'undefined' && createPortal(
        (() => {
          const station = getStation(expandedShow.stationId) || STATIONS[0];
          const now = new Date();
          const startDate = new Date(expandedShow.startTime);
          const endDate = new Date(expandedShow.endTime);
          const isLive = now >= startDate && now <= endDate;

          return (
            <ExpandedShowCard
              show={expandedShow}
              station={station}
              isLive={isLive}
              onClose={() => setExpandedShow(null)}
              isFavorited={isShowFavorited(expandedShow)}
              isTogglingFavorite={togglingExpandedFavorite}
              onToggleFavorite={handleExpandedToggleFavorite}
              canTip={!!expandedShow.djUserId}
              isAuthenticated={isAuthenticated}
              timeDisplay={formatShowTime(expandedShow.startTime)}
            />
          );
        })(),
        document.body
      )}
    </div>
  );
}
