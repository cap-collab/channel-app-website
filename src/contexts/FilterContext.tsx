'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { getDefaultCity } from '@/lib/city-detection';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface FilterContextValue {
  selectedCity: string;
  setSelectedCity: (city: string) => void;
  selectedGenres: string[];
  setSelectedGenres: (genres: string[]) => void;
  handleCityChange: (city: string) => void;
  handleGenresChange: (genres: string[]) => void;
  // Optional display hints set by pages that have schedule data
  cityResultCount?: number;
  genreResultCount?: number;
  citiesWithMatches?: Set<string>;
  genresWithMatches?: Set<string>;
  onGenreDropdownClose?: () => void;
  setTunerHints: (hints: TunerHints) => void;
}

export interface TunerHints {
  cityResultCount?: number;
  genreResultCount?: number;
  citiesWithMatches?: Set<string>;
  genresWithMatches?: Set<string>;
  onGenreDropdownClose?: () => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function useFilterContext() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilterContext must be used within a FilterProvider');
  return ctx;
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const [selectedCity, setSelectedCity] = useState<string>(getDefaultCity());
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [tunerHints, setTunerHints] = useState<TunerHints>({});

  // Load city/genre preferences: Firebase for auth users, localStorage for unauth
  useEffect(() => {
    if (user?.uid && db) {
      const userRef = doc(db, 'users', user.uid);
      getDoc(userRef).then((snapshot) => {
        const data = snapshot.data();
        setSelectedCity(data?.irlCity || getDefaultCity());
        const genres = data?.preferredGenres;
        if (Array.isArray(genres)) {
          setSelectedGenres(genres);
        } else if (data?.preferredGenre) {
          setSelectedGenres([data.preferredGenre]);
        } else {
          setSelectedGenres([]);
        }
      });
      return;
    }

    try {
      const localCity = localStorage.getItem('channel-selected-city');
      setSelectedCity(localCity || getDefaultCity());
    } catch {
      setSelectedCity(getDefaultCity());
    }
    try {
      const stored = localStorage.getItem('channel-selected-genres');
      if (stored) {
        setSelectedGenres(JSON.parse(stored));
      } else {
        const localGenre = localStorage.getItem('channel-selected-genre');
        if (localGenre) setSelectedGenres([localGenre]);
      }
    } catch {}
  }, [user?.uid]);

  // Migrate localStorage preferences to Firestore when user signs up/in
  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (user?.uid && prevUserRef.current === null && db) {
      try {
        const storedGenres = localStorage.getItem('channel-selected-genres');
        const storedCity = localStorage.getItem('channel-selected-city');
        const storedGenreLegacy = localStorage.getItem('channel-selected-genre');

        if (storedGenres || storedCity || storedGenreLegacy) {
          const userDocRef = doc(db, 'users', user.uid);
          getDoc(userDocRef).then((snap) => {
            const data = snap.data();
            const update: Record<string, unknown> = {};

            if (!data?.preferredGenres || data.preferredGenres.length === 0) {
              if (storedGenres) {
                const genres = JSON.parse(storedGenres);
                if (Array.isArray(genres) && genres.length > 0) {
                  update.preferredGenres = genres;
                }
              } else if (storedGenreLegacy) {
                update.preferredGenres = [storedGenreLegacy];
              }
            }

            if (!data?.irlCity && storedCity && storedCity !== 'Anywhere') {
              update.irlCity = storedCity;
            }

            if (Object.keys(update).length > 0) {
              updateDoc(userDocRef, update).then(() => {
                localStorage.removeItem('channel-selected-genres');
                localStorage.removeItem('channel-selected-city');
                localStorage.removeItem('channel-selected-genre');
              }).catch(console.error);
            }
          }).catch(console.error);
        }
      } catch (e) {
        console.error('Preference migration error:', e);
      }
    }
    prevUserRef.current = user?.uid ?? null;
  }, [user?.uid]);

  const handleCityChange = useCallback(async (city: string) => {
    setSelectedCity(city);
    if (user?.uid && db) {
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { irlCity: city });
      } catch (error) {
        console.error('Error saving city preference:', error);
      }
    } else {
      try { localStorage.setItem('channel-selected-city', city); } catch {}
    }
  }, [user?.uid]);

  const handleGenresChange = useCallback(async (genres: string[]) => {
    setSelectedGenres(genres);
    if (user?.uid && db) {
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { preferredGenres: genres });
      } catch (error) {
        console.error('Error saving genre preferences:', error);
      }
    } else {
      try { localStorage.setItem('channel-selected-genres', JSON.stringify(genres)); } catch {}
    }
  }, [user?.uid]);

  return (
    <FilterContext.Provider value={{
      selectedCity,
      setSelectedCity,
      selectedGenres,
      setSelectedGenres,
      handleCityChange,
      handleGenresChange,
      cityResultCount: tunerHints.cityResultCount,
      genreResultCount: tunerHints.genreResultCount,
      citiesWithMatches: tunerHints.citiesWithMatches,
      genresWithMatches: tunerHints.genresWithMatches,
      onGenreDropdownClose: tunerHints.onGenreDropdownClose,
      setTunerHints,
    }}>
      {children}
    </FilterContext.Provider>
  );
}
