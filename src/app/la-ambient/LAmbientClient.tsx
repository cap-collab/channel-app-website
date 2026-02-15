'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { AuthModal } from '@/components/AuthModal';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { useFavorites } from '@/hooks/useFavorites';
import { Show, IRLShowData } from '@/types';
import { Venue, Event, EventDJRef, Collective } from '@/types/events';
import { matchesGenre } from '@/lib/genres';
import { matchesCity } from '@/lib/city-detection';
import { getStationById, getStationLogoUrl } from '@/lib/stations';

// ---------- Types ----------

interface SelectorProfile {
  username: string;
  displayName: string;
  photoUrl?: string;
  location?: string;
  genres?: string[];
  bio?: string;
  hasRadio?: boolean;
}

// ---------- Helpers ----------

function matchesAmbient(genres: string[] | undefined): boolean {
  if (!genres || genres.length === 0) return false;
  return genres.some(g => matchesGenre([g], 'Ambient'));
}

function formatEventDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------- Component ----------

export function LAmbientClient() {
  const [selectors, setSelectors] = useState<SelectorProfile[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [collectives, setCollectives] = useState<Collective[]>([]);
  const [onlineShows, setOnlineShows] = useState<Show[]>([]);
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [pastEvents, setPastEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth & favorites
  const { isAuthenticated } = useAuthContext();
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

  // Past shows from history.json
  const [pastHistoryShows, setPastHistoryShows] = useState<Show[]>([]);

  // Follow handler for online shows
  const handleFollow = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      setAuthModalMessage(`Sign in to follow ${show.dj || show.name}`);
      setShowAuthModal(true);
      return;
    }
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
  }, [isAuthenticated, isInWatchlist, removeFromWatchlist, followDJ]);

  // Remind Me handler for online shows
  const handleRemindMe = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      setAuthModalMessage(`Sign in to get notified when ${show.dj || show.name} goes live`);
      setShowAuthModal(true);
      return;
    }
    setAddingReminderShowId(show.id);
    try {
      if (!isShowFavorited(show)) {
        await toggleFavorite(show);
      }
    } finally {
      setAddingReminderShowId(null);
    }
  }, [isAuthenticated, isShowFavorited, toggleFavorite]);

  // Follow handler for selectors
  const handleFollowSelector = useCallback(async (displayName: string) => {
    if (!isAuthenticated) {
      setAuthModalMessage(`Sign in to follow ${displayName}`);
      setShowAuthModal(true);
      return;
    }
    setAddingFollowDj(displayName);
    try {
      if (isInWatchlist(displayName)) {
        await removeFromWatchlist(displayName);
      } else {
        await followDJ(displayName);
      }
    } finally {
      setAddingFollowDj(null);
    }
  }, [isAuthenticated, isInWatchlist, removeFromWatchlist, followDJ]);

  useEffect(() => {
    async function fetchAll() {
      const results = await Promise.allSettled([
        fetchSelectors(),
        fetchVenues(),
        fetchCollectives(),
        fetchEvents(),
        fetchSchedule(),
      ]);

      if (results[0].status === 'fulfilled') setSelectors(results[0].value);
      if (results[1].status === 'fulfilled') setVenues(results[1].value);
      if (results[2].status === 'fulfilled') setCollectives(results[2].value);
      if (results[3].status === 'fulfilled') {
        setEvents(results[3].value.upcoming);
        setPastEvents(results[3].value.past);
      }
      if (results[4].status === 'fulfilled') {
        setOnlineShows(results[4].value.shows);
        setIrlShows(results[4].value.irlShows);
      }

      setLoading(false);
    }

    fetchAll();
  }, []);

  // Fetch past shows from history.json once selectors are loaded
  useEffect(() => {
    async function fetchPastHistory() {
      if (selectors.length === 0) return;

      const djUsernames = selectors.map(s => s.username).join(',');
      try {
        const res = await fetch(`/api/past-shows?djs=${djUsernames}`);
        if (!res.ok) return;

        const data = await res.json();
        // Build a lookup from normalized username to selector profile
        const selectorMap = new Map<string, SelectorProfile>();
        for (const s of selectors) {
          selectorMap.set(s.username, s);
        }

        const shows: Show[] = (data.shows || []).map(
          (show: { id: string; showName: string; startTime: string; endTime: string; stationId: string; showType?: string }) => {
            // Find which selector this show matched via the p field
            // The API filters by p, and stationId comes back resolved
            // We need to find the DJ — try matching show name against selectors
            let matchedSelector: SelectorProfile | undefined;
            for (const s of selectors) {
              if (show.showName.toLowerCase().includes(s.displayName.toLowerCase())) {
                matchedSelector = s;
                break;
              }
            }

            return {
              id: show.id,
              name: show.showName,
              startTime: show.startTime,
              endTime: show.endTime,
              stationId: show.stationId,
              dj: matchedSelector?.displayName,
              djUsername: matchedSelector?.username,
              djPhotoUrl: matchedSelector?.photoUrl,
              type: show.showType,
            } as Show;
          }
        );

        setPastHistoryShows(shows);
      } catch (err) {
        console.error('[la-ambient] Error fetching past history shows:', err);
      }
    }

    fetchPastHistory();
  }, [selectors]);

  // Split online shows into upcoming vs past
  const now = Date.now();
  const upcomingShows = onlineShows.filter(s => new Date(s.endTime || s.startTime).getTime() >= now);
  const schedulePastShows = onlineShows.filter(s => new Date(s.endTime || s.startTime).getTime() < now);

  // Merge schedule past shows with history past shows, deduplicating by ID
  const pastShows = useMemo(() => {
    const seen = new Set<string>();
    const merged: Show[] = [];
    // Schedule shows take priority (have richer data like djLocation, djGenres)
    for (const show of schedulePastShows) {
      seen.add(show.id);
      merged.push(show);
    }
    for (const show of pastHistoryShows) {
      if (!seen.has(show.id)) {
        merged.push(show);
      }
    }
    // Sort by start time descending (newest first)
    merged.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    return merged;
  }, [schedulePastShows, pastHistoryShows]);

  // Build venue slug lookup from fetched venues
  const venueSlugMap = new Map<string, string>();
  for (const v of venues) {
    if (v.id && v.slug) venueSlugMap.set(v.id, v.slug);
  }

  return (
    <div className="min-h-screen text-white relative">
      <AnimatedBackground />
      <Header position="sticky" />

      <main className="max-w-5xl mx-auto px-6 py-4 pb-24">
        {/* Page Header */}
        <section className="mb-10">
          <h1 className="text-xl sm:text-3xl md:text-5xl font-light tracking-tighter leading-none whitespace-nowrap">
            LA SCENE — AMBIENT x TECHNO
          </h1>
          <p className="text-zinc-400 text-base font-light max-w-xl mt-2">
            A map of the selectors and spaces shaping LA&apos;s ambient x techno scene.
          </p>
        </section>

        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            <SelectorsSection
              selectors={selectors}
              isInWatchlist={isInWatchlist}
              addingFollowDj={addingFollowDj}
              onFollow={handleFollowSelector}
            />
            <VenuesSection venues={venues} />
            <CollectivesSection collectives={collectives} />
            <OnlineShowsSection
              shows={upcomingShows}
              isInWatchlist={isInWatchlist}
              isShowFavorited={isShowFavorited}
              addingFollowDj={addingFollowDj}
              addingReminderShowId={addingReminderShowId}
              onFollow={handleFollow}
              onRemindMe={handleRemindMe}
            />
            <UpcomingDatesSection irlShows={irlShows} events={events} venueSlugMap={venueSlugMap} venues={venues} />
            <PastShowsSection
              shows={pastShows}
              pastEvents={pastEvents}
              venueSlugMap={venueSlugMap}
              venues={venues}
            />
          </>
        )}
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setAuthModalMessage(undefined);
        }}
        message={authModalMessage}
      />
    </div>
  );
}

