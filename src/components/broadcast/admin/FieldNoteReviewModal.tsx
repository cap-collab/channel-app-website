'use client';

import { useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { FieldNoteTagPicker } from '@/components/field-notes/FieldNoteTagPicker';
import { FieldNoteSerialized } from '@/types/field-notes';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

interface Props {
  note: FieldNoteSerialized;
  onClose: () => void;
}

export function FieldNoteReviewModal({ note, onClose }: Props) {
  const { user } = useAuthContext();

  const [djs, setDjs] = useState<EventDJRef[]>(note.djs);
  const [venues, setVenues] = useState<EventVenueRef[]>(note.venues);
  const [collectives, setCollectives] = useState<CollectiveRef[]>(note.collectives);
  const [eventName, setEventName] = useState(note.eventName || '');
  const [rejectionReason, setRejectionReason] = useState(note.rejectionReason || '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/field-notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const tagBody = () => ({ djs, venues, collectives, eventName: eventName.trim() || null });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">Review field note</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div className="text-sm text-gray-400">
            by {note.recordedByUsername}
            {note.city ? ` · ${note.city}` : ''} · {note.durationSec}s · status: {note.status}
          </div>

          {note.audioMimeType?.startsWith('video/') ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video controls playsInline preload="metadata" src={note.audioUrl} className="w-full max-h-72 rounded-lg bg-black" />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls preload="none" src={note.audioUrl} className="w-full" />
          )}

          {note.caption && <p className="text-sm text-gray-300">“{note.caption}”</p>}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Event</label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="Event name"
              className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
            />
          </div>

          <FieldNoteTagPicker
            djs={djs}
            venues={venues}
            collectives={collectives}
            onChange={(next) => {
              setDjs(next.djs);
              setVenues(next.venues);
              setCollectives(next.collectives);
            }}
          />

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Rejection reason (shown to author)</label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={2}
              placeholder="Required if rejecting"
              className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 sticky bottom-0 bg-gray-900 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => patch({ status: 'published', ...tagBody() })}
              disabled={busy}
              className="flex-1 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium py-2.5 disabled:opacity-40"
            >
              Publish
            </button>
            <button
              onClick={() => patch({ status: 'rejected', rejectionReason, ...tagBody() })}
              disabled={busy || !rejectionReason.trim()}
              className="flex-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium py-2.5 disabled:opacity-40"
            >
              Reject
            </button>
          </div>
          <button
            onClick={() => patch(tagBody())}
            disabled={busy}
            className="w-full rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 disabled:opacity-40"
          >
            Save tags only
          </button>
        </div>
      </div>
    </div>
  );
}
