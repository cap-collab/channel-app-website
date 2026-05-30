'use client';

import { useState } from 'react';
import { HeaderSearch } from '@/components/HeaderSearch';
import { AuthModal } from '@/components/AuthModal';
import { ChannelClient } from '@/components/channel/ChannelClient';
import { useFilterContext } from '@/contexts/FilterContext';
import { Tuner } from '@/components/channel/Tuner';

function SceneTuner() {
  const {
    selectedCity,
    handleCityChange,
    selectedGenres,
    handleGenresChange,
    cityResultCount,
    genreResultCount,
    citiesWithMatches,
    genresWithMatches,
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

export function SceneClient() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <ChannelClient
        skipHero
        sceneMode
        topSearchSlot={<HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />}
        discoveryFiltersSlot={<SceneTuner />}
      />
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
