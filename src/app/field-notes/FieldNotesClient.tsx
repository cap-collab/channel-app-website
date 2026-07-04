'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { AuthModal } from '@/components/AuthModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { normalizeUsername } from '@/lib/dj-matching';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import { FieldNoteRecorder } from '@/components/field-notes/FieldNoteRecorder';
import { FieldNoteCapture, CapturedTake } from '@/components/field-notes/FieldNoteCapture';
import { FieldNoteAudioPlayer } from '@/components/field-notes/FieldNoteAudioPlayer';
import { FieldNoteSerialized } from '@/types/field-notes';

const SECTION_HEADER_CLS = 'text-[10px] uppercase tracking-[0.5em] text-zinc-500 mb-3 border-b border-white/10 pb-2';

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Entity {
  key: string;
  label: string;
  href?: string;        // set only for DB-backed DJs / collectives (they have a page)
  photoUrl?: string | null;
  kind: 'dj' | 'venue' | 'collective';
}

// Every entity a note tags: DJs, venues, collectives (name-only tags included).
function noteEntities(note: FieldNoteSerialized): Entity[] {
  const out: Entity[] = [];
  for (const d of note.djs) {
    const href = d.djUserId && d.djUsername ? `/dj/${d.djUsername}` : undefined;
    out.push({ key: `dj:${d.djUserId || normalizeUsername(d.djName)}`, label: d.djName, href, photoUrl: d.djPhotoUrl, kind: 'dj' });
  }
  for (const v of note.venues) {
    out.push({ key: `venue:${v.venueId || normalizeUsername(v.venueName)}`, label: v.venueName, kind: 'venue' });
  }
  for (const c of note.collectives) {
    const href = c.collectiveId && c.collectiveSlug ? `/dj/${c.collectiveSlug}` : undefined;
    out.push({ key: `collective:${c.collectiveId || normalizeUsername(c.collectiveName)}`, label: c.collectiveName, href, photoUrl: c.collectivePhoto, kind: 'collective' });
  }
  return out.filter((e) => e.label);
}

interface EntityGroup extends Entity {
  notes: FieldNoteSerialized[];
  latest: number;
}

// Title a note by the entities it tags — for the private "your notes" rows.
function noteTitle(note: FieldNoteSerialized): string {
  const labels = noteEntities(note).map((e) => e.label);
  if (labels.length > 0) return labels.join(', ');
  return note.eventName || 'Untitled note';
}

function StatusLabel({ status, reason }: { status: string; reason?: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    published: { label: 'Published', cls: 'text-green-500' },
    pending: { label: 'Pending', cls: 'text-yellow-500' },
    rejected: { label: 'Rejected', cls: 'text-red-500' },
  };
  const s = map[status] || { label: status, cls: 'text-zinc-500' };
  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0">
      <span className={`text-[10px] uppercase tracking-wider ${s.cls}`}>{s.label}</span>
      {status === 'rejected' && reason && (
        <span className="text-[10px] text-zinc-600 max-w-[180px] text-right">{reason}</span>
      )}
    </div>
  );
}

