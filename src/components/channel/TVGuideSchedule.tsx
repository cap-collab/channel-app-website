'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBPM } from '@/contexts/BPMContext';
import { Show, Station } from '@/types';
import { TipButton } from './TipButton';

const PIXELS_PER_HOUR = 120;
const STATION_COLUMN_WIDTH = 100;
const ROW_HEIGHT = 60;

function formatHour(date: Date, showDay: boolean = false): string {
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    hour12: true,
  });

  if (showDay) {
    const dayStr = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${dayStr} ${timeStr}`;
  }

  return timeStr;
}

// Check if this hour is midnight (start of a new day)
function isMidnight(date: Date): boolean {
  return date.getHours() === 0;
}

interface TVGuideScheduleProps {
  className?: string;
  onAuthRequired?: () => void;
}

export function TVGuideSchedule({ className = '', onAuthRequired }: TVGuideScheduleProps) {
  const { isAuthenticated, user } = useAuthContext();
  const { toggleFavorite, isShowFavorited } = useFavorites();
  const { stationBPM } = useBPM();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Fetch shows on mount via API route (avoids CORS issues with Newtown scraping)
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => setAllShows(data.shows || []))
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

    // Show 3 days (72 hours) into the future
    const end = new Date(start);
    end.setHours(end.getHours() + 72);

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

  // Handle favorite toggle
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
              <span className="text-white text-xs font-medium truncate">
                {station.name}
              </span>
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
              {timelineHours.map((hour, idx) => {
                const showDay = isMidnight(hour) || idx === 0;
                return (
                  <div
                    key={idx}
                    className="absolute top-0 bottom-0 flex items-center text-gray-500 text-xs"
                    style={{ left: idx * PIXELS_PER_HOUR }}
                  >
                    <span className={`px-2 ${showDay ? 'text-white font-medium' : ''}`}>
                      {formatHour(hour, showDay)}
                    </span>
                  </div>
                );
              })}
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
                      const isFavorited = isShowFavorited(show);
                      const isToggling = togglingId === show.id;
                      const showWidth = parseFloat(style.width);
                      const isExpanded = expandedShowId === show.id;
                      const hasDescription = !!show.description || !!show.djBio;
                      const hasExpandableContent = hasDescription || !!show.djPhotoUrl || !!show.promoText;
                      // Check if tipping is available (broadcast shows with DJ info - not limited to live)
                      const canTip = station.id === 'broadcast' && show.dj && (show.djUserId || show.djEmail) && show.broadcastSlotId;

                      return (
                        <div
                          key={show.id}
                          className={`absolute top-0.5 bottom-0.5 rounded px-1.5 py-0.5 transition-all group overflow-hidden cursor-pointer ${
                            isLive
                              ? 'bg-white/15 border border-white/20'
                              : 'bg-white/5 hover:bg-white/10'
                          }`}
                          style={{
                            ...style,
                            backgroundColor: isLive ? `${station.accentColor}30` : undefined,
                          }}
                          onClick={() => setExpandedShowId(isExpanded ? null : show.id)}
                        >
                          {/* Action buttons row - top right, only visible on hover */}
                          <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded px-0.5">
                            {/* Tip button for live broadcast shows */}
                            {canTip && showWidth >= 80 && (
                              <div onClick={(e) => e.stopPropagation()}>
                                <TipButton
                                  isAuthenticated={isAuthenticated}
                                  tipperUserId={user?.uid}
                                  djUserId={show.djUserId}
                                  djEmail={show.djEmail}
                                  djUsername={show.dj!}
                                  broadcastSlotId={show.broadcastSlotId!}
                                  showName={show.name}
                                  compact
                                />
                              </div>
                            )}
                            {/* Favorite star button */}
                            {showWidth >= 60 && (
                              <button
                                onClick={(e) => handleToggleFavorite(show, e)}
                                disabled={isToggling}
                                className="p-0.5 rounded"
                                style={{ color: station.accentColor }}
                                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                              >
                                {isToggling ? (
                                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <svg
                                    className="w-3 h-3"
                                    fill={isFavorited ? 'currentColor' : 'none'}
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                                    />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                          {/* Always-visible indicators: chevron (if expandable) + favorite star */}
                          <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 group-hover:opacity-0 transition-opacity">
                            {/* Chevron indicator if has expandable content */}
                            {hasExpandableContent && showWidth >= 50 && (
                              <svg
                                className="w-3 h-3 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                            {/* Favorite star */}
                            {isFavorited && showWidth >= 60 && (
                              <svg
                                className="w-3 h-3"
                                fill="currentColor"
                                style={{ color: station.accentColor }}
                                viewBox="0 0 24 24"
                              >
                                <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            )}
                          </div>

                          {/* Show name - up to 2 lines, truncate on hover to make room for buttons */}
                          {(() => {
                            const metadataKey = getMetadataKeyByStationId(station.id);
                            const bpm = isLive && metadataKey ? stationBPM[metadataKey]?.bpm : null;
                            // Show name is short (1 line) if under ~20 chars, so DJ would be on line 2
                            // Show name is long (2 lines) if over ~20 chars, so DJ would be on line 3
                            const showNameIsLong = show.name.length > 20;
                            const djNeedsPadding = bpm && show.dj && showNameIsLong;

                            return (
                              <>
                                <div className="group-hover:pr-12">
                                  <span className="text-white text-xs font-medium line-clamp-2 leading-tight">
                                    {show.name}
                                  </span>
                                </div>
                                {/* DJ name - 1 line only, with right padding for BPM only if on 3rd line */}
                                {show.dj && (
                                  <div className={djNeedsPadding ? 'pr-14' : ''}>
                                    <span className="text-gray-400 text-[10px] line-clamp-1 leading-tight">
                                      {show.dj}
                                    </span>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          {/* BPM - absolute bottom right */}
                          {isLive && (() => {
                            const metadataKey = getMetadataKeyByStationId(station.id);
                            const bpm = metadataKey ? stationBPM[metadataKey]?.bpm : null;
                            return bpm ? (
                              <span className="absolute bottom-0.5 right-1 text-gray-400 text-[10px] whitespace-nowrap">
                                {Math.round(bpm)} BPM
                              </span>
                            ) : null;
                          })()}

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
                                  <span>{station.name}</span>
                                  <span>•</span>
                                  <span>
                                    {new Date(show.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {new Date(show.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                  {isLive && (
                                    <>
                                      <span>•</span>
                                      <span className="text-red-500 font-medium">LIVE</span>
                                    </>
                                  )}
                                </div>

                                {/* DJ Photo and Bio */}
                                {(show.djPhotoUrl || show.djBio) && (
                                  <div className="flex items-start gap-3 mb-4">
                                    {show.djPhotoUrl && (
                                      <img
                                        src={show.djPhotoUrl}
                                        alt={show.dj || 'DJ'}
                                        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
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
                                        style={{ color: station.accentColor }}
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
                                  {/* Favorite button */}
                                  <button
                                    onClick={(e) => handleToggleFavorite(show, e)}
                                    disabled={isToggling}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-sm"
                                    style={{ color: station.accentColor }}
                                  >
                                    {isToggling ? (
                                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <svg
                                        className="w-4 h-4"
                                        fill={isFavorited ? 'currentColor' : 'none'}
                                        stroke="currentColor"
                                        strokeWidth={2}
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                                        />
                                      </svg>
                                    )}
                                    <span className="text-white">{isFavorited ? 'Favorited' : 'Favorite'}</span>
                                  </button>

                                  {/* Tip button */}
                                  {canTip && (
                                    <TipButton
                                      isAuthenticated={isAuthenticated}
                                      tipperUserId={user?.uid}
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
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
