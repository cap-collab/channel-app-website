'use client';

import { useState } from 'react';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { TicketCard } from './TicketCard';

interface WhoNotToMissProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onRemindMe: (show: Show) => void;
}

export function WhoNotToMiss({
  shows,
  stations,
  isAuthenticated,
  onRemindMe,
}: WhoNotToMissProps) {
  const { isInWatchlist, addToWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingDj, setAddingDj] = useState<string | null>(null);

  // Filter to upcoming shows with DJ profiles only
  const upcomingShows = shows
    .filter((show) => {
      const now = new Date();
      const startDate = new Date(show.startTime);
      // Only upcoming, has DJ, and has profile (djUsername or djUserId)
      return startDate > now && show.dj && (show.djUsername || show.djUserId);
    })
    .slice(0, 5);

  if (upcomingShows.length === 0) {
    return null;
  }

  const handleRemindMe = async (show: Show) => {
    if (!isAuthenticated) {
      onRemindMe(show);
      return;
    }

    if (!show.dj) return;

    setAddingDj(show.dj);
    try {
      // Add DJ to watchlist
      await addToWatchlist(show.dj, show.djUserId, show.djEmail);
      // Also add this specific show to favorites
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingDj(null);
    }
  };

  return (
    <div className="mb-6">
      <h2 className="text-white text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="text-accent">&gt;</span> Who Not To Miss
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {upcomingShows.map((show) => {
          const station = stations.get(show.stationId);
          if (!station) return null;

          const isFollowing = show.dj ? isInWatchlist(show.dj) : false;
          const isAdding = addingDj === show.dj;

          return (
            <TicketCard
              key={show.id}
              show={show}
              station={station}
              isAuthenticated={isAuthenticated}
              isFollowing={isFollowing}
              isAddingReminder={isAdding}
              onRemindMe={() => handleRemindMe(show)}
            />
          );
        })}
      </div>
    </div>
  );
}
