'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArchiveSerialized } from '@/types/broadcast';
import { IRLShowData } from '@/types';
import { ArchiveGridCard } from '@/components/channel/ArchiveHero';
import { CardActions } from '@/components/channel/CardActions';
import { SceneGlyph } from '@/components/SceneGlyph';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { tempoLabel } from '@/lib/tempo';
import { useAuthContext } from '@/contexts/AuthContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useScenesData, resolveArchiveScenes } from '@/hooks/useScenesData';

// Archive sections show 4 cards; the API returns extras (cap 8) so removing a
// card in edit mode reveals the next-best already-loaded item.
const VISIBLE_PER_SECTION = 4;

interface RecBand {
  glyphSlug?: string;
  label?: string;
  tempo?: string;
}
interface RecSection {
  id: string;
  title: string;
  archives: ArchiveSerialized[];
  bandByArchiveId: Record<string, RecBand>;
}
interface ComingUpRow extends IRLShowData {
  reason: string;
  isIRL: boolean;
  startMs: number;
  station?: string;
}
interface MeResponse {
  sections: RecSection[];
  comingUp: ComingUpRow[];
  comingUpTitle: string;
  diveBackIn: ArchiveSerialized[];
  diveBackInTitle: string;
  // Present for no-history users → the featured "Start here" grid (server returns
  // featured instead of generating an empty personalized snapshot).
  startHere?: ArchiveSerialized[];
}
interface FeaturedResponse {
  archives: ArchiveSerialized[];
  comingUp: ComingUpRow[];
  startHereTitle: string;
  comingUpTitle: string;
}

