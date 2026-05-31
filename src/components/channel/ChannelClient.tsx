'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useScheduleLazy } from '@/contexts/ScheduleContext';
import { Header } from '@/components/Header';
import { useFilterContext } from '@/contexts/FilterContext';
import { SwipeableCardCarousel } from '@/components/channel/SwipeableCardCarousel';
import { TicketCard } from '@/components/channel/TicketCard';
import { LiveShowCard } from '@/components/channel/LiveShowCard';
import { IRLShowCard } from '@/components/channel/IRLShowCard';
import { CuratorRecCard } from '@/components/channel/CuratorRecCard';
import { InviteCard } from '@/components/channel/InviteCard';
import { SkeletonCard } from '@/components/channel/SkeletonCard';
import { AuthModal } from '@/components/AuthModal';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { ArchiveHero } from '@/components/channel/ArchiveHero';
import { computeDJChatRoom } from '@/lib/broadcast-utils';
import { Show, Station, IRLShowData, CuratorRec, DJProfile } from '@/types';
import { DJProfileCard } from '@/components/channel/DJProfileCard';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchives } from '@/hooks/useArchives';
import { useBPM } from '@/contexts/BPMContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useLoveHistory } from '@/hooks/useLoveHistory';
import { useLockedInHistory } from '@/hooks/useLockedInHistory';
import { useGoLiveMutes } from '@/hooks/useGoLiveMutes';
import { matchesCity, SUPPORTED_CITIES } from '@/lib/city-detection';
import { GENRE_ALIASES, SUPPORTED_GENRES, matchesGenre as matchesGenreLib } from '@/lib/genres';

type MatchedItem =
  | { type: 'irl'; data: IRLShowData; matchLabel: string | undefined }
  | { type: 'radio'; data: Show; station: Station; matchLabel: string | undefined; live?: boolean }
  | { type: 'profile'; data: DJProfile; matchLabel: string | undefined };

type RecommendedItem =
  | MatchedItem
  | { type: 'curator'; data: CuratorRec };

