'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';

interface DJCardProps {
  show: Show;
  station: Station;
  isLive: boolean;
  isFollowed: boolean;
  isTogglingFollow: boolean;
  onFollow: () => Promise<void>;
  onPlay?: () => void;
  isPlaying?: boolean;
  isLoading?: boolean;
  onAuthRequired: () => void;
  isAuthenticated: boolean;
}

export function DJCard({
  show,
  station,
  isLive,
  isFollowed,
  isTogglingFollow,
  onFollow,
  onPlay,
  isPlaying,
  isLoading,
  onAuthRequired,
  isAuthenticated,
}: DJCardProps) {
  const isChannelBroadcast = station.id === 'broadcast';
  const djName = show.dj || show.name;
  const djPhotoUrl = show.djPhotoUrl || show.imageUrl;
  const hasProfile = !!show.djUsername;

  const handleFollowClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      onAuthRequired();
      return;
    }
    await onFollow();
  };

  const handlePlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPlay?.();
  };

  return (
    <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden group">
      {/* Background Image */}
      {djPhotoUrl ? (
        <Image
          src={djPhotoUrl}
          alt={djName}
          fill
          className="object-cover"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />
      )}

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />

      {/* Follow Button - Top Right */}
      <button
        onClick={handleFollowClick}
        disabled={isTogglingFollow}
        className={`absolute top-3 right-3 px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
          isFollowed
            ? 'bg-white/20 text-white backdrop-blur-sm'
            : 'bg-white text-black hover:bg-white/90'
        } disabled:opacity-50`}
      >
        {isTogglingFollow ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : isFollowed ? (
          'Following'
        ) : (
          '+ Follow'
        )}
      </button>

      {/* Content - Bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        {/* DJ Name */}
        <h3 className="text-white text-2xl font-bold leading-tight mb-1">
          {hasProfile ? (
            <Link
              href={`/dj/${show.djUsername}`}
              className="hover:underline"
            >
              {djName}
            </Link>
          ) : (
            djName
          )}
        </h3>

        {/* Station Badge */}
        <div className="flex items-center gap-2 mb-3">
          {isLive && (
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
          <span
            className="text-sm font-medium"
            style={{ color: isChannelBroadcast ? '#D94099' : station.accentColor }}
          >
            {isLive ? 'Live on ' : 'On '}
            {isChannelBroadcast ? 'Channel' : station.name}
            {!isChannelBroadcast && ' ↗'}
          </span>
        </div>

        {/* Action Button */}
        {isLive && (
          <div className="flex gap-2">
            {isChannelBroadcast ? (
              <button
                onClick={handlePlayClick}
                disabled={isLoading}
                className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white py-3 px-4 rounded-xl font-semibold transition-colors disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                    Pause
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Tune In
                  </>
                )}
              </button>
            ) : (
              <a
                href={station.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white py-3 px-4 rounded-xl font-semibold transition-colors"
              >
                Join Stream
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
