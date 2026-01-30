'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Show, Station } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { TicketCard } from './TicketCard';
import { SUPPORTED_CITIES, getDefaultCity, matchesCity } from '@/lib/city-detection';

interface LocalDJsProps {
  shows: Show[];
  stations: Map<string, Station>;
  isAuthenticated: boolean;
  onAuthRequired: (show: Show) => void;
}

export function LocalDJs({
  shows,
  stations,
  isAuthenticated,
  onAuthRequired,
}: LocalDJsProps) {
  const { user } = useAuthContext();
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [customCityInput, setCustomCityInput] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialLoadDone = useRef(false);

  // Load saved city preference from user profile or fallback to timezone detection
  useEffect(() => {
    async function loadSavedCity() {
      if (initialLoadDone.current) return;

      if (user?.uid && db) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const savedCity = userDoc.data()?.irlCity;
            if (savedCity) {
              setSelectedCity(savedCity);
              initialLoadDone.current = true;
              return;
            }
          }
        } catch (error) {
          console.error('Error loading saved city:', error);
        }
      }

      // Fallback to timezone detection
      setSelectedCity(getDefaultCity());
      initialLoadDone.current = true;
    }

    loadSavedCity();
  }, [user?.uid]);

  // Save city selection to user profile
  const saveCityToProfile = async (city: string) => {
    if (!user?.uid || !db) return;

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        irlCity: city,
      });
    } catch (error) {
      console.error('Error saving city preference:', error);
    }
  };

  // Handle city selection
  const handleSelectCity = (city: string) => {
    setSelectedCity(city);
    setIsDropdownOpen(false);
    setIsCustomMode(false);
    setCustomCityInput('');

    // Save to profile if authenticated
    if (isAuthenticated) {
      saveCityToProfile(city);
    }
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

  // Filter to upcoming shows from DJs based in the selected city (max 3)
  const localDJShows = useMemo(() => {
    if (!selectedCity) return [];

    const now = new Date();
    return shows
      .filter((show) => {
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
      })
      .slice(0, 3); // Max 3 shows
  }, [shows, selectedCity]);

  // Hide section if no local DJ shows
  if (localDJShows.length === 0) {
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
    <section className="mb-6">
      {/* Header with city dropdown */}
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          {/* House/home icon */}
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
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

      {/* Show cards */}
      <div className="space-y-6">
        {localDJShows.map((show) => {
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
