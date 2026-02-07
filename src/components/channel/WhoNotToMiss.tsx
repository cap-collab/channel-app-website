'use client';

import { useState, useMemo } from 'react';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { TicketCard } from './TicketCard';
import { SwipeableCardCarousel } from './SwipeableCardCarousel';
import { InviteCard } from './InviteCard';
import { prioritizeShowArray } from '@/lib/show-prioritization';
import { GENRE_ALIASES } from '@/lib/genres';

interface WhoNotToMissProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
  excludedShowIds?: Set<string>; // Shows already displayed in My Favorites or Local DJs sections
  featuredDJNames?: string[]; // DJ names already featured (first position) in earlier sections - avoid featuring them first here
  selectedGenre: string; // Selected genre from Tuner bar
}

// Helper to check if a show matches a genre (case-insensitive partial match)
// Supports aliases like d&b for Drum and Bass, etc.
function matchesGenre(showGenres: string[] | undefined, selectedGenre: string): boolean {
  if (!showGenres || showGenres.length === 0) return false;
  const genreLower = selectedGenre.toLowerCase();

  // Get aliases for the selected genre
  const aliases = GENRE_ALIASES[genreLower] || [];
  const allTerms = [genreLower, ...aliases];

  // Check reverse: if selected genre is an alias, include the canonical genre
  for (const [canonical, aliasList] of Object.entries(GENRE_ALIASES)) {
    if (aliasList.includes(genreLower)) {
      allTerms.push(canonical, ...aliasList);
      break;
    }
  }

  return showGenres.some((g) => {
    const gLower = g.toLowerCase();
    return allTerms.some((term) => gLower.includes(term) || term.includes(gLower));
  });
}

// Helper to reorder array so already-featured DJs don't appear first (unless only option)
function avoidFeaturedFirst<T>(
  items: T[],
  getDJName: (item: T) => string | undefined,
  featuredNames: string[]
): T[] {
  if (items.length <= 1 || featuredNames.length === 0) return items;

  const featuredSet = new Set(featuredNames.map((n) => n.toLowerCase()));
  const firstDJ = getDJName(items[0])?.toLowerCase();

  // If first item's DJ is already featured, find first non-featured and swap
  if (firstDJ && featuredSet.has(firstDJ)) {
    const nonFeaturedIndex = items.findIndex((item, i) => {
      if (i === 0) return false;
      const djName = getDJName(item)?.toLowerCase();
      return djName && !featuredSet.has(djName);
    });

    if (nonFeaturedIndex > 0) {
      const reordered = [...items];
      [reordered[0], reordered[nonFeaturedIndex]] = [reordered[nonFeaturedIndex], reordered[0]];
      return reordered;
    }
  }

  return items;
}

export function WhoNotToMiss({
  shows,
  stations,
  isAuthenticated,
  onAuthRequired,
  excludedShowIds = new Set(),
  featuredDJNames = [],
  selectedGenre,
}: WhoNotToMissProps) {
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

  // Base filter for upcoming shows with DJ profiles
  const upcomingShowsBase = useMemo(() => {
    const now = new Date();
    return shows.filter((show) => {
      const startDate = new Date(show.startTime);
      const hasPhoto = show.djPhotoUrl || show.imageUrl;
      const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
      return startDate > now && show.dj && (show.djUsername || show.djUserId) && hasPhoto && !isRestreamOrPlaylist;
    });
  }, [shows]);

  // Filter shows by selected genre (max 5), excluding shows already displayed elsewhere
  // If no genre selected, show all DJs (no genre filter)
  // Prioritize: weekly/bi-weekly first, then monthly, then others
  // Also diversify by station and location
  // Avoid featuring DJs already featured in earlier sections
  const genreFilteredShows = useMemo(() => {
    const filtered = upcomingShowsBase.filter((show) => {
      if (excludedShowIds.has(show.id)) return false;
      // If genre is selected, filter by it; otherwise include all
      if (selectedGenre) {
        return matchesGenre(show.djGenres, selectedGenre);
      }
      return true;
    });
    const prioritized = prioritizeShowArray(filtered, 5);
    // Avoid putting already-featured DJs first
    return avoidFeaturedFirst(prioritized, (show) => show.dj, featuredDJNames);
  }, [upcomingShowsBase, selectedGenre, excludedShowIds, featuredDJNames]);

  const hasGenreShows = genreFilteredShows.length > 0;

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
        await removeFromWatchlist(show.dj);
      } else {
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

  // Don't render if no shows at all
  if (!hasGenreShows) {
    return null;
  }

  return (
    <section className="mb-4 md:mb-6">
      {/* Section header */}
      <div className="flex items-center mb-2 md:mb-3">
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </svg>
          Who Not To Miss
        </h2>
      </div>

      <SwipeableCardCarousel>
        {[
          ...genreFilteredShows
            .filter((show) => stations.get(show.stationId))
            .map((show) => {
              const station = stations.get(show.stationId)!;
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
            }),
          ...(genreFilteredShows.length < 5
            ? [
                <InviteCard
                  key="invite-card"
                  message={selectedGenre
                    ? `Invite your favorite ${selectedGenre} DJs to join Channel`
                    : 'Invite your favorite DJs to join Channel'}
                />,
              ]
            : []),
        ]}
      </SwipeableCardCarousel>
    </section>
  );
}
