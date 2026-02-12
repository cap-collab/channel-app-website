'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SUPPORTED_CITIES } from '@/lib/city-detection';
import { SUPPORTED_GENRES } from '@/lib/genres';

interface TunerProps {
  selectedCity: string;
  onCityChange: (city: string) => void;
  selectedGenres: string[];
  onGenresChange: (genres: string[]) => void;
  cityResultCount?: number;
  genreResultCount?: number;
  onGenreDropdownClose?: () => void;
  citiesWithMatches?: Set<string>;
  genresWithMatches?: Set<string>;
}

export function Tuner({ selectedCity, onCityChange, selectedGenres, onGenresChange, cityResultCount, genreResultCount, onGenreDropdownClose, citiesWithMatches, genresWithMatches }: TunerProps) {
  // City dropdown state
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cityCustomMode, setCityCustomMode] = useState(false);
  const [cityCustomInput, setCityCustomInput] = useState('');
  const cityInputRef = useRef<HTMLInputElement>(null);
  const cityButtonRef = useRef<HTMLButtonElement>(null);

  // Genre dropdown state
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const [genreCustomMode, setGenreCustomMode] = useState(false);
  const [genreCustomInput, setGenreCustomInput] = useState('');
  const genreInputRef = useRef<HTMLInputElement>(null);
  const genreButtonRef = useRef<HTMLButtonElement>(null);

  // Focus inputs when entering custom mode
  useEffect(() => {
    if (cityCustomMode && cityInputRef.current) cityInputRef.current.focus();
  }, [cityCustomMode]);

  useEffect(() => {
    if (genreCustomMode && genreInputRef.current) genreInputRef.current.focus();
  }, [genreCustomMode]);

  // Escape key to close dropdowns
  useEffect(() => {
    if (!cityDropdownOpen && !genreDropdownOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCityDropdown();
        closeGenreDropdown();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cityDropdownOpen, genreDropdownOpen]);

  // Listen for 'closetuner' events from other components (e.g. MobileMenu)
  useEffect(() => {
    const handleCloseTuner = () => {
      closeCityDropdown();
      closeGenreDropdown();
    };
    document.addEventListener('closetuner', handleCloseTuner);
    return () => document.removeEventListener('closetuner', handleCloseTuner);
  }, []);

  const handleSelectCity = (city: string) => {
    onCityChange(city);
    setCityDropdownOpen(false);
    setCityCustomMode(false);
    setCityCustomInput('');
  };

  const handleCityCustomSubmit = () => {
    const trimmed = cityCustomInput.trim();
    if (trimmed) handleSelectCity(trimmed);
  };

  const handleToggleGenre = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      onGenresChange(selectedGenres.filter((g) => g !== genre));
    } else {
      onGenresChange([...selectedGenres, genre]);
    }
  };

  const handleGenreCustomSubmit = () => {
    const trimmed = genreCustomInput.trim();
    if (trimmed && !selectedGenres.includes(trimmed)) {
      onGenresChange([...selectedGenres, trimmed]);
    }
    setGenreCustomMode(false);
    setGenreCustomInput('');
  };

  const closeCityDropdown = () => {
    setCityDropdownOpen(false);
    setCityCustomMode(false);
    setCityCustomInput('');
  };

  const closeGenreDropdown = () => {
    setGenreDropdownOpen(false);
    setGenreCustomMode(false);
    setGenreCustomInput('');
    onGenreDropdownClose?.();
  };

  const genreLabel = selectedGenres.length === 0
    ? 'Genre'
    : selectedGenres.length === 1
      ? selectedGenres[0]
      : `${selectedGenres[0]} +${selectedGenres.length - 1}`;

  return (
    <div className="z-[90] bg-black/90 backdrop-blur-sm border-b border-white/5">
      <div className="flex items-center h-8">
        {/* City selector - left column */}
        <div className="relative flex-1 flex justify-center">
          <button
            ref={cityButtonRef}
            onClick={() => {
              if (!cityDropdownOpen) document.dispatchEvent(new CustomEvent('closemenu'));
              setCityDropdownOpen(!cityDropdownOpen);
              closeGenreDropdown();
            }}
            className={`h-6 px-2.5 font-mono text-[11px] uppercase tracking-tight flex items-center gap-1 transition-colors rounded-sm bg-white/5 hover:bg-white/10 ${cityResultCount === 0 ? 'text-zinc-600' : 'text-zinc-400 hover:text-white'}`}
          >
            <span className="truncate max-w-[120px]">{selectedCity || 'City'}</span>
            {cityResultCount === 0 && <span className="text-zinc-600 text-[9px]">(0)</span>}
            <svg
              className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${cityDropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {cityDropdownOpen && createPortal(
            <>
              <div className="fixed inset-0 z-[999]" onClick={closeCityDropdown} />
              <div
                className="fixed w-48 bg-[#111] border border-white/10 rounded shadow-xl z-[1000] py-1 max-h-72 overflow-y-auto"
                style={{
                  top: (cityButtonRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                  left: (cityButtonRef.current?.getBoundingClientRect().left ?? 0) + (cityButtonRef.current?.getBoundingClientRect().width ?? 0) / 2 - 96,
                }}
              >
                {cityCustomMode ? (
                  <div className="px-2 py-1">
                    <div className="flex gap-1">
                      <input
                        ref={cityInputRef}
                        type="text"
                        value={cityCustomInput}
                        onChange={(e) => setCityCustomInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCityCustomSubmit();
                          else if (e.key === 'Escape') {
                            setCityCustomMode(false);
                            setCityCustomInput('');
                          }
                        }}
                        placeholder="Enter city..."
                        className="flex-1 bg-black border border-white/20 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-white/40 focus:outline-none font-mono"
                      />
                      <button
                        onClick={handleCityCustomSubmit}
                        disabled={!cityCustomInput.trim()}
                        className="px-2 py-1 bg-white text-black rounded text-sm font-medium disabled:opacity-50"
                      >
                        Go
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setCityCustomMode(true)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2 font-mono"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Type your city...
                  </button>
                )}
                <div className="border-t border-white/10 my-1" />
                <button
                  onClick={() => handleSelectCity('Anywhere')}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono ${
                    selectedCity === 'Anywhere'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  Anywhere
                </button>
                <div className="border-t border-white/10 my-1" />
                {SUPPORTED_CITIES.filter((city) =>
                  !citiesWithMatches || citiesWithMatches.has(city) || selectedCity === city
                ).map((city) => (
                  <button
                    key={city}
                    onClick={() => handleSelectCity(city)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono ${
                      selectedCity === city
                        ? 'bg-white/10 text-white'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>

        {/* Genre selector - right column */}
        <div className="relative flex-1 flex justify-center">
          <button
            ref={genreButtonRef}
            onClick={() => {
              if (genreDropdownOpen) {
                closeGenreDropdown();
              } else {
                document.dispatchEvent(new CustomEvent('closemenu'));
                setGenreDropdownOpen(true);
                closeCityDropdown();
              }
            }}
            className={`h-6 px-2.5 font-mono text-[11px] uppercase tracking-tight flex items-center gap-1 transition-colors rounded-sm bg-white/5 hover:bg-white/10 ${genreResultCount === 0 ? 'text-zinc-600' : 'text-zinc-400 hover:text-white'}`}
          >
            <span className="truncate max-w-[120px]">{genreLabel}</span>
            {genreResultCount === 0 && <span className="text-zinc-600 text-[9px]">(0)</span>}
            <svg
              className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${genreDropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {genreDropdownOpen && createPortal(
            <>
              <div className="fixed inset-0 z-[999]" onClick={closeGenreDropdown} />
              <div
                className="fixed w-48 bg-[#111] border border-white/10 rounded shadow-xl z-[1000] py-1 max-h-72 overflow-y-auto"
                style={{
                  top: (genreButtonRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                  left: (genreButtonRef.current?.getBoundingClientRect().left ?? 0) + (genreButtonRef.current?.getBoundingClientRect().width ?? 0) / 2 - 96,
                }}
              >
                {genreCustomMode ? (
                  <div className="px-2 py-1">
                    <div className="flex gap-1">
                      <input
                        ref={genreInputRef}
                        type="text"
                        value={genreCustomInput}
                        onChange={(e) => setGenreCustomInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleGenreCustomSubmit();
                          else if (e.key === 'Escape') {
                            setGenreCustomMode(false);
                            setGenreCustomInput('');
                          }
                        }}
                        placeholder="Enter genre..."
                        className="flex-1 bg-black border border-white/20 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-white/40 focus:outline-none font-mono"
                      />
                      <button
                        onClick={handleGenreCustomSubmit}
                        disabled={!genreCustomInput.trim()}
                        className="px-2 py-1 bg-white text-black rounded text-sm font-medium disabled:opacity-50"
                      >
                        Go
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setGenreCustomMode(true)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2 font-mono"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Type your genre...
                  </button>
                )}
                <div className="border-t border-white/10 my-1" />
                {selectedGenres.length > 0 && (
                  <>
                    <button
                      onClick={() => onGenresChange([])}
                      className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white transition-colors font-mono"
                    >
                      Clear all
                    </button>
                    <div className="border-t border-white/10 my-1" />
                  </>
                )}
                {SUPPORTED_GENRES.filter((genre) =>
                  !genresWithMatches || genresWithMatches.has(genre) || selectedGenres.includes(genre)
                ).map((genre) => {
                  const isSelected = selectedGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      onClick={() => handleToggleGenre(genre)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono flex items-center justify-between ${
                        isSelected
                          ? 'bg-white/10 text-white'
                          : 'text-gray-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {genre}
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
}
