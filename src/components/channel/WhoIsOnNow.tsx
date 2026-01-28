'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBPM } from '@/contexts/BPMContext';
import { useFavorites } from '@/hooks/useFavorites';
import { Show, Station } from '@/types';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { LiveCard } from './LiveCard';

interface WhoIsOnNowProps {
  onAuthRequired?: () => void;
  // Streaming control props (for Channel broadcast)
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  isStreamLoading?: boolean;
}

export function WhoIsOnNow({ onAuthRequired, onTogglePlay, isPlaying, isStreamLoading }: WhoIsOnNowProps) {
  const { isAuthenticated } = useAuthContext();
  const { stationBPM } = useBPM();
  const { isInWatchlist, addToWatchlist, toggleFavorite, isShowFavorited } = useFavorites();

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
      .sort((a, b) => {
        // Sort: broadcast first, then by station order
        if (a.stationId === 'broadcast' && b.stationId !== 'broadcast') return -1;
        if (a.stationId !== 'broadcast' && b.stationId === 'broadcast') return 1;
        return 0;
      });
  }, [allShows, currentTime]);

  const handleFollow = useCallback(
    async (show: Show) => {
      // Use show.dj if available, fall back to show.name (for NTS and other external radios)
      const djName = show.dj || show.name;
      if (!djName) return;

      setTogglingFollowId(show.id);
      try {
        // Add DJ to watchlist
        await addToWatchlist(djName, show.djUserId, show.djEmail);
        // Also add this specific show to favorites (in case it's not in metadata yet)
        if (!isShowFavorited(show)) {
          await toggleFavorite(show);
        }
      } finally {
        setTogglingFollowId(null);
      }
    },
    [addToWatchlist, toggleFavorite, isShowFavorited]
  );

  if (loading) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-4">
          Who Is On Now
        </h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (liveShows.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-4">
          Who Is On Now
        </h3>
        <div className="text-center py-8">
          <p className="text-gray-500">No DJs are live right now</p>
          <p className="text-gray-600 text-sm mt-1">Check back soon!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-xl p-4">
      <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-4">
        Who Is On Now
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {liveShows.map((show) => {
          const station = stationsMap.get(show.stationId);
          if (!station) return null;

          const metadataKey = getMetadataKeyByStationId(show.stationId);
          const bpm = metadataKey ? stationBPM[metadataKey]?.bpm ?? null : null;
          // Use show.dj if available, fall back to show.name (for NTS and other external radios)
          const djNameForWatchlist = show.dj || show.name;
          const isFollowed = djNameForWatchlist ? isInWatchlist(djNameForWatchlist) : false;

          const isBroadcast = station.id === 'broadcast';

          return (
            <LiveCard
              key={show.id}
              show={show}
              station={station}
              bpm={bpm}
              isAuthenticated={isAuthenticated}
              isFollowed={isFollowed}
              isTogglingFollow={togglingFollowId === show.id}
              onFollow={() => handleFollow(show)}
              onAuthRequired={onAuthRequired || (() => {})}
              onPlay={isBroadcast ? onTogglePlay : undefined}
              isPlaying={isBroadcast ? isPlaying : undefined}
              isStreamLoading={isBroadcast ? isStreamLoading : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
