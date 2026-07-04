'use client';

import { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { AuthModal } from '@/components/AuthModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { FIELD_NOTES_ADMIN_ONLY } from '@/lib/field-notes-config';
import { FieldNoteRecorder } from '@/components/field-notes/FieldNoteRecorder';
import { FieldNoteCapture, CapturedTake } from '@/components/field-notes/FieldNoteCapture';
import { FieldNoteEntityPlaylists } from '@/components/field-notes/FieldNoteEntityPlaylists';
import { FieldNoteSerialized } from '@/types/field-notes';

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Title a note by the entities it tags (DJs, venues, collectives) — whether or
// not they exist in the DB. Falls back to the event name, then a generic label.
function noteTitle(note: FieldNoteSerialized): string {
  const tags = [
    ...note.djs.map((d) => d.djName),
    ...note.venues.map((v) => v.venueName),
    ...note.collectives.map((c) => c.collectiveName),
  ].filter(Boolean);
  if (tags.length > 0) return tags.join(', ');
  return note.eventName || 'Untitled note';
}

function StatusPill({ status, reason }: { status: string; reason?: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    published: { label: 'Published', cls: 'bg-green-600 text-white' },
    pending: { label: 'Pending review', cls: 'bg-yellow-500 text-black' },
    rejected: { label: 'Rejected', cls: 'bg-red-600 text-white' },
  };
  const s = map[status] || { label: status, cls: 'bg-gray-700 text-white' };
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`rounded-full text-xs px-2.5 py-1 ${s.cls}`}>{s.label}</span>
      {status === 'rejected' && reason && (
        <span className="text-xs text-gray-500 max-w-[200px] text-right">{reason}</span>
      )}
    </div>
  );
}

export function FieldNotesClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const [showAuth, setShowAuth] = useState(false);
  const [take, setTake] = useState<CapturedTake | null>(null);

  const [notes, setNotes] = useState<FieldNoteSerialized[]>([]);      // published (for playback)
  const [myNotes, setMyNotes] = useState<FieldNoteSerialized[]>([]);  // author's own (any status)
  const [loadingFeed, setLoadingFeed] = useState(true);

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
      if (feedRes.ok) {
        const data = await feedRes.json();
        setNotes(data.notes || []);
      }
      if (mineRes.ok) {
        const data = await mineRes.json();
        setMyNotes(data.notes || []);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoadingFeed(false);
    }
  }, [user]);

  useEffect(() => {
    if (hasAccess && user) loadFeed();
    else if (!gateLoading) setLoadingFeed(false);
  }, [hasAccess, user, gateLoading, loadFeed]);

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

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        <div>
          <h1 className="text-2xl font-bold text-white">Field Notes</h1>
          <p className="text-gray-400 mt-1">
            Voice impressions from people who were there.
          </p>
        </div>

        {gateLoading ? (
          <p className="text-gray-500">Loading…</p>
        ) : !hasAccess ? (
          <div className="rounded-xl bg-gray-900 p-6 text-center">
            <p className="text-white font-medium">Field Notes isn’t available yet.</p>
            <p className="text-gray-400 text-sm mt-1">This feature is in testing.</p>
          </div>
        ) : (
          <>
            {/* 1. Record / upload — directly on the landing */}
            <section>
              <FieldNoteCapture onCaptured={onCaptured} />
            </section>

            {/* 2. Attributed playback */}
            <FieldNoteEntityPlaylists notes={notes} />

            {/* 3. Your notes — with published / pending / rejected status */}
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Your notes</h2>
              {loadingFeed ? (
                <p className="text-gray-500">Loading…</p>
              ) : myNotes.length === 0 ? (
                <p className="text-gray-500">You haven’t sent a field note yet.</p>
              ) : (
                <div className="space-y-2">
                  {myNotes.map((note) => (
                    <div key={note.id} className="flex items-center justify-between rounded-lg bg-gray-900 px-4 py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm truncate">{noteTitle(note)}</p>
                        <p className="text-xs text-gray-500">{timeAgo(note.createdAt)}</p>
                      </div>
                      <StatusPill status={note.status} reason={note.rejectionReason} />
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
