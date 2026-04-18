'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { AuthModal } from '@/components/AuthModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useFavoriteScenes } from '@/hooks/useFavoriteScenes';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import type { SceneSerialized } from '@/types/scenes';
import type { Archive } from '@/types/broadcast';

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

export interface SceneArchiveData {
  id: string;
  slug: string;
  showName: string;
  showImageUrl?: string;
  recordingUrl?: string;
  recordedAt: number;
  duration: number;
  sourceType?: 'live' | 'recording';
  djs: Array<{ name: string; username?: string; photoUrl?: string; genres?: string[] }>;
}

export interface SceneEvent {
  id: string;
  slug: string;
  name: string;
  date: number;
  endDate?: number;
  photo?: string | null;
  venueName?: string | null;
  collectiveName?: string | null;
  collectiveSlug?: string | null;
  location?: string | null;
  ticketLink?: string | null;
  djs: Array<{ djName: string; djUsername?: string; djPhotoUrl?: string }>;
  linkedCollectives?: Array<{ collectiveId?: string; collectiveName?: string; collectiveSlug?: string }>;
  isPast: boolean;
}

export interface SceneSlot {
  id: string;
  showName: string;
  showImageUrl?: string;
  startTime: number;
  endTime: number;
  djName?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  isPast: boolean;
}

interface Props {
  data: {
    scene: SceneSerialized;
    djs: SceneDj[];
    collectives: SceneCollective[];
    archives: SceneArchiveData[];
    upcomingEvents: SceneEvent[];
    pastEvents: SceneEvent[];
    upcomingSlots: SceneSlot[];
    pastSlots: SceneSlot[];
  };
}

