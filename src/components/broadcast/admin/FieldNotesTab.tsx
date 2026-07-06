'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { FieldNoteSerialized, FieldNoteStatus } from '@/types/field-notes';
import { FieldNoteReviewModal } from './FieldNoteReviewModal';

interface FieldNotesTabProps {
  userId: string;
  onPendingCountChange: (count: number) => void;
}

type FilterStatus = 'all' | FieldNoteStatus;

export function FieldNotesTab({ onPendingCountChange }: FieldNotesTabProps) {
  const { user } = useAuthContext();
  const [notes, setNotes] = useState<FieldNoteSerialized[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selected, setSelected] = useState<FieldNoteSerialized | null>(null);

  const fetchNotes = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/field-notes/admin', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch tapes');
      const data = await res.json();
      const list: FieldNoteSerialized[] = data.notes || [];
      setNotes(list);
      onPendingCountChange(list.filter((n) => n.status === 'pending').length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tapes');
    } finally {
      setIsLoading(false);
    }
  }, [user, onPendingCountChange]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleModalClose = () => {
    setSelected(null);
    fetchNotes();
  };

  const groups: { status: FilterStatus; label: string; count: number }[] = [
    { status: 'all', label: 'All', count: notes.length },
    { status: 'pending', label: 'Pending', count: notes.filter((n) => n.status === 'pending').length },
    { status: 'published', label: 'Published', count: notes.filter((n) => n.status === 'published').length },
    { status: 'rejected', label: 'Rejected', count: notes.filter((n) => n.status === 'rejected').length },
  ];

  const filtered = notes.filter((n) => (filterStatus === 'all' ? true : n.status === filterStatus));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setIsLoading(true);
            fetchNotes();
          }}
          className="mt-4 px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {groups.map((g) => (
          <button
            key={g.status}
            onClick={() => setFilterStatus(g.status)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              filterStatus === g.status ? 'bg-gray-700 text-white' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
            }`}
          >
            {g.label}
            {g.count > 0 && (
              <span className={`px-1.5 py-0.5 text-xs rounded ${filterStatus === g.status ? 'bg-gray-600' : 'bg-gray-700'}`}>
                {g.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p>No tapes found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((note) => (
            <FieldNoteCard key={note.id} note={note} onClick={() => setSelected(note)} />
          ))}
        </div>
      )}

      {selected && (
        <FieldNoteReviewModal note={selected} onClose={handleModalClose} />
      )}
    </div>
  );
}

function FieldNoteCard({ note, onClick }: { note: FieldNoteSerialized; onClick: () => void }) {
  const statusColors: Record<FieldNoteStatus, string> = {
    pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
    published: 'bg-green-900/30 text-green-400 border-green-800',
    rejected: 'bg-red-900/30 text-red-400 border-red-800',
  };
  const tags = [
    ...note.djs.map((d) => d.djName),
    ...note.venues.map((v) => v.venueName),
    ...note.collectives.map((c) => c.collectiveName),
  ];
  // Title: admin name first, else the tagged entities, else the event, else a
  // clear "Overheard" for attribution-free tapes (so rows aren't all "Tape").
  const title =
    (note.name && note.name.trim()) ||
    (tags.length > 0 ? tags.join(', ') : '') ||
    note.eventName ||
    'Overheard';
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-700 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white font-medium truncate">{title}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            by {note.recordedByUsername}
            {note.city ? ` · ${note.city}` : ''} · {note.durationSec}s
          </p>
          {/* Show the entity list as a subtitle only when it's not already the title. */}
          {tags.length > 0 && note.name && note.name.trim() && (
            <p className="text-xs text-gray-500 mt-1 truncate">{tags.join(' · ')}</p>
          )}
        </div>
        <span className={`shrink-0 text-xs px-2 py-1 rounded border ${statusColors[note.status]}`}>
          {note.status}
        </span>
      </div>
    </button>
  );
}
