'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Show, Station } from '@/types';
import { STATIONS } from '@/lib/stations';
import { ExpandedShowCard } from './ExpandedShowCard';

interface WhatsOnNowProps {
  onAuthRequired?: () => void;
}

export function WhatsOnNow({ onAuthRequired }: WhatsOnNowProps) {
  const { isAuthenticated, user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { isShowFavorited, toggleFavorite } = useFavorites();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<string | null>(null);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);

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

  const handleToggleFavorite = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setTogglingFavoriteId(show.id);
    await toggleFavorite(show);
    setTogglingFavoriteId(null);
  }, [isAuthenticated, onAuthRequired, toggleFavorite]);

  // Get ordered stations (broadcast first)
  const orderedStations = useMemo(() => {
    const broadcastStation = STATIONS.find((s) => s.id === 'broadcast');
    const otherStations = STATIONS.filter((s) => s.id !== 'broadcast');
    return broadcastStation ? [broadcastStation, ...otherStations] : otherStations;
  }, []);

  // Get broadcast station reference for always-showing it
  const broadcastStation = useMemo(() => {
    return STATIONS.find((s) => s.id === 'broadcast');
  }, []);

  // Helper to check if show has a DJ profile (profile-or-nothing filter)
  const hasClaimedProfile = (show: Show): boolean => {
    // Channel broadcasts always show (they have DJ info from the slot)
    if (show.stationId === 'broadcast') return true;
    // External shows: only show if DJ has a profile (djUsername from pending-dj-profiles or djUserId)
    return !!(show.djUsername || show.djUserId);
  };

  // Get all currently live shows across all stations (flattened for horizontal strip)
  const liveShows = useMemo(() => {
    const result: { show: Show; station: Station }[] = [];
    const now = currentTime;

    for (const station of orderedStations) {
      const shows = allShows
        .filter((show) => show.stationId === station.id)
        .filter((show) => {
          const start = new Date(show.startTime);
          const end = new Date(show.endTime);
          return start <= now && end > now; // Currently live
        })
        .filter(hasClaimedProfile);

      for (const show of shows) {
        result.push({ show, station });
      }
    }

    return result;
  }, [allShows, currentTime, orderedStations]);

  if (loading) {
    return (
      <section className="mb-12">
        <div className="flex justify-between items-end mb-6 px-4">
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

  // Show empty state if no live shows
  if (liveShows.length === 0 && !broadcastStation) {
    return (
      <section className="mb-12">
        <div className="flex justify-between items-end mb-6 px-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
            </span>
            <h2 className="text-lg font-black uppercase tracking-widest italic">Live Now</h2>
          </div>
        </div>
        <div className="px-4">
          <p className="text-zinc-500 text-sm">No shows currently live</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-12">
      {/* Header with pulsing red dot and View All */}
      <div className="flex justify-between items-end mb-6 px-4">
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

      {/* Horizontal scroll strip with snap */}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 px-4 no-scrollbar">
        {/* Show empty card for broadcast when nothing is live */}
        {liveShows.length === 0 && broadcastStation && (
          <div className="flex-shrink-0 w-44 sm:w-56 snap-start">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-2">
              #Channel
            </div>
            <div className="relative aspect-square mb-3 overflow-hidden border border-white/10 bg-zinc-900 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-8 h-8 text-zinc-700 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <p className="text-zinc-600 text-xs">Nothing live now</p>
              </div>
            </div>
            <div className="mb-3">
              <h3 className="text-sm font-bold leading-tight text-zinc-500">
                Check back soon
              </h3>
              <p className="text-[10px] text-zinc-600 flex items-center gap-1 mt-1 uppercase">
                Channel Broadcast
              </p>
            </div>
          </div>
        )}

        {/* Live show cards */}
        {liveShows.map(({ show, station }) => (
          <LiveShowCard
            key={show.id}
            show={show}
            station={station}
            isExpanded={expandedShowId === show.id}
            onToggleExpand={() => setExpandedShowId(expandedShowId === show.id ? null : show.id)}
            onCloseExpand={() => setExpandedShowId(null)}
            isFavorited={isShowFavorited(show)}
            isTogglingFavorite={togglingFavoriteId === show.id}
            onToggleFavorite={handleToggleFavorite}
            isAuthenticated={isAuthenticated}
            userId={user?.uid}
            chatUsername={chatUsername}
          />
        ))}
      </div>
    </section>
  );
}

interface LiveShowCardProps {
  show: Show;
  station: Station;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCloseExpand: () => void;
  isFavorited: boolean;
  isTogglingFavorite: boolean;
  onToggleFavorite: (show: Show) => void;
  isAuthenticated: boolean;
  userId?: string;
  chatUsername?: string | null;
}

function LiveShowCard({
  show,
  station,
  isExpanded,
  onToggleExpand,
  onCloseExpand,
  isFavorited,
  isTogglingFavorite,
  onToggleFavorite,
  isAuthenticated,
  userId,
  chatUsername,
}: LiveShowCardProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const canTip = station.id === 'broadcast' && show.dj && (show.djUserId || show.djEmail) && show.broadcastSlotId;

  const handleImageError = (imageUrl: string) => {
    setFailedImages(prev => new Set(prev).add(imageUrl));
  };

  // Get image URL (show image or DJ photo)
  const imageUrl = show.imageUrl && !failedImages.has(show.imageUrl)
    ? show.imageUrl
    : show.djPhotoUrl && !failedImages.has(show.djPhotoUrl)
    ? show.djPhotoUrl
    : null;

  return (
    <>
      <div className="flex-shrink-0 w-44 sm:w-56 snap-start group">
        {/* 1. Genre Tags Above Image */}
        <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-2">
          #{station.name.replace(/\s+/g, '')}
        </div>

        {/* 2. Image with DJ Overlay - links to DJ profile if available */}
        {show.djUsername ? (
          <Link href={`/dj/${show.djUsername}`} className="block relative aspect-square mb-3 overflow-hidden border border-white/10 cursor-pointer">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={show.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => handleImageError(imageUrl)}
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
          </Link>
        ) : (
          <div
            className="relative aspect-square mb-3 overflow-hidden border border-white/10 cursor-pointer"
            onClick={onToggleExpand}
          >
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={show.name}
                fill
                className="object-cover"
                unoptimized
                onError={() => handleImageError(imageUrl)}
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
        )}

        {/* 3. Show Info */}
        <div className="mb-3">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`}>
              <h3 className="text-sm sm:text-base font-bold leading-tight line-clamp-2 group-hover:text-blue-400 transition cursor-pointer">
                {show.name}
              </h3>
            </Link>
          ) : (
            <h3
              className="text-sm sm:text-base font-bold leading-tight line-clamp-2 group-hover:text-blue-400 transition cursor-pointer"
              onClick={onToggleExpand}
            >
              {show.name}
            </h3>
          )}
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

        {/* 4. CTA Buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(show);
            }}
            disabled={isTogglingFavorite}
            className={`text-[9px] font-black uppercase py-1.5 transition flex items-center justify-center gap-0.5 ${
              isFavorited
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-white text-black hover:bg-blue-500 hover:text-white'
            }`}
          >
            {isTogglingFavorite ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isFavorited ? (
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

      {/* Popup modal for expanded show details */}
      {isExpanded && (
        <ExpandedShowCard
          show={show}
          station={station}
          isLive={true}
          onClose={onCloseExpand}
          isFavorited={isFavorited}
          isTogglingFavorite={isTogglingFavorite}
          onToggleFavorite={(e) => {
            e.stopPropagation();
            onToggleFavorite(show);
          }}
          canTip={!!canTip}
          isAuthenticated={isAuthenticated}
          tipperUserId={userId}
          tipperUsername={chatUsername || undefined}
          timeDisplay="LIVE NOW"
        />
      )}
    </>
  );
}
