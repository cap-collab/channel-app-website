'use client';

import { useState, useEffect, useRef } from 'react';
import { SUPPORTED_CITIES } from '@/lib/city-detection';
import { SUPPORTED_GENRES } from '@/lib/genres';

interface TunerProps {
  selectedCity: string;
  onCityChange: (city: string) => void;
  selectedGenre: string;
  onGenreChange: (genre: string) => void;
}

export function Tuner({ selectedCity, onCityChange, selectedGenre, onGenreChange }: TunerProps) {
  // City dropdown state
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cityCustomMode, setCityCustomMode] = useState(false);
  const [cityCustomInput, setCityCustomInput] = useState('');
  const cityInputRef = useRef<HTMLInputElement>(null);

  // Genre dropdown state
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const [genreCustomMode, setGenreCustomMode] = useState(false);
  const [genreCustomInput, setGenreCustomInput] = useState('');
  const genreInputRef = useRef<HTMLInputElement>(null);

  // Focus inputs when entering custom mode
  useEffect(() => {
    if (cityCustomMode && cityInputRef.current) cityInputRef.current.focus();
  }, [cityCustomMode]);

  useEffect(() => {
    if (genreCustomMode && genreInputRef.current) genreInputRef.current.focus();
  }, [genreCustomMode]);

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

  const handleSelectGenre = (genre: string) => {
    onGenreChange(genre);
    setGenreDropdownOpen(false);
    setGenreCustomMode(false);
    setGenreCustomInput('');
  };

  const handleGenreCustomSubmit = () => {
    const trimmed = genreCustomInput.trim();
    if (trimmed) handleSelectGenre(trimmed);
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
  };

  return (
    <div className="sticky top-[48px] z-[90] bg-black/90 backdrop-blur-sm border-b border-white/5">
      <div className="flex items-center justify-center gap-2 h-8 px-3">
        {/* City selector */}
        <div className="relative">
          <button
            onClick={() => {
              setCityDropdownOpen(!cityDropdownOpen);
              closeGenreDropdown();
            }}
            className="h-6 px-2.5 font-mono text-[11px] text-zinc-400 uppercase tracking-tight flex items-center gap-1 hover:text-white transition-colors rounded-sm bg-white/5 hover:bg-white/10"
          >
            <span className="truncate max-w-[120px]">{selectedCity || 'City'}</span>
            <svg
              className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${cityDropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {cityDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={closeCityDropdown} />
              <div className="absolute left-0 mt-1 w-48 bg-[#111] border border-white/10 rounded shadow-xl z-20 py-1 max-h-72 overflow-y-auto">
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
                {SUPPORTED_CITIES.map((city) => (
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
            </>
          )}
        </div>

        {/* Genre selector */}
        <div className="relative">
          <button
            onClick={() => {
              setGenreDropdownOpen(!genreDropdownOpen);
              closeCityDropdown();
            }}
            className="h-6 px-2.5 font-mono text-[11px] text-zinc-400 uppercase tracking-tight flex items-center gap-1 hover:text-white transition-colors rounded-sm bg-white/5 hover:bg-white/10"
          >
            <span className="truncate max-w-[120px]">{selectedGenre || 'Genre'}</span>
            <svg
              className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${genreDropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {genreDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={closeGenreDropdown} />
              <div className="absolute right-0 mt-1 w-48 bg-[#111] border border-white/10 rounded shadow-xl z-20 py-1 max-h-72 overflow-y-auto">
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
                {SUPPORTED_GENRES.map((genre) => (
                  <button
                    key={genre}
                    onClick={() => handleSelectGenre(genre)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono ${
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
    </div>
  );
}
