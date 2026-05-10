'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useScenesData, resolveArchiveScenes } from '@/hooks/useScenesData';
import { SceneGlyph } from '@/components/SceneGlyph';
import Image from 'next/image';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useHeartNudge } from '@/contexts/HeartNudgeContext';
import { useDJProfileInfo } from '@/hooks/useDJProfileInfo';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useFilterContext } from '@/contexts/FilterContext';
import { matchesGenre as matchesGenreLib } from '@/lib/genres';
import { matchesCity } from '@/lib/city-detection';
import { useBroadcastSchedule } from '@/hooks/useBroadcastSchedule';
import { findActiveDjSlot } from '@/lib/broadcast-utils';
import { DJImageOverlay, ScrollingShowName, ScrollingDJName } from './LiveBroadcastHero';
import { FloatingHearts } from './FloatingHearts';
import { TipButton } from './TipButton';
import { AuthModal } from '@/components/AuthModal';
import { ArchiveSerialized } from '@/types/broadcast';
import { useArchiveRadioContext } from '@/contexts/ArchiveRadioContext';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Tiny string→int hash. Used to pick a stable-but-rotating slide-1 archive
// keyed off the radio's current archive id, so slide 1 changes naturally as
// the radio rolls forward without re-rolling on every render.
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
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
  // Max number of slides in the offline hero carousel. Default 3 (used on /radio).
  // Pass 1 for scene pages where we want a single featured archive.
  maxHeroSlides?: number;
  // Custom section title. Defaults to "Live DJ radio" on /radio.
  // Scene pages pass <>Live {emoji} Radio</> so the scene emoji sits inline.
  titleOverride?: ReactNode;
  // Hide the subtitle under the title (scene pages want a cleaner header).
  hideSubtitle?: boolean;
  // SSR-resolved spiral / star picks. Used to paint the hero immediately on
  // first render, before client-side scene mappings finish loading. Once the
  // client resolves djSceneMap, the memo recomputes from `archives` and may
  // pick different slides.
  preferredHeroSeed?: {
    spiral: ArchiveSerialized | null;
    star: ArchiveSerialized | null;
  };
  // When true (currently only /radio/demo), the offline hero swaps to the
  // continuous-archive radio layout: slide 0 is the radio, slide 1 is either
  // the listener-played archive (with switch buttons) or an opposite-scene
  // pick. The unified player bar drives whichever slide is shown.
  // /radio itself keeps the legacy [spiral, star] layout until this is rolled
  // out for real.
  demoMode?: boolean;
  // When true, hide the bottom "Past shows" grid (used on /radio/demo).
  hidePastShows?: boolean;
}

function formatClockTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
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
  // Wrapping py-2 mirrors ArchiveSeekBar's outer container so the player bar
  // has the same total height across live / radio / archive cards. Without
  // it, swiping between cards bumps the layout by ~16px.
  return (
    <div className="relative w-full select-none">
      <div className="py-2">
        <div className="relative w-full h-[3px] bg-white/10 rounded-full">
          <div className="absolute inset-y-0 left-0 bg-white rounded-full" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

export function ArchiveHero({ archives, featuredArchive, isLive, isRestream, liveBPM, liveDJChatRoom, maxHeroSlides = 3, titleOverride, hideSubtitle, preferredHeroSeed, demoMode, hidePastShows }: ArchiveHeroProps) {
  const { user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const {
    isPlaying: isLivePlaying, isLoading: isLiveLoading, currentShow, currentDJ,
    toggle: toggleLive, play: playLive,
    setHeroBarVisible, setHeroBarObserverReady, tipLink: liveTipLink,
    error: streamError,
  } = useBroadcastStreamContext();
  const archivePlayer = useArchivePlayer();
  const stickyBarRef = useRef<HTMLDivElement>(null);

  // Scenes data (scene emoji chips on archive cards + Past-shows filter).
  const { scenes, djSceneMap } = useScenesData();
  const { selectedSceneIds, handleSceneIdsChange } = useFilterContext();
  // Derived view: the persisted selection as a Set, defaulting to all scenes
  // until the user makes a choice (selectedSceneIds === null).
  const sceneFilter = useMemo(() => {
    if (selectedSceneIds === null) return new Set(scenes.map((s) => s.id));
    return new Set(selectedSceneIds);
  }, [selectedSceneIds, scenes]);
  const scenesById = useMemo(() => {
    const m = new Map<string, typeof scenes[number]>();
    for (const s of scenes) m.set(s.id, s);
    return m;
  }, [scenes]);
  const toggleSceneFilter = useCallback(
    (sceneId: string) => {
      // null (never touched) and [] (all toggled off) both mean "show everything" —
      // treat them identically so the first click deselects one chip from the full set
      // rather than selecting only that chip.
      const current =
        selectedSceneIds === null || selectedSceneIds.length === 0
          ? scenes.map((s) => s.id)
          : selectedSceneIds;
      const next = current.includes(sceneId)
        ? current.filter((id) => id !== sceneId)
        : [...current, sceneId];
      handleSceneIdsChange(next);
    },
    [selectedSceneIds, scenes, handleSceneIdsChange]
  );

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
  // /demo: never auto-pauses or auto-snaps. If the listener is already
  // listening to something (radio or a regular archive), live just becomes
  // available — the slide 0 image shows live + the "Switch to Live Radio"
  // button in the header strip lets the listener switch manually.
  const prevIsLiveRef = useRef(isLive);
  useEffect(() => {
    const wasLive = prevIsLiveRef.current;
    prevIsLiveRef.current = isLive;

    // Broadcast just started — only switch to live if no archive is loaded.
    // On /demo, don't snap or pause; let the listener choose via the switch
    // button.
    if (isLive && !wasLive && !archivePlayer.currentArchive) {
      if (!demoMode) setUserSelectedMode('live');
    }
    // /demo: when live starts, auto-position the carousel:
    //   - If something is playing (radio or archive) → swipe to slide 1 so
    //     the listener keeps seeing the image of what they're hearing.
    //   - If nothing is playing → swipe to slide 0 so the listener sees
    //     the new live broadcast and can press play.
    // Either way, audio is uninterrupted; this is a pure UI shuffle.
    if (demoMode && isLive && !wasLive) {
      const somethingPlaying =
        !!radioCtx?.isPlaying || !!archivePlayer.isPlaying || !!archivePlayer.currentArchive;
      setHeroIndex(somethingPlaying ? 1 : 0);
    }
    // Broadcast ended
    if (!isLive && wasLive) {
      setUserSelectedMode('archive');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, archivePlayer.currentArchive]);

  // Show live in hero when user chose live and broadcast is actually live
  const showLiveInHero = isLive && userSelectedMode === 'live';

  // Continuous archive radio — driven by ArchiveRadioContext (mounted by
  // DemoBroadcastStreamProvider in /radio/demo). On /radio the provider isn't
  // present, so the context returns null and demoMode is also false; nothing
  // changes.
  const radioCtx = useArchiveRadioContext();
  const radioCurrentArchiveId = demoMode ? (radioCtx?.currentItem?.archiveId ?? null) : null;
  // Single source of truth: radioCtx resolves the archive doc from the
  // schedule item's id. All bar metadata (scene, username, tip, photo) reads
  // from there — same data the rest of the hero uses.
  const radioArchive = radioCtx?.currentArchive ?? null;
  const radioPrimaryDj = radioArchive?.djs?.[0];
  const radioDjUsername = radioPrimaryDj?.username || '';
  const radioDjUsernameNormalized = radioDjUsername.replace(/\s+/g, '').toLowerCase();
  const radioDjProfile = useDJProfileInfo(radioDjUsername || undefined);
  const radioTipLink = radioDjProfile.tipButtonLink;
  const { sendLove: radioSendLove } = useDJProfileChat({
    chatUsernameNormalized: radioDjUsernameNormalized,
    djUsername: radioArchive?.djs?.map(d => d.name).join(', ') || '',
    username: chatUsername || undefined,
    enabled: false,
    userId: user?.uid,
    djPhotoUrl: radioPrimaryDj?.photoUrl,
    isArchivePlayback: true,
  });
  const [radioHeartTrigger, setRadioHeartTrigger] = useState(0);
  const handleRadioLove = useCallback(async () => {
    setRadioHeartTrigger((prev) => prev + 1);
    try { await radioSendLove(); } catch (err) { console.error('radio love failed', err); }
  }, [radioSendLove]);
  const radioSceneSlug = radioArchive
    ? resolveArchiveScenes(radioArchive, djSceneMap).find((s) => s !== 'grid') || null
    : null;

  // Single-source rule: starting a regular archive must pause the radio
  // (archivePlayer.play already pauses the live broadcast). Mirrors the
  // existing live↔archive pattern. Used everywhere archivePlayer.play is
  // called on /radio + /demo, so the radio coordinates the same way.
  const playArchive = useCallback((archive: ArchiveSerialized) => {
    if (radioCtx?.isPlaying) radioCtx.pause();
    archivePlayer.play(archive);
  }, [archivePlayer, radioCtx]);


  // When a scene filter is actively narrowing the set (shared `?scene=` link or
  // user-toggled chips), the hero carousel should only feature archives in that
  // scene — not the full pool.
  // demoMode-only addition: in demo mode we *don't* pin to the playing archive
  // here (it's surfaced as slide 1 of the new layout instead). On /radio the
  // legacy pin-to-current behaviour stays.
  const heroArchives = useMemo(() => {
    // Visible scene chips (grid is hidden), used to decide whether filtering is active.
    const visibleSceneIds = scenes.filter((s) => s.id !== 'grid').map((s) => s.id);
    const allSelected = visibleSceneIds.length > 0 && visibleSceneIds.every((id) => sceneFilter.has(id));
    const noneSelected = visibleSceneIds.length > 0 && visibleSceneIds.every((id) => !sceneFilter.has(id));
    const filteringActive = !allSelected && !noneSelected;
    const inScene = (a: typeof archives[number]) =>
      !filteringActive ||
      resolveArchiveScenes(a, djSceneMap).some((id) => sceneFilter.has(id));

    const high = archives.filter(a => a.priority === 'high' && inScene(a));
    // Cap eligible archives per scene to the most recent 5 by recordedAt, so
    // the hero rotates through current shows rather than the full back catalog.
    const PER_SCENE_LIMIT = 5;
    const randomBySceneSlug = (slug: string, excludeId?: string) => {
      const pool = high
        .filter((a) => a.id !== excludeId && resolveArchiveScenes(a, djSceneMap).includes(slug))
        .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
        .slice(0, PER_SCENE_LIMIT);
      if (pool.length === 0) return undefined;
      return pool[Math.floor(Math.random() * pool.length)];
    };

    if (!demoMode && archivePlayer.currentArchive) {
      // Legacy /radio behaviour: while an archive is playing, pin the hero to
      // it — no siblings, no swipe.
      return [archivePlayer.currentArchive];
    }
    if (maxHeroSlides === 1) {
      const latest = [...high].sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))[0];
      return latest ? [latest] : [];
    }
    // Prefer the SSR-resolved picks for the whole session: the server
    // already chose a random high-priority archive in each scene, so reusing
    // those picks keeps the hero stable across re-renders. Re-rolling client-
    // side once djSceneMap loads would swap the slide out from under the user.
    // Only fall back to client-side selection if SSR didn't return picks
    // (e.g. admin DB unavailable) or a scene filter is active.
    let spiral = !filteringActive ? preferredHeroSeed?.spiral ?? undefined : undefined;
    let star = !filteringActive ? preferredHeroSeed?.star ?? undefined : undefined;
    if (!spiral) spiral = randomBySceneSlug('spiral');
    if (!star) star = randomBySceneSlug('star', spiral?.id);
    const picks: typeof archives = [];
    if (spiral) picks.push(spiral);
    if (star && star.id !== spiral?.id) picks.push(star);
    return picks;
  }, [archives, archivePlayer.currentArchive, demoMode, maxHeroSlides, scenes, sceneFilter, djSceneMap, preferredHeroSeed]);

  // The second slide of the carousel (slide 1).
  // Demo-mode only: returns null on /radio so the legacy carousel rendering
  // stays exactly as before.
  // Priority:
  //   1. listener-picked archive → that archive (with switch actions)
  //   2. live is on → the radio's currently-playing archive (so slide 1
  //      offers something to listen to alongside live)
  //   3. else → high-priority archive from the *opposite scene* of the
  //      radio's current archive, never the same archive id as the radio.
  //      Searches the full archives pool (not just heroArchives) so we
  //      always find a real cross-scene pick.
  const secondHeroArchive = useMemo<ArchiveSerialized | null>(() => {
    if (!demoMode) return null;
    if (maxHeroSlides === 1) return null;
    if (archivePlayer.currentArchive) return archivePlayer.currentArchive;
    // When live is on (regardless of userSelectedMode), slide 1 falls back
    // to the radio's currently-playing archive so the listener still has
    // access to the radio image alongside live.
    if (isLive && radioCurrentArchiveId) {
      const radioArchive = archives.find((a) => a.id === radioCurrentArchiveId);
      if (radioArchive) return radioArchive;
    }

    // Determine the radio's current scene (spiral / star / neither).
    const radioArchive = radioCurrentArchiveId
      ? archives.find((a) => a.id === radioCurrentArchiveId) ?? null
      : null;
    const radioScenes = radioArchive ? resolveArchiveScenes(radioArchive, djSceneMap) : [];
    const radioIsSpiral = radioScenes.includes('spiral');
    const radioIsStar = radioScenes.includes('star');

    // The "opposite scene" rule. If the radio is spiral, slide 1 should be
    // a star archive; if the radio is star, slide 1 should be spiral. When
    // the radio belongs to neither (or both), default to whichever scene
    // the radio doesn't dominate — fall through to the broader picks.
    const oppositeSlug: 'spiral' | 'star' | null =
      radioIsSpiral && !radioIsStar ? 'star'
      : radioIsStar && !radioIsSpiral ? 'spiral'
      : null;

    // Full pool: high-priority archives, exclude the radio's own archive id
    // so slide 1 is never a duplicate of slide 0. Sort by recordedAt so we
    // surface fresh shows (cap to 5 most recent in the matching scene).
    const PER_SCENE_LIMIT = 5;
    const pool = archives.filter((a) =>
      a.priority === 'high' && a.id !== radioCurrentArchiveId
    );

    if (oppositeSlug) {
      const inScene = pool
        .filter((a) => resolveArchiveScenes(a, djSceneMap).includes(oppositeSlug))
        .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
        .slice(0, PER_SCENE_LIMIT);
      if (inScene.length > 0) {
        // Stable but rotating pick — index by radio archive id so the
        // featured slot changes naturally as the radio rolls forward.
        const seed = radioCurrentArchiveId
          ? Math.abs(hashStringToInt(radioCurrentArchiveId)) % inScene.length
          : 0;
        return inScene[seed];
      }
    }

    // Fallback: any high-priority archive in either scene, excluding radio.
    const sceneFallback = pool
      .filter((a) => {
        const s = resolveArchiveScenes(a, djSceneMap);
        return s.includes('spiral') || s.includes('star');
      })
      .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
      .slice(0, PER_SCENE_LIMIT);
    if (sceneFallback.length > 0) {
      const seed = radioCurrentArchiveId
        ? Math.abs(hashStringToInt(radioCurrentArchiveId)) % sceneFallback.length
        : 0;
      return sceneFallback[seed];
    }

    // Last resort: heroArchives picks (legacy seed) excluding the radio.
    const legacy = heroArchives.filter((a) => a.id !== radioCurrentArchiveId);
    return legacy[1] ?? legacy[0] ?? null;
  }, [archivePlayer.currentArchive, archives, demoMode, djSceneMap, heroArchives, isLive, maxHeroSlides, radioCurrentArchiveId]);

  const [heroIndex, setHeroIndex] = useState(0);
  const heroTouchRef = useRef<{ startX: number; startY: number } | null>(null);

  // When playback changes, snap to first slide (legacy /radio behaviour:
  // playing an archive pins the hero to it). On /demo we want the opposite —
  // a listener-picked archive lives on slide 1, so don't snap.
  useEffect(() => {
    if (demoMode) return;
    setHeroIndex(0);
  }, [archivePlayer.currentArchive?.id, demoMode]);

  // When the filter pool shifts (user toggles a chip), clamp heroIndex so we
  // never land past the new array length — otherwise the hero shows `undefined`
  // and falls through to a stale featured archive.
  // - demo mode: 2-slot layout (radio + opposite-scene), or 1 if no second.
  // - /radio (default): legacy heroArchives length.
  const carouselSlideCount = demoMode
    ? (secondHeroArchive ? 2 : 1)
    : heroArchives.length;
  useEffect(() => {
    if (heroIndex >= carouselSlideCount) setHeroIndex(0);
  }, [carouselSlideCount, heroIndex]);

  // The currently displayed archive used by downstream UI (share button etc).
  // - /radio: legacy = whatever's playing or the visible slide.
  // - /demo: prefer the listener-played archive, then slide-1 alternative,
  //   then fallbacks. Slide 0 (radio/live) doesn't surface here.
  const displayedArchive = demoMode
    ? (archivePlayer.currentArchive ?? secondHeroArchive ?? heroArchives[0] ?? featuredArchive)
    : (archivePlayer.currentArchive || heroArchives[heroIndex] || featuredArchive);

  // Player bar mode (demo only). Rule: what's actively playing wins; if
  // (Removed demoBarMode — bar selection is now driven by heroIndex (visible
  // slide) directly, and each bar's play/pause icon reflects its own source's
  // state. See the bar render block.)

  // /demo: which slide does the currently-active source belong to?
  // Slide 0 owns: live + radio. Slide 1 owns: the listener-played archive.
  // When nothing's playing we treat slide 0 as the "default active" so the
  // inline bar still shows next to the radio image.
  const demoActiveSlide: 0 | 1 = (() => {
    if (!demoMode) return 0;
    if (archivePlayer.isPlaying || archivePlayer.isLoading) return 1;
    if (radioCtx?.isPlaying || radioCtx?.isLoading) return 0;
    if (isLive && isLivePlaying) return 0;
    return 0;
  })();
  // Whether the currently visible slide is showing the active audio source.
  // Drives both the play overlay (shown when false) and the inline-vs-sticky
  // bar swap.
  const demoSlideShowsActive = !demoMode || heroIndex === demoActiveSlide;

  // /demo: publish the visible slide so the sticky bar can mirror it when
  // nothing's actively playing.
  useEffect(() => {
    if (!demoMode || !radioCtx) return;
    radioCtx.setVisibleSlide(heroIndex >= 1 ? 1 : 0);
  }, [demoMode, heroIndex, radioCtx]);

  // /demo: hand the archives list to the radio context so it can resolve
  // currentArchive from currentItem.archiveId. Single source of truth — no
  // denormalized scene/username on schedule items needed.
  useEffect(() => {
    if (!demoMode || !radioCtx) return;
    radioCtx.setArchives(archives);
  }, [demoMode, archives, radioCtx]);

  // (Swipe never touches playback. Audio keeps playing whatever it was
  // playing when the listener swipes; each slide just shows an overlay
  // play button if its content isn't the active source. The single-source
  // rule is enforced by ArchiveRadioContext.toggle/play and archivePlayer
  // when the listener actually clicks the overlay.)
  // (No auto-swipe on listener play — hero composition is stable. The bar
  // follows what's playing via demoBarMode; the hero only moves when the
  // listener manually swipes or clicks a dot/arrow.)

  // /demo: inline player is always rendered under the visible slide and
  // mirrors that slide's content. The sticky bar takes over only when the
  // visible slide's source isn't what's actively playing — that signal is
  // published to ArchiveRadioContext (inlineCoversActive) and read by
  // GlobalBroadcastBar.
  useEffect(() => {
    if (!demoMode || !radioCtx) return;
    radioCtx.setInlineCoversActive(demoSlideShowsActive);
  }, [demoMode, demoSlideShowsActive, radioCtx]);

  // Publish what the hero is showing so GlobalBroadcastBar can mirror it.
  useEffect(() => {
    archivePlayer.setHeroDisplayedArchive(displayedArchive ?? null);
    return () => archivePlayer.setHeroDisplayedArchive(null);
  }, [displayedArchive, archivePlayer.setHeroDisplayedArchive]);

  // Live DJ info (computed from currentShow, similar to LiveBroadcastHero)
  // Show image always wins over DJ photos.
  const liveDjPhotoUrl = (() => {
    if (!currentShow) return null;
    if (currentShow.showImageUrl) return currentShow.showImageUrl;
    if (currentShow.liveDjPhotoUrl) return currentShow.liveDjPhotoUrl;
    if (currentShow.restreamDjs && currentShow.restreamDjs.length > 0) {
      const primary = currentShow.restreamDjs.find(dj => dj.userId)
        || currentShow.restreamDjs.find(dj => dj.username)
        || null;
      if (primary?.photoUrl) return primary.photoUrl;
    }
    return null;
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
      const slot = findActiveDjSlot(currentShow.djSlots);
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
  const skipNudge = heartNudgeDismissed;
  const { nudgeKey } = useHeartNudge();
  const anyPlaying = isLivePlaying || archivePlayer.isPlaying;
  const handleLove = () => {
    setHeartNudgeDismissed(true);
    setHeartTrigger((t) => t + 1);
    sendLove();
  };

  const [showAuthModal, setShowAuthModal] = useState(false);


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
    return allShows.find(s => s.startTime > now && s.startTime <= cutoff && s.broadcastType !== 'restream') || null;
  }, [todayShows, tomorrowShows]);

  const nextShowTime = nextUpcomingShow ? new Date(nextUpcomingShow.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <>
    <section className="relative z-10 px-4 pt-6 pb-2">
      <div className="max-w-7xl mx-auto mb-4">
        <h2 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
          {titleOverride ?? 'Live DJ radio'}
        </h2>
        {!hideSubtitle && (
          <p className="text-sm md:text-base text-zinc-400 mt-1">for the music. and the people behind it</p>
        )}
      </div>
      <div className="max-w-3xl mx-auto">

        {/* Status line above image — reflects what the hero is showing */}
        <div className="flex items-center justify-between mb-2 relative">
          {/* Left side of the strip above the hero. /demo: when the archive
              bar is showing (slide 1 or a listener-played archive), swap
              the legacy "Next live at" copy for a "Back to Live/Radio"
              action that pauses the archive and resumes the page default. */}
          {(() => {
            // /demo, slide 1 (archive) visible: show a switch action that
            // returns the listener to slide 0 (live or radio).
            if (demoMode && heroIndex >= 1) {
              if (isLive) {
                return (
                  <button
                    onClick={() => { archivePlayer.pause(); setHeroIndex(0); setUserSelectedMode('live'); playLive(); }}
                    className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-tighter font-bold transition-colors text-red-500 hover:text-red-400"
                  >
                    Switch to Live Radio
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                    </span>
                    {liveBPM ? `${liveBPM} BPM` : ''}
                  </button>
                );
              }
              return (
                <button
                  onClick={() => { archivePlayer.pause(); setHeroIndex(0); void radioCtx?.play(); }}
                  className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-tighter font-bold transition-colors text-zinc-400 hover:text-white"
                >
                  Switch to Radio
                </button>
              );
            }
            // Slide 0 (live or radio). Same as /radio's existing strip:
            // next-live hint when offline, switch-to-live when an archive is
            // playing (legacy fallback), nothing while live is playing.
            if (showLiveInHero) return <span />;
            if (isLive) {
              return (
                <button
                  onClick={() => { setUserSelectedMode('live'); playLive(); }}
                  className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-tighter font-bold transition-colors text-red-500 hover:text-red-400"
                >
                  Switch to Live Radio
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                  </span>
                  {liveBPM ? `${liveBPM} BPM` : ''}
                </button>
              );
            }
            if (nextShowTime) {
              return (
                <span className="text-xs font-mono text-gray-400 uppercase tracking-tighter font-bold">
                  Next <span className="w-1.5 h-1.5 bg-red-500 rounded-full inline-block" /> live at {nextShowTime}
                </span>
              );
            }
            return <span />;
          })()}
          <div className="flex items-center gap-1.5">
            {showLiveInHero ? (
              isRestream ? (
                <>
                  <svg className="w-3 h-3 text-zinc-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-400">
                    Restream{liveBPM ? <span className="md:hidden"> {liveBPM} BPM</span> : null}
                  </span>
                </>
              ) : (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                  </span>
                  <span className="text-xs font-mono uppercase tracking-tighter font-bold text-red-500">
                    Live{liveBPM ? <span className="md:hidden"> {liveBPM} BPM</span> : null}
                  </span>
                </>
              )
            ) : demoMode ? (
              heroIndex === 0 ? (
                // Slide 0 = continuous radio. Same restream pill as live-restream.
                <>
                  <svg className="w-3 h-3 text-zinc-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-400">
                    Restream
                  </span>
                </>
              ) : (
                // Slide 1 = an archive (listener-picked or alternative).
                // Same pill styling as Restream, with a box/archive icon.
                <>
                  <svg className="w-3 h-3 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="5" rx="1" />
                    <path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
                    <path d="M10 12h4" />
                  </svg>
                  <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-400">
                    Archive
                  </span>
                </>
              )
            ) : null}
          </div>
        </div>

        {/* Hero Image Carousel.
            - /radio (default): legacy [spiral, star] slides via heroArchives.
              Live takes over the whole hero (no carousel) — see further below.
            - /radio/demo (demoMode=true): always shows the carousel.
              • Slide 0 = live (when on) OR archive radio (when offline)
              • Slide 1 = listener-picked archive, or the radio's current
                archive when live is on, or an opposite-scene alternative. */}
        {(demoMode || !showLiveInHero) && (
          <div
            className="relative"
            onTouchStart={(e) => { heroTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY }; }}
            onTouchEnd={(e) => {
              if (!heroTouchRef.current) return;
              const dx = e.changedTouches[0].clientX - heroTouchRef.current.startX;
              const dy = e.changedTouches[0].clientY - heroTouchRef.current.startY;
              heroTouchRef.current = null;
              if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
              if (dx < 0 && heroIndex < carouselSlideCount - 1) setHeroIndex(heroIndex + 1);
              if (dx > 0 && heroIndex > 0) setHeroIndex(heroIndex - 1);
            }}
          >
            <div className="overflow-hidden">
              <div
                className="flex transition-transform duration-300 ease-out"
                style={{ transform: `translateX(-${heroIndex * 100}%)` }}
              >
                {demoMode ? (
                  <>
                    <div key="slide-0" className="relative w-full flex-shrink-0 flex flex-col">
                      {/* Slide 0: live image when a broadcast is on (regardless
                          of userSelectedMode), else the radio slide. */}
                      {isLive ? (
                        // Slide 0 = live image (mirrors the legacy takeover
                        // block but inside the carousel slot).
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
                      ) : (() => {
                        // Slide 0 = archive radio. Prefer the resolved archive
                        // doc so we render a real HeroSlide (DJ overlay, scene
                        // glyphs, photo). While the schedule loads, fall back
                        // to the featured archive so the slot isn't an ugly
                        // placeholder — same trick /radio uses below.
                        const radioArchive = (radioCtx?.currentItem?.archiveId
                          ? archives.find((a) => a.id === radioCtx.currentItem!.archiveId)
                          : null) ?? featuredArchive;
                        return (
                          <HeroSlide
                            archive={radioArchive}
                            sceneSlugs={resolveArchiveScenes(radioArchive, djSceneMap)}
                            onPlay={() => { void radioCtx?.toggle(); }}
                          />
                        );
                      })()}
                      {/* Overlay play/pause button — always shown on /demo.
                          Pause icon when this slide's source is the active
                          one and playing; play icon otherwise. Click toggles. */}
                      {(() => {
                        const slideIsPlaying = isLive ? isLivePlaying : !!radioCtx?.isPlaying;
                        return (
                          <button
                            onClick={() => {
                              if (isLive) {
                                if (isLivePlaying) toggleLive();
                                else { setUserSelectedMode('live'); playLive(); }
                              } else {
                                void radioCtx?.toggle();
                              }
                            }}
                            aria-label={slideIsPlaying ? 'Pause' : 'Play this'}
                            className="absolute inset-0 flex items-center justify-center transition-opacity hover:bg-black/30"
                          >
                            <div className="w-12 h-12 rounded-full bg-black/40 border border-white/30 flex items-center justify-center drop-shadow-lg">
                              {slideIsPlaying ? (
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                              ) : (
                                <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              )}
                            </div>
                          </button>
                        );
                      })()}
                    </div>
                    {secondHeroArchive && (
                      <div key={`slide-1-${secondHeroArchive.id}`} className="relative w-full flex-shrink-0 flex flex-col">
                        <HeroSlide
                          archive={secondHeroArchive}
                          sceneSlugs={resolveArchiveScenes(secondHeroArchive, djSceneMap)}
                          onPlay={() => {
                            setUserSelectedMode('archive');
                            playArchive(secondHeroArchive);
                          }}
                        />
                        {/* Overlay play/pause button — always shown on /demo.
                            Pause icon when this archive is currently playing,
                            play icon otherwise. Click toggles. */}
                        {(() => {
                          const slideIsPlaying =
                            archivePlayer.isPlaying &&
                            archivePlayer.currentArchive?.id === secondHeroArchive.id;
                          return (
                            <button
                              onClick={() => {
                                if (slideIsPlaying) {
                                  archivePlayer.toggle();
                                } else {
                                  setUserSelectedMode('archive');
                                  playArchive(secondHeroArchive);
                                }
                              }}
                              aria-label={slideIsPlaying ? 'Pause' : 'Play this archive'}
                              className="absolute inset-0 flex items-center justify-center transition-opacity hover:bg-black/30"
                            >
                              <div className="w-12 h-12 rounded-full bg-black/40 border border-white/30 flex items-center justify-center drop-shadow-lg">
                                {slideIsPlaying ? (
                                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                  </svg>
                                ) : (
                                  <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                )}
                              </div>
                            </button>
                          );
                        })()}
                      </div>
                    )}
                  </>
                ) : (
                  // Legacy /radio carousel: spiral + star slides.
                  heroArchives.map((ha) => (
                    <HeroSlide
                      key={ha.id}
                      archive={ha}
                      sceneSlugs={resolveArchiveScenes(ha, djSceneMap)}
                      onPlay={() => {
                        setUserSelectedMode('archive');
                        playArchive(ha);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
            {/* Desktop arrows — same style as watchlist carousel, loops */}
            {carouselSlideCount > 1 && (
              <>
                {/* Left arrow only when there's somewhere to go back to. */}
                {heroIndex > 0 && (
                  <button
                    onClick={() => setHeroIndex(heroIndex - 1)}
                    className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {/* Right arrow only when there's a next slide. */}
                {heroIndex < carouselSlideCount - 1 && (
                  <button
                    onClick={() => setHeroIndex(heroIndex + 1)}
                    className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {showLiveInHero && !demoMode && (
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


        {/* Player bar.
            /radio (legacy): showLiveInHero ? live bar : archive bar.
            /demo: bar is always rendered and mirrors the visible slide.
            Bar selection follows heroIndex (slide-driven), not what's
            playing. The sticky bar takes over only when the visible slide's
            source isn't the active source. */}
        <div ref={stickyBarRef} className="bg-black relative">
          {demoMode && radioCtx && heroIndex === 0 && !isLive ? (
            <>
              {/* Radio player bar — same chrome as the archive bar (scene
                  glyph, play, scrolling text, profile, love, tip), but driven
                  by the radio context. The progress is non-seekable because
                  the radio is a synced schedule, not a single audio file. */}
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
                <div className="flex-1 min-w-0">
                  <ScrollingShowName
                    text={radioArchive?.showName || radioCtx.currentItem?.title || (radioCtx.ready ? 'No archive scheduled' : 'Loading…')}
                    className="text-sm font-bold leading-tight text-white"
                  />
                  {radioArchive?.djs?.length ? (
                    <ScrollingDJName
                      text={radioArchive.djs.map((d) => d.name).join(', ')}
                      className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]"
                    />
                  ) : null}
                </div>
                {/* Pulsing red dot — same as live, marks "live audio" feel
                    on the radio (it's a synced stream, not a static archive). */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                  </span>
                </div>
                {radioDjUsernameNormalized && (
                  <Link href={`/dj/${radioDjUsernameNormalized}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </Link>
                )}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => { void handleRadioLove(); }}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={radioHeartTrigger} />
                </div>
                {radioTipLink && (
                  <TipButton
                    djUsername={radioPrimaryDj?.name || 'DJ'}
                    tipLink={radioTipLink}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                  />
                )}
              </div>
              {radioCtx.error && (
                <p className="text-red-400 text-xs pb-2 px-2">{radioCtx.error}</p>
              )}
              {/* Same shape as the live bar: clock-time start/end + a
                  non-seekable progress bar driven by the schedule. */}
              {radioCtx.itemStartMs !== null && radioCtx.itemEndMs !== null && (
                <>
                  <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                    <span>{formatClockTime(radioCtx.itemStartMs)}</span>
                    <span>{formatClockTime(radioCtx.itemEndMs)}</span>
                  </div>
                  <ShowProgressBar startTime={radioCtx.itemStartMs} endTime={radioCtx.itemEndMs} />
                </>
              )}
            </>
          ) : (demoMode ? (heroIndex === 0 && isLive) : showLiveInHero) ? (
            <>
              {/* Live player bar — uses the archive-bar play size (h-[27px]
                  wrapper, w-8 icon) so swiping between cards doesn't change
                  the button size on /radio or /demo. */}
              <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
                <button
                  onClick={toggleLive}
                  className="h-[27px] ml-1 pl-2 pr-1 flex items-center justify-center transition-colors flex-shrink-0"
                >
                  {isLiveLoading ? (
                    <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : isLivePlaying ? (
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <ScrollingShowName text={showName} className="text-sm font-bold leading-tight text-white" />
                  {djName && (
                    <ScrollingDJName text={djName} className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]" />
                  )}
                </div>
                {/* Live indicator + BPM */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                  </span>
                  {liveBPM && (
                    <span className="hidden md:inline text-xs font-mono uppercase tracking-tighter font-bold text-red-500">
                      {liveBPM} BPM
                    </span>
                  )}
                </div>
                {liveDjProfileUsername && (
                  <Link href={`/dj/${liveDjProfileUsername.replace(/\s+/g, '').toLowerCase()}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </Link>
                )}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg key={nudgeKey} className={`w-5 h-5 ${anyPlaying ? (nudgeKey > 0 ? 'animate-heart-nudge-strong' : (!skipNudge ? 'animate-heart-nudge' : '')) : ''}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink && (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
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
              <div className="flex items-center gap-0.5 sm:gap-3 py-2 px-1">
                <div className="flex items-center ml-1 flex-shrink-0">
                  {(() => {
                    const slug = resolveArchiveScenes(displayedArchive, djSceneMap).find((s) => s !== 'grid');
                    return slug ? (
                      <div className="w-[27px] h-[27px] flex items-center justify-center bg-white text-black flex-shrink-0">
                        <SceneGlyph slug={slug} className="!w-5 !h-5" />
                      </div>
                    ) : null;
                  })()}
                  <button
                    onClick={() => {
                      if (archivePlayer.currentArchive) {
                        archivePlayer.toggle();
                      } else {
                        playArchive(displayedArchive);
                      }
                    }}
                    className="h-[27px] pl-2 pr-1 flex items-center justify-center transition-colors"
                  >
                  {archivePlayer.isLoading ? (
                    <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : archivePlayer.isPlaying && archivePlayer.currentArchive?.id === displayedArchive.id ? (
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
                <div className="flex-1 min-w-0">
                  <ScrollingShowName text={displayedArchive.showName} className="text-sm font-bold leading-tight text-white" />
                  {displayedArchive.djs && (
                    <ScrollingDJName text={displayedArchive.djs.map((d) => d.name).join(', ')} className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]" />
                  )}
                </div>
                {/* Archive-folder source indicator (demo only) — same spot
                    where radio/live bars show the pulsing red dot. Mirrors
                    the "Archive" pill above the hero, no text label here. */}
                {demoMode && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <svg className="w-3 h-3 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="5" rx="1" />
                      <path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
                      <path d="M10 12h4" />
                    </svg>
                  </div>
                )}
                {(() => {
                  const archiveDjUsername = displayedArchive.djs[0]?.username?.replace(/\s+/g, '').toLowerCase();
                  return archiveDjUsername ? (
                    <Link href={`/dj/${archiveDjUsername}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </Link>
                  ) : null;
                })()}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg key={nudgeKey} className={`w-5 h-5 ${anyPlaying ? (nudgeKey > 0 ? 'animate-heart-nudge-strong' : (!skipNudge ? 'animate-heart-nudge' : '')) : ''}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink && (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
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

        {/* Carousel dots — always reserve space below player bar to prevent layout shift */}
        {!showLiveInHero && (
          <div className="flex justify-center gap-1.5 pt-2 h-3.5">
            {carouselSlideCount > 1 && Array.from({ length: carouselSlideCount }).map((_, i) => (
              <button
                key={i}
                onClick={() => setHeroIndex(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === heroIndex ? 'bg-white' : 'bg-white/30'}`}
              />
            ))}
          </div>
        )}

      </div>

      {/* Past shows — full-width cards */}
      {!hidePastShows && (() => {
        // The "hero pin" used to be heroArchives[0] (the spiral pick). With
        // the new layout, slide 1 of the carousel is whatever we featured —
        // pin that one to position 3 of the past-shows grid for continuity.
        const heroFirstId = secondHeroArchive?.id ?? heroArchives[0]?.id;
        const priorityRank = (p: ArchiveSerialized['priority']) =>
          p === 'high' ? 0 : p === 'low' ? 2 : 1;
        const prefiltered = archives
          .slice()
          .sort((a, b) => {
            const pr = priorityRank(a.priority) - priorityRank(b.priority);
            if (pr !== 0) return pr;
            return (b.recordedAt || 0) - (a.recordedAt || 0);
          });

        // Compute effective scenes per archive once and attach as a tuple list.
        const archivesWithScenes = prefiltered.map((a) => ({
          archive: a,
          sceneIds: resolveArchiveScenes(a, djSceneMap),
        }));

        // Scene chips: only show scenes that at least one past show belongs to.
        const activeSceneIdSet = new Set<string>();
        for (const { sceneIds } of archivesWithScenes) {
          for (const id of sceneIds) activeSceneIdSet.add(id);
        }
        // Grid is hidden for now — don't surface it in the filter chip row.
        const availableScenes = scenes.filter((s) => activeSceneIdSet.has(s.id) && s.id !== 'grid');

        // Treat "all available scenes selected" (or nothing selected at all) the same
        // as no filter — so the default state (all chips on) shows everything with the
        // curated hero-first placement intact.
        const allSelected =
          availableScenes.length > 0 && availableScenes.every((s) => sceneFilter.has(s.id));
        // "None selected" = no *visible* chip is on. `sceneFilter` may still contain
        // hidden slugs like 'grid', so checking its size alone isn't enough.
        const noneSelected =
          availableScenes.length > 0 && availableScenes.every((s) => !sceneFilter.has(s.id));
        const filteringActive = !allSelected && !noneSelected;

        const filteredArchives = filteringActive
          ? archivesWithScenes.filter(({ sceneIds }) =>
              sceneIds.some((id) => sceneFilter.has(id))
            )
          : archivesWithScenes;

        // Move hero first to position 3 (only when not actively filtering, so the
        // curated order is preserved).
        const heroItem = heroFirstId ? filteredArchives.find((x) => x.archive.id === heroFirstId) : null;
        const ordered = heroItem && !filteringActive
          ? (() => {
              const rest = filteredArchives.filter((x) => x.archive.id !== heroFirstId);
              return [...rest.slice(0, 2), heroItem, ...rest.slice(2)];
            })()
          : filteredArchives;

        return (
          <div className="mt-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="text-2xl md:text-3xl font-semibold">Past shows</h2>
              {availableScenes.length > 0 && (
                <div className="flex items-center gap-2">
                  {availableScenes.map((s) => {
                    // Empty selection means "show everything" (same behavior as all
                    // selected), so render all chips active in both cases.
                    const active = noneSelected || sceneFilter.has(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSceneFilter(s.id)}
                        title={s.name}
                        aria-label={`Filter by ${s.name}`}
                        className={`w-[27px] h-[27px] flex items-center justify-center transition-colors ${
                          active
                            ? 'bg-white text-black'
                            : 'bg-transparent text-white/30 hover:text-white/60'
                        }`}
                      >
                        <SceneGlyph slug={s.id} className="!w-5 !h-5" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Card list — full width mobile, 2 cols desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ordered.map(({ archive, sceneIds }) => (
                <ArchiveGridCard
                  key={archive.id}
                  archive={archive}
                  isActive={archivePlayer.currentArchive?.id === archive.id}
                  isPlaying={archivePlayer.isPlaying && archivePlayer.currentArchive?.id === archive.id}
                  sceneChips={sceneIds
                    .map((id) => scenesById.get(id))
                    .filter((s): s is NonNullable<typeof s> => Boolean(s))
                    .map((s) => ({ slug: s.id, name: s.name, emoji: s.emoji }))}
                  onPlay={() => {
                    if (archivePlayer.currentArchive?.id === archive.id && archivePlayer.isPlaying) {
                      archivePlayer.pause();
                    } else {
                      setUserSelectedMode('archive'); playArchive(archive);
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

function HeroSlide({
  archive,
  sceneSlugs,
  onPlay,
}: {
  archive: ArchiveSerialized;
  sceneSlugs?: string[];
  onPlay: () => void;
}) {
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
          {/* Scene glyph — top right */}
          {sceneSlugs && sceneSlugs.some((s) => s !== 'grid') && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 drop-shadow-lg text-white">
              {sceneSlugs.filter((s) => s !== 'grid').map((slug) => (
                <span key={slug} className="text-lg leading-none inline-flex items-center">
                  <SceneGlyph slug={slug} />
                </span>
              ))}
            </div>
          )}
          {/* Mood tags — hidden for now (testing) */}
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

export function ArchiveGridCard({
  archive,
  isActive,
  isPlaying,
  isLive: isLiveCard,
  liveBPM: cardLiveBPM,
  onPlay,
  sceneChips,
}: {
  archive: ArchiveSerialized;
  isActive: boolean;
  isPlaying: boolean;
  isLive?: boolean;
  isRestream?: boolean;
  liveBPM?: number | null;
  onPlay: () => void;
  sceneChips?: Array<{ slug: string; name: string; emoji: string }>;
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

  // Match label: genre — location
  const { selectedCity, selectedGenres } = useFilterContext();
  const matchingGenres = selectedGenres.filter(g => genres.some(dg => matchesGenreLib([dg], g)));
  const genreLabel = matchingGenres.length > 0 ? matchingGenres.map(g => g.toUpperCase()).join(' + ') : '';
  const cityMatch = selectedCity && selectedCity !== 'Anywhere' && djLocation ? matchesCity(djLocation, selectedCity) : false;
  const cityLabel = cityMatch ? selectedCity!.toUpperCase() : '';
  const parts = [genreLabel, cityLabel].filter(Boolean);
  const matchLabel = parts.length > 0 ? parts.join(' · ') : undefined;

  // Share button — copies the primary DJ/collective profile URL to the clipboard
  // AND opens the native share sheet (when available). Both happen unconditionally
  // so users always get the "Copied" feedback even if they dismiss the share sheet.
  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const slug = primaryUsername
      ? primaryUsername.replace(/\s+/g, '').toLowerCase()
      : null;
    if (!slug) return;
    const url = `${window.location.origin}/dj/${slug}`;

    // 1. Copy first so the visual "Copied" feedback shows immediately, regardless
    //    of whether the share sheet opens or the user cancels it.
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }

    // 2. Then open the native share sheet if the browser supports it.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url });
      } catch (err) {
        // AbortError = user dismissed the share sheet; not an error.
        if ((err as DOMException)?.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    }
  }, [primaryUsername]);

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
            <span className="text-[10px] font-mono uppercase tracking-tighter font-bold text-red-500">
              Live{cardLiveBPM ? ` ${cardLiveBPM} BPM` : ''}
            </span>
          </div>
        )}

        {/* Top right: scene glyphs (only on non-live cards). Grid is hidden for now. */}
        {!isLiveCard && sceneChips && sceneChips.some((s) => s.slug !== 'grid') && (
          <div className="absolute top-1 right-1 md:top-1.5 md:right-1.5 flex items-center gap-1.5 drop-shadow-lg text-white">
            {sceneChips.filter((s) => s.slug !== 'grid').map((s) => (
              <span
                key={s.slug}
                title={s.name}
                className="text-lg leading-none inline-flex items-center"
              >
                <SceneGlyph slug={s.slug} />
              </span>
            ))}
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
          onClick={handleShare}
          disabled={!primaryUsername}
          className={`flex-1 py-2 px-2 rounded text-xs md:text-sm font-semibold transition-colors flex items-center justify-center gap-1 ${
            shareCopied
              ? 'bg-green-500/20 text-green-400'
              : 'bg-white hover:bg-gray-100 text-gray-900'
          } disabled:opacity-50`}
          title="Share"
        >
          {shareCopied ? (
            <><svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Copied</>
          ) : (
            <><svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 6l-4-4-4 4M12 2v13" /></svg> Share</>
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
