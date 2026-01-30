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
  // Exclude playlist and restream types
  const upcomingShows = shows
    .filter((show) => {
      const now = new Date();
      const startDate = new Date(show.startTime);
      // Only upcoming, has DJ, has profile (djUsername or djUserId), and has photo
      const hasPhoto = show.djPhotoUrl || show.imageUrl;
      const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
      return startDate > now && show.dj && (show.djUsername || show.djUserId) && hasPhoto && !isRestreamOrPlaylist;
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
    <section className="mb-4 md:mb-6">
      {/* Header matching LiveNow style */}
      <div className="flex justify-between items-end mb-2 md:mb-3">
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </svg>
          Who Not To Miss
        </h2>
      </div>

      {/* 2-column grid on desktop, full width on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
    </section>
  );
}
