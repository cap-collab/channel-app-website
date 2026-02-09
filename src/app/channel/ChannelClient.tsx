'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { WhoIsOnNow } from '@/components/channel/WhoIsOnNow';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { TipThankYouModal } from '@/components/channel/TipThankYouModal';
import { MyDJsSection } from '@/components/channel/MyDJsSection';
import { Tuner } from '@/components/channel/Tuner';
import { SwipeableCardCarousel } from '@/components/channel/SwipeableCardCarousel';
import { TicketCard } from '@/components/channel/TicketCard';
import { IRLShowCard } from '@/components/channel/IRLShowCard';
import { InviteCard } from '@/components/channel/InviteCard';
import { AuthModal } from '@/components/AuthModal';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useListenerChat } from '@/hooks/useListenerChat';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { saveTipToLocalStorage } from '@/lib/tip-history-storage';
import { Show, Station, IRLShowData } from '@/types';
import { STATIONS } from '@/lib/stations';
import { useFavorites } from '@/hooks/useFavorites';
import { getDefaultCity, matchesCity } from '@/lib/city-detection';
import { GENRE_ALIASES } from '@/lib/genres';
import { showMatchesDJ } from '@/lib/dj-matching';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface TipSuccessData {
  djUsername: string;
  djThankYouMessage: string;
  tipAmountCents: number;
  showName: string;
}