// ---------- Section 1: Core Selectors ----------

interface SelectorsSectionProps {
  selectors: SelectorProfile[];
  isInWatchlist: (term: string) => boolean;
  addingFollowDj: string | null;
  onFollow: (displayName: string) => void;
}

function SelectorsSection({ selectors, isInWatchlist, addingFollowDj, onFollow }: SelectorsSectionProps) {
  if (selectors.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Core Selectors
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {selectors.slice(0, 10).map((sel) => (
          <SelectorCard
            key={sel.username}
            selector={sel}
            isFollowing={isInWatchlist(sel.displayName)}
            isAddingFollow={addingFollowDj === sel.displayName}
            onFollow={() => onFollow(sel.displayName)}
          />
        ))}
      </div>
    </section>
  );
}

function SelectorCard({
  selector,
  isFollowing,
  isAddingFollow,
  onFollow,
}: {
  selector: SelectorProfile;
  isFollowing: boolean;
  isAddingFollow: boolean;
  onFollow: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = selector.photoUrl && !imageError;

  return (
    <div className="flex flex-col">
      {/* 16:9 image with overlays */}
      <div className="relative">
        <Link href={`/dj/${selector.username}`} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
          {hasPhoto ? (
            <>
              <Image
                src={selector.photoUrl!}
                alt={selector.displayName}
                fill
                className="object-cover"
                unoptimized
                onError={() => setImageError(true)}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900">
              <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
                {selector.displayName}
              </h2>
            </div>
          )}
          {/* Bottom: name + location */}
          <div className="absolute bottom-2 left-2 right-2">
            <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
              {selector.displayName}
            </span>
            <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
              Los Angeles
            </span>
          </div>
        </Link>
      </div>

      {/* Follow + View Profile buttons */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onFollow}
          disabled={isAddingFollow}
          className={`flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors ${
            isFollowing ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white hover:bg-gray-100 text-gray-900'
          } disabled:opacity-50`}
        >
          {isAddingFollow ? (
            <div className={`w-4 h-4 border-2 ${isFollowing ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin mx-auto`} />
          ) : isFollowing ? 'Following' : '+ Follow'}
        </button>
        <Link
          href={`/dj/${selector.username}`}
          className="flex-1 py-2 px-4 rounded text-sm font-semibold text-center transition-colors bg-white/10 hover:bg-white/20 text-white"
        >
          View Profile
        </Link>
      </div>
    </div>
  );
}

// ---------- Section 2: Collectives ----------

function CollectivesSection({ collectives }: { collectives: Collective[] }) {
  if (collectives.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Collectives
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {collectives.map((collective) => (
          <CollectiveCard key={collective.id} collective={collective} />
        ))}
      </div>
    </section>
  );
}

function CollectiveCard({ collective }: { collective: Collective }) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = collective.photo && !imageError;

  const thumbnail = hasPhoto ? (
    <Image
      src={collective.photo!}
      alt={collective.name}
      width={64}
      height={64}
      className="w-16 h-16 rounded-lg object-cover"
      unoptimized
      onError={() => setImageError(true)}
    />
  ) : (
    <div className="w-16 h-16 rounded-lg bg-white flex items-center justify-center">
      <span className="text-2xl font-black text-black">{collective.name.charAt(0).toUpperCase()}</span>
    </div>
  );

  const content = (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          {thumbnail}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium">{collective.name}</p>
          {collective.location && (
            <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
              {collective.location}
            </p>
          )}
          {collective.genres && collective.genres.length > 0 && (
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mt-1">
              {collective.genres.join(' · ')}
            </p>
          )}
          {collective.residentDJs && collective.residentDJs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {collective.residentDJs
                .filter((dj: EventDJRef) => dj.djName)
                .map((dj: EventDJRef, i: number) =>
                  dj.djUsername ? (
                    <Link
                      key={i}
                      href={`/dj/${dj.djUsername}`}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {dj.djName}
                      {i < (collective.residentDJs?.length ?? 0) - 1 ? ',' : ''}
                    </Link>
                  ) : (
                    <span key={i} className="text-xs text-zinc-400">
                      {dj.djName}
                      {i < (collective.residentDJs?.length ?? 0) - 1 ? ',' : ''}
                    </span>
                  )
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (collective.slug) {
    return <Link href={`/collective/${collective.slug}`}>{content}</Link>;
  }
  return content;
}

// ---------- Section 3: Anchor Venues ----------

function VenuesSection({ venues }: { venues: Venue[] }) {
  if (venues.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Anchor Venues
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {venues.map((venue) => (
          <VenueCard key={venue.id} venue={venue} />
        ))}
      </div>
    </section>
  );
}

function VenueCard({ venue }: { venue: Venue }) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = venue.photo && !imageError;

  const thumbnail = hasPhoto ? (
    <Image
      src={venue.photo!}
      alt={venue.name}
      width={64}
      height={64}
      className="w-16 h-16 rounded-lg object-cover"
      unoptimized
      onError={() => setImageError(true)}
    />
  ) : (
    <div className="w-16 h-16 rounded-lg bg-white flex items-center justify-center">
      <span className="text-2xl font-black text-black">{venue.name.charAt(0).toUpperCase()}</span>
    </div>
  );

  const content = (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          {thumbnail}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium">{venue.name}</p>
          {venue.location && (
            <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
              {venue.location}
            </p>
          )}
          {venue.genres && venue.genres.length > 0 && (
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mt-1">
              {venue.genres.join(' · ')}
            </p>
          )}
          {venue.residentDJs && venue.residentDJs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {venue.residentDJs
                .filter((dj: EventDJRef) => dj.djName)
                .map((dj: EventDJRef, i: number) =>
                  dj.djUsername ? (
                    <Link
                      key={i}
                      href={`/dj/${dj.djUsername}`}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {dj.djName}
                      {i < (venue.residentDJs?.length ?? 0) - 1 ? ',' : ''}
                    </Link>
                  ) : (
                    <span key={i} className="text-xs text-zinc-400">
                      {dj.djName}
                      {i < (venue.residentDJs?.length ?? 0) - 1 ? ',' : ''}
                    </span>
                  )
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (venue.slug) {
    return <Link href={`/venue/${venue.slug}`}>{content}</Link>;
  }
  return content;
}

// ---------- Section 3: Online Radio Shows ----------

interface ShowsSectionProps {
  shows: Show[];
  isInWatchlist: (term: string) => boolean;
  isShowFavorited: (show: Show) => boolean;
  addingFollowDj: string | null;
  addingReminderShowId: string | null;
  onFollow: (show: Show) => void;
  onRemindMe: (show: Show) => void;
}

function OnlineShowsSection(props: ShowsSectionProps) {
  if (props.shows.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Online Shows
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {props.shows.map((show) => (
          <ShowCard key={show.id} show={show} {...props} />
        ))}
      </div>
    </section>
  );
}

function ShowCard({
  show,
  isInWatchlist,
  isShowFavorited,
  addingFollowDj,
  addingReminderShowId,
  onFollow,
  onRemindMe,
}: { show: Show } & ShowsSectionProps) {
  const [imageError, setImageError] = useState(false);
  const station = getStationById(show.stationId);
  const djName = show.dj || show.name;
  const photoUrl = show.djPhotoUrl || show.imageUrl;
  const hasPhoto = photoUrl && !imageError;
  const stationLogo = station ? getStationLogoUrl(station.id) : undefined;
  const following = show.dj ? isInWatchlist(show.dj) : false;
  const favorited = isShowFavorited(show);
  const addingFollow = show.dj ? addingFollowDj === show.dj : false;
  const addingReminder = addingReminderShowId === show.id;

  return (
    <div className="flex flex-col">
      {/* Image with overlays */}
      <div className="relative">
        {show.djUsername ? (
          <Link href={`/dj/${show.djUsername}`} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image src={photoUrl} alt={djName} fill className="object-cover" unoptimized onError={() => setImageError(true)} />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: station?.accentColor || '#6B21A8' }}>
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">{djName}</h2>
              </div>
            )}
            {/* Top row: Online badge + date */}
            <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
              <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                </svg>
                Online
              </span>
              <span className="text-[10px] font-mono text-white uppercase tracking-tighter drop-shadow-lg">
                {new Date(show.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} &middot; {new Date(show.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
            {/* Bottom: DJ name */}
            <div className="absolute bottom-2 left-2 right-12">
              <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">{djName}</span>
            </div>
          </Link>
        ) : (
          <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image src={photoUrl} alt={djName} fill className="object-cover" unoptimized onError={() => setImageError(true)} />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: station?.accentColor || '#6B21A8' }}>
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">{djName}</h2>
              </div>
            )}
            <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
              <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                </svg>
                Online
              </span>
              <span className="text-[10px] font-mono text-white uppercase tracking-tighter drop-shadow-lg">
                {new Date(show.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} &middot; {new Date(show.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
            <div className="absolute bottom-2 left-2 right-12">
              <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">{djName}</span>
            </div>
          </div>
        )}
        {/* Station logo */}
        {stationLogo && (
          <div className="absolute -bottom-4 right-3 w-8 h-8 rounded border border-white/30 overflow-hidden bg-black z-10">
            <Image src={stationLogo} alt={station?.name || ''} fill className="object-contain" />
          </div>
        )}
      </div>

      {/* Show info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">{show.name}</Link>
          ) : (
            show.name
          )}
        </h3>
        {station && station.id !== 'broadcast' && station.id !== 'dj-radio' && (
          <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
            Selected by {station.name}
          </p>
        )}
      </div>

      {/* Follow + Remind Me buttons */}
      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => onFollow(show)}
          disabled={addingFollow}
          className={`flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors ${
            following ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white hover:bg-gray-100 text-gray-900'
          } disabled:opacity-50`}
        >
          {addingFollow ? (
            <div className={`w-4 h-4 border-2 ${following ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin mx-auto`} />
          ) : following ? 'Following' : '+ Follow'}
        </button>
        <button
          onClick={() => onRemindMe(show)}
          disabled={addingReminder || favorited}
          className={`flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors ${
            favorited ? 'bg-white/10 text-gray-400 cursor-default' : 'bg-white/10 hover:bg-white/20 text-white'
          } disabled:opacity-50`}
        >
          {addingReminder ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : favorited ? 'Reminded' : 'Remind Me'}
        </button>
      </div>
    </div>
  );
}

// ---------- Section 4: Upcoming LA Dates ----------

interface UpcomingItem {
  type: 'irl' | 'event';
  date: number; // ms timestamp for sorting
  key: string;
}

interface IRLItem extends UpcomingItem {
  type: 'irl';
  data: IRLShowData;
}

interface EventItem extends UpcomingItem {
  type: 'event';
  data: Event;
}

type UpcomingEntry = IRLItem | EventItem;

function UpcomingDatesSection({
  irlShows,
  events,
  venueSlugMap,
  venues,
}: {
  irlShows: IRLShowData[];
  events: Event[];
  venueSlugMap: Map<string, string>;
  venues: Venue[];
}) {
  // Build venue photo lookup
  const venuePhotoMap = new Map<string, string>();
  for (const v of venues) {
    if (v.id && v.photo) venuePhotoMap.set(v.id, v.photo);
  }

  // Merge and sort all upcoming items by date
  const items: UpcomingEntry[] = [];

  for (const irl of irlShows) {
    items.push({
      type: 'irl',
      date: new Date(irl.date + 'T00:00:00').getTime(),
      key: `irl-${irl.djUsername}-${irl.date}`,
      data: irl,
    });
  }

  for (const evt of events) {
    items.push({
      type: 'event',
      date: evt.date,
      key: `event-${evt.id}`,
      data: evt,
    });
  }

  items.sort((a, b) => a.date - b.date);

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Upcoming IRL Events
      </h2>

      {items.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8">
          No upcoming IRL events currently listed.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) =>
            item.type === 'irl' ? (
              <IRLDateCard key={item.key} show={item.data} />
            ) : (
              <EventDateCard key={item.key} event={item.data} venueSlugMap={venueSlugMap} venuePhotoMap={venuePhotoMap} />
            )
          )}
        </div>
      )}
    </section>
  );
}

