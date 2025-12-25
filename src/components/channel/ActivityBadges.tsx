'use client';

interface ActivityBadgesProps {
  listenerCount: number;
  loveCount: number;
  messageCount: number;
}

export function ActivityBadges({ listenerCount, loveCount, messageCount }: ActivityBadgesProps) {
  const hasBadges = listenerCount > 0 || loveCount > 0 || messageCount > 0;

  if (!hasBadges) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {listenerCount > 0 && (
          <div className="flex items-center gap-1 text-gray-400">
            {/* Headphone icon */}
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9z" />
            </svg>
            <span className="text-sm font-medium">{listenerCount}</span>
          </div>
        )}

        {loveCount > 0 && (
          <div className="flex items-center gap-1 text-accent">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            <span className="text-sm font-medium">{loveCount}</span>
          </div>
        )}

        {messageCount > 0 && (
          <div className="flex items-center gap-1 text-gray-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
            </svg>
            <span className="text-sm font-medium">{messageCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
