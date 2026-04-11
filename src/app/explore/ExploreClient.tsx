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
          <>
            <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
            <div className="mt-3">
              <ExploreTuner />
            </div>
          </>
        }
      />
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
