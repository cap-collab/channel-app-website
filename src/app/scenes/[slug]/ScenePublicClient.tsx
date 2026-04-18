'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { AuthModal } from '@/components/AuthModal';
import { ArchiveHero } from '@/components/channel/ArchiveHero';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { useBPM } from '@/contexts/BPMContext';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useFavoriteScenes } from '@/hooks/useFavoriteScenes';
import { computeDJChatRoom } from '@/lib/broadcast-utils';
import { getStationById } from '@/lib/stations';
import type { SceneSerialized } from '@/types/scenes';
import type { ArchiveSerialized } from '@/types/broadcast';

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
    archives: ArchiveSerialized[];
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

export function ScenePublicClient({ data }: Props) {
  const {
    scene,
    djs,
    collectives,
    archives,
    upcomingEvents,
    upcomingSlots,
  } = data;

  const { isAuthenticated } = useAuthContext();
  const { isFavoriteScene, toggleFavoriteScene } = useFavoriteScenes();
  const { shows: allShows } = useSchedule();

  // Live broadcast state for the hero (same hookup /radio uses).
  const { isLive: isBroadcastLive, isStreaming: isBroadcastStreaming, currentShow } =
    useBroadcastStreamContext();
  const { stationBPM } = useBPM();
  const isLiveReady = isBroadcastLive && isBroadcastStreaming;
  const isRestream = currentShow?.broadcastType === 'restream';
  const [currentDJChatRoom, setCurrentDJChatRoom] = useState(() =>
    computeDJChatRoom(currentShow ?? null)
  );
  useEffect(() => {
    setCurrentDJChatRoom(computeDJChatRoom(currentShow ?? null));
  }, [currentShow]);

  // Featured archive for this scene: highest priority, then most recent.
  const featuredArchive = useMemo(() => {
    if (archives.length === 0) return null;
    const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...archives].sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority || 'medium'] ?? 1;
      const pb = PRIORITY_RANK[b.priority || 'medium'] ?? 1;
      if (pa !== pb) return pa - pb;
      return (b.recordedAt || 0) - (a.recordedAt || 0);
    })[0];
  }, [archives]);

  const [showAuthModal, setShowAuthModal] = useState(false);
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

  // Past feed intentionally not rendered on scene pages — hero's past-shows grid covers this.
  // (pastSlots / pastEvents still fetched server-side in case we want them back.)

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

  return (
    <div className="min-h-screen text-white relative overflow-x-clip">
      <AnimatedBackground />
      <Header position="sticky" />

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-4 pb-24">
        {/* HERO — same component as /radio, scene-scoped archives.
            Title becomes "Live <emoji> Radio" inline, and the subtitle is kept. */}
        {featuredArchive && (
          <ArchiveHero
            archives={archives}
            featuredArchive={featuredArchive}
            isLive={isLiveReady}
            isRestream={isRestream}
            liveBPM={stationBPM['broadcast']?.bpm ?? null}
            liveDJChatRoom={currentDJChatRoom}
            maxHeroSlides={1}
            titleOverride={
              <>
                In the <SceneEmojiMark scene={scene} className="inline-block align-baseline" /> scene
              </>
            }
            hideSubtitle
          />
        )}

        {/* Collectives — keep pill style (smaller ancillary group) */}
        {collectives.length > 0 && (
          <section className="mb-6 mt-6">
            <p className="text-zinc-500 text-[10px] uppercase tracking-[0.5em] mb-3">Collectives</p>
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

        {/* Past Activities intentionally hidden on scene pages —
            the hero's "Past shows" grid (inside ArchiveHero) already covers scene recordings. */}

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

function SceneGlyph({ slug }: { slug: string }) {
  // Strokes intentionally extend past the 24x24 viewBox so lines bleed past the
  // glyph's bounding box. overflow-visible lets that bleed render outside the inline box.
  const common = {
    width: '1em',
    height: '1em',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'inline-block align-[-0.15em] overflow-visible',
  };
  if (slug === 'grid') {
    return (
      <svg {...common} aria-hidden>
        <line x1="-3" y1="8" x2="27" y2="8" />
        <line x1="-3" y1="16" x2="27" y2="16" />
        <line x1="8" y1="-3" x2="8" y2="27" />
        <line x1="16" y1="-3" x2="16" y2="27" />
      </svg>
    );
  }
  if (slug === 'diamond') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 2 L22 12 L12 22 L2 12 Z" />
        <path d="M12 2 L12 22 M2 12 L22 12" strokeOpacity="0.5" />
      </svg>
    );
  }
  if (slug === 'spiral') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 12 m0 0 a2 2 0 1 1 4 0 a4 4 0 1 1 -8 0 a6 6 0 1 1 12 0 a8 8 0 1 1 -16 0 a10 10 0 1 1 20 0" />
      </svg>
    );
  }
  return null;
}

function SceneEmojiMark({ scene, className }: { scene: SceneSerialized; className?: string }) {
  const colorClass = sceneEmojiColor(scene);
  const glyph = <SceneGlyph slug={scene.id} />;
  return (
    <span className={`${colorClass ?? ''} ${className ?? ''} inline-flex items-center justify-center align-middle`}>
      {glyph ?? scene.emoji}
    </span>
  );
}

// Render "DJ · Show name" in a single line, same font weight/size as caller.
// DJ name links to the DJ page when username is set.
function DjShowTitle({
  djs,
  showName,
}: {
  djs: Array<{ name: string; username?: string }>;
  showName: string;
}) {
  const first = djs[0];
  if (!first) return <>{showName}</>;
  return (
    <>
      {first.username ? (
        <Link href={`/dj/${first.username}`} className="hover:text-zinc-300">
          {first.name}
        </Link>
      ) : (
        first.name
      )}
      <span className="text-zinc-500 mx-2">·</span>
      {showName}
    </>
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
            <h3 className="text-white font-medium">
              <DjShowTitle
                djs={slot.djName ? [{ name: slot.djName, username: slot.djUsername }] : []}
                showName={slot.showName}
              />
            </h3>
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
  const stationLabel = show.stationName || getStationById(show.stationId)?.name || show.stationId;
  return (
    <div className="bg-zinc-900/50 border border-[#333] rounded-none overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-[#333] font-mono">
        <span className="text-zinc-400 text-[11px] uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          <svg className="w-3 h-3 text-sky-300 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          Online
          <span className="text-zinc-500">·</span>
          <span className="truncate">{stationLabel}</span>
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
            <h3 className="text-white font-medium">
              <DjShowTitle
                djs={show.djName ? [{ name: show.djName, username: show.djUsername }] : []}
                showName={show.showName}
              />
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
}
