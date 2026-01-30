'use client';

import { useState, useMemo, useEffect } from 'react';
import { IRLShowData } from '@/types';
import { useFavorites } from '@/hooks/useFavorites';
import { IRLShowCard } from './IRLShowCard';
import { SUPPORTED_CITIES, getDefaultCity, matchesCity } from '@/lib/city-detection';

interface IRLNearYouProps {
  irlShows: IRLShowData[];
  isAuthenticated: boolean;
  onAuthRequired: (djName: string) => void;
}

export function IRLNearYou({
  irlShows,
  isAuthenticated,
  onAuthRequired,
}: IRLNearYouProps) {
  const { isInWatchlist, followDJ, removeFromWatchlist } = useFavorites();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Set default city on mount (client-side only)
  useEffect(() => {
    setSelectedCity(getDefaultCity());
  }, []);

  // Filter shows by selected city
  const filteredShows = useMemo(() => {
    if (!selectedCity) return [];
    return irlShows.filter((show) => matchesCity(show.location, selectedCity));
  }, [irlShows, selectedCity]);

  // Hide section if no IRL shows at all
  if (irlShows.length === 0) {
    return null;
  }

  // Follow/Unfollow: toggles DJ in watchlist
  const handleFollow = async (show: IRLShowData) => {
    if (!isAuthenticated) {
      onAuthRequired(show.djName);
      return;
    }

    if (!show.djName) return;

    setAddingFollowDj(show.djName);
    try {
      if (isInWatchlist(show.djName)) {
        // Unfollow - remove from watchlist
        await removeFromWatchlist(show.djName);
      } else {
        // Follow - adds DJ to watchlist
        await followDJ(show.djName, undefined, undefined, undefined);
      }
    } finally {
      setAddingFollowDj(null);
    }
  };

  return (
    <section className="mb-6">
      {/* Header with city dropdown */}
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-white text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          {/* Location pin icon */}
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
          IRL near you
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
                onClick={() => setIsDropdownOpen(false)}
              />
              {/* Dropdown menu */}
              <div className="absolute right-0 mt-1 w-40 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-20 py-1 max-h-64 overflow-y-auto">
                {SUPPORTED_CITIES.map((city) => (
                  <button
                    key={city}
                    onClick={() => {
                      setSelectedCity(city);
                      setIsDropdownOpen(false);
                    }}
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

      {/* Shows or empty state */}
      {filteredShows.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No upcoming shows in {selectedCity}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredShows.map((show, index) => {
            const isFollowing = show.djName ? isInWatchlist(show.djName) : false;
            const isAddingFollow = addingFollowDj === show.djName;

            return (
              <IRLShowCard
                key={`${show.djUsername}-${show.date}-${index}`}
                show={show}
                isFollowing={isFollowing}
                isAddingFollow={isAddingFollow}
                onFollow={() => handleFollow(show)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
