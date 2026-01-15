'use client';

import { useState } from 'react';
import Image from 'next/image';
import { BroadcastSlotSerialized } from '@/types/broadcast';

interface CompactPlayerProps {
  isPlaying: boolean;
  isLoading: boolean;
  isLive: boolean;
  currentShow: BroadcastSlotSerialized | null;
  currentDJ: string | null;
  onTogglePlay: () => void;
  listenerCount: number;
  loveCount: number;
  isAuthenticated: boolean;
  username?: string;
  error?: string | null;
  // Favorites
  isShowFavorited?: boolean;
  onToggleFavorite?: () => Promise<void>;
  onAuthRequired?: () => void;
}

export function CompactPlayer({
  isPlaying,
  isLoading,
  isLive,
  currentShow,
  currentDJ,
  onTogglePlay,
  listenerCount,
  loveCount,
  isAuthenticated,
  isShowFavorited,
  onToggleFavorite,
  onAuthRequired,
}: CompactPlayerProps) {
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const stationName = 'Channel Broadcast';
  const showName = currentShow?.showName || (isLive ? 'Live Now' : 'Offline');
  // Use djName (scheduled DJ name) to match what's shown in the schedule/calendar
  const djName = currentDJ || currentShow?.djName;

  return (
    <div className="flex items-center gap-3 bg-surface-card rounded-xl p-3">
      {/* Play/Pause button */}
      <button
        onClick={onTogglePlay}
        disabled={!isLive}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-accent disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
      >
        {isLoading ? (
          <svg className="w-5 h-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : isPlaying ? (
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Station logo */}
      <Image
        src="/apple-touch-icon.png"
        alt="Channel"
        width={40}
        height={40}
        className="rounded-lg flex-shrink-0"
      />

      {/* Show info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white font-medium truncate">{stationName}</p>
          {isLive && (
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          )}
        </div>
        <p className="text-gray-400 text-sm truncate">
          {showName}{djName ? ` • ${djName}` : ''}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Listener count */}
        {listenerCount > 0 && (
          <span className="text-gray-400 text-sm flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {listenerCount}
          </span>
        )}

        {/* Love count - always show, greyed out when offline */}
        <span className={`text-sm flex items-center gap-1 ${isLive && loveCount > 0 ? 'text-accent' : 'text-gray-600'}`}>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          {isLive ? loveCount : 0}
        </span>

        {/* Favorite button - only show when live with a show */}
        {isLive && currentShow && onToggleFavorite && (
          <button
            onClick={async () => {
              if (!isAuthenticated) {
                onAuthRequired?.();
                return;
              }
              setIsTogglingFavorite(true);
              await onToggleFavorite();
              setIsTogglingFavorite(false);
            }}
            disabled={isTogglingFavorite}
            className="w-8 h-8 flex items-center justify-center text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
            title={isShowFavorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isTogglingFavorite ? (
              <div className="w-4 h-4 border-2 border-gray-600 border-t-accent rounded-full animate-spin" />
            ) : (
              <svg
                className="w-4 h-4"
                fill={isShowFavorited ? 'currentColor' : 'none'}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            )}
          </button>
        )}

        {/* Share button */}
        <button
          onClick={() => {
            navigator.share?.({
              title: 'Channel Broadcast',
              text: `Listen to ${showName} on Channel Broadcast`,
              url: window.location.href,
            });
          }}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
