'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { TimeSlot } from '@/types/dj-application';

interface TimeSlotPickerProps {
  selectedSlots: TimeSlot[];
  onChange: (slots: TimeSlot[]) => void;
  setDuration: number; // Duration in hours
}

interface BlockedSlot {
  start: number;
  end: number;
}

// All 24 hours, default view 9am–6pm
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 40;
const DEFAULT_VIEW_START = 9;
const VISIBLE_HOUR_COUNT = 9;
const VISIBLE_HEIGHT = VISIBLE_HOUR_COUNT * HOUR_HEIGHT;

// Check if a timestamp falls in nighttime hours (10 PM – 7 AM PT)
function isNighttimePT(timestamp: number): boolean {
  const ptHour = parseInt(
    new Date(timestamp).toLocaleString('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Los_Angeles',
    })
  );
  return ptHour >= 22 || ptHour < 7;
}

// Hard cutoff: everything up to and including April 22nd is blocked (midnight PT = 7am UTC)
const BLOCKED_UNTIL = new Date('2026-04-23T07:00:00Z').getTime();

// Specific blocked dates (in PT)
const BLOCKED_DATES = ['2026-04-24', '2026-04-27', '2026-05-25', '2026-05-26'];

function isBlockedDate(timestamp: number): boolean {
  const ptDate = new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return BLOCKED_DATES.includes(ptDate);
}

function isWeekendPT(timestamp: number): boolean {
  const ptDayStr = new Date(timestamp).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' });
  return ptDayStr === 'Sat' || ptDayStr === 'Sun';
}