type FeedItem =
  | ({ kind: 'event'; time: number } & SceneEvent)
  | ({ kind: 'slot'; time: number } & SceneSlot)
  | ({ kind: 'external'; time: number; id: string; showName: string; djName?: string; djUsername?: string; djPhotoUrl?: string; stationId: string; stationName?: string; startTime: number; endTime: number; imageUrl?: string });

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatShowTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function weekdayShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const IconCheck = () => (
  <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

const IconPlus = () => (
  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

const IconPause = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>
);

export function ScenePublicClient({ data }: Props) {
  const {
    scene,
    djs,
    collectives,
    archives,
    upcomingEvents,
    pastEvents,
    upcomingSlots,
    pastSlots,
  } = data;

  const { isAuthenticated } = useAuthContext();
  const { isFavoriteScene, toggleFavoriteScene } = useFavoriteScenes();
  const { shows: allShows } = useSchedule();
  const archivePlayer = useArchivePlayer();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [togglingFav, setTogglingFav] = useState(false);

  // Build a set of usernames + userIds in this scene for external-show matching
  const sceneDjUsernamesLower = useMemo(() => {
    const s = new Set<string>();
    for (const d of djs) {
      if (d.username) s.add(d.username.toLowerCase());
    }
    return s;
  }, [djs]);

  const djPhotoByUsername = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of djs) {
      if (d.username && d.photoUrl) m.set(d.username.toLowerCase(), d.photoUrl);
    }
    return m;
  }, [djs]);

  // External shows (NTS / Subtle / dublab / etc.) = schedule.shows minus Channel broadcasts,
  // filtered to shows whose DJ is in this scene.
  const externalShows = useMemo(() => {
    const now = Date.now();
    const out: Array<{
      id: string;
      showName: string;
      djName?: string;
      djUsername?: string;
      djPhotoUrl?: string;
      stationId: string;
      stationName?: string;
      startTime: number;
      endTime: number;
      imageUrl?: string;
      isPast: boolean;
    }> = [];
    for (const show of allShows) {
      if (show.stationId === 'broadcast') continue; // Channel handled via broadcast-slots server fetch
      const start = new Date(show.startTime).getTime();
      const end = new Date(show.endTime).getTime();
      if (!isFinite(start) || !isFinite(end)) continue;
      // Only include if a DJ in this scene is on the lineup
      const candidates = [show.djUsername, ...(show.additionalDjUsernames ?? [])].filter(Boolean) as string[];
      const match = candidates.find((u) => sceneDjUsernamesLower.has(u.toLowerCase()));
      if (!match) continue;
      out.push({
        id: show.id,
        showName: show.name,
        djName: show.dj,
        djUsername: match,
        djPhotoUrl: show.djPhotoUrl || djPhotoByUsername.get(match.toLowerCase()),
        stationId: show.stationId,
        stationName: undefined,
        startTime: start,
        endTime: end,
        imageUrl: show.imageUrl,
        isPast: end < now,
      });
    }
    return out;
  }, [allShows, sceneDjUsernamesLower, djPhotoByUsername]);

  const upcomingFeed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];
    for (const slot of upcomingSlots) {
      items.push({ ...slot, kind: 'slot', time: slot.startTime });
    }
    for (const ev of upcomingEvents) {
      items.push({ ...ev, kind: 'event', time: ev.date });
    }
    for (const ext of externalShows.filter((s) => !s.isPast)) {
      items.push({ kind: 'external', time: ext.startTime, ...ext });
    }
    items.sort((a, b) => a.time - b.time);
    return items;
  }, [upcomingSlots, upcomingEvents, externalShows]);

  const pastFeed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];
    for (const slot of pastSlots) items.push({ ...slot, kind: 'slot', time: slot.startTime });
    for (const ev of pastEvents) items.push({ ...ev, kind: 'event', time: ev.date });
    for (const ext of externalShows.filter((s) => s.isPast)) {
      items.push({ kind: 'external', time: ext.startTime, ...ext });
    }
    items.sort((a, b) => b.time - a.time);
    return items;
  }, [pastSlots, pastEvents, externalShows]);

  const favorited = isFavoriteScene(scene.id);

  const handleToggleFavorite = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setTogglingFav(true);
    await toggleFavoriteScene(scene.id);
    setTogglingFav(false);
  };

  // Filter to recordings with meaningful duration (>20 min), same as DJ page
  const displayedArchives = archives.filter((a) => a.duration > 1200 && a.recordingUrl);

  return (
    <div className="min-h-screen text-white relative overflow-x-clip">
      <AnimatedBackground />
      <Header position="sticky" />

      <main className="max-w-5xl mx-auto px-6 py-4 pb-24">
        {/* SECTION A: IDENTITY — big colored emoji + name + description */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6 md:items-start">
          <div className="md:col-span-4">
            <div className="aspect-square bg-zinc-900 overflow-hidden border border-white/10 flex items-center justify-center">
              <SceneEmojiMark scene={scene} className="text-[9rem] md:text-[11rem] leading-none" />
            </div>
          </div>

          <div className="md:col-span-8 flex flex-col">
            <h1 className="text-4xl sm:text-7xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-4 break-words">
              {scene.name}
            </h1>

            {scene.description && (
              <p className="max-w-xl text-zinc-400 mb-4">{scene.description}</p>
            )}

            {/* Artists strip */}
            {djs.length > 0 && (
              <div className="mb-2">
                <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em] mb-2">Artists</p>
                <div className="flex flex-wrap gap-2">
                  {djs.map((dj) => (
                    <Link
                      key={dj.userId}
                      href={dj.username ? `/dj/${dj.username}` : '#'}
                      className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                    >
                      <span className="w-5 h-5 rounded-full overflow-hidden bg-zinc-800 flex-shrink-0">
                        {dj.photoUrl ? (
                          <Image
                            src={dj.photoUrl}
                            alt={dj.name}
                            width={20}
                            height={20}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="flex items-center justify-center w-full h-full text-[10px] text-zinc-600">
                            {dj.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="truncate max-w-[120px]">{dj.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Collectives strip */}
            {collectives.length > 0 && (
              <div className="mt-2">
                <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em] mb-2">Collectives</p>
                <div className="flex flex-wrap gap-2">
                  {collectives.map((c) => (
                    <Link
                      key={c.id}
                      href={`/collective/${c.slug}`}
                      className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                    >
                      <span className="w-5 h-5 rounded-full overflow-hidden bg-zinc-800 flex-shrink-0">
                        {c.photo ? (
                          <Image
                            src={c.photo}
                            alt={c.name}
                            width={20}
                            height={20}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="flex items-center justify-center w-full h-full text-[10px] text-zinc-600">
                            {c.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="truncate max-w-[120px]">{c.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RECORDINGS — radio-style cards, same as /dj/[username] */}
        {displayedArchives.length > 0 && (
          <section className="space-y-3 mb-6">
            <p className="text-zinc-500 text-[10px] uppercase tracking-[0.5em]">Recordings</p>
            {displayedArchives.map((archive) => (
              <RecordingCard key={archive.id} archive={archive} archivePlayer={archivePlayer} />
            ))}
          </section>
        )}

        {/* UPCOMING — merged chronological feed (IRL events + Channel slots + external shows) */}
        {upcomingFeed.length > 0 && (
          <section className="mb-6">
            <p className="text-zinc-500 text-[10px] uppercase tracking-[0.5em] mb-3">Upcoming</p>
            <div className="space-y-3">
              {upcomingFeed.map((item) => {
                if (item.kind === 'event') return <EventCard key={`e-${item.id}`} event={item} isPast={false} />;
                if (item.kind === 'slot') return <SlotCard key={`s-${item.id}`} slot={item} />;
                return <ExternalCard key={`x-${item.id}`} show={item} isPast={false} />;
              })}
            </div>
          </section>
        )}

        {/* PAST — collapsible */}
        {pastFeed.length > 0 && (
          <section className="mb-6">
            <button
              type="button"
              onClick={() => setPastExpanded((v) => !v)}
              aria-expanded={pastExpanded}
              className="w-full flex items-center justify-between text-[10px] uppercase tracking-[0.5em] text-zinc-500 mb-3 border-b border-white/10 pb-2 hover:text-zinc-300 transition-colors"
            >
              <span>Past Activities ({pastFeed.length})</span>
              <svg
                className={`w-3 h-3 transition-transform ${pastExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {pastExpanded && (
              <div className="space-y-3">
                {pastFeed.map((item) => {
                  if (item.kind === 'event') return <EventCard key={`pe-${item.id}`} event={item} isPast />;
                  if (item.kind === 'slot') return <SlotCard key={`ps-${item.id}`} slot={item} />;
                  return <ExternalCard key={`px-${item.id}`} show={item} isPast />;
                })}
              </div>
            )}
          </section>
        )}

        {/* MAIN ACTION — Add scene to watchlist */}
        <div className="mt-10 flex justify-center">
          <button
            onClick={handleToggleFavorite}
            disabled={togglingFav}
            className={`py-3 px-6 text-sm font-semibold transition-colors flex items-center justify-center gap-2 border ${
              favorited
                ? 'bg-white/10 hover:bg-white/20 text-gray-300 border-white/20'
                : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
            } disabled:opacity-50`}
          >
            {togglingFav ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : favorited ? (
              <>
                <IconCheck />
                <span>
                  <SceneEmojiMark scene={scene} /> in your watchlist
                </span>
              </>
            ) : (
              <>
                <IconPlus />
                <span>
                  Add <SceneEmojiMark scene={scene} /> to watchlist
                </span>
              </>
            )}
          </button>
        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message={`Sign up to add ${scene.emoji} ${scene.name} to your watchlist.`}
      />
    </div>
  );
}

// --- Helpers ---

function sceneEmojiColor(scene: SceneSerialized): string | undefined {
  // Pull the `text-...` class from scene.color so the emoji itself takes the color,
  // not its background. Fall back to white if nothing matched.
  const match = scene.color.match(/text-[^\s]+/);
  return match ? match[0] : undefined;
}

function SceneEmojiMark({ scene, className }: { scene: SceneSerialized; className?: string }) {
  const colorClass = sceneEmojiColor(scene);
  return (
    <span className={`${colorClass ?? ''} ${className ?? ''}`}>{scene.emoji}</span>
  );
}

function RecordingCard({
  archive,
  archivePlayer,
}: {
  archive: SceneArchiveData;
  archivePlayer: ReturnType<typeof useArchivePlayer>;
}) {
  const isThisArchive = archivePlayer.currentArchive?.id === archive.id;
  const isPlayingArchive = isThisArchive && archivePlayer.isPlaying;
  const currentTime = isThisArchive ? archivePlayer.currentTime : 0;
  const showImage = archive.showImageUrl;
  const recordingDate = new Date(archive.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const genres = archive.djs?.[0]?.genres;
  const genreText = genres?.length ? genres.map((g) => g.toUpperCase()).join(' · ') : null;

  const handlePlayPause = () => {
    if (!archive.recordingUrl) return;
    if (isPlayingArchive) {
      archivePlayer.pause();
    } else {
      archivePlayer.play(archive as unknown as Archive);
    }
  };

  return (
    <div className="bg-black border border-[#333] rounded-none overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/40 border-b border-[#333] font-mono">
        <span className="text-zinc-400 text-[11px] uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          {archive.sourceType === 'live' ? (
            <>
              <span className="inline-flex rounded-full h-2 w-2 bg-red-600 flex-shrink-0" />
              Live Recording
            </>
          ) : (
            <>
              <svg className="w-3 h-3 text-zinc-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
              Recording
            </>
          )}
        </span>
        <span className="text-zinc-500 text-xs flex-shrink-0 ml-2">{recordingDate}</span>
      </div>

      <div className="p-3 flex items-start gap-3">
        {showImage && (
          <div className="w-20 h-20 bg-zinc-800 flex-shrink-0 overflow-hidden">
            <Image
              src={showImage}
              alt={archive.showName}
              width={80}
              height={80}
              className="w-full h-full object-cover"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col justify-between" style={showImage ? { minHeight: '80px' } : undefined}>
          <div>
            <p className="text-sm font-bold text-white uppercase tracking-wide">{archive.showName}</p>
            {archive.djs.length > 0 && (
              <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                {archive.djs.map((dj, i) => (
                  <span key={`${dj.username || dj.name}-${i}`}>
                    {i > 0 && ', '}
                    {dj.username ? (
                      <Link href={`/dj/${dj.username}`} className="hover:text-white">
                        {dj.name}
                      </Link>
                    ) : (
                      dj.name
                    )}
                  </span>
                ))}
              </p>
            )}
            {genreText && (
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-400 mt-0.5">{genreText}</p>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handlePlayPause}
              className="w-7 h-7 bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0 text-black"
            >
              {isPlayingArchive ? (
                <IconPause size={12} />
              ) : (
                <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0 space-y-0.5">
              <input
                type="range"
                min={0}
                max={archive.duration || 100}
                value={currentTime}
                onChange={(e) => archivePlayer.seek(parseFloat(e.target.value))}
                className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(archive.duration)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DjBadge({
  name,
  username,
  photoUrl,
  size = 24,
}: {
  name?: string;
  username?: string;
  photoUrl?: string;
  size?: number;
}) {
  if (!name) return null;
  const content = (
    <>
      <span
        className="rounded-full overflow-hidden bg-zinc-800 flex-shrink-0"
        style={{ width: size, height: size }}
      >
        {photoUrl ? (
          <Image src={photoUrl} alt={name} width={size} height={size} className="w-full h-full object-cover" unoptimized />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-[10px] text-zinc-600">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="text-zinc-300 text-sm truncate">{name}</span>
    </>
  );
  return username ? (
    <Link href={`/dj/${username}`} className="flex items-center gap-2 hover:text-white">
      {content}
    </Link>
  ) : (
    <span className="flex items-center gap-2">{content}</span>
  );
}

function EventCard({ event, isPast }: { event: SceneEvent; isPast: boolean }) {
  const headerVenue = event.venueName || null;
  const headerLabel = headerVenue || event.location || '';
  return (
    <div className="bg-zinc-900/50 border border-[#333] rounded-none overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-[#333] font-mono">
        <span className="text-zinc-400 text-[11px] uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <svg className="w-3 h-3 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
          </svg>
          IRL
          {headerLabel && (
            <>
              <span className="text-zinc-500">·</span>
              <span className="truncate">{headerLabel}</span>
            </>
          )}
        </span>
        <span className="text-zinc-400 text-xs flex-shrink-0 ml-2">{weekdayShortDate(event.date)}</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-start gap-4">
          <CardThumb
            showImage={event.photo || undefined}
            fallbackImage={event.djs[0]?.djPhotoUrl}
            alt={event.name}
          />
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium mb-1">{event.name}</p>
            {event.djs.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {event.djs.map((dj, i) => (
                  <DjBadge
                    key={`${event.id}-dj-${i}`}
                    name={dj.djName}
                    username={dj.djUsername}
                    photoUrl={dj.djPhotoUrl}
                    size={20}
                  />
                ))}
              </div>
            )}
            {event.linkedCollectives && event.linkedCollectives.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {event.linkedCollectives.map((c) =>
                  c.collectiveSlug ? (
                    <Link
                      key={c.collectiveId || c.collectiveSlug}
                      href={`/collective/${c.collectiveSlug}`}
                      className="text-xs text-zinc-400 hover:text-white"
                    >
                      {c.collectiveName}
                    </Link>
                  ) : (
                    <span key={c.collectiveName} className="text-xs text-zinc-400">
                      {c.collectiveName}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        </div>
        {event.ticketLink && !isPast && (
          <a
            href={event.ticketLink}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 px-4 text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-1.5"
          >
            Tickets
          </a>
        )}
      </div>
    </div>
  );
}

function SlotCard({ slot }: { slot: SceneSlot }) {
  const showDate = new Date(slot.startTime);
  const dateStr = shortDate(slot.startTime);
  const timeStr = formatShowTime(showDate);
  return (
    <div className="bg-zinc-900/50 border border-[#333] rounded-none overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-[#333] font-mono">
        <span className="text-zinc-400 text-[11px] uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <svg className="w-3 h-3 text-sky-300 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          Online
          <span className="text-zinc-500">·</span>
          <span className="truncate">Channel</span>
        </span>
        <span className="text-zinc-400 text-xs flex-shrink-0 ml-2">
          {dateStr} · {timeStr}
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <CardThumb
            showImage={slot.showImageUrl}
            fallbackImage={slot.djPhotoUrl}
            alt={slot.showName}
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-medium">{slot.showName}</h3>
            {slot.djName && (
              <div className="mt-1.5">
                <DjBadge name={slot.djName} username={slot.djUsername} photoUrl={slot.djPhotoUrl} size={22} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardThumb({
  showImage,
  fallbackImage,
  alt,
}: {
  showImage?: string;
  fallbackImage?: string;
  alt: string;
}) {
  const src = showImage || fallbackImage;
  if (!src) return <div className="w-16 h-16 bg-zinc-800 flex-shrink-0" />;
  return (
    <Image
      src={src}
      alt={alt}
      width={64}
      height={64}
      className="w-16 h-16 object-cover flex-shrink-0"
      unoptimized
    />
  );
}

function ExternalCard({
  show,
  isPast,
}: {
  show: {
    id: string;
    showName: string;
    djName?: string;
    djUsername?: string;
    djPhotoUrl?: string;
    stationId: string;
    stationName?: string;
    startTime: number;
    endTime: number;
    imageUrl?: string;
  };
  isPast: boolean;
}) {
  const dateStr = shortDate(show.startTime);
  const timeStr = formatShowTime(new Date(show.startTime));
  return (
    <div className="bg-zinc-900/50 border border-[#333] rounded-none overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-[#333] font-mono">
        <span className="text-zinc-400 text-[11px] uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <svg className="w-3 h-3 text-sky-300 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          Online
          <span className="text-zinc-500">·</span>
          <span className="truncate">{show.stationName || show.stationId}</span>
        </span>
        <span className="text-zinc-400 text-xs flex-shrink-0 ml-2">
          {dateStr} · {timeStr}
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <CardThumb
            showImage={show.imageUrl}
            fallbackImage={show.djPhotoUrl}
            alt={show.showName}
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-medium">{show.showName}</h3>
            {show.djName && (
              <div className="mt-1.5">
                <DjBadge name={show.djName} username={show.djUsername} photoUrl={show.djPhotoUrl} size={22} />
              </div>
            )}
          </div>
        </div>
        {!isPast && null}
      </div>
    </div>
  );
}
