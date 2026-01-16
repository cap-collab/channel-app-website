'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { NowPlayingCard } from '@/components/channel/NowPlayingCard';
import { ComingUpNext } from '@/components/channel/ComingUpNext';
import { TVGuideSchedule } from '@/components/channel/TVGuideSchedule';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { TipThankYouModal } from '@/components/channel/TipThankYouModal';
import { AuthModal } from '@/components/AuthModal';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useListenerChat } from '@/hooks/useListenerChat';
import { useFavorites } from '@/hooks/useFavorites';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { saveTipToLocalStorage } from '@/lib/tip-history-storage';
import { Show } from '@/types';

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
  } = useBroadcastStream();

  // Get love count from chat - pass currentShow start time so love count resets per show
  const { loveCount } = useListenerChat({ username, currentShowStartTime: currentShow?.startTime });

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

  // Get current DJ slot info for venue broadcasts with multiple DJs
  const currentDjSlot = (() => {
    if (currentShow?.djSlots && currentShow.djSlots.length > 0) {
      const now = Date.now();
      return currentShow.djSlots.find(
        (djSlot) => djSlot.startTime <= now && djSlot.endTime > now
      );
    }
    return null;
  })();

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

  // Determine if DJ has a public profile worth showing
  // For venue slots, check the current DJ slot's liveDjUsername or djUsername
  // For remote broadcasts, check liveDjUsername at the show level
  const djProfileUsername = currentDjSlot?.liveDjUsername || currentDjSlot?.djUsername || currentShow?.liveDjUsername || null;

  // Get all DJ profiles for B3B support (multiple DJs sharing the same slot)
  const djProfiles = useMemo(() => {
    if (!currentDjSlot) return [];

    // Check djProfiles array first (B3B support)
    if (currentDjSlot.djProfiles && currentDjSlot.djProfiles.length > 0) {
      return currentDjSlot.djProfiles
        .filter(p => p.username)
        .map(p => ({ username: p.username!, photoUrl: p.photoUrl }));
    }

    // Fallback: single DJ from legacy fields
    const singleUsername = currentDjSlot.liveDjUsername || currentDjSlot.djUsername;
    if (singleUsername) {
      return [{ username: singleUsername, photoUrl: currentDjSlot.djPhotoUrl }];
    }

    // Also check show-level for remote broadcasts
    if (currentShow?.liveDjUsername) {
      return [{ username: currentShow.liveDjUsername, photoUrl: currentShow.liveDjPhotoUrl }];
    }

    return [];
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
                djProfileUsername={djProfileUsername}
                djProfiles={djProfiles}
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
                currentDJUserId={currentShow?.djUserId || currentShow?.liveDjUserId}
                currentDJEmail={currentShow?.djEmail}
                showName={currentShow?.showName}
                broadcastSlotId={currentShow?.id}
                isLive={isLive}
                profileLoading={profileLoading}
                currentShowStartTime={currentShow?.startTime}
                onSetUsername={setChatUsername}
              />
            </div>
          </div>

          {/* Bottom section: TV Guide (full width) - always visible */}
          <div className="flex-1 min-h-[300px] p-4 overflow-y-auto">
            <TVGuideSchedule onAuthRequired={handleAuthRequired} />
          </div>
        </div>

        {/* Mobile layout */}
        <div className="lg:hidden flex flex-col overflow-y-auto">
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
              djProfileUsername={djProfileUsername}
              djProfiles={djProfiles}
            />
          </div>

          {/* Chat */}
          <div className="flex-shrink-0 px-4 pb-4">
            <div className="bg-surface-card rounded-xl overflow-hidden" style={{ height: '300px' }}>
              <ListenerChatPanel
                isAuthenticated={isAuthenticated}
                username={username}
                userId={user?.uid}
                currentDJ={currentDJ}
                currentDJUserId={currentShow?.djUserId || currentShow?.liveDjUserId}
                currentDJEmail={currentShow?.djEmail}
                showName={currentShow?.showName}
                broadcastSlotId={currentShow?.id}
                isLive={isLive}
                profileLoading={profileLoading}
                currentShowStartTime={currentShow?.startTime}
                onSetUsername={setChatUsername}
              />
            </div>
          </div>

          {/* Coming Up Next */}
          <div className="flex-shrink-0 px-4 pb-4">
            <ComingUpNext onAuthRequired={handleAuthRequired} />
          </div>

          {/* TV Guide Schedule at the bottom */}
          <div className="flex-shrink-0 p-4 pt-0">
            <TVGuideSchedule onAuthRequired={handleAuthRequired} />
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
    </div>
  );
}
