'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { AuthModal } from '@/components/AuthModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { normalizeUsername } from '@/lib/dj-matching';
import { FieldNoteRecorder } from '@/components/field-notes/FieldNoteRecorder';
import { FieldNoteCapture, CapturedTake } from '@/components/field-notes/FieldNoteCapture';
import { FieldNoteAudioPlayer } from '@/components/field-notes/FieldNoteAudioPlayer';
import { submitFieldNote } from '@/lib/field-notes-submit';
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

interface EntityGroup {
  key: string;                       // combined key of all the note's entities
  entities: Entity[];               // one or more tagged entities
  fallbackLabel: string;            // used when a note has no entities (event/untitled)
  notes: FieldNoteSerialized[];
  latest: number;
}

// Title a note by the entities it tags — for the private "your notes" rows.
function noteTitle(note: FieldNoteSerialized): string {
  if (note.name && note.name.trim()) return note.name.trim();
  const labels = noteEntities(note).map((e) => e.label);
  if (labels.length > 0) return labels.join(', ');
  return note.eventName || 'Untitled note';
}

// One small entity chip in a category header — photo + name, linked if DB-backed.
function EntityChip({ e }: { e: Entity }) {
  const inner = (
    <span className="flex items-center gap-2 min-w-0">
      <span className="w-8 h-8 bg-zinc-800 border border-[#333] flex-shrink-0 overflow-hidden flex items-center justify-center">
        {e.photoUrl ? (
          <Image src={e.photoUrl} alt={e.label} width={32} height={32} className="w-full h-full object-cover" unoptimized />
        ) : (
          <span className="text-zinc-600 font-mono text-xs">{e.label.charAt(0).toUpperCase()}</span>
        )}
      </span>
      <span className="text-white font-bold text-sm truncate">{e.label}</span>
    </span>
  );
  return e.href ? (
    <Link href={e.href} className="hover:opacity-80 transition-opacity min-w-0">{inner}</Link>
  ) : (
    <span className="min-w-0">{inner}</span>
  );
}