export function SceneRecommendations({
  onAuthRequired,
  editMode,
  onCanEditChange,
  targetToken,
}: {
  onAuthRequired: () => void;
  editMode: boolean; // owned by SceneClient (button lives in the search row)
  onCanEditChange: (canEdit: boolean) => void;
  // Weekly-email deep-link token (?u=). When present, render THIS recipient's
  // own scene read-only via the public by-uid endpoint — no login required.
  targetToken?: string;
}) {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const [sections, setSections] = useState<RecSection[]>([]);
  const [startHere, setStartHere] = useState<ArchiveSerialized[] | null>(null);
  const [comingUp, setComingUp] = useState<ComingUpRow[]>([]);
  const [comingUpTitle, setComingUpTitle] = useState('Coming up this week');
  // Transient "Added to watchlist" confirmation (auto-hides).
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };
  const [diveBackIn, setDiveBackIn] = useState<ArchiveSerialized[]>([]);
  const [diveExpanded, setDiveExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  // Coming-up is (nearly) user-agnostic, so we can render it from the fast public
  // endpoint the moment it lands — without waiting on the heavy personalized `me`
  // request. Tracked separately from `loading` so the section shows first.
  const [comingUpLoaded, setComingUpLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // True once the authoritative personalized coming-up has arrived — so a
    // slower public prefetch can't clobber it (whichever lands first wins for
    // personalized, and the prefetch only fills the gap before it).
    let personalizedComingUpApplied = false;
    (async () => {
      setLoading(true);
      setComingUpLoaded(false);

      // Kick off the fast, public coming-up immediately (logged-in own-scene only —
      // the deep-link and logged-out paths already fetch it without an auth wait).
      // This lets the "Coming up" section paint before the personalized `me`
      // response (which recomputes it with the city gate + mutes) resolves.
      if (!targetToken && isAuthenticated && user) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        fetch(`/api/recommendations/featured?tz=${encodeURIComponent(tz)}`)
          .then((r) => (r.ok ? (r.json() as Promise<FeaturedResponse>) : null))
          .then((data) => {
            // Don't clobber an already-arrived personalized coming-up.
            if (cancelled || !data || personalizedComingUpApplied) return;
            setComingUp(data.comingUp || []);
            setComingUpTitle(data.comingUpTitle || 'Coming up this week');
            setComingUpLoaded(true);
          })
          .catch(() => {});
      }

      try {
        // Apply a personalized payload (own /scene or email-deep-linked recipient).
        const applyPersonalized = (data: MeResponse) => {
          personalizedComingUpApplied = true;
          setSections(data.sections || []);
          // No-history users get a featured grid via startHere; otherwise null.
          setStartHere(data.startHere && data.startHere.length > 0 ? data.startHere : null);
          setComingUp(data.comingUp || []);
          setComingUpTitle(data.comingUpTitle || 'Coming up this week');
          setComingUpLoaded(true);
          setDiveBackIn(data.diveBackIn || []);
        };

        if (targetToken) {
          // Email deep-link: render the known recipient's scene read-only. No
          // session needed, so this never waits on auth — fixes the in-app
          // browser infinite-load.
          const res = await fetch(`/api/recommendations/by-uid?u=${encodeURIComponent(targetToken)}`);
          if (!res.ok) throw new Error('by-uid failed');
          const data: MeResponse = await res.json();
          if (cancelled) return;
          applyPersonalized(data);
        } else if (isAuthenticated && user) {
          const token = await user.getIdToken();
          const res = await fetch('/api/recommendations/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error('me failed');
          const data: MeResponse = await res.json();
          if (cancelled) return;
          applyPersonalized(data);
        } else {
          // Logged out OR auth not yet resolved → public featured scene. If auth
          // later resolves to a real user, the effect re-runs (authLoading in
          // deps) and upgrades to personalized; the cancelled guard prevents a
          // stale featured response from clobbering it.
          // Pass the device timezone so the featured coming-up is city-gated
          // (server derives city → LA fallback).
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
          const res = await fetch(`/api/recommendations/featured?tz=${encodeURIComponent(tz)}`);
          if (!res.ok) throw new Error('featured failed');
          const data: FeaturedResponse = await res.json();
          if (cancelled) return;
          setSections([]);
          setStartHere(data.archives || []);
          setComingUp(data.comingUp || []);
          setComingUpTitle(data.comingUpTitle || 'Coming up this week');
          setComingUpLoaded(true);
          setDiveBackIn([]);
        }
      } catch {
        if (!cancelled) {
          setSections([]);
          setStartHere([]);
          setComingUp([]);
          setComingUpLoaded(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user, targetToken]);

  // Removal in-flight set (editMode is owned by SceneClient; the toggle lives in
  // the search row so it aligns with the search bar).
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  // Tell SceneClient whether there's anything editable (controls the toggle).
  const canEdit = sections.some((s) => s.archives.length > 0) || diveBackIn.length > 0;
  useEffect(() => {
    onCanEditChange(canEdit);
  }, [canEdit, onCanEditChange]);

  // While the heavy personalized payload is still loading, paint the (fast,
  // public) "Coming up" section if it's ready — but keep the spinner ABOVE it,
  // mirroring the final layout (personalized sections render above coming-up).
  // This means the section doesn't jump position when `me` lands; the spinner is
  // simply replaced in place by the personalized sections. Fully-empty load
  // still shows just the spinner.
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-10">
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
        </div>
        {comingUpLoaded && comingUp.length > 0 && (
          <Section title={comingUpTitle}>
            <ComingUpGrid rows={comingUp} onAuthRequired={onAuthRequired} onAdded={() => showToast('Added to watchlist')} />
          </Section>
        )}
      </div>
    );
  }

  const handleRemove = async (archive: ArchiveSerialized) => {
    if (!user) return;
    setRemoving((s) => new Set(s).add(archive.id));
    // Optimistically drop from view (all sections it could appear in).
    setSections((prev) =>
      prev.map((sec) => ({ ...sec, archives: sec.archives.filter((a) => a.id !== archive.id) })),
    );
    setDiveBackIn((prev) => prev.filter((a) => a.id !== archive.id));
    try {
      const primary = archive.djs?.[0];
      const token = await user.getIdToken();
      await fetch('/api/recommendations/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ archiveId: archive.id, djUsername: primary?.username, djName: primary?.name }),
      });
    } catch {
      // best-effort; the optimistic removal still hides it this session
    } finally {
      setRemoving((s) => {
        const n = new Set(s);
        n.delete(archive.id);
        return n;
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-10">
      {startHere && startHere.length > 0 && (
        <Section title="Explore The Scene">
          <ArchiveGrid archives={startHere} />
        </Section>
      )}

      {sections.map((section) => (
        <Section key={section.id} title={section.title}>
          <ArchiveGrid
            // Show 4; the API pre-loads extras so removing a card reveals the
            // next-best already-loaded item.
            archives={section.archives.slice(0, VISIBLE_PER_SECTION)}
            bandByArchiveId={section.bandByArchiveId}
            // §1 "Your Scene" → a "New Show" black bar on every card (these are
            // not-yet-streamed archives from your favorite artists).
            fixedBandLabel={section.id === 'favorite-artists' ? 'New Show' : undefined}
            editMode={editMode}
            removing={removing}
            onRemove={handleRemove}
          />
        </Section>
      ))}

      {comingUp.length > 0 && (
        <Section title={comingUpTitle}>
          <ComingUpGrid rows={comingUp} onAuthRequired={onAuthRequired} onAdded={() => showToast('Added to watchlist')} />
        </Section>
      )}

      {diveBackIn.length > 0 && (
        <Section title="Dive back in">
          <ArchiveGrid
            archives={diveExpanded ? diveBackIn : diveBackIn.slice(0, VISIBLE_PER_SECTION)}
            editMode={editMode}
            removing={removing}
            onRemove={handleRemove}
          />
          {!diveExpanded && diveBackIn.length > VISIBLE_PER_SECTION && (
            <button
              onClick={() => setDiveExpanded(true)}
              // Not an exit-edit-mode click — see SceneClient's handler.
              data-scene-keep-edit
              className="mt-4 mx-auto block px-4 py-2 text-[11px] font-mono uppercase tracking-[0.2em]
                         text-white bg-white/10 hover:bg-white/20 border border-white/30 backdrop-blur-md
                         transition-colors"
            >
              See more
            </button>
          )}
        </Section>
      )}

      {/* Transient confirmation toast — same frosted-glass + mono-uppercase +
          squared vocabulary as the card/Edit buttons. Green check = done. */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 flex items-center gap-2
                        text-[12px] font-mono uppercase tracking-[0.15em] text-white
                        bg-white/10 backdrop-blur-md border border-white/30 shadow-lg">
          <svg className="w-3.5 h-3.5 text-green-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl md:text-3xl font-semibold mb-4">{title}</h2>
      {children}
    </section>
  );
}

// Archive grid — reuses the homepage Featured card (ArchiveGridCard) + the
// global archive player, exactly like ArchiveHero's renderGrid. §2 (Suggestions)
// renders a thin band above each card = scene glyph + tempo. §1 has no band.
function ArchiveGrid({
  archives,
  bandByArchiveId,
  fixedBandLabel,
  editMode,
  removing,
  onRemove,
}: {
  archives: ArchiveSerialized[];
  bandByArchiveId?: Record<string, RecBand>;
  fixedBandLabel?: string; // same label on every card's black bar (e.g. §1 "New Show")
  editMode?: boolean;
  removing?: Set<string>;
  onRemove?: (archive: ArchiveSerialized) => void;
}) {
  const archivePlayer = useArchivePlayer();
  const { scenes, djSceneMap } = useScenesData();
  const scenesById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; emoji: string }>();
    for (const s of scenes) m.set(s.id, { id: s.id, name: s.name, emoji: s.emoji });
    return m;
  }, [scenes]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {archives.map((archive) => {
        const band = bandByArchiveId?.[archive.id];
        const sceneIds = resolveArchiveScenes(archive, djSceneMap);
        const sceneChips = sceneIds
          .map((id) => scenesById.get(id))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({ slug: s.id, name: s.name, emoji: s.emoji }));
        const tempoText = band?.tempo ? tempoLabel(band.tempo) : null;
        return (
          <div key={archive.id} className="relative">
            {fixedBandLabel ? (
              <div className="bg-black text-white text-[10px] font-mono uppercase tracking-[0.2em] py-1 px-2 flex items-center justify-center">
                {fixedBandLabel}
              </div>
            ) : band?.label ? (
              // Affiliation-tier reason ("Affiliated with X" / "Similar to X").
              <div className="bg-black text-white text-[10px] font-mono uppercase tracking-[0.2em] py-1 px-2 flex items-center justify-center">
                {band.label}
              </div>
            ) : (
              band && (band.glyphSlug || tempoText) && (
                <div className="bg-black text-white text-[10px] font-mono uppercase tracking-[0.2em] py-1 px-2 flex items-center justify-center gap-1.5">
                  {band.glyphSlug && <SceneGlyph slug={band.glyphSlug} className="!w-3 !h-3" />}
                  {tempoText && <span>{tempoText}</span>}
                </div>
              )
            )}
            <ArchiveGridCard
              archive={archive}
              isActive={archivePlayer.currentArchive?.id === archive.id}
              isPlaying={archivePlayer.isPlaying && archivePlayer.currentArchive?.id === archive.id}
              sceneChips={sceneChips}
              onPlay={() => {
                if (archivePlayer.currentArchive?.id === archive.id && archivePlayer.isPlaying) {
                  archivePlayer.pause();
                } else {
                  archivePlayer.play(archive);
                }
              }}
            />
            {editMode && onRemove && (
              <CardRemoveButton
                onRemove={() => onRemove(archive)}
                isRemoving={removing?.has(archive.id)}
                ariaLabel={`Remove ${archive.showName}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// §3 "Coming up" renders email-style horizontal rows on the dark page:
//   [square thumb] [ show name / (badge · artists · time · venue) ]  [action]
// The WHOLE row links to the event's ticket page (IRL w/ ticketUrl) or the DJ
// profile; the right-edge CardActions (tickets → +watchlist → profile) sits on
// top and stops propagation so its own action still wins over the row link.

// "🌲 IRL" (green) / "☁️ Channel" (sky) badge — matches IRLShowCard's icon
// colors, but inline in the second text line and always FIRST.
function ComingUpBadge({ isIRL, station }: { isIRL: boolean; station?: string }) {
  if (isIRL) {
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        <svg className="w-3 h-3 text-green-300" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
        </svg>
        IRL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
      </svg>
      {station || 'Channel'}
    </span>
  );
}

function ComingUpRow({
  row,
  isFollowing,
  isAdding,
  onFollow,
}: {
  row: ComingUpRow;
  isFollowing: boolean;
  isAdding: boolean;
  onFollow: () => void;
}) {
  const photoUrl = row.eventPhotoUrl || row.djPhotoUrl;
  const [imgError, setImgError] = useState(false);
  const hasPhoto = photoUrl && !imgError;

  // Whole-row link: ticket page for IRL w/ tickets, else the click-through
  // (collective/venue) or the DJ profile.
  const rowHref =
    row.ticketUrl ||
    row.linkUrl ||
    (row.djUsername ? `/dj/${row.djUsername}` : undefined);
  const external = !!rowHref && /^https?:\/\//.test(rowHref);

  // Date + start time (device-local), e.g. "Fri, Jan 15 · 8 PM".
  const dateStr = new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = row.startMs
    ? new Date(row.startMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;
  const whenStr = timeStr ? `${dateStr} · ${timeStr}` : dateStr;

  // Meta line: artists · when · venue (the badge lives on its own line above).
  const meta = [row.djName, whenStr, row.venueName].filter(Boolean).join(' · ');

  const thumb = (
    <div className="relative w-16 h-16 shrink-0 overflow-hidden bg-white/5">
      {hasPhoto && (
        <Image
          src={photoUrl!}
          alt={row.djName}
          fill
          className="object-cover"
          unoptimized
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );

  // 3 lines: badge · show name · meta — the thumbnail is sized to match.
  const body = (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] text-zinc-400 leading-tight truncate flex items-center">
        <ComingUpBadge isIRL={row.isIRL} station={row.station} />
      </div>
      <div className="mt-0.5 text-white font-semibold text-sm leading-tight truncate">
        {row.eventName || row.djName}
      </div>
      <div className="mt-0.5 text-[13px] text-zinc-400 leading-tight truncate">
        {meta}
      </div>
    </div>
  );

  const inner = (
    <>
      {thumb}
      {body}
    </>
  );

  return (
    <div className="relative flex items-center gap-3 py-3 group">
      {rowHref ? (
        external ? (
          <a
            href={rowHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 min-w-0 flex-1"
          >
            {inner}
          </a>
        ) : (
          <Link href={rowHref} className="flex items-center gap-3 min-w-0 flex-1">
            {inner}
          </Link>
        )
      ) : (
        <div className="flex items-center gap-3 min-w-0 flex-1">{inner}</div>
      )}
      {/* Action on the right, above the row link. CardActions' button already
          stopPropagation()s the +watchlist click. */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <CardActions
          djUsername={row.djUsername}
          ticketUrl={row.ticketUrl}
          isFollowing={isFollowing}
          onAddToWatchlist={onFollow}
          isAddingWatchlist={isAdding}
        />
      </div>
    </div>
  );
}

function ComingUpGrid({
  rows,
  onAuthRequired,
  onAdded,
}: {
  rows: ComingUpRow[];
  onAuthRequired: () => void;
  onAdded: (name: string) => void;
}) {
  const { isAuthenticated } = useAuthContext();
  const { addToWatchlist, isInWatchlist } = useFavorites();
  const [adding, setAdding] = useState<Set<string>>(new Set());

  const handleFollow = async (row: ComingUpRow) => {
    if (!isAuthenticated) {
      onAuthRequired();
      return;
    }
    const key = row.djUsername || row.eventName;
    setAdding((s) => new Set(s).add(key));
    try {
      // addToWatchlist also auto-adds the DJ's matching upcoming shows + IRL events.
      const ok = await addToWatchlist(row.djName, row.djUsername || undefined);
      if (ok !== false) onAdded(row.djName);
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  return (
    <div className="divide-y divide-white/10 border-t border-white/10">
      {rows.map((row, i) => {
        const key = `${row.djUsername || row.eventName}-${row.date}-${i}`;
        const addKey = row.djUsername || row.eventName;
        return (
          <ComingUpRow
            key={key}
            row={row}
            isFollowing={isInWatchlist(row.djName)}
            isAdding={adding.has(addKey)}
            onFollow={() => handleFollow(row)}
          />
        );
      })}
    </div>
  );
}
