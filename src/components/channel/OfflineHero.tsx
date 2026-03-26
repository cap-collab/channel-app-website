'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useBroadcastSchedule } from '@/hooks/useBroadcastSchedule';
import { BroadcastSchedule } from '@/components/channel/BroadcastSchedule';
import { AuthModal } from '@/components/AuthModal';
import { HeroChatMessage } from '@/components/channel/LiveBroadcastHero';
import { addDoc, collection, getFirestore } from 'firebase/firestore';

export function OfflineHero({ jumpToEarliestShow }: { jumpToEarliestShow?: boolean } = {}) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);

  const [activeTab, setActiveTab] = useState<'schedule' | 'chat'>('schedule');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Chat connected to channelbroadcast room
  const { messages, sendMessage } = useDJProfileChat({
    chatUsernameNormalized: 'channelbroadcast',
    djUsername: 'Channel Radio',
    username: chatUsername || undefined,
    enabled: true,
  });

  // Schedule
  const { shows: scheduleShows, loading: scheduleLoading, selectedDate, setSelectedDate } = useBroadcastSchedule({ jumpToEarliestShow });

  // Auto-scroll chat
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Email notification
  const handleNotifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!notifyEmail.trim()) return;
    setNotifyStatus('submitting');
    try {
      const db = getFirestore();
      await addDoc(collection(db, 'radioNotifyEmails'), {
        email: notifyEmail.trim(),
        createdAt: new Date(),
      });
      setNotifyStatus('success');
    } catch {
      setNotifyStatus('error');
    }
  };

  // Username setup
  const handleSetUsername = useCallback(async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 2 || trimmed.length > 20) {
      setUsernameError('Username must be 2-20 characters');
      return;
    }
    if (!/^[a-zA-Z0-9 ]+$/.test(trimmed)) {
      setUsernameError('Letters, numbers, and spaces only');
      return;
    }
    setIsCheckingUsername(true);
    try {
      await setChatUsername(trimmed);
    } catch {
      setUsernameError('Username taken or error occurred');
    } finally {
      setIsCheckingUsername(false);
    }
  }, [usernameInput, setChatUsername]);

  // Send message
  const handleSendMessage = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSending) return;
    setIsSending(true);
    try {
      await sendMessage(chatInput.trim());
      setChatInput('');
    } finally {
      setIsSending(false);
    }
  }, [chatInput, isSending, sendMessage]);

  return (
    <section className="relative z-10 px-4 pt-6 pb-2">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="text-center py-10 md:py-14">
          <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter leading-none mb-3">Channel Radio</h1>
          <p className="text-lg text-zinc-400 mb-8">We&apos;ll be back online soon</p>

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
          </div>
          <p className="text-zinc-500 text-sm mt-6">
            DJs, producers, collectives — reach out to{' '}
            <a href="mailto:djshows@channel-app.com" className="text-white hover:underline">djshows@channel-app.com</a>
            {' '}to host a show or claim your profile
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${
              activeTab === 'schedule' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Schedule
            {activeTab === 'schedule' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${
              activeTab === 'chat' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Chat
            {activeTab === 'chat' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'schedule' ? (
          <div className="py-4 overflow-y-auto h-[30vh] lg:h-[25vh]">
            <BroadcastSchedule
              shows={scheduleShows}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              loading={scheduleLoading}
            />
          </div>
        ) : (
          <div className="flex flex-col h-[30vh] lg:h-[25vh]">
            {!isAuthenticated ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center">
                  <p className="text-zinc-400 mb-4">Sign in to join the chat</p>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="px-6 py-2 bg-white text-black font-medium text-sm hover:bg-gray-200 transition-colors"
                  >
                    Sign In
                  </button>
                </div>
              </div>
            ) : profileLoading ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <svg className="animate-spin h-8 w-8 text-zinc-500" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : !chatUsername ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-sm w-full">
                  <h3 className="text-white font-bold text-xl mb-2">Choose a Username</h3>
                  <p className="text-zinc-400 text-sm mb-6">This will be displayed in the chat</p>
                  <div className="text-left mb-4">
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={(e) => { setUsernameInput(e.target.value); if (usernameError) setUsernameError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && usernameInput.trim() && !isCheckingUsername) { e.preventDefault(); handleSetUsername(); } }}
                      placeholder="Username"
                      className="w-full px-4 py-3 bg-black border border-white/20 text-white placeholder-zinc-500 focus:outline-none focus:border-white/40"
                      maxLength={20}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      disabled={isCheckingUsername}
                    />
                    <p className="text-zinc-500 text-xs mt-2">2-20 characters, letters, numbers, and spaces</p>
                    {usernameError && <p className="text-red-400 text-xs mt-2">{usernameError}</p>}
                  </div>
                  <button
                    onClick={handleSetUsername}
                    disabled={!usernameInput.trim() || isCheckingUsername}
                    className="w-full bg-white hover:bg-gray-200 disabled:bg-zinc-700 disabled:cursor-not-allowed text-black disabled:text-zinc-400 font-medium py-3 transition-colors"
                  >
                    {isCheckingUsername ? 'Checking...' : 'Join Chat'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Messages */}
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
                  {messages.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-zinc-500">
                      <p>No messages yet. Start the conversation!</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {messages.map((msg) => (
                        <HeroChatMessage
                          key={msg.id}
                          message={msg}
                          isOwnMessage={msg.username === chatUsername}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Chat input */}
                <div className="border-t border-white/10 p-3">
                  <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Message..."
                      className="flex-1 min-w-0 bg-black text-white text-sm border border-white/20 px-3 py-2 focus:outline-none focus:border-white/40 disabled:text-zinc-500 disabled:cursor-not-allowed"
                      maxLength={280}
                      disabled={isSending}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isSending}
                      className="flex-shrink-0 bg-white hover:bg-gray-200 disabled:bg-zinc-700 disabled:cursor-not-allowed text-black disabled:text-zinc-400 p-2 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </form>
                  <p className="text-zinc-500 text-xs mt-2">
                    Chatting as <span className="text-white">{chatUsername}</span>
                  </p>
                </div>
              </>
            )}
          </div>
        )}

      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to join the chat"
      />
    </section>
  );
}
