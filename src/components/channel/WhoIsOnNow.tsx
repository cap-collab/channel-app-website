'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useBPM } from '@/contexts/BPMContext';
import { Show, Station } from '@/types';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { getContrastTextColor } from '@/lib/colorUtils';

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
  const { isInWatchlist, followDJ, removeFromWatchlist } = useFavorites();
  const { stationBPM } = useBPM();

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

        // Then sort by: picture + genre > picture only > no picture
        // Only use djPhotoUrl (from DJ profile) as reliable photo indicator
        const aHasPhoto = !!a.djPhotoUrl;
        const bHasPhoto = !!b.djPhotoUrl;
        const aHasGenre = !!(a.djGenres && a.djGenres.length > 0);
        const bHasGenre = !!(b.djGenres && b.djGenres.length > 0);

        // Calculate priority: photo+genre=3, photo only=2, no photo=1
        const aPriority = aHasPhoto ? (aHasGenre ? 3 : 2) : 1;
        const bPriority = bHasPhoto ? (bHasGenre ? 3 : 2) : 1;

        return bPriority - aPriority;
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
        // Toggle: unfollow if already following, follow if not
        if (isInWatchlist(djName)) {
          await removeFromWatchlist(djName);
        } else {
          await followDJ(djName, show.djUserId, show.djEmail, show);
        }
      } finally {
        setTogglingFollowId(null);
      }
    },
    [followDJ, removeFromWatchlist, isInWatchlist, isAuthenticated, onAuthRequired]
  );

  if (loading) {
    return (
      <section className="mb-6">
        <div className="flex justify-between items-end mb-3">
          <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
            </span>
            Live Now
          </h2>
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

  // Only show "View All" if there are more shows to see (placeholder for future functionality)
  const showViewAll = false; // Hidden for now since there's no "view all" page

  return (
    <section className="mb-6">
      {/* Header with pulsing red dot */}
      <div className="flex justify-between items-end mb-3">
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600"></span>
          </span>
          Live Now
        </h2>
        {showViewAll && (
          <button className="text-xs text-zinc-500 uppercase font-bold hover:text-white transition-colors">
            View All →
          </button>
        )}
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

      {/* Horizontal scroll strip for other live shows - 3 visible on desktop, scroll for more */}
      {otherLiveShows.length > 0 && (
        <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 no-scrollbar">
          {otherLiveShows.map((show) => {
            const station = stationsMap.get(show.stationId);
            if (!station) return null;

            const djNameForWatchlist = show.dj || show.name;
            const isFollowed = djNameForWatchlist ? isInWatchlist(djNameForWatchlist) : false;

            // Get BPM for this station
            const metadataKey = getMetadataKeyByStationId(station.id);
            const audioInfo = metadataKey ? stationBPM[metadataKey] : null;
            const bpm = audioInfo?.bpm || null;

            return (
              <LiveShowCard
                key={show.id}
                show={show}
                station={station}
                isFollowed={isFollowed}
                isTogglingFollow={togglingFollowId === show.id}
                onFollow={() => handleFollow(show)}
                bpm={bpm}
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
          {/* DJ Name and Location Overlay */}
          {show.dj && (
            <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4">
              <span className="text-sm font-black uppercase tracking-widest text-white drop-shadow-lg">
                {show.dj}
              </span>
              {show.djLocation && (
                <span className="block text-xs text-white/80 drop-shadow-lg mt-0.5">
                  {show.djLocation}
                </span>
              )}
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
  bpm: number | null;
}

function LiveShowCard({
  show,
  station,
  isFollowed,
  isTogglingFollow,
  onFollow,
  bpm,
}: LiveShowCardProps) {
  const [imageError, setImageError] = useState(false);
  // Only use djPhotoUrl from DJ profile, not show.imageUrl
  const photoUrl = show.djPhotoUrl;
  const hasPhoto = photoUrl && !imageError;
  const djName = show.dj || show.name;

  // For no-photo variant, use station color with contrast text
  const textColor = hasPhoto ? '#ffffff' : getContrastTextColor(station.accentColor);

  // BPM breathing animation duration
  const bpmDuration = bpm ? `${Math.round(60000 / bpm)}ms` : '500ms';

  return (
    <div className="flex-shrink-0 w-44 sm:w-56 md:w-[calc((100%-2rem)/3)] snap-start group flex flex-col">
      {/* BPM (left) and Radio Show badge (right) above image */}
      <div className="flex justify-between items-center mb-1 h-4">
        {bpm ? (
          <div
            className="text-[10px] font-mono text-zinc-400 animate-bpm-pulse"
            style={{ '--bpm-duration': bpmDuration } as React.CSSProperties}
          >
            {Math.round(bpm)} BPM
          </div>
        ) : (
          <div />
        )}
        <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter flex items-center gap-1">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 6H8.3L16.6 2.4l-.8-1.8L3 6H2v2h18v12H4V8H2v14h20V6zm-4 8h-2v2h2v-2zm-4 0H8v2h4v-2z" />
          </svg>
          Radio Show
        </div>
      </div>

      {/* Image or Graphic Card - links to DJ profile if available */}
      {show.djUsername ? (
        <Link href={`/dj/${show.djUsername}`} className="block relative aspect-square overflow-hidden border border-white/10">
          {hasPhoto ? (
            <>
              <Image
                src={photoUrl}
                alt={show.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => setImageError(true)}
              />
              {/* Gradient scrims - top left and bottom left corners */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              {/* DJ Name and Location Overlay on top-left */}
              {djName && (
                <div className="absolute top-2 left-2 right-2">
                  <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                    {djName}
                  </span>
                  {show.djLocation && (
                    <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
                      {show.djLocation}
                    </span>
                  )}
                </div>
              )}
              {/* Genre tags on bottom-left */}
              {show.djGenres && show.djGenres.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter drop-shadow-lg">
                    {show.djGenres.slice(0, 2).join(' · ')}
                  </span>
                </div>
              )}
            </>
          ) : (
            // Graphic Card: No Photo - vinyl label style with station accent color
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ backgroundColor: station.accentColor }}
            >
              <div className="text-center px-3">
                <h2
                  className="text-2xl sm:text-3xl font-black uppercase tracking-tight leading-none"
                  style={{ color: textColor }}
                >
                  {djName}
                </h2>
              </div>
            </div>
          )}
        </Link>
      ) : (
        <div className="relative aspect-square overflow-hidden border border-white/10">
          {hasPhoto ? (
            <>
              <Image
                src={photoUrl}
                alt={show.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => setImageError(true)}
              />
              {/* Gradient scrims - top left and bottom left corners */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              {/* DJ Name and Location Overlay on top-left */}
              {djName && (
                <div className="absolute top-2 left-2 right-2">
                  <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                    {djName}
                  </span>
                  {show.djLocation && (
                    <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
                      {show.djLocation}
                    </span>
                  )}
                </div>
              )}
              {/* Genre tags on bottom-left */}
              {show.djGenres && show.djGenres.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-[10px] font-mono text-white/80 uppercase tracking-tighter drop-shadow-lg">
                    {show.djGenres.slice(0, 2).join(' · ')}
                  </span>
                </div>
              )}
            </>
          ) : (
            // Graphic Card: No Photo - vinyl label style with station accent color
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ backgroundColor: station.accentColor }}
            >
              <div className="text-center px-3">
                <h2
                  className="text-2xl sm:text-3xl font-black uppercase tracking-tight leading-none"
                  style={{ color: textColor }}
                >
                  {djName}
                </h2>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Show Info - fixed height container */}
      <div className="h-14 flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">
              {show.name}
            </Link>
          ) : (
            show.name
          )}
        </h3>
        <a
          href={station.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5 uppercase hover:text-zinc-300 transition"
        >
          at {station.name}
          <svg className="w-2 h-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* CTA Buttons */}
      <div className="grid grid-cols-2 gap-1.5 mt-auto">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFollow();
          }}
          disabled={isTogglingFollow}
          className={`text-[9px] font-black uppercase py-1.5 transition flex items-center justify-center gap-0.5 ${
            isFollowed
              ? 'bg-white/10 text-white hover:bg-white/20'
              : 'bg-white text-gray-900 hover:bg-gray-100'
          }`}
        >
          {isTogglingFollow ? (
            <div className={`w-3 h-3 border-2 ${isFollowed ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin`} />
          ) : isFollowed ? (
            'Following'
          ) : (
            '+ Follow'
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
