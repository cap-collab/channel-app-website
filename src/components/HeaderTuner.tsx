'use client';

import { useFilterContext } from '@/contexts/FilterContext';
import { Tuner } from '@/components/channel/Tuner';

export function HeaderTuner() {
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
      compact
    />
  );
}
