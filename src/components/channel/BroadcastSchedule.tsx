'use client';

import { useMemo } from 'react';
import { BroadcastSlotSerialized, DJSlot } from '@/types/broadcast';

interface BroadcastScheduleProps {
  shows: BroadcastSlotSerialized[];
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  loading: boolean;
  currentShow: BroadcastSlotSerialized | null;
}

// Expanded slot for display - either a single show or a DJ slot within a venue show
interface DisplaySlot {
  id: string;
  parentShowId: string;
  showName: string;
  djName?: string;
  startTime: number;
  endTime: number;
  status?: string;
  isVenueSlot: boolean;
  originalShow: BroadcastSlotSerialized;
  djSlot?: DJSlot;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear()
  );
}

function ShowBlock({
  slot,
  isCurrentSlot,
  isFirst,
}: {
  slot: DisplaySlot;
  isCurrentSlot: boolean;
  isFirst: boolean;
}) {
  const now = Date.now();
  // Check if this specific slot is live (for venue shows, check DJ slot time)
  const isLive = slot.originalShow.status === 'live' &&
    slot.startTime <= now && slot.endTime > now;
  const isPast = slot.endTime < now;

  return (
    <div
      className={`transition-colors ${
        !isFirst ? 'border-t border-accent' : ''
      } ${
        isCurrentSlot
          ? 'bg-accent/10'
          : isPast
          ? 'bg-black/50 opacity-60'
          : 'bg-black'
      }`}
    >
      <div className="py-4">
        <div className="flex items-start justify-between gap-4">
          {/* Time */}
          <div className="flex-shrink-0 w-24">
            <p className="text-gray-400 text-sm">
              {formatTime(slot.startTime)}
            </p>
            <p className="text-gray-600 text-xs">
              {formatTime(slot.endTime)}
            </p>
          </div>

          {/* Show info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-white font-medium truncate">{slot.showName}</h3>
              {isLive && (
                <span className="flex items-center gap-1 bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            {/* Always show DJ name on its own line */}
            <p className="text-gray-400 text-sm truncate">
              {slot.djName || 'TBD'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BroadcastSchedule({
  shows,
  selectedDate,
  onDateChange,
  loading,
  currentShow,
}: BroadcastScheduleProps) {
  // Expand shows with djSlots into individual rows
  const displaySlots = useMemo<DisplaySlot[]>(() => {
    const slots: DisplaySlot[] = [];

    for (const show of shows) {
      // If show has djSlots, create a row for each DJ slot (like iOS calendar)
      if (show.djSlots && show.djSlots.length > 0) {
        for (const djSlot of show.djSlots) {
          slots.push({
            id: `${show.id}-${djSlot.id}`,
            parentShowId: show.id,
            showName: show.showName,
            djName: djSlot.djName || djSlot.liveDjUsername,
            startTime: djSlot.startTime,
            endTime: djSlot.endTime,
            status: show.status,
            isVenueSlot: true,
            originalShow: show,
            djSlot,
          });
        }
      } else {
        // Regular show without djSlots - show as single row
        slots.push({
          id: show.id,
          parentShowId: show.id,
          showName: show.showName,
          djName: show.djName || show.liveDjUsername,
          startTime: show.startTime,
          endTime: show.endTime,
          status: show.status,
          isVenueSlot: false,
          originalShow: show,
        });
      }
    }

    // Sort by start time
    return slots.sort((a, b) => a.startTime - b.startTime);
  }, [shows]);

  const goToPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    onDateChange(prev);
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    onDateChange(next);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Date navigation - Sticky */}
      <div className="flex-shrink-0 sticky top-0 bg-black pb-4 z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevDay}
            disabled={isToday(selectedDate)}
            className="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-white font-medium">
            {isToday(selectedDate) ? 'Today' : isTomorrow(selectedDate) ? 'Tomorrow' : formatDate(selectedDate)}
          </span>
          <button
            onClick={goToNextDay}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Schedule list - Scrollable */}
      <div className="flex-1 overflow-y-auto">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <svg className="w-6 h-6 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : displaySlots.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-500">No show scheduled for this day</p>
        </div>
      ) : (
        <div>
          {displaySlots.map((slot, index) => (
            <ShowBlock
              key={slot.id}
              slot={slot}
              isCurrentSlot={currentShow?.id === slot.parentShowId}
              isFirst={index === 0}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
