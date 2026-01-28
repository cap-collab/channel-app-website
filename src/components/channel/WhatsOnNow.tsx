'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useBPM } from '@/contexts/BPMContext';
import { Show, Station } from '@/types';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { ExpandedShowCard } from './ExpandedShowCard';

interface WhatsOnNowProps {
  onAuthRequired?: () => void;
}

export function WhatsOnNow({ onAuthRequired }: WhatsOnNowProps) {
  const { isAuthenticated, user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { isShowFavorited, toggleFavorite } = useFavorites();
  const { stationBPM } = useBPM();
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

  // Check if broadcast has any live show right now
  const hasBroadcastLive = useMemo(() => {
    const now = currentTime;
    return allShows.some((show) => {
      if (show.stationId !== 'broadcast') return false;
      const start = new Date(show.startTime);
      const end = new Date(show.endTime);
      return start <= now && end > now;
    });
  }, [allShows, currentTime]);

  // Helper to check if show has a DJ profile (profile-or-nothing filter)
  const hasClaimedProfile = (show: Show): boolean => {
    // Channel broadcasts always show (they have DJ info from the slot)
    if (show.stationId === 'broadcast') return true;
    // External shows: only show if DJ has a profile (djUsername from pending-dj-profiles or djUserId)
    return !!(show.djUsername || show.djUserId);
  };

  // Get shows for each station: current show + upcoming shows
  // Apply profile-or-nothing filter for external stations
  const stationShows = useMemo(() => {
    const now = currentTime;
    const result: Map<string, Show[]> = new Map();

    for (const station of orderedStations) {
      const shows = allShows
        .filter((show) => show.stationId === station.id)
        .filter((show) => {
          const end = new Date(show.endTime);
          return end > now; // Show hasn't ended yet
        })
        .filter(hasClaimedProfile) // Profile-or-nothing filter
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (shows.length > 0) {
        result.set(station.id, shows);
      }
    }

    return result;
  }, [allShows, currentTime, orderedStations]);

  // Check if a show is currently live
  const isShowLive = (show: Show): boolean => {
    const now = currentTime;
    const start = new Date(show.startTime);
    const end = new Date(show.endTime);
    return start <= now && end > now;
  };

  if (loading) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">What&apos;s On Now</h3>
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Show empty state only if no stations have content AND broadcast is not available
  // (broadcast station row is always shown, even when empty)
  if (stationShows.size === 0 && !broadcastStation) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">What&apos;s On Now</h3>
        <p className="text-gray-500 text-sm">No shows currently playing</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide">What&apos;s On Now</h3>
        <span className="text-gray-600 text-xs">← scroll →</span>
      </div>

      {/* One row per station */}
      <div className="space-y-2">
        {orderedStations.map((station) => {
          const shows = stationShows.get(station.id);
          const isBroadcast = station.id === 'broadcast';

          // For broadcast station: always show, even when empty
          // For other stations: skip if no shows
          if (!isBroadcast && (!shows || shows.length === 0)) return null;

          const accentColor = station.accentColor || '#D94099';
          const metadataKey = getMetadataKeyByStationId(station.id);
          const bpm = metadataKey ? stationBPM[metadataKey]?.bpm : null;

          return (
            <div key={station.id} className="flex items-stretch gap-3 rounded-lg bg-white/5 overflow-hidden">
              {/* Station accent bar */}
              <div
                className="w-1 flex-shrink-0 rounded-l-lg"
                style={{ backgroundColor: accentColor }}
              />

              {/* Station name column */}
              <div className="flex-shrink-0 w-20 py-2 flex flex-col justify-center">
                <span className="text-white text-xs font-medium line-clamp-2 leading-tight">
                  {station.name}
                </span>
                {bpm && (
                  <span className="text-gray-500 text-[10px] mt-0.5">{Math.round(bpm)} BPM</span>
                )}
              </div>

              {/* Horizontal scrollable shows */}
              <div className="flex-1 overflow-x-auto py-2 pr-2">
                <div className="flex gap-2">
                  {/* Show empty card for broadcast when nothing is live */}
                  {isBroadcast && !hasBroadcastLive && (
                    <div className="flex-shrink-0 w-48 p-2 rounded-lg bg-white/5">
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-gray-500 text-[10px]">OFFLINE</span>
                      </div>
                      <div className="flex gap-2">
                        <div className="w-9 h-9 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-500 text-xs font-medium">Nothing live now</p>
                          <p className="text-gray-600 text-[10px]">Check back soon</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {shows?.map((show) => (
                    <ShowCard
                      key={show.id}
                      show={show}
                      station={station}
                      isLive={isShowLive(show)}
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ShowCardProps {
  show: Show;
  station: Station;
  isLive: boolean;
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

function ShowCard({
  show,
  station,
  isLive,
  isExpanded,
  onToggleExpand,
  onCloseExpand,
  isFavorited,
  isTogglingFavorite,
  onToggleFavorite,
  isAuthenticated,
  userId,
  chatUsername,
}: ShowCardProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const canTip = station.id === 'broadcast' && show.dj && (show.djUserId || show.djEmail) && show.broadcastSlotId;

  const handleImageError = (imageUrl: string) => {
    setFailedImages(prev => new Set(prev).add(imageUrl));
  };

  // Format time for upcoming shows
  const formatTime = (startTime: string): string => {
    const date = new Date(startTime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <>
      <div
        className={`flex-shrink-0 w-48 p-2 rounded-lg cursor-pointer transition-colors ${
          isLive
            ? 'bg-white/10 border border-white/20'
            : 'bg-white/5 hover:bg-white/10'
        }`}
        onClick={onToggleExpand}
      >
        {/* Live indicator or time */}
        <div className="flex items-center gap-1 mb-1">
          {isLive ? (
            <span className="text-red-500 text-[10px] font-medium">LIVE</span>
          ) : (
            <span className="text-gray-500 text-[10px]">{formatTime(show.startTime)}</span>
          )}
        </div>

        {/* Show content */}
        <div className="flex gap-2">
          {/* Show image (priority) or DJ photo thumbnail (fallback) */}
          {show.imageUrl && !failedImages.has(show.imageUrl) ? (
            <Image
              src={show.imageUrl}
              alt={show.name}
              width={36}
              height={36}
              className="w-9 h-9 rounded object-cover flex-shrink-0"
              unoptimized
              onError={() => handleImageError(show.imageUrl!)}
            />
          ) : show.djPhotoUrl && !failedImages.has(show.djPhotoUrl) ? (
            <Image
              src={show.djPhotoUrl}
              alt={show.dj || 'DJ'}
              width={36}
              height={36}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              unoptimized
              onError={() => handleImageError(show.djPhotoUrl!)}
            />
          ) : null}

          {/* Show info */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium line-clamp-2 leading-tight">{show.name}</p>
            {show.dj && (
              <p className="text-gray-500 text-[10px] truncate">{show.dj}</p>
            )}
          </div>
        </div>
      </div>

      {/* Popup modal for expanded show details */}
      {isExpanded && (
        <ExpandedShowCard
          show={show}
          station={station}
          isLive={isLive}
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
          timeDisplay={isLive ? 'LIVE NOW' : formatTime(show.startTime)}
        />
      )}
    </>
  );
}