export function ChannelClient({ skipHero, topSearchSlot, discoveryFiltersSlot, sceneMode, initialHeroArchives, initialPreferredHero, initialRadioArchiveId }: { skipHero?: boolean; topSearchSlot?: React.ReactNode; discoveryFiltersSlot?: React.ReactNode; sceneMode?: boolean; initialHeroArchives?: import('@/types/broadcast').ArchiveSerialized[]; initialPreferredHero?: { spiral: import('@/types/broadcast').ArchiveSerialized | null; star: import('@/types/broadcast').ArchiveSerialized | null }; initialRadioArchiveId?: string | null } = {}) {
  const { user, isAuthenticated } = useAuthContext();
  const { isLive: isBroadcastLive, isStreaming: isBroadcastStreaming, currentShow } = useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const archivePlayer = useArchivePlayer();
  const { isGated, gateAttempt, clearGate } = archivePlayer;
  const { archives: rawArchives, featuredArchive: rawFeaturedArchive, loading: archivesLoading } = useArchives(initialHeroArchives);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);


  // Scroll to #scene anchor after mount
  useEffect(() => {
    if (!mounted) return;
    if (window.location.hash === '#scene') {
      const el = document.getElementById('scene');
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    }
  }, [mounted]);
  const { favorites, isInWatchlist, followDJ, removeFromWatchlist, removeFavorite, removeIrlFavorite, dismissedShows, toggleFavorite, isShowFavorited } = useFavorites();
  const { loveHistory } = useLoveHistory();
  const { lockedInDjs } = useLockedInHistory();
  const { isMuted: isGoLiveMuted, mute: muteGoLiveDj } = useGoLiveMutes();
  const { shows: scheduleShows, irlShows: scheduleIrlShows, curatorRecs: scheduleCuratorRecs, djProfiles: scheduleDjProfiles, loading: scheduleLoading, activate: activateSchedule } = useScheduleLazy();

  // Activate schedule fetch.
  // - Home `/` (skipHero=false, isAuthenticated=true): schedule is critical —
  //   the watchlist row gates on it. Activate eagerly.
  // - /scene (sceneMode=true): the YOUR SCENE grid paints from the optimistic
  //   watchlist (favorites + heart + lock-in) without the schedule. Defer
  //   schedule activation to the next microtask so the initial paint isn't
  //   blocked competing for bandwidth. BEYOND YOUR SCENE will then fill in.
  // - Logged-out home `/` (skipHero=false, isAuthenticated=false): no
  //   watchlist anyway — keep the existing skip.
  useEffect(() => {
    if (!skipHero && !isAuthenticated) return;
    if (sceneMode) {
      // Defer so the optimistic watchlist paints first.
      const id = setTimeout(() => activateSchedule(), 0);
      return () => clearTimeout(id);
    }
    activateSchedule();
  }, [skipHero, isAuthenticated, sceneMode, activateSchedule]);
  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(undefined);

  // Show auth modal when archive gate triggers or user tries to play while gated
  useEffect(() => {
    if (isGated && !isAuthenticated) {
      setAuthModalMessage('Sign up to keep listening to all our archive for free.');
      setShowAuthModal(true);
    }
  }, [isGated, gateAttempt, isAuthenticated]);


  // All shows data (from shared ScheduleContext)
  const allShows = scheduleShows;
  const irlShows = scheduleIrlShows;
  const curatorRecs = scheduleCuratorRecs;
  const djProfiles = scheduleDjProfiles;
  const isLoading = scheduleLoading;

  // Selected city and genres (from global FilterContext)
  const { selectedCity, selectedGenres, setTunerHints } = useFilterContext();

  // Determine which hero to show. Set NEXT_PUBLIC_HIDE_LIVE=true in Vercel
  // to hide the live UI on the homepage (hero falls through to archive
  // radio). Default: live is shown when broadcasting.
  const hideLive = process.env.NEXT_PUBLIC_HIDE_LIVE === 'true';
  const isLiveReady = !hideLive && isBroadcastLive && isBroadcastStreaming;

  const isRestream = currentShow?.broadcastType === 'restream';

  // Compute live DJ chat room for passing to ArchiveHero
  const [currentDJChatRoom, setCurrentDJChatRoom] = useState(() => computeDJChatRoom(currentShow ?? null));

  useEffect(() => {
    setCurrentDJChatRoom(computeDJChatRoom(currentShow ?? null));
    // For venue broadcasts with multiple DJs, poll every 30s to detect DJ transitions
    const isVenue = currentShow?.djSlots && currentShow.djSlots.length > 1;
    if (!isVenue) return;
    const interval = setInterval(() => {
      setCurrentDJChatRoom(computeDJChatRoom(currentShow ?? null));
    }, 30000);
    return () => clearInterval(interval);
  }, [currentShow]);

  // Follow/remind state
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);
  const [removingWatchlistDj, setRemovingWatchlistDj] = useState<string | null>(null);

  // /scene local state: edit toggle (controls watchlist remove × visibility)
  // and "view all" toggle (expands the YOUR SCENE grid past the 4-card cap).
  const [sceneEditMode, setSceneEditMode] = useState(false);
  const [sceneViewAll, setSceneViewAll] = useState(false);

  // Click anywhere outside the YOUR SCENE section to exit Edit mode. The
  // section sets data-scene-edit-boundary on its wrapper; clicks inside
  // (cards, Edit/Done button, remove ×) are ignored so the user can finish
  // their removal flow without the mode flipping off.
  useEffect(() => {
    if (!sceneEditMode) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-scene-edit-boundary]')) return;
      setSceneEditMode(false);
    };
    // mousedown fires before click — feels more responsive on tap-out
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [sceneEditMode]);

  const handleRemoveWatchlistDj = useCallback(
    async (profile: DJProfile) => {
      const key = profile.username || profile.displayName;
      if (!key) return;
      setRemovingWatchlistDj(key);
      try {
        // Always mute go-live emails for this DJ — covers engagement-only
        // cards and also ensures watchlist removal silences any future
        // engagement-triggered notifications.
        await muteGoLiveDj(profile.username || profile.displayName);
        // If the DJ is in the watchlist, also drop the search-type favorite.
        if (isInWatchlist(profile.displayName)) {
          await removeFromWatchlist(profile.displayName);
        } else if (isInWatchlist(profile.username)) {
          await removeFromWatchlist(profile.username);
        }
      } finally {
        setRemovingWatchlistDj(null);
      }
    },
    [muteGoLiveDj, removeFromWatchlist, isInWatchlist],
  );

  // Stations map for quick lookup
  const stationsMap = useMemo(() => {
    const map = new Map<string, Station>();
    for (const station of STATIONS) {
      map.set(station.id, station);
    }
    return map;
  }, []);

  // Helper: check if a show matches a single genre (with aliases)
  const matchesGenre = useCallback((showGenres: string[] | undefined, genre: string): boolean => {
    if (!showGenres || showGenres.length === 0 || !genre) return false;
    const genreLower = genre.toLowerCase();
    const aliases = GENRE_ALIASES[genreLower] || [];
    const allTerms = [genreLower, ...aliases];
    for (const [canonical, aliasList] of Object.entries(GENRE_ALIASES)) {
      if (aliasList.includes(genreLower)) {
        allTerms.push(canonical, ...aliasList);
        break;
      }
    }
    return showGenres.some((g) => {
      const gLower = g.toLowerCase();
      return allTerms.some((term) => gLower.includes(term) || term.includes(gLower));
    });
  }, []);

  // Helper: return which of the selected genres match a show's genres
  const getMatchingGenres = useCallback((showGenres: string[] | undefined): string[] => {
    if (selectedGenres.length === 0 || !showGenres || showGenres.length === 0) return [];
    return selectedGenres.filter((genre) => matchesGenre(showGenres, genre));
  }, [selectedGenres, matchesGenre]);

  // Helper: check if a show matches any of the selected genres
  const matchesAnyGenre = useCallback((showGenres: string[] | undefined): boolean => {
    return getMatchingGenres(showGenres).length > 0;
  }, [getMatchingGenres]);

  // Helper: build a genre label from only the genres that match a specific show
  const genreLabelFor = useCallback((showGenres: string[] | undefined): string => {
    const matching = getMatchingGenres(showGenres);
    if (matching.length === 0) return '';
    return matching.map((g) => g.toUpperCase()).join(' + ');
  }, [getMatchingGenres]);

  // Sort archives by priority and genre match
  // - No genre filter: high priority first, medium next, low last
  // - Genre filter: high+genre match first, then medium+genre match, then no
  //   match; low priority always sits at the very bottom
  // Within every tier, archives stay ordered most-recent-first.
  const { archives, featuredArchive } = useMemo(() => {
    const sourceArchives = rawArchives;
    if (sourceArchives.length === 0) return { archives: sourceArchives, featuredArchive: rawFeaturedArchive };

    const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

    if (selectedGenres.length === 0) {
      // No genre filter: sort by priority tier, preserve date order within each tier
      const sorted = [...sourceArchives].sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority || 'medium'] ?? 1;
        const pb = PRIORITY_RANK[b.priority || 'medium'] ?? 1;
        if (pa !== pb) return pa - pb;
        return (b.recordedAt || 0) - (a.recordedAt || 0);
      });
      return { archives: sorted, featuredArchive: sorted[0] };
    }

    // Genre filter active: score each archive
    const scored = sourceArchives.map((archive) => {
      let genreScore = 0;
      for (const dj of archive.djs) {
        const genres = dj.genres;
        if (genres && genres.length > 0) {
          genreScore += selectedGenres.filter((g) => matchesGenreLib(genres, g)).length;
        }
      }
      const priority = archive.priority || 'medium';
      // Sorting bucket:
      // 0 = high priority + genre match
      // 1 = medium priority + genre match
      // 2 = high priority + no genre match
      // 3 = medium priority + no genre match
      // 4 = low priority (always last regardless of genre)
      let bucket: number;
      if (priority === 'low') {
        bucket = 4;
      } else if (genreScore > 0) {
        bucket = priority === 'high' ? 0 : 1;
      } else {
        bucket = priority === 'high' ? 2 : 3;
      }
      return { archive, genreScore, bucket };
    });

    scored.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.genreScore !== b.genreScore) return b.genreScore - a.genreScore;
      return (b.archive.recordedAt || 0) - (a.archive.recordedAt || 0);
    });

    const sorted = scored.map((s) => s.archive);
    return { archives: sorted, featuredArchive: sorted[0] };
  }, [rawArchives, rawFeaturedArchive, selectedGenres]);

  // Sync featured archive into context so GlobalBroadcastBar can access it
  useEffect(() => {
    archivePlayer.setFeaturedArchive(featuredArchive);
  }, [featuredArchive, archivePlayer.setFeaturedArchive]);

  // Helper: check if a show is currently live
  const isShowLive = useCallback((show: Show): boolean => {
    const now = new Date();
    return new Date(show.startTime) <= now && new Date(show.endTime) > now;
  }, []);

  // Helper: valid show for display
  const isValidShow = useCallback((show: Show): boolean => {
    const hasPhoto = show.djPhotoUrl || show.imageUrl;
    const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';
    return !!(show.dj && (show.djUsername || show.djUserId) && hasPhoto && !isRestreamOrPlaylist);
  }, []);

  // Followed DJ names for curator recs filtering
  const followedDJNames = useMemo(() =>
    favorites.filter((f) => f.type === 'search').map((f) => f.term.toLowerCase()),
    [favorites]
  );

  // Optimistic watchlist for /scene only — built from `favorites` + love +
  // lock-in, no schedule dependency. Used as initial paint so YOUR SCENE
  // renders the moment Firestore listeners resolve (usually instant).
  // Home `/` keeps the existing behavior (schedule gates the carousel).
  const favoritesOptimistic = useMemo<MatchedItem[]>(() => {
    if (!sceneMode) return [];
    const seen = new Set<string>();
    const out: MatchedItem[] = [];
    const push = (
      username: string,
      displayName: string,
      photoUrl?: string,
    ) => {
      const key = username.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        type: 'profile',
        data: {
          username,
          displayName: displayName || username,
          photoUrl,
          isChannelUser: true,
        },
        matchLabel: undefined,
      });
    };
    for (const f of favorites) {
      if (f.type !== 'search') continue;
      const term = (f.term as string) || '';
      const djName = (f as { djName?: string }).djName;
      const djUsername = (f as { djUsername?: string }).djUsername;
      const djPhotoUrl = (f as { djPhotoUrl?: string }).djPhotoUrl;
      const username = djUsername || term;
      if (!username) continue;
      push(username, djName || term, djPhotoUrl);
    }
    for (const lh of loveHistory) {
      if (!lh.djUsername) continue;
      if (isGoLiveMuted(lh.djUsername)) continue;
      push(lh.djUsername, lh.djDisplayName || lh.djUsername, lh.djPhotoUrl);
    }
    for (const li of lockedInDjs) {
      if (!li.djUsername) continue;
      if (isGoLiveMuted(li.djUsername)) continue;
      push(li.djUsername, li.djUsername);
    }
    return out;
  }, [favorites, loveHistory, lockedInDjs, isGoLiveMuted]);

  // Compute all sections with deduplication.
  // Short-circuit on home `/` (neither sceneMode nor skipHero) — none of
  // these outputs are consumed there (watchlist carousel was removed and
  // the discovery carousels only render inside the `{skipHero && ...}`
  // block). Computing them on `/` is wasted work.
  const sectionsActive = sceneMode || skipHero;
  const {
    favoritesNowLive,
    todayTomorrowCards,
    nextWeekCards,
    genreOnlineCards,
    recommendedByCards,
  } = useMemo(() => {
    if (!sectionsActive) {
      return {
        favoritesNowLive: [] as MatchedItem[],
        todayTomorrowCards: [] as MatchedItem[],
        nextWeekCards: [] as MatchedItem[],
        genreOnlineCards: [] as MatchedItem[],
        recommendedByCards: [] as RecommendedItem[],
      };
    }
    const isAnywhere = !selectedCity || selectedCity === 'Anywhere';
    const hasGenreFilter = selectedGenres.length > 0;
    const now = new Date();
    const seenShowIds = new Set<string>();
    const seenDJs = new Set<string>();

    const tryAddShow = (id: string, djName: string | undefined): boolean => {
      const djKey = djName?.toLowerCase();
      if (seenShowIds.has(id)) return false;
      if (djKey && seenDJs.has(djKey)) return false;
      seenShowIds.add(id);
      if (djKey) seenDJs.add(djKey);
      return true;
    };

    // Helper to create a MatchedItem from a radio show
    const makeRadioItem = (show: Show, matchLabel: string | undefined, live?: boolean): MatchedItem | null => {
      const station = stationsMap.get(show.stationId);
      if (!station) return null;
      return { type: 'radio', data: show, station, matchLabel, live };
    };

    // Helper to create a MatchedItem from an IRL show
    const makeIRLItem = (show: IRLShowData, matchLabel: string | undefined): MatchedItem => {
      return { type: 'irl', data: show, matchLabel };
    };

    // Helper: get genre match count for sorting (more matches = higher priority)
    const genreMatchCount = (genres: string[] | undefined): number => getMatchingGenres(genres).length;

    // Sort groups: live show (0) > IRL event (1) > DJ profile (2) > upcoming radio show (3)
    type Candidate = { item: MatchedItem; id: string; djName: string | undefined; matchCount: number; startMs: number; sortGroup: number; isChannelUser?: boolean };
    const takeSorted = (candidates: Candidate[], max: number): MatchedItem[] => {
      candidates.sort((a, b) => {
        // Live shows always come first (sortGroup 0 = live)
        const aLive = a.sortGroup === 0 ? 1 : 0;
        const bLive = b.sortGroup === 0 ? 1 : 0;
        if (aLive !== bLive) return bLive - aLive;
        // Then by match count (city + genre relevance)
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        // Sort group: IRL > profile > upcoming
        if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup;
        // Then sooner shows first
        if (a.startMs !== b.startMs) return a.startMs - b.startMs;
        // Then Channel users first
        if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
        return 0;
      });
      const result: MatchedItem[] = [];
      for (const c of candidates) {
        if (result.length >= max) break;
        if (!tryAddShow(c.id, c.djName)) continue;
        result.push(c.item);
      }
      return result;
    };

    // Section 0: Favorites — followed DJs / favorited shows in next 2 weeks, sorted: live now → soonest first
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const twoWeeksDateStr = twoWeeksFromNow.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const nowDateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const s0Candidates: { item: MatchedItem; id: string; djName: string | undefined; startMs: number; live: boolean }[] = [];
    // Radio shows from followed DJs / favorited shows in next 2 weeks
    for (const show of allShows) {
      if (!show.dj) continue;
      // Never show restreams in watchlist (regular restreams, external show restreams, or channel broadcast restreams)
      if (show.type === 'restream' || show.type === 'playlist' || show.broadcastType === 'restream') continue;
      // Skip shows the user explicitly dismissed (tapped × on the card).
      // The dismissal is recorded by removeFavorite even when the DJ is
      // still followed, so the show doesn't auto-resurface via that path.
      const dismissKey = `${show.stationId || 'broadcast'}-${show.name.toLowerCase()}`;
      if (dismissedShows[dismissKey]) continue;
      const station = stationsMap.get(show.stationId);
      if (!station) continue;
      const endTime = new Date(show.endTime);
      const startTime = new Date(show.startTime);
      if (endTime <= now || startTime > twoWeeksFromNow) continue;
      const djFollowed = isInWatchlist(show.dj) || (show.djUsername && isInWatchlist(show.djUsername));
      // For followed DJs, skip isValidShow — show their content even if profile data is incomplete
      if (!djFollowed && !isValidShow(show)) continue;
      const showFaved = isShowFavorited(show);
      if (djFollowed || showFaved) {
        if (tryAddShow(show.id, show.dj)) {
          const live = startTime <= now && endTime > now;
          const item = makeRadioItem(show, undefined, live || undefined);
          if (item) s0Candidates.push({ item, id: show.id, djName: show.dj, startMs: startTime.getTime(), live });
        }
      }
    }
    // IRL shows from followed DJs in next 2 weeks (from schedule)
    const s0IrlKeys = new Set<string>();
    for (const show of irlShows) {
      if (show.date > twoWeeksDateStr) continue;
      let djFollowed = isInWatchlist(show.djName) || isInWatchlist(show.djUsername);
      // Also check all DJs in the lineup for multi-DJ events
      if (!djFollowed && show.allDjs) {
        djFollowed = show.allDjs.some(dj => isInWatchlist(dj.djName) || isInWatchlist(dj.djUsername));
      }
      if (!djFollowed) continue;
      const id = `irl-${show.djUsername}-${show.date}`;
      s0IrlKeys.add(id);
      if (tryAddShow(id, show.djName)) {
        s0Candidates.push({ item: makeIRLItem(show, undefined), id, djName: show.djName, startMs: new Date(show.date + 'T00:00:00').getTime(), live: false });
      }
    }
    // IRL favorites beyond the 2-week schedule window (from user's favorites collection)
    const irlFavorites = favorites.filter(f => f.type === 'irl' && f.irlDate && f.irlDate >= nowDateStr);
    for (const fav of irlFavorites) {
      const id = `irl-${fav.djUsername || ''}-${fav.irlDate}`;
      if (s0IrlKeys.has(id)) continue; // Already covered by schedule data
      if (!tryAddShow(id, fav.djName)) continue;
      const syntheticShow: IRLShowData = {
        djUsername: fav.djUsername || '',
        djName: fav.djName || fav.irlEventName || 'Event',
        djPhotoUrl: fav.djPhotoUrl,
        eventName: fav.irlEventName || fav.showName || 'Event',
        location: fav.irlLocation || '',
        ticketUrl: fav.irlTicketUrl || '',
        date: fav.irlDate!,
      };
      s0Candidates.push({ item: makeIRLItem(syntheticShow, undefined), id, djName: fav.djName, startMs: new Date(fav.irlDate + 'T00:00:00').getTime(), live: false });
    }
    // Sort: live first, then soonest first
    s0Candidates.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.startMs - b.startMs;
    });
    const s0: MatchedItem[] = s0Candidates.map(c => c.item);
    // Append followed DJ profile cards at the end of the watchlist (Channel users first),
    // but skip DJs who already appear via a show in the watchlist
    const s0DjNames = new Set(s0Candidates.map(c => c.djName?.toLowerCase()).filter(Boolean));
    const followedProfiles = djProfiles.filter(p =>
      (isInWatchlist(p.displayName) || isInWatchlist(p.username)) &&
      !s0DjNames.has(p.displayName.toLowerCase()) &&
      !s0DjNames.has(p.username.toLowerCase())
    );
    followedProfiles.sort((a, b) => (a.isChannelUser === b.isChannelUser ? 0 : a.isChannelUser ? -1 : 1));
    const followedProfileUsernames = new Set<string>();
    for (const profile of followedProfiles) {
      s0.push({ type: 'profile', data: profile, matchLabel: undefined });
      followedProfileUsernames.add(profile.username.toLowerCase());
      followedProfileUsernames.add(profile.displayName.toLowerCase());
    }
    // Fallback: any manually-watchlisted DJ that didn't surface above
    // (e.g. they have no genres set, so they're absent from djProfiles)
    // still belongs on the user's grid — they explicitly followed them.
    // Synthesize a minimal profile from the favorite doc so the card
    // renders with the DJ name even when no photo/genres exist.
    for (const f of favorites) {
      if (f.type !== 'search') continue;
      const term = (f.term as string) || '';
      const djName = (f as { djName?: string }).djName;
      const djUsername = (f as { djUsername?: string }).djUsername;
      const djPhotoUrl = (f as { djPhotoUrl?: string }).djPhotoUrl;
      const username = djUsername || term;
      if (!username) continue;
      const lower = username.toLowerCase();
      const displayName = djName || term;
      const lowerDisplay = displayName.toLowerCase();
      if (s0DjNames.has(lower) || s0DjNames.has(lowerDisplay)) continue;
      if (followedProfileUsernames.has(lower) || followedProfileUsernames.has(lowerDisplay)) continue;
      s0.push({
        type: 'profile',
        data: {
          username,
          displayName,
          photoUrl: djPhotoUrl,
          isChannelUser: true,
        } as DJProfile,
        matchLabel: undefined,
      });
      followedProfileUsernames.add(lower);
      followedProfileUsernames.add(lowerDisplay);
    }

    // Engagement-added DJs: anyone the user has hearted or locked in with,
    // minus those already in the watchlist (by name/username), already shown
    // above, or muted. These cards carry the "engagement" source so the X
    // overlay routes to a per-DJ mute rather than a watchlist deletion.
    const watchlistUsernames = new Set<string>();
    for (const item of s0) {
      if (item.type === 'profile') {
        watchlistUsernames.add(item.data.username.toLowerCase());
        watchlistUsernames.add(item.data.displayName.toLowerCase());
      } else if (item.type === 'radio' && item.data.dj) {
        watchlistUsernames.add(item.data.dj.toLowerCase());
      } else if (item.type === 'irl') {
        if (item.data.djName) watchlistUsernames.add(item.data.djName.toLowerCase());
        if (item.data.djUsername) watchlistUsernames.add(item.data.djUsername.toLowerCase());
      }
    }

    // Merge heart + lock-in usernames by username, keep most-recent first.
    const engagementByDj = new Map<string, number>(); // username → max(ts ms)
    for (const lh of loveHistory) {
      if (!lh.djUsername) continue;
      const ms = lh.lastLovedAt
        ? new Date(lh.lastLovedAt as unknown as string | number | Date).getTime()
        : 0;
      const prev = engagementByDj.get(lh.djUsername) ?? 0;
      if (ms > prev) engagementByDj.set(lh.djUsername, ms);
    }
    for (const li of lockedInDjs) {
      if (!li.djUsername) continue;
      const ms = new Date(li.lastAt).getTime();
      const prev = engagementByDj.get(li.djUsername) ?? 0;
      if (ms > prev) engagementByDj.set(li.djUsername, ms);
    }

    const sortedEngagement = Array.from(engagementByDj.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([username]) => username);

    for (const username of sortedEngagement) {
      const lower = username.toLowerCase();
      if (watchlistUsernames.has(lower)) continue;
      if (isInWatchlist(username)) continue;
      if (isGoLiveMuted(username)) continue;

      // Try to enrich from the schedule's djProfiles; fall back to a
      // synthetic profile from the love-history doc (which has photoUrl).
      const profile = djProfiles.find(
        (p) => p.username.toLowerCase() === lower || p.displayName.toLowerCase() === lower,
      );
      if (profile) {
        s0.push({ type: 'profile', data: profile, matchLabel: undefined });
      } else {
        const lh = loveHistory.find((l) => l.djUsername === username);
        s0.push({
          type: 'profile',
          data: {
            username,
            displayName: lh?.djDisplayName || username,
            photoUrl: lh?.djPhotoUrl,
            isChannelUser: true,
          } as DJProfile,
          matchLabel: undefined,
        });
      }
      watchlistUsernames.add(lower);
    }

    // Date boundaries for time-windowed sections
    const tomorrowEnd = new Date(now);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 2);
    tomorrowEnd.setHours(0, 0, 0, 0);
    const tomorrowCutoffDateStr = tomorrowEnd.toLocaleDateString('en-CA'); // exclusive upper bound for IRL dates

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() + 2); // day after tomorrow
    weekStart.setHours(0, 0, 0, 0);
    const s2StartDateStr = weekStart.toLocaleDateString('en-CA');

    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 8);
    weekEnd.setHours(0, 0, 0, 0);
    const s2EndDateStr = weekEnd.toLocaleDateString('en-CA');

    // New Section 1: today/tomorrow (max 5, overflow spills to S2)
    // City match adds +1 to matchCount for priority. IRL requires city; genre only when filter active.
    let newS1: MatchedItem[] = [];
    let s1Overflow: MatchedItem[] = [];
    {
      const candidates: Candidate[] = [];
      // IRL shows — city required, genre required only when filter active
      if (!isAnywhere) {
        for (const show of irlShows) {
          if (show.date < nowDateStr || show.date >= tomorrowCutoffDateStr) continue;
          if (!matchesCity(show.location, selectedCity)) continue;
          if (hasGenreFilter && !matchesAnyGenre(show.djGenres)) continue;
          const id = `irl-${show.djUsername}-${show.date}`;
          const genreLabel = genreLabelFor(show.djGenres);
          const label = genreLabel
            ? `${selectedCity.toUpperCase()} + ${genreLabel}`
            : selectedCity.toUpperCase();
          candidates.push({ item: makeIRLItem(show, label), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres) + 1, startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
        }
      }
      // Radio/online shows — genre required only when filter active, city boosts priority
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        const endTime = new Date(show.endTime);
        const startTime = new Date(show.startTime);
        if (endTime <= now) continue;
        if (startTime >= tomorrowEnd) continue;
        if (hasGenreFilter && !matchesAnyGenre(show.djGenres)) continue;
        const live = isShowLive(show);
        const cityMatch = !isAnywhere && show.djLocation ? matchesCity(show.djLocation, selectedCity) : false;
        const genreLabel = genreLabelFor(show.djGenres);
        const label = cityMatch && genreLabel
          ? `${selectedCity.toUpperCase()} + ${genreLabel}`
          : cityMatch ? selectedCity.toUpperCase()
          : genreLabel || undefined;
        const item = makeRadioItem(show, label, live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres) + (cityMatch ? 1 : 0), startMs: startTime.getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      // Sort all candidates, take first 5 for S1, rest overflow to S2
      const allS1 = takeSorted(candidates, candidates.length); // take all, deduped & sorted
      newS1 = allS1.slice(0, 5);
      s1Overflow = allS1.slice(5);
    }

    // New Section 2: Overflow from S1 + days 3–7 (max 5)
    let newS2: MatchedItem[] = [];
    {
      // Start with S1 overflow
      const s2Items = s1Overflow.slice(0, 5);
      const remaining = 5 - s2Items.length;
      if (remaining > 0) {
        const candidates: Candidate[] = [];
        // IRL shows — city required, genre required only when filter active, days 3–7
        if (!isAnywhere) {
          for (const show of irlShows) {
            if (show.date < s2StartDateStr || show.date >= s2EndDateStr) continue;
            if (!matchesCity(show.location, selectedCity)) continue;
            if (hasGenreFilter && !matchesAnyGenre(show.djGenres)) continue;
            const id = `irl-${show.djUsername}-${show.date}`;
            const genreLabel = genreLabelFor(show.djGenres);
            const label = genreLabel
              ? `${selectedCity.toUpperCase()} + ${genreLabel}`
              : selectedCity.toUpperCase();
            candidates.push({ item: makeIRLItem(show, label), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres) + 1, startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
          }
        }
        // Radio/online shows — genre required only when filter active, city boosts priority
        for (const show of allShows) {
          if (!isValidShow(show)) continue;
          const endTime = new Date(show.endTime);
          const startTime = new Date(show.startTime);
          if (endTime <= now) continue;
          if (startTime < weekStart || startTime >= weekEnd) continue;
          if (hasGenreFilter && !matchesAnyGenre(show.djGenres)) continue;
          const cityMatch = !isAnywhere && show.djLocation ? matchesCity(show.djLocation, selectedCity) : false;
          const genreLabel = genreLabelFor(show.djGenres);
          const label = cityMatch && genreLabel
            ? `${selectedCity.toUpperCase()} + ${genreLabel}`
            : cityMatch ? selectedCity.toUpperCase()
            : genreLabel || undefined;
          const item = makeRadioItem(show, label);
          if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres) + (cityMatch ? 1 : 0), startMs: startTime.getTime(), sortGroup: 3, isChannelUser: show.isChannelUser ?? false });
        }
        s2Items.push(...takeSorted(candidates, remaining));
      }
      newS2 = s2Items;
    }

    // New Section 3: Genre-only online (no IRL, no location filter, max 5)
    let newS3: MatchedItem[] = [];
    if (hasGenreFilter) {
      const candidates: Candidate[] = [];
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const live = isShowLive(show);
        const item = makeRadioItem(show, genreLabelFor(show.djGenres), live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      newS3 = takeSorted(candidates, 5);
    }

    // New Section 4: Recommended by — curator recs + external station picks (combined carousel)
    const newS4: RecommendedItem[] = [];
    // Curator recs from followed DJs (max 4)
    if (followedDJNames.length > 0) {
      for (const rec of curatorRecs) {
        if (newS4.length >= 4) break;
        if (followedDJNames.includes(rec.djUsername.toLowerCase()) ||
            followedDJNames.includes(rec.djName.toLowerCase())) {
          newS4.push({ type: 'curator', data: rec });
        }
      }
    }
    // External station picks (max 5)
    // Lower number = higher priority. Stations not listed default to 100.
    // Sutro is boosted above the Rinse channels to give it visibility while
    // its schedule window is small.
    const stationOrder: Record<string, number> = {
      sutro: 10,
      vpn: 11,
      'rinse-fm': 20,
      'rinse-fr': 21,
    };
    type StationCandidate = { item: MatchedItem; id: string; djName: string | undefined; live: boolean; isChannelUser: boolean; stationOrder: number; stationId: string };
    const stationCandidates: StationCandidate[] = [];
    for (const show of allShows) {
      if (!isValidShow(show)) continue;
      if (new Date(show.endTime) <= now) continue;
      if (show.stationId === 'broadcast' || show.stationId === 'dj-radio') continue;
      const station = stationsMap.get(show.stationId);
      if (!station) continue;
      const live = isShowLive(show);
      stationCandidates.push({
        item: { type: 'radio', data: show, station, matchLabel: `SELECTED BY ${station.name.toUpperCase()}`, live: live || undefined },
        id: show.id, djName: show.dj, live, isChannelUser: show.isChannelUser ?? false,
        stationOrder: stationOrder[show.stationId] ?? 100,
        stationId: show.stationId,
      });
    }
    const candidateSort = (a: StationCandidate, b: StationCandidate) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
      if (a.stationOrder !== b.stationOrder) return a.stationOrder - b.stationOrder;
      return 0;
    };
    stationCandidates.sort(candidateSort);

    // Pin the top of the section to one Sutro + one VPN pick (in that order) so both
    // stations always get visibility regardless of broader sort ordering. Each pinned
    // slot walks the station's candidate list in priority order and takes the first
    // one that survives tryAddShow's global show/DJ dedupe — important when earlier
    // sections (favorites, today/tomorrow) have already claimed a station's top DJ.
    let stationCount = 0;
    const usedIds = new Set<string>();
    const pinnedFirst: StationCandidate[] = [];
    for (const pinStationId of ['sutro', 'vpn']) {
      const candidatesForStation = stationCandidates.filter(
        (c) => c.stationId === pinStationId && !usedIds.has(c.id)
      );
      for (const pick of candidatesForStation) {
        if (tryAddShow(pick.id, pick.djName)) {
          pinnedFirst.push(pick);
          usedIds.add(pick.id);
          break;
        }
      }
    }
    for (const c of pinnedFirst) {
      newS4.push(c.item);
      stationCount++;
    }
    // Fill the rest of the section with the normal sort, skipping any candidate we
    // already pinned (and respecting tryAddShow's global dedupe).
    for (const c of stationCandidates) {
      if (stationCount >= 5) break;
      if (usedIds.has(c.id)) continue;
      if (!tryAddShow(c.id, c.djName)) continue;
      newS4.push(c.item);
      stationCount++;
    }

    return {
      favoritesNowLive: s0,
      todayTomorrowCards: newS1,
      nextWeekCards: newS2,
      genreOnlineCards: newS3,
      recommendedByCards: newS4,
    };
  }, [sectionsActive, allShows, irlShows, curatorRecs, djProfiles, selectedCity, selectedGenres, stationsMap, matchesAnyGenre, getMatchingGenres, genreLabelFor, isShowLive, isValidShow, followedDJNames, isInWatchlist, isShowFavorited, favorites, user, loveHistory, lockedInDjs, isGoLiveMuted, dismissedShows]);

  // SUGGESTED items for /scene: related DJs (affiliation crew + Audience)
  // of every DJ already in the user's watchlist, plus an empty-state fallback
  // (DJs with upcoming Channel Radio shows) when the watchlist is empty.
  // Each entry includes the bridge DJ display name shown in the badge.
  const suggestedItems = useMemo(() => {
    if (!sceneMode) return [] as Array<{ item: MatchedItem; bridge: string }>;

    // Quick lookup helpers — username (normalised) → DJProfile
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const djByNorm = new Map<string, DJProfile>();
    for (const p of djProfiles) {
      if (p.username) djByNorm.set(norm(p.username), p);
      if (p.displayName) djByNorm.set(norm(p.displayName), p);
    }
    const djByUid = new Map<string, DJProfile>();
    for (const p of djProfiles) {
      if (p.userId) djByUid.set(p.userId, p);
    }

    // Build crew + Audience for each DJProfile in the watchlist.
    // crew(X) = X.parent ∪ X's direct affiliates ∪ X's siblings, derived
    // dynamically from djProfiles.affiliatedWithUid.
    const affiliatedBy = new Map<string, string>(); // uid → parent uid
    const affiliatesOf = new Map<string, Set<string>>(); // uid → direct affiliates
    for (const p of djProfiles) {
      if (!p.userId || !p.affiliatedWithUid) continue;
      affiliatedBy.set(p.userId, p.affiliatedWithUid);
      const bucket = affiliatesOf.get(p.affiliatedWithUid) ?? new Set<string>();
      bucket.add(p.userId);
      affiliatesOf.set(p.affiliatedWithUid, bucket);
    }
    const crewUids = (uid: string): Set<string> => {
      const out = new Set<string>();
      const parent = affiliatedBy.get(uid);
      if (parent) out.add(parent);
      const directs = affiliatesOf.get(uid);
      if (directs) directs.forEach((u) => out.add(u));
      if (parent) {
        const siblings = affiliatesOf.get(parent);
        if (siblings) siblings.forEach((u) => out.add(u));
      }
      out.delete(uid);
      return out;
    };

    // Already-in-watchlist filter
    const alreadyIn = (p: DJProfile) =>
      isInWatchlist(p.displayName) || isInWatchlist(p.username);

    // Seed DJs = the actual watchlist (favoritesNowLive's profile entries
    // + any matched radio/IRL shows whose DJ resolves to a known profile).
    const seedProfiles: DJProfile[] = [];
    const seenSeedUid = new Set<string>();
    const pushSeed = (p?: DJProfile) => {
      if (!p || !p.userId || seenSeedUid.has(p.userId)) return;
      seenSeedUid.add(p.userId);
      seedProfiles.push(p);
    };
    for (const item of favoritesNowLive) {
      if (item.type === 'profile') {
        pushSeed(item.data);
      } else if (item.type === 'radio') {
        const dj = item.data.dj ? djByNorm.get(norm(item.data.dj)) : undefined;
        pushSeed(dj);
      } else if (item.type === 'irl') {
        const dj =
          (item.data.djUsername && djByNorm.get(norm(item.data.djUsername))) ||
          (item.data.djName ? djByNorm.get(norm(item.data.djName)) : undefined);
        pushSeed(dj);
      }
    }

    // Build candidate uids: union of crew(seed) and audienceDjUids(seed) for
    // every seed, with the bridge being the seed that produced the candidate.
    type Candidate = { profile: DJProfile; bridge: string };
    const candidates: Candidate[] = [];
    const seenCandidate = new Set<string>();

    const addCandidate = (uid: string, bridge: string) => {
      if (!uid || seenSeedUid.has(uid) || seenCandidate.has(uid)) return;
      const p = djByUid.get(uid);
      if (!p) return;
      if (alreadyIn(p)) return;
      seenCandidate.add(uid);
      candidates.push({ profile: p, bridge });
    };

    for (const seed of seedProfiles) {
      if (!seed.userId) continue;
      const bridge = seed.displayName || seed.username;
      crewUids(seed.userId).forEach((uid) => addCandidate(uid, bridge));
      const audienceUids = seed.audienceDjUids;
      if (Array.isArray(audienceUids)) {
        audienceUids.forEach((uid) => addCandidate(uid, bridge));
      }
    }

    // Empty-state fallback: when the watchlist has no seeds, surface DJs that
    // have an upcoming Channel Radio show in the next 14 days. Bridge label
    // reads "Channel pick".
    if (favoritesNowLive.length === 0) {
      const now = Date.now();
      const twoWeeks = now + 14 * 24 * 60 * 60 * 1000;
      const seen = new Set<string>();
      for (const show of allShows) {
        if (show.stationId !== 'broadcast') continue;
        const start = new Date(show.startTime).getTime();
        if (Number.isNaN(start) || start < now || start > twoWeeks) continue;
        if (!show.dj) continue;
        const profile = djByNorm.get(norm(show.dj));
        if (!profile || !profile.userId || seen.has(profile.userId)) continue;
        seen.add(profile.userId);
        // Empty-state suggestions have no bridge — these are surfacing
        // for users without watchlist/heart/stream history, so we render
        // a plain "Suggested" banner with no "Similar to" attribution.
        candidates.push({ profile, bridge: '' });
        if (candidates.length >= 6) break;
      }
    }

    // For each candidate, prefer the next upcoming radio show, then the next
    // upcoming IRL show, falling back to a profile card.
    type Out = { item: MatchedItem; bridge: string; rank: number; sortKey: number };
    // rank: 0 = live radio/online, 1 = upcoming radio, 2 = upcoming IRL, 3 = profile-only
    const out: Out[] = [];
    for (const c of candidates) {
      const cNames = [norm(c.profile.displayName), norm(c.profile.username)].filter(Boolean);
      const cUid = c.profile.userId;
      const nowMs = Date.now();
      // Match the candidate to a show by djUserId first (exact link), then
      // djUsername (chatUsernameNormalized — also exact), and only fall
      // back to the free-text `dj` field. Using `dj` alone caused mistaken
      // matches when the schedule had a different DJ whose name happens to
      // normalize to the same string.
      const nextRadio = allShows
        .filter((s) => {
          const matchesByUid = cUid && s.djUserId === cUid;
          const matchesByUsername = s.djUsername && cNames.includes(norm(s.djUsername));
          const matchesByName = s.dj && cNames.includes(norm(s.dj));
          if (!matchesByUid && !matchesByUsername && !matchesByName) return false;
          const end = new Date(s.endTime).getTime();
          return !Number.isNaN(end) && end > nowMs;
        })
        .sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        )[0];
      if (nextRadio) {
        // Use the show's actual station, not a hard-coded 'broadcast'. An
        // upcoming show may be on NTS / Rinse / dublab etc.
        const station = stationsMap.get(nextRadio.stationId);
        if (station) {
          const startMs = new Date(nextRadio.startTime).getTime();
          const live =
            startMs <= nowMs && new Date(nextRadio.endTime).getTime() > nowMs;
          out.push({
            item: { type: 'radio', data: nextRadio, station, matchLabel: undefined, live },
            bridge: c.bridge,
            rank: live ? 0 : 1,
            sortKey: startMs,
          });
          continue;
        }
      }
      const nextIrl = irlShows
        .filter((s) => {
          // Prefer username (exact); fall back to djName for legacy / IRL
          // shows that haven't been linked yet.
          if (s.djUsername && cNames.includes(norm(s.djUsername))) return true;
          if (s.djName && cNames.includes(norm(s.djName))) return true;
          return false;
        })
        // Only future IRL dates (today onward).
        .filter((s) => {
          const dt = new Date(s.date + 'T00:00:00').getTime();
          return !Number.isNaN(dt) && dt + 24 * 3600 * 1000 > nowMs;
        })
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (nextIrl) {
        out.push({
          item: { type: 'irl', data: nextIrl, matchLabel: undefined },
          bridge: c.bridge,
          rank: 2,
          sortKey: new Date(nextIrl.date + 'T00:00:00').getTime(),
        });
        continue;
      }
      out.push({
        item: { type: 'profile', data: c.profile, matchLabel: undefined },
        bridge: c.bridge,
        rank: 3,
        sortKey: nowMs,
      });
    }
    // Sort: shows-before-profiles. Within shows, live first, then soonest.
    out.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.sortKey - b.sortKey;
    });

    return out.map(({ item, bridge }) => ({ item, bridge }));
  }, [sceneMode, djProfiles, favoritesNowLive, allShows, irlShows, stationsMap, isInWatchlist]);

  // Compute result counts for Tuner bar
  const allCardCount = todayTomorrowCards.length +
    nextWeekCards.length + genreOnlineCards.length + recommendedByCards.length;

  const cityResultCount = useMemo(() => {
    if (!selectedCity || selectedCity === 'Anywhere') return undefined;
    return todayTomorrowCards.length + nextWeekCards.length;
  }, [selectedCity, todayTomorrowCards, nextWeekCards]);

  const genreResultCount = useMemo(() => {
    if (selectedGenres.length === 0) return undefined;
    return todayTomorrowCards.length + nextWeekCards.length + genreOnlineCards.length;
  }, [selectedGenres, todayTomorrowCards, nextWeekCards, genreOnlineCards]);

  const missingGenres = useMemo(() => {
    if (selectedGenres.length === 0) return [];
    const allGenreCards = [...todayTomorrowCards, ...nextWeekCards, ...genreOnlineCards];
    if (allGenreCards.length === 0) return selectedGenres;
    return selectedGenres.filter((genre) => {
      return !allGenreCards.some((item) => {
        const showGenres = item.type === 'profile' ? item.data.genres : item.data.djGenres;
        return showGenres ? matchesGenre(showGenres, genre) : false;
      });
    });
  }, [selectedGenres, todayTomorrowCards, nextWeekCards, genreOnlineCards, matchesGenre]);

  // Compute which cities and genres have at least one matching show
  const citiesWithMatches = useMemo(() => {
    const now = new Date();
    const set = new Set<string>();
    const radioLocations: string[] = [];
    for (const show of allShows) {
      if (!isValidShow(show) || new Date(show.endTime) <= now || !stationsMap.has(show.stationId)) continue;
      if (show.djLocation) radioLocations.push(show.djLocation);
    }
    const irlLocations = irlShows.map((show) => show.location);
    const profileLocations = djProfiles.filter((p) => p.location).map((p) => p.location!);
    const allLocations = [...radioLocations, ...irlLocations, ...profileLocations];
    for (const city of SUPPORTED_CITIES) {
      if (allLocations.some((loc) => matchesCity(loc, city))) {
        set.add(city);
      }
    }
    return set;
  }, [allShows, irlShows, djProfiles, isValidShow, stationsMap]);

  const genresWithMatches = useMemo(() => {
    const now = new Date();
    const set = new Set<string>();
    const allDjGenres: string[][] = [];
    for (const show of allShows) {
      if (!isValidShow(show) || new Date(show.endTime) <= now || !stationsMap.has(show.stationId)) continue;
      if (show.djGenres && show.djGenres.length > 0) {
        allDjGenres.push(show.djGenres);
      }
    }
    for (const show of irlShows) {
      if (show.djGenres && show.djGenres.length > 0) {
        allDjGenres.push(show.djGenres);
      }
    }
    for (const profile of djProfiles) {
      if (profile.genres && profile.genres.length > 0) {
        allDjGenres.push(profile.genres);
      }
    }
    for (const genre of SUPPORTED_GENRES) {
      if (allDjGenres.some((djGenres) => matchesGenreLib(djGenres, genre))) {
        set.add(genre);
      }
    }
    return set;
  }, [allShows, irlShows, djProfiles, isValidShow, stationsMap]);

  // Push computed Tuner hints into FilterContext for HeaderTuner
  useEffect(() => {
    setTunerHints({
      cityResultCount,
      genreResultCount,
      citiesWithMatches,
      genresWithMatches,
    });
  }, [cityResultCount, genreResultCount, citiesWithMatches, genresWithMatches, setTunerHints]);

  // Auth handlers
  const handleRemindMe = useCallback((show: Show) => {
    const djName = show.dj || show.name;
    setAuthModalMessage(`Sign in to get notified when ${djName} goes live`);
    setShowAuthModal(true);
  }, []);

  const handleIRLAuthRequired = useCallback((djName: string) => {
    setAuthModalMessage(`Sign in to follow ${djName}`);
    setShowAuthModal(true);
  }, []);

  // Follow/Unfollow for radio shows
  const handleUnifiedFollow = useCallback(async (show: Show) => {
    if (!isAuthenticated) { handleRemindMe(show); return; }
    if (!show.dj) return;
    setAddingFollowDj(show.dj);
    try {
      if (isInWatchlist(show.dj)) {
        await removeFromWatchlist(show.dj);
      } else {
        await followDJ(show.dj, show.djUserId, show.djEmail, show);
      }
    } finally {
      setAddingFollowDj(null);
    }
  }, [isAuthenticated, handleRemindMe, isInWatchlist, removeFromWatchlist, followDJ]);

  // Follow/Unfollow for IRL shows
  const handleUnifiedIRLFollow = useCallback(async (show: IRLShowData) => {
    if (!isAuthenticated) { handleIRLAuthRequired(show.djName); return; }
    if (!show.djName) return;
    setAddingFollowDj(show.djName);
    try {
      if (isInWatchlist(show.djName)) {
        await removeFromWatchlist(show.djName);
      } else {
        await followDJ(show.djName, undefined, undefined, undefined);
      }
    } finally {
      setAddingFollowDj(null);
    }
  }, [isAuthenticated, handleIRLAuthRequired, isInWatchlist, removeFromWatchlist, followDJ]);

  // Remind Me for radio shows
  const handleUnifiedRemindMe = useCallback(async (show: Show) => {
    if (!isAuthenticated) { handleRemindMe(show); return; }
    setAddingReminderShowId(show.id);
    try {
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingReminderShowId(null);
    }
  }, [isAuthenticated, handleRemindMe, isShowFavorited, toggleFavorite]);

  // Render a single matched card (IRL, Radio, or DJ Profile).
  // `opts.suggestionBridge` marks the card as a /scene SUGGESTED entry — the
  // bridge DJ's display name shown in the badge ("Similar to X").
  // `opts.allowRemove` overrides the default profileMode → onRemove mapping
  // (used by /scene's edit-mode toggle).
  const renderCard = (
    item: MatchedItem,
    index: number,
    profileMode?: boolean,
    opts?: { suggestionBridge?: string; allowRemove?: boolean },
  ) => {
    const suggestionBridge = opts?.suggestionBridge;
    const allowRemove = opts?.allowRemove ?? profileMode;
    if (item.type === 'profile') {
      const profile = item.data;
      const following = isInWatchlist(profile.displayName) || isInWatchlist(profile.username);
      const addingFollow = addingFollowDj === profile.displayName;
      const removing =
        removingWatchlistDj === (profile.username || profile.displayName);
      return (
        <DJProfileCard
          key={`profile-${profile.username}-${index}`}
          profile={profile}
          isFollowing={following}
          isAddingFollow={addingFollow}
          onFollow={() => handleUnifiedIRLFollow({ djName: profile.displayName, djUsername: profile.username } as IRLShowData)}
          matchLabel={item.matchLabel}
          watchlistMode={profileMode && !suggestionBridge}
          onRemove={
            allowRemove && !suggestionBridge ? () => handleRemoveWatchlistDj(profile) : undefined
          }
          isRemoving={removing}
          suggestionBridge={suggestionBridge}
        />
      );
    }
    if (item.type === 'irl') {
      const show = item.data;
      const following = show.djName ? isInWatchlist(show.djName) : false;
      const addingFollow = addingFollowDj === show.djName;
      const removingIrl =
        removingWatchlistDj === `irl-${show.djUsername || show.djName}-${show.date}`;
      // X on an IRL show card removes only THIS event from the watchlist,
      // not the DJ. Matches by djUsername/djName + date + location.
      const removeIrl = async () => {
        const key = `irl-${show.djUsername || show.djName}-${show.date}`;
        setRemovingWatchlistDj(key);
        try {
          await removeIrlFavorite({
            djUsername: show.djUsername,
            djName: show.djName,
            date: show.date,
            location: show.location,
          });
        } finally {
          setRemovingWatchlistDj(null);
        }
      };
      return (
        <IRLShowCard
          key={`irl-${show.djUsername}-${show.date}-${index}`}
          show={show}
          isFollowing={following}
          isAddingFollow={addingFollow}
          onFollow={() => handleUnifiedIRLFollow(show)}
          matchLabel={item.matchLabel}
          profileMode={profileMode}
          suggestionBridge={suggestionBridge}
          onRemove={
            allowRemove && !suggestionBridge ? removeIrl : undefined
          }
          isRemoving={removingIrl}
        />
      );
    } else {
      const show = item.data;
      const station = item.station;
      const following = show.dj ? isInWatchlist(show.dj) : false;
      const addingFollow = addingFollowDj === show.dj;
      const removingShow = removingWatchlistDj === `show-${show.id}`;
      // X on a radio/upcoming show card removes only THIS show favorite,
      // not the DJ. removeFavorite already does exactly that.
      const onRemoveShow = allowRemove && !suggestionBridge
        ? async () => {
            const key = `show-${show.id}`;
            setRemovingWatchlistDj(key);
            try {
              await removeFavorite(show);
            } finally {
              setRemovingWatchlistDj(null);
            }
          }
        : undefined;

      // Use LiveShowCard for live shows (red dot, "Join" button)
      if (item.live) {
        return (
          <LiveShowCard
            key={show.id}
            show={show}
            station={station}
            isFollowing={following}
            isAddingFollow={addingFollow}
            onFollow={() => handleUnifiedFollow(show)}
            matchLabel={item.matchLabel}
            profileMode={profileMode}
            bpm={stationBPM[getMetadataKeyByStationId(show.stationId) || '']?.bpm ?? null}
            suggestionBridge={suggestionBridge}
            onRemove={onRemoveShow}
            isRemoving={removingShow}
          />
        );
      }

      const favorited = isShowFavorited(show);
      const addingReminder = addingReminderShowId === show.id;
      return (
        <TicketCard
          key={show.id}
          show={show}
          station={station}
          isAuthenticated={isAuthenticated}
          isFollowing={following}
          isShowFavorited={favorited}
          isAddingFollow={addingFollow}
          isAddingReminder={addingReminder}
          onFollow={() => handleUnifiedFollow(show)}
          onRemindMe={() => handleUnifiedRemindMe(show)}
          matchLabel={item.matchLabel}
          profileMode={profileMode}
          suggestionBridge={suggestionBridge}
          onRemove={onRemoveShow}
          isRemoving={removingShow}
        />
      );
    }
  };

  // Prevent SSR hydration mismatches on /(home) where the hero depends on
  // Date / localStorage state. On /scene there's no hero — render the page
  // shell immediately so the user sees something while data loads.
  if (!mounted && !sceneMode) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      {/* Hero Section — unified ArchiveHero for all states */}
      {skipHero ? null : mounted ? (
        <div className="relative">
          {archivesLoading && !isLiveReady ? (
            <div className="flex items-center justify-center py-24">
              <svg className="animate-spin h-8 w-8 text-zinc-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : featuredArchive ? (
            <ArchiveHero
              archives={archives}
              featuredArchive={featuredArchive}
              isLive={isLiveReady}
              isRestream={isRestream}
              liveBPM={stationBPM['broadcast']?.bpm ?? null}
              liveDJChatRoom={currentDJChatRoom}
              preferredHeroSeed={initialPreferredHero}
              initialRadioArchiveId={initialRadioArchiveId}
              homepage
            />
          ) : null}
        </div>
      ) : null}

      <div id="scene" />

      {/* /scene top search bar (full-width, square edges) — only the
          HeaderSearch portion; the Tuner filters render below under the
          BEYOND YOUR SCENE header. */}
      {sceneMode && topSearchSlot && (
        <section className="px-4 md:px-8 pt-4 pb-2 relative z-10">
          <div className="max-w-7xl mx-auto">
            {topSearchSlot}
          </div>
        </section>
      )}

      {/* /scene YOUR SCENE section — grid of watchlist items + suggestions */}
      {sceneMode && !(isBroadcastLive && isBroadcastStreaming) && (() => {
        // Use the enriched list once schedule has loaded; otherwise paint
        // the optimistic list (built only from favorites + heart/lockin —
        // no schedule dependency, renders instantly).
        const watchlistSource =
          isLoading && favoritesNowLive.length === 0 ? favoritesOptimistic : favoritesNowLive;
        const hasWatchlist = watchlistSource.length > 0;
        const GRID_CAP = 4;
        const visibleWatchlist = sceneViewAll ? watchlistSource : watchlistSource.slice(0, GRID_CAP);
        const fillerSlots = Math.max(0, GRID_CAP - visibleWatchlist.length);
        // When the grid isn't full, inline suggestions fill the remaining
        // slots. When it IS full, render a separate SUGGESTED row below.
        // Suggestions need schedule data — withhold them while loading.
        const inlineSuggestions = !isLoading && hasWatchlist
          ? suggestedItems.slice(0, fillerSlots)
          : [];
        const trailingSuggestions = !isLoading
          ? hasWatchlist
            ? suggestedItems.slice(fillerSlots, fillerSlots + 2)
            : suggestedItems.slice(0, 6)
          : [];

        return (
          <section className="px-4 md:px-8 pt-4 pb-6 relative z-10" data-scene-edit-boundary>
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-2xl md:text-3xl font-semibold">YOUR SCENE</h2>
                {hasWatchlist && (
                  <button
                    onClick={() => setSceneEditMode((v) => !v)}
                    aria-pressed={sceneEditMode}
                    className="shrink-0 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300 transition-colors px-1 py-1"
                  >
                    {/* Hardware-style LED: dark when off, lit green when on. */}
                    <span
                      aria-hidden
                      className={`inline-block w-[6px] h-[6px] rounded-full transition-all ${
                        sceneEditMode
                          ? 'bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]'
                          : 'bg-zinc-700'
                      }`}
                    />
                    Edit
                  </button>
                )}
              </div>
              {!hasWatchlist && (
                <p className="text-sm text-zinc-500 -mt-2 mb-3">Your crate is empty.</p>
              )}

              {hasWatchlist && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 md:gap-x-8 gap-y-4">
                    {visibleWatchlist.map((item, index) =>
                      renderCard(item, index, true, { allowRemove: sceneEditMode })
                    )}
                    {inlineSuggestions.map((s, i) =>
                      renderCard(s.item, visibleWatchlist.length + i, false, { suggestionBridge: s.bridge })
                    )}
                  </div>
                  {favoritesNowLive.length > GRID_CAP && (
                    <button
                      onClick={() => setSceneViewAll((v) => !v)}
                      className="mt-3 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-white"
                    >
                      {sceneViewAll
                        ? 'Collapse ←'
                        : `View more (${favoritesNowLive.length}) →`}
                    </button>
                  )}
                </>
              )}

              {trailingSuggestions.length > 0 && (
                <div className={hasWatchlist ? 'mt-3' : ''}>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 md:gap-x-8 gap-y-4">
                    {trailingSuggestions.map((s, i) =>
                      renderCard(s.item, 1000 + i, false, { suggestionBridge: s.bridge })
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* /scene BEYOND YOUR SCENE header — renders above the discovery
          carousels when sceneMode is on. */}
      {sceneMode && (
        <section className="px-4 md:px-8 pt-6 pb-2 relative z-10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-semibold">BEYOND YOUR SCENE</h2>
          </div>
        </section>
      )}

      {/* /scene discovery filters (city + genre tuner) */}
      {sceneMode && discoveryFiltersSlot && (
        <section className="px-4 md:px-8 pt-2 pb-2 relative z-10">
          <div className="max-w-7xl mx-auto">
            {discoveryFiltersSlot}
          </div>
        </section>
      )}

      {/* The legacy "On your watchlist" carousel on `/` was removed —
          watchlist lives on /scene. /explore redirects to /scene; the
          SceneClient uses topSearchSlot + discoveryFiltersSlot props. */}

      {skipHero && (
      <div className="px-4 md:px-8 flex-1 w-full flex flex-col">
      <main className="max-w-7xl mx-auto flex-1 w-full flex flex-col">
        <div className="flex flex-col">

          {isLoading ? (
            <>
              {/* Skeleton grid section */}
              <div className="flex-shrink-0 pt-3 md:pt-4 pb-3 md:pb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              </div>
              {/* Skeleton carousel section */}
              <div className="flex-shrink-0 pb-3 md:pb-4">
                <div className="flex">
                  <div className="w-full md:w-1/2 flex-shrink-0 px-1">
                    <SkeletonCard />
                  </div>
                  <div className="hidden md:block w-1/2 flex-shrink-0 px-1">
                    <SkeletonCard />
                  </div>
                </div>
              </div>
            </>
          ) : (
          <>

          {/* Section 1: Location + Genre — today/tomorrow */}
          {todayTomorrowCards.length > 0 && (
            <div className="flex-shrink-0 pt-3 md:pt-4 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {todayTomorrowCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 2: Overflow + this week */}
          {nextWeekCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {nextWeekCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 3: Genre-only online */}
          {genreOnlineCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {genreOnlineCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 4: Recommended by (curator recs + station picks) */}
          {recommendedByCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {recommendedByCards.map((item, index) =>
                  item.type === 'curator'
                    ? <CuratorRecCard key={`rec-${item.data.djUsername}-${index}`} rec={item.data} />
                    : renderCard(item as MatchedItem, index)
                )}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Empty state when no matches at all and no invite card already shown above */}
          {!isLoading && allCardCount === 0 && missingGenres.length === 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <InviteCard message="Know a great curator? Invite them to Channel" />
            </div>
          )}

          </>
          )}

        </div>
      </main>
      </div>
      )}

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setAuthModalMessage(undefined);
        }}
        message={authModalMessage}
        onSignInComplete={() => {
          if (isGated) {
            clearGate();
          }
        }}
      />
    </div>
  );
}