// Category header: all the group's entities in a row.
function EntityHeader({ group }: { group: EntityGroup }) {
  if (group.entities.length === 0) {
    return <span className="text-white font-bold text-sm">{group.fallbackLabel}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {group.entities.map((e) => <EntityChip key={e.key} e={e} />)}
    </div>
  );
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

export function FieldNotesClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const [take, setTake] = useState<CapturedTake | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [replyTo, setReplyTo] = useState<FieldNoteSerialized | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [notes, setNotes] = useState<FieldNoteSerialized[]>([]);      // published
  const [myNotes, setMyNotes] = useState<FieldNoteSerialized[]>([]);  // author's own (any status)
  const [loading, setLoading] = useState(true);

  // Open to everyone — the feature is only hidden from the menu for non-admins.
  const loadFeed = useCallback(async () => {
    try {
      // Send the token when logged in so the feed includes the user's votes.
      const token = user ? await user.getIdToken() : null;
      const authHeader = token ? { Authorization: `Bearer ${token}` } : undefined;
      const feedP = fetch('/api/field-notes', { headers: authHeader }).then((r) => (r.ok ? r.json() : { notes: [] }));
      const mineP = token
        ? fetch('/api/field-notes/mine', { headers: authHeader }).then((r) => (r.ok ? r.json() : { notes: [] }))
        : Promise.resolve({ notes: [] });
      const [feed, mine] = await Promise.all([feedP, mineP]);
      setNotes(feed.notes || []);
      setMyNotes(mine.notes || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) loadFeed();
  }, [authLoading, loadFeed]);

  // A note is "overheard" when it's tied to nothing — no entities and no event.
  const isOverheard = (note: FieldNoteSerialized) =>
    noteEntities(note).length === 0 && !(note.eventName && note.eventName.trim());

  // Group ATTRIBUTED published notes by their full set of tagged entities (or
  // event name) — notes with the same attribution share one category header.
  // Overheard notes are collected separately into their own section.
  const { entityGroups, overheardNotes } = useMemo(() => {
    const map = new Map<string, EntityGroup>();
    const overheard: FieldNoteSerialized[] = [];
    for (const note of notes) {
      if (isOverheard(note)) {
        overheard.push(note);
        continue;
      }
      const entities = noteEntities(note);
      const key = entities.length
        ? entities.map((e) => e.key).sort().join('|')
        : `event:${(note.eventName || 'untitled').toLowerCase()}`;
      const g = map.get(key);
      if (g) {
        g.notes.push(note);
        g.latest = Math.max(g.latest, note.createdAt);
      } else {
        map.set(key, {
          key,
          entities,
          fallbackLabel: note.eventName || 'Untitled',
          notes: [note],
          latest: note.createdAt,
        });
      }
    }
    const groups = Array.from(map.values());
    groups.forEach((g) => g.notes.sort((a, b) => b.createdAt - a.createdAt));
    groups.sort((a, b) => b.latest - a.latest);
    overheard.sort((a, b) => b.createdAt - a.createdAt);
    return { entityGroups: groups, overheardNotes: overheard };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // Submitting is allowed anonymously — no login prompt.
  const onCaptured = (captured: CapturedTake) => {
    setTake(captured);
  };

  // A tape was streamed past the 7s mark — bump its play-through counter.
  // Fire-and-forget; open to everyone (no auth). A dropped count is harmless.
  const handleReached = useCallback((noteId: string) => {
    fetch(`/api/field-notes/${noteId}/reached`, { method: 'POST', keepalive: true }).catch(() => {});
  }, []);

  // Vote. Not signed in (or only an anonymous Firebase session) → open the
  // sign-in/up modal. Optimistic when signed in with a real account.
  const handleVote = useCallback(async (noteId: string, value: 1 | -1) => {
    if (!isAuthenticated || !user) {
      setShowAuth(true);
      return;
    }
    const token = await user.getIdToken();
    // Optimistic local update.
    setNotes((prev) => prev.map((n) => {
      if (n.id !== noteId) return n;
      const prevVote = n.myVote || 0;
      const next = prevVote === value ? 0 : value;
      let up = n.upvotes || 0;
      let down = n.downvotes || 0;
      if (prevVote === 1) up -= 1; else if (prevVote === -1) down -= 1;
      if (next === 1) up += 1; else if (next === -1) down += 1;
      return { ...n, myVote: next, upvotes: Math.max(0, up), downvotes: Math.max(0, down) };
    }));
    try {
      const cur = notes.find((n) => n.id === noteId);
      const sendValue = (cur?.myVote || 0) === value ? 0 : value;
      const res = await fetch(`/api/field-notes/${noteId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value: sendValue }),
      });
      if (res.ok) {
        const data = await res.json();
        setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, upvotes: data.upvotes, downvotes: data.downvotes, myVote: data.myVote } : n));
      }
    } catch {
      /* keep optimistic state */
    }
  }, [user, isAuthenticated, notes]);

  // A captured voice reply → submit immediately with the parent's attributions,
  // no attribution UI. Then refresh (it's pending until admin approval).
  const submitReply = useCallback(async (parent: FieldNoteSerialized, captured: CapturedTake) => {
    setReplyError(null);
    setReplyBusy(true);
    try {
      await submitFieldNote(captured, {
        djs: parent.djs,
        venues: parent.venues,
        collectives: parent.collectives,
        linkedSlotId: parent.linkedSlotId,
        linkedArchiveId: parent.linkedArchiveId,
        linkedEventId: parent.linkedEventId,
        eventName: parent.eventName,
        eventDate: parent.eventDate,
        city: parent.city,
        parentNoteId: parent.id,
      }, user);
      URL.revokeObjectURL(captured.blobUrl);
      setReplyTo(null);
      loadFeed();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Failed to send reply.');
    } finally {
      setReplyBusy(false);
    }
  }, [user, loadFeed]);

  return (
    <div className="min-h-screen text-white relative overflow-x-clip">
      <AnimatedBackground />
      <Header currentPage="tape" position="sticky" />

      <main className="max-w-2xl mx-auto px-6 py-6 pb-24 space-y-8">
        <div className="border-b border-white/10 pb-4">
          <h1 className="text-2xl font-semibold text-white">tapes</h1>
          <p className="text-zinc-400 text-sm mt-2">voices from the people who were there.</p>
        </div>

        {authLoading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : (
          <>
            {/* Record / upload */}
            <section>
              <FieldNoteCapture onCaptured={onCaptured} />
            </section>

            {/* Public notes: a grid of small entity tiles; tap one to reveal its
                notes (audio-only players). Anonymous — no poster shown. */}
            <section>
              <h2 className={SECTION_HEADER_CLS}>Community log</h2>
              {loading ? (
                <p className="text-zinc-500 text-sm">Loading…</p>
              ) : entityGroups.length === 0 ? (
                <p className="text-zinc-500 text-sm">No published tapes yet.</p>
              ) : (
                <div className="space-y-6">
                  {entityGroups.map((g) => (
                    <div key={g.key} className="space-y-2">
                      <EntityHeader group={g} />
                      {g.notes.map((note) => (
                        <FieldNoteAudioPlayer
                          key={note.id}
                          src={note.audioUrl}
                          createdAt={note.createdAt}
                          name={note.name}
                          upvotes={note.upvotes || 0}
                          downvotes={note.downvotes || 0}
                          myVote={note.myVote || 0}
                          onVote={(value) => handleVote(note.id, value)}
                          onReply={() => setReplyTo(note)}
                          onReached={() => handleReached(note.id)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Overheard: notes tied to nothing — no DJ/venue/collective, no event. */}
            {overheardNotes.length > 0 && (
              <section>
                <h2 className={SECTION_HEADER_CLS}>Overheard</h2>
                <div className="space-y-2">
                  {overheardNotes.map((note) => (
                    <FieldNoteAudioPlayer
                      key={note.id}
                      src={note.audioUrl}
                      createdAt={note.createdAt}
                      name={note.name}
                      upvotes={note.upvotes || 0}
                      downvotes={note.downvotes || 0}
                      myVote={note.myVote || 0}
                      onVote={(value) => handleVote(note.id, value)}
                      onReply={() => setReplyTo(note)}
                      onReached={() => handleReached(note.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Your notes — with status. Only shown when logged in AND the user
                has at least one note. Hidden entirely otherwise. */}
            {isAuthenticated && myNotes.length > 0 && (
              <section>
                <h2 className={SECTION_HEADER_CLS}>Your tapes</h2>
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
              </section>
            )}
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

      {/* Voice reply: capture only, then auto-submit with the parent's
          attributions (no attribution UI). */}
      {replyTo && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-zinc-900 border border-white/10 rounded-t-2xl sm:rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Voice reply</h2>
              <button onClick={() => setReplyTo(null)} className="text-zinc-400 hover:text-white text-xl leading-none">×</button>
            </div>
            {replyBusy ? (
              <p className="text-zinc-400 text-sm py-6 text-center">Sending your reply…</p>
            ) : (
              <FieldNoteCapture onCaptured={(captured) => submitReply(replyTo, captured)} />
            )}
            {replyError && <p className="text-sm text-red-400 mt-3">{replyError}</p>}
          </div>
        </div>
      )}

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </div>
  );
}
