'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
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
import { GenreAlertPrompt } from '@/components/channel/GenreAlertPrompt';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { LiveBroadcastHero } from '@/components/channel/LiveBroadcastHero';
import { ArchiveHero } from '@/components/channel/ArchiveHero';
import { OfflineHero } from '@/components/channel/OfflineHero';
import { EmailPopup } from '@/components/channel/EmailPopup';
import { Show, Station, IRLShowData, CuratorRec, DJProfile } from '@/types';
import { DJProfileCard } from '@/components/channel/DJProfileCard';
import { STATIONS, getMetadataKeyByStationId } from '@/lib/stations';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useArchives } from '@/hooks/useArchives';
import { useBPM } from '@/contexts/BPMContext';
import { useFavorites } from '@/hooks/useFavorites';
import { matchesCity, SUPPORTED_CITIES } from '@/lib/city-detection';
import { GENRE_ALIASES, SUPPORTED_GENRES, matchesGenre as matchesGenreLib } from '@/lib/genres';

type MatchedItem =
  | { type: 'irl'; data: IRLShowData; matchLabel: string | undefined }
  | { type: 'radio'; data: Show; station: Station; matchLabel: string | undefined; live?: boolean }
  | { type: 'profile'; data: DJProfile; matchLabel: string | undefined };

