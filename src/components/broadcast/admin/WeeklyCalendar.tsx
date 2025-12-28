'use client';

import { useState, useMemo, useEffect } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';

interface WeeklyCalendarProps {
  slots: BroadcastSlotSerialized[];
  onSlotClick: (slot: BroadcastSlotSerialized) => void;
  onCreateSlot: (startTime: Date, endTime: Date) => void;
  onUpdateSlot?: (slotId: string, updates: { startTime?: number; endTime?: number }) => Promise<void>;
  currentWeekStart: Date;
  onWeekChange: (newStart: Date) => void;
  venueName: string;
  venueSlug: string;
}

interface ContextMenuState {
  slot: BroadcastSlotSerialized;
  x: number;
  y: number;
}

// Segment of a slot for rendering (handles overnight shows)
interface SlotSegment {
  slot: BroadcastSlotSerialized;
  dayIndex: number;
  startHour: number;
  endHour: number;
  isFirstSegment: boolean;
  isLastSegment: boolean;
  segmentIndex: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48; // pixels per hour

export function WeeklyCalendar({
  slots,
  onSlotClick,
  onCreateSlot,
  onUpdateSlot,
  currentWeekStart,
  onWeekChange,
  venueName,
  venueSlug,
}: WeeklyCalendarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ day: number; hour: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ day: number; hour: number } | null>(null);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeSlot, setResizeSlot] = useState<BroadcastSlotSerialized | null>(null);
  const [resizeEdge, setResizeEdge] = useState<'top' | 'bottom' | null>(null);
  const [resizeHour, setResizeHour] = useState<number | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copied, setCopied] = useState(false);

  // Current time state for the time indicator line
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

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

  // Calculate slot segments for overnight shows
  const calculateSlotSegments = (slot: BroadcastSlotSerialized): SlotSegment[] => {
    const startDate = new Date(slot.startTime);
    const endDate = new Date(slot.endTime);
    const segments: SlotSegment[] = [];

    const startDayIndex = weekDays.findIndex(d =>
      d.toDateString() === startDate.toDateString()
    );

    const endDayIndex = weekDays.findIndex(d =>
      d.toDateString() === endDate.toDateString()
    );

    if (startDayIndex < 0 && endDayIndex < 0) return segments;

    const startHour = startDate.getHours() + startDate.getMinutes() / 60;
    const endHour = endDate.getHours() + endDate.getMinutes() / 60;

    // Same day slot
    if (startDayIndex === endDayIndex) {
      if (startDayIndex >= 0) {
        segments.push({
          slot,
          dayIndex: startDayIndex,
          startHour,
          endHour,
          isFirstSegment: true,
          isLastSegment: true,
          segmentIndex: 0,
        });
      }
      return segments;
    }

    // Overnight or multi-day slot
    // First segment: start day, startHour to midnight
    if (startDayIndex >= 0) {
      segments.push({
        slot,
        dayIndex: startDayIndex,
        startHour,
        endHour: 24,
        isFirstSegment: true,
        isLastSegment: false,
        segmentIndex: 0,
      });
    }

    // Middle segments (full days)
    const actualStartDay = startDayIndex >= 0 ? startDayIndex : 0;
    const actualEndDay = endDayIndex >= 0 ? endDayIndex : 6;
    for (let day = actualStartDay + 1; day < actualEndDay; day++) {
      if (day >= 0 && day < 7) {
        segments.push({
          slot,
          dayIndex: day,
          startHour: 0,
          endHour: 24,
          isFirstSegment: false,
          isLastSegment: false,
          segmentIndex: segments.length,
        });
      }
    }

    // Last segment: end day, midnight to endHour
    if (endDayIndex >= 0 && endDayIndex < 7 && endHour > 0) {
      segments.push({
        slot,
        dayIndex: endDayIndex,
        startHour: 0,
        endHour,
        isFirstSegment: startDayIndex < 0,
        isLastSegment: true,
        segmentIndex: segments.length,
      });
    }

    return segments;
  };

  // Group slot segments by day
  const segmentsByDay = useMemo(() => {
    const grouped: Record<number, SlotSegment[]> = {};

    slots.forEach(slot => {
      const segments = calculateSlotSegments(slot);
      segments.forEach(segment => {
        if (!grouped[segment.dayIndex]) grouped[segment.dayIndex] = [];
        grouped[segment.dayIndex].push(segment);
      });
    });

    return grouped;
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (isResizing) return;
    setIsDragging(true);
    setDragStart({ day: dayIndex, hour });
    setDragEnd({ day: dayIndex, hour: hour + 1 });
  };

  const handleMouseMove = (dayIndex: number, hour: number, e?: React.MouseEvent) => {
    if (isResizing && resizeSlot) {
      // Calculate fractional position within the hour cell for precise resizing
      let fractionalOffset = 0;
      if (e) {
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        fractionalOffset = (e.clientY - rect.top) / rect.height;
      }
      handleResizeMove(hour, fractionalOffset);
    } else if (isDragging && dragStart && dragStart.day === dayIndex) {
      setDragEnd({ day: dayIndex, hour: Math.max(hour + 1, dragStart.hour + 1) });
    }
  };

  const handleMouseUp = async () => {
    if (isResizing) {
      await handleResizeEnd();
    } else if (isDragging && dragStart && dragEnd) {
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

  // Resize handlers
  const handleResizeStart = (
    e: React.MouseEvent,
    slot: BroadcastSlotSerialized,
    edge: 'top' | 'bottom'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setResizeSlot(slot);
    setResizeEdge(edge);

    const startDate = new Date(slot.startTime);
    const endDate = new Date(slot.endTime);
    setResizeHour(edge === 'top'
      ? startDate.getHours() + startDate.getMinutes() / 60
      : endDate.getHours() + endDate.getMinutes() / 60
    );
  };

  const handleResizeMove = (hour: number, fractionalOffset: number = 0) => {
    if (!isResizing || !resizeSlot) return;

    // Calculate precise hour with fractional offset from mouse position
    const preciseHour = hour + fractionalOffset;

    // Snap to 30-minute increments
    const snappedHour = Math.round(preciseHour * 2) / 2;

    const startDate = new Date(resizeSlot.startTime);
    const endDate = new Date(resizeSlot.endTime);
    const startHour = startDate.getHours() + startDate.getMinutes() / 60;
    const endHour = endDate.getHours() + endDate.getMinutes() / 60;

    if (resizeEdge === 'top') {
      // Allow moving start time both earlier and later (minimum 30 min slot)
      if (snappedHour < endHour - 0.5 && snappedHour >= 0) {
        setResizeHour(snappedHour);
      }
    } else {
      // Allow moving end time both earlier and later (minimum 30 min slot)
      if (snappedHour > startHour + 0.5 && snappedHour <= 24) {
        setResizeHour(snappedHour);
      }
    }
  };

  const handleResizeEnd = async () => {
    if (!isResizing || !resizeSlot || resizeHour === null || !onUpdateSlot) {
      setIsResizing(false);
      setResizeSlot(null);
      setResizeEdge(null);
      setResizeHour(null);
      return;
    }

    const startDate = new Date(resizeSlot.startTime);
    const endDate = new Date(resizeSlot.endTime);

    let newStartTime = resizeSlot.startTime;
    let newEndTime = resizeSlot.endTime;

    if (resizeEdge === 'top') {
      const newStart = new Date(startDate);
      newStart.setHours(Math.floor(resizeHour), Math.round((resizeHour % 1) * 60), 0, 0);
      newStartTime = newStart.getTime();
    } else {
      const newEnd = new Date(endDate);
      newEnd.setHours(Math.floor(resizeHour), Math.round((resizeHour % 1) * 60), 0, 0);
      newEndTime = newEnd.getTime();
    }

    if (newStartTime !== resizeSlot.startTime || newEndTime !== resizeSlot.endTime) {
      await onUpdateSlot(resizeSlot.id, {
        startTime: newStartTime,
        endTime: newEndTime,
      });
    }

    setIsResizing(false);
    setResizeSlot(null);
    setResizeEdge(null);
    setResizeHour(null);
  };

  // Render a slot segment on the calendar
  const renderSlotSegment = (segment: SlotSegment) => {
    const { slot, startHour, endHour, isFirstSegment, isLastSegment } = segment;

    // Calculate display position (may be overridden during resize)
    let displayStartHour = startHour;
    let displayEndHour = endHour;

    if (isResizing && resizeSlot?.id === slot.id && resizeHour !== null) {
      if (resizeEdge === 'top' && isFirstSegment) {
        displayStartHour = resizeHour;
      } else if (resizeEdge === 'bottom' && isLastSegment) {
        displayEndHour = resizeHour;
      }
    }

    const duration = displayEndHour - displayStartHour;
    const top = displayStartHour * HOUR_HEIGHT;
    const height = Math.max(duration * HOUR_HEIGHT, 24);

    const isLive = slot.status === 'live';
    const isPast = new Date(slot.endTime) < new Date();
    const isRemote = slot.broadcastType === 'remote';

    const getSlotColors = () => {
      if (isLive) return 'bg-red-600 border-2 border-red-400';
      if (isPast) return 'bg-gray-600 opacity-60';
      if (isRemote) return 'bg-blue-600 hover:bg-blue-500';
      return 'bg-accent hover:bg-accent-hover'; // venue slots
    };

    // Border radius based on segment position
    const borderRadius = isFirstSegment && isLastSegment
      ? 'rounded-lg'
      : isFirstSegment
        ? 'rounded-t-lg rounded-b-none'
        : isLastSegment
          ? 'rounded-t-none rounded-b-lg'
          : 'rounded-none';

    // Get DJ info for display
    const getDJInfo = () => {
      if (slot.djSlots && slot.djSlots.length > 0) {
        const djNames = slot.djSlots
          .filter(dj => dj.djName)
          .map(dj => dj.djName)
          .join(', ');
        return djNames || null;
      }
      return slot.djName || null;
    };

    const djInfo = getDJInfo();

    return (
      <div
        key={`${slot.id}-${segment.segmentIndex}`}
        className={`absolute left-1 right-1 ${borderRadius} cursor-pointer overflow-visible transition-all hover:brightness-110 ${getSlotColors()}`}
        style={{ top: `${top}px`, height: `${height}px`, pointerEvents: isResizing ? 'none' : 'auto' }}
      >
        {/* Top resize handle */}
        {isFirstSegment && !isPast && onUpdateSlot && (
          <div
            className="absolute -top-1 left-0 right-0 h-3 cursor-ns-resize group z-10"
            onMouseDown={(e) => handleResizeStart(e, slot, 'top')}
          >
            <div className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-white/0 group-hover:bg-white/50 rounded-full transition-colors" />
          </div>
        )}

        {/* Content */}
        <div
          className="px-2 py-1 h-full overflow-hidden"
          onClick={(e) => {
            e.stopPropagation();
            if (!isResizing) onSlotClick(slot);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ slot, x: e.clientX, y: e.clientY });
          }}
        >
          {/* Continuation indicator at top */}
          {!isFirstSegment && (
            <div className="text-white/50 text-xs italic mb-0.5">...continued</div>
          )}

          {/* Show name (primary) */}
          {isFirstSegment && (
            <div className="text-white text-xs font-medium truncate flex items-center gap-1">
              {isRemote && (
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {slot.showName}
            </div>
          )}

          {/* DJ info (secondary) */}
          {height > 30 && isFirstSegment && djInfo && (
            <div className="text-white/70 text-xs truncate">
              {djInfo}
            </div>
          )}

          {/* Multiple DJs indicator */}
          {height > 50 && isFirstSegment && slot.djSlots && slot.djSlots.length > 1 && (
            <div className="text-white/50 text-xs mt-0.5">
              {slot.djSlots.length} DJs
            </div>
          )}

          {/* Continuation indicator at bottom */}
          {!isLastSegment && (
            <div className="absolute bottom-1 left-2 text-white/50 text-xs italic">continues...</div>
          )}

          {isLive && (
            <div className="absolute top-1 right-1 w-2 h-2 bg-red-400 rounded-full animate-pulse" />
          )}
        </div>

        {/* Bottom resize handle */}
        {isLastSegment && !isPast && onUpdateSlot && (
          <div
            className="absolute -bottom-1 left-0 right-0 h-3 cursor-ns-resize group z-10"
            onMouseDown={(e) => handleResizeStart(e, slot, 'bottom')}
          >
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-white/0 group-hover:bg-white/50 rounded-full transition-colors" />
          </div>
        )}
      </div>
    );
  };

  // Format helpers
  const formatDayHeader = (date: Date) => {
    const isToday = date.toDateString() === new Date().toDateString();
    return (
      <div className={`text-center py-2 ${isToday ? 'bg-accent/10' : ''}`}>
        <div className="text-gray-400 text-xs uppercase">
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className={`text-lg font-semibold ${isToday ? 'text-accent' : 'text-white'}`}>
          {date.getDate()}
        </div>
      </div>
    );
  };

  // Current time indicator line
  const renderCurrentTimeIndicator = (dayIndex: number) => {
    const day = weekDays[dayIndex];
    const isToday = day.toDateString() === currentTime.toDateString();

    if (!isToday) return null;

    const currentHour = currentTime.getHours() + currentTime.getMinutes() / 60;
    const top = currentHour * HOUR_HEIGHT;

    return (
      <div
        className="absolute left-0 right-0 z-30 pointer-events-none"
        style={{ top: `${top}px` }}
      >
        {/* Red dot on the left */}
        <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-red-500 rounded-full" />
        {/* Red line across the column */}
        <div className="absolute left-0 right-0 h-0.5 bg-red-500" />
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

  // Context menu handlers
  const getBroadcastUrl = (slot: BroadcastSlotSerialized) => {
    return slot.broadcastType === 'venue'
      ? `${window.location.origin}/broadcast/${venueSlug}`
      : `${window.location.origin}/broadcast/live?token=${slot.broadcastToken}`;
  };

  const handleCopyLink = async () => {
    if (!contextMenu) return;
    try {
      await navigator.clipboard.writeText(getBroadcastUrl(contextMenu.slot));
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setContextMenu(null);
      }, 1500);
    } catch (error) {
      console.error('Failed to copy:', error);
      setContextMenu(null);
    }
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
    setCopied(false);
  };

  return (
    <div className="bg-black rounded-xl overflow-hidden">
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

        <div className="flex items-center gap-4">
          {/* Legend */}
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-accent"></div>
              <span className="text-gray-400">{venueName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-blue-600"></div>
              <span className="text-gray-400">Remote</span>
            </div>
          </div>
          <div className="text-sm text-gray-500">|</div>
          <div className="text-sm text-gray-400">
            Click &amp; drag to create a slot
          </div>
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
                {/* Hour grid lines - during resize, render on top to capture mouse events */}
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className={`border-t border-gray-800/50 ${isResizing ? 'cursor-ns-resize' : 'cursor-crosshair'}`}
                    style={{
                      height: `${HOUR_HEIGHT}px`,
                      position: isResizing ? 'relative' : undefined,
                      zIndex: isResizing ? 20 : undefined,
                    }}
                    onMouseDown={() => handleMouseDown(dayIndex, hour)}
                    onMouseMove={(e) => handleMouseMove(dayIndex, hour, e)}
                  />
                ))}

                {/* Slot segments */}
                {segmentsByDay[dayIndex]?.map(renderSlotSegment)}

                {/* Current time indicator */}
                {renderCurrentTimeIndicator(dayIndex)}

                {/* Drag selection */}
                {renderDragSelection(dayIndex)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-40"
            onClick={handleCloseContextMenu}
          />
          {/* Menu */}
          <div
            className="fixed z-50 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-2 border-b border-gray-700">
              <p className="text-white text-sm font-medium truncate">{contextMenu.slot.showName}</p>
              <p className="text-gray-400 text-xs">
                {new Date(contextMenu.slot.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
            </div>
            <button
              onClick={handleCopyLink}
              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Broadcast Link
                </>
              )}
            </button>
            <button
              onClick={() => {
                onSlotClick(contextMenu.slot);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Show
            </button>
          </div>
        </>
      )}
    </div>
  );
}
