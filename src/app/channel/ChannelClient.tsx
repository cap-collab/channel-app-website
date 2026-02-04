'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { WhoIsOnNow } from '@/components/channel/WhoIsOnNow';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { TipThankYouModal } from '@/components/channel/TipThankYouModal';
import { MyDJsSection } from '@/components/channel/MyDJsSection';
import { WhoNotToMiss } from '@/components/channel/WhoNotToMiss';
import { LocalDJsSection } from '@/components/channel/LocalDJsSection';
import { AuthModal } from '@/components/AuthModal';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useListenerChat } from '@/hooks/useListenerChat';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { saveTipToLocalStorage } from '@/lib/tip-history-storage';
import { Show, Station, IRLShowData } from '@/types';
import { STATIONS } from '@/lib/stations';
import { useFavorites } from '@/hooks/useFavorites';
import { getDefaultCity, matchesCity } from '@/lib/city-detection';
import { showMatchesDJ } from '@/lib/dj-matching';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface TipSuccessData {
  djUsername: string;
  djThankYouMessage: string;
  tipAmountCents: number;
  showName: string;
}

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);
  const { favorites } = useFavorites();
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

  // Track featured DJ names (first position in carousels) to avoid repeating across sections
  const [featuredDJNames, setFeaturedDJNames] = useState<string[]>([]);

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
  }, [user?.uid]);

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

  // Compute show IDs to exclude from WhoNotToMiss (shows already in My Favorites or Local DJs)
  const excludedShowIds = useMemo(() => {
    const excluded = new Set<string>();
    const now = new Date();

    // Get followed DJ names and favorited shows from favorites
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

    // Find shows matching followed DJs or favorited shows (displayed in My Favorites section)
    for (const show of allShows) {
      const startDate = new Date(show.startTime);
      if (startDate <= now) continue; // Only upcoming shows

      // Check if show matches any followed DJ (word boundary match)
      const matchesDJFollow = followedDJNames.some((name) => showMatchesDJ(show, name));
      if (matchesDJFollow) {
        excluded.add(show.id);
        continue;
      }

      // Check favorited shows
      const showNameLower = show.name?.toLowerCase() || '';
      const matchesFavorite = favoritedShows.some((fav) => {
        const nameMatch = showNameLower === fav.term ||
          (fav.showName && showNameLower === fav.showName.toLowerCase());
        const stationMatch = !fav.stationId || show.stationId === fav.stationId;
        return nameMatch && stationMatch;
      });
      if (matchesFavorite) {
        excluded.add(show.id);
        continue;
      }

      // Check local DJs (shows from DJs in selected city)
      if (selectedCity && show.djLocation && matchesCity(show.djLocation, selectedCity)) {
        const hasPhoto = show.djPhotoUrl || show.imageUrl;
        const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
        if (show.dj && (show.djUsername || show.djUserId) && hasPhoto && !isRestreamOrPlaylist) {
          excluded.add(show.id);
        }
      }
    }

    return excluded;
  }, [allShows, favorites, selectedCity]);

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

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      {/* Use shared Header with profile icon */}
      <Header currentPage="channel" position="sticky" />

      {/* Main content - flex-1 and min-h-0 to fill remaining space */}
      <main className="max-w-7xl mx-auto flex-1 min-h-0 w-full flex flex-col">
        {/* Unified layout for all screen sizes */}
        <div className="flex flex-col overflow-y-auto">
          {/* My DJs Section - only shows for authenticated users with followed DJs */}
          <div className="flex-shrink-0 px-4 pt-3 md:pt-4">
            <MyDJsSection
              shows={liveAndUpcomingShows}
              irlShows={irlShows}
              isAuthenticated={isAuthenticated}
              isLoading={allShowsLoading}
            />
          </div>

          {/* Who Is On Now - live DJ cards with Play button for broadcast, chat below broadcast card */}
          <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
            <WhoIsOnNow
              onAuthRequired={handleAuthRequired}
              onTogglePlay={toggle}
              isPlaying={isPlaying}
              isStreamLoading={isLoading}
              isBroadcastLive={isLive}
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

          {/* Your Local DJs - unified section with IRL and Radio Shows subsections */}
          <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
            <LocalDJsSection
              shows={allShows}
              irlShows={irlShows}
              stations={stationsMap}
              isAuthenticated={isAuthenticated}
              onAuthRequired={handleRemindMe}
              onIRLAuthRequired={handleIRLAuthRequired}
              selectedCity={selectedCity}
              onCityChange={handleCityChange}
              onFeaturedDJs={setFeaturedDJNames}
            />
          </div>

          {/* Who Not To Miss - upcoming shows with Remind Me CTA */}
          <div className="flex-shrink-0 px-4 pb-3 md:pb-4">
            <WhoNotToMiss
              shows={allShows}
              stations={stationsMap}
              isAuthenticated={isAuthenticated}
              onAuthRequired={handleRemindMe}
              excludedShowIds={excludedShowIds}
              featuredDJNames={featuredDJNames}
            />
          </div>

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
