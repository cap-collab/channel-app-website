'use client';

import { useState, useMemo } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';

interface WeeklyCalendarProps {
  slots: BroadcastSlotSerialized[];
  onSlotClick: (slot: BroadcastSlotSerialized) => void;
  onCreateSlot: (startTime: Date, endTime: Date) => void;
  currentWeekStart: Date;
  onWeekChange: (newStart: Date) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48; // pixels per hour

export function WeeklyCalendar({
  slots,
  onSlotClick,
  onCreateSlot,
  currentWeekStart,
  onWeekChange,
}: WeeklyCalendarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ day: number; hour: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ day: number; hour: number } | null>(null);

  // Get days of the week
  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(currentWeekStart);
      day.setDate(day.getDate() + i);
      days.push(day);
    }
    return days;
  }, [currentWeekStart]);

  // Group slots by day
  const slotsByDay = useMemo(() => {
    const grouped: Record<number, BroadcastSlotSerialized[]> = {};
    slots.forEach(slot => {
      const slotDate = new Date(slot.startTime);
      const dayIndex = weekDays.findIndex(d =>
        d.toDateString() === slotDate.toDateString()
      );
      if (dayIndex >= 0) {
        if (!grouped[dayIndex]) grouped[dayIndex] = [];
        grouped[dayIndex].push(slot);
      }
    });
    return grouped;
  }, [slots, weekDays]);

  // Navigate weeks
  const goToPrevWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() - 7);
    onWeekChange(newStart);
  };

  const goToNextWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    onWeekChange(newStart);
  };

  const goToToday = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    onWeekChange(startOfWeek);
  };

  // Handle drag to create
  const handleMouseDown = (dayIndex: number, hour: number) => {
    setIsDragging(true);
    setDragStart({ day: dayIndex, hour });
    setDragEnd({ day: dayIndex, hour: hour + 1 });
  };

  const handleMouseMove = (dayIndex: number, hour: number) => {
    if (isDragging && dragStart && dragStart.day === dayIndex) {
      setDragEnd({ day: dayIndex, hour: Math.max(hour + 1, dragStart.hour + 1) });
    }
  };

  const handleMouseUp = () => {
    if (isDragging && dragStart && dragEnd) {
      const startDate = new Date(weekDays[dragStart.day]);
      startDate.setHours(dragStart.hour, 0, 0, 0);

      const endDate = new Date(weekDays[dragEnd.day]);
      endDate.setHours(dragEnd.hour, 0, 0, 0);

      if (endDate > startDate) {
        onCreateSlot(startDate, endDate);
      }
    }
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  };

  // Render a slot on the calendar
  const renderSlot = (slot: BroadcastSlotSerialized) => {
    const startDate = new Date(slot.startTime);
    const endDate = new Date(slot.endTime);

    const startHour = startDate.getHours() + startDate.getMinutes() / 60;
    const endHour = endDate.getHours() + endDate.getMinutes() / 60;
    const duration = endHour - startHour;

    const top = startHour * HOUR_HEIGHT;
    const height = Math.max(duration * HOUR_HEIGHT, 24);

    const isLive = slot.status === 'live';
    const isPast = endDate < new Date();

    return (
      <div
        key={slot.id}
        onClick={(e) => {
          e.stopPropagation();
          onSlotClick(slot);
        }}
        className={`absolute left-1 right-1 rounded-lg px-2 py-1 cursor-pointer overflow-hidden transition-all hover:brightness-110 ${
          isLive
            ? 'bg-red-600 border-2 border-red-400'
            : isPast
              ? 'bg-gray-700 opacity-60'
              : 'bg-blue-600 hover:bg-blue-500'
        }`}
        style={{ top: `${top}px`, height: `${height}px` }}
      >
        <div className="text-white text-xs font-medium truncate">
          {slot.djName}
        </div>
        {height > 30 && (
          <div className="text-white/70 text-xs truncate">
            {slot.showName || formatTime(startDate)}
          </div>
        )}
        {isLive && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-red-400 rounded-full animate-pulse" />
        )}
      </div>
    );
  };

  // Format helpers
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatDayHeader = (date: Date) => {
    const isToday = date.toDateString() === new Date().toDateString();
    return (
      <div className={`text-center py-2 ${isToday ? 'bg-blue-900/30' : ''}`}>
        <div className="text-gray-400 text-xs uppercase">
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-lg font-semibold ${isToday ? 'text-blue-400' : 'text-white'}`}>
          {date.getDate()}
        </div>
      </div>
    );
  };

  // Drag selection overlay
  const renderDragSelection = (dayIndex: number) => {
    if (!isDragging || !dragStart || !dragEnd || dragStart.day !== dayIndex) return null;

    const startHour = Math.min(dragStart.hour, dragEnd.hour);
    const endHour = Math.max(dragStart.hour, dragEnd.hour);
    const top = startHour * HOUR_HEIGHT;
    const height = (endHour - startHour) * HOUR_HEIGHT;

    return (
      <div
        className="absolute left-1 right-1 bg-green-500/30 border-2 border-green-400 border-dashed rounded-lg pointer-events-none"
        style={{ top: `${top}px`, height: `${height}px` }}
      />
    );
  };

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      {/* Header with navigation */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevWeek}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
          >
            Today
          </button>
          <button
            onClick={goToNextWeek}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <h2 className="text-lg font-semibold text-white">
          {weekDays[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h2>

        <div className="text-sm text-gray-400">
          Click &amp; drag to create a slot
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex">
        {/* Time labels */}
        <div className="w-16 flex-shrink-0 border-r border-gray-800">
          <div className="h-[52px]" /> {/* Header spacer */}
          {HOURS.map(hour => (
            <div
              key={hour}
              className="text-right pr-2 text-xs text-gray-500"
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="flex-1 flex" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          {weekDays.map((day, dayIndex) => (
            <div key={dayIndex} className="flex-1 border-r border-gray-800 last:border-r-0">
              {formatDayHeader(day)}
              <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
                {/* Hour grid lines */}
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="border-t border-gray-800/50 cursor-crosshair"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                    onMouseDown={() => handleMouseDown(dayIndex, hour)}
                    onMouseMove={() => handleMouseMove(dayIndex, hour)}
                  />
                ))}

                {/* Slots */}
                {slotsByDay[dayIndex]?.map(renderSlot)}

                {/* Drag selection */}
                {renderDragSelection(dayIndex)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
