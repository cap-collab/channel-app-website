'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { TicketCard } from './TicketCard';
import { SwipeableCardCarousel } from './SwipeableCardCarousel';
import { InviteCard } from './InviteCard';
import { prioritizeShowArray } from '@/lib/show-prioritization';

const SUPPORTED_GENRES = [
  'Bass',
  'Disco',
  'Drum and Bass',
  'Dub',
  'Electronic',
  'Funk',
  'Garage',
  'Hip Hop',
  'House',
  'Jungle',
  'Reggae',
  'Soul',
  'Techno',
  'World',
];

interface WhoNotToMissProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
  excludedShowIds?: Set<string>; // Shows already displayed in My Favorites or Local DJs sections
}

// Genre aliases for flexible matching
const GENRE_ALIASES: Record<string, string[]> = {
  'drum and bass': ['drum & bass', 'dnb', 'd&b', 'd and b', 'drum n bass', "drum'n'bass", 'drumnbass'],
  'hip hop': ['hip-hop', 'hiphop', 'rap'],
  'garage': ['uk garage', 'ukg', '2-step', '2step'],
  'dub': ['dubstep'],
  'disco': ['nu disco', 'nu-disco'],
  'funk': ['funky'],
  'soul': ['neo soul', 'neo-soul', 'r&b', 'rnb'],
  'electronic': ['electronica'],
  'house': ['deep house', 'tech house'],
  'techno': ['tech'],
  'jungle': ['junglist'],
  'reggae': ['roots', 'dancehall'],
};

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

export function WhoNotToMiss({
  shows,
  stations,
  isAuthenticated,
  onAuthRequired,
  excludedShowIds = new Set(),
}: WhoNotToMissProps) {
  const { user } = useAuthContext();
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>('House');
  const [customGenreInput, setCustomGenreInput] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialLoadDone = useRef(false);

  // Load saved genre preference from user profile
  useEffect(() => {
    async function loadSavedGenre() {
      if (initialLoadDone.current) return;

      if (user?.uid && db) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const savedGenre = userDoc.data()?.preferredGenre;
            if (savedGenre) {
              setSelectedGenre(savedGenre);
              initialLoadDone.current = true;
              return;
            }
          }
        } catch (error) {
          console.error('Error loading saved genre:', error);
        }
      }

      // Default to House if no saved preference
      initialLoadDone.current = true;
    }

    loadSavedGenre();
  }, [user?.uid]);

  // Save genre selection to user profile
  const saveGenreToProfile = async (genre: string) => {
    if (!user?.uid || !db) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        preferredGenre: genre,
      });
    } catch (error) {
      console.error('Error saving genre preference:', error);
    }
  };

  // Handle genre selection
  const handleSelectGenre = (genre: string) => {
    setSelectedGenre(genre);
    setIsDropdownOpen(false);
    setIsCustomMode(false);
    setCustomGenreInput('');

    // Save to profile if authenticated
    if (isAuthenticated) {
      saveGenreToProfile(genre);
    }
  };

  // Handle custom genre submission
  const handleCustomGenreSubmit = () => {
    const trimmed = customGenreInput.trim();
    if (trimmed) {
      handleSelectGenre(trimmed);
    }
  };

  // Focus input when entering custom mode
  useEffect(() => {
    if (isCustomMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCustomMode]);

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
  // Prioritize: weekly/bi-weekly first, then monthly, then others
  // Also diversify by station and location
  const genreFilteredShows = useMemo(() => {
    if (!selectedGenre) return [];
    const filtered = upcomingShowsBase.filter(
      (show) => !excludedShowIds.has(show.id) && matchesGenre(show.djGenres, selectedGenre)
    );
    return prioritizeShowArray(filtered, 5);
  }, [upcomingShowsBase, selectedGenre, excludedShowIds]);

  // "Our Picks" - prioritize recurring shows, then by profile completeness
  // Weekly/bi-weekly first, then monthly, then others
  // Also diversify by station and location
  const ourPicks = useMemo(() => {
    // Exclude shows already in genre section to avoid duplicates
    const genreShowIds = new Set(genreFilteredShows.map((s) => s.id));

    // Filter out excluded shows and genre section shows
    const candidates = upcomingShowsBase.filter(
      (show) => !excludedShowIds.has(show.id) && !genreShowIds.has(show.id)
    );

    // Apply prioritization (weekly/bi-weekly first, diversify by station/location)
    const prioritized = prioritizeShowArray(candidates);

    // Within each recurrence tier, also consider profile completeness for tie-breaking
    // The prioritization already handles recurrence and diversity, so we just take top 5
    return prioritized.slice(0, 5);
  }, [upcomingShowsBase, genreFilteredShows, excludedShowIds]);

  const hasGenreShows = genreFilteredShows.length > 0;
  const hasOurPicks = ourPicks.length > 0;

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
  if (!hasGenreShows && !hasOurPicks) {
    return null;
  }

  return (
    <div>
      {/* Genre-filtered section */}
      <section className="mb-4 md:mb-6">
        {/* Header with genre dropdown */}
        <div className="flex justify-between items-center mb-2 md:mb-3">
          <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            </svg>
            Who Not To Miss
          </h2>

          {/* Genre dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
            >
              {selectedGenre || 'Select genre'}
              <svg
                className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isDropdownOpen && (
              <>
                {/* Backdrop to close dropdown */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setIsCustomMode(false);
                    setCustomGenreInput('');
                  }}
                />
                {/* Dropdown menu */}
                <div className="absolute right-0 mt-1 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-20 py-1 max-h-72 overflow-y-auto">
                  {/* Custom genre input option */}
                  {isCustomMode ? (
                    <div className="px-2 py-1">
                      <div className="flex gap-1">
                        <input
                          ref={inputRef}
                          type="text"
                          value={customGenreInput}
                          onChange={(e) => setCustomGenreInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleCustomGenreSubmit();
                            } else if (e.key === 'Escape') {
                              setIsCustomMode(false);
                              setCustomGenreInput('');
                            }
                          }}
                          placeholder="Enter genre..."
                          className="flex-1 bg-black border border-white/20 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-white/40 focus:outline-none"
                        />
                        <button
                          onClick={handleCustomGenreSubmit}
                          disabled={!customGenreInput.trim()}
                          className="px-2 py-1 bg-white text-black rounded text-sm font-medium disabled:opacity-50"
                        >
                          Go
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsCustomMode(true)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                      Type your genre...
                    </button>
                  )}

                  {/* Divider */}
                  <div className="border-t border-white/10 my-1" />

                  {/* Genre list */}
                  {SUPPORTED_GENRES.map((genre) => (
                    <button
                      key={genre}
                      onClick={() => handleSelectGenre(genre)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        selectedGenre === genre
                          ? 'bg-white/10 text-white'
                          : 'text-gray-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Genre-filtered shows or empty state */}
        <SwipeableCardCarousel>
          {genreFilteredShows
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
            })}
          {genreFilteredShows.length < 5 && (
            <InviteCard
              message={
                genreFilteredShows.length === 0
                  ? `No upcoming ${selectedGenre} DJs yet`
                  : `Know a ${selectedGenre} DJ?`
              }
            />
          )}
        </SwipeableCardCarousel>
      </section>

      {/* Our Picks section */}
      {hasOurPicks && (
        <section className="mb-4 md:mb-6">
          <div className="flex justify-between items-center mb-2 md:mb-3">
            <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              Our Picks
            </h2>
          </div>

          <SwipeableCardCarousel>
            {ourPicks
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
              })}
          </SwipeableCardCarousel>
        </section>
      )}
    </div>
  );
}
