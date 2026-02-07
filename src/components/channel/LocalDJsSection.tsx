'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Show, Station, IRLShowData } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { IRLShowCard } from './IRLShowCard';
import { TicketCard } from './TicketCard';
import { SwipeableCardCarousel } from './SwipeableCardCarousel';
import { InviteCard } from './InviteCard';
import { matchesCity } from '@/lib/city-detection';
import { prioritizeShowArray, prioritizeShows } from '@/lib/show-prioritization';
import { GENRE_ALIASES } from '@/lib/genres';

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

// Helper to check if a show matches a genre (case-insensitive partial match with aliases)
function showMatchesGenre(showGenres: string[] | undefined, selectedGenre: string): boolean {
  if (!showGenres || showGenres.length === 0 || !selectedGenre) return false;
  const genreLower = selectedGenre.toLowerCase();

  const aliases = GENRE_ALIASES[genreLower] || [];
  const allTerms = [genreLower, ...aliases];

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

interface LocalDJsSectionProps {
  shows: Show[];
  irlShows: IRLShowData[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
  onIRLAuthRequired: (djName: string) => void;
  selectedCity: string;
  selectedGenre?: string;
  onFeaturedDJs?: (djNames: string[]) => void; // Reports DJ names in first position of each carousel
}

export function LocalDJsSection({
  shows,
  irlShows,
  stations,
  isAuthenticated,
  onAuthRequired,
  onIRLAuthRequired,
  selectedCity,
  selectedGenre,
  onFeaturedDJs,
}: LocalDJsSectionProps) {
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Filter IRL shows by selected city (max 5)
  // IRL shows don't have a recurring type, so just diversify by location
  const isAnywhere = selectedCity === 'Anywhere';

  const filteredIRLShows = useMemo(() => {
    if (!selectedCity) return [];
    const filtered = isAnywhere
      ? irlShows
      : irlShows.filter((show) => matchesCity(show.location, selectedCity));
    // Diversify by DJ location (their home city) to show variety
    return prioritizeShows(
      filtered,
      () => undefined, // No recurrence type for IRL shows
      () => undefined, // No station for IRL shows
      (show) => show.djLocation,
      5
    );
  }, [irlShows, selectedCity, isAnywhere]);

  // Get DJ name from first IRL show (to avoid featuring same DJ first in radio shows)
  const firstIRLDJName = useMemo(() => {
    if (filteredIRLShows.length > 0 && filteredIRLShows[0].djName) {
      return filteredIRLShows[0].djName.toLowerCase();
    }
    return null;
  }, [filteredIRLShows]);

  // Filter to upcoming shows from DJs based in the selected city (max 5)
  // Prioritize: weekly/bi-weekly first, then monthly, then others
  // Also diversify by station
  // Avoid featuring the same DJ first if they're already first in IRL shows
  const localDJShows = useMemo(() => {
    if (!selectedCity) return [];

    const now = new Date();
    const filtered = shows.filter((show) => {
      const startDate = new Date(show.startTime);
      // Only upcoming shows with DJ profile and photo
      const hasPhoto = show.djPhotoUrl || show.imageUrl;
      const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
      const cityMatch = isAnywhere || (show.djLocation && matchesCity(show.djLocation, selectedCity));
      return (
        startDate > now &&
        cityMatch &&
        show.dj &&
        (show.djUsername || show.djUserId) &&
        hasPhoto &&
        !isRestreamOrPlaylist
      );
    });

    // Sort genre-matching shows first before prioritization
    const genreSorted = selectedGenre
      ? [...filtered].sort((a, b) => {
          const aMatch = showMatchesGenre(a.djGenres, selectedGenre) ? 1 : 0;
          const bMatch = showMatchesGenre(b.djGenres, selectedGenre) ? 1 : 0;
          return bMatch - aMatch;
        })
      : filtered;

    const prioritized = prioritizeShowArray(genreSorted, 5);

    // Avoid putting IRL-featured DJ first in radio shows
    const featuredNames = firstIRLDJName ? [firstIRLDJName] : [];
    return avoidFeaturedFirst(prioritized, (show) => show.dj, featuredNames);
  }, [shows, selectedCity, selectedGenre, firstIRLDJName, isAnywhere]);

  const hasIRLShows = filteredIRLShows.length > 0;
  const hasRadioShows = localDJShows.length > 0;
  const isEmpty = !hasIRLShows && !hasRadioShows;

  // Report featured DJs (first position in each carousel) to parent
  useEffect(() => {
    if (!onFeaturedDJs) return;
    const featured: string[] = [];

    // First DJ from IRL shows
    if (filteredIRLShows.length > 0 && filteredIRLShows[0].djName) {
      featured.push(filteredIRLShows[0].djName.toLowerCase());
    }

    // First DJ from radio shows
    if (localDJShows.length > 0 && localDJShows[0].dj) {
      featured.push(localDJShows[0].dj.toLowerCase());
    }

    onFeaturedDJs(featured);
  }, [filteredIRLShows, localDJShows, onFeaturedDJs]);

  // Handle copy URL
  const handleCopyUrl = useCallback(async () => {
    try {
      const url = `${window.location.origin}/studio/join`;
      await navigator.clipboard.writeText(url);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  }, []);

  // Follow/Unfollow for IRL shows
  const handleIRLFollow = async (show: IRLShowData) => {
    if (!isAuthenticated) {
      onIRLAuthRequired(show.djName);
      return;
    }

    if (!show.djName) return;

    setAddingFollowDj(show.djName);
    try {
      if (isInWatchlist(show.djName)) {
        await removeFromWatchlist(show.djName);
      } else {
        await followDJ(show.djName, undefined, undefined, undefined);
      }
    } finally {
      setAddingFollowDj(null);
    }
  };

  // Follow/Unfollow for radio shows
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

  return (
    <section className={isEmpty ? 'mb-2' : 'mb-4 md:mb-6'}>
      {/* Empty state - both sections empty */}
      {isEmpty && (
        <div className="text-center py-3">
          <p className="text-gray-400 text-sm mb-3">
            Invite your favorite {selectedCity} DJs to join Channel
          </p>
          <button
            onClick={handleCopyUrl}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            {copySuccess ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy invite link
              </>
            )}
          </button>
        </div>
      )}

      {/* IRL subsection - swipeable cards */}
      {hasIRLShows && (
        <div className="mb-4 md:mb-6">
          <SwipeableCardCarousel>
            {[
              ...filteredIRLShows.map((show, index) => {
                const isFollowing = show.djName ? isInWatchlist(show.djName) : false;
                const isAddingFollow = addingFollowDj === show.djName;

                return (
                  <IRLShowCard
                    key={`${show.djUsername}-${show.date}-${index}`}
                    show={show}
                    isFollowing={isFollowing}
                    isAddingFollow={isAddingFollow}
                    onFollow={() => handleIRLFollow(show)}
                  />
                );
              }),
              ...(filteredIRLShows.length < 5 && !hasRadioShows
                ? [<InviteCard key="invite-card" message={`Invite your favorite ${isAnywhere ? '' : selectedCity + ' '}DJs to join Channel`} />]
                : []),
            ]}
          </SwipeableCardCarousel>
        </div>
      )}

      {/* Radio Shows subsection - swipeable cards */}
      {hasRadioShows && (
        <div>
          <SwipeableCardCarousel>
            {[
              ...localDJShows
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
              ...(localDJShows.length < 5
                ? [<InviteCard key="invite-card" message={`Invite your favorite ${isAnywhere ? '' : selectedCity + ' '}DJs to join Channel`} />]
                : []),
            ]}
          </SwipeableCardCarousel>
        </div>
      )}
    </section>
  );
}
