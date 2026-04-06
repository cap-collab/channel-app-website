'use client';

import { useState } from 'react';
import { HeaderSearch } from '@/components/HeaderSearch';
import { AuthModal } from '@/components/AuthModal';
import { ChannelClient } from '../radio/ChannelClient';
import { useFilterContext } from '@/contexts/FilterContext';
import { Tuner } from '@/components/channel/Tuner';

function ExploreTuner() {
  const {
    selectedCity, handleCityChange,
    selectedGenres, handleGenresChange,
    cityResultCount, genreResultCount,
    citiesWithMatches, genresWithMatches,
    onGenreDropdownClose,
  } = useFilterContext();

  return (
    <Tuner
      selectedCity={selectedCity}
      onCityChange={handleCityChange}
      selectedGenres={selectedGenres}
      onGenresChange={handleGenresChange}
      cityResultCount={cityResultCount}
      genreResultCount={genreResultCount}
      citiesWithMatches={citiesWithMatches}
      genresWithMatches={genresWithMatches}
      onGenreDropdownClose={onGenreDropdownClose}
    />
  );
}

export function ExploreClient() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <ChannelClient
        skipHero
        exploreSearchBar={
          <div className="px-4 md:px-8 pt-4 pb-2 relative z-10">
            <div className="max-w-7xl mx-auto">
              <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
              <div className="mt-3">
                <ExploreTuner />
              </div>
            </div>
          </div>
        }
      />
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
