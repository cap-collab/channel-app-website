'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { db } from '@/lib/firebase';
import { Show, IRLShowData } from '@/types';
import { Venue, Event, EventDJRef } from '@/types/events';
import { matchesGenre } from '@/lib/genres';
import { matchesCity } from '@/lib/city-detection';
import { getStationById } from '@/lib/stations';

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

function formatShowDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
            <OnlineShowsSection shows={onlineShows} />
            <UpcomingDatesSection irlShows={irlShows} events={events} />
          </>
        )}
      </main>
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

function OnlineShowsSection({ shows }: { shows: Show[] }) {
  if (shows.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
        Online Shows
      </h2>
      <div className="space-y-3">
        {shows.map((show) => {
          const station = getStationById(show.stationId);
          return (
            <div
              key={show.id}
              className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-medium truncate">{show.name}</p>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mt-0.5">
                    {show.dj}
                    {station && station.id !== 'broadcast' && station.id !== 'dj-radio' && (
                      <> &middot; {station.name}</>
                    )}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-500 mt-1">
                    {formatShowDate(show.startTime)}
                  </p>
                </div>
                {station && station.id !== 'broadcast' && station.id !== 'dj-radio' && (
                  <span
                    className="flex-shrink-0 text-[9px] font-mono uppercase px-2 py-1 rounded-full border"
                    style={{
                      borderColor: station.accentColor + '40',
                      color: station.accentColor,
                    }}
                  >
                    {station.name}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
}: {
  irlShows: IRLShowData[];
  events: Event[];
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
              <EventDateCard key={item.key} event={item.data} />
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

function EventDateCard({ event }: { event: Event }) {
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
            {event.location && <> &middot; {event.location}</>}
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

  // Query users collection
  try {
    const usersQ = query(
      collection(db, 'users'),
      where('djProfile.location', '==', 'Los Angeles')
    );
    const usersSnapshot = await getDocs(usersQ);

    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      const djProfile = data?.djProfile;
      const username = data?.chatUsername;
      if (!username || !djProfile) return;

      const genres: string[] = djProfile.genres || [];
      if (!matchesAmbient(genres)) return;

      const normalized = username.replace(/\s+/g, '').toLowerCase();
      if (seenUsernames.has(normalized)) return;
      seenUsernames.add(normalized);

      profiles.push({
        username: normalized,
        displayName: username,
        photoUrl: djProfile.photoUrl || undefined,
        location: djProfile.location || undefined,
        genres,
        bio: djProfile.bio || undefined,
      });
    });
  } catch (err) {
    console.error('[la-ambient] Error fetching users:', err);
  }

  // Query pending-dj-profiles collection
  try {
    const pendingQ = query(
      collection(db, 'pending-dj-profiles'),
      where('djProfile.location', '==', 'Los Angeles')
    );
    const pendingSnapshot = await getDocs(pendingQ);

    pendingSnapshot.forEach((doc) => {
      const data = doc.data();
      const djProfile = data?.djProfile;
      const username = data?.chatUsername;
      if (!username || !djProfile) return;

      const genres: string[] = djProfile.genres || [];
      if (!matchesAmbient(genres)) return;

      const normalized = username.replace(/\s+/g, '').toLowerCase();
      if (seenUsernames.has(normalized)) return;
      seenUsernames.add(normalized);

      profiles.push({
        username: normalized,
        displayName: username,
        photoUrl: djProfile.photoUrl || undefined,
        location: djProfile.location || undefined,
        genres,
        bio: djProfile.bio || undefined,
      });
    });
  } catch (err) {
    console.error('[la-ambient] Error fetching pending profiles:', err);
  }

  return profiles;
}

async function fetchVenues(): Promise<Venue[]> {
  if (!db) return [];

  try {
    const venuesQ = query(
      collection(db, 'venues'),
      where('location', '==', 'Los Angeles')
    );
    const snapshot = await getDocs(venuesQ);

    const results: Venue[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
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
    const eventsQ = query(
      collection(db, 'events'),
      where('location', '==', 'Los Angeles'),
      where('date', '>=', now),
      orderBy('date', 'asc')
    );
    const snapshot = await getDocs(eventsQ);

    const results: Event[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
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

    return results;
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
