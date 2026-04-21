'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { computeDJChatRoom } from '@/lib/broadcast-utils';
import { HeroChatMessage } from './LiveBroadcastHero';
import { AuthModal } from '@/components/AuthModal';

export function FloatingChat() {
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);
  const { isLive, isStreaming, isPlaying, currentShow, currentDJ } = useBroadcastStreamContext();
  const archivePlayer = useArchivePlayer();

  const [isOpen, setIsOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const liveDjName = currentDJ || currentShow?.djName || null;

  // Follow venue multi-DJ slot transitions (mirror ChannelClient).
  const [liveDJChatRoom, setLiveDJChatRoom] = useState(() => computeDJChatRoom(currentShow ?? null));
  useEffect(() => {
    setLiveDJChatRoom(computeDJChatRoom(currentShow ?? null));
    const isVenue = currentShow?.djSlots && currentShow.djSlots.length > 1;
    if (!isVenue) return;
    const interval = setInterval(() => {
      setLiveDJChatRoom(computeDJChatRoom(currentShow ?? null));
    }, 30000);
    return () => clearInterval(interval);
  }, [currentShow]);

  const isLiveReady = isLive && isStreaming;
  const isLivePlaying = isLiveReady && isPlaying;
  const isArchivePlaying = archivePlayer.isPlaying || archivePlayer.isLoading;
  const archiveForWrite = archivePlayer.currentArchive || archivePlayer.featuredArchive;
  const archivePrimaryDj = archiveForWrite?.djs[0];
  const archiveDjRoom = archivePrimaryDj?.username?.replace(/\s+/g, '').toLowerCase() || '';
  const archiveDjName = archiveForWrite?.djs.map(d => d.name).join(', ') || '';

  // Route writes to whatever the listener is actively consuming. Same priority
  // as GlobalBroadcastBar's barMode so loves/locked-in and messages agree.
  let writeChatRoom = 'channelbroadcast';
  let writeDJLabel = 'Channel Radio';
  let writeIsArchive = false;
  let writeDjPhotoUrl: string | undefined;
  if (isLivePlaying && liveDJChatRoom) {
    writeChatRoom = liveDJChatRoom;
    writeDJLabel = liveDjName || 'Channel Radio';
  } else if (isArchivePlaying && archiveDjRoom) {
    writeChatRoom = archiveDjRoom;
    writeDJLabel = archiveDjName || 'Channel Radio';
    writeIsArchive = true;
    writeDjPhotoUrl = archivePrimaryDj?.photoUrl;
  } else if (isLiveReady && liveDJChatRoom) {
    writeChatRoom = liveDJChatRoom;
    writeDJLabel = liveDjName || 'Channel Radio';
  } else if (archiveForWrite && archiveDjRoom) {
    writeChatRoom = archiveDjRoom;
    writeDJLabel = archiveDjName || 'Channel Radio';
    writeIsArchive = true;
    writeDjPhotoUrl = archivePrimaryDj?.photoUrl;
  }

  // Displayed chat is always the unified channelbroadcast feed. All DJ-room
  // writes (messages, loves, locked-in) cross-post into channelbroadcast, so
  // activity from the DJ the listener is on still surfaces here.
  const { messages } = useDJProfileChat({
    chatUsernameNormalized: 'channelbroadcast',
    djUsername: 'Channel Radio',
    username: chatUsername || undefined,
    enabled: true,
  });

  const { sendMessage } = useDJProfileChat({
    chatUsernameNormalized: writeChatRoom,
    djUsername: writeDJLabel,
    username: chatUsername || undefined,
    enabled: false,
    currentShowStartTime: writeChatRoom === liveDJChatRoom ? currentShow?.startTime : undefined,
    userId: user?.uid,
    djPhotoUrl: writeDjPhotoUrl,
    isArchivePlayback: writeIsArchive,
  });

  // Count regular chat messages (exclude love, lockedin, tip)
  const messageCount = messages.filter(m => !m.messageType || m.messageType === 'chat').length;

  // Auto-scroll chat
  useEffect(() => {
    if (!isOpen) return;
    const container = messagesContainerRef.current;
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [messages, isOpen]);

  const handleToggle = useCallback(() => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setIsOpen(prev => !prev);
  }, [isAuthenticated]);

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
      const result = await setChatUsername(trimmed);
      if (!result.success) {
        setUsernameError(result.error || 'Username already taken. Try another one.');
      }
    } catch {
      setUsernameError('Username taken or error occurred');
    } finally {
      setIsCheckingUsername(false);
    }
  }, [usernameInput, setChatUsername]);

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

  // Hide on /dj/*, /studio/*, /broadcast/*
  if (pathname.startsWith('/dj/') || pathname.startsWith('/studio') || pathname.startsWith('/broadcast')) return null;

  return (
    <>
      {/* Scrim */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[200] transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Chat sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[201] transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="max-w-lg mx-auto bg-zinc-900 border border-white/10 rounded-t-xl overflow-hidden" style={{ height: '60vh' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Chat</span>
              {messageCount > 0 && (
                <span className="text-zinc-500 text-xs">
                  {messageCount} message{messageCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          {profileLoading ? (
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
            <div className="flex flex-col" style={{ height: 'calc(60vh - 49px)' }}>
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
                        currentLiveDjUsername={isLive ? (currentDJ || currentShow?.djName) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
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
            </div>
          )}
        </div>
      </div>

      {/* Floating button */}
      <button
        onClick={handleToggle}
        className="fixed bottom-4 right-4 z-[199] w-10 h-10 md:w-12 md:h-12 rounded-full bg-zinc-800/80 backdrop-blur border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700/80 transition-colors"
      >
        {isOpen ? (
          <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {messageCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-zinc-700 border border-white/10 text-[10px] text-white font-medium flex items-center justify-center">
                {messageCount}
              </span>
            )}
          </>
        )}
      </button>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to join the chat"
      />
    </>
  );
}
