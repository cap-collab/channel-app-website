'use client';

import { useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Header } from '@/components/Header';
import { NowPlayingPanel } from '@/components/channel/NowPlayingPanel';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { BroadcastSchedule } from '@/components/channel/BroadcastSchedule';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastSchedule } from '@/hooks/useBroadcastSchedule';
import { AnimatedBackground } from '@/components/AnimatedBackground';

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);
  const [activeTab, setActiveTab] = useState<'chat' | 'schedule'>('chat');

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
    loveCount,
    listenerCount,
    messageCount,
  } = useBroadcastStream();

  const {
    shows,
    selectedDate,
    setSelectedDate,
    loading: scheduleLoading,
  } = useBroadcastSchedule();

  return (
    <div className="h-[100dvh] text-white relative overflow-hidden flex flex-col">
      <AnimatedBackground />
      {/* Use shared Header with profile icon */}
      <Header currentPage="channel" position="sticky" />

      {/* Main content - flex-1 and min-h-0 to fill remaining space */}
      <main className="max-w-7xl mx-auto flex-1 min-h-0 w-full">
        {/* Desktop layout */}
        <div className="hidden lg:flex lg:h-full">
          {/* Left column: Now Playing + Schedule */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Now Playing Panel - Fixed */}
            <div className="flex-shrink-0 p-4 border-b border-gray-800">
              <NowPlayingPanel
                isPlaying={isPlaying}
                isLoading={isLoading}
                isLive={isLive}
                currentShow={currentShow}
                currentDJ={currentDJ}
                onTogglePlay={toggle}
                loveCount={loveCount}
                listenerCount={listenerCount}
                messageCount={messageCount}
                isAuthenticated={isAuthenticated}
                username={username}
                error={error}
              />
            </div>

            {/* Schedule - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4">
              <BroadcastSchedule
                shows={shows}
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
                loading={scheduleLoading}
                isAuthenticated={isAuthenticated}
                userId={user?.uid}
                username={username}
              />
            </div>
          </div>

          {/* Right column: Chat (full height) */}
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
              onSetUsername={setChatUsername}
            />
          </div>
        </div>

        {/* Mobile layout */}
        <div className="lg:hidden flex flex-col h-full">
          {/* Compact Now Playing */}
          <div className="flex-shrink-0 p-4 bg-[#252525]/50">
            <NowPlayingPanel
              isPlaying={isPlaying}
              isLoading={isLoading}
              isLive={isLive}
              currentShow={currentShow}
              currentDJ={currentDJ}
              onTogglePlay={toggle}
              loveCount={loveCount}
              listenerCount={listenerCount}
              messageCount={messageCount}
              isAuthenticated={isAuthenticated}
              username={username}
              compact
              error={error}
            />
          </div>

          {/* Tab navigation */}
          <div className="flex-shrink-0 flex border-b border-gray-800">
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
          </div>

          {/* Tab content - min-h-0 is critical for flex children to shrink properly */}
          <div className="flex-1 min-h-0">
            {activeTab === 'chat' ? (
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
            ) : (
              <div className="h-full overflow-y-auto p-4">
                <BroadcastSchedule
                  shows={shows}
                  selectedDate={selectedDate}
                  onDateChange={setSelectedDate}
                  loading={scheduleLoading}
                  isAuthenticated={isAuthenticated}
                  userId={user?.uid}
                  username={username}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
