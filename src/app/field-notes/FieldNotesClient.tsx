'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AuthModal } from '@/components/AuthModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { normalizeUsername } from '@/lib/dj-matching';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import { FieldNoteRecorder } from '@/components/field-notes/FieldNoteRecorder';
import { FieldNoteCapture, CapturedTake } from '@/components/field-notes/FieldNoteCapture';
import { FieldNoteSerialized } from '@/types/field-notes';

// DJ-page design tokens (square, thin dark lines, mono metadata).
const HEADER_CLS = 'text-[10px] uppercase tracking-[0.5em] text-zinc-500 mb-3 border-b border-white/10 pb-2';
const CARD_CLS = 'bg-zinc-900/50 border border-[#333] rounded-none';

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Entity {
  key: string;
  label: string;
  href?: string; // set only for DB-backed DJs / collectives (they have a page)
}

// Every entity a note tags: DJs, venues, collectives (name-only tags included).
// href is set only when the entity exists in the DB and has a public page:
// DJs (djUserId → /dj/<username>) and collectives (collectiveSlug → /dj/<slug>).
function noteEntities(note: FieldNoteSerialized): Entity[] {
  const out: Entity[] = [];
  for (const d of note.djs) {
    const href = d.djUserId && d.djUsername ? `/dj/${d.djUsername}` : undefined;
    out.push({ key: `dj:${d.djUserId || normalizeUsername(d.djName)}`, label: d.djName, href });
  }
  for (const v of note.venues) {
    out.push({ key: `venue:${v.venueId || normalizeUsername(v.venueName)}`, label: v.venueName });
  }
  for (const c of note.collectives) {
    const href = c.collectiveId && c.collectiveSlug ? `/dj/${c.collectiveSlug}` : undefined;
    out.push({ key: `collective:${c.collectiveId || normalizeUsername(c.collectiveName)}`, label: c.collectiveName, href });
  }
  return out.filter((e) => e.label);
}

interface EntityGroup {
  key: string;
  label: string;
  href?: string;
  notes: FieldNoteSerialized[];
  latest: number;
}

// A note titled by its tagged entities (for the "my notes" rows).
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
      <span className={`text-[10px] uppercase tracking-wider font-mono ${s.cls}`}>{s.label}</span>
      {status === 'rejected' && reason && (
        <span className="text-[10px] text-zinc-600 max-w-[180px] text-right">{reason}</span>
      )}
    </div>
  );
}

// A thin, square recording card for the public per-entity lists: just the date
// + an audio/video player. No status (these are all published).
function RecordingCard({ note }: { note: FieldNoteSerialized }) {
  const isVideo = note.audioMimeType?.startsWith('video/');
  return (
    <div className={CARD_CLS}>
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-[#333] font-mono">
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">{note.recordedByUsername}</span>
        <span className="text-[11px] text-zinc-500">{fmtDate(note.createdAt)}</span>
      </div>
      <div className="p-3">
        {isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video controls playsInline preload="metadata" src={note.audioUrl} className="w-full max-h-72 bg-black" />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio controls preload="none" src={note.audioUrl} className="w-full" />
        )}
      </div>
    </div>
  );
}

export function FieldNotesClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const [showAuth, setShowAuth] = useState(false);
  const [take, setTake] = useState<CapturedTake | null>(null);

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

  // Group published notes under EACH entity they tag (a note can appear in
  // multiple entity sections). Ordered by most-recent note.
  const entityGroups = useMemo(() => {
    const map = new Map<string, EntityGroup>();
    for (const note of notes) {
      for (const e of noteEntities(note)) {
        const g = map.get(e.key);
        if (g) {
          g.notes.push(note);
          g.latest = Math.max(g.latest, note.createdAt);
        } else {
          map.set(e.key, { key: e.key, label: e.label, href: e.href, notes: [note], latest: note.createdAt });
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
    <div className="min-h-screen bg-black">
      <Header currentPage="field-notes" position="sticky" />

      <main className="max-w-2xl mx-auto px-6 py-6 pb-24 space-y-8">
        <div className="border-b border-white/10 pb-4">
          <h1 className="text-lg uppercase tracking-[0.3em] text-white font-mono">Field Notes</h1>
          <p className="text-zinc-500 text-xs mt-2">Voice impressions from people who were there.</p>
        </div>

        {gateLoading ? (
          <p className="text-zinc-600 text-xs font-mono">LOADING…</p>
        ) : !hasAccess ? (
          <div className={`${CARD_CLS} p-6 text-center`}>
            <p className="text-white text-sm">Field Notes isn’t available yet.</p>
            <p className="text-zinc-500 text-xs mt-1">This feature is in testing.</p>
          </div>
        ) : (
          <>
            {/* Record / upload */}
            <section>
              <FieldNoteCapture onCaptured={onCaptured} />
            </section>

            {/* My notes — with status (only I see the approval state) */}
            <section>
              <h2 className={HEADER_CLS}>Your notes</h2>
              {loading ? (
                <p className="text-zinc-600 text-xs font-mono">LOADING…</p>
              ) : myNotes.length === 0 ? (
                <p className="text-zinc-600 text-xs">You haven’t sent a field note yet.</p>
              ) : (
                <div className="divide-y divide-[#333] border border-[#333]">
                  {myNotes.map((note) => (
                    <div key={note.id} className="flex items-center justify-between px-4 py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm truncate">{noteTitle(note)}</p>
                        <p className="text-[11px] text-zinc-500 font-mono">{fmtDate(note.createdAt)}</p>
                      </div>
                      <StatusLabel status={note.status} reason={note.rejectionReason} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Public notes, grouped by entity (name = section header, links to
                the entity's page when it exists in the DB — DJs / collectives). */}
            {!loading && entityGroups.map((g) => (
              <section key={g.key}>
                <h2 className={HEADER_CLS}>
                  {g.href ? (
                    <Link href={g.href} className="hover:text-white transition-colors">{g.label}</Link>
                  ) : (
                    g.label
                  )}
                </h2>
                <div className="space-y-3">
                  {g.notes.map((note) => (
                    <RecordingCard key={`${g.key}-${note.id}`} note={note} />
                  ))}
                </div>
              </section>
            ))}
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
