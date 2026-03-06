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

function formatDayHeader(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Get a UTC timestamp for a given calendar date and hour in local time
function getTimestamp(baseDate: Date, hour: number): number {
  const d = new Date(baseDate);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function TimeSlotPicker({ selectedSlots, onChange, setDuration }: TimeSlotPickerProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getSunday(new Date()));
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
        if (timestamp >= minTime && !blockedSlots.some(s => timestamp >= s.start && timestamp < s.end)) {
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

  const isTimeBlocked = (timestamp: number): boolean => {
    return blockedSlots.some((slot) => timestamp >= slot.start && timestamp < slot.end);
  };

  const isTimeUnavailable = (timestamp: number): boolean => {
    const minTime = Date.now() + 36 * 60 * 60 * 1000;
    return timestamp < minTime;
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
            <div className="p-2 border-b border-gray-800">
              <span className="text-xs">&nbsp;</span>
            </div>
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
              <div className="grid grid-cols-7 border-b border-gray-800">
                {days.map((day, i) => (
                  <div
                    key={i}
                    className="p-2 text-center text-xs font-medium text-gray-400 border-l border-gray-800"
                  >
                    {formatDayHeader(day)}
                  </div>
                ))}
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
                            ${blocked ? 'bg-gray-800/50 cursor-not-allowed' : ''}
                            ${unavailable && !blocked ? 'bg-red-950/40 cursor-not-allowed' : ''}
                            ${selected ? 'bg-green-900/40 cursor-pointer' : ''}
                            ${inPreview && !selected ? 'bg-green-900/30 cursor-pointer' : ''}
                            ${!blocked && !unavailable && !selected && !inPreview && canSelect ? 'hover:bg-gray-800/30 cursor-pointer' : ''}
                            ${!blocked && !unavailable && !canSelect && !selected ? 'cursor-not-allowed' : ''}
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
        <div className="flex gap-6 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-800/50 rounded"></div>
            <span>Booked</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-950/40 rounded"></div>
            <span>Unavailable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-900/40 rounded"></div>
            <span>Your selection</span>
          </div>
        </div>
      </div>
    </div>
  );
}
