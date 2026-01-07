"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites, Favorite, isRecurringFavorite } from "@/hooks/useFavorites";
import { AuthModal } from "@/components/AuthModal";
import { SearchBar } from "@/components/SearchBar";
import { getStationById, getStationByMetadataKey } from "@/lib/stations";
import { searchShows, getAllShows } from "@/lib/metadata";
import { Show } from "@/types";

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
  return allShows.filter((show) => {
    // Match by station if specified
    if (favorite.stationId) {
      const favStation = getStation(favorite.stationId);
      const showStation = getStation(show.stationId);
      if (favStation?.id !== showStation?.id) return false;
    }
    // Match by name or DJ
    const nameMatch = show.name.toLowerCase().includes(term);
    const djMatch = show.dj?.toLowerCase().includes(term);
    return nameMatch || djMatch;
  });
}

interface CategorizedShow {
  favorite: Favorite;
  show: Show;
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

  // Fetch all shows on mount
  useEffect(() => {
    getAllShows()
      .then(setAllShows)
      .catch(console.error)
      .finally(() => setShowsLoading(false));
  }, []);

  // Separate favorites by type
  const stationShows = favorites.filter(
    (f) => (f.type === "show" || f.type === "dj") && f.stationId
  );
  const watchlist = favorites.filter((f) => f.type === "search" || !f.stationId);

