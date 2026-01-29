'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useAuthContext } from '@/contexts/AuthContext';
import { useFavorites } from '@/hooks/useFavorites';
import { Show, Station } from '@/types';
import { STATIONS } from '@/lib/stations';

interface WhoIsOnNowProps {
  onAuthRequired?: () => void;
  // Streaming control props (for Channel broadcast)
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  isStreamLoading?: boolean;
  // Whether the Channel broadcast is actually live (streaming)
  isBroadcastLive?: boolean;
  // Optional chat element to render directly below the broadcast DJ card
  chatSlot?: React.ReactNode;
}

export function WhoIsOnNow({ onAuthRequired, onTogglePlay, isPlaying, isStreamLoading, isBroadcastLive, chatSlot }: WhoIsOnNowProps) {
  const { isAuthenticated } = useAuthContext();
  const { isInWatchlist, followDJ } = useFavorites();

  const [allShows, setAllShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [togglingFollowId, setTogglingFollowId] = useState<string | null>(null);

  // Fetch all shows on mount
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => setAllShows(data.shows || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Stations map for quick lookup
  const stationsMap = useMemo(() => {
    const map = new Map<string, Station>();
    for (const station of STATIONS) {
      map.set(station.id, station);
    }
    return map;
  }, []);

  // Helper to check if show has a DJ profile (profile-or-nothing filter)
  const hasClaimedProfile = (show: Show): boolean => {
    // Channel broadcasts always show (they have DJ info from the slot)
    if (show.stationId === 'broadcast') return true;
    // External shows: only show if DJ has a profile
    return !!(show.djUsername || show.djUserId);
  };

  // Get currently live shows across all stations
  const liveShows = useMemo(() => {
    const now = currentTime;

    return allShows
      .filter((show) => {
        const start = new Date(show.startTime);
        const end = new Date(show.endTime);
        return start <= now && end > now;
      })
      .filter(hasClaimedProfile)
      // Filter out broadcast shows if broadcast is not actually live
      .filter((show) => {
        if (show.stationId === 'broadcast') {
          return isBroadcastLive === true;
        }
        return true;
      })
      .sort((a, b) => {
        // Sort: broadcast first, then by station order
        if (a.stationId === 'broadcast' && b.stationId !== 'broadcast') return -1;
        if (a.stationId !== 'broadcast' && b.stationId === 'broadcast') return 1;
        return 0;
      });
  }, [allShows, currentTime, isBroadcastLive]);

  const handleFollow = useCallback(
    async (show: Show) => {
      // Use show.dj if available, fall back to show.name (for NTS and other external radios)
      const djName = show.dj || show.name;
      if (!djName) return;

      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      setTogglingFollowId(show.id);
      try {
        // Use unified followDJ function - adds DJ to watchlist + specific show to favorites
        await followDJ(djName, show.djUserId, show.djEmail, show);
      } finally {
        setTogglingFollowId(null);
      }
    },
    [followDJ, isAuthenticated, onAuthRequired]
  );

  if (loading) {
    return (
      <section className="mb-6">
        <div className="flex justify-between items-end mb-6">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
            </span>
            <h2 className="text-lg font-black uppercase tracking-widest italic">Live Now</h2>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
        </div>
      </section>
    );
  }

  if (liveShows.length === 0) {
    return null;
  }

  // Find broadcast show for special handling
  const broadcastShow = liveShows.find((s) => s.stationId === 'broadcast');
  const otherLiveShows = liveShows.filter((s) => s.stationId !== 'broadcast');

  return (
    <section className="mb-6">
      {/* Header with pulsing red dot and View All */}
      <div className="flex justify-between items-end mb-6">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
          </span>
          <h2 className="text-lg font-black uppercase tracking-widest italic">Live Now</h2>
        </div>
        <button className="text-xs text-zinc-500 uppercase font-bold hover:text-white transition-colors">
          View All →
        </button>
      </div>

      {/* Broadcast show - full width with chat below */}
      {broadcastShow && (
        <div className="mb-4">
          <BroadcastCard
            show={broadcastShow}
            station={stationsMap.get(broadcastShow.stationId)!}
            isFollowed={isInWatchlist(broadcastShow.dj || broadcastShow.name)}
            isTogglingFollow={togglingFollowId === broadcastShow.id}
            onFollow={() => handleFollow(broadcastShow)}
            onTogglePlay={onTogglePlay}
            isPlaying={isPlaying}
            isStreamLoading={isStreamLoading}
          />
          {chatSlot}
        </div>
      )}

      {/* Horizontal scroll strip for other live shows */}
      {otherLiveShows.length > 0 && (
        <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 no-scrollbar">
          {otherLiveShows.map((show) => {
            const station = stationsMap.get(show.stationId);
            if (!station) return null;

            const djNameForWatchlist = show.dj || show.name;
            const isFollowed = djNameForWatchlist ? isInWatchlist(djNameForWatchlist) : false;

            return (
              <LiveShowCard
                key={show.id}
                show={show}
                station={station}
                isFollowed={isFollowed}
                isTogglingFollow={togglingFollowId === show.id}
                onFollow={() => handleFollow(show)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// Broadcast card - larger, with Play button
interface BroadcastCardProps {
  show: Show;
  station: Station;
  isFollowed: boolean;
  isTogglingFollow: boolean;
  onFollow: () => void;
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  isStreamLoading?: boolean;
}

function BroadcastCard({
  show,
  station,
  isFollowed,
  isTogglingFollow,
  onFollow,
  onTogglePlay,
  isPlaying,
  isStreamLoading,
}: BroadcastCardProps) {
  const [imageError, setImageError] = useState(false);
  const imageUrl = !imageError ? (show.djPhotoUrl || show.imageUrl) : null;

  return (
    <div className="bg-surface-card rounded-xl overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* Image */}
        <div className="relative w-full sm:w-48 aspect-square sm:aspect-auto sm:h-auto flex-shrink-0">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={show.dj || show.name}
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full bg-zinc-900 flex items-center justify-center min-h-[200px]">
              <svg className="w-16 h-16 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          )}
          {/* Gradient scrim */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent sm:bg-gradient-to-r" />
          {/* DJ Name Overlay */}
          {show.dj && (
            <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
              <span className="text-sm font-black uppercase tracking-widest text-white drop-shadow-lg">
                {show.dj}
              </span>
            </div>
          )}
        </div>

        {/* Info & Controls */}
        <div className="flex-1 p-4 flex flex-col justify-between">
          <div>
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-1">
              #Channel
            </div>
            <h3 className="text-xl font-bold leading-tight mb-1">
              {show.name}
            </h3>
            <p className="text-xs text-zinc-500 uppercase">
              at {station.name}
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFollow();
              }}
              disabled={isTogglingFollow}
              className={`text-[10px] font-black uppercase py-2.5 transition flex items-center justify-center gap-1 rounded-lg ${
                isFollowed
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-white text-black hover:bg-blue-500 hover:text-white'
              }`}
            >
              {isTogglingFollow ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : isFollowed ? (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  Following
                </>
              ) : (
                'Follow'
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlay?.();
              }}
              disabled={isStreamLoading}
              className="bg-accent text-white text-[10px] font-black uppercase py-2.5 flex items-center justify-center gap-1 hover:bg-accent-hover transition rounded-lg disabled:opacity-50"
            >
              {isStreamLoading ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                  Pause
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Play
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact card for other live shows
interface LiveShowCardProps {
  show: Show;
  station: Station;
  isFollowed: boolean;
  isTogglingFollow: boolean;
  onFollow: () => void;
}

function LiveShowCard({
  show,
  station,
  isFollowed,
  isTogglingFollow,
  onFollow,
}: LiveShowCardProps) {
  const [imageError, setImageError] = useState(false);
  const imageUrl = !imageError ? (show.imageUrl || show.djPhotoUrl) : null;

  return (
    <div className="flex-shrink-0 w-44 sm:w-56 snap-start group">
      {/* Genre Tags Above Image */}
      <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-2">
        #{station.name.replace(/\s+/g, '')}
      </div>

      {/* Image with DJ Overlay */}
      <div className="relative aspect-square mb-3 overflow-hidden border border-white/10">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={show.name}
            fill
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
            <svg className="w-10 h-10 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        )}
        {/* Gradient scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {/* DJ Name Overlay */}
        {show.dj && (
          <div className="absolute bottom-2 left-2">
            <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg">
              {show.dj}
            </span>
          </div>
        )}
      </div>

      {/* Show Info */}
      <div className="mb-3">
        <h3 className="text-sm sm:text-base font-bold leading-tight line-clamp-2 group-hover:text-blue-400 transition">
          {show.name}
        </h3>
        <a
          href={station.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-zinc-500 flex items-center gap-1 mt-1 uppercase hover:text-zinc-300 transition"
        >
          at {station.name}
          <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* CTA Buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFollow();
          }}
          disabled={isTogglingFollow}
          className={`text-[9px] font-black uppercase py-1.5 transition flex items-center justify-center gap-0.5 ${
            isFollowed
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-white text-black hover:bg-blue-500 hover:text-white'
          }`}
        >
          {isTogglingFollow ? (
            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : isFollowed ? (
            <>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
              Following
            </>
          ) : (
            'Follow'
          )}
        </button>
        <a
          href={station.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-zinc-800 text-white text-[9px] font-black uppercase py-1.5 flex items-center justify-center gap-0.5 hover:bg-zinc-700 transition"
        >
          Join
          <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>
  );
}
