'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchiveRadioContext } from '@/contexts/ArchiveRadioContext';
import { useBPM } from '@/contexts/BPMContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useDJProfileInfo } from '@/hooks/useDJProfileInfo';
import { useHeartNudge } from '@/contexts/HeartNudgeContext';
import { FloatingHearts } from '@/components/channel/FloatingHearts';
import { ScrollingShowName, ScrollingDJName } from '@/components/channel/LiveBroadcastHero';
import { ArchiveSeekBar } from '@/components/channel/ArchiveHero';
import { findActiveDjSlot } from '@/lib/broadcast-utils';
import { useScenesData, resolveArchiveScenes } from '@/hooks/useScenesData';
import { SceneGlyph } from '@/components/SceneGlyph';

function pickSceneSlug(slugs: string[]): string | null {
  return slugs.find((s) => s !== 'grid') || null;
}

/**
 * A bar shown below the header on all pages when a broadcast is live.
 * Rendered inside the Header component so it's part of the sticky header block.
 * Uses shared BroadcastStreamContext for synced play/pause.
 */
export function GlobalBroadcastBar() {
  const [mounted, setMounted] = useState(false);
  const {
    isLive, isStreaming, isPlaying, isLoading, toggle,
    showName, djName, heroBarVisible, heroBarObserverReady, tipLink, currentShow,
    onLockedInRef: broadcastLockedInRef,
    onListenMilestoneRef: broadcastListenMilestoneRef,
  } = useBroadcastStreamContext();
  const archivePlayer = useArchivePlayer();
  const radioCtx = useArchiveRadioContext();
  const { djSceneMap } = useScenesData();
  const { stationBPM } = useBPM();
  const broadcastBPM = stationBPM['broadcast']?.bpm ?? null;
  const pathname = usePathname();
  const { user } = useAuthContext();
  const { chatUsername, showLockedInMessages } = useUserProfile(user?.uid);
  const [heartTrigger, setHeartTrigger] = useState(0);
  const [heartNudgeDismissed, setHeartNudgeDismissed] = useState(false);
  const skipNudge = heartNudgeDismissed;
  const { nudgeKey, nudge } = useHeartNudge();

  // Compute current DJ chat room (same logic as LiveBroadcastHero)
  const currentDJChatRoom = useMemo(() => {
    if (!currentShow) return '';
    const normalize = (u: string) => u.replace(/[\s-]+/g, '').toLowerCase();
    if (currentShow.djSlots && currentShow.djSlots.length > 0) {
      const slot = findActiveDjSlot(currentShow.djSlots);
      if (slot) return normalize(slot.liveDjUsername || slot.djUsername || slot.djName || '');
    }
    const username = currentShow.liveDjUsername || currentShow.djUsername || currentShow.djName;
    return username ? normalize(username) : '';
  }, [currentShow]);

  // Profile link for live/restream bar (mirrors ArchiveHero.liveDjProfileUsername)
  const liveDjProfileUsername = useMemo(() => {
    if (!currentShow) return null;
    if (currentShow.restreamDjs && currentShow.restreamDjs.length > 0) {
      const primary = currentShow.restreamDjs.find(dj => dj.userId)
        || currentShow.restreamDjs.find(dj => dj.username)
        || null;
      if (primary?.username) return primary.username;
    }
    if (currentShow.djSlots && currentShow.djSlots.length > 0) {
      const slot = findActiveDjSlot(currentShow.djSlots);
      if (slot) return slot.liveDjUsername || slot.djUsername || null;
    }
    return currentShow.liveDjUsername || currentShow.djUsername || null;
  }, [currentShow]);

  const { sendLove, sendLockedIn } = useDJProfileChat({
    chatUsernameNormalized: currentDJChatRoom,
    djUsername: djName || currentShow?.djName || '',
    username: chatUsername || undefined,
    enabled: false, // Don't subscribe to messages, just need sendLove
    lockedInMessagesEnabled: showLockedInMessages,
    userId: user?.uid,
    isArchivePlayback: false,
  });

  const handleSendLove = useCallback(async () => {
    setHeartNudgeDismissed(true);
    setHeartTrigger((prev) => prev + 1);
    try {
      await sendLove();
    } catch (err) {
      console.error('Failed to send love:', err);
    }
  }, [sendLove]);

  // Archive DJ info for love + tip in archive bar (fall back to featured archive)
  const archiveForBar = archivePlayer.currentArchive || archivePlayer.featuredArchive;
  const archivePrimaryDj = archiveForBar?.djs[0];
  const archiveDjProfileUsername = archivePrimaryDj?.username?.replace(/\s+/g, '').toLowerCase() || '';
  const archiveDjProfile = useDJProfileInfo(archivePrimaryDj?.username);
  const archiveTipLink = archiveDjProfile.tipButtonLink;

  const { sendLove: archiveSendLove, sendLockedIn: archiveSendLockedIn } = useDJProfileChat({
    chatUsernameNormalized: archiveDjProfileUsername,
    djUsername: archiveForBar?.djs.map(d => d.name).join(', ') || '',
    username: chatUsername || undefined,
    enabled: false,
    lockedInMessagesEnabled: showLockedInMessages,
    userId: user?.uid,
    djPhotoUrl: archivePrimaryDj?.photoUrl,
    isArchivePlayback: true,
  });

  const [archiveHeartTrigger, setArchiveHeartTrigger] = useState(0);
  const handleArchiveSendLove = useCallback(async () => {
    setHeartNudgeDismissed(true);
    setArchiveHeartTrigger((prev) => prev + 1);
    try {
      await archiveSendLove();
    } catch (err) {
      console.error('Failed to send archive love:', err);
    }
  }, [archiveSendLove]);

  // Radio (continuous archive radio) DJ wiring — mirrors archive's love/tip
  // setup so the radio bar gets the same icons as live.
  // Single source of truth: resolve the radio's current archive doc and read
  // username/scene/tip/photo from there (not from denormalized fields on
  // the schedule item).
  const radioArchive = radioCtx?.currentArchive ?? null;
  const radioPrimaryDj = radioArchive?.djs?.[0];
  const radioDjProfileUsername = radioPrimaryDj?.username?.replace(/\s+/g, '').toLowerCase() || '';
  const radioDjProfile = useDJProfileInfo(radioPrimaryDj?.username);
  const radioTipLink = radioDjProfile.tipButtonLink;
  const { sendLove: radioSendLove } = useDJProfileChat({
    chatUsernameNormalized: radioDjProfileUsername,
    djUsername: radioArchive?.djs?.map(d => d.name).join(', ') || '',
    username: chatUsername || undefined,
    enabled: false,
    lockedInMessagesEnabled: showLockedInMessages,
    userId: user?.uid,
    djPhotoUrl: radioPrimaryDj?.photoUrl,
    isArchivePlayback: true,
  });
  const [radioHeartTrigger, setRadioHeartTrigger] = useState(0);
  const handleRadioSendLove = useCallback(async () => {
    setHeartNudgeDismissed(true);
    setRadioHeartTrigger((prev) => prev + 1);
    try {
      await radioSendLove();
    } catch (err) {
      console.error('Failed to send radio love:', err);
    }
  }, [radioSendLove]);

  // Wire "locked in" callbacks to the timer refs in stream contexts
  useEffect(() => {
    broadcastLockedInRef.current = sendLockedIn;
    return () => { broadcastLockedInRef.current = null; };
  }, [sendLockedIn, broadcastLockedInRef]);

  useEffect(() => {
    archivePlayer.onLockedInRef.current = archiveSendLockedIn;
    return () => { archivePlayer.onLockedInRef.current = null; };
  }, [archiveSendLockedIn, archivePlayer.onLockedInRef]);

  // Wire 5-minute listen milestone to heart-nudge re-trigger
  useEffect(() => {
    broadcastListenMilestoneRef.current = nudge;
    return () => { broadcastListenMilestoneRef.current = null; };
  }, [nudge, broadcastListenMilestoneRef]);

  useEffect(() => {
    archivePlayer.onListenMilestoneRef.current = nudge;
    return () => { archivePlayer.onListenMilestoneRef.current = null; };
  }, [nudge, archivePlayer.onListenMilestoneRef]);

  useEffect(() => { setMounted(true); }, []);

  // Return null on first render to match server HTML and avoid hydration mismatch
  if (!mounted) return null;
  // Never show on the go-live broadcast page
  if (pathname === '/broadcast/live') return null;

  const isLiveReady = isLive && isStreaming;
  const isArchivePlaying = archivePlayer.isPlaying || archivePlayer.isLoading;
  const isLivePlaying = isLiveReady && isPlaying;
  const isRadioPlaying = !!radioCtx?.isPlaying || !!radioCtx?.isLoading;
  const radioAvailable = !!radioCtx?.enabled && !!radioCtx?.currentItem;
  const displayArchive = archivePlayer.currentArchive || archivePlayer.heroDisplayedArchive || archivePlayer.featuredArchive;

  // Priority (matches the inline /demo bar's demoBarMode so the two bars
  // always agree):
  //   1. something actively playing → mirror that
  //   2. /demo with listener on slide 1 → archive (user is asking for it)
  //   3. live broadcast on → live
  //   4. /demo radio available → radio
  //   5. fallback archive
  const demoSlideOneVisible = !!radioCtx?.enabled && radioCtx?.visibleSlide === 1;
  let barMode: 'live' | 'archive' | 'radio' | null;
  if (isLivePlaying) barMode = 'live';
  else if (isArchivePlaying) barMode = 'archive';
  else if (isRadioPlaying) barMode = 'radio';
  else if (demoSlideOneVisible && displayArchive) barMode = 'archive';
  else if (isLiveReady) barMode = 'live';
  else if (radioAvailable) barMode = 'radio';
  else if (displayArchive) barMode = 'archive';
  else barMode = null;

  if (!barMode) return null;

  // On /radio (and /radio/demo), hide while the hero's inline player bar is
  // in view. Before the observer initializes, default to hidden to prevent a
  // flash on load. CSS transition instead of unmounting to avoid flicker.
  const hiddenOnRadio = (pathname === '/radio' || pathname === '/radio/demo') && (heroBarVisible || !heroBarObserverReady);

  const showLiveBar = barMode === 'live';

  // Archive info — fall back to featured archive
  const archiveShowName = (archivePlayer.currentArchive || displayArchive)?.showName;
  const archiveDjName = (archivePlayer.currentArchive || displayArchive)?.djs.map(d => d.name).join(', ');
  const archiveSceneSlug = displayArchive
    ? pickSceneSlug(resolveArchiveScenes(displayArchive, djSceneMap))
    : null;

  if (showLiveBar) {
    return (
      <div className={`z-[99] bg-black border-b border-white/10 overflow-hidden transition-all duration-200 ${hiddenOnRadio ? 'opacity-0 -translate-y-full h-0 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
        <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
          {/* Play/Pause — synced with broadcast stream. Sized to match the
              archive bar's play button so the sticky bar doesn't change
              height between modes. */}
          <button
            onClick={toggle}
            className="h-[27px] ml-1 pl-2 pr-1 flex items-center justify-center transition-colors flex-shrink-0"
          >
            {isLoading ? (
              <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : isPlaying ? (
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Show info — clicking navigates to /radio */}
          <Link href="/radio#live" className="flex-1 min-w-0">
            <ScrollingShowName text={showName || 'Live Now'} className="text-sm font-bold leading-tight text-white" />
            {djName && (
              <ScrollingDJName text={djName} className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]" />
            )}
          </Link>

          {/* Live indicator + BPM */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
            </span>
            {broadcastBPM && (
              <span className="text-xs font-mono uppercase tracking-tighter font-bold text-red-500">
                {broadcastBPM} BPM
              </span>
            )}
          </div>

          {/* DJ profile link */}
          {liveDjProfileUsername && (
            <Link href={`/dj/${liveDjProfileUsername.replace(/\s+/g, '').toLowerCase()}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </Link>
          )}

          {/* Love button */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => handleSendLove()}
              className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
            >
              <svg key={nudgeKey} className={`w-5 h-5 ${isPlaying ? (nudgeKey > 0 ? 'animate-heart-nudge-strong' : (!skipNudge ? 'animate-heart-nudge' : '')) : ''}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
            <FloatingHearts trigger={heartTrigger} />
          </div>

          {/* Tip icon */}
          {tipLink && (
            <a
              href={tipLink!}
              target="_blank"
              rel="noopener noreferrer"
              className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
              </svg>
            </a>
          )}
        </div>
      </div>
    );
  }

  // Archive radio bar — visually identical to the live bar except: no BPM,
  // and the live red dot is swapped for the restream pill (circular arrow +
  // zinc-400 "Restream" label). Same play, scrolling text, profile link,
  // love button, tip widgets.
  if (barMode === 'radio' && radioCtx) {
    const radioTitle = radioArchive?.showName || radioCtx.currentItem?.title || 'Archive radio';
    const radioDjs = radioArchive?.djs?.map((d) => d.name).join(', ') || '';
    const profileSlug = radioDjProfileUsername;
    // Scene glyph — resolved live from the archive doc.
    const radioSceneSlug = radioArchive
      ? pickSceneSlug(resolveArchiveScenes(radioArchive, djSceneMap))
      : null;
    return (
      <div className={`z-[99] bg-black border-b border-white/10 overflow-hidden transition-all duration-200 ${hiddenOnRadio ? 'opacity-0 -translate-y-full h-0 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
        <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
          <div className="flex items-center ml-1 flex-shrink-0">
            {radioSceneSlug && (
              <div className="w-[27px] h-[27px] flex items-center justify-center bg-white text-black flex-shrink-0">
                <SceneGlyph slug={radioSceneSlug} className="!w-5 !h-5" />
              </div>
            )}
            <button
              onClick={() => { void radioCtx.toggle(); }}
              className="h-[27px] pl-2 pr-1 flex items-center justify-center transition-colors"
              aria-label={radioCtx.isPlaying ? 'Pause' : 'Play'}
            >
              {radioCtx.isLoading ? (
                <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : radioCtx.isPlaying ? (
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 3h4v18H6V3zm8 0h4v18h-4V3z" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 3v18l15-9z" />
                </svg>
              )}
            </button>
          </div>

          <Link href="/radio/demo" className="flex-1 min-w-0">
            <ScrollingShowName text={radioTitle} className="text-sm font-bold leading-tight text-white" />
            {radioDjs && (
              <ScrollingDJName text={radioDjs} className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]" />
            )}
          </Link>

          {/* Pulsing red dot — same as live, marks the radio as a synced
              stream. No BPM. */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
            </span>
          </div>

          {/* DJ profile link */}
          {profileSlug && (
            <Link href={`/dj/${profileSlug}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </Link>
          )}

          {/* Love button */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => handleRadioSendLove()}
              className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
            >
              <svg key={`r-${nudgeKey}`} className={`w-5 h-5 ${radioCtx.isPlaying ? (nudgeKey > 0 ? 'animate-heart-nudge-strong' : (!skipNudge ? 'animate-heart-nudge' : '')) : ''}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
            <FloatingHearts trigger={radioHeartTrigger} />
          </div>

          {/* Tip — only when the current radio DJ has a tip link */}
          {radioTipLink && (
            <a
              href={radioTipLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
              </svg>
            </a>
          )}
        </div>
        {/* Non-seekable progress bar — radio is a synced stream. */}
        {radioCtx.itemDurationSec > 0 && (
          <div className="relative w-full h-[2px] bg-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-white"
              style={{ width: `${Math.min(100, (radioCtx.itemSeekSec / radioCtx.itemDurationSec) * 100)}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Archive playback bar (not live)
  return (
    <div className={`z-[99] bg-black border-b border-white/10 overflow-hidden transition-all duration-200 ${hiddenOnRadio ? 'opacity-0 -translate-y-full h-0 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
      <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
        <div className="flex items-center ml-1 flex-shrink-0">
          {/* Scene glyph — white square, black glyph */}
          {archiveSceneSlug && (
            <div className="w-[27px] h-[27px] flex items-center justify-center bg-white text-black flex-shrink-0">
              <SceneGlyph slug={archiveSceneSlug} className="!w-5 !h-5" />
            </div>
          )}
          {/* Play/Pause — archive player (px-2 widens hit area) */}
          <button
            onClick={() => {
              if (archivePlayer.currentArchive) {
                archivePlayer.toggle();
              } else if (displayArchive) {
                archivePlayer.play(displayArchive);
              }
            }}
            className="h-[27px] pl-2 pr-1 flex items-center justify-center transition-colors"
          >
          {archivePlayer.isLoading ? (
            <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : archivePlayer.isPlaying ? (
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 3h4v18H6V3zm8 0h4v18h-4V3z" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5 3v18l15-9z" />
            </svg>
          )}
          </button>
        </div>

        {/* Archive show info */}
        <Link href="/radio" className="flex-1 min-w-0">
          <ScrollingShowName text={archiveShowName || 'Archive'} className="text-sm font-bold leading-tight text-white" />
          {archiveDjName && (
            <ScrollingDJName text={archiveDjName} className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]" />
          )}
        </Link>

        {/* DJ profile link */}
        {archiveDjProfileUsername && (
          <Link href={`/dj/${archiveDjProfileUsername}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </Link>
        )}

        {/* Love button */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => handleArchiveSendLove()}
            className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
          >
            <svg key={nudgeKey} className={`w-5 h-5 ${archivePlayer.isPlaying ? (nudgeKey > 0 ? 'animate-heart-nudge-strong' : (!skipNudge ? 'animate-heart-nudge' : '')) : ''}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </button>
          <FloatingHearts trigger={archiveHeartTrigger} />
        </div>

        {/* Tip icon */}
        {archiveTipLink && (
          <a
            href={archiveTipLink}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
            </svg>
          </a>
        )}
      </div>
      {archivePlayer.currentArchive && (
        <ArchiveSeekBar
          currentTime={archivePlayer.currentTime}
          duration={archivePlayer.duration || 1}
          onSeek={archivePlayer.seek}
        />
      )}
    </div>
  );
}
