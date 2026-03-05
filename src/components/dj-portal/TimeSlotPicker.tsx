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

const PT_TIMEZONE = 'America/Los_Angeles';

// All 24 hours available, default view scrolled to 9am–6pm PT
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 40; // pixels per hour
const DEFAULT_VIEW_START = 9; // Scroll to 9am on mount
const VISIBLE_HOUR_COUNT = 9; // Show 9 hours at a time
const VISIBLE_HEIGHT = VISIBLE_HOUR_COUNT * HOUR_HEIGHT;

// Format hour for display in PT
function formatHour(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

// Get the Sunday of the current week for a given date
function getSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return d;
}

// Format date for day header
function formatDayHeader(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  }

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Create a UTC timestamp for a given calendar date and hour in PT
function getTimestampInPT(baseDate: Date, hour: number): number {
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, '0');
  const day = String(baseDate.getDate()).padStart(2, '0');
  const hourStr = String(hour).padStart(2, '0');
  // Construct the target datetime as if it were UTC
  const asUTC = new Date(`${year}-${month}-${day}T${hourStr}:00:00Z`);
  // Find what PT shows for this UTC time, then compute offset
  const ptParts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(asUTC);
  const ptHour = parseInt(ptParts.find(p => p.type === 'hour')?.value || '0');
  const ptDay = parseInt(ptParts.find(p => p.type === 'day')?.value || '0');
  // offset = how many hours ahead UTC is from PT
  let offsetHours = asUTC.getUTCHours() - ptHour;
  if (ptDay !== asUTC.getUTCDate()) {
    offsetHours += (asUTC.getUTCDate() > ptDay) ? -24 : 24;
  }
  // The real UTC time for "hour in PT" = asUTC + offset
  return asUTC.getTime() + offsetHours * 60 * 60 * 1000;
}