type MatchedItem =
  | { type: 'irl'; data: IRLShowData; priority: number; matchLabel: string | undefined }
  | { type: 'radio'; data: Show; station: Station; priority: number; matchLabel: string | undefined };

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);
  const { favorites, isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);

  // All shows data for MyDJs and WhatNotToMiss
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [allShowsLoading, setAllShowsLoading] = useState(true);

  // IRL shows data
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);

  // Selected city for local DJs section (lifted up for deduplication)
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [cityInitialized, setCityInitialized] = useState(false);

  // Selected genre for Who Not To Miss section (lifted up for Tuner bar)
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const genreInitialized = useRef(false);

  // Follow/remind state for unified cards section
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

  // Load saved city preference from user profile (auth) or localStorage (unauth)
  useEffect(() => {
    async function loadSavedCity() {
      if (cityInitialized) return;

      // For authenticated users, load from Firebase
      if (user?.uid && db) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const savedCity = userDoc.data()?.irlCity;
            if (savedCity) {
              setSelectedCity(savedCity);
              setCityInitialized(true);
              return;
            }
          }
        } catch (error) {
          console.error('Error loading saved city:', error);
        }
      }

      // For unauthenticated users (or auth users without saved city), try localStorage
      try {
        const localCity = localStorage.getItem('channel-selected-city');
        if (localCity) {
          setSelectedCity(localCity);
          setCityInitialized(true);
          return;
        }
      } catch {
        // localStorage not available
      }

      // Final fallback to timezone detection
      setSelectedCity(getDefaultCity());
      setCityInitialized(true);
    }

    loadSavedCity();
  }, [user?.uid, cityInitialized]);

  // Handle city change and save to profile (Firebase for auth, localStorage for unauth)
  const handleCityChange = useCallback(async (city: string) => {
    setSelectedCity(city);

    // Save to Firebase if authenticated
    if (user?.uid && db) {
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          irlCity: city,
        });
      } catch (error) {
        console.error('Error saving city preference:', error);
      }
    } else {
      // Save to localStorage for unauthenticated users
      try {
        localStorage.setItem('channel-selected-city', city);
      } catch {
        // localStorage not available
      }
    }

    // Refresh page to re-fetch data with new city
    router.refresh();
  }, [user?.uid, router]);

  // Load saved genre preference from user profile (auth) or localStorage (unauth)
  useEffect(() => {
    async function loadSavedGenre() {
      if (genreInitialized.current) return;

      // For authenticated users, load from Firebase
      if (user?.uid && db) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const savedGenre = userDoc.data()?.preferredGenre;
            if (savedGenre) {
              setSelectedGenre(savedGenre);
              genreInitialized.current = true;
              return;
            }
          }
        } catch (error) {
          console.error('Error loading saved genre:', error);
        }
        // Authenticated user without saved preference - default to House
        setSelectedGenre('House');
        genreInitialized.current = true;
        return;
      }

      // For unauthenticated users, try localStorage (no default - empty if not set)
      try {
        const localGenre = localStorage.getItem('channel-selected-genre');
        if (localGenre) {
          setSelectedGenre(localGenre);
        }
      } catch {
        // localStorage not available
      }
      genreInitialized.current = true;
    }

    loadSavedGenre();
  }, [user?.uid]);

  // Handle genre change and save to profile
  const handleGenreChange = useCallback(async (genre: string) => {
    setSelectedGenre(genre);

    if (user?.uid && db) {
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          preferredGenre: genre,
        });
      } catch (error) {
        console.error('Error saving genre preference:', error);
      }
    } else {
      try {
        localStorage.setItem('channel-selected-genre', genre);
      } catch {
        // localStorage not available
      }
    }

    // Refresh page to re-fetch data with new genre
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

  // Tip success modal state
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [tipSuccessData, setTipSuccessData] = useState<TipSuccessData | null>(null);

  // Handle tip success redirect from Stripe
  const handleTipSuccess = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/tips/by-session?sessionId=${sessionId}`);
      if (!response.ok) {
        console.error('Failed to fetch tip data');
        return;
      }

      const tipData = await response.json();

      // Save to localStorage for guest users (or all users for offline access)
      saveTipToLocalStorage({
        id: tipData.id,
        stripeSessionId: sessionId,
        djUsername: tipData.djUsername,
        showName: tipData.showName,
        tipAmountCents: tipData.tipAmountCents,
        djThankYouMessage: tipData.djThankYouMessage,
        createdAt: Date.now(),
      });

      // Show the thank you modal
      setTipSuccessData({
        djUsername: tipData.djUsername,
        djThankYouMessage: tipData.djThankYouMessage,
        tipAmountCents: tipData.tipAmountCents,
        showName: tipData.showName,
      });
      setShowThankYouModal(true);

      // Clear URL params
      router.replace('/channel', { scroll: false });
    } catch (error) {
      console.error('Error handling tip success:', error);
    }
  }, [router]);

  // Fetch all shows on mount
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => {
        setAllShows(data.shows || []);
        setIrlShows(data.irlShows || []);
      })
      .catch(console.error)
      .finally(() => setAllShowsLoading(false));
  }, []);

  // Filter to only live and upcoming shows (exclude past shows)
  const liveAndUpcomingShows = useMemo(() => {
    const now = new Date();
    return allShows.filter((show) => new Date(show.endTime) > now);
  }, [allShows]);

  // Helper: check if a show matches the selected genre (with aliases)
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

  // Compute show IDs already in My DJs section (to exclude from unified cards)
  const myDJsShowIds = useMemo(() => {
    const excluded = new Set<string>();
    const now = new Date();
    const followedDJNames = favorites
      .filter((f) => f.type === 'search')
      .map((f) => f.term);
    const favoritedShows = favorites
      .filter((f) => f.type === 'show')
      .map((f) => ({
        term: f.term.toLowerCase(),
        showName: f.showName,
        stationId: f.stationId,
      }));

    for (const show of allShows) {
      const startDate = new Date(show.startTime);
      if (startDate <= now) continue;
      const matchesDJFollow = followedDJNames.some((name) => showMatchesDJ(show, name));
      if (matchesDJFollow) { excluded.add(show.id); continue; }
      const showNameLower = show.name?.toLowerCase() || '';
      const matchesFavorite = favoritedShows.some((fav) => {
        const nameMatch = showNameLower === fav.term ||
          (fav.showName && showNameLower === fav.showName.toLowerCase());
        const stationMatch = !fav.stationId || show.stationId === fav.stationId;
        return nameMatch && stationMatch;
      });
      if (matchesFavorite) { excluded.add(show.id); }
    }
    return excluded;
  }, [allShows, favorites]);

  // Compute matched card groups by priority
  // Priority 3: city + genre match (standalone cards)
  // Priority 2: city only match (swipeable carousel, max 5)
  // Priority 1: genre only match (swipeable carousel, max 5)
  // When no genre selected: treat as "all genres" — only city filtering applies
  // When city is Anywhere or empty: no city filtering, only genre applies
  const { bothCards, cityOnlyCards, genreOnlyCards } = useMemo(() => {
    const isAnywhere = !selectedCity || selectedCity === 'Anywhere';
    const hasGenreFilter = !!selectedGenre;
    const both: MatchedItem[] = [];
    const cityOnly: MatchedItem[] = [];
    const genreOnly: MatchedItem[] = [];
    const now = new Date();
    const seenDJs = new Set<string>();

    const addItem = (item: MatchedItem, djName: string | undefined) => {
      const key = djName?.toLowerCase();
      if (key && seenDJs.has(key)) return;
      if (key) seenDJs.add(key);

      if (item.priority === 3) both.push(item);
      else if (item.priority === 2) cityOnly.push(item);
      else if (item.priority === 1) genreOnly.push(item);
      // priority 0: only when Anywhere + no genre, goes to cityOnly as generic cards
      else cityOnly.push(item);
    };

    // Process IRL shows
    for (const show of irlShows) {
      const cityMatch = !isAnywhere && matchesCity(show.location, selectedCity);
      const genreMatch = hasGenreFilter ? matchesGenre(show.djGenres, selectedGenre) : false;

      // Include if: city matches, genre matches, or no filters active (Anywhere + no genre)
      if (!cityMatch && !genreMatch && !isAnywhere) continue;
      if (isAnywhere && hasGenreFilter && !genreMatch) continue;

      const priority = (cityMatch ? 2 : 0) + (genreMatch ? 1 : 0);
      let matchLabel: string | undefined;
      if (cityMatch && genreMatch) matchLabel = `${selectedCity.toUpperCase()} + ${selectedGenre.toUpperCase()}`;
      else if (cityMatch) matchLabel = selectedCity.toUpperCase();
      else if (genreMatch) matchLabel = selectedGenre.toUpperCase();

      addItem({ type: 'irl', data: show, priority, matchLabel }, show.djName);
    }

    // Process radio shows
    for (const show of allShows) {
      const startDate = new Date(show.startTime);
      if (startDate <= now) continue;
      if (myDJsShowIds.has(show.id)) continue;
      const hasPhoto = show.djPhotoUrl || show.imageUrl;
      const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
      if (!show.dj || !(show.djUsername || show.djUserId) || !hasPhoto || isRestreamOrPlaylist) continue;

      const station = stationsMap.get(show.stationId);
      if (!station) continue;

      const cityMatch = !isAnywhere && show.djLocation
        ? matchesCity(show.djLocation, selectedCity) : false;
      const genreMatch = hasGenreFilter ? matchesGenre(show.djGenres, selectedGenre) : false;

      // Include if: city matches, genre matches, or no filters active
      if (!cityMatch && !genreMatch && !isAnywhere) continue;
      if (isAnywhere && hasGenreFilter && !genreMatch) continue;

      const priority = (cityMatch ? 2 : 0) + (genreMatch ? 1 : 0);
      let matchLabel: string | undefined;
      if (cityMatch && genreMatch) matchLabel = `${selectedCity.toUpperCase()} + ${selectedGenre.toUpperCase()}`;
      else if (cityMatch) matchLabel = selectedCity.toUpperCase();
      else if (genreMatch) matchLabel = selectedGenre.toUpperCase();

      addItem({ type: 'radio', data: show, station, priority, matchLabel }, show.dj);
    }

    return {
      bothCards: both.slice(0, 5),
      cityOnlyCards: cityOnly.slice(0, 5),
      genreOnlyCards: genreOnly.slice(0, 5),
    };
  }, [allShows, irlShows, selectedCity, selectedGenre, stationsMap, myDJsShowIds, matchesGenre]);

  // All unified cards combined (for result counts)
  const allUnifiedCards = useMemo(
    () => [...bothCards, ...cityOnlyCards, ...genreOnlyCards],
    [bothCards, cityOnlyCards, genreOnlyCards]
  );

  // Compute result counts for Tuner bar indicators
  const cityResultCount = useMemo(() => {
    if (!selectedCity || selectedCity === 'Anywhere') return undefined;
    return allUnifiedCards.filter((c) => c.priority >= 2).length;
  }, [selectedCity, allUnifiedCards]);

  const genreResultCount = useMemo(() => {
    if (!selectedGenre) return undefined;
    return allUnifiedCards.filter((c) => c.priority === 1 || c.priority === 3).length;
  }, [selectedGenre, allUnifiedCards]);

  // Check for tip success on mount
  useEffect(() => {
    const tipParam = searchParams.get('tip');
    const sessionId = searchParams.get('session');

    if (tipParam === 'success' && sessionId) {
      handleTipSuccess(sessionId);
    }
  }, [searchParams, handleTipSuccess]);

  const handleCloseThankYouModal = useCallback(() => {
    setShowThankYouModal(false);
    setTipSuccessData(null);
  }, []);

  // Only use chatUsername from Firestore - do NOT fall back to displayName
  // Users must explicitly choose their chat username
  const username = chatUsername || undefined;

  const {
    isPlaying,
    isLoading,
    isLive,
    currentShow,
    currentDJ,
    toggle,
    listenerCount,
  } = useBroadcastStream();

  // Get current DJ slot info for venue broadcasts with multiple DJs
  // Placed early so we can use it for currentDjSlotStartTime
  const currentDjSlot = useMemo(() => {
    if (currentShow?.djSlots && currentShow.djSlots.length > 0) {
      const now = Date.now();
      return currentShow.djSlots.find(
        (djSlot) => djSlot.startTime <= now && djSlot.endTime > now
      );
    }
    return null;
  }, [currentShow?.djSlots]);

  // For venue broadcasts, use DJ slot start time so promo/love resets per DJ
  // For remote broadcasts or shows without DJ slots, use show start time
  const currentDjSlotStartTime = currentDjSlot?.startTime || currentShow?.startTime;

  // Get love count from chat - pass DJ slot start time so love count resets per DJ
  const { loveCount } = useListenerChat({ username, currentShowStartTime: currentDjSlotStartTime });

  
  const handleAuthRequired = useCallback(() => {
    setAuthModalMessage(undefined);
    setShowAuthModal(true);
  }, []);

  // Handle Remind Me click from WhatNotToMiss (for non-authenticated users)
  const handleRemindMe = useCallback((show: Show) => {
    const djName = show.dj || show.name;
    setAuthModalMessage(`Sign in to get notified when ${djName} goes live`);
    setShowAuthModal(true);
  }, []);

  // Handle Follow click from IRLNearYou (for non-authenticated users)
  const handleIRLAuthRequired = useCallback((djName: string) => {
    setAuthModalMessage(`Sign in to follow ${djName}`);
    setShowAuthModal(true);
  }, []);

  // Follow/Unfollow for unified radio shows
  const handleUnifiedFollow = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      handleRemindMe(show);
      return;
    }
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

  // Follow/Unfollow for unified IRL shows
  const handleUnifiedIRLFollow = useCallback(async (show: IRLShowData) => {
    if (!isAuthenticated) {
      handleIRLAuthRequired(show.djName);
      return;
    }
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

  // Remind Me for unified radio shows
  const handleUnifiedRemindMe = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      handleRemindMe(show);
      return;
    }
    setAddingReminderShowId(show.id);
    try {
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingReminderShowId(null);
    }
  }, [isAuthenticated, handleRemindMe, isShowFavorited, toggleFavorite]);

  
  // For tipping: get the DJ with identity from djProfiles (for B3B) or slot-level
  // For now, just pick the first DJ with identity - in the future we could prefer DJ with Stripe
  const { currentDJEmail, currentDJUserId } = useMemo(() => {
    // B3B: check djProfiles first
    if (currentDjSlot?.djProfiles && currentDjSlot.djProfiles.length > 0) {
      const djWithIdentity = currentDjSlot.djProfiles.find(p => p.email || p.userId);
      if (djWithIdentity) {
        return {
          currentDJEmail: djWithIdentity.email || null,
          currentDJUserId: djWithIdentity.userId || null
        };
      }
    }

    // Single DJ slot: use slot-level fields
    if (currentDjSlot) {
      return {
        currentDJEmail: currentDjSlot.djEmail || null,
        currentDJUserId: currentDjSlot.djUserId || currentDjSlot.liveDjUserId || null
      };
    }

    // Remote broadcast: use show-level fields
    return {
      currentDJEmail: currentShow?.djEmail || null,
      currentDJUserId: currentShow?.djUserId || currentShow?.liveDjUserId || null
    };
  }, [currentDjSlot, currentShow]);

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
      const favorited = isShowFavorited(show);
      const addingFollow = addingFollowDj === show.dj;
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
      {/* Use shared Header with profile icon */}
      <Header currentPage="channel" position="sticky" />

      {/* Tuner bar - sticky below header */}
      <Tuner
        selectedCity={selectedCity}
        onCityChange={handleCityChange}
        selectedGenre={selectedGenre}
        onGenreChange={handleGenreChange}
        cityResultCount={cityResultCount}
        genreResultCount={genreResultCount}
      />

      {/* Main content - flex-1 and min-h-0 to fill remaining space */}
      <main className="max-w-7xl mx-auto flex-1 min-h-0 w-full flex flex-col">
        {/* Unified layout for all screen sizes */}
        <div className="flex flex-col overflow-y-auto">
          {/* Who Is On Now - live DJ cards with Play button for broadcast, chat below broadcast card */}
          <div className="flex-shrink-0 px-4 pt-3 md:pt-4">
            <WhoIsOnNow
              onAuthRequired={handleAuthRequired}
              onTogglePlay={toggle}
              isPlaying={isPlaying}
              isStreamLoading={isLoading}
              isBroadcastLive={isLive}
              selectedGenre={selectedGenre}
              selectedCity={selectedCity}
              chatSlot={isLive ? (
                <div className="bg-surface-card rounded-xl overflow-hidden h-[300px] lg:h-[400px]">
                  <ListenerChatPanel
                    isAuthenticated={isAuthenticated}
                    username={username}
                    userId={user?.uid}
                    currentDJ={currentDJ}
                    currentDJUserId={currentDJUserId}
                    currentDJEmail={currentDJEmail}
                    showName={currentShow?.showName}
                    broadcastSlotId={currentShow?.id}
                    isLive={isLive}
                    profileLoading={profileLoading}
                    currentShowStartTime={currentDjSlotStartTime}
                    onSetUsername={setChatUsername}
                    isVenue={currentShow?.broadcastType === 'venue'}
                    activePromoText={currentDjSlot?.promoText || currentDjSlot?.djPromoText}
                    activePromoHyperlink={currentDjSlot?.promoHyperlink || currentDjSlot?.djPromoHyperlink}
                    listenerCount={listenerCount}
                    loveCount={loveCount}
                  />
                </div>
              ) : undefined}
            />
          </div>

          {/* My DJs Section - only shows for authenticated users with followed DJs */}
          <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
            <MyDJsSection
              shows={liveAndUpcomingShows}
              irlShows={irlShows}
              isAuthenticated={isAuthenticated}
              isLoading={allShowsLoading}
            />
          </div>

          {/* City + Genre match cards - standalone, one per row */}
          {bothCards.length > 0 && (
            <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bothCards.map((item, index) => renderCard(item, index))}
              </div>
            </div>
          )}

          {/* City-only match cards - swipeable carousel */}
          {cityOnlyCards.length > 0 && (
            <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {[
                  ...cityOnlyCards.map((item, index) => renderCard(item, index)),
                  ...(cityOnlyCards.length < 5
                    ? [<InviteCard key="invite-city" message={`Invite your favorite ${selectedCity === 'Anywhere' ? '' : selectedCity + ' '}DJs to join Channel`} />]
                    : []),
                ]}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Genre-only match cards - swipeable carousel */}
          {genreOnlyCards.length > 0 && (
            <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {[
                  ...genreOnlyCards.map((item, index) => renderCard(item, index)),
                  ...(genreOnlyCards.length < 5
                    ? [<InviteCard key="invite-genre" message={selectedGenre ? `Invite your favorite ${selectedGenre} DJs to join Channel` : 'Invite your favorite DJs to join Channel'} />]
                    : []),
                ]}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Empty state when no matches at all */}
          {allUnifiedCards.length === 0 && (
            <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
              <div className="text-center py-3">
                <p className="text-gray-400 text-sm mb-3">
                  Invite your favorite {selectedCity === 'Anywhere' ? '' : selectedCity + ' '}{selectedGenre ? selectedGenre + ' ' : ''}DJs to join Channel
                </p>
                <InviteCard />
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setAuthModalMessage(undefined);
        }}
        message={authModalMessage}
      />

      {/* Tip Thank You Modal */}
      {tipSuccessData && (
        <TipThankYouModal
          isOpen={showThankYouModal}
          onClose={handleCloseThankYouModal}
          djUsername={tipSuccessData.djUsername}
          thankYouMessage={tipSuccessData.djThankYouMessage}
          tipAmountCents={tipSuccessData.tipAmountCents}
        />
      )}
    </div>
  );
}
