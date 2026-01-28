'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { ComingUpNext } from '@/components/channel/ComingUpNext';
import { WhoIsOnNow } from '@/components/channel/WhoIsOnNow';
import { TVGuideSchedule } from '@/components/channel/TVGuideSchedule';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { TipThankYouModal } from '@/components/channel/TipThankYouModal';
import { MyDJsSection } from '@/components/channel/MyDJsSection';
import { WhoNotToMiss } from '@/components/channel/WhoNotToMiss';
import { AuthModal } from '@/components/AuthModal';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useListenerChat } from '@/hooks/useListenerChat';
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
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);

  // All shows data for MyDJs and WhatNotToMiss
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [allShowsLoading, setAllShowsLoading] = useState(true);

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
      .catch(console.error)
      .finally(() => setAllShowsLoading(false));
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
          {/* Top section: Who Is On Now (with chat below broadcast card) + Coming Up Next */}
          <div className="flex-shrink-0 p-4 space-y-4 border-b border-gray-800">
            {/* Who Is On Now - with Play button for broadcast, chat below broadcast card */}
            <WhoIsOnNow
              onAuthRequired={handleAuthRequired}
              onTogglePlay={toggle}
              isPlaying={isPlaying}
              isStreamLoading={isLoading}
              chatSlot={isLive ? (
                <div className="bg-surface-card rounded-xl overflow-hidden" style={{ height: '400px' }}>
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

            {/* Coming Up Next (next 2 shows) */}
            <ComingUpNext onAuthRequired={handleAuthRequired} />
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
              isLoading={allShowsLoading}
            />
          </div>

          {/* Who Is On Now - live DJ cards with Play button for broadcast, chat below broadcast card */}
          <div className="flex-shrink-0 px-4 pb-4">
            <WhoIsOnNow
              onAuthRequired={handleAuthRequired}
              onTogglePlay={toggle}
              isPlaying={isPlaying}
              isStreamLoading={isLoading}
              chatSlot={isLive ? (
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
                    listenerCount={listenerCount}
                    loveCount={loveCount}
                  />
                </div>
              ) : undefined}
            />
          </div>

          {/* Who Not To Miss - upcoming shows with Remind Me CTA */}
          <div className="flex-shrink-0 px-4 pb-4">
            <WhoNotToMiss
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