function formatHour(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

function getSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function formatDayHeader(date: Date): { line1: string; line2: string } {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (date.toDateString() === today.toDateString()) return { line1: 'Today', line2: monthDay };
  if (date.toDateString() === tomorrow.toDateString()) return { line1: 'Tomorrow', line2: monthDay };

  return {
    line1: date.toLocaleDateString('en-US', { weekday: 'short' }),
    line2: monthDay,
  };
}

const DAY_HEADER_HEIGHT = 48;

// Get a UTC timestamp for a given calendar date and hour in local time
function getTimestamp(baseDate: Date, hour: number): number {
  const d = new Date(baseDate);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function TimeSlotPicker({ selectedSlots, onChange, setDuration }: TimeSlotPickerProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = getSunday(new Date());
    const firstOpen = getSunday(new Date(BLOCKED_UNTIL));
    return firstOpen > today ? firstOpen : today;
  });
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoverSlot, setHoverSlot] = useState<{ dayIndex: number; startHour: number } | null>(null);
  const timeColumnRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  const durationMs = setDuration * 60 * 60 * 1000;

  const days = useMemo(() => {
    const result = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(currentWeekStart);
      day.setDate(day.getDate() + i);
      result.push(day);
    }
    return result;
  }, [currentWeekStart]);

  // Fetch blocked slots
  useEffect(() => {
    async function fetchBlockedSlots() {
      setIsLoading(true);
      try {
        const response = await fetch('/api/broadcast/available-slots');
        if (response.ok) {
          const data = await response.json();
          setBlockedSlots(data.blockedSlots || []);
        }
      } catch (error) {
        console.error('Failed to fetch available slots:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchBlockedSlots();
  }, []);

  // Scroll to 9am on mount
  useEffect(() => {
    if (!isLoading) {
      requestAnimationFrame(() => {
        const scrollPos = DEFAULT_VIEW_START * HOUR_HEIGHT;
        if (gridRef.current) gridRef.current.scrollTop = scrollPos;
        if (timeColumnRef.current) timeColumnRef.current.scrollTop = scrollPos;
      });
    }
  }, [isLoading]);

  // Auto-scroll horizontally to the first day with available slots
  useEffect(() => {
    if (isLoading || hasAutoScrolled.current) return;

    const minTime = Date.now() + 36 * 60 * 60 * 1000;

    let firstAvailableDay = -1;
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      for (const hour of ALL_HOURS) {
        const timestamp = getTimestamp(days[dayIndex], hour);
        if (timestamp >= minTime && !isTimeUnavailable(timestamp)) {
          firstAvailableDay = dayIndex;
          break;
        }
      }
      if (firstAvailableDay !== -1) break;
    }

    if (firstAvailableDay === -1) {
      const maxWeeksAhead = getSunday(new Date());
      maxWeeksAhead.setDate(maxWeeksAhead.getDate() + 28);
      if (currentWeekStart < maxWeeksAhead) {
        goToNextWeek();
        return;
      }
      hasAutoScrolled.current = true;
      return;
    }

    hasAutoScrolled.current = true;

    if (horizontalScrollRef.current && firstAvailableDay > 0) {
      requestAnimationFrame(() => {
        if (horizontalScrollRef.current) {
          const columnWidth = horizontalScrollRef.current.scrollWidth / 7;
          horizontalScrollRef.current.scrollLeft = firstAvailableDay * columnWidth;
        }
      });
    }
  }, [isLoading, currentWeekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTimeBlocked = (_timestamp: number): boolean => {
    // Don't show existing bookings as blocked — applicants just pick open calendar slots
    return false;
  };

  const isTimeUnavailable = (timestamp: number): boolean => {
    const minTime = Date.now() + 36 * 60 * 60 * 1000;
    return timestamp < minTime || timestamp < BLOCKED_UNTIL || isNighttimePT(timestamp) || isWeekendPT(timestamp) || isBlockedDate(timestamp);
  };

  const isSlotValid = (dayIndex: number, startHour: number): boolean => {
    const startTime = getTimestamp(days[dayIndex], startHour);
    const endTime = startTime + durationMs;
    const endHour = startHour + setDuration;
    if (endHour > 24) return false;

    const segmentDuration = 30 * 60 * 1000;
    for (let t = startTime; t < endTime; t += segmentDuration) {
      if (isTimeBlocked(t) || isTimeUnavailable(t)) return false;
    }
    return true;
  };

  const handleCellClick = (dayIndex: number, hour: number) => {
    const startTime = getTimestamp(days[dayIndex], hour);

    const existingSlotIndex = selectedSlots.findIndex(
      (slot) => startTime >= slot.start && startTime < slot.end
    );

    if (existingSlotIndex !== -1) {
      onChange(selectedSlots.filter((_, i) => i !== existingSlotIndex));
      return;
    }

    if (!isSlotValid(dayIndex, hour)) return;

    const endTime = startTime + durationMs;
    const newSlot: TimeSlot = { start: startTime, end: endTime };

    const nonOverlapping = selectedSlots.filter(
      (slot) => slot.end <= newSlot.start || slot.start >= newSlot.end
    );

    onChange([...nonOverlapping, newSlot].sort((a, b) => a.start - b.start));
  };

  const handleCellMouseEnter = (dayIndex: number, hour: number) => {
    const startTime = getTimestamp(days[dayIndex], hour);
    const isSelected = selectedSlots.some(
      (slot) => startTime >= slot.start && startTime < slot.end
    );
    if (isSelected) { setHoverSlot(null); return; }
    if (isSlotValid(dayIndex, hour)) {
      setHoverSlot({ dayIndex, startHour: hour });
    } else {
      setHoverSlot(null);
    }
  };

  const handleCellMouseLeave = () => setHoverSlot(null);

  const isInHoverPreview = (dayIndex: number, hour: number): boolean => {
    if (!hoverSlot || hoverSlot.dayIndex !== dayIndex) return false;
    const cellTime = getTimestamp(days[dayIndex], hour);
    const previewStart = getTimestamp(days[hoverSlot.dayIndex], hoverSlot.startHour);
    const previewEnd = previewStart + durationMs;
    return cellTime >= previewStart && cellTime < previewEnd;
  };

  const isInSelectedSlot = (dayIndex: number, hour: number): boolean => {
    const timestamp = getTimestamp(days[dayIndex], hour);
    return selectedSlots.some((slot) => timestamp >= slot.start && timestamp < slot.end);
  };

  const removeSlot = (slotToRemove: TimeSlot) => {
    onChange(selectedSlots.filter((slot) => slot.start !== slotToRemove.start));
  };

  const goToPrevWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() - 7);
    setCurrentWeekStart(newStart);
  };

  const goToNextWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    setCurrentWeekStart(newStart);
  };

  const canGoPrev = useMemo(() => {
    const thisSunday = getSunday(new Date());
    return currentWeekStart > thisSunday;
  }, [currentWeekStart]);

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a1a] border-b border-gray-800">
        <button
          type="button"
          onClick={goToPrevWeek}
          disabled={!canGoPrev}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium">
          {days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} -{' '}
          {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={goToNextWeek}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Selected slots summary */}
      {selectedSlots.length > 0 && (
        <div className="px-4 py-3 bg-[#1a1a1a] border-b border-gray-800">
          <p className="text-xs text-gray-500 mb-2">Selected time slots:</p>
          <div className="flex flex-wrap gap-2">
            {selectedSlots.map((slot, i) => {
              const start = new Date(slot.start);
              const end = new Date(slot.end);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 bg-green-900/30 border border-green-800 rounded-lg text-sm"
                >
                  <span className="text-green-400">
                    {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                    {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} -{' '}
                    {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSlot(slot)}
                    className="text-green-600 hover:text-green-400"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      ) : (
        <div className="flex">
          {/* Fixed time column */}
          <div className="flex-shrink-0 w-[50px] bg-[#0a0a0a] z-10">
            <div className="border-b border-gray-800" style={{ height: DAY_HEADER_HEIGHT }} />
            <div
              ref={timeColumnRef}
              className="overflow-hidden"
              style={{ maxHeight: VISIBLE_HEIGHT }}
            >
              <div>
                {ALL_HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="flex items-start justify-end pr-2 pt-1 border-b border-gray-800/50"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    <span className="text-xs text-gray-600">{formatHour(hour)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Horizontally scrollable grid area */}
          <div ref={horizontalScrollRef} className="flex-1 overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-gray-800" style={{ height: DAY_HEADER_HEIGHT }}>
                {days.map((day, i) => {
                  const header = formatDayHeader(day);
                  return (
                    <div
                      key={i}
                      className="flex flex-col items-center justify-center text-xs font-medium text-gray-400 border-l border-gray-800"
                    >
                      <span>{header.line1}</span>
                      <span>{header.line2}</span>
                    </div>
                  );
                })}
              </div>

              {/* Vertically scrollable time grid */}
              <div
                ref={gridRef}
                className="overflow-y-auto select-none"
                style={{ maxHeight: VISIBLE_HEIGHT }}
                onScroll={(e) => {
                  if (timeColumnRef.current) {
                    timeColumnRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                }}
              >
                {ALL_HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="grid grid-cols-7 border-b border-gray-800/50"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    {days.map((_, dayIndex) => {
                      const timestamp = getTimestamp(days[dayIndex], hour);
                      const blocked = isTimeBlocked(timestamp);
                      const unavailable = isTimeUnavailable(timestamp);
                      const selected = isInSelectedSlot(dayIndex, hour);
                      const inPreview = isInHoverPreview(dayIndex, hour);
                      const canSelect = !blocked && !unavailable && isSlotValid(dayIndex, hour);

                      return (
                        <div
                          key={dayIndex}
                          className={`
                            border-l border-gray-800/50 transition-colors
                            ${selected ? 'bg-green-600/40 border-l-green-700 cursor-pointer' : ''}
                            ${inPreview && !selected ? 'bg-green-700/30 cursor-pointer' : ''}
                            ${blocked && !selected ? 'bg-white/[0.03] cursor-not-allowed' : ''}
                            ${unavailable && !blocked && !selected ? 'bg-white/[0.02] cursor-not-allowed' : ''}
                            ${!blocked && !unavailable && !selected && !inPreview && canSelect ? 'bg-white/[0.08] hover:bg-green-800/30 cursor-pointer' : ''}
                            ${!blocked && !unavailable && !canSelect && !selected && !inPreview ? 'bg-white/[0.08] cursor-not-allowed' : ''}
                          `}
                          onClick={() => handleCellClick(dayIndex, hour)}
                          onMouseEnter={() => handleCellMouseEnter(dayIndex, hour)}
                          onMouseLeave={handleCellMouseLeave}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-3 bg-[#1a1a1a] border-t border-gray-800">
        <div className="flex flex-wrap gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white/[0.08] rounded border border-gray-700"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white/[0.02] rounded border border-gray-800"></div>
            <span>Unavailable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-600/40 rounded border border-green-700"></div>
            <span>Your selection</span>
          </div>
        </div>
      </div>
    </div>
  );
}
