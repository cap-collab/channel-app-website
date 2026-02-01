"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites, Favorite, isRecurringFavorite } from "@/hooks/useFavorites";
import { AuthModal } from "@/components/AuthModal";
import { Header } from "@/components/Header";
import { SearchBar } from "@/components/SearchBar";
import { MyShowsCard } from "@/components/my-shows/MyShowsCard";
import { WatchlistDJCard } from "@/components/my-shows/WatchlistDJCard";
import { getStationById, getStationByMetadataKey } from "@/lib/stations";
import { searchShows, getAllShows } from "@/lib/metadata";
import { Show } from "@/types";

// Cache for DJ profile lookups to avoid repeated queries
interface DJProfileCache {
  username: string;
  photoUrl?: string;
  location?: string;
  genres?: string[];
}
const djProfileCache = new Map<string, DJProfileCache | null>();

// Helper to find station by id OR metadataKey
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

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) {
    return `Today ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow ${timeStr}`;
  } else {
    const dayStr = date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
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

interface CategorizedShow {
  favorite: Favorite;
  show: Show;
}

// Unified type for upcoming shows (both online and IRL)
interface UpcomingShowItem {
  id: string;
  type: 'online' | 'irl';
  sortTime: Date;
  isLive: boolean;
  djName: string;
  djPhotoUrl?: string;
  djUsername?: string;
  djGenres?: string[];
  // Online-specific
  favorite?: Favorite;
  show?: Show;
  stationId?: string;
  // IRL-specific
  irlFavorite?: Favorite;
}

export function MyShowsClient() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();
  const {
    favorites,
    loading: favoritesLoading,
    removeFavorite,
    toggleFavorite,
    isShowFavorited,
    addToWatchlist,
    isInWatchlist,
  } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Show[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [togglingFavorite, setTogglingFavorite] = useState<string | null>(null);
  const [addingToWatchlist, setAddingToWatchlist] = useState(false);
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [showsLoading, setShowsLoading] = useState(true);
  const [djProfiles, setDJProfiles] = useState<Map<string, DJProfileCache>>(new Map());

  // Fetch all shows on mount
  useEffect(() => {
    getAllShows()
      .then(setAllShows)
      .catch(console.error)
      .finally(() => setShowsLoading(false));
  }, []);

  // Separate favorites by type
  const stationShows = favorites.filter(
    (f) => (f.type === "show" || f.type === "dj") && f.stationId && f.stationId !== "CHANNEL"
  );
  const watchlist = favorites.filter((f) => f.type === "search");
  // IRL events - filter to future events only
  const today = new Date().toISOString().split("T")[0];
  const irlEvents = favorites
    .filter((f) => f.type === "irl" && f.irlDate && f.irlDate >= today)
    .sort((a, b) => (a.irlDate || "").localeCompare(b.irlDate || ""));

  // Categorize shows into Live Now, Coming Up, Returning Soon, One-Time
  const categorizedShows = useMemo(() => {
    const now = new Date();
    const liveNow: CategorizedShow[] = [];
    const comingUp: CategorizedShow[] = [];
    const returningSoon: Favorite[] = [];
    const oneTime: Favorite[] = [];

    for (const favorite of stationShows) {
      const matchingShows = findMatchingShows(favorite, allShows);

      // Find live show
      const liveShow = matchingShows.find((show) => {
        const start = new Date(show.startTime);
        const end = new Date(show.endTime);
        return start <= now && end > now;
      });

      if (liveShow) {
        liveNow.push({ favorite, show: liveShow });
        continue;
      }

      // Find upcoming shows (future)
      const upcomingShows = matchingShows
        .filter((show) => new Date(show.startTime) > now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcomingShows.length > 0) {
        const nextShow = upcomingShows[0];
        comingUp.push({ favorite, show: nextShow });
        continue;
      }

      // No upcoming or live shows - categorize based on favorite's showType
      if (isRecurringFavorite(favorite)) {
        returningSoon.push(favorite);
      } else {
        oneTime.push(favorite);
      }
    }

    // Sort coming up by show time
    comingUp.sort(
      (a, b) => new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime()
    );

    return { liveNow, comingUp, returningSoon, oneTime };
  }, [stationShows, allShows]);

  // Look up DJ profiles from Firebase for watchlist and history items
  useEffect(() => {
    async function lookupDJProfiles() {
      // Combine watchlist items and history items that need profile lookups
      const itemsToLookup = [
        ...watchlist,
        ...categorizedShows.returningSoon,
        ...categorizedShows.oneTime,
      ];

      if (!db || itemsToLookup.length === 0) return;

      const newProfiles = new Map<string, DJProfileCache>();

      for (const item of itemsToLookup) {
        // Use djName for history items (shows), term for watchlist
        const name = (item.djName || item.term).toLowerCase();

        // Check cache first
        if (djProfileCache.has(name)) {
          const cached = djProfileCache.get(name);
          if (cached) newProfiles.set(name, cached);
          continue;
        }

        // Normalize the name the same way as chatUsernameNormalized
        const normalized = name.replace(/[\s-]+/g, "").toLowerCase();

        try {
          // Check pending-dj-profiles first
          const pendingRef = collection(db, "pending-dj-profiles");
          const pendingQ = query(
            pendingRef,
            where("chatUsernameNormalized", "==", normalized)
          );
          const pendingSnapshot = await getDocs(pendingQ);
          const pendingDoc = pendingSnapshot.docs.find(
            (doc) => doc.data().status === "pending"
          );

          if (pendingDoc) {
            const data = pendingDoc.data();
            const profile: DJProfileCache = {
              username: data.chatUsername,
              photoUrl: data.djProfile?.photoUrl || undefined,
              location: data.djProfile?.location || undefined,
              genres: data.djProfile?.genres || undefined,
            };
            djProfileCache.set(name, profile);
            newProfiles.set(name, profile);
            continue;
          }

          // Check users collection
          const usersRef = collection(db, "users");
          const usersQ = query(
            usersRef,
            where("chatUsernameNormalized", "==", normalized),
            where("role", "in", ["dj", "broadcaster", "admin"])
          );
          const usersSnapshot = await getDocs(usersQ);

          if (!usersSnapshot.empty) {
            const data = usersSnapshot.docs[0].data();
            const profile: DJProfileCache = {
              username: data.chatUsername,
              photoUrl: data.djProfile?.photoUrl || undefined,
              location: data.djProfile?.location || undefined,
              genres: data.djProfile?.genres || undefined,
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
        setDJProfiles((prev) => {
          const merged = new Map(prev);
          newProfiles.forEach((value, key) => merged.set(key, value));
          return merged;
        });
      }
    }

    lookupDJProfiles();
  }, [watchlist, categorizedShows.returningSoon, categorizedShows.oneTime]);

  // Create unified upcoming shows list (online + IRL)
  const upcomingShows = useMemo(() => {
    const items: UpcomingShowItem[] = [];

    // Add live online shows
    for (const { favorite, show } of categorizedShows.liveNow) {
      items.push({
        id: `online-live-${favorite.id}`,
        type: 'online',
        sortTime: new Date(show.startTime),
        isLive: true,
        djName: show.dj || favorite.djName || favorite.showName || favorite.term,
        djPhotoUrl: show.djPhotoUrl || show.imageUrl,
        djUsername: show.djUsername,
        djGenres: show.djGenres,
        favorite,
        show,
        stationId: show.stationId,
      });
    }

    // Add coming up online shows
    for (const { favorite, show } of categorizedShows.comingUp) {
      items.push({
        id: `online-upcoming-${favorite.id}`,
        type: 'online',
        sortTime: new Date(show.startTime),
        isLive: false,
        djName: show.dj || favorite.djName || favorite.showName || favorite.term,
        djPhotoUrl: show.djPhotoUrl || show.imageUrl,
        djUsername: show.djUsername,
        djGenres: show.djGenres,
        favorite,
        show,
        stationId: show.stationId,
      });
    }

    // Add IRL events
    for (const irlFavorite of irlEvents) {
      items.push({
        id: `irl-${irlFavorite.id}`,
        type: 'irl',
        sortTime: new Date(irlFavorite.irlDate + 'T00:00:00'),
        isLive: false,
        djName: irlFavorite.djName || irlFavorite.term,
        djPhotoUrl: irlFavorite.djPhotoUrl,
        djUsername: irlFavorite.djUsername,
        djGenres: undefined,
        irlFavorite,
      });
    }

    // Sort: live shows first, then by time
    return items.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return a.sortTime.getTime() - b.sortTime.getTime();
    });
  }, [categorizedShows, irlEvents]);

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const results = await searchShows(query);
      const now = new Date();
      const filtered = results.filter((show) => new Date(show.endTime) > now);
      setSearchResults(filtered);
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleRemove = async (favorite: Favorite) => {
    setRemoving(favorite.id);
    const mockShow = {
      id: favorite.id,
      name: favorite.showName || favorite.term,
      dj: favorite.djName,
      stationId: favorite.stationId || "",
      startTime: "",
      endTime: "",
    };
    await removeFavorite(mockShow);
    setRemoving(null);
  };

  const handleToggleFavorite = async (show: Show) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setTogglingFavorite(show.id);
    await toggleFavorite(show);
    setTogglingFavorite(null);
  };

  const handleAddToWatchlist = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!searchQuery.trim()) return;
    setAddingToWatchlist(true);
    await addToWatchlist(searchQuery.trim());
    setAddingToWatchlist(false);
  };

  if (authLoading || favoritesLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const isSearching = searchQuery.trim().length > 0;
  const watchlistHasTerm = isInWatchlist(searchQuery.trim());

  // Render search result card
  const renderSearchResultCard = (show: Show) => {
    const station = getStation(show.stationId);
    const accentColor = station?.accentColor || "#fff";
    const isFavorited = isShowFavorited(show);
    const isToggling = togglingFavorite === show.id;

    return (
      <div
        key={show.id}
        className="flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50"
      >
        <div
          className="w-1 flex-shrink-0"
          style={{ backgroundColor: accentColor }}
        />
        <div className="flex-1 px-3 py-2.5">
          <div className="flex items-center justify-between mb-1">
            <span
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: accentColor }}
            >
              {station?.name || show.stationId}
            </span>
            <button
              onClick={() => handleToggleFavorite(show)}
              disabled={isToggling}
              className="p-0.5 transition-colors disabled:opacity-50"
              style={{ color: accentColor }}
              aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
            >
              {isToggling ? (
                <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
              ) : (
                <svg
                  className="w-4 h-4"
                  fill={isFavorited ? "currentColor" : "none"}
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
          <p className="font-medium text-white text-sm leading-snug line-clamp-2">
            {show.name}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            {show.dj && (
              <>
                <span className="truncate max-w-[120px]">{show.dj}</span>
                <span>·</span>
              </>
            )}
            <span>{formatShowTime(show.startTime)}</span>
          </div>
          {show.type && (show.type === "weekly" || show.type === "monthly") && (
            <div className="mt-1.5">
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                {show.type}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="my-shows" position="sticky" />

      {/* Search Bar - Full width */}
      <div className="px-8 lg:px-16 py-4 border-b border-gray-900">
        <SearchBar onSearch={handleSearch} placeholder="Search DJ or show..." />
      </div>

      <main className="px-8 lg:px-16 py-6 pb-20">
        {!isAuthenticated ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">Sign in to see your saved shows</p>
          </div>
        ) : favorites.length === 0 && !isSearching ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No saved shows yet</p>
            <p className="text-gray-600 text-sm">Search above to find and save shows</p>
          </div>
        ) : showsLoading && !isSearching ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-10">
            {/* Search Results */}
            {isSearching && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Show Search Results */}
                <section>
                  <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4">
                    Shows ({searchResults.length})
                  </h2>
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                    </div>
                  ) : searchResults.length === 0 ? (
                    <p className="text-gray-600 text-sm py-4">
                      No upcoming shows found for &quot;{searchQuery}&quot;
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {searchResults.slice(0, 15).map((show) => renderSearchResultCard(show))}
                    </div>
                  )}
                </section>

                {/* Add to Watchlist */}
                <section>
                  <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4">
                    Add to Watchlist
                  </h2>
                  {!watchlistHasTerm ? (
                    <button
                      onClick={handleAddToWatchlist}
                      disabled={addingToWatchlist}
                      className="w-full py-3 px-4 bg-[#1a1a1a] border border-gray-800/50 rounded-xl text-white text-sm font-medium hover:bg-[#252525] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {addingToWatchlist ? (
                        <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          Add &quot;{searchQuery}&quot; to Watchlist
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50">
                      <div className="w-1 flex-shrink-0 bg-white" />
                      <div className="flex-1 px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-white">
                            IN YOUR WATCHLIST
                          </span>
                          <button
                            onClick={async () => {
                              const watchlistItem = watchlist.find(
                                (f) => f.term.toLowerCase() === searchQuery.trim().toLowerCase()
                              );
                              if (watchlistItem) {
                                await handleRemove(watchlistItem);
                              }
                            }}
                            className="p-0.5 transition-colors text-white hover:text-red-400"
                            aria-label="Remove from watchlist"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </button>
                        </div>
                        <p className="font-medium text-white text-sm leading-snug">
                          &quot;{searchQuery}&quot;
                        </p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>Click star to remove</span>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Section 1: Upcoming Shows (IRL + Online combined) */}
            {upcomingShows.length > 0 && (
              <section>
                <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Upcoming Shows ({upcomingShows.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {upcomingShows.map((item) => {
                    const station = item.stationId ? getStation(item.stationId) : undefined;
                    const accentColor = station?.accentColor || "#22c55e"; // Green for IRL

                    if (item.type === 'irl' && item.irlFavorite) {
                      return (
                        <MyShowsCard
                          key={item.id}
                          showType="irl"
                          djName={item.djName}
                          djPhotoUrl={item.djPhotoUrl}
                          djUsername={item.djUsername}
                          accentColor={accentColor}
                          isLive={false}
                          eventName={item.irlFavorite.irlEventName || item.irlFavorite.showName}
                          eventLocation={item.irlFavorite.irlLocation}
                          eventDate={item.irlFavorite.irlDate}
                          ticketUrl={item.irlFavorite.irlTicketUrl}
                          onRemove={() => handleRemove(item.irlFavorite!)}
                          isRemoving={removing === item.irlFavorite.id}
                        />
                      );
                    }

                    if (item.type === 'online' && item.favorite && item.show) {
                      return (
                        <MyShowsCard
                          key={item.id}
                          showType="online"
                          djName={item.djName}
                          djPhotoUrl={item.djPhotoUrl}
                          djUsername={item.djUsername}
                          accentColor={accentColor}
                          isLive={item.isLive}
                          showName={item.show.name}
                          stationName={station?.name || item.stationId}
                          startTime={item.show.startTime}
                          djGenres={item.djGenres}
                          onRemove={() => handleRemove(item.favorite!)}
                          isRemoving={removing === item.favorite.id}
                        />
                      );
                    }

                    return null;
                  })}
                </div>
              </section>
            )}

            {/* Section 2: DJs on Watchlist */}
            {watchlist.length > 0 && (
              <section>
                <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  DJs on Watchlist ({watchlist.length})
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {watchlist.map((favorite) => {
                    const djProfile = djProfiles.get(favorite.term.toLowerCase());
                    const displayName = djProfile?.username || favorite.term.charAt(0).toUpperCase() + favorite.term.slice(1);

                    return (
                      <WatchlistDJCard
                        key={favorite.id}
                        djName={displayName}
                        djPhotoUrl={djProfile?.photoUrl}
                        djUsername={djProfile?.username}
                        djLocation={djProfile?.location}
                        djGenres={djProfile?.genres}
                        onRemove={() => handleRemove(favorite)}
                        isRemoving={removing === favorite.id}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Section 3: Show History */}
            {(categorizedShows.returningSoon.length > 0 || categorizedShows.oneTime.length > 0) && (
              <section>
                <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Show History
                </h2>

                {/* Coming Back Soon */}
                {categorizedShows.returningSoon.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                      Coming Back Soon ({categorizedShows.returningSoon.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {categorizedShows.returningSoon.map((favorite) => {
                        const station = getStation(favorite.stationId);
                        const accentColor = station?.accentColor || "#fff";
                        // Look up DJ profile from cache
                        const djName = favorite.djName || favorite.term;
                        const djProfile = djProfiles.get(djName.toLowerCase());

                        return (
                          <MyShowsCard
                            key={favorite.id}
                            showType="online"
                            djName={djName}
                            djPhotoUrl={favorite.djPhotoUrl || djProfile?.photoUrl}
                            djUsername={favorite.djUsername || djProfile?.username}
                            accentColor={accentColor}
                            isLive={false}
                            showName={favorite.showName || favorite.term}
                            stationName={station?.name || favorite.stationId}
                            onRemove={() => handleRemove(favorite)}
                            isRemoving={removing === favorite.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* One-Time Events */}
                {categorizedShows.oneTime.length > 0 && (
                  <div>
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                      One-Time Events ({categorizedShows.oneTime.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {categorizedShows.oneTime.map((favorite) => {
                        const station = getStation(favorite.stationId);
                        const accentColor = station?.accentColor || "#fff";
                        // Look up DJ profile from cache
                        const djName = favorite.djName || favorite.term;
                        const djProfile = djProfiles.get(djName.toLowerCase());

                        return (
                          <MyShowsCard
                            key={favorite.id}
                            showType="online"
                            djName={djName}
                            djPhotoUrl={favorite.djPhotoUrl || djProfile?.photoUrl}
                            djUsername={favorite.djUsername || djProfile?.username}
                            accentColor={accentColor}
                            isLive={false}
                            showName={favorite.showName || favorite.term}
                            stationName={station?.name || favorite.stationId}
                            onRemove={() => handleRemove(favorite)}
                            isRemoving={removing === favorite.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Empty state */}
            {!isSearching &&
              upcomingShows.length === 0 &&
              watchlist.length === 0 &&
              categorizedShows.returningSoon.length === 0 &&
              categorizedShows.oneTime.length === 0 && (
              <p className="text-gray-600 text-sm py-4 text-center">No saved shows yet. Search above to find and save shows.</p>
            )}
          </div>
        )}
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
