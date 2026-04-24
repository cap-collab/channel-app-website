'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { getDefaultCity } from '@/lib/city-detection';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Scene slugs accepted via the `?scene=` URL param (shareable filter links).
// Kept in sync with SceneGlyph's rendered slugs and Firestore scene doc IDs.
const URL_SCENE_SLUGS = new Set(['spiral', 'star', 'grid']);

// Coerce legacy scene slugs in persisted prefs.
// The diamond→star rename landed 2026-04-24; localStorage for unauth users may still hold 'diamond'.
const LEGACY_SCENE_SLUG_MAP: Record<string, string> = { diamond: 'star' };
function migrateSceneSlugs(ids: string[]): string[] {
  return ids.map((id) => LEGACY_SCENE_SLUG_MAP[id] ?? id);
}

// Reads `?scene=` (or bare `?spiral` / `?star` / `?grid`) and pushes the
// override into FilterProvider state. Isolated so we can wrap it in <Suspense>
// — useSearchParams() otherwise opts every page using <FilterProvider> out of
// static prerendering.
function URLSceneSync({
  onScene,
  onRegisterClear,
}: {
  onScene: (scene: string | null) => void;
  onRegisterClear: (fn: () => void) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  let override: string | null = null;
  const scene = searchParams?.get('scene') ?? null;
  if (scene && URL_SCENE_SLUGS.has(scene)) {
    override = scene;
  } else if (searchParams) {
    URL_SCENE_SLUGS.forEach((slug) => {
      if (!override && searchParams.has(slug)) override = slug;
    });
  }
  useEffect(() => {
    onScene(override);
  }, [override, onScene]);
  // Expose a "strip scene params from the URL" callback to the provider so
  // a manual chip toggle on /radio?star cleans the URL back to /radio.
  useEffect(() => {
    onRegisterClear(() => {
      if (!searchParams) return;
      const next = new URLSearchParams(searchParams.toString());
      let changed = false;
      if (next.has('scene')) { next.delete('scene'); changed = true; }
      URL_SCENE_SLUGS.forEach((slug) => {
        if (next.has(slug)) { next.delete(slug); changed = true; }
      });
      if (!changed) return;
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }, [searchParams, router, pathname, onRegisterClear]);
  return null;
}

interface FilterContextValue {
  selectedCity: string;
  setSelectedCity: (city: string) => void;
  selectedGenres: string[];
  setSelectedGenres: (genres: string[]) => void;
  handleCityChange: (city: string) => void;
  handleGenresChange: (genres: string[]) => void;
  // Scene filter (Past shows grid on /radio).
  // `null` means "not yet initialized" — consumers should treat this as "all scenes"
  // until scenes are loaded and the chip row seeds the set.
  selectedSceneIds: string[] | null;
  handleSceneIdsChange: (ids: string[]) => void;
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
  // `?scene=spiral` (or star/grid) activates a session-only scene filter.
  // URLSceneSync (below, Suspense-wrapped) writes the validated override here
  // so FilterProvider itself stays free of useSearchParams() — otherwise every
  // page under <Providers> would be forced out of static prerendering.
  const [urlSceneOverride, setUrlSceneOverride] = useState<string | null>(null);
  const hasUrlSceneOverride = urlSceneOverride !== null;
  // Ref mirror of hasUrlSceneOverride so the async Firestore callback below
  // sees the latest value — otherwise an in-flight getDoc() that started
  // before the override arrived can stomp it with the user's saved prefs.
  const hasUrlSceneOverrideRef = useRef(false);
  useEffect(() => { hasUrlSceneOverrideRef.current = hasUrlSceneOverride; }, [hasUrlSceneOverride]);
  // Registered by URLSceneSync; strips scene params from the current URL.
  const clearUrlSceneRef = useRef<() => void>(() => {});
  const registerClearUrlScene = useCallback((fn: () => void) => {
    clearUrlSceneRef.current = fn;
  }, []);

  const [selectedCity, setSelectedCity] = useState<string>(getDefaultCity());
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[] | null>(null);
  const [tunerHints, setTunerHints] = useState<TunerHints>({});

  // When the URL override arrives (client-side, post-mount), apply it.
  useEffect(() => {
    if (urlSceneOverride) setSelectedSceneIds([urlSceneOverride]);
  }, [urlSceneOverride]);

  // Load city/genre/scene preferences: Firebase for auth users, localStorage for unauth.
  // When a URL scene override is active, we skip loading persisted scene prefs
  // so the shared link wins for this session.
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
        // Re-check the ref here: the async fetch may resolve after the URL
        // override lands, so we mustn't stomp it with saved prefs.
        // Empty arrays count as "no preference" — we always default to
        // all-selected on load.
        if (!hasUrlSceneOverrideRef.current) {
          const sceneIds = data?.preferredSceneIds;
          if (Array.isArray(sceneIds) && sceneIds.length > 0) {
            setSelectedSceneIds(migrateSceneSlugs(sceneIds));
          } else {
            setSelectedSceneIds(null);
          }
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
    if (!hasUrlSceneOverrideRef.current) {
      try {
        const storedScenes = localStorage.getItem('channel-selected-scenes');
        if (storedScenes) {
          const parsed = JSON.parse(storedScenes);
          // Empty arrays count as "no preference" — fall back to all-selected.
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSelectedSceneIds(migrateSceneSlugs(parsed));
          }
        }
      } catch {}
    }
  }, [user?.uid]);

  // Migrate localStorage preferences to Firestore when user signs up/in
  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (user?.uid && prevUserRef.current === null && db) {
      try {
        const storedGenres = localStorage.getItem('channel-selected-genres');
        const storedCity = localStorage.getItem('channel-selected-city');
        const storedGenreLegacy = localStorage.getItem('channel-selected-genre');
        const storedScenes = localStorage.getItem('channel-selected-scenes');

        if (storedGenres || storedCity || storedGenreLegacy || storedScenes) {
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

            if (!Array.isArray(data?.preferredSceneIds) && storedScenes) {
              try {
                const parsed = JSON.parse(storedScenes);
                if (Array.isArray(parsed)) update.preferredSceneIds = migrateSceneSlugs(parsed);
              } catch {}
            }

            if (Object.keys(update).length > 0) {
              updateDoc(userDocRef, update).then(() => {
                localStorage.removeItem('channel-selected-genres');
                localStorage.removeItem('channel-selected-city');
                localStorage.removeItem('channel-selected-genre');
                localStorage.removeItem('channel-selected-scenes');
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

  const handleSceneIdsChange = useCallback(async (sceneIds: string[]) => {
    setSelectedSceneIds(sceneIds);
    // Manual toggle exits the "shared link" session: strip the scene param
    // from the URL and resume normal persistence going forward.
    if (hasUrlSceneOverride) {
      clearUrlSceneRef.current();
      setUrlSceneOverride(null);
    }
    if (user?.uid && db) {
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { preferredSceneIds: sceneIds });
      } catch (error) {
        console.error('Error saving scene preferences:', error);
      }
    } else {
      try { localStorage.setItem('channel-selected-scenes', JSON.stringify(sceneIds)); } catch {}
    }
  }, [user?.uid, hasUrlSceneOverride]);

  return (
    <FilterContext.Provider value={{
      selectedCity,
      setSelectedCity,
      selectedGenres,
      setSelectedGenres,
      selectedSceneIds,
      handleSceneIdsChange,
      handleCityChange,
      handleGenresChange,
      cityResultCount: tunerHints.cityResultCount,
      genreResultCount: tunerHints.genreResultCount,
      citiesWithMatches: tunerHints.citiesWithMatches,
      genresWithMatches: tunerHints.genresWithMatches,
      onGenreDropdownClose: tunerHints.onGenreDropdownClose,
      setTunerHints,
    }}>
      <Suspense fallback={null}>
        <URLSceneSync onScene={setUrlSceneOverride} onRegisterClear={registerClearUrlScene} />
      </Suspense>
      {children}
    </FilterContext.Provider>
  );
}
