'use client';

import { useState, useEffect, useMemo } from 'react';
import { ArchiveSerialized } from '@/types/broadcast';
import { IRLShowData } from '@/types';
import { ArchiveGridCard } from '@/components/channel/ArchiveHero';
import { IRLShowCard } from '@/components/channel/IRLShowCard';
import { SceneGlyph } from '@/components/SceneGlyph';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { tempoLabel } from '@/lib/tempo';
import { useAuthContext } from '@/contexts/AuthContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useArchivePlayer } from '@/contexts/ArchivePlayerContext';
import { useScenesData, resolveArchiveScenes } from '@/hooks/useScenesData';

interface RecBand {
  glyphSlug?: string;
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
}
interface FeaturedResponse {
  archives: ArchiveSerialized[];
  comingUp: ComingUpRow[];
  startHereTitle: string;
  comingUpTitle: string;
}

export function SceneRecommendations({ onAuthRequired }: { onAuthRequired: () => void }) {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const [sections, setSections] = useState<RecSection[]>([]);
  const [startHere, setStartHere] = useState<ArchiveSerialized[] | null>(null);
  const [comingUp, setComingUp] = useState<ComingUpRow[]>([]);
  const [comingUpTitle, setComingUpTitle] = useState('Coming up this week');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (isAuthenticated && user) {
          const token = await user.getIdToken();
          const res = await fetch('/api/recommendations/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error('me failed');
          const data: MeResponse = await res.json();
          if (cancelled) return;
          setSections(data.sections || []);
          setStartHere(null);
          setComingUp(data.comingUp || []);
          setComingUpTitle(data.comingUpTitle || 'Coming up this week');
        } else {
          const res = await fetch('/api/recommendations/featured');
          if (!res.ok) throw new Error('featured failed');
          const data: FeaturedResponse = await res.json();
          if (cancelled) return;
          setSections([]);
          setStartHere(data.archives || []);
          setComingUp(data.comingUp || []);
          setComingUpTitle(data.comingUpTitle || 'Coming up this week');
        }
      } catch {
        if (!cancelled) {
          setSections([]);
          setStartHere([]);
          setComingUp([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user]);

  // Edit mode: remove an archive from a personalized section. Permanently hides
  // that archive + drops the artist from the watchlist via /api/recommendations/dismiss.
  const [editMode, setEditMode] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  // Exit edit mode on outside click/tap.
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-scene-edit-boundary]')) return;
      setEditMode(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [editMode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  const handleRemove = async (archive: ArchiveSerialized) => {
    if (!user) return;
    setRemoving((s) => new Set(s).add(archive.id));
    // Optimistically drop from view.
    setSections((prev) =>
      prev.map((sec) => ({ ...sec, archives: sec.archives.filter((a) => a.id !== archive.id) })),
    );
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

  const hasArchiveSections = sections.some((s) => s.archives.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-10" data-scene-edit-boundary>
      {startHere && startHere.length > 0 && (
        <Section title="Start here">
          <ArchiveGrid archives={startHere} />
        </Section>
      )}

      {sections.map((section, idx) => (
        <Section
          key={section.id}
          title={section.title}
          // Edit toggle only on the first archive section header (controls both).
          editButton={idx === 0 && hasArchiveSections}
          editMode={editMode}
          onToggleEdit={() => setEditMode((v) => !v)}
        >
          <ArchiveGrid
            archives={section.archives}
            bandByArchiveId={section.bandByArchiveId}
            editMode={editMode}
            removing={removing}
            onRemove={handleRemove}
          />
        </Section>
      ))}

      {comingUp.length > 0 && (
        <Section title={comingUpTitle}>
          <ComingUpGrid rows={comingUp} onAuthRequired={onAuthRequired} />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  editButton,
  editMode,
  onToggleEdit,
}: {
  title: string;
  children: React.ReactNode;
  editButton?: boolean;
  editMode?: boolean;
  onToggleEdit?: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-2xl md:text-3xl font-semibold">{title}</h2>
        {editButton && (
          <button
            onClick={onToggleEdit}
            aria-pressed={editMode}
            className="shrink-0 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300 transition-colors px-1 py-1"
          >
            <span
              aria-hidden
              className={`inline-block w-[6px] h-[6px] rounded-full transition-all ${
                editMode ? 'bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]' : 'bg-zinc-700'
              }`}
            />
            Edit
          </button>
        )}
      </div>
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
  editMode,
  removing,
  onRemove,
}: {
  archives: ArchiveSerialized[];
  bandByArchiveId?: Record<string, RecBand>;
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
            {band && (band.glyphSlug || tempoText) && (
              <div className="bg-black text-white text-[10px] font-mono uppercase tracking-[0.2em] py-1 px-2 flex items-center justify-center gap-1.5">
                {band.glyphSlug && <SceneGlyph slug={band.glyphSlug} className="!w-3 !h-3" />}
                {tempoText && <span className="lowercase tracking-normal">{tempoText.toLowerCase()}</span>}
              </div>
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

// §3 cards reuse IRLShowCard. ticketUrl='' → only the Watchlist button renders;
// reason → matchLabel.
function ComingUpGrid({ rows, onAuthRequired }: { rows: ComingUpRow[]; onAuthRequired: () => void }) {
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
      await addToWatchlist(row.djName, row.djUsername || undefined);
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  // profileMode → IRLShowCard renders the compact overlay action button. Its
  // CardActions picks the action: tickets (IRL w/ ticketUrl) → +watchlist →
  // profile. Same 2-col grid + card size as the archive sections.
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {rows.map((row, i) => {
        const key = `${row.djUsername || row.eventName}-${row.date}-${i}`;
        const addKey = row.djUsername || row.eventName;
        return (
          <IRLShowCard
            key={key}
            show={row}
            profileMode
            isOnline={!row.isIRL}
            stationLabel={row.station || 'Channel'}
            isFollowing={isInWatchlist(row.djName)}
            isAddingFollow={adding.has(addKey)}
            onFollow={() => handleFollow(row)}
          />
        );
      })}
    </div>
  );
}
