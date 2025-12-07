"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Show } from "@/types";
import { STATIONS } from "@/lib/stations";
import { getAllShows } from "@/lib/metadata";
import { TimeAxis } from "./TimeAxis";
import { StationColumn } from "./StationColumn";
import { SearchResultCard } from "./SearchResultCard";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuthContext } from "@/contexts/AuthContext";
import { AuthModal } from "@/components/AuthModal";

const PIXELS_PER_HOUR = 80;

interface CalendarGridProps {
  searchQuery?: string;
  onClearSearch?: () => void;
}

export function CalendarGrid({ searchQuery = "", onClearSearch }: CalendarGridProps) {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  const { isAuthenticated } = useAuthContext();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useFavorites();

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

  // Auto-scroll to current time on initial load
  useEffect(() => {
    if (!loading && !hasScrolledRef.current && scrollContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const now = new Date();
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            // Date header is ~52px (sticky), station header is 48px (h-12)
            // Time grid starts after station header
            // We want the current time line to be visible near top of viewport
            const timePosition = (currentHour + currentMinute / 60) * PIXELS_PER_HOUR;
            // Add station header height (48px), subtract viewport offset to show line near top
            const scrollPosition = timePosition + 48 - 80;
            scrollContainerRef.current.scrollTop = Math.max(0, scrollPosition);
            hasScrolledRef.current = true;
          }
        });
      });
    }
  }, [loading]);

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

    // Convert to sorted array of dates, limit to 5 days
    return Array.from(dateSet)
      .map((dateStr) => new Date(dateStr))
      .sort((a, b) => a.getTime() - b.getTime())
      .slice(0, 5);
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

  // Get station info for a show
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
    <div ref={scrollContainerRef} className="h-full overflow-auto">
      {/* Search Results Section */}
      {searchQuery.trim() && totalSearchResults > 0 && (
        <div className="bg-gray-950 border-b border-gray-800">
          <div className="sticky top-0 z-30 bg-gray-950 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Search Results ({totalSearchResults})
            </h2>
            {onClearSearch && (
              <button
                onClick={onClearSearch}
                className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close
              </button>
            )}
          </div>
          {/* Station columns with search results */}
          <div className="flex">
            {/* Time axis spacer */}
            <div className="w-14 flex-shrink-0 border-r border-gray-900" />
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
      )}

      {/* No results message with watchlist option */}
      {searchQuery.trim() && totalSearchResults === 0 && !loading && (
        <div className="bg-gray-950 border-b border-gray-800 px-4 py-8 text-center">
          <p className="text-gray-400 mb-4">No shows found for "{searchQuery}"</p>

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
                Add "{searchQuery}" to Watch List
              </button>
              <p className="text-gray-600 text-xs">
                We'll notify you when this DJ or show appears in a schedule
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 text-white">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span>"{searchQuery}" added to Watch List</span>
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

          {onClearSearch && (
            <button
              onClick={onClearSearch}
              className="mt-4 text-gray-500 hover:text-white text-sm transition-colors"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to add to your Watch List"
      />

      {futureDates.map((date) => {
        const isTodayDate = isToday(date);
        // Always show full day from midnight
        const startHour = 0;

        return (
          <div key={date.toISOString()} className="border-b border-gray-800">
            {/* Date header */}
            <div className="sticky top-0 z-30 bg-black border-b border-gray-800 px-4 py-3">
              <h2 className="text-lg font-semibold text-white">
                {formatDateHeader(date)}
              </h2>
            </div>

            {/* Calendar grid for this day */}
            <div className="flex relative">
              {/* Time axis */}
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
                />
              ))}

              {/* Current time indicator (only for today) */}
              {isTodayDate && (
                <CurrentTimeLine
                  pixelsPerHour={PIXELS_PER_HOUR}
                />
              )}
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
      // Add 48px for the station header height (h-12 = 48px)
      const totalHours = hours + minutes / 60;
      setPosition(totalHours * pixelsPerHour + 48);
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
        <div className="w-3 h-3 rounded-full bg-red-500" />
      </div>
      <div className="flex-1 h-[2px] bg-red-500" />
    </div>
  );
}
