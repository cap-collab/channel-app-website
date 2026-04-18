'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '@/components/Header';
import type { SceneSerialized } from '@/types/scenes';

export interface SceneDj {
  userId: string;
  name: string;
  username?: string;
  photoUrl?: string;
}

export interface SceneCollective {
  id: string;
  slug: string;
  name: string;
  photo?: string | null;
  location?: string | null;
}

interface SceneArchive {
  id: string;
  slug: string;
  showName: string;
  showImageUrl?: string;
  recordedAt: number;
  duration: number;
  djs: Array<{ name: string; username?: string; photoUrl?: string }>;
}

interface SceneEvent {
  id: string;
  slug: string;
  name: string;
  date: number;
  endDate?: number;
  photo?: string | null;
  venueName?: string | null;
  collectiveName?: string | null;
  location?: string | null;
  ticketLink?: string | null;
  djs: Array<{ djName: string; djUsername?: string; djPhotoUrl?: string }>;
  isPast: boolean;
}

interface SceneSlot {
  id: string;
  showName: string;
  showImageUrl?: string;
  startTime: number;
  endTime: number;
  djName?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

type Tab = 'upcoming' | 'artists' | 'collectives' | 'recordings' | 'past';

interface Props {
  data: {
    scene: SceneSerialized;
    djs: SceneDj[];
    collectives: SceneCollective[];
    archives: SceneArchive[];
    upcomingEvents: SceneEvent[];
    pastEvents: SceneEvent[];
    upcomingSlots: SceneSlot[];
  };
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ScenePublicClient({ data }: Props) {
  const { scene, djs, collectives, archives, upcomingEvents, pastEvents, upcomingSlots } = data;
  const [tab, setTab] = useState<Tab>('upcoming');

  const upcomingCount = upcomingEvents.length + upcomingSlots.length;

  const tabs: Array<{ id: Tab; label: string; count: number }> = useMemo(
    () => [
      { id: 'upcoming', label: 'Upcoming', count: upcomingCount },
      { id: 'artists', label: 'Artists', count: djs.length },
      { id: 'collectives', label: 'Collectives', count: collectives.length },
      { id: 'recordings', label: 'Recordings', count: archives.length },
      { id: 'past', label: 'Past', count: pastEvents.length },
    ],
    [upcomingCount, djs.length, collectives.length, archives.length, pastEvents.length]
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <div className="px-4 md:px-8 py-8 md:py-12 max-w-6xl mx-auto">
        <div className="flex items-start gap-5 mb-8">
          <span
            className={`inline-flex items-center justify-center w-20 h-20 md:w-24 md:h-24 rounded-2xl border text-4xl md:text-5xl ${scene.color}`}
          >
            {scene.emoji}
          </span>
          <div className="flex-1">
            <h1 className="text-3xl md:text-5xl font-bold">{scene.name}</h1>
            {scene.description && (
              <p className="text-gray-400 mt-2 max-w-2xl">{scene.description}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-sm rounded-full border whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-white text-black border-white'
                  : 'bg-transparent text-gray-400 border-gray-700 hover:text-white hover:border-gray-500'
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-70">{t.count}</span>
            </button>
          ))}
        </div>

        {tab === 'upcoming' && (
          <UpcomingView slots={upcomingSlots} events={upcomingEvents} />
        )}
        {tab === 'artists' && <ArtistsView djs={djs} />}
        {tab === 'collectives' && <CollectivesView collectives={collectives} />}
        {tab === 'recordings' && <RecordingsView archives={archives} />}
        {tab === 'past' && <PastView events={pastEvents} />}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="text-gray-500 py-16 text-center text-sm">{message}</div>;
}

function UpcomingView({ slots, events }: { slots: SceneSlot[]; events: SceneEvent[] }) {
  if (slots.length === 0 && events.length === 0) {
    return <EmptyState message="No upcoming shows or events in this scene yet." />;
  }
  return (
    <div className="space-y-8">
      {slots.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">On the radio</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slots.map((s) => (
              <div key={s.id} className="bg-[#161616] border border-gray-800 rounded-lg overflow-hidden">
                {s.showImageUrl && (
                  <div className="relative w-full aspect-[4/3] bg-gray-900">
                    <Image src={s.showImageUrl} alt={s.showName} fill className="object-cover" />
                  </div>
                )}
                <div className="p-3">
                  <div className="text-sm font-medium text-white truncate">{s.showName}</div>
                  <div className="text-xs text-gray-400 mt-1">{formatDateTime(s.startTime)}</div>
                  {s.djName && (
                    <div className="text-xs text-gray-500 mt-1">
                      {s.djUsername ? (
                        <Link href={`/dj/${s.djUsername}`} className="hover:text-white">
                          {s.djName}
                        </Link>
                      ) : (
                        s.djName
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">Events</h2>
          <div className="space-y-2">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PastView({ events }: { events: SceneEvent[] }) {
  if (events.length === 0) return <EmptyState message="No past events in this scene." />;
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: SceneEvent }) {
  return (
    <div className="flex gap-3 bg-[#161616] border border-gray-800 rounded-lg p-3">
      {event.photo && (
        <div className="relative w-20 h-20 rounded bg-gray-900 overflow-hidden flex-shrink-0">
          <Image src={event.photo} alt={event.name} fill className="object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{event.name}</div>
        <div className="text-xs text-gray-400 mt-1">
          {formatDate(event.date)}
          {event.venueName ? ` · ${event.venueName}` : ''}
          {event.location ? ` · ${event.location}` : ''}
        </div>
        {event.djs.length > 0 && (
          <div className="text-xs text-gray-500 mt-1 truncate">
            {event.djs.map((d) => d.djName).join(', ')}
          </div>
        )}
        {event.ticketLink && !event.isPast && (
          <a
            href={event.ticketLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 text-xs text-blue-400 hover:text-blue-300"
          >
            Tickets →
          </a>
        )}
      </div>
    </div>
  );
}

function ArtistsView({ djs }: { djs: SceneDj[] }) {
  if (djs.length === 0) return <EmptyState message="No artists tagged to this scene yet." />;
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {djs.map((dj) => (
        <Link
          key={dj.userId}
          href={dj.username ? `/dj/${dj.username}` : '#'}
          className="bg-[#161616] border border-gray-800 rounded-lg overflow-hidden hover:border-gray-600 transition-colors"
        >
          <div className="relative w-full aspect-square bg-gray-900">
            {dj.photoUrl ? (
              <Image src={dj.photoUrl} alt={dj.name} fill className="object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl">
                {dj.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="p-3">
            <div className="text-sm font-medium text-white truncate">{dj.name}</div>
            {dj.username && <div className="text-xs text-gray-500 truncate">@{dj.username}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}

function CollectivesView({ collectives }: { collectives: SceneCollective[] }) {
  if (collectives.length === 0) return <EmptyState message="No collectives tagged to this scene yet." />;
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
      {collectives.map((c) => (
        <Link
          key={c.id}
          href={`/collective/${c.slug}`}
          className="bg-[#161616] border border-gray-800 rounded-lg overflow-hidden hover:border-gray-600 transition-colors"
        >
          <div className="relative w-full aspect-square bg-gray-900">
            {c.photo ? (
              <Image src={c.photo} alt={c.name} fill className="object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-600 text-3xl">
                {c.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="p-3">
            <div className="text-sm font-medium text-white truncate">{c.name}</div>
            {c.location && <div className="text-xs text-gray-500 truncate">{c.location}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}

function RecordingsView({ archives }: { archives: SceneArchive[] }) {
  if (archives.length === 0) return <EmptyState message="No recordings in this scene yet." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {archives.map((a) => (
        <Link
          key={a.id}
          href={`/archives/${a.slug}`}
          className="bg-[#161616] border border-gray-800 rounded-lg overflow-hidden hover:border-gray-600 transition-colors"
        >
          {a.showImageUrl && (
            <div className="relative w-full aspect-[4/3] bg-gray-900">
              <Image src={a.showImageUrl} alt={a.showName} fill className="object-cover" />
            </div>
          )}
          <div className="p-3">
            <div className="text-sm font-medium text-white truncate">{a.showName}</div>
            <div className="text-xs text-gray-400 mt-1">
              {formatDate(a.recordedAt)} · {formatDuration(a.duration)}
            </div>
            {a.djs.length > 0 && (
              <div className="text-xs text-gray-500 mt-1 truncate">
                {a.djs.map((d) => d.name).join(', ')}
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
