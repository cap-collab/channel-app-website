'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { Tuner } from '@/components/channel/Tuner';
import { SwipeableCardCarousel } from '@/components/channel/SwipeableCardCarousel';
import { TicketCard } from '@/components/channel/TicketCard';
import { LiveShowCard } from '@/components/channel/LiveShowCard';
import { IRLShowCard } from '@/components/channel/IRLShowCard';
import { CuratorRecCard } from '@/components/channel/CuratorRecCard';
import { InviteCard } from '@/components/channel/InviteCard';
import { AuthModal } from '@/components/AuthModal';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { Show, Station, IRLShowData, CuratorRec } from '@/types';
import { STATIONS } from '@/lib/stations';
import { useFavorites } from '@/hooks/useFavorites';
import { getDefaultCity, matchesCity } from '@/lib/city-detection';
import { GENRE_ALIASES } from '@/lib/genres';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type MatchedItem =
  | { type: 'irl'; data: IRLShowData; matchLabel: string | undefined }
  | { type: 'radio'; data: Show; station: Station; matchLabel: string | undefined; live?: boolean };

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { favorites, isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const router = useRouter();

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);

  // All shows data
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);
  const [curatorRecs, setCuratorRecs] = useState<CuratorRec[]>([]);

  // Selected city and genres
  const [selectedCity, setSelectedCity] = useState<string>(getDefaultCity());
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  // Follow/remind state
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

  // Load city/genre preferences: Firebase (real-time) for auth users, localStorage for unauth
  useEffect(() => {
    if (user?.uid && db) {
      const userRef = doc(db, 'users', user.uid);
      const unsubscribe = onSnapshot(userRef, (snapshot) => {
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
      return () => unsubscribe();
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

  // Fetch all shows on mount
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => {
        setAllShows(data.shows || []);
        setIrlShows(data.irlShows || []);
        setCuratorRecs(data.curatorRecs || []);
      })
      .catch(console.error);
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

  // Compute all 7 sections with deduplication
  const {
    locationGenreCards,
    filteredCuratorRecs,
    liveGenreCards,
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

    // Helper: collect candidates, sort by genre match count desc (live first as tiebreaker), then dedup + take top N
    const takeSorted = (candidates: { item: MatchedItem; id: string; djName: string | undefined; matchCount: number; live?: boolean }[], max: number): MatchedItem[] => {
      candidates.sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        // Same match count: live shows first
        if (a.live !== b.live) return a.live ? -1 : 1;
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

    // Section 1: Location + Genre (grid, max 4) — live and upcoming mixed, sorted by match count then live first
    // Only show when a specific city is selected (not "Anywhere")
    let s1: MatchedItem[] = [];
    if (hasGenreFilter && !isAnywhere) {
      const candidates: { item: MatchedItem; id: string; djName: string | undefined; matchCount: number; live?: boolean }[] = [];
      // IRL shows
      for (const show of irlShows) {
        if (!matchesCity(show.location, selectedCity)) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        const label = `${selectedCity.toUpperCase()} + ${genreLabelFor(show.djGenres)}`;
        candidates.push({ item: makeIRLItem(show, label), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres) });
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
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres), live });
      }
      console.log('[S1 candidates]', candidates.map(c => ({ djName: c.djName, matchCount: c.matchCount, live: c.live, label: c.item.matchLabel })));
      s1 = takeSorted(candidates, 4);
      console.log('[S1 result]', s1.map(item => ({ matchLabel: item.matchLabel, type: item.type, dj: item.type === 'radio' ? item.data.dj : item.data.djName })));
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

    // Section 4: Live Genre matching (swipe, max 5) — live shows matching genre
    let s4: MatchedItem[] = [];
    if (hasGenreFilter) {
      const candidates: { item: MatchedItem; id: string; djName: string | undefined; matchCount: number }[] = [];
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (!isShowLive(show)) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const item = makeRadioItem(show, genreLabelFor(show.djGenres), true);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres) });
      }
      s4 = takeSorted(candidates, 5);
    }

    // Section 5: Genre matching (swipe, max 5) — upcoming, not live
    let s5: MatchedItem[] = [];
    if (hasGenreFilter) {
      const candidates: { item: MatchedItem; id: string; djName: string | undefined; matchCount: number }[] = [];
      // IRL shows
      for (const show of irlShows) {
        if (!matchesAnyGenre(show.djGenres)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        candidates.push({ item: makeIRLItem(show, genreLabelFor(show.djGenres)), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres) });
      }
      // Radio shows
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (isShowLive(show)) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const item = makeRadioItem(show, genreLabelFor(show.djGenres));
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres) });
      }
      s5 = takeSorted(candidates, 5);
    }

    // Section 6: Location matching (swipe, max 5) — upcoming shows matching location
    const s6: MatchedItem[] = [];
    if (!isAnywhere) {
      // IRL shows
      for (const show of irlShows) {
        if (s6.length >= 5) break;
        if (!matchesCity(show.location, selectedCity)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        if (!tryAddShow(id, show.djName)) continue;
        s6.push(makeIRLItem(show, selectedCity.toUpperCase()));
      }
      // Radio shows
      for (const show of allShows) {
        if (s6.length >= 5) break;
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (!show.djLocation || !matchesCity(show.djLocation, selectedCity)) continue;
        if (!tryAddShow(show.id, show.dj)) continue;
        const item = makeRadioItem(show, selectedCity.toUpperCase());
        if (item) s6.push(item);
      }
    }

    // Section 7: Selected by Radio (swipe, max 5) — external station shows, live shows promoted to top
    const s7Candidates: { item: MatchedItem; id: string; djName: string | undefined; live: boolean }[] = [];
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
      });
    }
    // Sort live shows first
    s7Candidates.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return 0;
    });
    const s7: MatchedItem[] = [];
    for (const c of s7Candidates) {
      if (s7.length >= 5) break;
      if (!tryAddShow(c.id, c.djName)) continue;
      s7.push(c.item);
    }

    return {
      locationGenreCards: s1,
      filteredCuratorRecs: s3,
      liveGenreCards: s4,
      genreCards: s5,
      locationCards: s6,
      radioCards: s7,
    };
  }, [allShows, irlShows, curatorRecs, selectedCity, selectedGenres, stationsMap, matchesAnyGenre, getMatchingGenres, genreLabelFor, isShowLive, isValidShow, followedDJNames]);

  // When the main grid (Section 1) is empty, find the first carousel section with content to promote to grid
  const noMainGrid = locationGenreCards.length === 0;
  const promotedSection = noMainGrid
    ? (liveGenreCards.length > 0 ? 'liveGenre'
      : genreCards.length > 0 ? 'genre'
      : locationCards.length > 0 ? 'location'
      : radioCards.length > 0 ? 'radio'
      : null)
    : null;

  // Compute result counts for Tuner bar
  const allCardCount = locationGenreCards.length +
    liveGenreCards.length + genreCards.length + locationCards.length + radioCards.length;

  const cityResultCount = useMemo(() => {
    if (!selectedCity || selectedCity === 'Anywhere') return undefined;
    return locationGenreCards.length + locationCards.length;
  }, [selectedCity, locationGenreCards, locationCards]);

  const genreResultCount = useMemo(() => {
    if (selectedGenres.length === 0) return undefined;
    return locationGenreCards.length + liveGenreCards.length + genreCards.length;
  }, [selectedGenres, locationGenreCards, liveGenreCards, genreCards]);

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

  // Render a single matched card (IRL or Radio)
  const renderCard = (item: MatchedItem, index: number) => {
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
        />
      );
    }
  };

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="channel" position="sticky" />

      <Tuner
        selectedCity={selectedCity}
        onCityChange={handleCityChange}
        selectedGenres={selectedGenres}
        onGenresChange={handleGenresChange}
        cityResultCount={cityResultCount}
        genreResultCount={genreResultCount}
      />

      <main className="max-w-7xl mx-auto flex-1 min-h-0 w-full flex flex-col">
        <div className="flex flex-col overflow-y-auto">

          {/* Section 1: Location + Genre (grid, max 4) — sorted by match count, live first as tiebreaker */}
          {locationGenreCards.length > 0 && (
            <div className="flex-shrink-0 px-4 pt-3 md:pt-4 pb-3 md:pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {locationGenreCards.map((item, index) => renderCard(item, index))}
              </div>
            </div>
          )}

          {/* Section 3: Selected by your favorite curators (grid, max 4) */}
          {filteredCuratorRecs.length > 0 && (
            <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredCuratorRecs.map((rec, index) => (
                  <CuratorRecCard
                    key={`rec-${rec.djUsername}-${index}`}
                    rec={rec}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Live Genre matching (swipe, max 5 — promoted to grid if main grid is empty) */}
          {liveGenreCards.length > 0 && (
            <div className={`flex-shrink-0 px-4 ${promotedSection === 'liveGenre' ? 'pt-3 md:pt-4' : ''} pb-3 md:pb-4`}>
              {promotedSection === 'liveGenre' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {liveGenreCards.map((item, index) => renderCard(item, index))}
                </div>
              ) : (
                <SwipeableCardCarousel>
                  {liveGenreCards.map((item, index) => renderCard(item, index))}
                </SwipeableCardCarousel>
              )}
            </div>
          )}

          {/* Section 5: Genre matching (swipe, max 5 — promoted to grid if main grid is empty) */}
          {genreCards.length > 0 && (
            <div className={`flex-shrink-0 px-4 ${promotedSection === 'genre' ? 'pt-3 md:pt-4' : ''} pb-3 md:pb-4`}>
              {promotedSection === 'genre' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {genreCards.map((item, index) => renderCard(item, index))}
                </div>
              ) : (
                <SwipeableCardCarousel>
                  {genreCards.map((item, index) => renderCard(item, index))}
                </SwipeableCardCarousel>
              )}
            </div>
          )}

          {/* Section 6: Location matching (swipe, max 5 — promoted to grid if main grid is empty) */}
          {locationCards.length > 0 && (
            <div className={`flex-shrink-0 px-4 ${promotedSection === 'location' ? 'pt-3 md:pt-4' : ''} pb-3 md:pb-4`}>
              {promotedSection === 'location' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {locationCards.map((item, index) => renderCard(item, index))}
                </div>
              ) : (
                <SwipeableCardCarousel>
                  {locationCards.map((item, index) => renderCard(item, index))}
                </SwipeableCardCarousel>
              )}
            </div>
          )}

          {/* Section 7: Selected by Radio (swipe, max 5 — promoted to grid if main grid is empty) */}
          {radioCards.length > 0 && (
            <div className={`flex-shrink-0 px-4 ${promotedSection === 'radio' ? 'pt-3 md:pt-4' : ''} pb-3 md:pb-4`}>
              {promotedSection === 'radio' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {radioCards.map((item, index) => renderCard(item, index))}
                </div>
              ) : (
                <SwipeableCardCarousel>
                  {radioCards.map((item, index) => renderCard(item, index))}
                </SwipeableCardCarousel>
              )}
            </div>
          )}

          {/* Empty state when no matches at all */}
          {allCardCount === 0 && (
            <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
              <div className="text-center py-3">
                <p className="text-gray-400 text-sm mb-3">
                  Invite your favorite {selectedCity === 'Anywhere' ? '' : selectedCity + ' '}{selectedGenres.length > 0 ? selectedGenres.join(', ') + ' ' : ''}DJs to join Channel
                </p>
                <InviteCard />
              </div>
            </div>
          )}

        </div>
      </main>

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
