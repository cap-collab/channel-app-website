'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { CompactPlayer } from '@/components/channel/CompactPlayer';
import { NextFavoriteShow } from '@/components/channel/NextFavoriteShow';
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
  const [activeTab, setActiveTab] = useState<'chat' | 'schedule'>('schedule');
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
  const { isShowFavorited, toggleFavorite } = useFavorites();

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

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      {/* Use shared Header with profile icon */}
      <Header currentPage="channel" position="sticky" />

      {/* Main content - flex-1 and min-h-0 to fill remaining space */}
      <main className="max-w-7xl mx-auto flex-1 min-h-0 w-full flex flex-col">
        {/* Desktop layout */}
        <div className="hidden lg:flex lg:flex-col lg:h-full">
          {/* Top section: Player + Search + Favorites | Chat */}
          <div className="flex-shrink-0 flex border-b border-gray-800 items-stretch">
            {/* Left column: Player + Search/Favorites */}
            <div className="flex-1 p-4 space-y-4">
              {/* Compact Player */}
              <CompactPlayer
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
              />

              {/* Search + Favorites */}
              <NextFavoriteShow onAuthRequired={handleAuthRequired} currentShow={currentShowAsShow} currentDJ={currentDJ} />
            </div>

            {/* Right column: Chat - fixed height, scrolls internally */}
            <div className="w-80 border-l border-gray-800 flex flex-col p-4 max-h-[500px]">
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
        <div className="lg:hidden flex flex-col h-full">
          {/* Compact Player */}
          <div className="flex-shrink-0 p-4 pb-2">
            <CompactPlayer
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
            />
          </div>

          {/* Search + Favorites */}
          <div className="flex-shrink-0 px-4 pb-2">
            <NextFavoriteShow onAuthRequired={handleAuthRequired} currentShow={currentShowAsShow} currentDJ={currentDJ} />
          </div>

          {/* Tab navigation */}
          <div className="flex-shrink-0 flex border-b border-gray-800">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'schedule'
                  ? 'text-white border-b-2 border-accent'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Schedule
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'chat'
                  ? 'text-white border-b-2 border-accent'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Chat
            </button>
          </div>

          {/* Tab content - min-h-0 is critical for flex children to shrink properly */}
          <div className="flex-1 min-h-0">
            {activeTab === 'schedule' ? (
              <div className="h-full overflow-y-auto p-4">
                <TVGuideSchedule onAuthRequired={handleAuthRequired} />
              </div>
            ) : (
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
                onSetUsername={setChatUsername}
              />
            )}
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
