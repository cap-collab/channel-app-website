'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { ArchiveHero } from '@/components/channel/ArchiveHero';
import { computeDJChatRoom } from '@/lib/broadcast-utils';
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

type RecommendedItem =
  | MatchedItem
  | { type: 'curator'; data: CuratorRec };

export function ChannelClient({ skipHero, exploreSearchBar }: { skipHero?: boolean; exploreSearchBar?: React.ReactNode } = {}) {
  const { user, isAuthenticated } = useAuthContext();
  const { isLive: isBroadcastLive, isStreaming: isBroadcastStreaming, currentShow } = useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const archivePlayer = useArchivePlayer();
  const { isGated, gateAttempt, clearGate } = archivePlayer;
  const { archives: rawArchives, featuredArchive: rawFeaturedArchive, loading: archivesLoading } = useArchives();
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


  // All shows data (from shared ScheduleContext)
  const allShows = scheduleShows;
  const irlShows = scheduleIrlShows;
  const curatorRecs = scheduleCuratorRecs;
  const djProfiles = scheduleDjProfiles;
  const isLoading = scheduleLoading;

  // Selected city and genres (from global FilterContext)
  const { selectedCity, selectedGenres, setTunerHints } = useFilterContext();

  // Determine which hero to show
  const isLiveReady = isBroadcastLive && isBroadcastStreaming;

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

    const scored = rawArchives.map((archive) => {
      let genreScore = 0;
      for (const dj of archive.djs) {
        const genres = dj.genres;
        if (genres && genres.length > 0) {
          genreScore += selectedGenres.filter((g) => matchesGenreLib(genres, g)).length;
        }
      }
      return { archive, score: genreScore };
    });

    scored.sort((a, b) => b.score - a.score);
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

  // Compute all sections with deduplication
  const {
    favoritesNowLive,
    todayTomorrowCards,
    nextWeekCards,
    genreOnlineCards,
    recommendedByCards,
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
    const stationCandidates: { item: MatchedItem; id: string; djName: string | undefined; live: boolean; isChannelUser: boolean }[] = [];
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
      });
    }
    stationCandidates.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
      return 0;
    });
    let stationCount = 0;
    for (const c of stationCandidates) {
      if (stationCount >= 5) break;
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
  }, [allShows, irlShows, curatorRecs, djProfiles, selectedCity, selectedGenres, stationsMap, matchesAnyGenre, getMatchingGenres, genreLabelFor, isShowLive, isValidShow, followedDJNames, isInWatchlist, isShowFavorited, favorites, user]);

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

  // Genre filter triggers email popup for logged-out users
  const handleGenreDropdownClose = useCallback(() => {
    if (!isAuthenticated && selectedGenres.length > 0) {
      window.dispatchEvent(new Event('open-email-popup'));
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
            />
          ) : null}
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

      {/* Meanwhile in the Scene — hidden on /explore */}
      {!skipHero ? (
        <section className="px-4 md:px-8 pt-4 pb-0 relative z-10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-semibold mb-2">Meanwhile in the scene</h2>
          </div>
        </section>
      ) : null}

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
