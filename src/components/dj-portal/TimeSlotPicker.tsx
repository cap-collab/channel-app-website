'use client';

import { useState, useMemo, useEffect } from 'react';
import { TimeSlot } from '@/types/dj-application';

interface TimeSlotPickerProps {
  selectedSlots: TimeSlot[];
  onChange: (slots: TimeSlot[]) => void;
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

export function TimeSlotPicker({ selectedSlots, onChange }: TimeSlotPickerProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    // Start from today, not Sunday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ day: number; hour: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ day: number; hour: number } | null>(null);

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

  // Handle mouse down on grid
  const handleMouseDown = (dayIndex: number, hour: number, e: React.MouseEvent) => {
    e.preventDefault();
    const timestamp = getTimestamp(dayIndex, hour);
    if (isTimeBlocked(timestamp) || isTimeUnavailable(timestamp)) return;

    setIsDragging(true);
    setDragStart({ day: dayIndex, hour });
    setDragEnd({ day: dayIndex, hour });
  };

  // Handle mouse move
  const handleMouseMove = (dayIndex: number, hour: number) => {
    if (!isDragging || !dragStart) return;
    // Only allow same-day selection
    if (dayIndex !== dragStart.day) return;
    setDragEnd({ day: dayIndex, hour });
  };

  // Handle mouse up
  const handleMouseUp = () => {
    if (!isDragging || !dragStart || !dragEnd) {
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
      return;
    }

    const startHour = Math.min(dragStart.hour, dragEnd.hour);
    const endHour = Math.max(dragStart.hour, dragEnd.hour) + 1; // +1 to include the end hour

    const startTime = getTimestamp(dragStart.day, startHour);
    const endTime = getTimestamp(dragStart.day, endHour);

    // Check if any part of the selection is blocked or unavailable
    let isValid = true;
    for (let h = startHour; h < endHour; h++) {
      const ts = getTimestamp(dragStart.day, h);
      if (isTimeBlocked(ts) || isTimeUnavailable(ts)) {
        isValid = false;
        break;
      }
    }

    if (isValid && endHour - startHour >= 1) {
      // Add the new slot
      const newSlot: TimeSlot = { start: startTime, end: endTime };

      // Check if it overlaps with existing selected slots
      const nonOverlapping = selectedSlots.filter(
        (slot) => slot.end <= newSlot.start || slot.start >= newSlot.end
      );

      onChange([...nonOverlapping, newSlot].sort((a, b) => a.start - b.start));
    }

    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  };

  // Check if a cell is in the drag selection
  const isInDragSelection = (dayIndex: number, hour: number): boolean => {
    if (!isDragging || !dragStart || !dragEnd) return false;
    if (dayIndex !== dragStart.day) return false;

    const minHour = Math.min(dragStart.hour, dragEnd.hour);
    const maxHour = Math.max(dragStart.hour, dragEnd.hour);
    return hour >= minHour && hour <= maxHour;
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
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        ) : (
          <div className="min-w-[700px]">
            {/* Day headers */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-800">
              <div className="p-2 text-xs text-gray-600"></div>
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
            <div
              className="relative select-none"
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                if (isDragging) handleMouseUp();
              }}
            >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-800/50"
                  style={{ height: HOUR_HEIGHT }}
                >
                  {/* Hour label */}
                  <div className="flex items-start justify-end pr-2 pt-1">
                    <span className="text-xs text-gray-600">{formatHour(hour)}</span>
                  </div>

                  {/* Day cells */}
                  {days.map((_, dayIndex) => {
                    const timestamp = getTimestamp(dayIndex, hour);
                    const blocked = isTimeBlocked(timestamp);
                    const unavailable = isTimeUnavailable(timestamp);
                    const inDrag = isInDragSelection(dayIndex, hour);
                    const selected = isInSelectedSlot(dayIndex, hour);

                    return (
                      <div
                        key={dayIndex}
                        className={`
                          border-l border-gray-800/50 cursor-pointer transition-colors
                          ${blocked ? 'bg-gray-800/50 cursor-not-allowed' : ''}
                          ${unavailable && !blocked ? 'bg-red-950/40 cursor-not-allowed' : ''}
                          ${inDrag && !blocked && !unavailable ? 'bg-green-900/50' : ''}
                          ${selected && !inDrag ? 'bg-green-900/40' : ''}
                          ${!blocked && !unavailable && !inDrag && !selected ? 'hover:bg-gray-800/30' : ''}
                        `}
                        onMouseDown={(e) => handleMouseDown(dayIndex, hour, e)}
                        onMouseMove={() => handleMouseMove(dayIndex, hour)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 bg-[#1a1a1a] border-t border-gray-800 flex gap-6 text-xs text-gray-500">
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
  );
}
