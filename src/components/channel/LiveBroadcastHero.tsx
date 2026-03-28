'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useBroadcastSchedule } from '@/hooks/useBroadcastSchedule';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { BroadcastSchedule } from './BroadcastSchedule';
import { FloatingHearts } from './FloatingHearts';
import { TipButton } from './TipButton';
import { AuthModal } from '@/components/AuthModal';
import { ChatMessageSerialized } from '@/types/broadcast';
import { normalizeUrl } from '@/lib/url';
import { useBPM } from '@/contexts/BPMContext';
import { useFavorites } from '@/hooks/useFavorites';

/** Horizontally scrolling text when content overflows its container */
export function ScrollingShowName({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);
  const [scrollDistance, setScrollDistance] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;
    const overflow = textEl.scrollWidth > container.clientWidth;
    setNeedsScroll(overflow);
    if (overflow) {
      setScrollDistance(textEl.scrollWidth - container.clientWidth);
    }
  }, [text]);

  return (
    <div ref={containerRef} className={`overflow-hidden ${className || ''}`}>
      <span
        ref={textRef}
        className={`inline-block whitespace-nowrap ${needsScroll ? 'animate-show-scroll' : ''}`}
        style={needsScroll ? {
          '--scroll-distance': `-${scrollDistance}px`,
        } as React.CSSProperties : undefined}
      >
        {text}
      </span>
      <style jsx>{`
        @keyframes show-scroll {
          0%, 15% {
            transform: translateX(0);
          }
          45%, 55% {
            transform: translateX(var(--scroll-distance));
          }
          85%, 100% {
            transform: translateX(0);
          }
        }
        .animate-show-scroll {
          animation: show-scroll 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

/** Vertically scrolling text capped at a max number of lines */
export function ScrollingDJName({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);
  const [scrollDistance, setScrollDistance] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;
    const overflow = textEl.scrollHeight > container.clientHeight;
    setNeedsScroll(overflow);
    if (overflow) {
      setScrollDistance(textEl.scrollHeight - container.clientHeight);
    }
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden ${className || ''}`}
      style={{ maxHeight: '2.6em' }}
    >
      <div
        ref={textRef}
        className={needsScroll ? 'animate-dj-scroll' : ''}
        style={needsScroll ? {
          '--scroll-distance': `-${scrollDistance}px`,
        } as React.CSSProperties : undefined}
      >
        {text}
      </div>
      <style jsx>{`
        @keyframes dj-scroll {
          0%, 15% {
            transform: translateY(0);
          }
          45%, 55% {
            transform: translateY(var(--scroll-distance));
          }
          85%, 100% {
            transform: translateY(0);
          }
        }
        .animate-dj-scroll {
          animation: dj-scroll 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

const RESERVED_USERNAMES = ['channel', 'admin', 'system', 'moderator', 'mod'];

function isValidUsername(username: string): boolean {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 20) return false;
  const handle = trimmed.replace(/\s+/g, '');
  if (handle.length < 2) return false;
  if (RESERVED_USERNAMES.includes(handle.toLowerCase())) return false;
  return /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed);
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

export function HeroChatMessage({
  message,
  isOwnMessage,
  currentLiveDjUsername,
}: {
  message: ChatMessageSerialized;
  isOwnMessage: boolean;
  currentLiveDjUsername?: string;
}) {
  const timeAgo = formatTimeAgo(message.timestamp);
  const isCurrentlyLiveDJ = !!(currentLiveDjUsername && message.username.toLowerCase() === currentLiveDjUsername.toLowerCase());

  if (message.messageType === 'promo') return null;

  if (message.messageType === 'love' || message.message?.includes(' is ❤️')) {
    const heartCount = Math.min(message.heartCount || 1, 10);
    const hearts = '❤️'.repeat(heartCount);
    const displayMessage = message.message.replace(' is ❤️', ` is ${hearts}`);
    return (
      <div className="py-2 px-4 flex items-center justify-between">
        <span className="text-white">{displayMessage}</span>
        <span className="text-gray-600 text-xs">{timeAgo}</span>
      </div>
    );
  }

  if (message.messageType === 'tip') {
    return (
      <div className="py-2 px-4 text-green-400 font-medium">
        {message.message}
      </div>
    );
  }

  return (
    <div className={`py-2 px-4 ${isOwnMessage ? 'bg-white/5' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${isCurrentlyLiveDJ ? 'text-white' : 'text-gray-400'}`}>
              {message.username}
            </span>
            {isCurrentlyLiveDJ && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Live DJ" />
            )}
            <span className="text-gray-600 text-xs">{timeAgo}</span>
          </div>
          <p className="text-white mt-1">{message.message}</p>
        </div>
      </div>
    </div>
  );
}

/** Overlay on DJ image showing name, genres, and auto-scrolling description */
function DJImageOverlay({
  djName,
  djGenres,
  djDescription,
}: {
  djName: string | null;
  djGenres: string[];
  djDescription: string | null;
}) {
  const descriptionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [needsScroll, setNeedsScroll] = useState(false);
  const [scrollDistance, setScrollDistance] = useState(0);

  // Measure whether description overflows 2 lines and calculate scroll distance
  useEffect(() => {
    const desc = descriptionRef.current;
    const container = containerRef.current;
    if (!desc || !container) return;
    const overflow = desc.scrollHeight > container.clientHeight;
    setNeedsScroll(overflow);
    if (overflow) {
      setScrollDistance(desc.scrollHeight - container.clientHeight);
    }
  }, [djDescription]);

  // Genre line: "DJ NAME - GENRE1 · GENRE2" or just "DJ NAME"
  const genreText = djGenres.length > 0 ? djGenres.join(' · ') : null;

  return (
    <div className="absolute bottom-2 left-2 right-2 drop-shadow-lg">
      {/* DJ Name + Genre on one line */}
      <div className="text-xs font-black uppercase tracking-wider text-white whitespace-nowrap overflow-hidden">
        {djName}
        {genreText && (
          <span className="font-medium tracking-[0.15em] text-zinc-300"> - {genreText}</span>
        )}
      </div>

      {/* Description — max 2 visible lines, auto-scrolls if longer */}
      {djDescription && (
        <div
          ref={containerRef}
          className="mt-1 overflow-hidden"
          style={{ maxHeight: '2.6em' }}
        >
          <div
            ref={descriptionRef}
            className={`text-[11px] leading-[1.3em] text-zinc-300 font-light ${needsScroll ? 'animate-desc-scroll' : ''}`}
            style={needsScroll ? {
              '--scroll-distance': `-${scrollDistance}px`,
            } as React.CSSProperties : undefined}
          >
            {djDescription}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes desc-scroll {
          0%, 15% {
            transform: translateY(0);
          }
          45%, 55% {
            transform: translateY(var(--scroll-distance));
          }
          85%, 100% {
            transform: translateY(0);
          }
        }
        .animate-desc-scroll {
          animation: desc-scroll 10s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export function LiveBroadcastHero({ jumpToEarliestShow, initialScheduleDate }: { jumpToEarliestShow?: boolean; initialScheduleDate?: Date } = {}) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, loading: profileLoading, setChatUsername } = useUserProfile(user?.uid);

  const {
    isPlaying, isLoading, isLive, isStreaming, currentShow, currentDJ,
    listenerCount, toggle, error: streamError,
    setHeroBarVisible, tipEligible,
  } = useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const broadcastBPM = stationBPM['broadcast']?.bpm ?? null;

  // Avoid hydration mismatch — isLive is always false on the server
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Determine the current DJ's chat room from live broadcast data
  const computeDJChatRoom = useCallback(() => {
    if (!currentShow) return '';
    const normalize = (u: string) => u.replace(/[\s-]+/g, '').toLowerCase();
    if (currentShow.djSlots && currentShow.djSlots.length > 0) {
      const now = Date.now();
      const slot = currentShow.djSlots.find(s => s.startTime <= now && s.endTime > now);
      const username = slot?.liveDjUsername || slot?.djUsername || slot?.djName;
      if (username) return normalize(username);
    }
    const username = currentShow.liveDjUsername || currentShow.djUsername || currentShow.djName;
    return username ? normalize(username) : '';
  }, [currentShow]);

  const [currentDJChatRoom, setCurrentDJChatRoom] = useState(() => computeDJChatRoom());

  // Re-evaluate chat room when show data changes, and on a timer for venue DJ transitions
  useEffect(() => {
    setCurrentDJChatRoom(computeDJChatRoom());

    // For venue broadcasts with multiple DJs, poll every 30s to detect DJ transitions
    const isVenue = currentShow?.djSlots && currentShow.djSlots.length > 1;
    if (!isVenue) return;

    const interval = setInterval(() => {
      setCurrentDJChatRoom(computeDJChatRoom());
    }, 30000);

    return () => clearInterval(interval);
  }, [computeDJChatRoom, currentShow?.djSlots]);

  const { messages, sendMessage, sendLove, currentPromo, loveCount } = useDJProfileChat({
    chatUsernameNormalized: currentDJChatRoom,
    djUsername: currentDJ || currentShow?.djName || '',
    username: chatUsername || undefined,
    enabled: !!currentDJChatRoom,
    currentShowStartTime: currentShow?.startTime,
  });

  const { shows: scheduleShows, loading: scheduleLoading, selectedDate, setSelectedDate } = useBroadcastSchedule({
    ...(jumpToEarliestShow && { jumpToEarliestShow: true }),
    ...(initialScheduleDate && { initialDate: initialScheduleDate }),
  });

  const { isInWatchlist, followDJ, removeFromWatchlist } = useFavorites();
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);

  const [activeTab, setActiveTab] = useState<'chat' | 'schedule'>('chat');
  const [heartTrigger, setHeartTrigger] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [imageError, setImageError] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const stickyBarRef = useRef<HTMLDivElement>(null);

  // Username setup state
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);

  // Auto-scroll chat
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Track player bar visibility — GlobalBroadcastBar shows when this scrolls out of view
  useEffect(() => {
    const el = stickyBarRef.current;
    if (!el) return;
    setHeroBarVisible(true);
    const observer = new IntersectionObserver(
      ([entry]) => setHeroBarVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHeroBarVisible(false);
    };
  }, [setHeroBarVisible]);

  // DJ info from current show
  // For restreams, also check the primary DJ's photo from restreamDjs
  const primaryRestreamDjPhoto = (() => {
    if (!currentShow?.restreamDjs || currentShow.restreamDjs.length === 0) return null;
    const primary = currentShow.restreamDjs.find(dj => dj.userId)
      || currentShow.restreamDjs.find(dj => dj.username)
      || null;
    return primary?.photoUrl || null;
  })();
  const djPhotoUrl = currentShow?.showImageUrl || currentShow?.liveDjPhotoUrl || primaryRestreamDjPhoto || null;
  const showName = currentShow?.showName || 'Live Now';
  const djName = currentDJ || currentShow?.djName || null;
  const hasPhoto = djPhotoUrl && !imageError;
  const djGenres = currentShow?.liveDjGenres || [];
  const djDescription = currentShow?.liveDjDescription || null;
  const isRestream = currentShow?.broadcastType === 'restream';

  // DJ profile username for linking
  // For restreams with multiple DJs, link to the primary DJ (channel user first, then pending DJ)
  const djProfileUsername = (() => {
    if (!currentShow) return null;
    if (currentShow.restreamDjs && currentShow.restreamDjs.length > 0) {
      const primary = currentShow.restreamDjs.find(dj => dj.userId)
        || currentShow.restreamDjs.find(dj => dj.username)
        || null;
      if (primary?.username) return primary.username;
    }
    if (currentShow.djSlots && currentShow.djSlots.length > 0) {
      const now = Date.now();
      const slot = currentShow.djSlots.find(s => s.startTime <= now && s.endTime > now);
      if (slot) return slot.liveDjUsername || slot.djUsername || null;
    }
    return currentShow.liveDjUsername || currentShow.djUsername || null;
  })();

  // Get DJ identity for tips
  const currentDJUserId = (() => {
    if (!currentShow) return null;
    if (currentShow.djSlots && currentShow.djSlots.length > 0) {
      const now = Date.now();
      const slot = currentShow.djSlots.find(s => s.startTime <= now && s.endTime > now);
      if (slot) return slot.liveDjUserId || slot.djUserId || null;
    }
    return currentShow.liveDjUserId || currentShow.djUserId || null;
  })();

  const currentDJEmail = (() => {
    if (!currentShow) return null;
    if (currentShow.djSlots && currentShow.djSlots.length > 0) {
      const now = Date.now();
      const slot = currentShow.djSlots.find(s => s.startTime <= now && s.endTime > now);
      if (slot) return slot.djEmail || null;
    }
    return currentShow.djEmail || null;
  })();

  // Promo display
  const promoToShow = (() => {
    if (currentShow?.broadcastType === 'venue') {
      if (currentShow.djSlots && currentShow.djSlots.length > 0) {
        const now = Date.now();
        const slot = currentShow.djSlots.find(s => s.startTime <= now && s.endTime > now);
        if (slot?.promoText || slot?.djPromoText) {
          return {
            text: slot.promoText || slot.djPromoText || '',
            hyperlink: slot.promoHyperlink || slot.djPromoHyperlink,
            username: slot.liveDjUsername || slot.djName || currentDJ,
          };
        }
      }
      if (currentShow.showPromoText) {
        return { text: currentShow.showPromoText, hyperlink: currentShow.showPromoHyperlink, username: currentDJ };
      }
      return null;
    }
    if (currentPromo?.promoText) {
      return { text: currentPromo.promoText, hyperlink: currentPromo.promoHyperlink, username: currentPromo.username };
    }
    return null;
  })();

  const djWatchlistName = currentDJ || currentShow?.djName || '';
  const isDJInWatchlist = djWatchlistName ? isInWatchlist(djWatchlistName) : false;

  const handleToggleWatchlist = useCallback(async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setIsAddingToWatchlist(true);
    try {
      if (isDJInWatchlist) {
        await removeFromWatchlist(djWatchlistName);
      } else {
        await followDJ(djWatchlistName, currentDJUserId || undefined, currentDJEmail || undefined);
      }
    } catch (err) {
      console.error('Failed to update watchlist:', err);
    } finally {
      setIsAddingToWatchlist(false);
    }
  }, [isAuthenticated, isDJInWatchlist, djWatchlistName, currentDJUserId, currentDJEmail, followDJ, removeFromWatchlist]);

  const handleSendLove = useCallback(async () => {
    if (!chatUsername) return;
    setHeartTrigger((prev) => prev + 1);
    try {
      await sendLove();
    } catch (err) {
      console.error('Failed to send love:', err);
    }
  }, [chatUsername, sendLove]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSending || !chatUsername) return;
    setIsSending(true);
    try {
      await sendMessage(chatInput.trim());
      setChatInput('');
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleSetUsername = async () => {
    const trimmed = usernameInput.trim();
    if (!isValidUsername(trimmed)) {
      setUsernameError('Invalid username. Use 2-20 characters, letters and numbers only.');
      return;
    }
    setIsCheckingUsername(true);
    setUsernameError('');
    const result = await setChatUsername(trimmed);
    setIsCheckingUsername(false);
    if (!result.success) {
      setUsernameError(result.error || 'Username already taken. Try another one.');
    }
  };

  if (!mounted || !isLive || !isStreaming || !currentShow) return null;

  return (
    <section id="live" className="relative z-10 px-4 pt-6 pb-2">
      <div className="max-w-3xl mx-auto">

        {/* Live/Restream status line above image */}
        <div className="flex items-center justify-end gap-1.5 mb-2">
          {isRestream ? (
            <>
              <span className="flex h-3 w-3">
                <svg className="animate-pulse w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </span>
              <span className="text-[10px] font-mono text-gray-400 uppercase tracking-tighter font-bold">Restream</span>
              {broadcastBPM && (
                <span className="text-[10px] font-mono text-gray-400 uppercase tracking-tighter font-bold">{broadcastBPM} BPM</span>
              )}
            </>
          ) : (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
              </span>
              <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold">Live</span>
              {broadcastBPM && (
                <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold">{broadcastBPM} BPM</span>
              )}
            </>
          )}
        </div>

        {/* DJ Image — 16:9 with overlays */}
        {djProfileUsername ? (
          <Link href={`/dj/${djProfileUsername}`} className="block relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={djPhotoUrl}
                  alt={djName || 'DJ'}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                {/* Gradient scrims */}
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
                {/* DJ info overlay — bottom left */}
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
                  src={djPhotoUrl}
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

        {/* Player bar: Play + Show Info + Live + Love + Tip */}
        <div ref={stickyBarRef} className="bg-black border-b border-white/10">
          <div className="flex items-center gap-3 py-2 px-1">
            {/* Play/Pause */}
            <button
              onClick={toggle}
              disabled={!isLive}
              className="w-10 h-10 flex items-center justify-center bg-white disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {isLoading ? (
                <svg className="w-5 h-5 animate-spin text-black" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : isPlaying ? (
                <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Show info */}
            <div className="flex-1 min-w-0">
              <ScrollingShowName text={showName} className="text-sm font-bold leading-tight text-white" />
              {djName && (
                <ScrollingDJName text={djName} className="text-[10px] text-zinc-500 uppercase mt-0.5 leading-[1.3em]" />
              )}
            </div>

            {/* Live/Restream indicator + BPM */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isRestream ? (
                <span className="flex h-3 w-3">
                  <svg className="animate-pulse w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </span>
              ) : (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                </span>
              )}
              {broadcastBPM && (
                <span className={`text-[10px] font-mono uppercase tracking-tighter font-bold ${isRestream ? 'text-gray-500' : 'text-red-500'}`}>
                  {broadcastBPM} BPM
                </span>
              )}
            </div>

            {/* Love Button */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => {
                  if (!isAuthenticated) { setShowAuthModal(true); return; }
                  if (!chatUsername) return;
                  handleSendLove();
                }}
                className="w-10 h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </button>
              <FloatingHearts trigger={heartTrigger} />
            </div>

            {/* Tip Button */}
            {tipEligible && currentShow && (
              <TipButton
                tipperUserId={user?.uid}
                tipperUsername={chatUsername || undefined}
                djUserId={currentDJUserId || undefined}
                djEmail={currentDJEmail || undefined}
                djUsername={currentDJ || 'DJ'}
                broadcastSlotId={currentShow.id}
                showName={showName}
                className="w-10 h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
              />
            )}
          </div>
          {streamError && (
            <p className="text-red-400 text-xs pb-2">{streamError}</p>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${
              activeTab === 'chat' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <span>Chat</span>
              {listenerCount > 0 && (
                <span className="flex items-center gap-1 text-zinc-500 text-xs">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3a9 9 0 00-9 9v7c0 1.1.9 2 2 2h2c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2H5v-1a7 7 0 1114 0v1h-2c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h2c1.1 0 2-.9 2-2v-7a9 9 0 00-9-9z" />
                  </svg>
                  {listenerCount}
                </span>
              )}
              {loveCount > 0 && (
                <span className="flex items-center gap-1 text-zinc-500 text-xs">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  {loveCount}
                </span>
              )}
            </div>
            {activeTab === 'chat' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </button>
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
        </div>

        {/* Tab Content */}
        {activeTab === 'chat' ? (
          <div className="flex flex-col h-[45vh] lg:h-[38vh]">
            {/* Promo bar */}
            {promoToShow && promoToShow.username && (() => {
              const hasHyperlink = !!promoToShow.hyperlink;
              const content = (
                <div className={`px-4 py-3 bg-white/5 border-b border-white/10 ${hasHyperlink ? 'hover:bg-white/10 cursor-pointer' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-semibold text-sm">{promoToShow.username}</span>
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Live DJ" />
                    {hasHyperlink && (
                      <svg className="w-4 h-4 text-zinc-400 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    )}
                  </div>
                  <p className={`text-sm ${hasHyperlink ? 'text-white underline' : 'text-white'}`}>
                    {promoToShow.text}
                  </p>
                </div>
              );
              if (hasHyperlink) {
                return (
                  <a href={normalizeUrl(promoToShow.hyperlink!)} target="_blank" rel="noopener noreferrer" className="block transition-colors">
                    {content}
                  </a>
                );
              }
              return content;
            })()}

            {/* Auth states */}
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
                          currentLiveDjUsername={currentDJ || undefined}
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
        ) : (
          <div className="py-4 overflow-y-auto h-[22vh] lg:h-[18vh]">
            <BroadcastSchedule
              shows={scheduleShows}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              loading={scheduleLoading}
            />
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
