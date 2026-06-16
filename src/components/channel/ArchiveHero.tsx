'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
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
import { findActiveDjSlot } from '@/lib/broadcast-utils';
import { DJImageOverlay, ScrollingShowName, ScrollingDJName } from './LiveBroadcastHero';
import { FloatingHearts } from './FloatingHearts';
import { TipButton } from './TipButton';
import { DancingBars } from './DancingBars';
import { AuthModal } from '@/components/AuthModal';
import { ArchiveSerialized, type Tempo } from '@/types/broadcast';
import { TEMPOS, tempoLabel } from '@/lib/tempo';
import { priorityIsHigh, priorityIsFeatured, priorityRank } from '@/lib/archive-priority';
import { useArchiveRadioContext } from '@/contexts/ArchiveRadioContext';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Known scene chips for the filter row, used as an instant fallback before
// useScenesData()'s async fetch resolves — spiral + star are a fixed set, so
// the glyphs paint on page load instead of popping in. Grid is intentionally
// excluded (hidden from the filter row). Kept in sync with seed-scenes.ts.
const STATIC_SCENE_CHIPS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'spiral', name: 'Spiral' },
  { id: 'star', name: 'Star' },
];

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
  // Max number of slides in the offline hero carousel. Default 3 (used on the homepage).
  // Pass 1 for scene pages where we want a single featured archive.
  maxHeroSlides?: number;
  // Custom section title. Defaults to "Human Radio" on the homepage.
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
  // SSR-resolved id of the archive playing on the radio right now. Used by
  // slide 0 (radio image) until the client subscribes to the loop collection
  // and `radioCtx.currentItem.archiveId` resolves — otherwise slide 0 would
  // flash a different archive (the featured fallback) on first paint.
  initialRadioArchiveId?: string | null;
  // Homepage variant: widens the hero slider and narrows the archives grid
  // so the hero reads bigger and the cards read smaller. Only `/` opts in.
  homepage?: boolean;
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
          <div className="absolute inset-y-0 left-0 bg-zinc-400/60 rounded-full" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

