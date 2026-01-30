'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { TicketCard } from './TicketCard';

const SUPPORTED_GENRES = [
  'House',
  'Dub',
  'Reggae',
  'Electronic',
  'Disco',
  'Garage',
  'Drum and Bass',
  'Jungle',
  'World',
  'Techno',
  'Bass',
  'Funk',
  'Hip Hop',
  'Soul',
];

interface WhoNotToMissProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
}

// Helper to check if a show matches a genre (case-insensitive partial match)
function matchesGenre(showGenres: string[] | undefined, selectedGenre: string): boolean {
  if (!showGenres || showGenres.length === 0) return false;
  const genreLower = selectedGenre.toLowerCase();
  return showGenres.some((g) => g.toLowerCase().includes(genreLower) || genreLower.includes(g.toLowerCase()));
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
  const [selectedGenre, setSelectedGenre] = useState<string>('House');
  const [customGenreInput, setCustomGenreInput] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle genre selection
  const handleSelectGenre = (genre: string) => {
    setSelectedGenre(genre);
    setIsDropdownOpen(false);
    setIsCustomMode(false);
    setCustomGenreInput('');
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

  // Filter shows by selected genre (max 3)
  const genreFilteredShows = useMemo(() => {
    if (!selectedGenre) return [];
    return upcomingShowsBase
      .filter((show) => matchesGenre(show.djGenres, selectedGenre))
      .slice(0, 3);
  }, [upcomingShowsBase, selectedGenre]);

  // "Our Picks" - prioritize shows with photo + location + genres
  const ourPicks = useMemo(() => {
    // Score shows by profile completeness
    const scoredShows = upcomingShowsBase.map((show) => {
      let score = 0;
      if (show.djPhotoUrl) score += 3; // Photo is most important
      if (show.djLocation) score += 2; // Location adds context
      if (show.djGenres && show.djGenres.length > 0) score += 1; // Genres help discovery
      return { show, score };
    });

    // Sort by score (descending), then by start time (ascending)
    scoredShows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime();
    });

    // Exclude shows already in genre section to avoid duplicates
    const genreShowIds = new Set(genreFilteredShows.map((s) => s.id));
    return scoredShows
      .filter(({ show }) => !genreShowIds.has(show.id))
      .slice(0, 3)
      .map(({ show }) => show);
  }, [upcomingShowsBase, genreFilteredShows]);

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
        {hasGenreShows ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {genreFilteredShows.map((show) => {
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
        ) : (
          <div className="text-center py-3">
            <p className="text-gray-400 text-sm mb-3">
              No upcoming {selectedGenre} DJs yet. Invite your favorites to join Channel!
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
      </section>

      {/* Our Picks section */}
      {hasOurPicks && (
        <section className="mb-4 md:mb-6">
          <div className="flex justify-between items-center mb-2 md:mb-3">
            <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Our Picks
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {ourPicks.map((show) => {
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
      )}
    </div>
  );
}