// Small entity tile matching the collective DJ/guest cards: square avatar +
// name (no bio available on note tags). Tapping selects it to reveal its notes.
function EntityTile({ group, active, onSelect }: { group: EntityGroup; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-start gap-3 bg-zinc-900/50 border rounded-lg p-3 transition-colors h-[78px] overflow-hidden ${
        active ? 'border-white/40 bg-zinc-800/50' : 'border-white/10 hover:bg-zinc-800/50'
      }`}
    >
      <div className="w-14 h-14 bg-zinc-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {group.photoUrl ? (
          <Image src={group.photoUrl} alt={group.label} width={56} height={56} className="w-full h-full object-cover" unoptimized />
        ) : (
          <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-white font-medium text-sm truncate">{group.label}</p>
      </div>
    </button>
  );
}

export function FieldNotesClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const [showAuth, setShowAuth] = useState(false);
  const [take, setTake] = useState<CapturedTake | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [notes, setNotes] = useState<FieldNoteSerialized[]>([]);      // published
  const [myNotes, setMyNotes] = useState<FieldNoteSerialized[]>([]);  // author's own (any status)
  const [loading, setLoading] = useState(true);

  const hasAccess = !FIELD_NOTES_ADMIN_ONLY || isBroadcaster(role);
  const gateLoading = authLoading || roleLoading;

  const loadFeed = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const [feedRes, mineRes] = await Promise.all([
        fetch('/api/field-notes', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/field-notes/mine', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (feedRes.ok) setNotes((await feedRes.json()).notes || []);
      if (mineRes.ok) setMyNotes((await mineRes.json()).notes || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (hasAccess && user) loadFeed();
    else if (!gateLoading) setLoading(false);
  }, [hasAccess, user, gateLoading, loadFeed]);

  // Group published notes under EACH entity they tag. Ordered by most-recent note.
  const entityGroups = useMemo(() => {
    const map = new Map<string, EntityGroup>();
    for (const note of notes) {
      for (const e of noteEntities(note)) {
        const g = map.get(e.key);
        if (g) {
          g.notes.push(note);
          g.latest = Math.max(g.latest, note.createdAt);
        } else {
          map.set(e.key, { ...e, notes: [note], latest: note.createdAt });
        }
      }
    }
    const groups = Array.from(map.values());
    groups.forEach((g) => g.notes.sort((a, b) => b.createdAt - a.createdAt));
    return groups.sort((a, b) => b.latest - a.latest);
  }, [notes]);

  const onCaptured = (captured: CapturedTake) => {
    if (!isAuthenticated) {
      setShowAuth(true);
      return;
    }
    setTake(captured);
  };

  return (
    <div className="min-h-screen text-white relative overflow-x-clip">
      <AnimatedBackground />
      <Header currentPage="field-notes" position="sticky" />

      <main className="max-w-2xl mx-auto px-6 py-6 pb-24 space-y-8">
        <div className="border-b border-white/10 pb-4">
          <h1 className="text-2xl font-semibold text-white">Field Notes</h1>
          <p className="text-zinc-400 text-sm mt-2">Voice impressions from people who were there.</p>
        </div>

        {gateLoading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : !hasAccess ? (
          <div className="bg-zinc-900/50 border border-white/10 rounded-lg p-6 text-center">
            <p className="text-white text-sm">Field Notes isn’t available yet.</p>
            <p className="text-zinc-500 text-sm mt-1">This feature is in testing.</p>
          </div>
        ) : (
          <>
            {/* Record / upload */}
            <section>
              <FieldNoteCapture onCaptured={onCaptured} />
            </section>

            {/* Public notes: a grid of small entity tiles; tap one to reveal its
                notes (audio-only players). Anonymous — no poster shown. */}
            <section>
              <h2 className={SECTION_HEADER_CLS}>Notes from the crowd</h2>
              {loading ? (
                <p className="text-zinc-500 text-sm">Loading…</p>
              ) : entityGroups.length === 0 ? (
                <p className="text-zinc-500 text-sm">No published field notes yet.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {entityGroups.map((g) => (
                      <EntityTile
                        key={g.key}
                        group={g}
                        active={expandedKey === g.key}
                        onSelect={() => setExpandedKey(expandedKey === g.key ? null : g.key)}
                      />
                    ))}
                  </div>

                  {expandedKey && (() => {
                    const g = entityGroups.find((x) => x.key === expandedKey);
                    if (!g) return null;
                    return (
                      <div className="mt-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-white text-sm font-medium">{g.label}</p>
                          {g.href && (
                            <Link href={g.href} className="text-zinc-400 hover:text-white text-xs transition-colors">
                              View page →
                            </Link>
                          )}
                        </div>
                        {g.notes.map((note) => (
                          <FieldNoteAudioPlayer key={`${g.key}-${note.id}`} src={note.audioUrl} dateLabel={fmtDate(note.createdAt)} />
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}
            </section>

            {/* Your notes — with status (only the author sees approval state). Last. */}
            <section>
              <h2 className={SECTION_HEADER_CLS}>Your notes</h2>
              {loading ? (
                <p className="text-zinc-500 text-sm">Loading…</p>
              ) : myNotes.length === 0 ? (
                <p className="text-zinc-500 text-sm">You haven’t sent a field note yet.</p>
              ) : (
                <div className="divide-y divide-white/10 border border-white/10 rounded-lg overflow-hidden">
                  {myNotes.map((note) => (
                    <div key={note.id} className="flex items-center justify-between px-4 py-3 gap-3 bg-zinc-900/40">
                      <div className="min-w-0">
                        <p className="text-white text-sm truncate">{noteTitle(note)}</p>
                        <p className="text-[11px] text-zinc-500">{fmtDate(note.createdAt)}</p>
                      </div>
                      <StatusLabel status={note.status} reason={note.rejectionReason} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {take && (
        <FieldNoteRecorder
          take={take}
          onClose={() => {
            URL.revokeObjectURL(take.blobUrl);
            setTake(null);
          }}
          onSubmitted={() => {
            URL.revokeObjectURL(take.blobUrl);
            setTake(null);
            loadFeed();
          }}
        />
      )}
      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </div>
  );
}
