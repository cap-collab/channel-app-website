'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { getAllShows } from '@/lib/metadata';
import { STATIONS } from '@/lib/stations';
import { Show, Station } from '@/types';

const PIXELS_PER_HOUR = 120;
const STATION_COLUMN_WIDTH = 100;
const ROW_HEIGHT = 60;

function formatHour(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    hour12: true,
  });
}

interface TVGuideScheduleProps {
  className?: string;
}

export function TVGuideSchedule({ className = '' }: TVGuideScheduleProps) {
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Fetch shows on mount
  useEffect(() => {
    getAllShows()
      .then(setAllShows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Filter stations (exclude broadcast for now, we'll add it separately as first row)
  const stations = useMemo(() => {
    return STATIONS.filter((s) => s.id !== 'broadcast');
  }, []);

  // Get the broadcast station
  const broadcastStation = useMemo(() => {
    return STATIONS.find((s) => s.id === 'broadcast');
  }, []);

  // Calculate timeline bounds
  const { timelineStart, timelineEnd, timelineHours } = useMemo(() => {
    const now = currentTime;

    // Find all currently playing shows
    const currentShows = allShows.filter((show) => {
      const start = new Date(show.startTime);
      const end = new Date(show.endTime);
      return start <= now && end > now;
    });

    // Find the earliest start time among current shows
    let earliestStart = now;
    for (const show of currentShows) {
      const start = new Date(show.startTime);
      if (start < earliestStart) {
        earliestStart = start;
      }
    }

    // Round down to the hour
    const start = new Date(earliestStart);
    start.setMinutes(0, 0, 0);

    // Show 8 hours into the future
    const end = new Date(start);
    end.setHours(end.getHours() + 8);

    const hours: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      hours.push(new Date(current));
      current.setHours(current.getHours() + 1);
    }

    return { timelineStart: start, timelineEnd: end, timelineHours: hours };
  }, [allShows, currentTime]);

  // Calculate NOW line position
  const nowLinePosition = useMemo(() => {
    const diffMs = currentTime.getTime() - timelineStart.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours * PIXELS_PER_HOUR;
  }, [currentTime, timelineStart]);

  // Scroll to NOW line on initial load
  useEffect(() => {
    if (!loading && scrollContainerRef.current && !hasScrolledRef.current) {
      // Scroll so NOW line is about 1/4 from left
      const scrollTarget = Math.max(0, nowLinePosition - 100);
      scrollContainerRef.current.scrollLeft = scrollTarget;
      hasScrolledRef.current = true;
    }
  }, [loading, nowLinePosition]);

  // Get shows for a specific station within the timeline
  const getStationShows = (stationId: string): Show[] => {
    return allShows.filter((show) => {
      if (show.stationId !== stationId) return false;
      const start = new Date(show.startTime);
      const end = new Date(show.endTime);
      // Show overlaps with timeline
      return start < timelineEnd && end > timelineStart;
    });
  };

  // Calculate show block position and width
  const getShowStyle = (show: Show) => {
    const start = new Date(show.startTime);
    const end = new Date(show.endTime);

    // Clamp to timeline bounds
    const clampedStart = start < timelineStart ? timelineStart : start;
    const clampedEnd = end > timelineEnd ? timelineEnd : end;

    const startOffset = (clampedStart.getTime() - timelineStart.getTime()) / (1000 * 60 * 60);
    const duration = (clampedEnd.getTime() - clampedStart.getTime()) / (1000 * 60 * 60);

    return {
      left: `${startOffset * PIXELS_PER_HOUR}px`,
      width: `${Math.max(duration * PIXELS_PER_HOUR - 2, 40)}px`, // Min width of 40px, -2 for gap
    };
  };

  // Check if show is currently live
  const isShowLive = (show: Show): boolean => {
    const now = currentTime;
    const start = new Date(show.startTime);
    const end = new Date(show.endTime);
    return start <= now && end > now;
  };

  // Open station website
  const handleStationClick = (station: Station) => {
    if (station.websiteUrl) {
      window.open(station.websiteUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const timelineWidth = timelineHours.length * PIXELS_PER_HOUR;

  if (loading) {
    return (
      <div className={`bg-surface-base rounded-xl p-4 ${className}`}>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Combine broadcast station first, then other stations
  const allStations = broadcastStation ? [broadcastStation, ...stations] : stations;

  return (
    <div className={`bg-surface-base rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-white font-medium flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          What&apos;s On Now
        </h2>
        <span className="text-gray-500 text-sm">← scroll →</span>
      </div>

      {/* Guide Container */}
      <div className="flex">
        {/* Station Column (sticky) */}
        <div
          className="flex-shrink-0 border-r border-gray-800 bg-surface-base z-10"
          style={{ width: STATION_COLUMN_WIDTH }}
        >
          {/* Time header spacer */}
          <div className="h-8 border-b border-gray-800" />

          {/* Station rows */}
          {allStations.map((station) => (
            <div
              key={station.id}
              className={`flex items-center px-3 border-b border-gray-800 ${
                station.id !== 'broadcast' ? 'cursor-pointer hover:bg-white/5' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => station.id !== 'broadcast' && handleStationClick(station)}
              title={station.id !== 'broadcast' ? `Open ${station.name}` : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: station.accentColor }}
                />
                <span className="text-white text-xs font-medium truncate">
                  {station.name}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline + Shows (scrollable) */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto"
        >
          <div style={{ width: timelineWidth, minWidth: '100%' }}>
            {/* Time axis */}
            <div className="relative h-8 border-b border-gray-800">
              {timelineHours.map((hour, idx) => (
                <div
                  key={idx}
                  className="absolute top-0 bottom-0 flex items-center text-gray-500 text-xs"
                  style={{ left: idx * PIXELS_PER_HOUR }}
                >
                  <span className="px-2">{formatHour(hour)}</span>
                </div>
              ))}

              {/* NOW indicator in header */}
              <div
                className="absolute top-0 bottom-0 flex flex-col items-center"
                style={{ left: nowLinePosition }}
              >
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                  NOW
                </span>
              </div>
            </div>

            {/* Show rows */}
            <div className="relative">
              {/* NOW line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20"
                style={{ left: nowLinePosition }}
              />

              {allStations.map((station) => {
                const shows = getStationShows(station.id);

                return (
                  <div
                    key={station.id}
                    className="relative border-b border-gray-800"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {shows.map((show) => {
                      const style = getShowStyle(show);
                      const isLive = isShowLive(show);

                      return (
                        <div
                          key={show.id}
                          className={`absolute top-1 bottom-1 rounded-lg px-2 py-1 overflow-hidden transition-colors ${
                            isLive
                              ? 'bg-white/15 border border-white/20'
                              : 'bg-white/5 hover:bg-white/10'
                          }`}
                          style={{
                            ...style,
                            backgroundColor: isLive ? `${station.accentColor}30` : undefined,
                          }}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isLive && (
                              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                            )}
                            <span className="text-white text-xs font-medium truncate">
                              {show.name}
                            </span>
                          </div>
                          {show.dj && (
                            <p className="text-gray-400 text-[10px] truncate mt-0.5">
                              {show.dj}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