export function TimeSlotPicker({ selectedSlots, onChange, setDuration }: TimeSlotPickerProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    // Start from Sunday of the current week
    return getSunday(new Date());
  });
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Hover preview state
  const [hoverSlot, setHoverSlot] = useState<{ dayIndex: number; startHour: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Duration in milliseconds
  const durationMs = setDuration * 60 * 60 * 1000;

  // Get days to show (Sunday to Saturday)
  const days = useMemo(() => {
    const result = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(currentWeekStart);
      day.setDate(day.getDate() + i);
      result.push(day);
    }
    return result;
  }, [currentWeekStart]);

  // Fetch blocked slots (existing broadcasts)
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

  // Scroll to 9am on mount once loading is done
  useEffect(() => {
    if (!isLoading && scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_VIEW_START * HOUR_HEIGHT;
    }
  }, [isLoading]);

  // Check if a time is blocked
  const isTimeBlocked = (timestamp: number): boolean => {
    return blockedSlots.some((slot) => timestamp >= slot.start && timestamp < slot.end);
  };

  // Check if time is in the past or within 36 hours
  const isTimeUnavailable = (timestamp: number): boolean => {
    const minTime = Date.now() + 36 * 60 * 60 * 1000; // 36 hours from now
    return timestamp < minTime;
  };

  // Get timestamp from day index and hour (in PT)
  const getTimestamp = (dayIndex: number, hour: number): number => {
    return getTimestampInPT(days[dayIndex], hour);
  };

  // Check if a slot from startTimestamp for the set duration is completely valid
  const isSlotValid = (dayIndex: number, startHour: number): boolean => {
    const startTime = getTimestamp(dayIndex, startHour);
    const endTime = startTime + durationMs;

    // Disallow slots that cross midnight (end hour > 24)
    const endHour = startHour + setDuration;
    if (endHour > 24) {
      return false;
    }

    // Check every 30-minute segment for blocked/unavailable time
    const segmentDuration = 30 * 60 * 1000; // 30 minutes
    for (let t = startTime; t < endTime; t += segmentDuration) {
      if (isTimeBlocked(t) || isTimeUnavailable(t)) {
        return false;
      }
    }

    return true;
  };

  // Handle click on a time cell - creates slot of setDuration
  const handleCellClick = (dayIndex: number, hour: number) => {
    const startTime = getTimestamp(dayIndex, hour);

    // Check if clicking on an already-selected slot (to deselect)
    const existingSlotIndex = selectedSlots.findIndex(
      (slot) => startTime >= slot.start && startTime < slot.end
    );

    if (existingSlotIndex !== -1) {
      // Remove the clicked slot
      onChange(selectedSlots.filter((_, i) => i !== existingSlotIndex));
      return;
    }

    // Validate the new slot
    if (!isSlotValid(dayIndex, hour)) {
      return;
    }

    const endTime = startTime + durationMs;
    const newSlot: TimeSlot = { start: startTime, end: endTime };

    // Remove any overlapping slots and add the new one
    const nonOverlapping = selectedSlots.filter(
      (slot) => slot.end <= newSlot.start || slot.start >= newSlot.end
    );

    onChange([...nonOverlapping, newSlot].sort((a, b) => a.start - b.start));
  };

  // Handle mouse enter for hover preview
  const handleCellMouseEnter = (dayIndex: number, hour: number) => {
    const startTime = getTimestamp(dayIndex, hour);

    // Don't show preview if already selected
    const isSelected = selectedSlots.some(
      (slot) => startTime >= slot.start && startTime < slot.end
    );
    if (isSelected) {
      setHoverSlot(null);
      return;
    }

    // Show preview if valid
    if (isSlotValid(dayIndex, hour)) {
      setHoverSlot({ dayIndex, startHour: hour });
    } else {
      setHoverSlot(null);
    }
  };

  const handleCellMouseLeave = () => {
    setHoverSlot(null);
  };

  // Check if a cell is within the hover preview slot
  const isInHoverPreview = (dayIndex: number, hour: number): boolean => {
    if (!hoverSlot || hoverSlot.dayIndex !== dayIndex) return false;

    const cellTime = getTimestamp(dayIndex, hour);
    const previewStart = getTimestamp(hoverSlot.dayIndex, hoverSlot.startHour);
    const previewEnd = previewStart + durationMs;

    return cellTime >= previewStart && cellTime < previewEnd;
  };

  // Check if a cell is in a selected slot
  const isInSelectedSlot = (dayIndex: number, hour: number): boolean => {
    const timestamp = getTimestamp(dayIndex, hour);
    return selectedSlots.some((slot) => timestamp >= slot.start && timestamp < slot.end);
  };

  // Remove a selected slot
  const removeSlot = (slotToRemove: TimeSlot) => {
    onChange(selectedSlots.filter((slot) => slot.start !== slotToRemove.start));
  };

  // Navigate weeks
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

  // Check if we can go back (don't go before the current week's Sunday)
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
          <p className="text-xs text-gray-500 mb-2">Selected time slots (PT):</p>
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
                    {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: PT_TIMEZONE })}{' '}
                    {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: PT_TIMEZONE })} -{' '}
                    {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: PT_TIMEZONE })}
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

      {/* Timezone label */}
      <div className="px-4 py-2 bg-[#1a1a1a] border-b border-gray-800">
        <p className="text-xs text-gray-500">All times in Pacific Time (PT)</p>
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[650px]">
            {/* Day headers */}
            <div className="flex border-b border-gray-800">
              <div className="flex-shrink-0 w-[50px] bg-[#0a0a0a]" />
              <div className="flex-1 grid grid-cols-7">
                {days.map((day, i) => (
                  <div
                    key={i}
                    className="p-2 text-center text-xs font-medium text-gray-400 border-l border-gray-800"
                  >
                    {formatDayHeader(day)}
                  </div>
                ))}
              </div>
            </div>

            {/* Scrollable time grid with time labels */}
            <div ref={scrollRef} className="overflow-y-auto select-none" style={{ maxHeight: VISIBLE_HEIGHT }}>
              {ALL_HOURS.map((hour) => (
                <div key={hour} className="flex border-b border-gray-800/50" style={{ height: HOUR_HEIGHT }}>
                  {/* Time label */}
                  <div className="flex-shrink-0 w-[50px] flex items-start justify-end pr-2 pt-1 bg-[#0a0a0a]">
                    <span className="text-xs text-gray-600">{formatHour(hour)}</span>
                  </div>
                  {/* Day cells */}
                  <div className="flex-1 grid grid-cols-7">
                    {days.map((_, dayIndex) => {
                      const timestamp = getTimestamp(dayIndex, hour);
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
                </div>
              ))}
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
