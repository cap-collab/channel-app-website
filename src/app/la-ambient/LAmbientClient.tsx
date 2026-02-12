'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Venue, Event, EventDJRef } from '@/types/events';
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
  const [onlineShows, setOnlineShows] = useState<Show[]>([]);
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth & favorites
  const { isAuthenticated } = useAuthContext();
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited } = useFavorites();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>();
  const [addingFollowDj, setAddingFollowDj] = useState<string | null>(null);
  const [addingReminderShowId, setAddingReminderShowId] = useState<string | null>(null);

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

  useEffect(() => {
    async function fetchAll() {
      const results = await Promise.allSettled([
        fetchSelectors(),
        fetchVenues(),
        fetchEvents(),
        fetchSchedule(),
      ]);

      if (results[0].status === 'fulfilled') setSelectors(results[0].value);
      if (results[1].status === 'fulfilled') setVenues(results[1].value);
      if (results[2].status === 'fulfilled') setEvents(results[2].value);
      if (results[3].status === 'fulfilled') {
        setOnlineShows(results[3].value.shows);
        setIrlShows(results[3].value.irlShows);
      }

      setLoading(false);
    }

    fetchAll();
  }, []);

  // Split online shows into upcoming vs past
  const now = Date.now();
  const upcomingShows = onlineShows.filter(s => new Date(s.endTime || s.startTime).getTime() >= now);
  const pastShows = onlineShows.filter(s => new Date(s.endTime || s.startTime).getTime() < now);

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
          <h1 className="text-5xl sm:text-7xl font-black uppercase tracking-tighter leading-none">
            LA – Ambient
          </h1>
          <p className="text-zinc-400 text-base font-light max-w-xl mt-2">
            A map of the selectors and spaces shaping LA&apos;s ambient electronic scene.
          </p>
        </section>

        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            <SelectorsSection selectors={selectors} />
            <VenuesSection venues={venues} />
            <OnlineShowsSection
              shows={upcomingShows}
              isInWatchlist={isInWatchlist}
              isShowFavorited={isShowFavorited}
              addingFollowDj={addingFollowDj}
              addingReminderShowId={addingReminderShowId}
              onFollow={handleFollow}
              onRemindMe={handleRemindMe}
            />
            <UpcomingDatesSection irlShows={irlShows} events={events} venueSlugMap={venueSlugMap} />
            <PastShowsSection
              shows={pastShows}
              isInWatchlist={isInWatchlist}
              isShowFavorited={isShowFavorited}
              addingFollowDj={addingFollowDj}
              addingReminderShowId={addingReminderShowId}
              onFollow={handleFollow}
              onRemindMe={handleRemindMe}
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

function SelectorsSection({ selectors }: { selectors: SelectorProfile[] }) {
  if (selectors.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Core Selectors
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {selectors.slice(0, 10).map((sel) => (
          <SelectorCard key={sel.username} selector={sel} />
        ))}
      </div>
    </section>
  );
}

function SelectorCard({ selector }: { selector: SelectorProfile }) {
  const [imageError, setImageError] = useState(false);
  const hasPhoto = selector.photoUrl && !imageError;

  const content = (
    <div className="group">
      <div className="aspect-square overflow-hidden border border-white/10 relative">
        {hasPhoto ? (
          <Image
            src={selector.photoUrl!}
            alt={selector.displayName}
            fill
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900">
            <span className="text-2xl font-black uppercase tracking-tight text-white text-center px-4">
              {selector.displayName}
            </span>
          </div>
        )}
      </div>
      <div className="mt-2">
        <p className="text-sm font-bold text-white truncate">{selector.displayName}</p>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Based in Los Angeles</p>
        {selector.genres && selector.genres.length > 0 && (
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter mt-0.5">
            {selector.genres.join(' · ')}
          </p>
        )}
        {selector.hasRadio && (
          <span className="inline-block mt-1 bg-white/10 text-[9px] px-1.5 py-0.5 rounded-full font-mono uppercase text-zinc-400">
            Radio
          </span>
        )}
      </div>
    </div>
  );

  if (selector.username) {
    return <Link href={`/dj/${selector.username}`}>{content}</Link>;
  }
  return content;
}

