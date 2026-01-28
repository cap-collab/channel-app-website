'use client';

import Link from 'next/link';
import { Show, Station } from '@/types';

interface TicketCardProps {
  show: Show;
  station: Station;
  isAuthenticated: boolean;
  isFollowing: boolean;
  isAddingReminder: boolean;
  onRemindMe: () => void;
}

function formatTicketDate(isoTime: string): { date: string; time: string } {
  const dateObj = new Date(isoTime);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = dateObj.toDateString() === now.toDateString();
  const isTomorrow = dateObj.toDateString() === tomorrow.toDateString();

  let dateStr: string;
  if (isToday) {
    dateStr = 'TODAY';
  } else if (isTomorrow) {
    dateStr = 'TOMORROW';
  } else {
    dateStr = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }).toUpperCase();
  }

  const timeStr = dateObj.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return { date: dateStr, time: timeStr };
}

export function TicketCard({
  show,
  station,
  isFollowing,
  isAddingReminder,
  onRemindMe,
}: TicketCardProps) {
  const djName = show.dj || show.name;
  const { date, time } = formatTicketDate(show.startTime);

  return (
    <div className="bg-surface-card rounded-xl overflow-hidden border border-white/5">
      {/* Ticket Header: Date + Time */}
      <div className="flex border-b border-white/10">
        <div className="flex-1 py-3 px-4 border-r border-white/10 bg-white/5">
          <span className="text-white text-sm font-bold tracking-wide">
            {date}
          </span>
        </div>
        <div className="flex-1 py-3 px-4 bg-white/5">
          <span className="text-white text-sm font-bold">
            {time}
          </span>
        </div>
      </div>

      {/* DJ Info */}
      <div className="p-4 space-y-1">
        <h3 className="text-white text-2xl font-bold">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">
              {djName}
            </Link>
          ) : (
            djName
          )}
        </h3>
        <p
          className="text-sm"
          style={{ color: station.accentColor }}
        >
          on {station.name}
        </p>
      </div>

      {/* Remind Me Button */}
      <div className="px-4 pb-4">
        {!isFollowing && (
          <p className="text-gray-500 text-xs text-center mb-2">Follow to get live alert</p>
        )}
        <button
          onClick={onRemindMe}
          disabled={isAddingReminder || isFollowing}
          className={`w-full py-3 px-4 rounded-xl text-sm font-bold uppercase tracking-wide transition-colors ${
            isFollowing
              ? 'bg-white/10 text-gray-400 cursor-default'
              : 'bg-white hover:bg-gray-100 text-gray-900'
          } disabled:opacity-50`}
        >
          {isAddingReminder ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
              Adding...
            </div>
          ) : isFollowing ? (
            "You're Following"
          ) : (
            'Remind Me'
          )}
        </button>
      </div>
    </div>
  );
}
