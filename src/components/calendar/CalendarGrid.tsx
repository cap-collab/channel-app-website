"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Show } from "@/types";
import { STATIONS } from "@/lib/stations";
import { getAllShows } from "@/lib/metadata";
import { TimeAxis } from "./TimeAxis";
import { StationColumn } from "./StationColumn";
import { SearchResultCard } from "./SearchResultCard";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { AuthModal } from "@/components/AuthModal";
import { NotificationPrompt } from "@/components/NotificationPrompt";

const PIXELS_PER_HOUR = 80;
const STATION_COLUMN_MIN_WIDTH = 140;
const TIME_AXIS_WIDTH = 56; // w-14 = 56px

interface CalendarGridProps {
  searchQuery?: string;
  onClearSearch?: () => void;
  isSearchBarSticky?: boolean;
}

export function CalendarGrid({ searchQuery = "", onClearSearch, isSearchBarSticky = false }: CalendarGridProps) {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRefs = useRef<HTMLDivElement[]>([]);
  const searchResultsScrollRef = useRef<HTMLDivElement>(null);

  const { isAuthenticated } = useAuthContext();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useFavorites();
  const { hasWatchlistNotificationsEnabled } = useUserPreferences();

  // Sync horizontal scroll across all scrollable containers
  const isScrollSyncing = useRef(false);
  const syncScroll = useCallback((sourceElement: HTMLElement) => {
    if (isScrollSyncing.current) return;
    isScrollSyncing.current = true;

    const scrollLeft = sourceElement.scrollLeft;

    // Sync header
    if (headerScrollRef.current && headerScrollRef.current !== sourceElement) {
      headerScrollRef.current.scrollLeft = scrollLeft;
    }

    // Sync search results
    if (searchResultsScrollRef.current && searchResultsScrollRef.current !== sourceElement) {
      searchResultsScrollRef.current.scrollLeft = scrollLeft;
    }

    // Sync all grid containers
    gridScrollRefs.current.forEach((ref) => {
      if (ref && ref !== sourceElement) {
        ref.scrollLeft = scrollLeft;
      }
    });

    requestAnimationFrame(() => {
      isScrollSyncing.current = false;
    });
  }, []);

  useEffect(() => {
    async function loadShows() {
      try {
        setLoading(true);
        const allShows = await getAllShows();
        setShows(allShows);
        setError(null);
      } catch (err) {
        console.error("Failed to load shows:", err);
        setError("Failed to load schedule. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    loadShows();
  }, []);

  // Auto-scroll to 2 hours before current time on initial load
  useEffect(() => {
    if (!loading && shows.length > 0 && !hasScrolledRef.current) {
      const scrollToCurrentTime = () => {
        if (hasScrolledRef.current) return;

        const todayGrid = document.querySelector('[data-time-grid="today"]');
        if (!todayGrid) return;

        const now = new Date();
        // Calculate time position for 2 hours before current time
        // Handle midnight case: if current time is before 2am, scroll to top (0)
        const currentHours = now.getHours() + now.getMinutes() / 60;
        const targetHours = Math.max(0, currentHours - 2);
        const timePosition = targetHours * PIXELS_PER_HOUR;

        // Grid's position in document
        const gridTop = todayGrid.getBoundingClientRect().top + window.scrollY;

        // Sticky headers: main header (~52px) + station (48px) + date (52px) = 152px
        const totalStickyHeight = 152;

        // Position target time ~60px below sticky headers
        const scrollPosition = gridTop + timePosition - totalStickyHeight - 60;

        window.scrollTo({
          top: Math.max(0, scrollPosition),
          behavior: 'instant'
        });
        hasScrolledRef.current = true;
      };

      // Try immediately, then with delays as fallback for layout settling
      scrollToCurrentTime();
      const timeoutId1 = setTimeout(scrollToCurrentTime, 100);
      const timeoutId2 = setTimeout(scrollToCurrentTime, 300);

      return () => {
        clearTimeout(timeoutId1);
        clearTimeout(timeoutId2);
      };
    }
  }, [loading, shows.length]);

  // Get unique future dates from shows (today onwards)
  const futureDates = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const dateSet = new Set<string>();

    shows.forEach((show) => {
      const showEnd = new Date(show.endTime);
      // Only include shows that haven't ended yet
      if (showEnd > now) {
        const showStart = new Date(show.startTime);
        const dateStr = showStart.toDateString();
        dateSet.add(dateStr);
      }
    });

    // Convert to sorted array of dates, limit to 2 days (today and tomorrow)
    return Array.from(dateSet)
      .map((dateStr) => new Date(dateStr))
      .sort((a, b) => a.getTime() - b.getTime())
      .slice(0, 2);
  }, [shows]);

  // Get shows for a specific station
  const getShowsForStation = (stationId: string): Show[] => {
    return shows.filter((show) => show.stationId === stationId);
  };

  // Get search results grouped by station
  const searchResultsByStation = useMemo(() => {
    if (!searchQuery.trim()) return new Map<string, Show[]>();
    const query = searchQuery.toLowerCase();
    const now = new Date();

    const filtered = shows
      .filter((show) => {
        const showEnd = new Date(show.endTime);
        if (showEnd < now) return false; // Only future shows
        return (
          show.name.toLowerCase().includes(query) ||
          show.dj?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Group by station
    const grouped = new Map<string, Show[]>();
    STATIONS.forEach(station => grouped.set(station.id, []));

    filtered.forEach(show => {
      const stationShows = grouped.get(show.stationId);
      if (stationShows) {
        stationShows.push(show);
      }
    });

    return grouped;
  }, [shows, searchQuery]);

  // Total search results count
  const totalSearchResults = useMemo(() => {
    let count = 0;
    searchResultsByStation.forEach(shows => count += shows.length);
    return count;
  }, [searchResultsByStation]);

  // Find first station index with search results (for auto-scroll)
  const firstStationWithResults = useMemo(() => {
    if (!searchQuery.trim() || totalSearchResults === 0) return -1;
    return STATIONS.findIndex(station => {
      const results = searchResultsByStation.get(station.id);
      return results && results.length > 0;
    });
  }, [searchResultsByStation, searchQuery, totalSearchResults]);

  // Auto-scroll horizontally to show first station with search results
  useEffect(() => {
    if (firstStationWithResults <= 0) return; // No need to scroll if first station or no results

    // Calculate scroll position to center the station with results
    const scrollTarget = TIME_AXIS_WIDTH + (firstStationWithResults * STATION_COLUMN_MIN_WIDTH);
    const viewportWidth = window.innerWidth;
    // Center the results in the viewport, accounting for time axis
    const scrollPosition = Math.max(0, scrollTarget - viewportWidth / 3);

    // Function to scroll all containers
    const scrollToResults = () => {
      // On mobile, searchResultsScrollRef might not be mounted yet when effect first runs
      // Also scroll the search results container directly if available
      if (searchResultsScrollRef.current) {
        searchResultsScrollRef.current.scrollLeft = scrollPosition;
      }
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = scrollPosition;
      }
      gridScrollRefs.current.forEach(ref => {
        if (ref) {
          ref.scrollLeft = scrollPosition;
        }
      });
    };

    // Run immediately and with delays to catch when DOM mounts
    scrollToResults();
    const timeoutId1 = setTimeout(scrollToResults, 100);
    const timeoutId2 = setTimeout(scrollToResults, 300);
    const timeoutId3 = setTimeout(scrollToResults, 500);

    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      clearTimeout(timeoutId3);
    };
  }, [firstStationWithResults]);

  // Get station info for a show (used in search results)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getStationForShow = (stationId: string) => {
    return STATIONS.find((s) => s.id === stationId);
  };

  // Format date for section headers
  const formatDateHeader = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    } else {
      return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
  };

  // Check if a date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-[3px] border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-white text-black px-6 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} id="calendar-scroll-container">
      {/* Search Results Section - sticky below header and search bar when active */}
      {searchQuery.trim() && totalSearchResults > 0 && (
        <div className={`bg-black border-b border-gray-800 ${isSearchBarSticky ? 'sticky top-[112px] z-[42]' : ''}`}>
          <div className="bg-black border-b border-gray-800 px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Search Results ({totalSearchResults})
            </h2>
            {onClearSearch && (
              <button
                onClick={onClearSearch}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear Search
              </button>
            )}
          </div>
          {/* Station columns with search results - horizontally scrollable */}
          <div
            ref={searchResultsScrollRef}
            onScroll={(e) => syncScroll(e.currentTarget)}
            className="overflow-x-auto scrollbar-hide max-h-[40vh] overflow-y-auto"
          >
            <div className="flex min-w-max">
              {/* Time axis spacer */}
              <div className="w-14 flex-shrink-0 sticky left-0 z-10 bg-black border-r border-gray-900" />
              {/* Station columns */}
              {STATIONS.map((station, index) => {
                const stationResults = searchResultsByStation.get(station.id) || [];
                return (
                  <div
                    key={station.id}
                    className={`flex-1 min-w-[140px] p-2 ${index !== STATIONS.length - 1 ? "border-r border-gray-800/50" : ""}`}
                  >
                    {/* Station header */}
                    <div className="mb-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: station.accentColor }}
                      >
                        {station.name}
                      </span>
                    </div>
                    {/* Results for this station */}
                    <div className="space-y-2">
                      {stationResults.length > 0 ? (
                        stationResults.map((show) => (
                          <SearchResultCard
                            key={show.id}
                            show={show}
                            station={station}
                          />
                        ))
                      ) : (
                        <p className="text-gray-600 text-xs italic">No matches</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* No results message with watchlist option */}
      {searchQuery.trim() && totalSearchResults === 0 && !loading && (
        <div className={`bg-black border-b border-gray-800 ${isSearchBarSticky ? 'sticky top-[104px] z-[42]' : ''}`}>
          {/* Header with Clear Search button - same as results section */}
          <div className="bg-black border-b border-gray-800 px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              No Results
            </h2>
            {onClearSearch && (
              <button
                onClick={onClearSearch}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear Search
              </button>
            )}
          </div>
          {/* Content */}
          <div className="px-4 py-6 text-center">
            <p className="text-gray-400 mb-4">No shows found for &quot;{searchQuery}&quot;</p>

            {/* Watchlist option */}
            {!isInWatchlist(searchQuery) ? (
              <div className="space-y-3">
                <button
                  onClick={async () => {
                    if (!isAuthenticated) {
                      setShowAuthModal(true);
                      return;
                    }
                    setWatchlistLoading(true);
                    await addToWatchlist(searchQuery);
                    setWatchlistLoading(false);
                    // Show notification prompt if user hasn't enabled watchlist notifications
                    if (!hasWatchlistNotificationsEnabled) {
                      setShowNotificationPrompt(true);
                    }
                  }}
                  disabled={watchlistLoading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {watchlistLoading ? (
                    <div className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  )}
                  Add &quot;{searchQuery}&quot; to Watch List
                </button>
                <p className="text-gray-600 text-xs">
                  We&apos;ll notify you when this DJ or show appears in a schedule
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 text-white">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span>&quot;{searchQuery}&quot; added to Watch List</span>
                </div>
                <div>
                  <button
                    onClick={async () => {
                      setWatchlistLoading(true);
                      await removeFromWatchlist(searchQuery);
                      setWatchlistLoading(false);
                    }}
                    disabled={watchlistLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {watchlistLoading ? (
                      <div className="w-4 h-4 border-2 border-red-500/30 border-t-red-400 rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    Remove from Watch List
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to add to your Watch List"
      />

      {/* Notification Prompt */}
      <NotificationPrompt
        isOpen={showNotificationPrompt}
        onClose={() => setShowNotificationPrompt(false)}
        type="watchlist"
      />

      {/* Persistent station headers - stays fixed below main header (and search bar when sticky) */}
      {/* Header (52px) + search bar section (py-3 + input) = ~112px */}
      <div
        ref={headerScrollRef}
        onScroll={(e) => syncScroll(e.currentTarget)}
        className={`sticky ${isSearchBarSticky ? 'top-[112px]' : 'top-[52px]'} z-40 bg-black border-b border-gray-800 overflow-x-auto scrollbar-hide`}
      >
        <div className="flex min-w-max">
          {/* Time axis spacer (left) - sticky on mobile */}
          <div className="w-14 flex-shrink-0 sticky left-0 z-10 bg-black" />

          {/* Station headers */}
          {STATIONS.map((station, index) => (
            <div
              key={station.id}
              className={`flex-1 min-w-[140px] py-2 flex flex-col justify-center px-3 ${
                index !== STATIONS.length - 1 ? "border-r border-gray-800/50" : ""
              }`}
            >
              <span className="font-medium text-white text-sm truncate">
                {station.name}
              </span>
              <div
                className="h-[2px] w-8 mt-1 rounded-full"
                style={{ backgroundColor: station.accentColor }}
              />
            </div>
          ))}

          {/* Time axis spacer (right) - hidden on mobile */}
          <div className="w-14 flex-shrink-0 hidden md:block" />
        </div>
      </div>

      {futureDates.map((date, dateIndex) => {
        const isTodayDate = isToday(date);
        // Always show full day from midnight
        const startHour = 0;

        return (
          <div
            key={date.toISOString()}
            className="border-b border-gray-800"
            data-date-section={isTodayDate ? "today" : "future"}
          >
            {/* Date header - sticky below main header + search bar when sticky + station headers (~44px) */}
            {/* 112px (header+search) + ~44px (station headers) = ~156px */}
            <div className={`sticky ${isSearchBarSticky ? 'top-[156px]' : 'top-[96px]'} z-30 bg-black border-b border-gray-800 px-4 py-3`}>
              <h2 className="text-lg font-semibold text-white">
                {formatDateHeader(date)}
              </h2>
            </div>

            {/* Calendar grid for this day - horizontally scrollable on mobile */}
            <div
              ref={(el) => {
                if (el) gridScrollRefs.current[dateIndex] = el;
              }}
              onScroll={(e) => syncScroll(e.currentTarget)}
              className="overflow-x-auto scrollbar-hide"
            >
              <div className="flex relative min-w-max" data-time-grid={isTodayDate ? "today" : undefined}>
                {/* Time axis (left) - sticky when scrolling horizontally */}
                <TimeAxis pixelsPerHour={PIXELS_PER_HOUR} startHour={startHour} />

                {/* Station columns */}
                {STATIONS.map((station, index) => (
                  <StationColumn
                    key={station.id}
                    station={station}
                    shows={getShowsForStation(station.id)}
                    pixelsPerHour={PIXELS_PER_HOUR}
                    selectedDate={date}
                    searchQuery={searchQuery}
                    isLast={index === STATIONS.length - 1}
                    startHour={startHour}
                    hideHeader
                  />
                ))}

                {/* Time axis (right) - hidden on mobile */}
                <TimeAxis pixelsPerHour={PIXELS_PER_HOUR} startHour={startHour} position="right" className="hidden md:block" />

                {/* Current time indicator (only for today) */}
                {isTodayDate && (
                  <CurrentTimeLine
                    pixelsPerHour={PIXELS_PER_HOUR}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Current time line that spans all columns (only shown for today)
function CurrentTimeLine({
  pixelsPerHour,
}: {
  pixelsPerHour: number;
}) {
  const [position, setPosition] = useState<number>(0);

  useEffect(() => {
    const updatePosition = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      // Calculate position: hours * pixels per hour
      // Station header is now separate, so no need to add 48px offset
      const totalHours = hours + minutes / 60;
      setPosition(totalHours * pixelsPerHour);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 60000);
    return () => clearInterval(interval);
  }, [pixelsPerHour]);

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
      style={{ top: position }}
    >
      <div className="w-14 flex justify-end pr-1">
        <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      </div>
      <div className="flex-1 h-px bg-gray-600" />
    </div>
  );
}