// ---------- Section 2: Anchor Venues ----------

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
  const content = (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
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
        <div className="flex flex-wrap gap-1.5 mt-2">
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
}: {
  irlShows: IRLShowData[];
  events: Event[];
  venueSlugMap: Map<string, string>;
}) {
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
        Upcoming LA Dates
      </h2>

      {items.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8">
          No upcoming LA dates currently listed.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) =>
            item.type === 'irl' ? (
              <IRLDateCard key={item.key} show={item.data} />
            ) : (
              <EventDateCard key={item.key} event={item.data} venueSlugMap={venueSlugMap} />
            )
          )}
        </div>
      )}
    </section>
  );
}

function IRLDateCard({ show }: { show: IRLShowData }) {
  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium">{show.eventName}</p>
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">
            {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
            {show.location && <> &middot; {show.location}</>}
          </p>
          {show.djUsername && (
            <Link
              href={`/dj/${show.djUsername}`}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              {show.djName}
            </Link>
          )}
        </div>
        {show.ticketUrl && (
          <a
            href={show.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black text-xs font-medium rounded-full hover:bg-zinc-200 transition-colors flex-shrink-0"
          >
            Tickets
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function EventDateCard({ event, venueSlugMap }: { event: Event; venueSlugMap: Map<string, string> }) {
  const venueSlug = event.venueId ? venueSlugMap.get(event.venueId) : undefined;

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-4">
        {event.photo && (
          <Image
            src={event.photo}
            alt={event.name}
            width={64}
            height={64}
            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
            unoptimized
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium">{event.name}</p>
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">
            {formatEventDate(event.date)}
            {event.venueName && venueSlug ? (
              <>
                {' '}&middot;{' '}
                <Link href={`/venue/${venueSlug}`} className="hover:text-white transition-colors">
                  {event.venueName}
                </Link>
              </>
            ) : event.venueName ? (
              <> &middot; {event.venueName}</>
            ) : event.location ? (
              <> &middot; {event.location}</>
            ) : null}
          </p>
          {event.djs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
        {event.ticketLink && (
          <a
            href={event.ticketLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black text-xs font-medium rounded-full hover:bg-zinc-200 transition-colors flex-shrink-0"
          >
            Tickets
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

// ---------- Section 5: Past Shows ----------

function PastShowsSection(props: ShowsSectionProps) {
  if (props.shows.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Past Shows
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {props.shows.map((show) => (
          <ShowCard key={show.id} show={show} {...props} />
        ))}
      </div>
    </section>
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

async function fetchEvents(): Promise<Event[]> {
  if (!db) return [];

  try {
    const now = Date.now();
    // Fetch all events, filter client-side for location + genre + future date
    const snapshot = await getDocs(collection(db, 'events'));

    const results: Event[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.date || data.date < now) return;

      const location = data.location || '';
      if (!matchesCity(location, 'Los Angeles')) return;

      const genres: string[] = data.genres || [];
      if (!matchesAmbient(genres)) return;

      results.push({
        id: doc.id,
        name: data.name,
        slug: data.slug,
        date: data.date,
        endDate: data.endDate || undefined,
        photo: data.photo || null,
        description: data.description || null,
        venueId: data.venueId || null,
        venueName: data.venueName || null,
        djs: data.djs || [],
        genres,
        location: data.location || null,
        ticketLink: data.ticketLink || null,
        createdAt: data.createdAt?.toMillis?.() || Date.now(),
        createdBy: data.createdBy,
      });
    });

    return results.sort((a, b) => a.date - b.date);
  } catch (err) {
    console.error('[la-ambient] Error fetching events:', err);
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
