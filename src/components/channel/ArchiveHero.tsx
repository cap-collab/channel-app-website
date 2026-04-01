'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useDJProfileInfo } from '@/hooks/useDJProfileInfo';
import { DJImageOverlay, ScrollingShowName, ScrollingDJName, HeroChatMessage } from './LiveBroadcastHero';
import { FloatingHearts } from './FloatingHearts';
import { TipButton } from './TipButton';
import { AuthModal } from '@/components/AuthModal';
import { ArchiveSerialized } from '@/types/broadcast';

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function formatDurationMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface ArchiveHeroProps {
  archives: ArchiveSerialized[];
  featuredArchive: ArchiveSerialized;
}

export function ArchiveHero({ archives, featuredArchive }: ArchiveHeroProps) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);
  const archivePlayer = useArchivePlayer();
  const { addToWatchlist, isInWatchlist } = useFavorites();

  // The currently displayed archive (either playing or featured)
  const displayedArchive = archivePlayer.currentArchive || featuredArchive;

  // Primary DJ info
  const primaryDJ = displayedArchive.djs[0];
  const djUsername = primaryDJ?.username;
  const djProfileUsername = djUsername?.replace(/\s+/g, '').toLowerCase();
  const djName = displayedArchive.djs.map((d) => d.name).join(', ');
  const djPhotoUrl = displayedArchive.showImageUrl || primaryDJ?.photoUrl;

  // Fetch DJ profile for genres, tip link, and bio
  const djProfile = useDJProfileInfo(djUsername);
  const djGenres = djProfile.genres;
  const tipLink = djProfile.tipButtonLink;
  const djDescription = djProfile.bio;

  // Image error state
  const [imageError, setImageError] = useState(false);
  const hasPhoto = djPhotoUrl && !imageError;

  // Email signup
  const [hasFiledEmail, setHasFiledEmail] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('radio-email-filed') === 'true'
  );
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyStatus, setNotifyStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const showEmailSignup = !isAuthenticated && !hasFiledEmail;

  const handleNotifySubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!notifyEmail.trim()) return;
    try {
      setNotifyStatus('submitting');
      const res = await fetch('/api/radio-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: notifyEmail.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setNotifyStatus('success');
      setNotifyEmail('');
      localStorage.setItem('radio-email-filed', 'true');
      setHasFiledEmail(true);
    } catch {
      setNotifyStatus('error');
    }
  };

  // Watchlist
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const isDJInWatchlist = djUsername ? isInWatchlist(djUsername) : false;

  const handleToggleWatchlist = useCallback(async () => {
    if (!djUsername) return;
    setIsAddingToWatchlist(true);
    try {
      await addToWatchlist(djUsername, primaryDJ?.userId, primaryDJ?.email);
    } finally {
      setIsAddingToWatchlist(false);
    }
  }, [djUsername, primaryDJ, addToWatchlist]);

  // Heart / Love
  const [heartTrigger, setHeartTrigger] = useState(0);
  const handleLove = () => setHeartTrigger((t) => t + 1);

  // Tab state
  const [activeTab, setActiveTab] = useState<'archives' | 'chat'>('archives');

  // Chat (reused from OfflineHero pattern)
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage } = useDJProfileChat({
    chatUsernameNormalized: 'channelbroadcast',
    djUsername: 'Channel Radio',
    username: chatUsername || undefined,
    enabled: true,
  });

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

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


  const showName = displayedArchive.showName;

  return (
    <section className="relative z-10 px-4 pt-6 pb-2">
      <div className="max-w-3xl mx-auto">

        {/* Archive status line above image */}
        <div className="flex items-center justify-end gap-1.5 mb-2">
          <ArchiveIcon className="w-3 h-3 text-gray-400" />
          <span className="text-xs font-mono text-gray-400 uppercase tracking-tighter font-bold">Archive</span>
        </div>

        {/* Hero Image — 16:9 mobile, 5:2 desktop */}
        {djProfileUsername ? (
          <Link href={`/dj/${djProfileUsername}`} className="block relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={djPhotoUrl!}
                  alt={djName || 'DJ'}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
                {/* Watchlist button — top right */}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleWatchlist(); }}
                  disabled={isAddingToWatchlist}
                  className={`absolute top-2 right-2 z-20 w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    isDJInWatchlist ? 'bg-white text-black' : 'bg-black/50 text-white hover:bg-black/70'
                  }`}
                >
                  {isAddingToWatchlist ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : isDJInWatchlist ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  )}
                </button>
                <DJImageOverlay djName={djName} djGenres={djGenres} djDescription={djDescription} />
              </>
            ) : (
              <div className="w-full h-full relative flex items-center justify-center bg-white/5">
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4 text-white">
                  {djName || showName}
                </h2>
              </div>
            )}
          </Link>
        ) : (
          <div className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={djPhotoUrl!}
                  alt={djName || 'DJ'}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
                <button
                  onClick={handleToggleWatchlist}
                  disabled={isAddingToWatchlist}
                  className={`absolute top-2 right-2 z-20 w-8 h-8 flex items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    isDJInWatchlist ? 'bg-white text-black' : 'bg-black/50 text-white hover:bg-black/70'
                  }`}
                >
                  {isAddingToWatchlist ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : isDJInWatchlist ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  )}
                </button>
                <DJImageOverlay djName={djName} djGenres={djGenres} djDescription={djDescription} />
              </>
            ) : (
              <div className="w-full h-full relative flex items-center justify-center bg-white/5">
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4 text-white">
                  {djName || showName}
                </h2>
              </div>
            )}
          </div>
        )}

        {/* Email signup bar — slim, between image and player */}
        {showEmailSignup && (
          <div className="bg-black border-b border-white/10 py-2 px-1">
            {notifyStatus === 'success' ? (
              <p className="text-green-400 text-sm text-center py-1">You&apos;re on the list!</p>
            ) : (
              <form onSubmit={handleNotifySubmit} className="flex gap-0">
                <input
                  type="email"
                  placeholder="Get really cool email updates"
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  required
                  className="bg-white/10 border border-white/20 rounded-l px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-white/40 min-w-0 flex-1"
                />
                <button
                  type="submit"
                  disabled={notifyStatus === 'submitting'}
                  className="bg-white/20 border border-white/20 border-l-0 rounded-r px-4 py-2 text-white text-sm font-medium hover:bg-white/30 transition-colors disabled:opacity-50 shrink-0"
                >
                  {notifyStatus === 'submitting' ? '...' : 'Submit'}
                </button>
              </form>
            )}
            {notifyStatus === 'error' && (
              <p className="text-red-400 text-xs mt-1 text-center">Something went wrong. Try again.</p>
            )}
          </div>
        )}

        {/* Player bar */}
        <div className="bg-black border-b border-white/10">
          <div className="flex gap-2 sm:gap-3 py-2 px-1">
            {/* Play/Pause — bigger, self-centered */}
            <button
              onClick={() => {
                if (archivePlayer.currentArchive) {
                  archivePlayer.toggle();
                } else {
                  archivePlayer.play(displayedArchive);
                }
              }}
              className="w-10 h-10 ml-1 flex items-center justify-center bg-white transition-colors flex-shrink-0 self-center"
            >
              {archivePlayer.isLoading ? (
                <svg className="w-5 h-5 animate-spin text-black" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : archivePlayer.isPlaying && archivePlayer.currentArchive?.id === displayedArchive.id ? (
                <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Right column: show info + progress bar */}
            <div className="flex-1 min-w-0">
              {/* Row 1: Show name + actions */}
              <div className="flex items-center gap-1">
                <ScrollingShowName text={showName} className="flex-1 min-w-0 text-sm font-bold leading-tight text-white" />
                <ArchiveIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-8 h-8 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink && (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-8 h-8 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                  />
                )}
              </div>

              {/* Row 2: DJ name */}
              {djName && (
                <ScrollingDJName text={djName} className="text-[10px] text-zinc-500 uppercase mt-0.5 leading-[1.3em]" />
              )}

              {/* Row 3: Progress bar — thin white fill, no dot */}
              <div className="mt-1.5">
                <div
                  className="relative w-full h-[3px] bg-white/10 rounded-full cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const dur = archivePlayer.duration || displayedArchive.duration || 1;
                    archivePlayer.seek(fraction * dur);
                  }}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-white rounded-full"
                    style={{
                      width: `${((archivePlayer.currentArchive?.id === displayedArchive.id ? archivePlayer.currentTime : 0) / (archivePlayer.duration || displayedArchive.duration || 1)) * 100}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                  <span>{formatTime(archivePlayer.currentArchive?.id === displayedArchive.id ? archivePlayer.currentTime : 0)}</span>
                  <span>{formatTime(archivePlayer.duration || displayedArchive.duration)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('archives')}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${
              activeTab === 'archives' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Archives
            {activeTab === 'archives' && (
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
        {activeTab === 'archives' ? (
          <div className="py-2 overflow-y-auto h-[30vh] lg:h-[25vh]">
            {archives.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <p>No archives yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {archives.map((archive) => (
                  <ArchiveRow
                    key={archive.id}
                    archive={archive}
                    isActive={archivePlayer.currentArchive?.id === archive.id}
                    isPlaying={archivePlayer.isPlaying && archivePlayer.currentArchive?.id === archive.id}
                    onPlay={() => archivePlayer.play(archive)}
                  />
                ))}
              </div>
            )}
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

function ArchiveRow({
  archive,
  isActive,
  isPlaying,
  onPlay,
}: {
  archive: ArchiveSerialized;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const djNames = archive.djs.map((d) => d.name).join(', ');
  const primaryUsername = archive.djs[0]?.username;
  const { genres } = useDJProfileInfo(primaryUsername);
  const genreText = genres.length > 0 ? genres.join(' · ') : null;
  const displayImage = archive.showImageUrl || archive.djs[0]?.photoUrl;

  return (
    <button
      onClick={onPlay}
      className={`w-full flex items-center gap-3 py-3 px-2 text-left transition-colors hover:bg-white/5 ${
        isActive ? 'bg-white/5' : ''
      }`}
    >
      {/* Image */}
      {displayImage ? (
        <div className="w-12 h-12 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
          <Image
            src={displayImage}
            alt={archive.showName}
            width={48}
            height={48}
            className="w-full h-full object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-lg bg-white/5 flex-shrink-0 flex items-center justify-center">
          <ArchiveIcon className="w-5 h-5 text-zinc-600" />
        </div>
      )}

      {/* Info — always 2 lines */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">
          {archive.showName}
          {genreText && (
            <span className="font-normal text-zinc-400"> - {genreText}</span>
          )}
        </div>
        <div className="text-xs text-zinc-500 truncate">
          {djNames}
          <span className="text-zinc-600 ml-2">{formatDurationMinutes(archive.duration)}</span>
        </div>
      </div>

      {/* Play indicator / chevron */}
      <div className="flex-shrink-0">
        {isPlaying ? (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-zinc-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </div>
    </button>
  );
}
