'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { BroadcastSlotSerialized, DJSlot } from '@/types/broadcast';
import { TipButton } from './TipButton';
import { normalizeUrl } from '@/lib/url';

interface BroadcastScheduleProps {
  shows: BroadcastSlotSerialized[];
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  loading: boolean;
  isAuthenticated?: boolean;
  userId?: string;
  username?: string;
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

// Height per hour in pixels for the grid view
const HOUR_HEIGHT = 60;

// Generate hours array for the time grid
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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

// Show card component with expandable DJ info
interface ShowCardProps {
  slot: DisplaySlot;
  isLive: boolean;
  isPast: boolean;
  height: number;
  top: number;
  isAuthenticated?: boolean;
  userId?: string;
  username?: string;
}

function ShowCard({ slot, isLive, isPast, height, top, isAuthenticated, userId, username }: ShowCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Read DJ profile data directly from the slot (synced when DJ updates their profile)
  const djBio = slot.originalShow.liveDjBio || null;
  const djPhotoUrl = slot.originalShow.liveDjPhotoUrl || null;
  const djPromoHyperlink = slot.originalShow.showPromoHyperlink || null;

  // Show tip button if DJ email is assigned (djEmail is set when show is created)
  const hasDjInfo = slot.originalShow.djEmail;

  // Determine if there's enough room to show bio inline (height > 80px)
  const canShowBioInline = height > 80 && djBio;
  // Only show expand button if there's a bio but not enough room to show it inline
  const needsExpandButton = djBio && !canShowBioInline;

  return (
    <div
      className={`absolute left-1 right-1 rounded-lg overflow-hidden transition-all bg-black border border-accent ${
        isPast ? 'opacity-60' : ''
      } ${expanded ? 'z-20' : ''}`}
      style={{
        top: `${top}px`,
        minHeight: `${height}px`,
        height: expanded ? 'auto' : `${height}px`
      }}
    >
      <div className="px-3 py-2 h-full flex flex-col">
        {/* Header row with photo */}
        <div className="flex items-start gap-2">
          {/* DJ Photo - show on left of name */}
          {djPhotoUrl && (
            <div className="w-9 h-9 flex-shrink-0 relative">
              <Image
                src={djPhotoUrl}
                alt={slot.djName || 'DJ'}
                fill
                sizes="36px"
                className="rounded-full object-cover"
              />
            </div>
          )}

          {/* Show name and DJ name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isLive && (
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
              )}
              <h3 className="text-white font-medium text-sm truncate">{slot.showName}</h3>
            </div>
            {slot.djName && (
              <p className="text-white/70 text-xs truncate mt-0.5">
                {slot.djName}
              </p>
            )}
          </div>

          {/* Right side: tip button + promo link + expand button */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Tip button - show if DJ info is assigned */}
            {hasDjInfo && (
              <div onClick={(e) => e.stopPropagation()}>
                <TipButton
                  isAuthenticated={isAuthenticated || false}
                  tipperUserId={userId}
                  tipperUsername={username}
                  djUserId={slot.originalShow.djUserId || slot.originalShow.liveDjUserId || slot.djSlot?.liveDjUserId}
                  djEmail={slot.originalShow.djEmail}
                  djUsername={slot.djName || 'DJ'}
                  broadcastSlotId={slot.originalShow.id}
                  showName={slot.showName}
                  compact
                />
              </div>
            )}

            {/* Promo link - show only link icon */}
            {djPromoHyperlink && (
              <a
                href={normalizeUrl(djPromoHyperlink)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-accent hover:text-white p-1.5 bg-accent/10 rounded transition-colors"
                title="Open promo link"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}

            {/* Expand button - only show if bio exists but card is too small */}
            {needsExpandButton && (
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setExpanded(!expanded);
                }}
                className="p-2 text-gray-400 hover:text-white transition-colors touch-manipulation"
                title={expanded ? 'Collapse' : 'Show DJ info'}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Bio shown inline if there's room */}
        {canShowBioInline && (
          <p className="text-gray-400 text-xs mt-2 line-clamp-2 leading-relaxed">
            {djBio}
          </p>
        )}

        {/* Expanded content - only when expanded via button */}
        {expanded && needsExpandButton && (
          <div className="mt-2 pt-2 border-t border-gray-800">
            <p className="text-gray-400 text-xs leading-relaxed">
              {djBio}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function BroadcastSchedule({
  shows,
  selectedDate,
  onDateChange,
  loading,
  isAuthenticated,
  userId,
  username,
}: BroadcastScheduleProps) {
  // Get day boundaries for the selected date
  const { dayStart, dayEnd } = useMemo(() => getDayBoundaries(selectedDate), [selectedDate]);

  // Expand shows with djSlots into individual rows, filtered and clipped to selected day
  const displaySlots = useMemo<DisplaySlot[]>(() => {
    const slots: DisplaySlot[] = [];

    for (const show of shows) {
      // If show has djSlots, create a row for each DJ slot that overlaps with selected day
      if (show.djSlots && show.djSlots.length > 0) {
        for (const djSlot of show.djSlots) {
          // Check if this DJ slot overlaps with the selected day
          if (!slotOverlapsDay(djSlot.startTime, djSlot.endTime, dayStart, dayEnd)) {
            continue; // Skip slots that don't overlap with selected day
          }

          // Clip the slot times to the selected day's boundaries
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
        // Regular show without djSlots - check if it overlaps with selected day
        if (!slotOverlapsDay(show.startTime, show.endTime, dayStart, dayEnd)) {
          continue; // Skip shows that don't overlap with selected day
        }

        // Clip the show times to the selected day's boundaries
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

    // Sort by start time
    return slots.sort((a, b) => a.startTime - b.startTime);
  }, [shows, dayStart, dayEnd, selectedDate]);

  // Calculate time range for the day based on shows
  const timeRange = useMemo(() => {
    if (displaySlots.length === 0) {
      return { startHour: 8, endHour: 23 }; // Default range
    }

    let minHour = 24;
    let maxHour = 0;

    for (const slot of displaySlots) {
      const startDate = new Date(slot.startTime);
      const endDate = new Date(slot.endTime);
      const startHour = startDate.getHours();
      const endHour = endDate.getHours() + (endDate.getMinutes() > 0 ? 1 : 0);

      minHour = Math.min(minHour, startHour);
      maxHour = Math.max(maxHour, endHour);
    }

    // Add some padding
    return {
      startHour: Math.max(0, minHour - 1),
      endHour: Math.min(24, maxHour + 1),
    };
  }, [displaySlots]);

  const visibleHours = HOURS.filter(h => h >= timeRange.startHour && h < timeRange.endHour);

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

  // Format hour for display
  const formatHour = (hour: number) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
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

      {/* Schedule grid - Scrollable */}
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
          <div className="flex">
            {/* Time labels column */}
            <div className="w-16 flex-shrink-0">
              {visibleHours.map(hour => (
                <div
                  key={hour}
                  className="text-right pr-3 text-xs text-gray-500"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>

            {/* Shows column */}
            <div className="flex-1 relative border-l border-gray-800" style={{ height: `${visibleHours.length * HOUR_HEIGHT}px` }}>
              {/* Hour grid lines */}
              {visibleHours.map((hour, index) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 border-t border-gray-800/50"
                  style={{ top: `${index * HOUR_HEIGHT}px` }}
                />
              ))}

              {/* Show blocks */}
              {displaySlots.map((slot) => {
                const startDate = new Date(slot.startTime);
                const endDate = new Date(slot.endTime);
                const startHour = startDate.getHours() + startDate.getMinutes() / 60;
                const endHour = endDate.getHours() + endDate.getMinutes() / 60;
                const duration = endHour - startHour;

                // Adjust position relative to visible time range
                const top = (startHour - timeRange.startHour) * HOUR_HEIGHT;
                const height = Math.max(duration * HOUR_HEIGHT, 40);

                const now = Date.now();
                const isLive = slot.originalShow.status === 'live' &&
                  slot.startTime <= now && slot.endTime > now;
                const isPast = slot.endTime < now;

                return (
                  <ShowCard
                    key={slot.id}
                    slot={slot}
                    isLive={isLive}
                    isPast={isPast}
                    height={height}
                    top={top}
                    isAuthenticated={isAuthenticated}
                    userId={userId}
                    username={username}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
