'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { NowPlayingCard } from '@/components/channel/NowPlayingCard';
import { ComingUpNext } from '@/components/channel/ComingUpNext';
import { WhatsOnNow } from '@/components/channel/WhatsOnNow';
import { TVGuideSchedule } from '@/components/channel/TVGuideSchedule';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { TipThankYouModal } from '@/components/channel/TipThankYouModal';
import { MyDJsSection } from '@/components/channel/MyDJsSection';
import { WhatNotToMiss } from '@/components/channel/WhatNotToMiss';
import { EmailCaptureModal } from '@/components/channel/EmailCaptureModal';
import { AuthModal } from '@/components/AuthModal';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useListenerChat } from '@/hooks/useListenerChat';
import { useFavorites } from '@/hooks/useFavorites';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { saveTipToLocalStorage } from '@/lib/tip-history-storage';
import { Show, Station } from '@/types';
import { STATIONS } from '@/lib/stations';

interface TipSuccessData {
  djUsername: string;
  djThankYouMessage: string;
  tipAmountCents: number;
  showName: string;
}

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Email capture modal state
  const [showEmailCaptureModal, setShowEmailCaptureModal] = useState(false);
  const [emailCaptureShow, setEmailCaptureShow] = useState<Show | null>(null);

  // All shows data for MyDJs and WhatNotToMiss
  const [allShows, setAllShows] = useState<Show[]>([]);

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
      .then((data) => setAllShows(data.shows || []))
      .catch(console.error);
  }, []);

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
    error,
    toggle,
    listenerCount,
    audioStream,
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

  // Favorites for the current show
  const { isShowFavorited, toggleFavorite, isInWatchlist, addToWatchlist } = useFavorites();

  // Watchlist state for current DJ
  const [isTogglingWatchlist, setIsTogglingWatchlist] = useState(false);

  // Convert currentShow to Show type for favorites
  const currentShowAsShow: Show | null = currentShow ? {
    id: currentShow.id,
    name: currentShow.showName,
    dj: currentDJ || currentShow.djName || currentShow.liveDjUsername,
    startTime: new Date(currentShow.startTime).toISOString(),
    endTime: new Date(currentShow.endTime).toISOString(),
    stationId: 'broadcast',
  } : null;

  const isCurrentShowFavorited = currentShowAsShow ? isShowFavorited(currentShowAsShow) : false;

  const handleToggleCurrentShowFavorite = useCallback(async () => {
    if (currentShowAsShow) {
      await toggleFavorite(currentShowAsShow);
    }
  }, [currentShowAsShow, toggleFavorite]);

  const handleAuthRequired = useCallback(() => {
    setShowAuthModal(true);
  }, []);

  // Handle Remind Me click from WhatNotToMiss (for non-authenticated users)
  const handleRemindMe = useCallback((show: Show) => {
    setEmailCaptureShow(show);
    setShowEmailCaptureModal(true);
  }, []);

  // Handle email submission for email capture
  const handleEmailSubmit = useCallback(async (email: string, show: Show) => {
    const response = await fetch('/api/email-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        djName: show.dj || show.name,
        showName: show.name,
        showTime: show.startTime,
        djUserId: show.djUserId,
        djEmail: show.djEmail,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save reminder');
    }
  }, []);

  // Get DJ name for watchlist - use currentDJ which is already the display name
  const watchlistDJName = currentDJ || currentShow?.djName;

  // Check if DJ is in watchlist
  const isDJInWatchlist = watchlistDJName ? isInWatchlist(watchlistDJName) : false;

  // Handle adding DJ to watchlist (also adds their shows to favorites via addToWatchlist)
  const handleToggleWatchlist = useCallback(async () => {
    if (!watchlistDJName) return;

    setIsTogglingWatchlist(true);
    try {
      // Get userId/email for more reliable broadcast-slot matching
      // For venue slots, get info from the current DJ slot; for remote, from the show itself
      const djUserId = currentDjSlot?.djUserId || currentDjSlot?.liveDjUserId || currentShow?.djUserId || currentShow?.liveDjUserId;
      const djEmail = currentDjSlot?.djEmail || currentShow?.djEmail;
      // Add DJ name to watchlist - this also auto-adds matching shows to favorites
      await addToWatchlist(watchlistDJName, djUserId, djEmail);
    } finally {
      setIsTogglingWatchlist(false);
    }
  }, [watchlistDJName, addToWatchlist, currentShow, currentDjSlot]);

  // Get all DJ profiles for B3B support (multiple DJs sharing the same slot)
  // Only include DJs who have identity (email or userId)
  // hasProfile indicates if they have a public profile page (set when slot is created)
  const djProfiles = useMemo(() => {
    // Venue broadcasts: use slot-level data only
    if (currentDjSlot) {
      // B3B: check djProfiles array, filter to only DJs with identity
      if (currentDjSlot.djProfiles && currentDjSlot.djProfiles.length > 0) {
        return currentDjSlot.djProfiles
          .filter(p => p.username && (p.email || p.userId))  // MUST have identity
          .map(p => ({ username: p.username!, usernameNormalized: p.usernameNormalized, photoUrl: p.photoUrl, hasProfile: p.hasProfile }));
      }

      // Single DJ slot: check slot-level identity
      // For single DJ slots, hasProfile is determined by whether they have a userId (registered user)
      // The profile page requires dj/broadcaster/admin role, which is checked when userId exists
      if (currentDjSlot.djEmail || currentDjSlot.djUserId || currentDjSlot.liveDjUserId) {
        // Use djUsername (chatUsername) for the profile URL - NOT liveDjUsername which may be a display name
        const username = currentDjSlot.djUsername;
        if (username) {
          // hasProfile requires a userId (registered user with DJ role)
          const hasProfile = !!(currentDjSlot.djUserId || currentDjSlot.liveDjUserId);
          return [{ username, photoUrl: currentDjSlot.djPhotoUrl, hasProfile }];
        }
      }

      // Venue slot exists but DJ has no identity - no profile button
      return [];
    }

    // Remote broadcasts (no djSlots): check show-level
    // Use djUsername (chatUsername) for the profile URL - NOT liveDjUsername which may be a display name
    if (currentShow?.djUsername && (currentShow.djEmail || currentShow.djUserId || currentShow.liveDjUserId)) {
      // For remote broadcasts, liveDjUserId means the DJ logged in and went live, so they have a profile
      return [{ username: currentShow.djUsername, photoUrl: currentShow.liveDjPhotoUrl, hasProfile: !!currentShow.liveDjUserId }];
    }

    return [];
  }, [currentDjSlot, currentShow]);

  // Check if ANY DJ has identity (for tip button visibility)
  const hasDjIdentity = useMemo(() => {
    if (!currentDjSlot) {
      // Remote broadcast: check show-level
      return !!(currentShow?.djEmail || currentShow?.djUserId || currentShow?.liveDjUserId);
    }

    // B3B: check if any profile has identity
    if (currentDjSlot.djProfiles && currentDjSlot.djProfiles.length > 0) {
      return currentDjSlot.djProfiles.some(p => p.email || p.userId);
    }

    // Single DJ: check slot-level
    return !!(currentDjSlot.djEmail || currentDjSlot.djUserId);
  }, [currentDjSlot, currentShow]);

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
        {/* Desktop layout */}
        <div className="hidden lg:flex lg:flex-col lg:h-full">
          {/* Top section: Now Playing + Coming Up Next | Chat */}
          <div className="flex-shrink-0 flex border-b border-gray-800 items-stretch">
            {/* Left column: Now Playing Card + Coming Up Next */}
            <div className="flex-1 p-4 space-y-4">
              {/* Now Playing Card (larger player panel) */}
              <NowPlayingCard
                isPlaying={isPlaying}
                isLoading={isLoading}
                isLive={isLive}
                currentShow={currentShow}
                currentDJ={currentDJ}
                onTogglePlay={toggle}
                listenerCount={listenerCount}
                loveCount={loveCount}
                isAuthenticated={isAuthenticated}
                username={username}
                error={error}
                isShowFavorited={isCurrentShowFavorited}
                onToggleFavorite={handleToggleCurrentShowFavorite}
                onAuthRequired={handleAuthRequired}
                isDJInWatchlist={isDJInWatchlist}
                onToggleWatchlist={handleToggleWatchlist}
                isTogglingWatchlist={isTogglingWatchlist}
                djProfiles={djProfiles}
                hasDjIdentity={hasDjIdentity}
                audioStream={audioStream}
              />

              {/* Coming Up Next (next 2 shows) */}
              <ComingUpNext onAuthRequired={handleAuthRequired} />
            </div>

            {/* Right column: Chat - scrolls internally */}
            <div className="w-96 border-l border-gray-800 flex flex-col p-4">
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
              />
            </div>
          </div>

          {/* Bottom section: TV Guide (full width) - always visible */}
          <div className="flex-1 min-h-[300px] p-4 overflow-y-auto">
            <TVGuideSchedule onAuthRequired={handleAuthRequired} />
          </div>
        </div>

        {/* Mobile layout - DJ-centric design */}
        <div className="lg:hidden flex flex-col overflow-y-auto">
          {/* My DJs Section - only shows for authenticated users with followed DJs */}
          <div className="flex-shrink-0 px-4 pt-4">
            <MyDJsSection
              shows={allShows}
              isAuthenticated={isAuthenticated}
            />
          </div>

          {/* Now Playing Card (full info like desktop) */}
          <div className="flex-shrink-0 p-4 pb-2">
            <NowPlayingCard
              isPlaying={isPlaying}
              isLoading={isLoading}
              isLive={isLive}
              currentShow={currentShow}
              currentDJ={currentDJ}
              onTogglePlay={toggle}
              listenerCount={listenerCount}
              loveCount={loveCount}
              isAuthenticated={isAuthenticated}
              username={username}
              error={error}
              isShowFavorited={isCurrentShowFavorited}
              onToggleFavorite={handleToggleCurrentShowFavorite}
              onAuthRequired={handleAuthRequired}
              isDJInWatchlist={isDJInWatchlist}
              onToggleWatchlist={handleToggleWatchlist}
              isTogglingWatchlist={isTogglingWatchlist}
              djProfiles={djProfiles}
              hasDjIdentity={hasDjIdentity}
              audioStream={audioStream}
            />
          </div>

          {/* Chat - hide on mobile when logged out AND offline */}
          {(isAuthenticated || isLive) && (
            <div className="flex-shrink-0 px-4 pb-4">
              <div className="bg-surface-card rounded-xl overflow-hidden" style={{ height: '300px' }}>
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
                />
              </div>
            </div>
          )}

          {/* What's On Now - live shows across stations */}
          <div className="flex-shrink-0 px-4 pb-4">
            <WhatsOnNow onAuthRequired={handleAuthRequired} />
          </div>

          {/* What Not To Miss - upcoming shows with Remind Me CTA */}
          <div className="flex-shrink-0 px-4 pb-4">
            <WhatNotToMiss
              shows={allShows}
              stations={stationsMap}
              isAuthenticated={isAuthenticated}
              onRemindMe={handleRemindMe}
            />
          </div>

        </div>
      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
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

      {/* Email Capture Modal */}
      <EmailCaptureModal
        isOpen={showEmailCaptureModal}
        onClose={() => {
          setShowEmailCaptureModal(false);
          setEmailCaptureShow(null);
        }}
        show={emailCaptureShow}
        onSubmit={handleEmailSubmit}
        onSignInClick={() => {
          setShowEmailCaptureModal(false);
          setShowAuthModal(true);
        }}
      />
    </div>
  );
}