function IRLDateCard({ show }: { show: IRLShowData }) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = show.djPhotoUrl && !imageError;

  const djThumb = hasPhoto ? (
    <Image
      src={show.djPhotoUrl!}
      alt={show.djName}
      width={48}
      height={48}
      className="w-12 h-12 rounded-full object-cover"
      unoptimized
      onError={() => setImageError(true)}
    />
  ) : (
    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center">
      <span className="text-lg font-black text-black">{show.djName.charAt(0).toUpperCase()}</span>
    </div>
  );

  return (
    <div>
      {/* Date above card */}
      <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-1">
        {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}
      </p>
      <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            {show.djUsername ? (
              <Link href={`/dj/${show.djUsername}`}>{djThumb}</Link>
            ) : djThumb}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium">{show.eventName}</p>
            {show.location && (
              <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
                {show.location}
              </p>
            )}
            {show.djUsername && (
              <Link
                href={`/dj/${show.djUsername}`}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                {show.djName}
              </Link>
            )}
          </div>
        </div>
        {/* Tickets button below */}
        {show.ticketUrl && (
          <a
            href={show.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full mt-3 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white"
          >
            Tickets
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function DJAvatar({ dj }: { dj: EventDJRef }) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = dj.djPhotoUrl && !imageError;

  const avatar = hasPhoto ? (
    <Image
      src={dj.djPhotoUrl!}
      alt={dj.djName}
      width={28}
      height={28}
      className="w-7 h-7 rounded-full object-cover border-2 border-zinc-900"
      unoptimized
      onError={() => setImageError(true)}
    />
  ) : (
    <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center border-2 border-zinc-900">
      <span className="text-[10px] font-black text-black">{dj.djName.charAt(0).toUpperCase()}</span>
    </div>
  );

  if (dj.djUsername) {
    return <Link href={`/dj/${dj.djUsername}`}>{avatar}</Link>;
  }
  return avatar;
}

function EventDateCard({ event, venueSlugMap, venuePhotoMap }: { event: Event; venueSlugMap: Map<string, string>; venuePhotoMap: Map<string, string> }) {
  const venueSlug = event.venueId ? venueSlugMap.get(event.venueId) : undefined;
  const venuePhoto = event.venueId ? venuePhotoMap.get(event.venueId) : undefined;
  const firstDjPhoto = event.djs.find(dj => dj.djPhotoUrl)?.djPhotoUrl;
  const [venueImageError, setVenueImageError] = useState(false);
  // Fallback chain: event image > venue image > DJ image > none
  const displayPhoto = event.photo || venuePhoto || firstDjPhoto;
  const hasVenuePhoto = displayPhoto && !venueImageError;

  const venueThumb = hasVenuePhoto ? (
    <Image
      src={displayPhoto!}
      alt={event.venueName || event.name}
      width={48}
      height={48}
      className="w-12 h-12 rounded-lg object-cover"
      unoptimized
      onError={() => setVenueImageError(true)}
    />
  ) : (
    <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center">
      <span className="text-lg font-black text-black">{(event.venueName || event.name).charAt(0).toUpperCase()}</span>
    </div>
  );

  return (
    <div>
      {/* Date above card */}
      <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mb-1">
        {formatEventDate(event.date)}
      </p>
      <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-start gap-4">
          {/* Venue + DJ images */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {venueSlug ? (
              <Link href={`/venue/${venueSlug}`}>{venueThumb}</Link>
            ) : venueThumb}
            {event.djs.length > 0 && (
              <div className="flex -space-x-2">
                {event.djs.slice(0, 3).map((dj: EventDJRef, i: number) => (
                  <DJAvatar key={i} dj={dj} />
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium">{event.name}</p>
            <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
              {event.venueName && venueSlug ? (
                <Link href={`/venue/${venueSlug}`} className="hover:text-white transition-colors">
                  {event.venueName}
                </Link>
              ) : event.venueName ? (
                <>{event.venueName}</>
              ) : event.location ? (
                <>{event.location}</>
              ) : null}
            </p>
            {event.djs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {event.djs.map((dj: EventDJRef, i: number) =>
                  dj.djUsername ? (
                    <Link
                      key={i}
                      href={`/dj/${dj.djUsername}`}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      {dj.djName}
                      {i < event.djs.length - 1 ? ',' : ''}
                    </Link>
                  ) : (
                    <span key={i} className="text-xs text-zinc-400">
                      {dj.djName}
                      {i < event.djs.length - 1 ? ',' : ''}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        </div>
        {/* Tickets button below */}
        {event.ticketLink && (
          <a
            href={event.ticketLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full mt-3 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white"
          >
            Tickets
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

// ---------- Section 5: Past Shows & Events ----------

function PastShowsSection({
  shows,
  pastEvents,
  venueSlugMap,
  venues,
}: {
  shows: Show[];
  pastEvents: Event[];
  venueSlugMap: Map<string, string>;
  venues: Venue[];
}) {
  if (shows.length === 0 && pastEvents.length === 0) return null;

  // Build venue photo lookup
  const venuePhotoMap = new Map<string, string>();
  for (const v of venues) {
    if (v.id && v.photo) venuePhotoMap.set(v.id, v.photo);
  }

  // Sort past events newest first
  const sortedPastEvents = [...pastEvents].sort((a, b) => b.date - a.date);

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Past Shows & Events
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shows.map((show) => (
          <PastShowCard key={show.id} show={show} />
        ))}
        {sortedPastEvents.map((event) => (
          <PastEventCard key={event.id} event={event} venueSlugMap={venueSlugMap} venuePhotoMap={venuePhotoMap} />
        ))}
      </div>
    </section>
  );
}

function PastShowCard({ show }: { show: Show }) {
  const [imageError, setImageError] = useState(false);
  const station = getStationById(show.stationId);
  const djName = show.dj || show.name;
  const photoUrl = show.djPhotoUrl || show.imageUrl;
  const hasPhoto = photoUrl && !imageError;
  const stationLogo = station ? getStationLogoUrl(station.id) : undefined;

  const thumbnail = hasPhoto ? (
    <Image
      src={photoUrl}
      alt={djName}
      width={48}
      height={48}
      className="w-12 h-12 rounded-full object-cover"
      unoptimized
      onError={() => setImageError(true)}
    />
  ) : (
    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center">
      <span className="text-lg font-black text-black">{djName.charAt(0).toUpperCase()}</span>
    </div>
  );

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 relative">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`}>{thumbnail}</Link>
          ) : thumbnail}
          {stationLogo && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded border border-white/30 overflow-hidden bg-black">
              <Image src={stationLogo} alt={station?.name || ''} fill className="object-contain" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">
            {show.djUsername ? (
              <Link href={`/dj/${show.djUsername}`} className="hover:underline">{show.name}</Link>
            ) : show.name}
          </p>
          <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
            {new Date(show.startTime).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </p>
          {station && station.id !== 'broadcast' && station.id !== 'dj-radio' && (
            <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
              on {station.name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PastEventCard({ event, venueSlugMap, venuePhotoMap }: { event: Event; venueSlugMap: Map<string, string>; venuePhotoMap: Map<string, string> }) {
  const venueSlug = event.venueId ? venueSlugMap.get(event.venueId) : undefined;
  const venuePhoto = event.venueId ? venuePhotoMap.get(event.venueId) : undefined;
  const firstDjPhoto = event.djs.find(dj => dj.djPhotoUrl)?.djPhotoUrl;
  const [imageError, setImageError] = useState(false);
  // Fallback chain: event image > venue image > DJ image > none
  const displayPhoto = event.photo || venuePhoto || firstDjPhoto;
  const hasPhoto = displayPhoto && !imageError;

  const thumbnail = hasPhoto ? (
    <Image
      src={displayPhoto!}
      alt={event.name}
      width={48}
      height={48}
      className="w-12 h-12 rounded-lg object-cover"
      unoptimized
      onError={() => setImageError(true)}
    />
  ) : (
    <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center">
      <span className="text-lg font-black text-black">{event.name.charAt(0).toUpperCase()}</span>
    </div>
  );

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          {thumbnail}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">{event.name}</p>
          <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
            {new Date(event.date).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
            {event.venueName && venueSlug ? (
              <> · <Link href={`/venue/${venueSlug}`} className="hover:text-white transition-colors">{event.venueName}</Link></>
            ) : event.venueName ? (
              <> · {event.venueName}</>
            ) : null}
          </p>
          {event.djs.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {event.djs.map((dj: EventDJRef, i: number) =>
                dj.djUsername ? (
                  <Link
                    key={i}
                    href={`/dj/${dj.djUsername}`}
                    className="text-[11px] text-zinc-400 hover:text-white transition-colors"
                  >
                    {dj.djName}{i < event.djs.length - 1 ? ',' : ''}
                  </Link>
                ) : (
                  <span key={i} className="text-[11px] text-zinc-400">
                    {dj.djName}{i < event.djs.length - 1 ? ',' : ''}
                  </span>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Loading Skeleton ----------

function LoadingSkeleton() {
  return (
    <div className="space-y-10">
      {/* Selectors skeleton */}
      <div>
        <div className="h-3 w-28 bg-zinc-800 rounded mb-4 animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square bg-zinc-800 animate-pulse border border-white/10" />
              <div className="mt-2 space-y-1">
                <div className="h-4 w-24 bg-zinc-800 rounded animate-pulse" />
                <div className="h-2.5 w-20 bg-zinc-800 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Venues skeleton */}
      <div>
        <div className="h-3 w-24 bg-zinc-800 rounded mb-4 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-zinc-800 rounded-lg animate-pulse border border-white/10" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Data Fetching ----------

async function fetchSelectors(): Promise<SelectorProfile[]> {
  if (!db) return [];

  const profiles: SelectorProfile[] = [];
  const seenUsernames = new Set<string>();

  function processDoc(data: Record<string, unknown>) {
    const djProfile = data?.djProfile as Record<string, unknown> | undefined;
    const username = data?.chatUsername as string | undefined;
    if (!username || !djProfile) return;

    const location = (djProfile.location as string) || '';
    if (!matchesCity(location, 'Los Angeles')) return;

    const genres: string[] = (djProfile.genres as string[]) || [];
    if (!matchesAmbient(genres)) return;

    const normalized = username.replace(/\s+/g, '').toLowerCase();
    if (seenUsernames.has(normalized)) return;
    seenUsernames.add(normalized);

    profiles.push({
      username: normalized,
      displayName: username,
      photoUrl: (djProfile.photoUrl as string) || undefined,
      location: location || undefined,
      genres,
      bio: (djProfile.bio as string) || undefined,
    });
  }

  // Query users collection — fetch all DJs, filter client-side
  try {
    const usersQ = query(
      collection(db, 'users'),
      where('role', 'in', ['dj', 'broadcaster', 'admin'])
    );
    const usersSnapshot = await getDocs(usersQ);
    usersSnapshot.forEach((doc) => processDoc(doc.data()));
  } catch (err) {
    console.error('[la-ambient] Error fetching users:', err);
  }

  // Query pending-dj-profiles collection — fetch all, filter client-side
  try {
    const pendingSnapshot = await getDocs(collection(db, 'pending-dj-profiles'));
    pendingSnapshot.forEach((doc) => processDoc(doc.data()));
  } catch (err) {
    console.error('[la-ambient] Error fetching pending profiles:', err);
  }

  return profiles;
}

async function fetchVenues(): Promise<Venue[]> {
  if (!db) return [];

  try {
    // Fetch all venues, filter by LA location + ambient genres client-side
    const snapshot = await getDocs(collection(db, 'venues'));

    const results: Venue[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const location = data.location || '';
      if (!matchesCity(location, 'Los Angeles')) return;

      const genres: string[] = data.genres || [];
      if (!matchesAmbient(genres)) return;

      results.push({
        id: doc.id,
        name: data.name,
        slug: data.slug,
        photo: data.photo || null,
        location: data.location || null,
        description: data.description || null,
        genres,
        socialLinks: data.socialLinks || {},
        residentDJs: data.residentDJs || [],
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
        createdBy: data.createdBy,
      });
    });

    return results;
  } catch (err) {
    console.error('[la-ambient] Error fetching venues:', err);
    return [];
  }
}

async function fetchEvents(): Promise<{ upcoming: Event[]; past: Event[] }> {
  if (!db) return { upcoming: [], past: [] };

  try {
    const now = Date.now();
    // Fetch all events, filter client-side for location + genre
    const snapshot = await getDocs(collection(db, 'events'));

    const upcoming: Event[] = [];
    const past: Event[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.date) return;

      const location = data.location || '';
      if (!matchesCity(location, 'Los Angeles')) return;

      const genres: string[] = data.genres || [];
      if (!matchesAmbient(genres)) return;

      const event: Event = {
        id: doc.id,
        name: data.name,
        slug: data.slug,
        date: data.date,
        endDate: data.endDate || undefined,
        photo: data.photo || null,
        description: data.description || null,
        venueId: data.venueId || null,
        venueName: data.venueName || null,
        collectiveId: data.collectiveId || null,
        collectiveName: data.collectiveName || null,
        djs: data.djs || [],
        genres,
        location: data.location || null,
        ticketLink: data.ticketLink || null,
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
        createdBy: data.createdBy,
      };

      if (data.date >= now) {
        upcoming.push(event);
      } else {
        past.push(event);
      }
    });

    upcoming.sort((a, b) => a.date - b.date);
    past.sort((a, b) => b.date - a.date);
    return { upcoming, past };
  } catch (err) {
    console.error('[la-ambient] Error fetching events:', err);
    return { upcoming: [], past: [] };
  }
}

async function fetchCollectives(): Promise<Collective[]> {
  if (!db) return [];

  try {
    const snapshot = await getDocs(collection(db, 'collectives'));

    const results: Collective[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const location = data.location || '';
      if (!matchesCity(location, 'Los Angeles')) return;

      const genres: string[] = data.genres || [];
      if (!matchesAmbient(genres)) return;

      results.push({
        id: doc.id,
        name: data.name,
        slug: data.slug,
        photo: data.photo || null,
        location: data.location || null,
        description: data.description || null,
        genres,
        socialLinks: data.socialLinks || {},
        residentDJs: data.residentDJs || [],
        linkedVenues: data.linkedVenues || [],
        linkedCollectives: data.linkedCollectives || [],
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
        createdBy: data.createdBy,
      });
    });

    return results;
  } catch (err) {
    console.error('[la-ambient] Error fetching collectives:', err);
    return [];
  }
}

async function fetchSchedule(): Promise<{
  shows: Show[];
  irlShows: IRLShowData[];
}> {
  try {
    const res = await fetch('/api/schedule');
    if (!res.ok) return { shows: [], irlShows: [] };

    const data = await res.json();
    const allShows: Show[] = data.shows || [];
    const allIrl: IRLShowData[] = data.irlShows || [];

    // Filter online shows: DJ in LA + ambient genres
    const laOnlineShows = allShows.filter(
      (s) =>
        matchesCity(s.djLocation || '', 'Los Angeles') &&
        matchesAmbient(s.djGenres)
    );

    // Filter IRL shows: event in LA + ambient genres
    const laIrlShows = allIrl.filter(
      (s) =>
        matchesCity(s.location, 'Los Angeles') &&
        matchesAmbient(s.djGenres)
    );

    // Sort online shows by date ascending
    laOnlineShows.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    return { shows: laOnlineShows, irlShows: laIrlShows };
  } catch (err) {
    console.error('[la-ambient] Error fetching schedule:', err);
    return { shows: [], irlShows: [] };
  }
}
