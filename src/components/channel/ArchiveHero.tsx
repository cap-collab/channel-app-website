'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useLoveHistory } from '@/hooks/useLoveHistory';
import { useDJProfileInfo } from '@/hooks/useDJProfileInfo';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useFilterContext } from '@/contexts/FilterContext';
import { matchesGenre as matchesGenreLib } from '@/lib/genres';
import { matchesCity } from '@/lib/city-detection';
import { useBroadcastSchedule } from '@/hooks/useBroadcastSchedule';
import { DJImageOverlay, ScrollingShowName, ScrollingDJName } from './LiveBroadcastHero';
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


function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ArchiveSeekBar({ currentTime, duration, onSeek }: { currentTime: number; duration: number; onSeek: (time: number) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragFraction, setDragFraction] = useState(0);

  const getFraction = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const commitSeek = useCallback((fraction: number) => {
    onSeek(fraction * duration);
  }, [onSeek, duration]);

  // Mouse events
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const f = getFraction(e.clientX);
    setDragFraction(f);
    setDragging(true);
    commitSeek(f);
  }, [getFraction, commitSeek]);

  // Touch events
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const f = getFraction(touch.clientX);
    setDragFraction(f);
    setDragging(true);
    commitSeek(f);
  }, [getFraction, commitSeek]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const f = getFraction(e.clientX);
      setDragFraction(f);
      onSeek(f * duration);
    };
    const onMouseUp = () => setDragging(false);

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const f = getFraction(e.touches[0].clientX);
      setDragFraction(f);
      onSeek(f * duration);
    };
    const onTouchEnd = () => setDragging(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [dragging, getFraction, onSeek, duration]);

  const fraction = dragging ? dragFraction : (currentTime / duration);
  const pct = `${fraction * 100}%`;

  return (
    <div
      ref={barRef}
      className="relative w-full cursor-pointer select-none touch-none group"
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    >
      {/* Larger touch target */}
      <div className="py-2">
        <div className="relative w-full h-[3px] bg-white/10 rounded-full">
          <div
            className="absolute inset-y-0 left-0 bg-white rounded-full"
            style={{ width: pct }}
          />
        </div>
      </div>
      {/* Thumb – visible on hover/drag */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow transition-opacity ${dragging ? 'opacity-100 scale-110' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ left: pct }}
      />
    </div>
  );
}

interface ArchiveHeroProps {
  archives: ArchiveSerialized[];
  featuredArchive: ArchiveSerialized;
  isLive?: boolean;
  isRestream?: boolean;
  liveBPM?: number | null;
  liveDJChatRoom?: string;
}

function formatClockTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function ShowProgressBar({ startTime, endTime }: { startTime: number; endTime: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);
  const totalDuration = endTime - startTime;
  const elapsed = now - startTime;
  const progress = totalDuration > 0 ? Math.max(0, Math.min(1, elapsed / totalDuration)) : 0;
  return (
    <div className="relative w-full h-[3px] bg-white/10">
      <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

export function ArchiveHero({ archives, featuredArchive, isLive, isRestream, liveBPM, liveDJChatRoom }: ArchiveHeroProps) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const {
    isPlaying: isLivePlaying, isLoading: isLiveLoading, currentShow, currentDJ,
    toggle: toggleLive, play: playLive,
    setHeroBarVisible, setHeroBarObserverReady, pause: pauseLive, tipLink: liveTipLink,
    error: streamError,
  } = useBroadcastStreamContext();
  const archivePlayer = useArchivePlayer();
  const stickyBarRef = useRef<HTMLDivElement>(null);

  // Track player bar visibility — GlobalBroadcastBar shows when this scrolls out of view
  useEffect(() => {
    const el = stickyBarRef.current;
    if (!el) return;
    setHeroBarVisible(true);
    setHeroBarObserverReady(true);
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          setHeroBarVisible(true);
        } else {
          hideTimer = setTimeout(() => setHeroBarVisible(false), 150);
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      observer.disconnect();
      setHeroBarVisible(false);
      setHeroBarObserverReady(false);
    };
  }, [setHeroBarVisible, setHeroBarObserverReady]);

  // Track what the user last chose: 'live' or 'archive'
  // If an archive is loaded (playing or paused), stay in archive mode even if live is on
  const [userSelectedMode, setUserSelectedMode] = useState<'live' | 'archive'>(
    archivePlayer.currentArchive ? 'archive' : isLive ? 'live' : 'archive'
  );

  // Auto-switch to live only when a NEW broadcast starts and no archive is loaded
  // Auto-switch to archive when broadcast ends
  const prevIsLiveRef = useRef(isLive);
  useEffect(() => {
    const wasLive = prevIsLiveRef.current;
    prevIsLiveRef.current = isLive;

    // Broadcast just started — only switch to live if no archive is loaded
    if (isLive && !wasLive && !archivePlayer.currentArchive) {
      setUserSelectedMode('live');
    }
    // Broadcast ended
    if (!isLive && wasLive) {
      setUserSelectedMode('archive');
    }
  }, [isLive, archivePlayer.currentArchive]);

  // Show live in hero when user chose live and broadcast is actually live
  const showLiveInHero = isLive && userSelectedMode === 'live';


  // Hero carousel: top 3 archives, random order when nothing playing
  const heroArchives = useMemo(() => {
    if (archivePlayer.currentArchive) {
      // Playing: playing archive first, then next 2
      const result = [archivePlayer.currentArchive];
      for (const a of archives) {
        if (result.length >= 3) break;
        if (result.some(r => r.id === a.id)) continue;
        result.push(a);
      }
      return result;
    }
    // Not playing: high priority only, random order
    const high = archives.filter(a => a.priority === 'high');
    for (let i = high.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [high[i], high[j]] = [high[j], high[i]];
    }
    return high.slice(0, 3);
  }, [archives, archivePlayer.currentArchive]);

  const [heroIndex, setHeroIndex] = useState(0);
  const heroTouchRef = useRef<{ startX: number; startY: number } | null>(null);

  // When playback changes, snap to first slide
  useEffect(() => {
    setHeroIndex(0);
  }, [archivePlayer.currentArchive?.id]);

  // The currently displayed archive (playing → hero slide → featured)
  const displayedArchive = archivePlayer.currentArchive || heroArchives[heroIndex] || featuredArchive;

  // Live DJ info (computed from currentShow, similar to LiveBroadcastHero)
  const liveDjPhotoUrl = (() => {
    if (!currentShow) return null;
    if (currentShow.restreamDjs && currentShow.restreamDjs.length > 0) {
      const primary = currentShow.restreamDjs.find(dj => dj.userId)
        || currentShow.restreamDjs.find(dj => dj.username)
        || null;
      if (primary?.photoUrl) return primary.photoUrl;
    }
    return currentShow.showImageUrl || currentShow.liveDjPhotoUrl || null;
  })();
  const liveDjName = currentDJ || currentShow?.djName || null;
  const liveShowName = currentShow?.showName || 'Live Now';
  const liveDjGenres = currentShow?.liveDjGenres || [];
  const liveDjDescription = currentShow?.liveDjDescription || currentShow?.liveDjBio || null;
  const liveDjProfileUsername = (() => {
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

  // Primary DJ info — live or archive based
  const primaryDJ = displayedArchive.djs[0];
  const djUsername = showLiveInHero ? (liveDjProfileUsername || primaryDJ?.username) : primaryDJ?.username;
  const djName = showLiveInHero ? (liveDjName || displayedArchive.djs.map((d) => d.name).join(', ')) : displayedArchive.djs.map((d) => d.name).join(', ');
  const djPhotoUrl = showLiveInHero ? liveDjPhotoUrl : (displayedArchive.showImageUrl || primaryDJ?.photoUrl);

  // Fetch DJ profile for genres, tip link, and bio (used for live hero)
  const djProfile = useDJProfileInfo(djUsername);
  const djGenres = showLiveInHero ? liveDjGenres : djProfile.genres;
  const tipLink = showLiveInHero ? liveTipLink : djProfile.tipButtonLink;
  const djDescription = showLiveInHero ? liveDjDescription : djProfile.bio;

  // Image error state (for live hero)
  const [imageError, setImageError] = useState(false);
  const hasPhoto = djPhotoUrl && !imageError;

  // Heart / Love
  const [heartTrigger, setHeartTrigger] = useState(0);
  const [heartNudgeDismissed, setHeartNudgeDismissed] = useState(false);
  const { loveHistory, loading: loveLoading } = useLoveHistory();
  const skipNudge = heartNudgeDismissed || (!loveLoading && !!user && loveHistory.length > 0);
  const anyPlaying = isLivePlaying || archivePlayer.isPlaying;
  const handleLove = () => {
    setHeartNudgeDismissed(true);
    setHeartTrigger((t) => t + 1);
    sendLove();
  };

  const [showAuthModal, setShowAuthModal] = useState(false);

  // Archive tag filter — default: all selected, persisted to Firestore
  const ALL_MOOD_TAGS = ['pick-me-up', 'chill', 'exploratory', 'clubby'];
  const [activeTags, setActiveTags] = useState<string[]>(ALL_MOOD_TAGS);
  const [tagsLoaded, setTagsLoaded] = useState(false);

  // Load preference from Firestore user doc (or localStorage fallback)
  useEffect(() => {
    if (tagsLoaded) return;
    if (user?.uid) {
      import('firebase/firestore').then(({ doc, getDoc }) => {
        import('@/lib/firebase').then(({ db }) => {
          if (!db) return;
          getDoc(doc(db, 'users', user.uid)).then(snap => {
            if (snap.exists()) {
              const saved = snap.data()?.archiveMoodTags;
              if (Array.isArray(saved)) setActiveTags(saved);
            }
            setTagsLoaded(true);
          }).catch(() => setTagsLoaded(true));
        });
      });
    } else {
      try {
        const saved = localStorage.getItem('archive-tags');
        if (saved) setActiveTags(JSON.parse(saved));
      } catch {}
      setTagsLoaded(true);
    }
  }, [user?.uid, tagsLoaded]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags(prev => {
      const next = prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag];
      // Save to localStorage always
      try { localStorage.setItem('archive-tags', JSON.stringify(next)); } catch {}
      // Save to Firestore user doc if logged in
      if (user?.uid) {
        import('firebase/firestore').then(({ doc, updateDoc }) => {
          import('@/lib/firebase').then(({ db }) => {
            if (!db) return;
            updateDoc(doc(db, 'users', user.uid), { archiveMoodTags: next }).catch(() => {});
          });
        });
      }
      return next;
    });
  }, [user?.uid]);

  // DJ-specific chat hook for sending loves to the DJ currently shown in the player
  // When showing live hero → love goes to live DJ; when showing archive → love goes to archive DJ
  const archiveDjProfileUsername = (archivePlayer.currentArchive || featuredArchive).djs[0]?.username?.replace(/\s+/g, '').toLowerCase() || '';
  const archiveDjName = (archivePlayer.currentArchive || featuredArchive).djs.map((d) => d.name).join(', ');
  const loveChatRoom = showLiveInHero && liveDJChatRoom ? liveDJChatRoom : (archiveDjProfileUsername || '');
  const loveDJLabel = showLiveInHero && liveDjName ? liveDjName : (archiveDjName || '');
  const archivePrimaryDj = (archivePlayer.currentArchive || featuredArchive).djs[0];
  const isArchiveLove = !(showLiveInHero && liveDJChatRoom);
  const { sendLove } = useDJProfileChat({
    chatUsernameNormalized: loveChatRoom,
    djUsername: loveDJLabel,
    username: chatUsername || undefined,
    enabled: !!loveChatRoom,
    userId: user?.uid,
    djPhotoUrl: isArchiveLove ? archivePrimaryDj?.photoUrl : undefined,
    isArchivePlayback: isArchiveLove,
  });


  const showName = showLiveInHero ? liveShowName : displayedArchive.showName;

  // Next scheduled show within 23 hours (check today + tomorrow)
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const { shows: todayShows } = useBroadcastSchedule();
  const { shows: tomorrowShows } = useBroadcastSchedule({ initialDate: tomorrow });
  const nextUpcomingShow = useMemo(() => {
    const now = Date.now();
    const cutoff = now + 23 * 60 * 60 * 1000;
    const allShows = [...todayShows, ...tomorrowShows].sort((a, b) => a.startTime - b.startTime);
    return allShows.find(s => s.startTime > now && s.startTime <= cutoff) || null;
  }, [todayShows, tomorrowShows]);

  const nextShowTime = nextUpcomingShow ? new Date(nextUpcomingShow.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  const canShowEmailPopup = !isAuthenticated && (typeof window === 'undefined' || localStorage.getItem('radio-email-filed') !== 'true');

  const handleNextShowClick = useCallback(() => {
    if (!canShowEmailPopup) return;
    window.dispatchEvent(new Event('open-email-popup'));
  }, [canShowEmailPopup]);

  return (
    <>
    <section className="relative z-10 px-4 pt-6 pb-2">
      <div className="max-w-3xl mx-auto">

        {/* Status line above image — reflects what the hero is showing */}
        <div className="flex items-center justify-between mb-2 relative">
          {showLiveInHero ? (
            <span />
          ) : isLive ? (
            <button
              onClick={() => { setUserSelectedMode('live'); playLive(); }}
              className="flex items-center gap-1.5 text-xs font-mono text-red-500 uppercase tracking-tighter font-bold hover:text-red-400 transition-colors"
            >
              Switch to live
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
              </span>
              {liveBPM ? `${liveBPM} BPM` : ''}
            </button>
          ) : nextShowTime ? (
            canShowEmailPopup ? (
              <button
                onClick={handleNextShowClick}
                className="text-xs font-mono text-gray-400 uppercase tracking-tighter font-bold hover:text-white transition-colors"
              >
                Next <span className="w-1.5 h-1.5 bg-red-500 rounded-full inline-block" /> live at {nextShowTime}
              </button>
            ) : (
              <span className="text-xs font-mono text-gray-400 uppercase tracking-tighter font-bold">
                Next <span className="w-1.5 h-1.5 bg-red-500 rounded-full inline-block" /> live at {nextShowTime}
              </span>
            )
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
            {showLiveInHero ? (
              <>
                {isRestream ? (
                  <svg className="w-3 h-3 text-red-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                ) : (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                  </span>
                )}
                <span className="text-xs font-mono text-red-500 uppercase tracking-tighter font-bold">
                  {liveBPM ? `${liveBPM} BPM ` : ''}{isRestream ? 'Restream' : 'Live'}
                </span>
              </>
            ) : (
              <>
                <ArchiveIcon className="w-3 h-3 text-gray-400" />
                <span className="text-xs font-mono text-gray-400 uppercase tracking-tighter font-bold">Archive</span>
              </>
            )}
          </div>
          {/* Carousel dots — centered */}
          {!showLiveInHero && heroArchives.length > 1 && (
            <div className="absolute left-1/2 -translate-x-1/2 flex gap-1.5">
              {heroArchives.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setHeroIndex(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === heroIndex ? 'bg-white' : 'bg-white/30'}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Hero Image Carousel — swipable top 3 archives */}
        {!showLiveInHero && (
          <div
            className="relative overflow-hidden"
            onTouchStart={(e) => { heroTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY }; }}
            onTouchEnd={(e) => {
              if (!heroTouchRef.current) return;
              const dx = e.changedTouches[0].clientX - heroTouchRef.current.startX;
              const dy = e.changedTouches[0].clientY - heroTouchRef.current.startY;
              heroTouchRef.current = null;
              if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
              if (dx < 0 && heroIndex < heroArchives.length - 1) setHeroIndex(heroIndex + 1);
              if (dx > 0 && heroIndex > 0) setHeroIndex(heroIndex - 1);
            }}
          >
            <div
              className="flex transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${heroIndex * 100}%)` }}
            >
              {heroArchives.map((ha) => (
                <HeroSlide key={ha.id} archive={ha} onPlay={() => { setUserSelectedMode('archive'); pauseLive(); archivePlayer.play(ha); }} />
              ))}
            </div>
            {/* Desktop arrows — same style as watchlist carousel, loops */}
            {heroArchives.length > 1 && (
              <>
                <button
                  onClick={() => setHeroIndex(heroIndex === 0 ? heroArchives.length - 1 : heroIndex - 1)}
                  className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setHeroIndex(heroIndex === heroArchives.length - 1 ? 0 : heroIndex + 1)}
                  className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}
        {showLiveInHero && (
          <div className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={djPhotoUrl!}
                  alt={djName || 'DJ'}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 768px"
                  priority
                  onError={() => setImageError(true)}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
                <div className="absolute top-2 left-2 drop-shadow-lg">
                  <span className="text-sm font-bold text-white uppercase tracking-wide">{showName}</span>
                </div>
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


        {/* Player bar — live mode when live and not playing archive, archive mode otherwise */}
        <div ref={stickyBarRef} className="bg-black relative">
          {showLiveInHero ? (
            <>
              {/* Live player bar */}
              <div className="flex items-center gap-2 sm:gap-3 py-2 px-1">
                <button
                  onClick={toggleLive}
                  className="w-8 h-8 ml-1 flex items-center justify-center bg-white transition-colors flex-shrink-0"
                >
                  {isLiveLoading ? (
                    <svg className="w-5 h-5 animate-spin text-black" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : isLivePlaying ? (
                    <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <ScrollingShowName text={showName} className="text-sm font-bold leading-tight text-white" />
                  {djName && (
                    <ScrollingDJName text={djName} className="text-[10px] text-zinc-500 uppercase mt-0.5 leading-[1.3em]" />
                  )}
                </div>
                {/* Live/Restream indicator + BPM */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isRestream ? (
                    <svg className="w-3 h-3 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  ) : (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                    </span>
                  )}
                  {liveBPM && (
                    <span className="text-xs font-mono uppercase tracking-tighter font-bold text-red-500">
                      {liveBPM} BPM
                    </span>
                  )}
                </div>
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-10 h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg className={`w-5 h-5 ${anyPlaying && !skipNudge ? 'animate-heart-nudge' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink && (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-10 h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                  />
                )}
              </div>
              {streamError && (
                <p className="text-red-400 text-xs pb-2 px-2">{streamError}</p>
              )}
              {currentShow && (
                <>
                  <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                    <span>{formatClockTime(currentShow.startTime)}</span>
                    <span>{formatClockTime(currentShow.endTime)}</span>
                  </div>
                  <ShowProgressBar startTime={currentShow.startTime} endTime={currentShow.endTime} />
                </>
              )}
            </>
          ) : (
            <>
              {/* Archive player bar */}
              <div className="flex items-center gap-2 sm:gap-3 py-2 px-1">
                <button
                  onClick={() => {
                    if (archivePlayer.currentArchive) {
                      if (!archivePlayer.isPlaying) pauseLive();
                      archivePlayer.toggle();
                    } else {
                      pauseLive();
                      archivePlayer.play(displayedArchive);
                    }
                  }}
                  className="w-8 h-8 ml-1 flex items-center justify-center bg-white transition-colors flex-shrink-0"
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
                <div className="flex-1 min-w-0">
                  <ScrollingShowName text={displayedArchive.showName} className="text-sm font-bold leading-tight text-white" />
                  {displayedArchive.djs && (
                    <ScrollingDJName text={displayedArchive.djs.map((d) => d.name).join(', ')} className="text-[10px] text-zinc-500 uppercase mt-0.5 leading-[1.3em]" />
                  )}
                </div>
                {(() => {
                  const archiveDjUsername = displayedArchive.djs[0]?.username?.replace(/\s+/g, '').toLowerCase();
                  return archiveDjUsername ? (
                    <Link href={`/dj/${archiveDjUsername}`} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </Link>
                  ) : null;
                })()}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-10 h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg className={`w-5 h-5 ${anyPlaying && !skipNudge ? 'animate-heart-nudge' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink && (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-10 h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                  />
                )}
              </div>
              <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                <span>{formatTime(archivePlayer.currentArchive?.id === displayedArchive.id ? archivePlayer.currentTime : 0)}</span>
                <span>{formatTime(archivePlayer.duration || displayedArchive.duration)}</span>
              </div>
              <ArchiveSeekBar
                currentTime={archivePlayer.currentArchive?.id === displayedArchive.id ? archivePlayer.currentTime : 0}
                duration={archivePlayer.duration || displayedArchive.duration || 1}
                onSeek={archivePlayer.seek}
              />
            </>
          )}
        </div>

      </div>

      {/* Latest Archives — filtered full-width cards */}
      {(() => {
        const heroFirstId = heroArchives[0]?.id;
        // Filter: hide archives that have any non-active (toggled off) mood tag
        const allTags = ALL_MOOD_TAGS;
        const inactiveTags = allTags.filter(t => !activeTags.includes(t));
        const filtered = archives
          .filter(a => a.priority !== 'low')
          .filter(a => {
            if (!a.tags?.length) return true;
            // Exclude if archive has any tag that's toggled off
            return !inactiveTags.some(t => a.tags!.includes(t));
          })
          .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));
        // Move hero first to position 3
        const heroItem = heroFirstId ? filtered.find(a => a.id === heroFirstId) : null;
        const ordered = heroItem
          ? (() => { const rest = filtered.filter(a => a.id !== heroFirstId); return [...rest.slice(0, 2), heroItem, ...rest.slice(2)]; })()
          : filtered;

        return (
          <div className="mt-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl md:text-3xl font-semibold">Archives</h2>
              {/* Tag filter pills */}
              <div className="flex gap-1 sm:gap-2">
              {[
                { tag: 'pick-me-up', label: 'Upbeat' },
                { tag: 'chill', label: 'Chill' },
                { tag: 'exploratory', label: 'Deep' },
                { tag: 'clubby', label: 'Clubby' },
              ].map(({ tag, label }) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-1.5 sm:px-2 py-1 sm:py-1.5 rounded text-[9px] sm:text-xs font-medium transition-colors border-0 sm:border flex items-center gap-0.5 sm:gap-1 ${
                    activeTags.includes(tag)
                      ? 'sm:border-white text-white'
                      : 'sm:border-white/10 text-zinc-600 hover:sm:border-white/30 hover:text-zinc-400'
                  }`}
                >
                  {activeTags.includes(tag) ? (
                    <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  )}
                  {label}
                </button>
              ))}
              </div>
            </div>

            {/* Card list — full width mobile, 2 cols desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ordered.map((archive) => (
                <ArchiveGridCard
                  key={archive.id}
                  archive={archive}
                  activeTags={activeTags}
                  isActive={archivePlayer.currentArchive?.id === archive.id}
                  isPlaying={archivePlayer.isPlaying && archivePlayer.currentArchive?.id === archive.id}
                  onPlay={() => {
                    if (archivePlayer.currentArchive?.id === archive.id && archivePlayer.isPlaying) {
                      archivePlayer.pause();
                    } else {
                      setUserSelectedMode('archive'); pauseLive(); archivePlayer.play(archive);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        );
      })()}

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to join the chat"
      />

    </section>
    </>
  );
}

const TAG_LABELS: Record<string, string> = {
  'pick-me-up': 'UPBEAT',
  'chill': 'CHILL',
  'exploratory': 'DEEP',
  'clubby': 'CLUBBY',
};

function HeroSlide({ archive, onPlay }: { archive: ArchiveSerialized; onPlay: () => void }) {
  const primaryDj = archive.djs[0];
  const djName = archive.djs.map(d => d.name).join(', ');
  const photoUrl = archive.showImageUrl || primaryDj?.photoUrl;
  const djProfile = useDJProfileInfo(primaryDj?.username);
  const djGenres = (primaryDj?.genres?.length ? primaryDj.genres : djProfile.genres) || [];
  const djDescription = djProfile.bio;
  const [imgError, setImgError] = useState(false);
  const hasPhoto = photoUrl && !imgError;

  return (
    <button
      onClick={onPlay}
      className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10 flex-shrink-0 text-left"
    >
      {hasPhoto ? (
        <>
          <Image
            src={photoUrl!}
            alt={djName || 'DJ'}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 768px"
            priority
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
          {/* Show name — top left */}
          <div className="absolute top-2 left-2 drop-shadow-lg">
            <span className="text-sm font-bold text-white uppercase tracking-wide">{archive.showName}</span>
          </div>
          {/* Mood tags — top right */}
          {archive.tags && archive.tags.length > 0 && (
            <div className="absolute top-2 right-2 flex flex-wrap justify-end gap-1 max-w-[50%] drop-shadow-lg">
              {['exploratory', 'clubby', 'pick-me-up', 'chill'].filter(t => archive.tags!.includes(t)).map(tag => (
                <span key={tag} className="text-[10px] font-mono text-white/60 uppercase tracking-tighter border border-white/20 px-1.5 py-0.5 rounded">
                  {TAG_LABELS[tag] || tag}
                </span>
              ))}
            </div>
          )}
          <DJImageOverlay djName={djName} djGenres={djGenres} djDescription={djDescription} />
        </>
      ) : (
        <div className="w-full h-full relative flex items-center justify-center bg-white/5">
          <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4 text-white">
            {djName || archive.showName}
          </h2>
        </div>
      )}
    </button>
  );
}

function ArchiveGridCard({
  archive,
  activeTags,
  isActive,
  isPlaying,
  isLive: isLiveCard,
  isRestream: isRestreamCard,
  liveBPM: cardLiveBPM,
  onPlay,
}: {
  archive: ArchiveSerialized;
  activeTags?: string[];
  isActive: boolean;
  isPlaying: boolean;
  isLive?: boolean;
  isRestream?: boolean;
  liveBPM?: number | null;
  onPlay: () => void;
}) {
  const djNames = archive.djs.map((d) => d.name).join(', ');
  const primaryDj = archive.djs[0];
  const primaryUsername = primaryDj?.username;
  const profileInfo = useDJProfileInfo(primaryUsername);
  // Archive-stored data takes priority over profile lookup
  const genres = (primaryDj?.genres?.length ? primaryDj.genres : profileInfo.genres) || [];
  const djLocation = primaryDj?.location || profileInfo.location;
  const genreText = genres.length > 0 ? genres.map((g) => g.toUpperCase()).join(' · ') : null;
  const displayImage = archive.showImageUrl || primaryDj?.photoUrl;

  // Match label: mood tag — genre — location
  const { selectedCity, selectedGenres } = useFilterContext();
  const matchingGenres = selectedGenres.filter(g => genres.some(dg => matchesGenreLib([dg], g)));
  const genreLabel = matchingGenres.length > 0 ? matchingGenres.map(g => g.toUpperCase()).join(' + ') : '';
  const cityMatch = selectedCity && selectedCity !== 'Anywhere' && djLocation ? matchesCity(djLocation, selectedCity) : false;
  const cityLabel = cityMatch ? selectedCity!.toUpperCase() : '';
  // Mood tags: all active tags that match this archive, in fixed display order
  const MOOD_ORDER = ['exploratory', 'clubby', 'pick-me-up', 'chill'];
  const moodLabels = activeTags
    ? MOOD_ORDER.filter(t => activeTags.includes(t) && (archive.tags || []).includes(t)).map(t => TAG_LABELS[t] || t.toUpperCase())
    : [];
  const parts = [...moodLabels, genreLabel, cityLabel].filter(Boolean);
  const matchLabel = parts.length > 0 ? parts.join(' · ') : undefined;

  // Watchlist
  const { isInWatchlist, followDJ, removeFromWatchlist } = useFavorites();
  const djName = archive.djs[0]?.name || '';
  const isFollowing = djName ? isInWatchlist(djName) : false;
  const [isAddingFollow, setIsAddingFollow] = useState(false);

  const handleToggleWatchlist = useCallback(async () => {
    if (!djName) return;
    setIsAddingFollow(true);
    try {
      if (isFollowing) {
        await removeFromWatchlist(djName);
      } else {
        await followDJ(djName);
      }
    } finally {
      setIsAddingFollow(false);
    }
  }, [djName, isFollowing, followDJ, removeFromWatchlist]);

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Match label — always reserve space for alignment */}
      <div className="flex items-center mb-1 h-4 px-0.5">
        {matchLabel && (
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">{matchLabel}</span>
        )}
      </div>
      {/* Image with hero-style overlays */}
      <button onClick={onPlay} className="w-full text-left relative aspect-[16/9] overflow-hidden border border-white/10">
        {displayImage ? (
          <>
            <Image
              src={displayImage}
              alt={archive.showName}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 50vw, 33vw"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-white/5">
            <h2 className="text-lg font-black uppercase tracking-tight leading-none text-white text-center px-2">
              {djNames}
            </h2>
          </div>
        )}

        {/* Top left: Show name */}
        <div className="absolute top-1 left-1 right-1 md:top-1.5 md:left-1.5 md:right-1.5 drop-shadow-lg">
          <span className="text-sm font-bold text-white uppercase tracking-wide whitespace-nowrap overflow-hidden block">{archive.showName}</span>
        </div>

        {/* Top right: Live badge + BPM (only on live cards) */}
        {isLiveCard && (
          <div className="absolute top-1 right-1 md:top-1.5 md:right-1.5 flex items-center gap-1 drop-shadow-lg">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-600" />
            </span>
            <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold">
              {isRestreamCard ? 'Restream' : 'Live'}
              {cardLiveBPM ? ` ${cardLiveBPM} BPM` : ''}
            </span>
          </div>
        )}

        {/* Bottom: DJ name, genre below */}
        {displayImage && (
          <div className="absolute bottom-1 left-1 right-1 md:bottom-1.5 md:left-1.5 md:right-1.5 drop-shadow-lg">
            <div className="text-xs font-black uppercase tracking-wider text-white whitespace-nowrap overflow-hidden">
              {djNames}
            </div>
            {genreText && (
              <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-300 whitespace-nowrap overflow-hidden mt-0.5">
                {genreText}
              </div>
            )}
          </div>
        )}

        {/* Centered play/pause icon with circle — always visible to distinguish archive cards */}
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity ${isActive ? '' : 'group-hover:opacity-0'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center drop-shadow-lg ${isActive && isPlaying ? 'bg-white/15' : 'bg-black/20 border border-white/20'}`}>
            {isActive && isPlaying ? (
              <svg className="w-6 h-6 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white/50 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        </div>

        {/* Hover overlay with stronger icon */}
        <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${isActive ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
          <div className="w-12 h-12 rounded-full bg-black/40 border border-white/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-white ml-0.5 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </button>

      {/* Action buttons */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleToggleWatchlist}
          disabled={isAddingFollow}
          className={`flex-1 py-2 px-2 rounded text-xs md:text-sm font-semibold transition-colors flex items-center justify-center gap-1 ${
            isFollowing
              ? 'bg-white/10 text-gray-400 cursor-default'
              : 'bg-white hover:bg-gray-100 text-gray-900'
          } disabled:opacity-50`}
        >
          {isAddingFollow ? (
            <div className={`w-3.5 h-3.5 border-2 ${isFollowing ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin mx-auto`} />
          ) : isFollowing ? (
            <><svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> Watchlist</>
          ) : (
            <><svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> Watchlist</>
          )}
        </button>
        {primaryUsername && (
          <Link
            href={`/dj/${primaryUsername}`}
            className="flex-1 py-2 px-2 rounded text-xs md:text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-1"
          >
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            Profile
          </Link>
        )}
      </div>
    </div>
  );
}
