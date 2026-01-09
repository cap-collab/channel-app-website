'use client';

import { useState, useMemo, useEffect } from 'react';
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

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 40; // pixels per hour

// Format hour for display
function formatHour(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
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

export function TimeSlotPicker({ selectedSlots, onChange, setDuration }: TimeSlotPickerProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    // Start from today, not Sunday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Hover preview state
  const [hoverSlot, setHoverSlot] = useState<{ dayIndex: number; startHour: number } | null>(null);

  // Duration in milliseconds
  const durationMs = setDuration * 60 * 60 * 1000;

  // Get days to show (7 days starting from current week start)
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

  // Check if a time is blocked
  const isTimeBlocked = (timestamp: number): boolean => {
    return blockedSlots.some((slot) => timestamp >= slot.start && timestamp < slot.end);
  };

  // Check if time is in the past or within 48 hours
  const isTimeUnavailable = (timestamp: number): boolean => {
    const minTime = Date.now() + 48 * 60 * 60 * 1000; // 48 hours from now
    return timestamp < minTime;
  };

  // Get timestamp from day index and hour
  const getTimestamp = (dayIndex: number, hour: number): number => {
    const date = new Date(days[dayIndex]);
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  };

  // Check if a slot from startTimestamp for the set duration is completely valid
  const isSlotValid = (dayIndex: number, startHour: number): boolean => {
    const startTime = getTimestamp(dayIndex, startHour);
    const endTime = startTime + durationMs;

    // Check if slot extends past midnight
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const crossesMidnight = startDate.getDate() !== endDate.getDate();

    // Disallow slots that cross midnight
    if (crossesMidnight) {
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
    // Don't go before today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (newStart >= today) {
      setCurrentWeekStart(newStart);
    }
  };

  const goToNextWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    setCurrentWeekStart(newStart);
  };

  // Check if we can go back
  const canGoPrev = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return currentWeekStart > today;
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
      <div className="flex">
        {/* Sticky time column - stays fixed while days scroll */}
        <div className="flex-shrink-0 w-[50px] bg-[#0a0a0a] z-10">
          {/* Empty header cell */}
          <div className="h-[33px] border-b border-gray-800"></div>
          {/* Hour labels */}
          {!isLoading && HOURS.map((hour) => (
            <div
              key={hour}
              className="flex items-start justify-end pr-2 pt-1 border-b border-gray-800/50"
              style={{ height: HOUR_HEIGHT }}
            >
              <span className="text-xs text-gray-600">{formatHour(hour)}</span>
            </div>
          ))}
        </div>

        {/* Scrollable days container */}
        <div className="flex-1 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        ) : (
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

            {/* Time grid */}
            <div className="relative select-none">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="grid grid-cols-7 border-b border-gray-800/50"
                  style={{ height: HOUR_HEIGHT }}
                >
                  {/* Day cells */}
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
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

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