export function ChannelClient({ skipHero, exploreSearchBar }: { skipHero?: boolean; exploreSearchBar?: React.ReactNode } = {}) {
  const { user, isAuthenticated } = useAuthContext();
  const { isLive: isBroadcastLive, isStreaming: isBroadcastStreaming, currentDJ, currentShow, play: playLive } = useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const archivePlayer = useArchivePlayer();
  const { isGated, gateAttempt, clearGate } = archivePlayer;
  const { archives: rawArchives, featuredArchive: rawFeaturedArchive, loading: archivesLoading } = useArchives();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Switch-to-live prompt state
  const [showLivePrompt, setShowLivePrompt] = useState(false);
  const [dismissedLivePrompt, setDismissedLivePrompt] = useState(false);

  // Show prompt when live starts while archive is playing
  useEffect(() => {
    if (isBroadcastLive && isBroadcastStreaming && archivePlayer.isPlaying && !dismissedLivePrompt) {
      setShowLivePrompt(true);
    }
    // Reset when broadcast ends
    if (!isBroadcastLive || !isBroadcastStreaming) {
      setDismissedLivePrompt(false);
      setShowLivePrompt(false);
    }
  }, [isBroadcastLive, isBroadcastStreaming, archivePlayer.isPlaying, dismissedLivePrompt]);

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
  const { favorites, isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const { shows: scheduleShows, irlShows: scheduleIrlShows, curatorRecs: scheduleCuratorRecs, djProfiles: scheduleDjProfiles, loading: scheduleLoading } = useSchedule();
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

  // Track whether user has seen curator recs before (move to bottom after first view)
  const [hasSeenCuratorRecs, setHasSeenCuratorRecs] = useState(false);

  // Read localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    try {
      if (localStorage.getItem('channel-seen-curator-recs') === '1') {
        setHasSeenCuratorRecs(true);
      }
    } catch {}
  }, []);

  // All shows data (from shared ScheduleContext)
  const allShows = scheduleShows;
  const irlShows = scheduleIrlShows;
  const curatorRecs = scheduleCuratorRecs;
  const djProfiles = scheduleDjProfiles;
  const isLoading = scheduleLoading;

  // Selected city and genres (from global FilterContext)
  const { selectedCity, selectedGenres, setTunerHints } = useFilterContext();

  // Genre alert prompt state (for logged-out users)
  const [showGenreAlertPrompt, setShowGenreAlertPrompt] = useState(false);

  // Determine which hero to show
  const isLiveReady = isBroadcastLive && isBroadcastStreaming;
  const shouldShowArchiveWithPrompt = isLiveReady && archivePlayer.isPlaying;

  // Hero mode toggle: 'live' or 'archive' — only matters when live
  const [heroMode, setHeroMode] = useState<'live' | 'archive'>('live');

  // Auto-set hero mode when live status changes
  useEffect(() => {
    if (isLiveReady) {
      setHeroMode(archivePlayer.isPlaying ? 'archive' : 'live');
    }
  }, [isLiveReady, archivePlayer.isPlaying]);

  const isRestream = currentShow?.broadcastType === 'restream';

  // Swipe handling for hero section
  const heroSwipeRef = useRef<{ startX: number; startY: number } | null>(null);
  const handleHeroTouchStart = useCallback((e: React.TouchEvent) => {
    heroSwipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
  }, []);
  const handleHeroTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!heroSwipeRef.current || !isLiveReady) return;
    const dx = e.changedTouches[0].clientX - heroSwipeRef.current.startX;
    const dy = e.changedTouches[0].clientY - heroSwipeRef.current.startY;
    heroSwipeRef.current = null;
    // Only trigger on horizontal swipes (dx > dy and minimum distance)
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && heroMode === 'live') {
        setHeroMode('archive');
      } else if (dx > 0 && heroMode === 'archive') {
        setHeroMode('live');
        if (archivePlayer.isPlaying) {
          archivePlayer.pause();
          playLive();
        }
      }
    }
  }, [isLiveReady, heroMode, archivePlayer, playLive]);

  const handleSwitchToLive = useCallback(() => {
    archivePlayer.pause();
    setShowLivePrompt(false);
    setDismissedLivePrompt(false);
    setHeroMode('live');
    playLive();
  }, [archivePlayer, playLive]);

  const handleKeepListening = useCallback(() => {
    setShowLivePrompt(false);
    setDismissedLivePrompt(true);
  }, []);

  // Follow/remind state
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

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

  // Sort archives by genre match count (more matching genres = higher in the list)
  const { archives, featuredArchive } = useMemo(() => {
    if (rawArchives.length === 0) return { archives: rawArchives, featuredArchive: rawFeaturedArchive };
    if (selectedGenres.length === 0) {
      return { archives: rawArchives, featuredArchive: rawFeaturedArchive };
    }

    // Build DJ username → genres map from schedule DJ profiles
    const djGenreMap = new Map<string, string[]>();
    for (const profile of djProfiles) {
      if (profile.username && profile.genres) {
        djGenreMap.set(profile.username.toLowerCase(), profile.genres);
      }
    }

    const scored = rawArchives.map((archive) => {
      let genreScore = 0;
      for (const dj of archive.djs) {
        const username = dj.username?.toLowerCase();
        if (!username) continue;
        const genres = djGenreMap.get(username);
        if (genres) {
          genreScore += selectedGenres.filter((g) => matchesGenreLib(genres, g)).length;
        }
      }
      return { archive, score: genreScore };
    });

    scored.sort((a, b) => b.score - a.score);
    const sorted = scored.map((s) => s.archive);
    return { archives: sorted, featuredArchive: sorted[0] };
  }, [rawArchives, rawFeaturedArchive, selectedGenres, djProfiles]);

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

  // Compute all sections with deduplication
  const {
    favoritesNowLive,
    locationGenreCards,
    filteredCuratorRecs,
    genreCards,
    locationCards,
    radioCards,
  } = useMemo(() => {
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
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        // Sort group: live > IRL > profile > upcoming
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
    // IRL shows in the scene section: only today, tomorrow, or day after tomorrow
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sceneCutoffDateStr = threeDaysFromNow.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const s0Candidates: { item: MatchedItem; id: string; djName: string | undefined; startMs: number; live: boolean }[] = [];
    // Radio shows from followed DJs / favorited shows in next 2 weeks
    for (const show of allShows) {
      if (!show.dj) continue;
      // Never show restreams in watchlist (regular restreams, external show restreams, or channel broadcast restreams)
      if (show.type === 'restream' || show.type === 'playlist' || show.broadcastType === 'restream') continue;
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
    for (const profile of followedProfiles) {
      s0.push({ type: 'profile', data: profile, matchLabel: undefined });
    }

    // Section 1: Location + Genre (grid, max 4) — sorted by match count > sortGroup > time > isChannelUser
    // Only show when a specific city is selected (not "Anywhere")
    let s1: MatchedItem[] = [];
    if (hasGenreFilter && !isAnywhere) {
      const candidates: Candidate[] = [];
      // IRL shows (always from Channel users) — city + genre match, within 3 days
      for (const show of irlShows) {
        if (show.date >= sceneCutoffDateStr) continue;
        if (!matchesCity(show.location, selectedCity)) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        const genreLabel = genreLabelFor(show.djGenres);
        const label = `${selectedCity.toUpperCase()} + ${genreLabel}`;
        candidates.push({ item: makeIRLItem(show, label), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
      }
      // Radio shows (live and upcoming)
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        const cityMatch = show.djLocation ? matchesCity(show.djLocation, selectedCity) : false;
        if (!cityMatch) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const live = isShowLive(show);
        const label = `${selectedCity.toUpperCase()} + ${genreLabelFor(show.djGenres)}`;
        const item = makeRadioItem(show, label, live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      // DJ profiles matching city + genre (skip already-followed)
      for (const profile of djProfiles) {
        if (isInWatchlist(profile.displayName) || isInWatchlist(profile.username)) continue;
        if (!profile.location || !matchesCity(profile.location, selectedCity)) continue;
        if (!matchesAnyGenre(profile.genres)) continue;
        const id = `profile-${profile.username}`;
        const genreLabel = genreLabelFor(profile.genres);
        const label = `${selectedCity.toUpperCase()} + ${genreLabel}`;
        candidates.push({ item: { type: 'profile', data: profile, matchLabel: label }, id, djName: profile.displayName, matchCount: genreMatchCount(profile.genres), startMs: 0, sortGroup: profile.isChannelUser ? 1 : 2, isChannelUser: profile.isChannelUser });
      }
      s1 = takeSorted(candidates, 4);
    }

    // Section 3: Curator recs from followed DJs (grid, max 4)
    const s3: CuratorRec[] = [];
    if (followedDJNames.length > 0) {
      for (const rec of curatorRecs) {
        if (s3.length >= 4) break;
        if (followedDJNames.includes(rec.djUsername.toLowerCase()) ||
            followedDJNames.includes(rec.djName.toLowerCase())) {
          s3.push(rec);
        }
      }
    }

    // Section 4: Genre matching (swipe, max 5) — sorted by match count > sortGroup > time > isChannelUser
    let s4: MatchedItem[] = [];
    if (hasGenreFilter) {
      const candidates: Candidate[] = [];
      // IRL shows — genre match, within 3 days
      for (const show of irlShows) {
        if (show.date >= sceneCutoffDateStr) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        const genreLabel = genreLabelFor(show.djGenres);
        candidates.push({ item: makeIRLItem(show, genreLabel || show.location.toUpperCase()), id, djName: show.djName, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
      }
      // Radio shows (live and upcoming)
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (!matchesAnyGenre(show.djGenres)) continue;
        const live = isShowLive(show);
        const item = makeRadioItem(show, genreLabelFor(show.djGenres), live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: genreMatchCount(show.djGenres), startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      // DJ profiles matching genre (skip already-followed)
      for (const profile of djProfiles) {
        if (isInWatchlist(profile.displayName) || isInWatchlist(profile.username)) continue;
        if (!matchesAnyGenre(profile.genres)) continue;
        const id = `profile-${profile.username}`;
        const genreLabel = genreLabelFor(profile.genres);
        candidates.push({ item: { type: 'profile', data: profile, matchLabel: genreLabel }, id, djName: profile.displayName, matchCount: genreMatchCount(profile.genres), startMs: 0, sortGroup: profile.isChannelUser ? 1 : 2, isChannelUser: profile.isChannelUser });
      }
      s4 = takeSorted(candidates, 5);
    }

    // Section 6: Location matching (swipe, max 5) — sorted by sortGroup > time > isChannelUser
    let s6: MatchedItem[] = [];
    if (!isAnywhere) {
      const candidates: Candidate[] = [];
      // IRL shows (always from Channel users), within 3 days
      for (const show of irlShows) {
        if (show.date >= sceneCutoffDateStr) continue;
        if (!matchesCity(show.location, selectedCity)) continue;
        const id = `irl-${show.djUsername}-${show.date}`;
        candidates.push({ item: makeIRLItem(show, selectedCity.toUpperCase()), id, djName: show.djName, matchCount: 0, startMs: new Date(show.date + 'T00:00:00').getTime(), sortGroup: 1, isChannelUser: true });
      }
      // Radio shows
      for (const show of allShows) {
        if (!isValidShow(show)) continue;
        if (new Date(show.endTime) <= now) continue;
        if (!show.djLocation || !matchesCity(show.djLocation, selectedCity)) continue;
        const live = isShowLive(show);
        const item = makeRadioItem(show, selectedCity.toUpperCase(), live || undefined);
        if (item) candidates.push({ item, id: show.id, djName: show.dj, matchCount: 0, startMs: new Date(show.startTime).getTime(), sortGroup: live ? 0 : 3, isChannelUser: show.isChannelUser ?? false });
      }
      s6 = takeSorted(candidates, 5);
    }

    // Section 7: Selected by Radio (swipe, max 5) — external station shows, sorted by live > isChannelUser
    const s7Candidates: { item: MatchedItem; id: string; djName: string | undefined; live: boolean; isChannelUser: boolean }[] = [];
    for (const show of allShows) {
      if (!isValidShow(show)) continue;
      if (new Date(show.endTime) <= now) continue;
      if (show.stationId === 'broadcast' || show.stationId === 'dj-radio') continue;
      const station = stationsMap.get(show.stationId);
      if (!station) continue;
      const live = isShowLive(show);
      s7Candidates.push({
        item: { type: 'radio', data: show, station, matchLabel: `SELECTED BY ${station.name.toUpperCase()}`, live: live || undefined },
        id: show.id,
        djName: show.dj,
        live,
        isChannelUser: show.isChannelUser ?? false,
      });
    }
    // Sort: live first, then Channel users first
    s7Candidates.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
      return 0;
    });
    const s7: MatchedItem[] = [];
    for (const c of s7Candidates) {
      if (s7.length >= 5) break;
      if (!tryAddShow(c.id, c.djName)) continue;
      s7.push(c.item);
    }

    return {
      favoritesNowLive: s0,
      locationGenreCards: s1,
      filteredCuratorRecs: s3,
      genreCards: s4,
      locationCards: s6,
      radioCards: s7,
    };
  }, [allShows, irlShows, curatorRecs, djProfiles, selectedCity, selectedGenres, stationsMap, matchesAnyGenre, getMatchingGenres, genreLabelFor, isShowLive, isValidShow, followedDJNames, isInWatchlist, isShowFavorited, favorites, user]);

  // Mark curator recs as seen once they render at the top for the first time
  useEffect(() => {
    if (!hasSeenCuratorRecs && filteredCuratorRecs.length > 0) {
      try { localStorage.setItem('channel-seen-curator-recs', '1'); } catch {}
      setHasSeenCuratorRecs(true);
    }
  }, [hasSeenCuratorRecs, filteredCuratorRecs]);

  // Compute result counts for Tuner bar
  const allCardCount = locationGenreCards.length +
    genreCards.length + locationCards.length + radioCards.length;

  const cityResultCount = useMemo(() => {
    if (!selectedCity || selectedCity === 'Anywhere') return undefined;
    return locationGenreCards.length + locationCards.length;
  }, [selectedCity, locationGenreCards, locationCards]);

  const genreResultCount = useMemo(() => {
    if (selectedGenres.length === 0) return undefined;
    return locationGenreCards.length + genreCards.length;
  }, [selectedGenres, locationGenreCards, genreCards]);

  const missingGenres = useMemo(() => {
    if (selectedGenres.length === 0) return [];
    if (locationGenreCards.length === 0 && genreCards.length === 0) return selectedGenres;
    const allGenreCards = [...locationGenreCards, ...genreCards];
    return selectedGenres.filter((genre) => {
      return !allGenreCards.some((item) => {
        const showGenres = item.type === 'profile' ? item.data.genres : item.data.djGenres;
        return showGenres ? matchesGenre(showGenres, genre) : false;
      });
    });
  }, [selectedGenres, locationGenreCards, genreCards, matchesGenre]);

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

  // Genre alert prompt handler for logged-out users
  const handleGenreDropdownClose = useCallback(() => {
    if (!isAuthenticated && selectedGenres.length > 0) {
      setShowGenreAlertPrompt(true);
    }
  }, [isAuthenticated, selectedGenres]);

  // Push computed Tuner hints into FilterContext for HeaderTuner
  useEffect(() => {
    setTunerHints({
      cityResultCount,
      genreResultCount,
      citiesWithMatches,
      genresWithMatches,
      onGenreDropdownClose: handleGenreDropdownClose,
    });
  }, [cityResultCount, genreResultCount, citiesWithMatches, genresWithMatches, handleGenreDropdownClose, setTunerHints]);

  const handleGenreAlertSignUp = useCallback(() => {
    setShowGenreAlertPrompt(false);
    setAuthModalMessage('Sign up to receive alerts for shows matching your genre preferences');
    setShowAuthModal(true);
  }, []);

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

  // Render a single matched card (IRL, Radio, or DJ Profile)
  const renderCard = (item: MatchedItem, index: number, profileMode?: boolean) => {
    if (item.type === 'profile') {
      const profile = item.data;
      const following = isInWatchlist(profile.displayName) || isInWatchlist(profile.username);
      const addingFollow = addingFollowDj === profile.displayName;
      return (
        <DJProfileCard
          key={`profile-${profile.username}-${index}`}
          profile={profile}
          isFollowing={following}
          isAddingFollow={addingFollow}
          onFollow={() => handleUnifiedIRLFollow({ djName: profile.displayName, djUsername: profile.username } as IRLShowData)}
          matchLabel={item.matchLabel}
          watchlistMode={profileMode}
        />
      );
    }
    if (item.type === 'irl') {
      const show = item.data;
      const following = show.djName ? isInWatchlist(show.djName) : false;
      const addingFollow = addingFollowDj === show.djName;
      return (
        <IRLShowCard
          key={`irl-${show.djUsername}-${show.date}-${index}`}
          show={show}
          isFollowing={following}
          isAddingFollow={addingFollow}
          onFollow={() => handleUnifiedIRLFollow(show)}
          matchLabel={item.matchLabel}
          profileMode={profileMode}
        />
      );
    } else {
      const show = item.data;
      const station = item.station;
      const following = show.dj ? isInWatchlist(show.dj) : false;
      const addingFollow = addingFollowDj === show.dj;

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
        />
      );
    }
  };

  // Prevent SSR hydration mismatches from Date/localStorage differences
  if (!mounted) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <div className="sticky top-0 z-[100]">
        <Header currentPage="channel" position="sticky" />
      </div>

      {/* Hero Section — Live Broadcast, Archive, or Offline */}
      {skipHero ? null : mounted ? (
        <div className="relative" onTouchStart={isLiveReady ? handleHeroTouchStart : undefined} onTouchEnd={isLiveReady ? handleHeroTouchEnd : undefined}>

          {/* Live/Archive toggle — only shown when live */}
          {isLiveReady && (
            <div className="flex items-center justify-center gap-0 px-4 pt-4 pb-1">
              <button
                onClick={() => {
                  setHeroMode('live');
                  if (archivePlayer.isPlaying) {
                    archivePlayer.pause();
                    playLive();
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-tighter font-bold transition-colors ${
                  heroMode === 'live' ? 'text-red-500' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                {isRestream ? (
                  <svg className={`w-3 h-3 ${heroMode === 'live' ? 'animate-pulse' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                ) : (
                  <span className="relative flex h-2 w-2">
                    {heroMode === 'live' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />}
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                  </span>
                )}
                {isRestream ? 'Restream' : 'Live'}
                {stationBPM['broadcast']?.bpm && ` ${stationBPM['broadcast'].bpm} BPM`}
              </button>
              <span className="text-zinc-700 text-xs mx-1">|</span>
              <button
                onClick={() => setHeroMode('archive')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-tighter font-bold transition-colors ${
                  heroMode === 'archive' ? 'text-gray-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1" />
                  <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
                  <path d="M10 12h4" />
                </svg>
                Archive
              </button>
            </div>
          )}

          {/* Switch-to-live prompt overlay */}
          {shouldShowArchiveWithPrompt && showLivePrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-black border border-white/20 rounded-xl px-6 py-5 max-w-sm w-full shadow-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
                  </span>
                  <p className="text-white text-base font-bold truncate">{currentDJ || 'A DJ'} is live!</p>
                </div>
                <p className="text-zinc-400 text-sm mb-5">Switch to the live broadcast?</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSwitchToLive}
                    className="flex-1 py-2.5 bg-white text-black text-sm font-bold hover:bg-gray-200 transition-colors rounded-lg"
                  >
                    Switch to live
                  </button>
                  <button
                    onClick={handleKeepListening}
                    className="flex-1 py-2.5 text-zinc-400 text-sm font-medium hover:text-white transition-colors border border-white/10 rounded-lg"
                  >
                    Keep listening
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Hero content based on mode */}
          {isLiveReady && heroMode === 'live' ? (
            <LiveBroadcastHero />
          ) : archivesLoading ? (
            <div className="flex items-center justify-center py-24">
              <svg className="animate-spin h-8 w-8 text-zinc-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : featuredArchive ? (
            <ArchiveHero archives={archives} featuredArchive={featuredArchive} />
          ) : (
            <OfflineHero />
          )}
        </div>
      ) : null}

      <EmailPopup />

      <div id="scene" />

      {/* Explore search bar (only rendered on /explore) */}
      {exploreSearchBar}

      {/* Favorites — followed DJs & favorited shows in next 7 days, only when NOT on Channel Radio */}
      {mounted && !(isBroadcastLive && isBroadcastStreaming) && favoritesNowLive.length > 0 && (
        <section className="px-4 md:px-8 pt-4 pb-6 relative z-10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-semibold mb-3">On your watchlist</h2>
            <SwipeableCardCarousel>
              {favoritesNowLive.map((item, index) => renderCard(item, index, true))}
            </SwipeableCardCarousel>
          </div>
        </section>
      )}

      {/* Meanwhile in the Scene */}
      <section className="px-4 md:px-8 pb-0 relative z-10">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">Meanwhile in the scene</h2>
        </div>
      </section>

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

          {/* Section 1: Location + Genre (carousel, max 4) */}
          {locationGenreCards.length > 0 && (
            <div className="flex-shrink-0 pt-3 md:pt-4 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {locationGenreCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}


          {/* Section 3: Selected by your favorite curators (carousel, max 4) — shown here on first visit, at the bottom after */}
          {!hasSeenCuratorRecs && filteredCuratorRecs.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {filteredCuratorRecs.map((rec, index) => (
                  <CuratorRecCard
                    key={`rec-${rec.djUsername}-${index}`}
                    rec={rec}
                  />
                ))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 4: Genre matching (swipe, max 5) */}
          {genreCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {genreCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 6: Location matching (swipe, max 5) */}
          {locationCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {locationCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 7: Selected by Radio (swipe, max 5) */}
          {radioCards.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {radioCards.map((item, index) => renderCard(item, index))}
              </SwipeableCardCarousel>
            </div>
          )}

          {/* Section 3 (bottom): Curator recs moved here after user has seen them once */}
          {hasSeenCuratorRecs && filteredCuratorRecs.length > 0 && (
            <div className="flex-shrink-0 pb-3 md:pb-4">
              <SwipeableCardCarousel>
                {filteredCuratorRecs.map((rec, index) => (
                  <CuratorRecCard
                    key={`rec-${rec.djUsername}-${index}`}
                    rec={rec}
                  />
                ))}
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

      <GenreAlertPrompt
        isOpen={showGenreAlertPrompt}
        onClose={() => setShowGenreAlertPrompt(false)}
        onSignUp={handleGenreAlertSignUp}
      />

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
