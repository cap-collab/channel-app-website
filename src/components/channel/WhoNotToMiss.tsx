'use client';

import { useState } from 'react';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { TicketCard } from './TicketCard';

interface WhoNotToMissProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
}

export function WhoNotToMiss({
  shows,
  stations,
  isAuthenticated,
  onAuthRequired,
}: WhoNotToMissProps) {
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

  // Filter to upcoming shows with DJ profiles and photos only
  const upcomingShows = shows
    .filter((show) => {
      const now = new Date();
      const startDate = new Date(show.startTime);
      // Only upcoming, has DJ, has profile (djUsername or djUserId), and has photo
      const hasPhoto = show.djPhotoUrl || show.imageUrl;
      return startDate > now && show.dj && (show.djUsername || show.djUserId) && hasPhoto;
    })
    .slice(0, 5);

  if (upcomingShows.length === 0) {
    return null;
  }

  // Follow/Unfollow: toggles DJ in watchlist
  const handleFollow = async (show: Show) => {
    if (!isAuthenticated) {
      onAuthRequired(show);
      return;
    }

    if (!show.dj) return;

    setAddingFollowDj(show.dj);
    try {
      if (isInWatchlist(show.dj)) {
        // Unfollow - remove from watchlist
        await removeFromWatchlist(show.dj);
      } else {
        // Follow - adds DJ to watchlist + specific show to favorites
        await followDJ(show.dj, show.djUserId, show.djEmail, show);
      }
    } finally {
      setAddingFollowDj(null);
    }
  };

  // Remind Me: only adds this specific show to favorites
  const handleRemindMe = async (show: Show) => {
    if (!isAuthenticated) {
      onAuthRequired(show);
      return;
    }

    setAddingReminderShowId(show.id);
    try {
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingReminderShowId(null);
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
          const isFavorited = isShowFavorited(show);
          const isAddingFollow = addingFollowDj === show.dj;
          const isAddingReminder = addingReminderShowId === show.id;

          return (
            <TicketCard
              key={show.id}
              show={show}
              station={station}
              isAuthenticated={isAuthenticated}
              isFollowing={isFollowing}
              isShowFavorited={isFavorited}
              isAddingFollow={isAddingFollow}
              isAddingReminder={isAddingReminder}
              onFollow={() => handleFollow(show)}
              onRemindMe={() => handleRemindMe(show)}
            />
          );
        })}
      </div>
    </div>
  );
}
