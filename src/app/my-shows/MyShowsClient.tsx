"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites, Favorite, isRecurringFavorite } from "@/hooks/useFavorites";
import { useSchedule } from "@/contexts/ScheduleContext";
import { AuthModal } from "@/components/AuthModal";
import { Header } from "@/components/Header";
import { MyShowsCard } from "@/components/my-shows/MyShowsCard";
import { WatchlistDJCard } from "@/components/my-shows/WatchlistDJCard";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { getStationById, getStationByMetadataKey } from "@/lib/stations";
import { showMatchesDJ, wordBoundaryMatch } from "@/lib/dj-matching";
import { Show } from "@/types";

// Cache for DJ profile lookups (populated from /api/schedule data)
interface DJProfileCache {
  username: string;
  photoUrl?: string;
  location?: string;
  genres?: string[];
}

// Normalize name for profile lookup (must match metadata build: lowercase, alphanumeric only)
function normalizeForLookup(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Find DJ profile in cache for a favorite — tries multiple lookup strategies
// to handle cases where favorite fields may be missing or use different naming
function findDJProfile(favorite: Favorite, profiles: Map<string, DJProfileCache>): DJProfileCache | undefined {
  const n = (s: string) => s.replace(/[\s-]+/g, "").toLowerCase();

  // 1. Try djUsername (most reliable — matches chatUsernameNormalized)
  if (favorite.djUsername) {
    const profile = profiles.get(n(favorite.djUsername));
    if (profile) return profile;
  }

  // 2. Try djName
  if (favorite.djName) {
    const profile = profiles.get(n(favorite.djName));
    if (profile) return profile;
  }

  // 3. Try term directly (works for watchlist-style favorites where term = DJ name)
  const profile = profiles.get(n(favorite.term));
  if (profile) return profile;

  // 4. Try extracting DJ name from show name format "DJ - Show Name"
  const parts = favorite.term.split(/\s[-–]\s/);
  if (parts.length > 1) {
    const firstPart = profiles.get(n(parts[0]));
    if (firstPart) return firstPart;
  }

  return undefined;
}

// Helper to find station by id OR metadataKey
function getStation(stationId: string | undefined) {
  if (!stationId) return undefined;
  return getStationById(stationId) || getStationByMetadataKey(stationId);
}

// Match a favorite against shows to find scheduled instances
function findMatchingShows(favorite: Favorite, allShows: Show[]): Show[] {
  const term = favorite.term;
  const showName = favorite.showName;

  return allShows.filter((show) => {
    // Match by station if specified
    if (favorite.stationId) {
      const favStation = getStation(favorite.stationId);
      const showStation = getStation(show.stationId);
      // If the favorite's stationId doesn't resolve to a known station,
      // also allow matching against dj-radio shows (DJ-entered radio shows
      // from /studio are synced with the radio name as stationId, e.g. "nts",
      // but appear in the schedule under stationId "dj-radio")
      const stationMatch = favStation?.id === showStation?.id ||
        (!favStation && show.stationId === "dj-radio");
      if (!stationMatch) return false;
    }

    // Match by DJ (word boundary match)
    const djMatch = showMatchesDJ(show, term);
    // Also try matching against the stored showName (word boundary)
    const storedNameMatch = showName && wordBoundaryMatch(show.name, showName);

    // Also match by DJ name or username — handles cases where the show name
    // changes between broadcast slots (e.g. DJ creates new slot via /studio)
    const djNameMatch = favorite.djName && showMatchesDJ(show, favorite.djName);
    const djUsernameMatch = favorite.djUsername && showMatchesDJ(show, favorite.djUsername);

    return djMatch || storedNameMatch || djNameMatch || djUsernameMatch;
  });
}

interface CategorizedShow {
  favorite: Favorite;
  show: Show;
}

// Unified type for upcoming shows (both online and IRL)
interface UpcomingShowItem {
  id: string;
  type: 'online' | 'irl';
  sortTime: Date;
  isLive: boolean;
  djName: string;
  djPhotoUrl?: string;
  djUsername?: string;
  djGenres?: string[];
  // Online-specific
  favorite?: Favorite;
  show?: Show;
  stationId?: string;
  // IRL-specific
  irlFavorite?: Favorite;
}

export function MyShowsClient() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();
  const {
    favorites,
    loading: favoritesLoading,
    removeFavorite,
  } = useFavorites();
  const { shows: allShows, irlShows: allIRLShows, loading: showsLoading } = useSchedule();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [djProfiles, setDJProfiles] = useState<Map<string, DJProfileCache>>(new Map());

  // Separate favorites by type
  const stationShows = favorites.filter(
    (f) => (f.type === "show" || f.type === "dj") && f.stationId && f.stationId !== "CHANNEL"
  );
  const watchlist = favorites.filter((f) => f.type === "search");
  // IRL events - filter to future events only
  const today = new Date().toISOString().split("T")[0];
  const irlEvents = favorites
    .filter((f) => f.type === "irl" && f.irlDate && f.irlDate >= today)
    .sort((a, b) => (a.irlDate || "").localeCompare(b.irlDate || ""));

  // Categorize shows into Live Now, Coming Up, Returning Soon, One-Time
  const categorizedShows = useMemo(() => {
    const now = new Date();
    const liveNow: CategorizedShow[] = [];
    const comingUp: CategorizedShow[] = [];
    const returningSoon: Favorite[] = [];
    const oneTime: Favorite[] = [];

    // Track which shows have already been added to avoid duplicates
    // (multiple favorites can match the same show) - dedupe by normalized show name
    const seenLiveShowNames = new Set<string>();
    const seenUpcomingShowNames = new Set<string>();

    const bcast = allShows.filter(s => s.stationId === "broadcast");
    if (bcast.length > 0 || stationShows.some(f => f.stationId === "broadcast")) {
      console.log(`[MyShows] ${bcast.length} broadcast in allShows, names:`, bcast.map(s => s.name));
    }

    for (const favorite of stationShows) {
      const matchingShows = findMatchingShows(favorite, allShows);
      if (favorite.stationId === "broadcast") {
        console.log(`[MyShows] fav "${favorite.showName}" → ${matchingShows.length} matches, upcoming: ${matchingShows.filter(s => new Date(s.startTime) > now).length}`);
      }

      // Find live show
      const liveShow = matchingShows.find((show) => {
        const start = new Date(show.startTime);
        const end = new Date(show.endTime);
        return start <= now && end > now;
      });

      if (liveShow) {
        // Only add if we haven't seen this show name already
        const showNameKey = normalizeForLookup(liveShow.name);
        if (!seenLiveShowNames.has(showNameKey)) {
          seenLiveShowNames.add(showNameKey);
          liveNow.push({ favorite, show: liveShow });
        }
        continue;
      }

      // Find upcoming shows (future)
      const upcomingShows = matchingShows
        .filter((show) => new Date(show.startTime) > now)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcomingShows.length > 0) {
        const nextShow = upcomingShows[0];
        // Only add if we haven't seen this show name already
        const showNameKey = normalizeForLookup(nextShow.name);
        if (!seenUpcomingShowNames.has(showNameKey)) {
          seenUpcomingShowNames.add(showNameKey);
          comingUp.push({ favorite, show: nextShow });
        }
        continue;
      }

      // No schedule match found — check if the favorite itself has a future date
      // (radio shows synced from /studio have radioShowDate/radioShowTime)
      if (favorite.radioShowDate && favorite.radioShowDate >= today) {
        const timeStr = favorite.radioShowTime || "12:00";
        const durationHours = parseFloat(favorite.radioShowDuration || "1");
        const startMs = new Date(`${favorite.radioShowDate}T${timeStr}:00`).getTime();
        if (startMs > now.getTime()) {
          const showNameKey = normalizeForLookup(favorite.showName || favorite.term);
          if (!seenUpcomingShowNames.has(showNameKey)) {
            seenUpcomingShowNames.add(showNameKey);
            comingUp.push({
              favorite,
              show: {
                id: `radio-${favorite.id}`,
                name: favorite.showName || favorite.term,
                dj: favorite.djName,
                djUsername: favorite.djUsername,
                djPhotoUrl: favorite.djPhotoUrl,
                startTime: new Date(startMs).toISOString(),
                endTime: new Date(startMs + durationHours * 60 * 60 * 1000).toISOString(),
                stationId: favorite.stationId || "dj-radio",
                description: favorite.radioShowUrl ? `Listen at: ${favorite.radioShowUrl}` : undefined,
              },
            });
          }
          continue;
        }
      }

      // No upcoming or live shows - categorize based on favorite's showType
      if (isRecurringFavorite(favorite)) {
        returningSoon.push(favorite);
      } else {
        oneTime.push(favorite);
      }
    }

    // Sort coming up by show time
    comingUp.sort(
      (a, b) => new Date(a.show.startTime).getTime() - new Date(b.show.startTime).getTime()
    );

    // Deduplicate returningSoon and oneTime by normalized show name
    const dedupeByShowName = (favorites: Favorite[]): Favorite[] => {
      const seen = new Set<string>();
      return favorites.filter((fav) => {
        const key = normalizeForLookup(fav.showName || fav.term);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    return {
      liveNow,
      comingUp,
      returningSoon: dedupeByShowName(returningSoon),
      oneTime: dedupeByShowName(oneTime),
    };
  }, [stationShows, allShows]);

  // Build DJ profile cache from:
  // 1. Shows in schedule (already enriched with profile data)
  // 2. Firebase lookups for watchlist/favorites not in current schedule
  useEffect(() => {
    const newProfiles = new Map<string, DJProfileCache>();

    // Step 1: Extract profile data from shows that have djUsername
    // djUsername from metadata is already normalized (lowercase, alphanumeric only)
    for (const show of allShows) {
      if (show.djUsername && (show.djPhotoUrl || show.djLocation || show.djGenres)) {
        const key = show.djUsername; // Already normalized from metadata
        if (!newProfiles.has(key)) {
          newProfiles.set(key, {
            username: show.dj || show.djUsername, // Display name from enriched show data
            photoUrl: show.djPhotoUrl,
            location: show.djLocation,
            genres: show.djGenres,
          });
        }
      }
    }

    // Step 2: Find watchlist items and favorites that need Firebase lookup
    const itemsToLookup: string[] = [];

    // Watchlist items
    for (const item of watchlist) {
      const normalized = normalizeForLookup(item.term);
      if (!newProfiles.has(normalized)) {
        itemsToLookup.push(normalized);
      }
    }

    // Returning soon and one-time favorites (past shows not in current schedule)
    // Use djUsername for Firebase lookup (matches chatUsernameNormalized)
    for (const item of [...categorizedShows.returningSoon, ...categorizedShows.oneTime]) {
      const name = item.djUsername || item.djName || item.term;
      const normalized = name.replace(/[\s-]+/g, "").toLowerCase();
      if (!newProfiles.has(normalized)) {
        itemsToLookup.push(normalized);
      }
    }

    // Step 3: Fetch missing profiles from Firebase
    // Same lookup pattern as /dj/[username] page
    async function fetchMissingProfiles() {
      if (!db || itemsToLookup.length === 0) {
        if (newProfiles.size > 0) {
          setDJProfiles(newProfiles);
        }
        return;
      }

      for (const normalized of itemsToLookup) {
        try {
          // Try pending-dj-profiles first (has public read)
          const pendingRef = collection(db, "pending-dj-profiles");
          const pendingQ = query(
            pendingRef,
            where("chatUsernameNormalized", "==", normalized)
          );
          const pendingSnapshot = await getDocs(pendingQ);

          if (!pendingSnapshot.empty) {
            const data = pendingSnapshot.docs[0].data();
            newProfiles.set(normalized, {
              username: data.chatUsername || data.djName || normalized,
              photoUrl: data.djProfile?.photoUrl || undefined,
              location: data.djProfile?.location || undefined,
              genres: data.djProfile?.genres || undefined,
            });
            continue;
          }

          // Fall back to users collection
          const usersRef = collection(db, "users");
          const usersQ = query(
            usersRef,
            where("chatUsernameNormalized", "==", normalized)
          );
          const usersSnapshot = await getDocs(usersQ);

          if (!usersSnapshot.empty) {
            const data = usersSnapshot.docs[0].data();
            newProfiles.set(normalized, {
              username: data.chatUsername || data.displayName || normalized,
              photoUrl: data.djProfile?.photoUrl || undefined,
              location: data.djProfile?.location || undefined,
              genres: data.djProfile?.genres || undefined,
            });
          }
        } catch {
          // Silently ignore lookup errors
        }
      }

      setDJProfiles(new Map(newProfiles));
    }

    fetchMissingProfiles();
  }, [allShows, watchlist, categorizedShows.returningSoon, categorizedShows.oneTime]);

  // Create unified upcoming shows list (online + IRL)
  const upcomingShows = useMemo(() => {
    const items: UpcomingShowItem[] = [];

    // Add live online shows
    for (const { favorite, show } of categorizedShows.liveNow) {
      // Look up DJ profile if show doesn't have profile data
      const djName = show.dj || favorite.djName || favorite.showName || favorite.term;
      const djProfile = show.dj ? djProfiles.get(normalizeForLookup(show.dj)) : undefined;
      // Only use DJ profile photos (not show.imageUrl which is a show cover, not a DJ photo)
      const djPhotoUrl = show.djPhotoUrl || djProfile?.photoUrl;
      const djUsername = show.djUsername || djProfile?.username;

      items.push({
        id: `online-live-${favorite.id}`,
        type: 'online',
        sortTime: new Date(show.startTime),
        isLive: true,
        djName,
        djPhotoUrl,
        djUsername,
        djGenres: show.djGenres || djProfile?.genres,
        favorite,
        show,
        stationId: show.stationId,
      });
    }

    // Add coming up online shows
    for (const { favorite, show } of categorizedShows.comingUp) {
      // Look up DJ profile if show doesn't have profile data
      const djName = show.dj || favorite.djName || favorite.showName || favorite.term;
      const djProfile = show.dj ? djProfiles.get(normalizeForLookup(show.dj)) : undefined;
      // Only use DJ profile photos (not show.imageUrl which is a show cover, not a DJ photo)
      const djPhotoUrl = show.djPhotoUrl || djProfile?.photoUrl;
      const djUsername = show.djUsername || djProfile?.username;

      items.push({
        id: `online-upcoming-${favorite.id}`,
        type: 'online',
        sortTime: new Date(show.startTime),
        isLive: false,
        djName,
        djPhotoUrl,
        djUsername,
        djGenres: show.djGenres || djProfile?.genres,
        favorite,
        show,
        stationId: show.stationId,
      });
    }

    // Add IRL events from favorites
    for (const irlFavorite of irlEvents) {
      items.push({
        id: `irl-${irlFavorite.id}`,
        type: 'irl',
        sortTime: new Date(irlFavorite.irlDate + 'T00:00:00'),
        isLive: false,
        djName: irlFavorite.djName || irlFavorite.term,
        djPhotoUrl: irlFavorite.djPhotoUrl,
        djUsername: irlFavorite.djUsername,
        djGenres: undefined,
        irlFavorite,
      });
    }

    // Add IRL events from watchlisted DJs (from API, not yet saved as favorites)
    // This ensures new IRL shows from favorite DJs appear even if added after subscribing
    const irlFavoriteKeys = new Set(
      irlEvents.map((f) => `${f.djUsername}-${f.irlDate}-${f.irlLocation}`.toLowerCase())
    );
    const watchlistTerms = watchlist.map((w) => w.term);

    for (const irlShow of allIRLShows) {
      // Check if this DJ is in the watchlist (word boundary match)
      const isWatchlisted = watchlistTerms.some(
        (term) => wordBoundaryMatch(irlShow.djName, term) || wordBoundaryMatch(irlShow.djUsername, term)
      );

      if (!isWatchlisted) continue;

      // Skip if already in favorites (to avoid duplicates)
      const key = `${irlShow.djUsername}-${irlShow.date}-${irlShow.location}`.toLowerCase();
      if (irlFavoriteKeys.has(key)) continue;

      items.push({
        id: `irl-api-${irlShow.djUsername}-${irlShow.date}-${irlShow.location}`,
        type: 'irl',
        sortTime: new Date(irlShow.date + 'T00:00:00'),
        isLive: false,
        djName: irlShow.djName,
        djPhotoUrl: irlShow.djPhotoUrl,
        djUsername: irlShow.djUsername,
        djGenres: irlShow.djGenres,
        // Create a synthetic irlFavorite for the card to use
        irlFavorite: {
          id: `api-${irlShow.djUsername}-${irlShow.date}`,
          term: irlShow.djName.toLowerCase(),
          type: 'irl',
          djName: irlShow.djName,
          djUsername: irlShow.djUsername,
          djPhotoUrl: irlShow.djPhotoUrl,
          irlEventName: irlShow.eventName,
          irlLocation: irlShow.location,
          irlDate: irlShow.date,
          irlTicketUrl: irlShow.ticketUrl,
          createdAt: new Date(),
          createdBy: 'web',
        },
      });
    }

    // Sort: live shows first, then by time
    return items.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return a.sortTime.getTime() - b.sortTime.getTime();
    });
  }, [categorizedShows, irlEvents, djProfiles, watchlist, allIRLShows]);

  const handleRemove = async (favorite: Favorite) => {
    setRemoving(favorite.id);
    const mockShow = {
      id: favorite.id,
      name: favorite.showName || favorite.term,
      dj: favorite.djName,
      stationId: favorite.stationId || "",
      startTime: "",
      endTime: "",
    };
    await removeFavorite(mockShow);
    setRemoving(null);
  };

  if (authLoading || favoritesLoading) {
    return (
      <div className="min-h-[100dvh] text-white relative flex flex-col">
        <AnimatedBackground />
        <Header currentPage="my-shows" position="sticky" showSearch />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="my-shows" position="sticky" showSearch />

      <main className="flex-1 min-h-0 px-8 lg:px-16 py-6 pb-20 overflow-y-auto">
        {!isAuthenticated ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">Sign in to see your saved shows</p>
          </div>
        ) : favorites.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No saved shows yet</p>
          </div>
        ) : showsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-10">
            {/* Section 1: Upcoming Shows (IRL + Online combined) */}
            {upcomingShows.length > 0 && (
              <section>
                <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Upcoming Shows ({upcomingShows.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {upcomingShows.map((item) => {
                    const station = item.stationId ? getStation(item.stationId) : undefined;
                    const accentColor = station?.accentColor || "#22c55e"; // Green for IRL

                    if (item.type === 'irl' && item.irlFavorite) {
                      return (
                        <MyShowsCard
                          key={item.id}
                          showType="irl"
                          djName={item.djName}
                          djPhotoUrl={item.djPhotoUrl}
                          djUsername={item.djUsername}
                          accentColor={accentColor}
                          isLive={false}
                          eventName={item.irlFavorite.irlEventName || item.irlFavorite.showName}
                          eventLocation={item.irlFavorite.irlLocation}
                          eventDate={item.irlFavorite.irlDate}
                          ticketUrl={item.irlFavorite.irlTicketUrl}
                          onRemove={() => handleRemove(item.irlFavorite!)}
                          isRemoving={removing === item.irlFavorite.id}
                        />
                      );
                    }

                    if (item.type === 'online' && item.favorite && item.show) {
                      return (
                        <MyShowsCard
                          key={item.id}
                          showType="online"
                          djName={item.djName}
                          djPhotoUrl={item.djPhotoUrl}
                          djUsername={item.djUsername}
                          accentColor={accentColor}
                          isLive={item.isLive}
                          showName={item.show.name}
                          stationName={station?.name || item.stationId}
                          startTime={item.show.startTime}
                          djGenres={item.djGenres}
                          onRemove={() => handleRemove(item.favorite!)}
                          isRemoving={removing === item.favorite.id}
                        />
                      );
                    }

                    return null;
                  })}
                </div>
              </section>
            )}

            {/* Section 2: DJs on Watchlist */}
            {watchlist.length > 0 && (
              <section>
                <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  DJs on Watchlist ({watchlist.length})
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {watchlist.map((favorite) => {
                    const djProfile = djProfiles.get(normalizeForLookup(favorite.term));
                    const displayName = djProfile?.username || favorite.term.charAt(0).toUpperCase() + favorite.term.slice(1);
                    // For navigation: use normalized term (matches chatUsernameNormalized / DJ profile URL)
                    const normalizedTerm = favorite.term.replace(/[\s-]+/g, "").toLowerCase();
                    const djUsername = normalizedTerm;

                    return (
                      <WatchlistDJCard
                        key={favorite.id}
                        djName={displayName}
                        djPhotoUrl={djProfile?.photoUrl}
                        djUsername={djUsername}
                        djLocation={djProfile?.location}
                        djGenres={djProfile?.genres}
                        onRemove={() => handleRemove(favorite)}
                        isRemoving={removing === favorite.id}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Section 3: Show History */}
            {(categorizedShows.returningSoon.length > 0 || categorizedShows.oneTime.length > 0) && (
              <section>
                <h2 className="text-white text-sm font-medium border-b border-gray-800 pb-2 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Show History
                </h2>

                {/* Coming Back Soon */}
                {categorizedShows.returningSoon.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                      Coming Back Soon ({categorizedShows.returningSoon.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {categorizedShows.returningSoon.map((favorite) => {
                        const station = getStation(favorite.stationId);
                        const accentColor = station?.accentColor || "#fff";
                        // Look up DJ profile from cache
                        const djName = favorite.djName || favorite.term;
                        const djProfile = findDJProfile(favorite, djProfiles);

                        return (
                          <MyShowsCard
                            key={favorite.id}
                            showType="online"
                            djName={djName}
                            djPhotoUrl={favorite.djPhotoUrl || djProfile?.photoUrl}
                            djUsername={favorite.djUsername || djProfile?.username}
                            accentColor={accentColor}
                            isLive={false}
                            showName={favorite.showName || favorite.term}
                            stationName={station?.name || favorite.stationId}
                            onRemove={() => handleRemove(favorite)}
                            isRemoving={removing === favorite.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* One-Time Events */}
                {categorizedShows.oneTime.length > 0 && (
                  <div>
                    <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                      One-Time Events ({categorizedShows.oneTime.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {categorizedShows.oneTime.map((favorite) => {
                        const station = getStation(favorite.stationId);
                        const accentColor = station?.accentColor || "#fff";
                        // Look up DJ profile from cache
                        const djName = favorite.djName || favorite.term;
                        const djProfile = findDJProfile(favorite, djProfiles);

                        return (
                          <MyShowsCard
                            key={favorite.id}
                            showType="online"
                            djName={djName}
                            djPhotoUrl={favorite.djPhotoUrl || djProfile?.photoUrl}
                            djUsername={favorite.djUsername || djProfile?.username}
                            accentColor={accentColor}
                            isLive={false}
                            showName={favorite.showName || favorite.term}
                            stationName={station?.name || favorite.stationId}
                            onRemove={() => handleRemove(favorite)}
                            isRemoving={removing === favorite.id}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Empty state */}
            {upcomingShows.length === 0 &&
              watchlist.length === 0 &&
              categorizedShows.returningSoon.length === 0 &&
              categorizedShows.oneTime.length === 0 && (
              <p className="text-gray-600 text-sm py-4 text-center">No saved shows yet.</p>
            )}
          </div>
        )}
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