export function ArchiveHero({ archives, featuredArchive, isLive, isRestream, liveBPM, liveDJChatRoom, maxHeroSlides = 3, titleOverride, hideSubtitle, preferredHeroSeed, initialRadioArchiveId, homepage }: ArchiveHeroProps) {
  const { user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const {
    isPlaying: isLivePlaying, isLoading: isLiveLoading, currentShow, currentDJ,
    toggle: toggleLive, play: playLive, pause: pauseLive,
    setHeroBarVisible, setHeroBarObserverReady, tipLink: liveTipLink,
    error: streamError,
  } = useBroadcastStreamContext();

  // Wraps playLive with a defensive reset when streamError is set —
  // typically after a Rule A auto-handoff attempt was rejected by iOS
  // (audio element left in a half-loaded state with buffered segments
  // from the moment Rule A fired). Calling pause() first clears src
  // via the existing well-tested pause path, then play() re-attaches
  // with a fresh cache-busted manifest URL. Only fires when there's
  // an error — clean-state plays go through playLive directly.
  const tapPlayLive = useCallback(() => {
    if (streamError) {
      pauseLive();
      setTimeout(() => playLive(), 0);
    } else {
      playLive();
    }
  }, [streamError, pauseLive, playLive]);
  const archivePlayer = useArchivePlayer();
  const stickyBarRef = useRef<HTMLDivElement>(null);

  // Scenes data (scene emoji chips on archive cards + Past-shows filter).
  const { scenes, djSceneMap } = useScenesData();
  const { selectedSceneIds, handleSceneIdsChange } = useFilterContext();
  // Homepage `/` uses purely local state — chips are still interactive but
  // the choice is NOT persisted (no Firebase write, no localStorage). Every
  // page load starts with all scenes selected. Other routes (scene page)
  // continue to use the persisted FilterContext selection.
  const [homepageSceneIds, setHomepageSceneIds] = useState<string[] | null>(null);
  // Derived view: the persisted selection as a Set, defaulting to all scenes
  // until the user makes a choice (selectedSceneIds === null).
  const effectiveSelectedSceneIds = homepage ? homepageSceneIds : selectedSceneIds;
  const sceneFilter = useMemo(() => {
    if (effectiveSelectedSceneIds === null) return new Set(scenes.map((s) => s.id));
    return new Set(effectiveSelectedSceneIds);
  }, [effectiveSelectedSceneIds, scenes]);
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
      const baseline = effectiveSelectedSceneIds;
      const current =
        baseline === null || baseline.length === 0
          ? scenes.map((s) => s.id)
          : baseline;
      const next = current.includes(sceneId)
        ? current.filter((id) => id !== sceneId)
        : [...current, sceneId];
      if (homepage) {
        // Local-only state, no persistence (no Firebase, no localStorage).
        setHomepageSceneIds(next);
      } else {
        handleSceneIdsChange(next);
      }
    },
    [homepage, effectiveSelectedSceneIds, scenes, handleSceneIdsChange]
  );

  // Tempo filter (Past-shows grid). Same local-only, non-persisted model as the
  // homepage scene chips: null = "all tempos" (every chip active); the user can
  // uncheck individual tempos. Tempo lives on the archive doc (admin-set).
  const [selectedTempos, setSelectedTempos] = useState<Tempo[] | null>(null);
  const tempoFilter = useMemo(() => {
    if (selectedTempos === null) return new Set<Tempo>(TEMPOS.map((t) => t.id));
    return new Set<Tempo>(selectedTempos);
  }, [selectedTempos]);
  const toggleTempoFilter = useCallback(
    (tempo: Tempo) => {
      // null (untouched) and [] (all off) both mean "show everything", so the
      // first click deselects one chip from the full set — matching scene chips.
      const current =
        selectedTempos === null || selectedTempos.length === 0
          ? TEMPOS.map((t) => t.id)
          : selectedTempos;
      const next = current.includes(tempo)
        ? current.filter((id) => id !== tempo)
        : [...current, tempo];
      setSelectedTempos(next);
    },
    [selectedTempos]
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
  // Never auto-pauses or auto-snaps. If the listener is already listening
  // to something (radio or a regular archive), live just becomes available —
  // the slide 0 image shows live + the "Switch to Live Radio" button in the
  // header strip lets the listener switch manually.
  const prevIsLiveRef = useRef(isLive);
  useEffect(() => {
    const wasLive = prevIsLiveRef.current;
    prevIsLiveRef.current = isLive;

    // When live starts, auto-position the carousel:
    //   - A specific archive is playing → swipe to slide 1 (archive isn't
    //     auto-handed-off; listener keeps seeing what they're hearing).
    //   - Otherwise (radio playing or nothing playing) → swipe to slide 0:
    //     either the auto-handoff will transfer radio → live (so live IS
    //     what they'll be hearing), or nothing's playing and they should
    //     see the new live and press play.
    if (isLive && !wasLive) {
      const archivePlaying = !!archivePlayer.isPlaying || !!archivePlayer.currentArchive;
      setHeroIndex(archivePlaying ? 1 : 0);
    }
    // Broadcast ended
    if (!isLive && wasLive) {
      setUserSelectedMode('archive');
      // Snap the carousel to whichever slide the playing source is on, so
      // the listener visually lands on what they're hearing (audio
      // uninterrupted in all cases).
      //   - Nothing playing → slide 0 (radio archive image, page default).
      //   - Radio playing → slide 0 (radio is now the slide 0 image).
      //   - Archive playing → slide 1 (the archive lives there).
      const archivePlaying = !!archivePlayer.isPlaying;
      setHeroIndex(archivePlaying ? 1 : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, archivePlayer.currentArchive]);

  // Show live in hero when user chose live and broadcast is actually live
  const showLiveInHero = isLive && userSelectedMode === 'live';

  // Auto-track userSelectedMode to 'live' once live audio is actually
  // playing — covers the auto-handoff path (radio → live) where the user
  // didn't tap a button so userSelectedMode wasn't set to 'live' by a
  // click handler. Without this, the love button would still point at
  // the radio DJ and the dots would stay hidden after auto-handoff.
  useEffect(() => {
    if (isLive && isLivePlaying && userSelectedMode !== 'live') {
      setUserSelectedMode('live');
    }
  }, [isLive, isLivePlaying, userSelectedMode]);

  // Continuous archive radio — driven by ArchiveRadioContext (mounted by
  // the page-level provider).
  const radioCtx = useArchiveRadioContext();
  const radioCurrentArchiveId = radioCtx?.currentItem?.archiveId ?? null;
  // Single source of truth: radioCtx resolves the archive doc from the
  // schedule item's id. All bar metadata (scene, username, tip, photo) reads
  // from there — same data the rest of the hero uses. While that subscription
  // resolves on first paint, fall back to the SSR-seeded radio archive so the
  // player bar shows the real show name + DJ instead of "Loading…".
  const radioArchive =
    radioCtx?.currentArchive ??
    (initialRadioArchiveId ? archives.find((a) => a.id === initialRadioArchiveId) ?? null : null);
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
  // Shared 30s nudge suppression across live/archive/radio love clicks —
  // clicking the heart on any bar quiets all of them, since they share
  // the same nudgeKey.
  const [nudgeDismissedAt, setNudgeDismissedAt] = useState<number | null>(null);
  const handleRadioLove = useCallback(async () => {
    setNudgeDismissedAt(Date.now());
    setRadioHeartTrigger((prev) => prev + 1);
    try { await radioSendLove(); } catch (err) { console.error('radio love failed', err); }
  }, [radioSendLove]);
  const radioSceneSlug = radioArchive
    ? resolveArchiveScenes(radioArchive, djSceneMap).find((s) => s !== 'grid') || null
    : null;

  // Single-source rule: starting a regular archive must pause the radio
  // (archivePlayer.play already pauses the live broadcast). Mirrors the
  // existing live↔archive pattern. Used everywhere archivePlayer.play is
  // called, so the radio coordinates the same way.
  const playArchive = useCallback((archive: ArchiveSerialized) => {
    if (radioCtx?.isPlaying) radioCtx.pause();
    archivePlayer.play(archive);
  }, [archivePlayer, radioCtx]);

  // Auto-advance when an archive finishes: pick a random high-priority
  // archive that shares ≥1 non-grid scene with the one that just ended.
  // Falls back to any other archive (any priority) if the same-scene pool
  // is empty, so the listener never just stops at silence.
  const archivesRef = useRef(archives);
  useEffect(() => { archivesRef.current = archives; }, [archives]);
  const djSceneMapRef = useRef(djSceneMap);
  useEffect(() => { djSceneMapRef.current = djSceneMap; }, [djSceneMap]);
  const onArchiveEndedRef = archivePlayer.onArchiveEndedRef;
  useEffect(() => {
    onArchiveEndedRef.current = (ended: ArchiveSerialized) => {
      const all = archivesRef.current;
      if (!all || all.length === 0) return;
      const endedScenes = new Set(
        resolveArchiveScenes(ended, djSceneMapRef.current).filter((s) => s !== 'grid')
      );
      const sharesScene = (a: ArchiveSerialized) => {
        if (endedScenes.size === 0) return false;
        const s = resolveArchiveScenes(a, djSceneMapRef.current);
        for (const id of s) if (id !== 'grid' && endedScenes.has(id)) return true;
        return false;
      };
      const primary = all.filter(
        (a) => a.id !== ended.id && priorityIsHigh(a.priority) && sharesScene(a)
      );
      const pool = primary.length > 0 ? primary : all.filter((a) => a.id !== ended.id);
      if (pool.length === 0) return;
      const next = pool[Math.floor(Math.random() * pool.length)];
      playArchive(next);
    };
    return () => { onArchiveEndedRef.current = null; };
  }, [onArchiveEndedRef, playArchive]);

  // Honor `?play=1` (e.g. /about → "Lock in" link): start whatever slide 0
  // would play (live if on, otherwise archive radio), then strip the param
  // so it doesn't fire again on back/forward. Fires once per visit.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const autoPlayConsumedRef = useRef(false);
  useEffect(() => {
    if (autoPlayConsumedRef.current) return;
    if (searchParams?.get('play') !== '1') return;
    if (isLive) {
      autoPlayConsumedRef.current = true;
      setUserSelectedMode('live');
      void playLive();
    } else if (radioCtx?.ready) {
      autoPlayConsumedRef.current = true;
      void radioCtx.play();
    } else {
      return; // wait for radio to be ready
    }
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('play');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, isLive, playLive, radioCtx, router, pathname]);


  // When a scene filter is actively narrowing the set (shared `?scene=` link or
  // user-toggled chips), the hero carousel should only feature archives in that
  // scene — not the full pool.
  // We don't pin to the listener-played archive here — that surfaces as slide 1
  // of the carousel instead.
  const heroArchives = useMemo(() => {
    // Visible scene chips (grid is hidden), used to decide whether filtering is active.
    const visibleSceneIds = scenes.filter((s) => s.id !== 'grid').map((s) => s.id);
    const allSelected = visibleSceneIds.length > 0 && visibleSceneIds.every((id) => sceneFilter.has(id));
    const noneSelected = visibleSceneIds.length > 0 && visibleSceneIds.every((id) => !sceneFilter.has(id));
    const filteringActive = !allSelected && !noneSelected;
    const inScene = (a: typeof archives[number]) =>
      !filteringActive ||
      resolveArchiveScenes(a, djSceneMap).some((id) => sceneFilter.has(id));

    const high = archives.filter(a => priorityIsHigh(a.priority) && inScene(a));
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
  }, [archives, maxHeroSlides, scenes, sceneFilter, djSceneMap, preferredHeroSeed]);

  // Slide 1 identity — drives both the picker (which archive to show) and
  // the surface labels (pill + inline bar). Three possibilities:
  //   - 'archive-engaged': listener has an archive loaded (playing, loading,
  //     or paused). Pill = "Archive", inline = archive bar.
  //   - 'radio': live is on with no listener archive engaged. Slide 1 shows
  //     the radio's current archive so the listener still has the radio
  //     image alongside live. Pill = "Restream", inline = radio bar.
  //   - 'archive-alt': everything else. Show an opposite-scene high-priority
  //     archive. Pill = "Archive", inline = archive bar.
  type Slide1Identity = 'archive-engaged' | 'radio' | 'archive-alt';
  const slide1Identity: Slide1Identity = useMemo(() => {
    // Archive is "engaged" whenever the player still has a currentArchive —
    // including the paused state. Otherwise the slide-1 image swaps to a
    // rotated alt archive while the player bar still shows the paused one,
    // desyncing image from metadata.
    const archiveEngaged =
      archivePlayer.isPlaying || archivePlayer.isLoading || !!archivePlayer.currentArchive;
    if (archiveEngaged) return 'archive-engaged';
    // When live is on (and nothing else is engaged), slide 1 is always
    // the radio identity — even if radioCurrentArchiveId hasn't loaded
    // yet. This avoids a transient 'archive-alt' identity that would
    // render the seekable archive bar and mis-route any tap on the play
    // button to archivePlayer.play, accidentally marking that archive
    // as the listener's selection.
    if (isLive) return 'radio';
    return 'archive-alt';
  }, [archivePlayer.isPlaying, archivePlayer.isLoading, archivePlayer.currentArchive, isLive]);

  const secondHeroArchive = useMemo<ArchiveSerialized | null>(() => {
    if (maxHeroSlides === 1) return null;
    if (slide1Identity === 'archive-engaged' && archivePlayer.currentArchive) {
      return archivePlayer.currentArchive;
    }
    if (slide1Identity === 'radio') {
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

    // Full pool: featured + high-priority archives, exclude:
    //   - the radio's own archive id (so slide 1 is never a literal
    //     duplicate of slide 0).
    //   - any archive whose primary DJ matches the radio's primary DJ
    //     (so slide 1 doesn't end up being a different show by the same
    //     DJ — visually it would look like the same image).
    const PER_SCENE_LIMIT = 5;
    const radioPrimaryDjUsername = radioArchive?.djs?.[0]?.username?.toLowerCase().trim() || null;
    const pool = archives.filter((a) => {
      if (!priorityIsHigh(a.priority)) return false;
      if (radioCurrentArchiveId && a.id === radioCurrentArchiveId) return false;
      if (radioPrimaryDjUsername) {
        const aPrimary = a.djs?.[0]?.username?.toLowerCase().trim();
        if (aPrimary && aPrimary === radioPrimaryDjUsername) return false;
      }
      return true;
    });

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
  }, [archivePlayer.currentArchive, archives, djSceneMap, heroArchives, maxHeroSlides, radioCurrentArchiveId, slide1Identity]);

  // Default to slide 1 when an archive is already engaged on mount — covers
  // the "playing an archive elsewhere on the site, then arriving on the
  // hero" case so the listener visually lands on what they're hearing
  // (slide 1 = listener-played archive). Otherwise default to slide 0
  // (radio/live).
  const [heroIndex, setHeroIndex] = useState<number>(() => {
    if (archivePlayer.currentArchive || archivePlayer.isPlaying || archivePlayer.isLoading) return 1;
    return 0;
  });
  const heroTouchRef = useRef<{ startX: number; startY: number } | null>(null);

  // When the filter pool shifts (user toggles a chip), clamp heroIndex so we
  // never land past the new array length — otherwise the hero shows
  // `undefined` and falls through to a stale featured archive.
  // 2-slot layout (radio + opposite-scene), or 1 if no second slide.
  const carouselSlideCount = secondHeroArchive ? 2 : 1;
  useEffect(() => {
    if (heroIndex >= carouselSlideCount) setHeroIndex(0);
  }, [carouselSlideCount, heroIndex]);

  // The currently displayed archive used by downstream UI (share button etc).
  // Prefer the listener-played archive, then slide-1 alternative, then
  // fallbacks. Slide 0 (radio/live) doesn't surface here.
  const displayedArchive =
    archivePlayer.currentArchive ?? secondHeroArchive ?? heroArchives[0] ?? featuredArchive;

  // Which slide does the currently-active source belong to?
  // Slide 0 owns: live + radio. Slide 1 owns: the listener-played archive.
  // When nothing's playing we treat slide 0 as the "default active" so the
  // inline bar still shows next to the radio image.
  const demoActiveSlide: 0 | 1 = (() => {
    if (archivePlayer.isPlaying || archivePlayer.isLoading) return 1;
    if (radioCtx?.isPlaying || radioCtx?.isLoading) return 0;
    if (isLive && isLivePlaying) return 0;
    return 0;
  })();
  // Whether the currently visible slide is showing the active audio source.
  // Drives both the play overlay (shown when false) and the inline-vs-sticky
  // bar swap.
  const demoSlideShowsActive = heroIndex === demoActiveSlide;

  // Publish the visible slide so the sticky bar can mirror it when nothing's
  // actively playing.
  useEffect(() => {
    if (!radioCtx) return;
    radioCtx.setVisibleSlide(heroIndex >= 1 ? 1 : 0);
  }, [heroIndex, radioCtx]);

  // Hand the archives list to the radio context so it can resolve
  // currentArchive from currentItem.archiveId. Single source of truth — no
  // denormalized scene/username on schedule items needed.
  useEffect(() => {
    if (!radioCtx) return;
    radioCtx.setArchives(archives);
  }, [archives, radioCtx]);

  // (Swipe never touches playback. Audio keeps playing whatever it was
  // playing when the listener swipes; each slide just shows an overlay
  // play button if its content isn't the active source. The single-source
  // rule is enforced by ArchiveRadioContext.toggle/play and archivePlayer
  // when the listener actually clicks the overlay.)
  // (No auto-swipe on listener play — hero composition is stable. The bar
  // follows what's playing via barMode; the hero only moves when the
  // listener manually swipes or clicks a dot/arrow.)

  // Inline player is always rendered under the visible slide and mirrors
  // that slide's content. The sticky bar takes over only when the visible
  // slide's source isn't what's actively playing — that signal is published
  // to ArchiveRadioContext (inlineCoversActive) and read by
  // GlobalBroadcastBar.
  useEffect(() => {
    if (!radioCtx) return;
    radioCtx.setInlineCoversActive(demoSlideShowsActive);
  }, [demoSlideShowsActive, radioCtx]);

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

  // Primary DJ info — live or archive based.
  // Slide 0 always renders the live image when isLive (regardless of
  // userSelectedMode), so the live data must be sourced whenever isLive is
  // true, not just when showLiveInHero is true.
  const useLiveData = showLiveInHero || isLive;
  const primaryDJ = displayedArchive.djs[0];
  const djUsername = useLiveData ? (liveDjProfileUsername || primaryDJ?.username) : primaryDJ?.username;
  const djName = useLiveData ? (liveDjName || displayedArchive.djs.map((d) => d.name).join(', ')) : displayedArchive.djs.map((d) => d.name).join(', ');
  const djPhotoUrl = useLiveData ? liveDjPhotoUrl : (displayedArchive.showImageUrl || primaryDJ?.photoUrl);

  // Fetch DJ profile for genres, tip link, and bio (used for live hero)
  const djProfile = useDJProfileInfo(djUsername);
  const djGenres = useLiveData ? liveDjGenres : djProfile.genres;
  const tipLink = useLiveData ? liveTipLink : djProfile.tipButtonLink;
  const djDescription = useLiveData ? liveDjDescription : djProfile.bio;

  // Image error state (for live hero)
  const [imageError, setImageError] = useState(false);
  const hasPhoto = djPhotoUrl && !imageError;

  // Heart / Love
  const [heartTrigger, setHeartTrigger] = useState(0);
  const { nudgeKey } = useHeartNudge();
  const skipNudge = !!nudgeDismissedAt && Date.now() - nudgeDismissedAt < 30_000;
  const anyPlaying = isLivePlaying || archivePlayer.isPlaying;
  // Slide 0's audio source is actually playing right now (live when on,
  // otherwise the archive radio).
  const slide0IsPlaying = isLive ? isLivePlaying : !!radioCtx?.isPlaying;
  // Carousel unlock: a single 5s wall-clock timer kicks off the first
  // time slide 0 begins playing. Pausing within that window doesn't
  // reset it — once 5s pass since the first press, the carousel
  // (arrows, dots, swipe, slide transition) unlocks for the session.
  const [slide0Unlocked, setSlide0Unlocked] = useState(false);
  const slide0TimerStartedRef = useRef(false);
  useEffect(() => {
    if (slide0Unlocked || slide0TimerStartedRef.current || !slide0IsPlaying) return;
    slide0TimerStartedRef.current = true;
    const t = setTimeout(() => setSlide0Unlocked(true), 5_000);
    return () => clearTimeout(t);
  }, [slide0IsPlaying, slide0Unlocked]);
  // Controls are always available from slide 1+; from slide 0, only after
  // unlock. When live is on, slide 0 is the live slide — always unlocked
  // (arrow + dots + swipe immediately available, regardless of play state).
  const carouselControlsVisible = heroIndex !== 0 || slide0Unlocked || isLive;
  const handleLove = () => {
    setNudgeDismissedAt(Date.now());
    setHeartTrigger((t) => t + 1);
    sendLove();
  };

  const [showAuthModal, setShowAuthModal] = useState(false);


  // DJ-specific chat hook for sending loves to the DJ currently shown in the
  // inline player bar. Rule: love goes to whoever the bar is *displaying*.
  //   listener-picked archive → that archive DJ (slide 1, active)
  //   live on → live DJ (slide 0, even if listener hasn't pressed play yet)
  //   radio fallback → radio DJ (slide 0 when live is off)
  //   final fallback → featured archive DJ
  const loveSourceArchive = archivePlayer.currentArchive || radioArchive || featuredArchive;
  const archiveDjProfileUsername = loveSourceArchive.djs[0]?.username?.replace(/\s+/g, '').toLowerCase() || '';
  const archiveDjName = loveSourceArchive.djs.map((d) => d.name).join(', ');
  // Route to live DJ whenever live is on AND the listener hasn't explicitly
  // engaged a different archive on slide 1. Drops the old `showLiveInHero`
  // gate which required `userSelectedMode === 'live'`.
  const routeToLive = isLive && !!liveDJChatRoom && !archivePlayer.currentArchive;
  const loveChatRoom = routeToLive ? liveDJChatRoom : (archiveDjProfileUsername || '');
  const loveDJLabel = routeToLive ? (liveDjName || '') : (archiveDjName || '');
  const archivePrimaryDj = loveSourceArchive.djs[0];
  const isArchiveLove = !routeToLive;
  const { sendLove } = useDJProfileChat({
    chatUsernameNormalized: loveChatRoom,
    djUsername: loveDJLabel,
    username: chatUsername || undefined,
    enabled: !!loveChatRoom,
    userId: user?.uid,
    djPhotoUrl: isArchiveLove ? archivePrimaryDj?.photoUrl : undefined,
    isArchivePlayback: isArchiveLove,
  });


  const showName = useLiveData ? liveShowName : displayedArchive.showName;

  return (
    <>
    <section className="relative z-10 px-4 pt-6 pb-2">
      <div className="max-w-7xl mx-auto mb-4">
        <h2 className="text-2xl md:text-3xl font-semibold flex items-center gap-2">
          {titleOverride ?? 'Human Radio'}
        </h2>
        {!hideSubtitle && (
          <p className="text-sm md:text-base text-zinc-400 mt-1">
            No ads. No algorithms. Just people with great taste.
          </p>
        )}
      </div>
      <div className={`${homepage ? 'max-w-[845px]' : 'max-w-3xl'} mx-auto`}>

        {/* Status line above image — reflects what the hero is showing */}
        <div className="flex items-center justify-between mb-2 relative">
          {/* Left side of the strip above the hero. When the archive bar
              is showing (slide 1 or a listener-played archive), swap the
              legacy "Next live at" copy for a "Back to Live/Radio" action
              that pauses the archive and resumes the page default. */}
          {(() => {
            // Switch button only shows on slide 1 AND only when slide 0's
            // source isn't already playing (no point telling the listener to
            // switch to what they're already hearing).
            // Also suppress when live just started and nothing else is
            // playing — the auto-snap-to-slide-0 effect will move the
            // listener to slide 0 in the next tick; showing a switch here
            // would flash for a frame.
            if (heroIndex < 1) return <span />;
            const slide0IsPlaying = isLive ? isLivePlaying : !!radioCtx?.isPlaying;
            if (slide0IsPlaying) return <span />;
            const nothingPlaying = !radioCtx?.isPlaying && !archivePlayer.isPlaying && !archivePlayer.currentArchive && !isLivePlaying;
            if (isLive && nothingPlaying) return <span />;
            if (isLive) {
              return (
                <button
                  onClick={() => { archivePlayer.pause(); setHeroIndex(0); setUserSelectedMode('live'); tapPlayLive(); }}
                  className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-tighter font-bold transition-colors text-red-500 hover:text-red-400"
                >
                  Switch to Live Radio
                  <span className="relative flex h-2 w-2">
                    <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-red-400" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]" />
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
                Switch to
                {/* Pulsing red dot — same one used for Live, makes it
                    obvious that the radio is currently going. */}
                <span className="relative flex h-2 w-2">
                  <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-red-400" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]" />
                </span>
                Radio
              </button>
            );
          })()}
          <div className="flex items-center">
            {/* Pill matches what the visible slide is showing:
                  Slide 0 + isLive → Live (red dot, BPM if available)
                  Slide 0 + !isLive → Restream (radio archive playing on
                    the schedule)
                  Slide 1 → Archive (a recorded archive, not live), or
                    Restream when slide 1 IS the radio's archive.
                Pill shells are rectangular with straight corners
                (no rounded-*). LIVE = white text on red. RADIO /
                RESTREAM / ARCHIVE = grey text on white. */}
            {heroIndex === 0 && isLive ? (
              isRestream ? (
                <div className="flex items-center gap-1.5 bg-white px-2 py-0.5">
                  <svg className="w-3 h-3 text-zinc-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-500">
                    Restream{liveBPM ? ` ${liveBPM} BPM` : null}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-red-600 px-2 py-0.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-white" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                  </span>
                  <span className="text-xs font-mono uppercase tracking-tighter font-bold text-white">
                    Live{liveBPM ? ` ${liveBPM} BPM` : null}
                  </span>
                </div>
              )
            ) : heroIndex === 0 ? (
              // Slide 0 + offline → archive radio. Red pulsing dot + RADIO.
              <div className="flex items-center gap-1.5 bg-white px-2 py-0.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-red-400" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                </span>
                <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-500">
                  Radio
                </span>
              </div>
            ) : slide1Identity === 'radio' ? (
              // Slide 1 = the radio's currently-playing archive (live is
              // on, listener hasn't picked their own archive). It's the
              // radio card visually, so use the radio pill.
              <div className="flex items-center gap-1.5 bg-white px-2 py-0.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-red-400" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                </span>
                <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-500">
                  Radio
                </span>
              </div>
            ) : (
              // Slide 1 → archive playback (listener-picked or
              // alternative). Keep the original transparent-bg pill —
              // the new rectangular shells are reserved for the
              // live/radio sources.
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="5" rx="1" />
                  <path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
                  <path d="M10 12h4" />
                </svg>
                <span className="text-xs font-mono uppercase tracking-tighter font-bold text-zinc-400">
                  Archive
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Hero Image Carousel.
              • Slide 0 = live (when on) OR archive radio (when offline)
              • Slide 1 = listener-picked archive, or the radio's current
                archive when live is on, or an opposite-scene alternative. */}
        {(
          <div
            className="relative"
            onTouchStart={carouselControlsVisible ? (e) => { heroTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY }; } : undefined}
            onTouchEnd={carouselControlsVisible ? (e) => {
              if (!heroTouchRef.current) return;
              const dx = e.changedTouches[0].clientX - heroTouchRef.current.startX;
              const dy = e.changedTouches[0].clientY - heroTouchRef.current.startY;
              heroTouchRef.current = null;
              if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
              if (dx < 0 && heroIndex < carouselSlideCount - 1) setHeroIndex(heroIndex + 1);
              if (dx > 0 && heroIndex > 0) setHeroIndex(heroIndex - 1);
            } : undefined}
          >
            <div className="overflow-hidden">
              <div
                className={`flex ${carouselControlsVisible ? 'transition-transform duration-300 ease-out' : ''}`}
                style={{ transform: `translateX(-${heroIndex * 100}%)` }}
              >
                <>
                    <div key="slide-0" className="relative w-full flex-shrink-0 flex flex-col">
                      {/* Slide 0: live image when a broadcast is on (regardless
                          of userSelectedMode), else the radio slide. */}
                      {isLive ? (
                        // Slide 0 = live image. Wrapped in a <button> so a
                        // tap on the image itself toggles live (matches the
                        // overlay play/pause button beneath; both routes
                        // drive the same broadcast.toggle).
                        <button
                          onClick={() => {
                            if (isLivePlaying) toggleLive();
                            else { setUserSelectedMode('live'); tapPlayLive(); }
                          }}
                          className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10 text-left"
                          aria-label={isLivePlaying ? 'Pause live' : 'Play live'}
                        >
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
                              <DancingBars />
                              {/* Show name — top left. 17px, wraps to at most 2
                                  lines when needed. No glyph overlay on live. */}
                              <div className="absolute top-2 left-2 right-2 drop-shadow-lg">
                                <span className="text-[17px] font-bold text-white uppercase tracking-wide line-clamp-2 block">{showName}</span>
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
                        </button>
                      ) : (() => {
                        // Slide 0 = archive radio. During an interlude (clip
                        // scheduled between archive shows) render a station-ID
                        // slide instead of resolving an archive.
                        if (radioCtx?.currentItem?.kind === 'interstitial') {
                          return (
                            <InterludeSlide
                              onPlay={() => { void radioCtx?.toggle(); }}
                            />
                          );
                        }
                        // Prefer the resolved archive doc so we render a real
                        // HeroSlide (DJ overlay, scene glyphs, photo). While
                        // the schedule loads, fall back to the SSR-resolved
                        // radio archive (so the image matches what's actually
                        // playing on first paint), then to the featured
                        // archive as a last resort.
                        const liveRadioId = radioCtx?.currentItem?.archiveId;
                        const seedId = initialRadioArchiveId ?? null;
                        const radioArchive =
                          (liveRadioId ? archives.find((a) => a.id === liveRadioId) : null) ??
                          (seedId ? archives.find((a) => a.id === seedId) : null) ??
                          featuredArchive;
                        return (
                          <HeroSlide
                            archive={radioArchive}
                            sceneSlugs={resolveArchiveScenes(radioArchive, djSceneMap)}
                            onPlay={() => { void radioCtx?.toggle(); }}
                            isPlaying={!!radioCtx?.isPlaying}
                            isLiveOrRadio={true}
                          />
                        );
                      })()}
                      {/* Tap overlay. Always covers the slide so the card
                          stays clickable. Shows a play icon only when the
                          slide's source isn't currently playing — no pause
                          icon (pausing belongs to the player bar). Matches
                          slide 1's behavior. */}
                      {(() => {
                        const slideIsPlaying = isLive ? isLivePlaying : !!radioCtx?.isPlaying;
                        return (
                          <button
                            onClick={() => {
                              if (isLive) {
                                if (isLivePlaying) toggleLive();
                                else { setUserSelectedMode('live'); tapPlayLive(); }
                              } else {
                                void radioCtx?.toggle();
                              }
                            }}
                            aria-label={slideIsPlaying ? 'Pause' : 'Play this'}
                            className="absolute inset-0 transition-opacity hover:bg-black/30"
                          />
                        );
                      })()}
                    </div>
                    {secondHeroArchive && (
                      <div key={`slide-1-${secondHeroArchive.id}`} className="relative w-full flex-shrink-0 flex flex-col">
                        <HeroSlide
                          archive={secondHeroArchive}
                          sceneSlugs={resolveArchiveScenes(secondHeroArchive, djSceneMap)}
                          isPlaying={slide1Identity === 'radio'
                            ? !!radioCtx?.isPlaying
                            : (archivePlayer.isPlaying && archivePlayer.currentArchive?.id === secondHeroArchive.id)}
                          isLiveOrRadio={slide1Identity === 'radio'}
                          onPlay={() => {
                            // When slide 1 IS the radio archive (live is on,
                            // listener hasn't picked their own archive),
                            // tapping the image must toggle the radio — NOT
                            // register the archive as a listener selection
                            // via archivePlayer.play (which would then
                            // permanently switch the bar to the seekable
                            // archive bar).
                            if (slide1Identity === 'radio') {
                              void radioCtx?.toggle();
                            } else {
                              setUserSelectedMode('archive');
                              playArchive(secondHeroArchive);
                            }
                          }}
                        />
                        {/* Tap overlay. Always covers the slide so the card
                            stays clickable. Shows a play icon only when the
                            slide's source isn't currently playing — no pause
                            icon (pausing belongs to the player bar). While
                            playing, tapping still toggles via the bar. */}
                        {(() => {
                          const slideIsRadio = slide1Identity === 'radio';
                          const slideIsPlaying = slideIsRadio
                            ? !!radioCtx?.isPlaying
                            : (archivePlayer.isPlaying &&
                               archivePlayer.currentArchive?.id === secondHeroArchive.id);
                          return (
                            <button
                              onClick={() => {
                                if (slideIsRadio) {
                                  void radioCtx?.toggle();
                                } else if (slideIsPlaying) {
                                  archivePlayer.toggle();
                                } else {
                                  setUserSelectedMode('archive');
                                  playArchive(secondHeroArchive);
                                }
                              }}
                              aria-label={slideIsPlaying ? 'Pause' : (slideIsRadio ? 'Play radio' : 'Play this archive')}
                              className="absolute inset-0 transition-opacity hover:bg-black/30"
                            />
                          );
                        })()}
                      </div>
                    )}
                </>
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
                {/* Right arrow only when there's a next slide and the
                    carousel has been unlocked (listener has pressed play on
                    slide 0 at least once). */}
                {heroIndex < carouselSlideCount - 1 && carouselControlsVisible && (
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
        {/* Player bar. Always rendered, mirrors the visible slide.
            Bar selection follows heroIndex (slide-driven), not what's
            playing. The sticky bar takes over only when the visible slide's
            source isn't the active source. */}
        <div ref={stickyBarRef} className="bg-black relative">
          {/* Inline bar = radio bar when:
                - slide 0 visible AND not live, OR
                - slide 1 visible AND its identity is 'radio' (the radio's
                  currently-playing archive, shown when live is on and no
                  listener-archive is engaged). */}
          {radioCtx && (
            (heroIndex === 0 && !isLive) ||
            (heroIndex >= 1 && slide1Identity === 'radio')
          ) ? (
            (() => {
              // Interlude state mirrors GlobalBroadcastBar's radio branch:
              // show channel branding, hide DJ-specific actions (scene glyph,
              // profile link, love, tip — there's no DJ to send love to).
              const isInterlude = radioCtx.currentItem?.kind === 'interstitial';
              const radioBarTitle = isInterlude
                ? 'interlude'
                : (radioArchive?.showName || radioCtx.currentItem?.title || (radioCtx.ready ? 'No archive scheduled' : 'Loading…'));
              const radioBarDjs = isInterlude
                ? 'channel radio'
                : (radioArchive?.djs?.map((d) => d.name).join(', ') || '');
              return (
            <>
              {/* Radio player bar — same chrome as the archive bar (scene
                  glyph, play, scrolling text, profile, love, tip), but driven
                  by the radio context. The progress is non-seekable because
                  the radio is a synced schedule, not a single audio file. */}
              <div className="flex items-center gap-0.5 sm:gap-[11px] py-2 px-1">
                <div className="flex items-center ml-1 flex-shrink-0">
                  {radioSceneSlug && !isInterlude ? (
                    <div className="w-[27px] h-[27px] flex items-center justify-center bg-white text-black flex-shrink-0">
                      <SceneGlyph slug={radioSceneSlug} className="!w-5 !h-5" />
                    </div>
                  ) : isInterlude ? (
                    // Reserve the slot during interludes so layout doesn't shift.
                    <div className="w-[27px] h-[27px] flex-shrink-0" aria-hidden="true" />
                  ) : null}
                  <button
                    onClick={() => {
                      if (radioCtx.stalled) { void radioCtx.play(); return; }
                      void radioCtx.toggle();
                    }}
                    className="h-[27px] pl-2 pr-1 flex items-center justify-center transition-colors"
                    aria-label={radioCtx.stalled ? 'Tap to resume' : radioCtx.isPlaying ? 'Pause' : 'Play'}
                  >
                    {radioCtx.isLoading || !radioCtx.ready ? (
                      <svg className="w-8 h-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : radioCtx.isPlaying && !radioCtx.stalled ? (
                      <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 3h4v18H6V3zm8 0h4v18h-4V3z" />
                      </svg>
                    ) : (
                      <svg className={`w-8 h-8 text-white ${radioCtx.stalled ? 'animate-pulse' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M5 3v18l15-9z" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <ScrollingShowName
                    text={radioBarTitle}
                    className="text-sm font-bold leading-tight text-white"
                  />
                  {radioBarDjs && (
                    <ScrollingDJName
                      text={radioBarDjs}
                      className="text-[10px] text-zinc-500 mt-0.5 leading-[1.3em]"
                    />
                  )}
                </div>
                {/* Pulsing red dot — same as live, marks "live audio" feel
                    on the radio (it's a synced stream, not a static archive).
                    Wrapper matches icon hit-area so spacing in the row stays
                    even across dot + icon siblings. */}
                <div className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center flex-shrink-0">
                  <span className="relative flex h-2.5 w-2.5 sm:h-[18px] sm:w-[18px] items-center justify-center">
                    <span className="animate-live-pulse absolute inline-flex h-2.5 w-2.5 sm:h-[11px] sm:w-[11px] rounded-full bg-red-400" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-[11px] sm:w-[11px] bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                  </span>
                </div>
                {!isInterlude && radioDjUsernameNormalized && (
                  <Link href={`/dj/${radioDjUsernameNormalized}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                    <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </Link>
                )}
                {!isInterlude && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => { void handleRadioLove(); }}
                      className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                    >
                      <svg key={`r-${nudgeKey}`} className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${radioCtx.isPlaying && nudgeKey > 0 && !skipNudge ? 'animate-heart-nudge' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                    </button>
                    <FloatingHearts trigger={radioHeartTrigger} />
                  </div>
                )}
                {!isInterlude && radioTipLink && (
                  <TipButton
                    djUsername={radioPrimaryDj?.name || 'DJ'}
                    tipLink={radioTipLink}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                    iconClassName="w-4 h-4 sm:w-[18px] sm:h-[18px]"
                  />
                )}
              </div>
              {radioCtx.error && (
                <p className="text-red-400 text-xs pb-2 px-2">{radioCtx.error}</p>
              )}
              {/* Same shape as the live bar: clock-time start/end + a
                  non-seekable progress bar driven by the schedule. The
                  slot is always rendered (empty placeholder when data
                  isn't ready) so the layout doesn't jump when start/end
                  times arrive. */}
              {radioCtx.itemStartMs !== null && radioCtx.itemEndMs !== null ? (
                <>
                  <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                    <span>{formatClockTime(radioCtx.itemStartMs)}</span>
                    <span>{formatClockTime(radioCtx.itemEndMs)}</span>
                  </div>
                  <ShowProgressBar startTime={radioCtx.itemStartMs} endTime={radioCtx.itemEndMs} />
                </>
              ) : (
                <>
                  <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                    <span>&nbsp;</span>
                    <span>&nbsp;</span>
                  </div>
                  <div className="relative w-full select-none">
                    <div className="py-2">
                      <div className="relative w-full h-[3px] bg-white/10 rounded-full" />
                    </div>
                  </div>
                </>
              )}
            </>
              );
            })()
          ) : (heroIndex === 0 && isLive) ? (
            <>
              {/* Live player bar — uses the archive-bar play size (h-[27px]
                  wrapper, w-8 icon) so swiping between cards doesn't change
                  the button size. */}
              <div className="flex items-center gap-0.5 sm:gap-[11px] py-2 px-1">
                <button
                  onClick={() => { if (isLivePlaying) toggleLive(); else tapPlayLive(); }}
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
                {/* Live indicator + BPM. Min-width matches icon hit-area so
                    spacing in the row stays even across dot + icon siblings;
                    auto-width lets the BPM label render on a single line. */}
                <div className="min-w-7 h-7 sm:min-w-10 sm:h-10 flex items-center justify-center gap-1 flex-shrink-0 px-1">
                  <span className="relative flex h-2.5 w-2.5 sm:h-[18px] sm:w-[18px] items-center justify-center">
                    <span className="animate-live-pulse absolute inline-flex h-2.5 w-2.5 sm:h-[11px] sm:w-[11px] rounded-full bg-red-400" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-[11px] sm:w-[11px] bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                  </span>
                  {liveBPM && (
                    <span className="hidden md:inline text-xs font-mono uppercase tracking-tighter font-bold text-red-500 whitespace-nowrap">
                      {liveBPM} BPM
                    </span>
                  )}
                </div>
                {liveDjProfileUsername && (
                  <Link href={`/dj/${liveDjProfileUsername.replace(/\s+/g, '').toLowerCase()}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                    <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </Link>
                )}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg key={nudgeKey} className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${anyPlaying && nudgeKey > 0 && !skipNudge ? 'animate-heart-nudge' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink ? (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                    iconClassName="w-4 h-4 sm:w-[18px] sm:h-[18px]"
                  />
                ) : useLiveData && isLive ? (
                  <button
                    type="button"
                    onClick={() => document.dispatchEvent(new CustomEvent('openchat'))}
                    aria-label="Open chat"
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </button>
                ) : null}
              </div>
              {streamError && (
                <p className="text-red-400 text-xs pb-2 px-2">
                  {/* Specific copy for the auto-handoff failure case: iOS
                      rejected broadcast.play() because the live <audio>
                      element wasn't gesture-unlocked, while the listener
                      was still hearing the radio. The original message
                      ("Tap to play") suggests they were already on live —
                      "Tap to join live show" is more accurate. */}
                  {streamError === 'Tap to play' && radioCtx?.isPlaying
                    ? 'Tap to join live show'
                    : streamError}
                </p>
              )}
              {/* Always render the time/progress slot so the layout
                  doesn't jump while currentShow is still loading. */}
              {currentShow ? (
                <>
                  <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                    <span>{formatClockTime(currentShow.startTime)}</span>
                    <span>{formatClockTime(currentShow.endTime)}</span>
                  </div>
                  <ShowProgressBar startTime={currentShow.startTime} endTime={currentShow.endTime} />
                </>
              ) : (
                <>
                  <div className="flex justify-between text-[10px] text-zinc-600 px-2 pb-0.5">
                    <span>&nbsp;</span>
                    <span>&nbsp;</span>
                  </div>
                  <div className="relative w-full select-none">
                    <div className="py-2">
                      <div className="relative w-full h-[3px] bg-white/10 rounded-full" />
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Archive player bar */}
              <div className="flex items-center gap-0.5 sm:gap-[11px] py-2 px-1">
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
                {/* Archive-folder source indicator — same spot where radio/
                    live bars show the pulsing red dot. Mirrors the "Archive"
                    pill above the hero, no text label here. Wrapper matches
                    icon hit-area so spacing in the row stays even. */}
                <div className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="5" rx="1" />
                    <path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
                    <path d="M10 12h4" />
                  </svg>
                </div>
                {(() => {
                  const archiveDjUsername = displayedArchive.djs[0]?.username?.replace(/\s+/g, '').toLowerCase();
                  return archiveDjUsername ? (
                    <Link href={`/dj/${archiveDjUsername}`} className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors flex-shrink-0">
                      <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </Link>
                  ) : null;
                })()}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={handleLove}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-white/70 transition-colors text-white"
                  >
                    <svg key={nudgeKey} className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${anyPlaying && nudgeKey > 0 && !skipNudge ? 'animate-heart-nudge' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <FloatingHearts trigger={heartTrigger} />
                </div>
                {tipLink ? (
                  <TipButton
                    djUsername={djName || 'DJ'}
                    tipLink={tipLink}
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center hover:text-green-300 transition-colors text-green-400 flex-shrink-0"
                    iconClassName="w-4 h-4 sm:w-[18px] sm:h-[18px]"
                  />
                ) : useLiveData && isLive ? (
                  <button
                    type="button"
                    onClick={() => document.dispatchEvent(new CustomEvent('openchat'))}
                    aria-label="Open chat"
                    className="w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4 sm:w-[18px] sm:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </button>
                ) : null}
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

        {/* Carousel dots — always reserve space below player bar to prevent
            layout shift. Hidden until the carousel is unlocked (same gate
            as the right arrow and swipe). */}
        <div className="flex justify-center gap-1.5 pt-2 h-3.5">
          {carouselSlideCount > 1 && carouselControlsVisible && Array.from({ length: carouselSlideCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => setHeroIndex(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === heroIndex ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>

      </div>

      {/* Past shows — full-width cards */}
      {(() => {
        // The "hero pin" used to be heroArchives[0] (the spiral pick). With
        // the new layout, slide 1 of the carousel is whatever we featured —
        // pin that one to position 3 of the past-shows grid for continuity.
        const heroFirstId = secondHeroArchive?.id ?? heroArchives[0]?.id;
        // Rank by priority tier first (featured above high above medium),
        // recency as the tiebreaker within a tier — matching the grid order
        // ChannelClient computes. 'low'/'hidden' are filtered out upstream but
        // are ranked anyway so the order stays sane if any slip through.
        const prefiltered = archives
          .slice()
          .sort((a, b) => {
            const rank = priorityRank(a.priority) - priorityRank(b.priority);
            if (rank !== 0) return rank;
            return (b.recordedAt || 0) - (a.recordedAt || 0);
          });

        // Compute effective scenes per archive once and attach as a tuple list.
        const archivesWithScenes = prefiltered.map((a) => ({
          archive: a,
          sceneIds: resolveArchiveScenes(a, djSceneMap),
        }));

        // Scene chips: spiral + star are a fixed, known set, so render them from
        // a static fallback that paints instantly on page load — same as the
        // ALL TEMPOS button. useScenesData() fetches scene docs asynchronously;
        // once it resolves we use the live list (for names/order), but we never
        // wait on it to show the glyphs. Grid is hidden for now.
        const loadedScenes = scenes.filter((s) => s.id !== 'grid');
        const availableScenes = loadedScenes.length > 0 ? loadedScenes : STATIC_SCENE_CHIPS;

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

        const sceneFiltered = filteringActive
          ? archivesWithScenes.filter(({ sceneIds }) =>
              sceneIds.some((id) => sceneFilter.has(id))
            )
          : archivesWithScenes;

        // Tempo filter: the four tempos are a fixed, known set, so always offer
        // all of them. This lets the ALL TEMPOS button paint immediately on load
        // (alongside the scene glyphs) instead of waiting for archives to arrive
        // and resolve their tags.
        const availableTempos = TEMPOS;
        // Same "all selected == no filter" convention as scenes.
        const allTemposSelected =
          availableTempos.length > 0 && availableTempos.every((t) => tempoFilter.has(t.id));
        const noTempoSelected =
          availableTempos.length > 0 && availableTempos.every((t) => !tempoFilter.has(t.id));
        const tempoFilteringActive = !allTemposSelected && !noTempoSelected;
        // When narrowing to specific tempos, only matching (tagged) archives show.
        const filteredArchives = tempoFilteringActive
          ? sceneFiltered.filter(({ archive }) => archive.tempo && tempoFilter.has(archive.tempo))
          : sceneFiltered;

        // Split into the dedicated "Featured" section (featured tier only) and
        // the "Archives" section (everything else). Featured archives appear in
        // the Featured section ONLY — not duplicated below. Both lists are
        // already scene- + tempo-filtered, so the chips drive both sections.
        const featuredList = filteredArchives.filter(({ archive }) => priorityIsFeatured(archive.priority));
        const nonFeatured = filteredArchives.filter(({ archive }) => !priorityIsFeatured(archive.priority));

        // Move hero first to position 3 of the Archives grid (only when neither
        // filter is active, so the curated order is preserved). The pin runs on
        // the non-featured list since featured items live in their own section.
        const anyFilteringActive = filteringActive || tempoFilteringActive;
        const heroItem = heroFirstId ? nonFeatured.find((x) => x.archive.id === heroFirstId) : null;
        const ordered = heroItem && !anyFilteringActive
          ? (() => {
              const rest = nonFeatured.filter((x) => x.archive.id !== heroFirstId);
              return [...rest.slice(0, 2), heroItem, ...rest.slice(2)];
            })()
          : nonFeatured;

        // Filter chips (scene glyphs + tempo dropdown). Rendered once — in the
        // Featured header when a Featured section exists, otherwise in the
        // Archives header — so the filters are always reachable but never doubled.
        const filterChips =
          (availableScenes.length > 0 || availableTempos.length > 0) ? (
            <div className="flex flex-wrap items-center justify-end gap-1 md:gap-2 shrink-0">
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
              {availableTempos.length > 0 && (
                <TempoFilterDropdown
                  tempos={availableTempos}
                  tempoFilter={tempoFilter}
                  noneSelected={noTempoSelected}
                  onToggle={toggleTempoFilter}
                />
              )}
            </div>
          ) : null;

        // Card-grid renderer shared by both sections.
        const renderGrid = (items: typeof filteredArchives) => (
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mx-auto ${homepage ? 'max-w-[90%]' : ''}`}>
            {items.map(({ archive, sceneIds }) => (
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
                    setUserSelectedMode('archive');
                    playArchive(archive);
                    // Snap the carousel to slide 1 — that's where the
                    // listener-played archive renders. Without this the
                    // listener stays on slide 0 (radio/live) while their
                    // archive is what's actually playing.
                    setHeroIndex(1);
                  }
                }}
              />
            ))}
          </div>
        );

        const hasFeatured = featuredList.length > 0;

        return (
          <div className="mt-6 max-w-7xl mx-auto">
            {/* Featured section — featured-tier archives only. Chips live here
                when present so they sit at the top of the archive area. */}
            {hasFeatured && (
              <div className="mb-10">
                <div className="mb-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-2xl md:text-3xl font-semibold">Featured</h2>
                    {filterChips}
                  </div>
                  <p className="text-sm md:text-base text-zinc-400 mt-1">Hand-picked shows from the catalog</p>
                </div>
                {renderGrid(featuredList)}
              </div>
            )}

            {/* Archives section — everything except featured. */}
            <div className="mb-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl md:text-3xl font-semibold">Archives</h2>
                {/* When a Featured section is showing it already holds the chips. */}
                {hasFeatured ? null : filterChips}
              </div>
              <p className="text-sm md:text-base text-zinc-400 mt-1">Intentional shows by DJs and producers</p>
            </div>
            {renderGrid(ordered)}
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

// Station-ID slide rendered when the radio schedule is on an interlude clip.
// Same aspect / chrome as HeroSlide so swapping in/out doesn't shift layout.
// Exported so the /internal/crossfade-test preview can mount it directly.
export function InterludeSlide({ onPlay }: { onPlay: () => void }) {
  return (
    <button
      onClick={onPlay}
      className="relative w-full aspect-[16/9] lg:aspect-[5/2] overflow-hidden border border-white/10 flex-shrink-0 text-left"
    >
      <Image
        src="/interludes/channel-bg-1080x1080.png"
        alt="channel radio interlude"
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, 768px"
        priority
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
      <DancingBars />
      {/* Top-left show name — matches isLiveOrRadio HeroSlide chrome. */}
      <div className="absolute top-2 left-2 right-9 drop-shadow-lg">
        <span className="text-[17px] font-bold text-white uppercase tracking-wide block truncate">interlude</span>
      </div>
    </button>
  );
}

function HeroSlide({
  archive,
  sceneSlugs,
  onPlay,
  isPlaying,
  // True when this slide represents the live/radio source (radio
  // archive on slide 0 when offline, or slide-1 mirroring the radio
  // archive while live is on). When false this is a listener-picked
  // archive — keep the old chrome (center play disc, no dancing bars,
  // smaller show name, no glyph-padding reserve).
  isLiveOrRadio,
}: {
  archive: ArchiveSerialized;
  sceneSlugs?: string[];
  onPlay: () => void;
  isPlaying?: boolean;
  isLiveOrRadio: boolean;
}) {
  const primaryDj = archive.djs[0];
  const djName = archive.djs.map(d => d.name).join(', ');
  const photoUrl = archive.showImageUrl || primaryDj?.photoUrl;
  const djProfile = useDJProfileInfo(primaryDj?.username);
  const djGenres = (primaryDj?.genres?.length ? primaryDj.genres : djProfile.genres) || [];
  const djDescription = djProfile.bio;
  const [imgError, setImgError] = useState(false);
  const hasPhoto = photoUrl && !imgError;
  // Top-right frosted tag: first non-grid scene glyph + tempo name.
  const heroGlyphSlug = sceneSlugs?.find((s) => s !== 'grid');
  const heroTempoText = tempoLabel(archive.tempo) ?? undefined;

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
          {isLiveOrRadio && <DancingBars />}
          {/* Show name — top left. Uniform 17px across hero slides; wraps to at
              most 2 lines when needed and reserves right padding so it clears
              the top-right frosted tempo badge. */}
          <div className={`absolute top-2 left-2 drop-shadow-lg ${heroGlyphSlug ? 'right-28' : 'right-2'}`}>
            <span className="text-[17px] font-bold text-white uppercase tracking-wide line-clamp-2 block">{archive.showName}</span>
          </div>
          {/* Top right: frosted-glass mood + tempo tag (same as the grid cards).
              Glyph + tempo name; glyph-only when the archive is untagged. */}
          {heroGlyphSlug && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wide leading-none text-white bg-black/15 backdrop-blur-xl border border-white/10">
              <SceneGlyph slug={heroGlyphSlug} className="!w-3 !h-3 shrink-0" />
              {heroTempoText && <span className="pt-px">{heroTempoText}</span>}
            </div>
          )}
          {/* Center play disc — archive playback only, restoring old
              chrome (live/radio hides this in favor of the bars and
              the player bar's play button). */}
          {!isLiveOrRadio && !isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-12 h-12 rounded-full bg-black/40 border border-white/30 flex items-center justify-center drop-shadow-lg">
                <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
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

// "ALL TEMPOS" filter: one button that opens a checklist popover. Unchecking a
// tempo narrows the Archives grid. All checked (the default) == no filter.
function TempoFilterDropdown({
  tempos,
  tempoFilter,
  noneSelected,
  onToggle,
}: {
  tempos: ReadonlyArray<{ id: Tempo; label: string }>;
  tempoFilter: Set<Tempo>;
  noneSelected: boolean;
  onToggle: (tempo: Tempo) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // A tempo counts as "on" when its chip is checked (or nothing is selected,
  // which we treat as "all on"). The button reads TEMPO when everything's on,
  // the single tempo's name when exactly one is selected, otherwise the count.
  const isOn = (id: Tempo) => noneSelected || tempoFilter.has(id);
  const selectedTempos = tempos.filter((t) => isOn(t.id));
  const selectedCount = selectedTempos.length;
  const allOn = selectedCount === tempos.length;
  const buttonLabel = allOn
    ? 'TEMPO'
    : selectedCount === 1
      ? selectedTempos[0].label
      : `${selectedCount} TEMPOS`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-[27px] px-2.5 flex items-center gap-1.5 text-[14.3px] font-mono uppercase tracking-tighter whitespace-nowrap bg-white text-black transition-colors"
      >
        {buttonLabel}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1 z-50 min-w-[160px] bg-black border border-white/15 shadow-xl"
        >
          {tempos.map((t) => {
            const checked = isOn(t.id);
            return (
              <button
                key={t.id}
                onClick={() => onToggle(t.id)}
                role="option"
                aria-selected={checked}
                className={`w-full text-left px-3 py-2 text-[14.3px] font-mono uppercase tracking-tighter flex items-center justify-between transition-colors ${
                  checked ? 'text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {t.label}
                {checked && (
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
  const genreText = genres.length > 0 ? genres.map((g) => g.toUpperCase()).join(' · ') : null;
  const displayImage = archive.showImageUrl || primaryDj?.photoUrl;

  // Label above the card: the archive's tempo (admin-set) followed by the scene
  // glyph. Replaces the old matched genre/location line. tempoText is undefined
  // when the archive is untagged; glyphSlug is the first non-grid scene.
  const tempoText = tempoLabel(archive.tempo) ?? undefined;
  const glyphSlug = sceneChips?.find((c) => c.slug !== 'grid')?.slug;
  // True when something occupies the image's top-right corner (live badge or the
  // tempo tag) — used to reserve right padding on the show-name so it wraps clear.
  const hasTopRightBadge = isLiveCard || !!glyphSlug;

  const profileSlug = primaryUsername
    ? primaryUsername.replace(/\s+/g, '').toLowerCase()
    : null;

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Image with hero-style overlays. The profile button is a sibling overlay
          (not nested in the play <button>) so the anchor stays valid HTML. */}
      <div className="relative">
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

        {/* Top left: Show name. Wraps to at most 2 lines; right padding reserves
            space for the top-right badge (live or tempo tag) so the title clears
            it instead of running underneath — matters most on narrow mobile cards. */}
        <div className={`absolute top-2.5 left-2.5 right-2.5 drop-shadow-lg ${hasTopRightBadge ? 'pr-24' : ''}`}>
          <span className="text-sm font-bold text-white uppercase tracking-wide line-clamp-2 block">{archive.showName}</span>
        </div>

        {/* Top right: Live badge + BPM (only on live cards) */}
        {isLiveCard && (
          <div className="absolute top-1 right-1 md:top-1.5 md:right-1.5 flex items-center gap-1 drop-shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-red-400" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]" />
            </span>
            <span className="text-[10px] font-mono uppercase tracking-tighter font-bold text-red-500">
              Live{cardLiveBPM ? ` ${cardLiveBPM} BPM` : ''}
            </span>
          </div>
        )}

        {/* Top right: frosted-glass mood + tempo tag (non-live cards). Shows the
            scene glyph + tempo name; glyph-only when the archive is untagged.
            High-transparency glass: heavy backdrop blur keeps the white text
            readable over busy images; subtle white border catches the light. */}
        {!isLiveCard && glyphSlug && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wide leading-none text-white bg-black/15 backdrop-blur-xl border border-white/10">
            <SceneGlyph slug={glyphSlug} className="!w-3 !h-3 shrink-0" />
            {tempoText && <span className="pt-px">{tempoText}</span>}
          </div>
        )}

        {/* Bottom: DJ name, genre below. Full width — the genre/name run UNDER
            the frosted-glass profile button (which overlays on top with its blur)
            rather than truncating early to avoid it. Matters on narrow mobile cards. */}
        {displayImage && (
          <div className="absolute bottom-2.5 left-2.5 right-2.5 drop-shadow-lg">
            <div className="text-sm font-black uppercase tracking-wider text-white whitespace-nowrap overflow-hidden">
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

      {/* Bottom right: square frosted-glass profile button (overlays the image,
          sibling of the play button so the anchor is valid + clickable).
          Same high-transparency glass as the tempo tag: square (no radius),
          subtle white border, pure-white centered person icon. */}
      {profileSlug && (
        <Link
          href={`/dj/${profileSlug}`}
          aria-label="View DJ profile"
          title="View DJ profile"
          className="absolute bottom-[13px] right-2.5 w-9 h-9 flex items-center justify-center text-white bg-black/15 backdrop-blur-xl border border-white/10 hover:bg-black/30 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
        </Link>
      )}
      </div>
    </div>
  );
}
