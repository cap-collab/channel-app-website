'use client';

import { useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { NowPlayingPanel } from '@/components/channel/NowPlayingPanel';
import { ListenerChatPanel } from '@/components/channel/ListenerChatPanel';
import { BroadcastSchedule } from '@/components/channel/BroadcastSchedule';
import { useBroadcastStream } from '@/hooks/useBroadcastStream';
import { useBroadcastSchedule } from '@/hooks/useBroadcastSchedule';

export function ChannelClient() {
  const { user, isAuthenticated } = useAuthContext();
  const [activeTab, setActiveTab] = useState<'chat' | 'schedule'>('chat');

  const {
    isPlaying,
    isLoading,
    isLive,
    currentShow,
    currentDJ,
    hlsUrl,
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
    <div className="min-h-screen bg-black text-white">
      {/* Use shared Header with profile icon */}
      <Header currentPage="channel" position="sticky" />

      {/* Main content */}
      <main className="max-w-7xl mx-auto">
        {/* Desktop layout */}
        <div className="hidden lg:flex lg:h-[calc(100vh-64px)]">
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
                username={user?.displayName || undefined}
                hlsUrl={hlsUrl}
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
                currentShow={currentShow}
              />
            </div>
          </div>

          {/* Right column: Chat (full height) */}
          <div className="w-96 border-l border-gray-800 flex flex-col">
            <ListenerChatPanel
              isAuthenticated={isAuthenticated}
              username={user?.displayName || undefined}
              currentDJ={currentDJ}
            />
          </div>
        </div>

        {/* Mobile layout */}
        <div className="lg:hidden flex flex-col h-[calc(100vh-64px)]">
          {/* Compact Now Playing */}
          <div className="p-4 bg-gray-900/50">
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
              username={user?.displayName || undefined}
              compact
              hlsUrl={hlsUrl}
              error={error}
            />
          </div>

          {/* Tab navigation */}
          <div className="flex border-b border-gray-800">
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

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'chat' ? (
              <ListenerChatPanel
                isAuthenticated={isAuthenticated}
                username={user?.displayName || undefined}
                currentDJ={currentDJ}
              />
            ) : (
              <div className="h-full overflow-y-auto p-4">
                <BroadcastSchedule
                  shows={shows}
                  selectedDate={selectedDate}
                  onDateChange={setSelectedDate}
                  loading={scheduleLoading}
                  currentShow={currentShow}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
