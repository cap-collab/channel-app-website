'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { BroadcastSlotSerialized, DJSlot } from '@/types/broadcast';

interface BroadcastScheduleProps {
  shows: BroadcastSlotSerialized[];
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  loading: boolean;
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

// Get day boundaries (midnight to midnight) for a given date
function getDayBoundaries(date: Date): { dayStart: number; dayEnd: number } {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  return { dayStart: dayStart.getTime(), dayEnd: dayEnd.getTime() };
}

// Check if a slot overlaps with a day
function slotOverlapsDay(slotStart: number, slotEnd: number, dayStart: number, dayEnd: number): boolean {
  return slotStart <= dayEnd && slotEnd >= dayStart;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function ShowRow({ slot }: { slot: DisplaySlot }) {
  // Resolve DJ profile username for navigation
  const djProfileUsername = (() => {
    if (slot.isVenueSlot && slot.djSlot) {
      return slot.djSlot.liveDjUsername || slot.djSlot.djUsername || slot.djSlot.djName || null;
    }
    return slot.originalShow.liveDjUsername || slot.originalShow.djUsername || slot.originalShow.djName || null;
  })();

  const djProfileSlug = djProfileUsername
    ? djProfileUsername.replace(/[\s-]+/g, '').toLowerCase()
    : null;

  // Show image priority: show image > DJ photo (via API)
  const showImageUrl = slot.originalShow.showImageUrl || null;
  const djNameForPhoto = slot.djName || djProfileUsername;
  const djPhotoApiUrl = djNameForPhoto
    ? `/api/dj-photo/${encodeURIComponent(djNameForPhoto.replace(/[\s-]+/g, '').toLowerCase())}`
    : null;
  const photoUrl = showImageUrl || djPhotoApiUrl;

  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    setPhotoLoaded(false);
    setPhotoError(false);
  }, [photoUrl]);

  const isRestream = slot.originalShow.broadcastType === 'restream';
  const isLive = slot.originalShow.status === 'live' &&
    slot.startTime <= Date.now() && slot.endTime > Date.now();

  const content = (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-500/30 ${
        djProfileSlug ? 'cursor-pointer hover:bg-white/5' : ''
      }`}
    >
      {/* Photo */}
      {photoUrl && !photoError && (
        <div className={`w-9 h-9 flex-shrink-0 relative ${photoLoaded ? '' : 'bg-white/5'}`}>
          <Image
            src={photoUrl}
            alt={slot.djName || 'DJ'}
            fill
            sizes="36px"
            className="object-cover"
            onLoad={() => setPhotoLoaded(true)}
            onError={() => setPhotoError(true)}
            unoptimized
          />
        </div>
      )}

      {/* Show name + DJ */}
      <div className="flex-1 min-w-0">
        <h3 className="text-white font-medium text-sm truncate">{slot.showName}</h3>
        {slot.djName && (
          <p className="text-white/50 text-xs truncate">{slot.djName}</p>
        )}
      </div>

      {/* Time range + type indicator */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-gray-500 text-[10px] tabular-nums">
          {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
        </span>
        {isRestream ? (
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b7280"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        ) : isLive ? (
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        ) : (
          <span className="w-2 h-2 bg-red-600/40 rounded-full" />
        )}
      </div>
    </div>
  );

  if (djProfileSlug) {
    return <Link href={`/dj/${djProfileSlug}`}>{content}</Link>;
  }
  return content;
}

export function BroadcastSchedule({
  shows,
  selectedDate,
  onDateChange,
  loading,
}: BroadcastScheduleProps) {
  const { dayStart, dayEnd } = useMemo(() => getDayBoundaries(selectedDate), [selectedDate]);

  const displaySlots = useMemo<DisplaySlot[]>(() => {
    const slots: DisplaySlot[] = [];

    for (const show of shows) {
      if (show.djSlots && show.djSlots.length > 0) {
        for (const djSlot of show.djSlots) {
          if (!slotOverlapsDay(djSlot.startTime, djSlot.endTime, dayStart, dayEnd)) continue;

          const clippedStart = Math.max(djSlot.startTime, dayStart);
          const clippedEnd = Math.min(djSlot.endTime, dayEnd);

          slots.push({
            id: `${show.id}-${djSlot.id}-${selectedDate.toISOString().split('T')[0]}`,
            parentShowId: show.id,
            showName: show.showName,
            djName: djSlot.djName || djSlot.liveDjUsername,
            startTime: clippedStart,
            endTime: clippedEnd,
            status: show.status,
            isVenueSlot: true,
            originalShow: show,
            djSlot,
          });
        }
      } else {
        if (!slotOverlapsDay(show.startTime, show.endTime, dayStart, dayEnd)) continue;

        const clippedStart = Math.max(show.startTime, dayStart);
        const clippedEnd = Math.min(show.endTime, dayEnd);

        slots.push({
          id: `${show.id}-${selectedDate.toISOString().split('T')[0]}`,
          parentShowId: show.id,
          showName: show.showName,
          djName: show.djName || show.liveDjUsername,
          startTime: clippedStart,
          endTime: clippedEnd,
          status: show.status,
          isVenueSlot: false,
          originalShow: show,
        });
      }
    }

    return slots.sort((a, b) => a.startTime - b.startTime);
  }, [shows, dayStart, dayEnd, selectedDate]);

  // Count shows overlapping a given day
  const countShowsForDay = useCallback((date: Date): number => {
    const { dayStart, dayEnd } = getDayBoundaries(date);
    let count = 0;
    for (const show of shows) {
      if (show.djSlots && show.djSlots.length > 0) {
        for (const djSlot of show.djSlots) {
          if (slotOverlapsDay(djSlot.startTime, djSlot.endTime, dayStart, dayEnd)) count++;
        }
      } else {
        if (slotOverlapsDay(show.startTime, show.endTime, dayStart, dayEnd)) count++;
      }
    }
    return count;
  }, [shows]);

  const prevDay = useMemo(() => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    return d;
  }, [selectedDate]);

  const nextDay = useMemo(() => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    return d;
  }, [selectedDate]);

  const canGoPrev = !isToday(selectedDate) && countShowsForDay(prevDay) >= 3;
  const canGoNext = countShowsForDay(nextDay) >= 3;

  const goToPrevDay = () => {
    if (canGoPrev) onDateChange(prevDay);
  };

  const goToNextDay = () => {
    if (canGoNext) onDateChange(nextDay);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Date navigation */}
      <div className="flex-shrink-0 pb-2 z-10">
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrevDay}
            disabled={!canGoPrev}
            className="p-1 text-gray-600 hover:text-white transition-colors disabled:opacity-0 disabled:cursor-default"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-gray-500 text-[10px] uppercase tracking-widest">
            {isToday(selectedDate) ? 'Today' : isTomorrow(selectedDate) ? 'Tomorrow' : formatDate(selectedDate)}
          </span>
          <button
            onClick={goToNextDay}
            disabled={!canGoNext}
            className="p-1 text-gray-600 hover:text-white transition-colors disabled:opacity-0 disabled:cursor-default"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Show list */}
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
            <p className="text-gray-500 text-sm">No shows scheduled</p>
          </div>
        ) : (
          <div>
            {displaySlots.map((slot) => (
              <ShowRow key={slot.id} slot={slot} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
