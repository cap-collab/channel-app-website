'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { Header } from '@/components/Header';
import { HeaderSearch } from '@/components/HeaderSearch';
import { Tuner } from '@/components/channel/Tuner';
import { SwipeableCardCarousel } from '@/components/channel/SwipeableCardCarousel';
import { TicketCard } from '@/components/channel/TicketCard';
import { LiveShowCard } from '@/components/channel/LiveShowCard';
import { IRLShowCard } from '@/components/channel/IRLShowCard';
import { CuratorRecCard } from '@/components/channel/CuratorRecCard';
import { InviteCard } from '@/components/channel/InviteCard';
import { SkeletonCard } from '@/components/channel/SkeletonCard';
import { AuthModal } from '@/components/AuthModal';
import { GenreAlertPrompt } from '@/components/channel/GenreAlertPrompt';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { Show, Station, IRLShowData, CuratorRec, DJProfile } from '@/types';
import { DJProfileCard } from '@/components/channel/DJProfileCard';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useBPM } from '@/contexts/BPMContext';
import { useFavorites } from '@/hooks/useFavorites';
import { getDefaultCity, matchesCity, SUPPORTED_CITIES } from '@/lib/city-detection';
import { GENRE_ALIASES, SUPPORTED_GENRES, matchesGenre as matchesGenreLib } from '@/lib/genres';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type MatchedItem =
  | { type: 'irl'; data: IRLShowData; matchLabel: string | undefined }
  | { type: 'radio'; data: Show; station: Station; matchLabel: string | undefined; live?: boolean }
  | { type: 'profile'; data: DJProfile; matchLabel: string | undefined };

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { isLive: isBroadcastLive } = useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { favorites, isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const { shows: scheduleShows, irlShows: scheduleIrlShows, curatorRecs: scheduleCuratorRecs, djProfiles: scheduleDjProfiles, loading: scheduleLoading } = useSchedule();
  const router = useRouter();

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);

  // Track whether user has seen curator recs before (move to bottom after first view)
  const [hasSeenCuratorRecs, setHasSeenCuratorRecs] = useState(false);

  // Read localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    try {
      if (localStorage.getItem('channel-seen-curator-recs') === '1') {
        setHasSeenCuratorRecs(true);
      }
    } catch {}
  }, []);

  // All shows data (from shared ScheduleContext)
  const allShows = scheduleShows;
  const irlShows = scheduleIrlShows;
  const curatorRecs = scheduleCuratorRecs;
  const djProfiles = scheduleDjProfiles;
  const isLoading = scheduleLoading;

  // Selected city and genres
  const [selectedCity, setSelectedCity] = useState<string>(getDefaultCity());
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  // Genre alert prompt state (for logged-out users)
  const [showGenreAlertPrompt, setShowGenreAlertPrompt] = useState(false);
  const genreAlertShownRef = useRef(false);

  // Notify email form state
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleNotifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyEmail.trim()) return;
    try {
      setNotifyStatus('submitting');
      const res = await fetch('/api/radio-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: notifyEmail.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setNotifyStatus('success');
      setNotifyEmail('');
    } catch {
      setNotifyStatus('error');
    }
  };

  // Follow/remind state
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

  // Load city/genre preferences: Firebase (one-time read) for auth users, localStorage for unauth
  useEffect(() => {
    if (user?.uid && db) {
      const userRef = doc(db, 'users', user.uid);
      getDoc(userRef).then((snapshot) => {
        const data = snapshot.data();
        setSelectedCity(data?.irlCity || getDefaultCity());
        // Support both old string and new array format
        const genres = data?.preferredGenres;
        if (Array.isArray(genres)) {
          setSelectedGenres(genres);
        } else if (data?.preferredGenre) {
          setSelectedGenres([data.preferredGenre]);
        } else {
          setSelectedGenres(['House']);
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
        // Migrate old single genre
        const localGenre = localStorage.getItem('channel-selected-genre');
        if (localGenre) setSelectedGenres([localGenre]);
      }
    } catch {
      // localStorage not available
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

        if (storedGenres || storedCity || storedGenreLegacy) {
          const userDocRef = doc(db, 'users', user.uid);
          getDoc(userDocRef).then((snap) => {
            const data = snap.data();
            const update: Record<string, unknown> = {};

            // Only write genres if the user doesn't already have them in Firestore
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

            // Only write city if the user doesn't already have one
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
    router.refresh();
  }, [user?.uid, router]);

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
    router.refresh();
  }, [user?.uid, router]);

  // Stations map for quick lookup
  const stationsMap = useMemo(() => {
    const map = new Map<string, Station>();
    for (const station of STATIONS) {
      map.set(station.id, station);
    }
    return map;
  }, []);

  // Helper: check if a show matches a single genre (with aliases)
  const matchesGenre = useCallback((showGenres: string[] | undefined, genre: string): boolean => {
    if (!showGenres || showGenres.length === 0 || !genre) return false;
    const genreLower = genre.toLowerCase();
    const aliases = GENRE_ALIASES[genreLower] || [];
    const allTerms = [genreLower, ...aliases];
    for (const [canonical, aliasList] of Object.entries(GENRE_ALIASES)) {
      if (aliasList.includes(genreLower)) {
        allTerms.push(canonical, ...aliasList);
        break;
      }
    }
    return showGenres.some((g) => {
      const gLower = g.toLowerCase();
      return allTerms.some((term) => gLower.includes(term) || term.includes(gLower));
    });
  }, []);

  // Helper: return which of the selected genres match a show's genres
  const getMatchingGenres = useCallback((showGenres: string[] | undefined): string[] => {
    if (selectedGenres.length === 0 || !showGenres || showGenres.length === 0) return [];
    return selectedGenres.filter((genre) => matchesGenre(showGenres, genre));
  }, [selectedGenres, matchesGenre]);

  // Helper: check if a show matches any of the selected genres
  const matchesAnyGenre = useCallback((showGenres: string[] | undefined): boolean => {
    return getMatchingGenres(showGenres).length > 0;
  }, [getMatchingGenres]);

  // Helper: build a genre label from only the genres that match a specific show
  const genreLabelFor = useCallback((showGenres: string[] | undefined): string => {
    const matching = getMatchingGenres(showGenres);
    if (matching.length === 0) return '';
    return matching.map((g) => g.toUpperCase()).join(' + ');
  }, [getMatchingGenres]);

  // Helper: check if a show is currently live
  const isShowLive = useCallback((show: Show): boolean => {
    const now = new Date();
    return new Date(show.startTime) <= now && new Date(show.endTime) > now;
  }, []);

  // Helper: valid show for display
  const isValidShow = useCallback((show: Show): boolean => {
    const hasPhoto = show.djPhotoUrl || show.imageUrl;
    const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
    return !!(show.dj && (show.djUsername || show.djUserId) && hasPhoto && !isRestreamOrPlaylist);
  }, []);

  // Followed DJ names for curator recs filtering
  const followedDJNames = useMemo(() =>
    favorites.filter((f) => f.type === 'search').map((f) => f.term.toLowerCase()),
    [favorites]
  );

  // Compute all sections with deduplication
  const {
    favoritesNowLive,
    locationGenreCards,
    filteredCuratorRecs,
    genreCards,
    locationCards,
    radioCards,
  } = useMemo(() => {
    const isAnywhere = !selectedCity || selectedCity === 'Anywhere';
    const hasGenreFilter = selectedGenres.length > 0;
    const now = new Date();
    const seenShowIds = new Set<string>();
    const seenDJs = new Set<string>();

    const tryAddShow = (id: string, djName: string | undefined): boolean => {
      const djKey = djName?.toLowerCase();
      if (seenShowIds.has(id)) return false;
      if (djKey && seenDJs.has(djKey)) return false;
      seenShowIds.add(id);
      if (djKey) seenDJs.add(djKey);
      return true;
    };

    // Helper to create a MatchedItem from a radio show
    const makeRadioItem = (show: Show, matchLabel: string | undefined, live?: boolean): MatchedItem | null => {
      const station = stationsMap.get(show.stationId);
      if (!station) return null;
      return { type: 'radio', data: show, station, matchLabel, live };
    };

    // Helper to create a MatchedItem from an IRL show
    const makeIRLItem = (show: IRLShowData, matchLabel: string | undefined): MatchedItem => {
      return { type: 'irl', data: show, matchLabel };
    };

    // Helper: get genre match count for sorting (more matches = higher priority)
    const genreMatchCount = (genres: string[] | undefined): number => getMatchingGenres(genres).length;

    // Sort groups: live show (0) > IRL event (1) > DJ profile (2) > upcoming radio show (3)
    type Candidate = { item: MatchedItem; id: string; djName: string | undefined; matchCount: number; startMs: number; sortGroup: number; isChannelUser?: boolean };
    const takeSorted = (candidates: Candidate[], max: number): MatchedItem[] => {
      candidates.sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        // Sort group: live > IRL > profile > upcoming
        if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup;
        // Then sooner shows first
        if (a.startMs !== b.startMs) return a.startMs - b.startMs;
        // Then Channel users first
        if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
        return 0;
      });
      const result: MatchedItem[] = [];
      for (const c of candidates) {
        if (result.length >= max) break;
        if (!tryAddShow(c.id, c.djName)) continue;
        result.push(c.item);
      }
      return result;
    };

    // Section 0: Favorites — followed DJs / favorited shows in next 2 weeks, sorted: live now → soonest first
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const twoWeeksDateStr = twoWeeksFromNow.toLocaleDateString('en-CA'); // YYYY-MM-DD
    // IRL shows in the scene section: only today, tomorrow, or day after tomorrow
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sceneCutoffDateStr = threeDaysFromNow.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const s0Candidates: { item: MatchedItem; id: string; djName: string | undefined; startMs: number; live: boolean }[] = [];
    // Radio shows from followed DJs / favorited shows in next 2 weeks
    for (const show of allShows) {
      if (!isValidShow(show)) continue;
      const station = stationsMap.get(show.stationId);
      if (!station) continue;
      const endTime = new Date(show.endTime);
      const startTime = new Date(show.startTime);
      if (endTime <= now || startTime > twoWeeksFromNow) continue;
      const djFollowed = (show.dj && isInWatchlist(show.dj)) || (show.djUsername && isInWatchlist(show.djUsername));
      const showFaved = isShowFavorited(show);
      if (djFollowed || showFaved) {
        if (tryAddShow(show.id, show.dj)) {
          const live = startTime <= now && endTime > now;
          const item = makeRadioItem(show, undefined, live || undefined);
          if (item) s0Candidates.push({ item, id: show.id, djName: show.dj, startMs: startTime.getTime(), live });
        }
      }
    }
    // IRL shows from followed DJs in next 7 days
    for (const show of irlShows) {
      if (show.date > twoWeeksDateStr) continue;
      const djFollowed = isInWatchlist(show.djName) || isInWatchlist(show.djUsername);
      if (!djFollowed) continue;
      const id = `irl-${show.djUsername}-${show.date}`;
      if (tryAddShow(id, show.djName)) {
        s0Candidates.push({ item: makeIRLItem(show, undefined), id, djName: show.djName, startMs: new Date(show.date + 'T00:00:00').getTime(), live: false });
      }
    }
    // Sort: live first, then soonest first
    s0Candidates.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.startMs - b.startMs;
    });
    const s0: MatchedItem[] = s0Candidates.map(c => c.item);

    // Section 1: Location + Genre (grid, max 4) — sorted by match count > sortGroup > time > isChannelUser
    // Only show when a specific city is selected (not "Anywhere")
    let s1: MatchedItem[] = [];
    if (hasGenreFilter && !isAnywhere) {
      const candidates: Candidate[] = [];
      // IRL shows (always from Channel users) — city + genre match, within 3 days
      for (const show of irlShows) {
        if (show.date >= sceneCutoffDateStr) continue;
        if (!matchesCity(show.location, selectedCity)) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        const genreLabel = genreLabelFor(show.djGenres);
        const label = `${selectedCity.toUpperCase()} + ${genreLabel}`;
        candidates.push({ item: makeIRLItem(show, label), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
      }
      // Radio shows (live and upcoming)
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        const cityMatch = show.djLocation ? matchesCity(show.djLocation, selectedCity) : false;
        if (!cityMatch) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const live = isShowLive(show);
        const label = `${selectedCity.toUpperCase()} + ${genreLabelFor(show.djGenres)}`;
        const item = makeRadioItem(show, label, live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      // DJ profiles matching city + genre
      for (const profile of djProfiles) {
        if (!profile.location || !matchesCity(profile.location, selectedCity)) continue;
        if (!matchesAnyGenre(profile.genres)) continue;
        const id = `profile-${profile.username}`;
        const genreLabel = genreLabelFor(profile.genres);
        const label = `${selectedCity.toUpperCase()} + ${genreLabel}`;
        candidates.push({ item: { type: 'profile', data: profile, matchLabel: label }, id, djName: profile.displayName, matchCount: genreMatchCount(profile.genres), startMs: 0, sortGroup: 2, isChannelUser: profile.isChannelUser });
      }
      s1 = takeSorted(candidates, 4);
    }

    // Section 3: Curator recs from followed DJs (grid, max 4)
    const s3: CuratorRec[] = [];
    if (followedDJNames.length > 0) {
      for (const rec of curatorRecs) {
        if (s3.length >= 4) break;
        if (followedDJNames.includes(rec.djUsername.toLowerCase()) ||
            followedDJNames.includes(rec.djName.toLowerCase())) {
          s3.push(rec);
        }
      }
    }

    // Section 4: Genre matching (swipe, max 5) — sorted by match count > sortGroup > time > isChannelUser
    let s4: MatchedItem[] = [];
    if (hasGenreFilter) {
      const candidates: Candidate[] = [];
      // IRL shows — genre match, within 3 days
      for (const show of irlShows) {
        if (show.date >= sceneCutoffDateStr) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        const genreLabel = genreLabelFor(show.djGenres);
        candidates.push({ item: makeIRLItem(show, genreLabel || show.location.toUpperCase()), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
      }
      // Radio shows (live and upcoming)
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const live = isShowLive(show);
        const item = makeRadioItem(show, genreLabelFor(show.djGenres), live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      // DJ profiles matching genre
      for (const profile of djProfiles) {
        if (!matchesAnyGenre(profile.genres)) continue;
        const id = `profile-${profile.username}`;
        const genreLabel = genreLabelFor(profile.genres);
        candidates.push({ item: { type: 'profile', data: profile, matchLabel: genreLabel }, id, djName: profile.displayName, matchCount: genreMatchCount(profile.genres), startMs: 0, sortGroup: 2, isChannelUser: profile.isChannelUser });
      }
      s4 = takeSorted(candidates, 5);
    }

    // Section 6: Location matching (swipe, max 5) — sorted by sortGroup > time > isChannelUser
    let s6: MatchedItem[] = [];
    if (!isAnywhere) {
      const candidates: Candidate[] = [];
      // IRL shows (always from Channel users), within 3 days
      for (const show of irlShows) {
        if (show.date >= sceneCutoffDateStr) continue;
        if (!matchesCity(show.location, selectedCity)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        candidates.push({ item: makeIRLItem(show, selectedCity.toUpperCase()), id, djName: show.djName, matchCount: 0, startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
      }
      // Radio shows
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (!show.djLocation || !matchesCity(show.djLocation, selectedCity)) continue;
        const live = isShowLive(show);
        const item = makeRadioItem(show, selectedCity.toUpperCase(), live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: 0, startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      s6 = takeSorted(candidates, 5);
    }

    // Section 7: Selected by Radio (swipe, max 5) — external station shows, sorted by live > isChannelUser
    const s7Candidates: { item: MatchedItem; id: string; djName: string | undefined; live: boolean; isChannelUser: boolean }[] = [];
    for (const show of allShows) {
      if (!isValidShow(show)) continue;
      if (new Date(show.endTime) <= now) continue;
      if (show.stationId === 'broadcast' || show.stationId === 'dj-radio') continue;
      const station = stationsMap.get(show.stationId);
      if (!station) continue;
      const live = isShowLive(show);
      s7Candidates.push({
        item: { type: 'radio', data: show, station, matchLabel: `SELECTED BY ${station.name.toUpperCase()}`, live: live || undefined },
        id: show.id,
        djName: show.dj,
        live,
        isChannelUser: show.isChannelUser ?? false,
      });
    }
    // Sort: live first, then Channel users first
    s7Candidates.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
      return 0;
    });
    const s7: MatchedItem[] = [];
    for (const c of s7Candidates) {
      if (s7.length >= 5) break;
      if (!tryAddShow(c.id, c.djName)) continue;
      s7.push(c.item);
    }

    return {
      favoritesNowLive: s0,
      locationGenreCards: s1,
      filteredCuratorRecs: s3,
      genreCards: s4,
      locationCards: s6,
      radioCards: s7,
    };
  }, [allShows, irlShows, curatorRecs, djProfiles, selectedCity, selectedGenres, stationsMap, matchesAnyGenre, getMatchingGenres, genreLabelFor, isShowLive, isValidShow, followedDJNames, isInWatchlist, isShowFavorited, user]);

  // Mark curator recs as seen once they render at the top for the first time
  useEffect(() => {
    if (!hasSeenCuratorRecs && filteredCuratorRecs.length > 0) {
      try { localStorage.setItem('channel-seen-curator-recs', '1'); } catch {}
      setHasSeenCuratorRecs(true);
    }
  }, [hasSeenCuratorRecs, filteredCuratorRecs]);

  // Compute result counts for Tuner bar
  const allCardCount = locationGenreCards.length +
    genreCards.length + locationCards.length + radioCards.length;

  const cityResultCount = useMemo(() => {
    if (!selectedCity || selectedCity === 'Anywhere') return undefined;
    return locationGenreCards.length + locationCards.length;
  }, [selectedCity, locationGenreCards, locationCards]);

  const genreResultCount = useMemo(() => {
    if (selectedGenres.length === 0) return undefined;
    return locationGenreCards.length + genreCards.length;
  }, [selectedGenres, locationGenreCards, genreCards]);


  const missingGenres = useMemo(() => {
    if (selectedGenres.length === 0) return [];
    if (locationGenreCards.length === 0 && genreCards.length === 0) return selectedGenres;
    // Check each genre individually — a genre is "missing" if no card across S1/S4 matches it
    const allGenreCards = [...locationGenreCards, ...genreCards];
    return selectedGenres.filter((genre) => {
      return !allGenreCards.some((item) => {
        const showGenres = item.type === 'profile' ? item.data.genres : item.data.djGenres;
        return showGenres ? matchesGenre(showGenres, genre) : false;
      });
    });
  }, [selectedGenres, locationGenreCards, genreCards, matchesGenre]);

  // Compute which cities and genres have at least one matching show (for hiding empty options in dropdown)
  // Mirror the actual section logic: radio shows need isValidShow + not ended + valid station
  const citiesWithMatches = useMemo(() => {
    const now = new Date();
    const set = new Set<string>();
    // Collect all valid locations from displayable shows
    const radioLocations: string[] = [];
    for (const show of allShows) {
      if (!isValidShow(show) || new Date(show.endTime) <= now || !stationsMap.has(show.stationId)) continue;
      if (show.djLocation) radioLocations.push(show.djLocation);
    }
    const irlLocations = irlShows.map((show) => show.location);
    const profileLocations = djProfiles.filter((p) => p.location).map((p) => p.location!);
    const allLocations = [...radioLocations, ...irlLocations, ...profileLocations];
    for (const city of SUPPORTED_CITIES) {
      if (allLocations.some((loc) => matchesCity(loc, city))) {
        set.add(city);
      }
    }
    return set;
  }, [allShows, irlShows, djProfiles, isValidShow, stationsMap]);

  const genresWithMatches = useMemo(() => {
    const now = new Date();
    const set = new Set<string>();
    // Collect all DJ genres from displayable shows (valid + not ended + valid station) and IRL shows
    const allDjGenres: string[][] = [];
    for (const show of allShows) {
      if (!isValidShow(show) || new Date(show.endTime) <= now || !stationsMap.has(show.stationId)) continue;
      if (show.djGenres && show.djGenres.length > 0) {
        allDjGenres.push(show.djGenres);
      }
    }
    for (const show of irlShows) {
      if (show.djGenres && show.djGenres.length > 0) {
        allDjGenres.push(show.djGenres);
      }
    }
    for (const profile of djProfiles) {
      if (profile.genres && profile.genres.length > 0) {
        allDjGenres.push(profile.genres);
      }
    }
    for (const genre of SUPPORTED_GENRES) {
      if (allDjGenres.some((djGenres) => matchesGenreLib(djGenres, genre))) {
        set.add(genre);
      }
    }
    return set;
  }, [allShows, irlShows, djProfiles, isValidShow, stationsMap]);

  // Genre alert prompt handlers
  const handleGenreDropdownClose = useCallback(() => {
    if (!isAuthenticated && selectedGenres.length > 0 && !genreAlertShownRef.current) {
      genreAlertShownRef.current = true;
      setShowGenreAlertPrompt(true);
    }
  }, [isAuthenticated, selectedGenres]);

  const handleGenreAlertSignUp = useCallback(() => {
    setShowGenreAlertPrompt(false);
    setAuthModalMessage('Sign up to receive alerts for shows matching your genre preferences');
    setShowAuthModal(true);
  }, []);

  // Auth handlers
  const handleRemindMe = useCallback((show: Show) => {
    const djName = show.dj || show.name;
    setAuthModalMessage(`Sign in to get notified when ${djName} goes live`);
    setShowAuthModal(true);
  }, []);

  const handleIRLAuthRequired = useCallback((djName: string) => {
    setAuthModalMessage(`Sign in to follow ${djName}`);
    setShowAuthModal(true);
  }, []);

  // Follow/Unfollow for radio shows
  const handleUnifiedFollow = useCallback(async (show: Show) => {
    if (!isAuthenticated) { handleRemindMe(show); return; }
    if (!show.dj) return;
    setAddingFollowDj(show.dj);
    try {
      if (isInWatchlist(show.dj)) {
        await removeFromWatchlist(show.dj);
      } else {
        await followDJ(show.dj, show.djUserId, show.djEmail, show);
      }
    } finally {
      setAddingFollowDj(null);
    }
  }, [isAuthenticated, handleRemindMe, isInWatchlist, removeFromWatchlist, followDJ]);

  // Follow/Unfollow for IRL shows
  const handleUnifiedIRLFollow = useCallback(async (show: IRLShowData) => {
    if (!isAuthenticated) { handleIRLAuthRequired(show.djName); return; }
    if (!show.djName) return;
    setAddingFollowDj(show.djName);
    try {
      if (isInWatchlist(show.djName)) {
        await removeFromWatchlist(show.djName);
      } else {
        await followDJ(show.djName, undefined, undefined, undefined);
      }
    } finally {
      setAddingFollowDj(null);
    }
  }, [isAuthenticated, handleIRLAuthRequired, isInWatchlist, removeFromWatchlist, followDJ]);

  // Remind Me for radio shows
  const handleUnifiedRemindMe = useCallback(async (show: Show) => {
    if (!isAuthenticated) { handleRemindMe(show); return; }
    setAddingReminderShowId(show.id);
    try {
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingReminderShowId(null);
    }
  }, [isAuthenticated, handleRemindMe, isShowFavorited, toggleFavorite]);

  // Render a single matched card (IRL, Radio, or DJ Profile)
  const renderCard = (item: MatchedItem, index: number, profileMode?: boolean) => {
    if (item.type === 'profile') {
      const profile = item.data;
      const following = isInWatchlist(profile.displayName) || isInWatchlist(profile.username);
      const addingFollow = addingFollowDj === profile.displayName;
      return (
        <DJProfileCard
          key={`profile-${profile.username}-${index}`}
          profile={profile}
          isFollowing={following}
          isAddingFollow={addingFollow}
          onFollow={() => handleUnifiedIRLFollow({ djName: profile.displayName, djUsername: profile.username } as IRLShowData)}
          matchLabel={item.matchLabel}
        />
      );
    }
    if (item.type === 'irl') {
      const show = item.data;
      const following = show.djName ? isInWatchlist(show.djName) : false;
      const addingFollow = addingFollowDj === show.djName;
      return (
        <IRLShowCard
          key={`irl-${show.djUsername}-${show.date}-${index}`}
          show={show}
          isFollowing={following}
          isAddingFollow={addingFollow}
          onFollow={() => handleUnifiedIRLFollow(show)}
          matchLabel={item.matchLabel}
          profileMode={profileMode}
        />
      );
    } else {
      const show = item.data;
      const station = item.station;
      const following = show.dj ? isInWatchlist(show.dj) : false;
      const addingFollow = addingFollowDj === show.dj;

      // Use LiveShowCard for live shows (red dot, "Join" button)
      if (item.live) {
        return (
          <LiveShowCard
            key={show.id}
            show={show}
            station={station}
            isFollowing={following}
            isAddingFollow={addingFollow}
            onFollow={() => handleUnifiedFollow(show)}
            matchLabel={item.matchLabel}
            profileMode={profileMode}
            bpm={stationBPM[getMetadataKeyByStationId(show.stationId) || '']?.bpm ?? null}
          />
        );
      }

      const favorited = isShowFavorited(show);
      const addingReminder = addingReminderShowId === show.id;
      return (
        <TicketCard
          key={show.id}
          show={show}
          station={station}
          isAuthenticated={isAuthenticated}
          isFollowing={following}
          isShowFavorited={favorited}
          isAddingFollow={addingFollow}
          isAddingReminder={addingReminder}
          onFollow={() => handleUnifiedFollow(show)}
          onRemindMe={() => handleUnifiedRemindMe(show)}
          matchLabel={item.matchLabel}
          profileMode={profileMode}
        />
      );
    }
  };

  // Prevent SSR hydration mismatches from Date/localStorage differences
  if (!mounted) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      {/* Hero Section — Live Broadcast or Launching Soon */}
      {mounted && isBroadcastLive ? (
        <LiveBroadcastHero />
      ) : (
        <section className="px-4 md:px-8 py-16 md:py-24 text-center relative z-10">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter leading-none mb-4">Channel Radio</h1>
            <p className="text-lg md:text-xl text-zinc-300 mb-3">Launching soon.</p>
            <p className="text-zinc-400 leading-relaxed mb-10 max-w-lg mx-auto">
              We are currently inviting DJs, labels, venues, and collectives from the LA scene to host the first shows.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <div className="w-full sm:w-auto">
                {notifyStatus === 'success' ? (
                  <p className="text-green-400 text-sm py-3">You&apos;re on the list!</p>
                ) : (
                  <form onSubmit={handleNotifySubmit} className="flex">
                    <input
                      type="email"
                      placeholder="get an email when Channel goes live"
                      value={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.value)}
                      required
                      className="bg-white/10 border border-white/20 rounded-l px-4 py-3 text-white placeholder-gray-300 text-sm focus:outline-none focus:border-white/40 min-w-0 flex-1 sm:w-80"
                    />
                    <button
                      type="submit"
                      disabled={notifyStatus === 'submitting'}
                      className="bg-white/20 border border-white/20 border-l-0 rounded-r px-4 py-3 text-white text-sm font-medium hover:bg-white/30 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {notifyStatus === 'submitting' ? '...' : 'Submit'}
                    </button>
                  </form>
                )}
                {notifyStatus === 'error' && (
                  <p className="text-red-400 text-xs mt-1">Something went wrong. Try again.</p>
                )}
              </div>
              <Link
                href="/studio/join"
                className="bg-white text-black px-8 py-3 rounded font-semibold hover:bg-gray-200 transition-colors"
              >
                Host a show
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Favorites — followed DJs & favorited shows in next 7 days, only when NOT on Channel Radio */}
      {mounted && !isBroadcastLive && favoritesNowLive.length > 0 && (
        <section className="px-4 md:px-8 pt-4 pb-6 relative z-10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-semibold mb-3">On your watchlist</h2>
            <SwipeableCardCarousel>
              {favoritesNowLive.map((item, index) => renderCard(item, index, true))}
            </SwipeableCardCarousel>
          </div>
        </section>
      )}

      {/* Meanwhile in the Scene */}
      <section className="px-4 md:px-8 pb-4 relative z-10">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">Meanwhile in the scene</h2>
          <p className="text-zinc-400 mb-6">Upcoming shows from selectors in your community</p>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="flex-1 max-w-md">
              <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
            </div>
            <Tuner
              selectedCity={selectedCity}
              onCityChange={handleCityChange}
              selectedGenres={selectedGenres}
              onGenresChange={handleGenresChange}
              cityResultCount={cityResultCount}
              genreResultCount={genreResultCount}
              onGenreDropdownClose={handleGenreDropdownClose}
              citiesWithMatches={citiesWithMatches}
              genresWithMatches={genresWithMatches}
            />
          </div>
        </div>
      </section>

      <div className="px-4 md:px-8 flex-1 w-full flex flex-col">
      <main className="max-w-7xl mx-auto flex-1 w-full flex flex-col">
        <div className="flex flex-col">

          {isLoading ? (
            <>
              {/* Skeleton grid section */}
              <div className="flex-shrink-0 pt-3 md:pt-4 pb-3 md:pb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              </div>
              {/* Skeleton carousel section */}
              <div className="flex-shrink-0 pb-3 md:pb-4">
                <div className="flex">
                  <div className="w-full md:w-1/2 flex-shrink-0 px-1">
                    <SkeletonCard />
                  </div>
                  <div className="hidden md:block w-1/2 flex-shrink-0 px-1">
                    <SkeletonCard />
                  </div>
                </div>
              </div>
            </>
          ) : (
          <>

          {/* Section 1: Location + Genre (carousel, max 4) */}
          {locationGenreCards.length > 0 && (
            <div className="flex-shrink-0 pt-3 md:pt-4 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {locationGenreCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}


          {/* Section 3: Selected by your favorite curators (carousel, max 4) — shown here on first visit, at the bottom after */}
          {!hasSeenCuratorRecs && filteredCuratorRecs.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {filteredCuratorRecs.map((rec, index) => (
                  <CuratorRecCard
                    key={`rec-${rec.djUsername}-${index}`}
                    rec={rec}
                  />
                ))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 4: Genre matching (swipe, max 5) */}
          {genreCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {genreCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 6: Location matching (swipe, max 5) */}
          {locationCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {locationCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 7: Selected by Radio (swipe, max 5) */}
          {radioCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {radioCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 3 (bottom): Curator recs moved here after user has seen them once */}
          {hasSeenCuratorRecs && filteredCuratorRecs.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {filteredCuratorRecs.map((rec, index) => (
                  <CuratorRecCard
                    key={`rec-${rec.djUsername}-${index}`}
                    rec={rec}
                  />
                ))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Empty state when no matches at all and no invite card already shown above */}
          {!isLoading && allCardCount === 0 && missingGenres.length === 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <InviteCard message="Know a great curator? Invite them to Channel" />
            </div>
          )}

          </>
          )}

        </div>
      </main>
      </div>

      <GenreAlertPrompt
        isOpen={showGenreAlertPrompt}
        onClose={() => setShowGenreAlertPrompt(false)}
        onSignUp={handleGenreAlertSignUp}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setAuthModalMessage(undefined);
        }}
        message={authModalMessage}
      />
    </div>
  );
}