  // Categorize shows into Live Now, Coming Up, Returning Soon, Watchlist, One-Time
  const categorizedShows = useMemo(() => {
    const now = new Date();
    const liveNow: CategorizedShow[] = [];
    const comingUp: CategorizedShow[] = [];
    const returningSoon: Favorite[] = []; // Recurring shows not currently scheduled
    const oneTime: Favorite[] = [];
    const processedForUpcoming = new Set<string>(); // Track which favorites have upcoming shows

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
        processedForUpcoming.add(favorite.id);
        continue;
      }

      // Find upcoming shows (future)
      const upcomingShows = matchingShows
        .filter((show) => new Date(show.startTime) > now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcomingShows.length > 0) {
        const nextShow = upcomingShows[0];
        comingUp.push({ favorite, show: nextShow });
        processedForUpcoming.add(favorite.id);
        continue;
      }

      // No upcoming or live shows - categorize based on favorite's showType
      // Use showType stored in favorite (from iOS) to determine if recurring
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

  // Handle search
  const handleSearch = async (query: string) => {
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
  };

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

  // Render a favorite card
  const renderFavoriteCard = (favorite: Favorite, showInfo?: Show) => {
    const station = getStation(favorite.stationId);
    const accentColor = station?.accentColor || "#fff";
    const isLive = showInfo && new Date(showInfo.startTime) <= new Date() && new Date(showInfo.endTime) > new Date();

    return (
      <div
        key={favorite.id}
        className="flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50"
      >
        {/* Left accent bar */}
        <div
          className="w-1 flex-shrink-0"
          style={{ backgroundColor: accentColor }}
        />
        <div className="flex-1 px-3 py-2.5">
          {/* Station name + remove button */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: accentColor }}
              >
                {station?.name || favorite.stationId}
              </span>
              {isLive && (
                <span className="flex items-center gap-1 text-[10px] text-red-500">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <button
              onClick={() => handleRemove(favorite)}
              disabled={removing === favorite.id}
              className="p-0.5 transition-colors disabled:opacity-50"
              style={{ color: accentColor }}
              aria-label="Remove from favorites"
            >
              {removing === favorite.id ? (
                <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              )}
            </button>
          </div>
          {/* Show name */}
          <p className="font-medium text-white text-sm leading-snug line-clamp-2">
            {favorite.showName || favorite.term}
          </p>
          {/* DJ and time */}
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            {favorite.djName && (
              <>
                <span className="truncate max-w-[120px]">{favorite.djName}</span>
                {showInfo && <span>·</span>}
              </>
            )}
            {showInfo && <span>{formatShowTime(showInfo.startTime)}</span>}
          </div>
          {/* Show type badge */}
          {showInfo?.type && (showInfo.type === "weekly" || showInfo.type === "monthly") && (
            <div className="mt-1.5">
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                {showInfo.type}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="p-4 border-b border-gray-900">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div />
          <h1 className="text-lg font-medium text-white">My Shows</h1>
          <Link
            href="/settings"
            className="text-gray-600 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </Link>
        </div>
      </header>

      {/* Search Bar */}
      <div className="px-4 py-3 border-b border-gray-900 max-w-xl mx-auto">
        <SearchBar onSearch={handleSearch} placeholder="Search DJ or show..." />
      </div>

      <main className="max-w-xl mx-auto p-4">
        {isSearching ? (
          /* Search Results View */
          <div className="space-y-6">
            {searchLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Search Results */}
                <section>
                  <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                    Upcoming Shows Matching ({searchResults.length})
                  </h2>
                  {searchResults.length === 0 ? (
                    <p className="text-gray-600 text-sm py-4">
                      No upcoming shows found for &quot;{searchQuery}&quot;
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {searchResults.slice(0, 20).map((show) => {
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
                      })}
                    </div>
                  )}
                </section>

                {/* Add to Watchlist */}
                {!watchlistHasTerm && (
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
                )}
                {watchlistHasTerm && (
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
                        <span>Tap star to remove</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : !isAuthenticated ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">Sign in to see your saved shows</p>
          </div>
        ) : favorites.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No saved shows yet</p>
            <p className="text-gray-600 text-sm">Search above to find and save shows</p>
          </div>
        ) : showsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          /* Favorites View - Organized by category */
          <div className="space-y-8">
            {/* Live Now */}
            {categorizedShows.liveNow.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  Live Now ({categorizedShows.liveNow.length})
                </h2>
                <div className="space-y-2">
                  {categorizedShows.liveNow.map(({ favorite, show }) =>
                    renderFavoriteCard(favorite, show)
                  )}
                </div>
              </section>
            )}

            {/* Coming Up */}
            {categorizedShows.comingUp.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  Coming Up ({categorizedShows.comingUp.length})
                </h2>
                <div className="space-y-2">
                  {categorizedShows.comingUp.map(({ favorite, show }) =>
                    renderFavoriteCard(favorite, show)
                  )}
                </div>
              </section>
            )}

            {/* Returning Soon (recurring shows not currently scheduled) */}
            {categorizedShows.returningSoon.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  Returning Soon ({categorizedShows.returningSoon.length})
                </h2>
                <p className="text-gray-600 text-sm mb-3">
                  Recurring shows not currently scheduled
                </p>
                <div className="space-y-2">
                  {categorizedShows.returningSoon.map((favorite) =>
                    renderFavoriteCard(favorite)
                  )}
                </div>
              </section>
            )}

            {/* Watchlist */}
            {watchlist.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  Watchlist ({watchlist.length})
                </h2>
                <p className="text-gray-600 text-sm mb-3">
                  Get notified when shows match these search terms
                </p>
                <div className="space-y-2">
                  {watchlist.map((favorite) => (
                    <div
                      key={favorite.id}
                      className="flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50"
                    >
                      <div className="w-1 flex-shrink-0 bg-white" />
                      <div className="flex-1 px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-white">
                            CHANNEL
                          </span>
                          <button
                            onClick={() => handleRemove(favorite)}
                            disabled={removing === favorite.id}
                            className="p-0.5 transition-colors text-gray-600 hover:text-red-400 disabled:opacity-50"
                            aria-label="Remove from watchlist"
                          >
                            {removing === favorite.id ? (
                              <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <p className="font-medium text-white text-sm leading-snug line-clamp-2">
                          {favorite.term}
                        </p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>Search keyword</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* One-Time Shows (not currently scheduled) */}
            {categorizedShows.oneTime.length > 0 && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  One-Time Shows ({categorizedShows.oneTime.length})
                </h2>
                <p className="text-gray-600 text-sm mb-3">
                  Not currently scheduled
                </p>
                <div className="space-y-2">
                  {categorizedShows.oneTime.map((favorite) => renderFavoriteCard(favorite))}
                </div>
              </section>
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
