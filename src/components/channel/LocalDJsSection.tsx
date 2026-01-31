'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Show, Station, IRLShowData } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { IRLShowCard } from './IRLShowCard';
import { TicketCard } from './TicketCard';
import { SwipeableCardCarousel } from './SwipeableCardCarousel';
import { InviteCard } from './InviteCard';
import { SUPPORTED_CITIES, matchesCity } from '@/lib/city-detection';
import { prioritizeShowArray, prioritizeShows } from '@/lib/show-prioritization';

interface LocalDJsSectionProps {
  shows: Show[];
  irlShows: IRLShowData[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
  onIRLAuthRequired: (djName: string) => void;
  selectedCity: string;
  onCityChange: (city: string) => void;
}

export function LocalDJsSection({
  shows,
  irlShows,
  stations,
  isAuthenticated,
  onAuthRequired,
  onIRLAuthRequired,
  selectedCity,
  onCityChange,
}: LocalDJsSectionProps) {
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);
  const [customCityInput, setCustomCityInput] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle city selection
  const handleSelectCity = (city: string) => {
    onCityChange(city);
    setIsDropdownOpen(false);
    setIsCustomMode(false);
    setCustomCityInput('');
  };

  // Handle custom city submission
  const handleCustomCitySubmit = () => {
    const trimmed = customCityInput.trim();
    if (trimmed) {
      handleSelectCity(trimmed);
    }
  };

  // Focus input when entering custom mode
  useEffect(() => {
    if (isCustomMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCustomMode]);

  // Filter IRL shows by selected city (max 5)
  // IRL shows don't have a recurring type, so just diversify by location
  const filteredIRLShows = useMemo(() => {
    if (!selectedCity) return [];
    const filtered = irlShows.filter((show) => matchesCity(show.location, selectedCity));
    // Diversify by DJ location (their home city) to show variety
    return prioritizeShows(
      filtered,
      () => undefined, // No recurrence type for IRL shows
      () => undefined, // No station for IRL shows
      (show) => show.djLocation,
      5
    );
  }, [irlShows, selectedCity]);

  // Filter to upcoming shows from DJs based in the selected city (max 5)
  // Prioritize: weekly/bi-weekly first, then monthly, then others
  // Also diversify by station
  const localDJShows = useMemo(() => {
    if (!selectedCity) return [];

    const now = new Date();
    const filtered = shows.filter((show) => {
      const startDate = new Date(show.startTime);
      // Only upcoming shows with djLocation that matches the selected city
      // Must have photo and DJ profile
      const hasPhoto = show.djPhotoUrl || show.imageUrl;
      const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
      return (
        startDate > now &&
        show.djLocation &&
        matchesCity(show.djLocation, selectedCity) &&
        show.dj &&
        (show.djUsername || show.djUserId) &&
        hasPhoto &&
        !isRestreamOrPlaylist
      );
    });

    return prioritizeShowArray(filtered, 5);
  }, [shows, selectedCity]);

  const hasIRLShows = filteredIRLShows.length > 0;
  const hasRadioShows = localDJShows.length > 0;
  const isEmpty = !hasIRLShows && !hasRadioShows;

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
      {/* Header with city dropdown - always visible */}
      <div className={`flex justify-between items-center ${isEmpty ? 'mb-1' : 'mb-2 md:mb-3'}`}>
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          {/* Pin/location icon */}
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
          Your Local DJs
        </h2>

        {/* City dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            {selectedCity || 'Select city'}
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
                  setCustomCityInput('');
                }}
              />
              {/* Dropdown menu */}
              <div className="absolute right-0 mt-1 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-20 py-1 max-h-72 overflow-y-auto">
                {/* Custom city input option */}
                {isCustomMode ? (
                  <div className="px-2 py-1">
                    <div className="flex gap-1">
                      <input
                        ref={inputRef}
                        type="text"
                        value={customCityInput}
                        onChange={(e) => setCustomCityInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCustomCitySubmit();
                          } else if (e.key === 'Escape') {
                            setIsCustomMode(false);
                            setCustomCityInput('');
                          }
                        }}
                        placeholder="Enter city..."
                        className="flex-1 bg-black border border-white/20 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-white/40 focus:outline-none"
                      />
                      <button
                        onClick={handleCustomCitySubmit}
                        disabled={!customCityInput.trim()}
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
                    Type your city...
                  </button>
                )}

                {/* Divider */}
                <div className="border-t border-white/10 my-1" />

                {/* City list */}
                {SUPPORTED_CITIES.map((city) => (
                  <button
                    key={city}
                    onClick={() => handleSelectCity(city)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      selectedCity === city
                        ? 'bg-white/10 text-white'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Empty state - both sections empty */}
      {isEmpty && (
        <div className="text-center py-3">
          <p className="text-gray-400 text-sm mb-3">
            Invite your local DJs to join Channel
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
                ? [<InviteCard key="invite-card" message={`Know a DJ in ${selectedCity}?`} />]
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
                ? [<InviteCard key="invite-card" message={`Know a DJ in ${selectedCity}?`} />]
                : []),
            ]}
          </SwipeableCardCarousel>
        </div>
      )}
    </section>
  );
}
