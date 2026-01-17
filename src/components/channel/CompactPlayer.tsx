'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { BPMBadge } from './BPMBadge';
import { useBPM } from '@/contexts/BPMContext';

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
  // Watchlist
  isDJInWatchlist?: boolean;
  onToggleWatchlist?: () => Promise<void>;
  isTogglingWatchlist?: boolean;
  // B3B support: multiple DJ profiles (only show profile icon if hasProfile is true)
  djProfiles?: Array<{ username: string; photoUrl?: string; hasProfile?: boolean }>;
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
  isDJInWatchlist,
  onToggleWatchlist,
  isTogglingWatchlist,
  djProfiles,
}: CompactPlayerProps) {
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const { stationBPM } = useBPM();
  const broadcastBPM = stationBPM['broadcast']?.bpm || null;
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
          {/* Listener and love counts - on same line as station name */}
          {isLive && (
            <span className="flex items-center gap-2 text-gray-400 text-sm flex-shrink-0">
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3a9 9 0 00-9 9v7c0 1.1.9 2 2 2h2c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2H5v-1a7 7 0 1114 0v1h-2c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h2c1.1 0 2-.9 2-2v-7a9 9 0 00-9-9z" />
                </svg>
                {listenerCount}
              </span>
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                {loveCount}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-gray-400 text-sm truncate">
            {showName}{djName ? ` • ${djName}` : ''}
          </p>
          {isLive && <BPMBadge bpm={broadcastBPM} />}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Favorite button (star) - only show when live with a show */}
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

        {/* Watchlist button (+) - add DJ to watchlist and their shows to favorites */}
        {isLive && currentShow && djName && onToggleWatchlist && (
          <button
            onClick={async () => {
              if (!isAuthenticated) {
                onAuthRequired?.();
                return;
              }
              await onToggleWatchlist();
            }}
            disabled={isTogglingWatchlist}
            className="w-8 h-8 flex items-center justify-center text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
            title={isDJInWatchlist ? `${djName} is in your watchlist` : `Add ${djName} to watchlist`}
          >
            {isTogglingWatchlist ? (
              <div className="w-4 h-4 border-2 border-gray-600 border-t-accent rounded-full animate-spin" />
            ) : isDJInWatchlist ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
          </button>
        )}

        {/* DJ Profile links - supports B3B with multiple DJs */}
        {/* Only show profile links for DJs with hasProfile: true */}
        {isLive && djProfiles && djProfiles.filter(p => p.hasProfile).length > 0 ? (
          djProfiles.filter(p => p.hasProfile).map((profile) => (
            <Link
              key={profile.username}
              href={`/dj/@${encodeURIComponent(profile.username)}`}
              className="w-8 h-8 flex items-center justify-center text-accent hover:text-accent/80 transition-colors"
              title={`View ${profile.username}'s profile`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </Link>
          ))
        ) : null}
      </div>
    </div>
  );
}
