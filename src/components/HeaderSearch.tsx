'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { collection, query as fbQuery, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { Show } from '@/types';
import { Collective, Venue } from '@/types/events';
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

// Module-level cache for DJ profiles to avoid re-fetching Firestore on every search
type DjEntry = { name: string; photoUrl?: string; username: string; odId?: string; email?: string };
let djCache: {
  pending: DjEntry[];
  registered: DjEntry[];
  timestamp: number;
} | null = null;
const DJ_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Module-level cache for collectives and venues
type CollectiveEntry = { id: string; name: string; slug: string; photo?: string | null; location?: string | null };
type VenueEntry = { id: string; name: string; slug: string; photo?: string | null; location?: string | null };
let collectivesVenuesCache: {
  collectives: CollectiveEntry[];
  venues: VenueEntry[];
  timestamp: number;
} | null = null;
const CV_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface HeaderSearchProps {
  onAuthRequired?: () => void;
}

export function HeaderSearch({ onAuthRequired }: HeaderSearchProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuthContext();
  const { shows: contextShows } = useSchedule();
  const { toggleFavorite, isShowFavorited, addToWatchlist, isInWatchlist, isExactlyInWatchlist, followDJ } = useFavorites();

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addingWatchlistForQuery, setAddingWatchlistForQuery] = useState(false);
  const [addingDjToWatchlist, setAddingDjToWatchlist] = useState<string | null>(null);
  const [pendingDjs, setPendingDjs] = useState<DjEntry[]>([]);
  const [registeredDjs, setRegisteredDjs] = useState<DjEntry[]>([]);
  const [isDjLoading, setIsDjLoading] = useState(false);
  const [expandedShow, setExpandedShow] = useState<Show | null>(null);
  const [togglingExpandedFavorite, setTogglingExpandedFavorite] = useState(false);
  const [matchingCollectives, setMatchingCollectives] = useState<CollectiveEntry[]>([]);
  const [matchingVenues, setMatchingVenues] = useState<VenueEntry[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const showDropdown = isOpen && query.trim().length > 0;

  // Instant show search using already-loaded schedule data
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    const now = new Date();
    return contextShows
      .filter((show) => {
        if (new Date(show.endTime) <= now) return false;
        const nameMatch = show.name.toLowerCase().includes(lowerQuery);
        const djMatch = show.dj?.toLowerCase().includes(lowerQuery);
        return nameMatch || djMatch;
      })
      .slice(0, 15);
  }, [query, contextShows]);

  // Search DJ profiles with module-level cache
  useEffect(() => {
    if (!query.trim() || !db) {
      setPendingDjs([]);
      setRegisteredDjs([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (!db) return;
      const queryLower = query.toLowerCase();

      // Populate cache if stale or missing
      if (!djCache || Date.now() - djCache.timestamp > DJ_CACHE_TTL) {
        setIsDjLoading(true);
        try {
          const allPending: DjEntry[] = [];
          const pendingSnapshot = await getDocs(fbQuery(collection(db, 'pending-dj-profiles')));
          pendingSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const username = data.chatUsername || '';
            if (username) {
              allPending.push({
                name: username,
                photoUrl: data.djProfile?.photoUrl || undefined,
                username: data.chatUsernameNormalized || username.toLowerCase(),
                odId: docSnap.id,
                email: data.email || undefined,
              });
            }
          });

          const allRegistered: DjEntry[] = [];
          const seenUsernames = new Set<string>();
          const djRoleSnapshot = await getDocs(fbQuery(collection(db, 'users'), where('role', '==', 'dj')));
          djRoleSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const username = data.chatUsername || data.displayName || '';
            const normalizedUsername = data.chatUsernameNormalized || username.replace(/[\s-]+/g, '').toLowerCase();
            if (username && !seenUsernames.has(normalizedUsername)) {
              seenUsernames.add(normalizedUsername);
              allRegistered.push({
                name: username,
                photoUrl: data.djProfile?.photoUrl || undefined,
                username: normalizedUsername,
                odId: docSnap.id,
                email: data.email || undefined,
              });
            }
          });

          djCache = { pending: allPending, registered: allRegistered, timestamp: Date.now() };
        } catch (error) {
          console.error('Error fetching DJ profiles:', error);
          setIsDjLoading(false);
          return;
        }
        setIsDjLoading(false);
      }

      // Filter cached data
      setPendingDjs(
        djCache.pending.filter((dj) => dj.name.toLowerCase().includes(queryLower)).slice(0, 5)
      );
      setRegisteredDjs(
        djCache.registered.filter((dj) => dj.name.toLowerCase().includes(queryLower)).slice(0, 10)
      );
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Search collectives and venues with module-level cache
  useEffect(() => {
    if (!query.trim() || !db) {
      setMatchingCollectives([]);
      setMatchingVenues([]);
      return;
    }

    const timer = setTimeout(async () => {
      if (!db) return;
      const queryLower = query.toLowerCase();

      // Populate cache if stale or missing
      if (!collectivesVenuesCache || Date.now() - collectivesVenuesCache.timestamp > CV_CACHE_TTL) {
        try {
          const allCollectives: CollectiveEntry[] = [];
          const collectivesSnapshot = await getDocs(fbQuery(collection(db, 'collectives')));
          collectivesSnapshot.forEach((docSnap) => {
            const data = docSnap.data() as Collective;
            allCollectives.push({
              id: docSnap.id,
              name: data.name,
              slug: data.slug,
              photo: data.photo,
              location: data.location,
            });
          });

          const allVenues: VenueEntry[] = [];
          const venuesSnapshot = await getDocs(fbQuery(collection(db, 'venues')));
          venuesSnapshot.forEach((docSnap) => {
            const data = docSnap.data() as Venue;
            allVenues.push({
              id: docSnap.id,
              name: data.name,
              slug: data.slug,
              photo: data.photo,
              location: data.location,
            });
          });

          collectivesVenuesCache = { collectives: allCollectives, venues: allVenues, timestamp: Date.now() };
        } catch (error) {
          console.error('Error fetching collectives/venues:', error);
          return;
        }
      }

      // Filter cached data
      setMatchingCollectives(
        collectivesVenuesCache.collectives.filter((c) => c.name.toLowerCase().includes(queryLower)).slice(0, 5)
      );
      setMatchingVenues(
        collectivesVenuesCache.venues.filter((v) => v.name.toLowerCase().includes(queryLower)).slice(0, 5)
      );
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown when clicking outside (check both container and portal dropdown)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Position dropdown portal relative to the search container
  useEffect(() => {
    if (!showDropdown || !containerRef.current) return;
    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [showDropdown]);

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
    setIsOpen(false);
  };

  // Use exact match for search query to avoid false positives
  // e.g. "skee" should not show as in watchlist just because "skee mask" is
  const queryInWatchlist = isExactlyInWatchlist(query.trim());


  return (
    <div ref={containerRef} className={`relative flex-1 max-w-md ${showDropdown ? 'z-50' : ''}`}>
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
          placeholder="Search DJs, collectives, venues"
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

      {/* Dropdown Results - rendered via portal to escape stacking context */}
      {showDropdown && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop - starts below header to not block header clicks */}
          <div
            className="fixed inset-0 top-[60px] z-[9998]"
            onClick={() => setIsOpen(false)}
          />

          {/* Results Panel - fixed positioned below search bar */}
          <div ref={dropdownRef} style={dropdownStyle} className="z-[9999] bg-surface-elevated rounded-xl border border-gray-800 shadow-2xl max-h-[60vh] overflow-y-auto">
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
                {(combinedDjs.length > 0 || isDjLoading) && (
                  <div className="p-3 border-b border-gray-800">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1 flex items-center gap-2">
                      DJs {combinedDjs.length > 0 && `(${combinedDjs.length})`}
                      {isDjLoading && <div className="w-3 h-3 border-2 border-gray-700 border-t-white rounded-full animate-spin" />}
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

                {/* Collectives Section */}
                {matchingCollectives.length > 0 && (
                  <div className="p-3 border-b border-gray-800">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                      Collectives ({matchingCollectives.length})
                    </h3>
                    <div className="space-y-1">
                      {matchingCollectives.map((collective) => (
                        <Link
                          key={collective.id}
                          href={`/collective/${collective.slug}`}
                          onClick={() => setIsOpen(false)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                            {collective.photo ? (
                              <Image
                                src={collective.photo}
                                alt={collective.name}
                                width={32}
                                height={32}
                                className="w-full h-full object-cover"
                                unoptimized
                              />
                            ) : (
                              <span className="text-white text-sm font-medium">
                                {collective.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{collective.name}</p>
                            {collective.location && (
                              <p className="text-gray-500 text-xs truncate">{collective.location}</p>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Venues Section */}
                {matchingVenues.length > 0 && (
                  <div className="p-3 border-b border-gray-800">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-2 px-1">
                      Venues ({matchingVenues.length})
                    </h3>
                    <div className="space-y-1">
                      {matchingVenues.map((venue) => (
                        <Link
                          key={venue.id}
                          href={`/venue/${venue.slug}`}
                          onClick={() => setIsOpen(false)}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                            {venue.photo ? (
                              <Image
                                src={venue.photo}
                                alt={venue.name}
                                width={32}
                                height={32}
                                className="w-full h-full object-cover"
                                unoptimized
                              />
                            ) : (
                              <span className="text-white text-sm font-medium">
                                {venue.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{venue.name}</p>
                            {venue.location && (
                              <p className="text-gray-500 text-xs truncate">{venue.location}</p>
                            )}
                          </div>
                        </Link>
                      ))}
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
                            onClick={async () => {
                              if (show.djUsername) {
                                setIsOpen(false);
                                router.push(`/dj/${show.djUsername}`);
                              } else {
                                if (!isAuthenticated) {
                                  onAuthRequired?.();
                                  return;
                                }
                                setTogglingId(show.id);
                                await toggleFavorite(show);
                                setTogglingId(null);
                              }
                            }}
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

                {/* No results message */}
                {results.length === 0 && combinedDjs.length === 0 && matchingCollectives.length === 0 && matchingVenues.length === 0 && !isDjLoading && (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No upcoming shows found for &quot;{query}&quot;
                  </div>
                )}
              </>
          </div>
        </>,
        document.body
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
