'use client';

import { useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { getDefaultCity, DEFAULT_CITY_FALLBACK } from '@/lib/city-detection';
import { FieldNoteTagPicker } from './FieldNoteTagPicker';
import { CapturedTake } from './FieldNoteCapture';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';
import { RecentEventCandidate } from '@/types/field-notes';

interface Props {
  take: CapturedTake;
  onClose: () => void;
  onSubmitted: () => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// The "details" step: the recording already exists (captured on the landing
// page). This modal collects the event link + tags and submits.
export function FieldNoteRecorder({ take, onClose, onSubmitted }: Props) {
  const { user } = useAuthContext();

  const [candidates, setCandidates] = useState<RecentEventCandidate[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventDate, setNewEventDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [djs, setDjs] = useState<EventDJRef[]>([]);
  const [venues, setVenues] = useState<EventVenueRef[]>([]);
  const [collectives, setCollectives] = useState<CollectiveRef[]>([]);

  const [city, setCity] = useState(DEFAULT_CITY_FALLBACK);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCity(getDefaultCity());
    } catch {
      /* keep fallback */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/field-notes/recent-events', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCandidates(data.candidates || []);
      } catch {
        /* non-fatal */
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const canSubmit = () => {
    const hasEvent = selectedEventId || (creatingNew && newEventName.trim());
    const hasTag = djs.length > 0 || venues.length > 0 || collectives.length > 0;
    return Boolean(hasEvent || hasTag);
  };

  const handleSubmit = async () => {
    if (!user) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const token = await user.getIdToken();
      const selected = candidates.find((c) => `${c.type}:${c.id}` === selectedEventId);
      const body: Record<string, unknown> = {
        fileType: take.mimeType,
        durationSec: take.durationSec,
        djs,
        venues,
        collectives,
        city,
      };
      if (selected) {
        if (selected.type === 'slot') body.linkedSlotId = selected.id;
        else if (selected.type === 'archive') body.linkedArchiveId = selected.id;
        else if (selected.type === 'event') body.linkedEventId = selected.id;
        body.eventName = selected.name;
        body.eventDate = selected.date;
      } else if (creatingNew && newEventName.trim()) {
        body.eventName = newEventName.trim();
        body.eventDate = new Date(newEventDate + 'T12:00:00Z').getTime();
      }

      // 1. init → presigned URL + doc id
      const initRes = await fetch('/api/field-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Failed to submit');

      // 2. PUT blob → R2
      const putRes = await fetch(initData.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': take.mimeType },
        body: take.blob,
      });
      if (!putRes.ok) throw new Error('Upload failed. Please try again.');

      // 3. complete
      const completeRes = await fetch('/api/field-notes/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fieldNoteId: initData.fieldNoteId }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || 'Failed to finalize');

      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">Field note details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Recorded take preview */}
          <section className="space-y-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={take.blobUrl} className="w-full" />
            <div className="flex items-center justify-between text-sm text-gray-400">
              <span>{fmt(take.durationSec)}</span>
              <button onClick={onClose} className="text-gray-400 hover:text-white underline">
                Discard &amp; re-record
              </button>
            </div>
          </section>

          {/* Event link */}
          <section>
            <label className="block text-sm font-medium text-gray-300 mb-1">Link to an event</label>
            <select
              value={selectedEventId}
              onChange={(e) => {
                setSelectedEventId(e.target.value);
                setCreatingNew(false);
              }}
              className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
            >
              <option value="">— Recent events (last 48h) —</option>
              {candidates.map((c) => (
                <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                  {c.name}
                  {c.djs[0] ? ` · ${c.djs[0].djName}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setCreatingNew((v) => !v);
                setSelectedEventId('');
              }}
              className="mt-2 text-sm text-gray-400 hover:text-white underline"
            >
              {creatingNew ? 'Cancel new event' : 'None of these — add a new event'}
            </button>
            {creatingNew && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  placeholder="Event name"
                  className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                  className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
                />
              </div>
            )}
          </section>

          {/* Tags */}
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

          <p className="text-xs text-gray-500">City: {city}</p>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 sticky bottom-0 bg-gray-900">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit() || submitting}
            className="w-full rounded-lg bg-white text-black font-medium py-3 disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
          <p className="text-xs text-gray-500 text-center mt-2">Every field note is reviewed before it appears.</p>
        </div>
      </div>
    </div>
  );
}
