'use client';

import { useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { getDefaultCity, DEFAULT_CITY_FALLBACK } from '@/lib/city-detection';
import { FieldNoteTagPicker } from './FieldNoteTagPicker';
import { CapturedTake } from './FieldNoteCapture';
import { submitFieldNote, SubmitExtras } from '@/lib/field-notes-submit';
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
  const [eventQuery, setEventQuery] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string>('');  // "type:id" of a matched event
  const [eventFreeText, setEventFreeText] = useState('');              // typed-in event name (no match)

  const [djs, setDjs] = useState<EventDJRef[]>([]);
  const [venues, setVenues] = useState<EventVenueRef[]>([]);
  const [collectives, setCollectives] = useState<CollectiveRef[]>([]);

  const [city, setCity] = useState(DEFAULT_CITY_FALLBACK);
  const [permission, setPermission] = useState(false);
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
      try {
        const res = await fetch('/api/field-notes/recent-events');
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
  }, []);

  const selectedEvent = candidates.find((c) => `${c.type}:${c.id}` === selectedEventId);
  const selectedEventLabel = selectedEvent
    ? `${selectedEvent.name}${selectedEvent.djs[0] ? ` · ${selectedEvent.djs[0].djName}` : ''}`
    : eventFreeText;

  const filteredEvents = (() => {
    const q = eventQuery.trim().toLowerCase();
    if (!q) return [];
    return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  })();

  const pickEvent = (c: RecentEventCandidate) => {
    setSelectedEventId(`${c.type}:${c.id}`);
    setEventFreeText('');
    setEventQuery('');
  };
  // Commit whatever is typed as a free-text event name (on blur or submit).
  const commitEventFreeText = () => {
    const name = eventQuery.trim();
    if (name) {
      setEventFreeText(name);
      setSelectedEventId('');
      setEventQuery('');
    }
  };
  const clearEvent = () => {
    setSelectedEventId('');
    setEventFreeText('');
    setEventQuery('');
  };

  const hasAnyDetail = () => {
    const hasEvent = Boolean(selectedEventId || eventFreeText.trim() || eventQuery.trim());
    const hasTag = djs.length > 0 || venues.length > 0 || collectives.length > 0;
    return hasEvent || hasTag;
  };

  // Details are optional — a tape with none is filed as "overheard". Only the
  // usage-permission checkbox is required to submit.
  const canSubmit = () => permission;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const extras: SubmitExtras = { djs, venues, collectives, city, usagePermission: permission };
      const selected = candidates.find((c) => `${c.type}:${c.id}` === selectedEventId);
      // Any text still in the box counts as free-text on submit (no extra tap).
      const freeText = eventFreeText.trim() || eventQuery.trim();
      if (selected) {
        if (selected.type === 'slot') extras.linkedSlotId = selected.id;
        else if (selected.type === 'archive') extras.linkedArchiveId = selected.id;
        else if (selected.type === 'event') extras.linkedEventId = selected.id;
        extras.eventName = selected.name;
        extras.eventDate = selected.date;
      } else if (freeText) {
        extras.eventName = freeText;
      }

      await submitFieldNote(take, extras, user);
      onSubmitted();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-black border border-[#333] max-h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#333] shrink-0">
          <h2 className="text-sm font-mono uppercase tracking-wider text-white">Tape details</h2>
          <button onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-white text-2xl leading-none px-1">×</button>
        </div>

        <div className="px-4 py-4 space-y-5 overflow-y-auto">
          {/* Recorded take preview — AUDIO only, even for a video input (the
              <audio> element plays the audio track). */}
          <section className="space-y-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={take.blobUrl} className="w-full" />
            <div className="flex items-center justify-between text-sm text-zinc-400">
              <span>{fmt(take.durationSec)}</span>
              <button onClick={onClose} className="text-zinc-400 hover:text-white underline">
                Discard &amp; re-record
              </button>
            </div>
          </section>

          {/* Event — same picker logic as DJs: search recent events, free-text
              fallback that commits on blur/submit (no "add as new" button). */}
          <section>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Event</label>
            {selectedEventId || eventFreeText ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 text-white text-sm px-3 py-1">
                  {selectedEventLabel}
                  <button type="button" onClick={clearEvent} className="text-zinc-300 hover:text-white leading-none" aria-label="Remove event">×</button>
                </span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={eventQuery}
                  onChange={(e) => setEventQuery(e.target.value)}
                  onBlur={commitEventFreeText}
                  placeholder="Search an event, or type a new name"
                  className="w-full rounded-lg bg-zinc-800 text-white px-3 py-2 text-base"
                />
                {filteredEvents.length > 0 && (
                  <div className="mt-1 rounded-lg bg-zinc-800 divide-y divide-white/10 overflow-hidden">
                    {filteredEvents.map((c) => (
                      <button
                        key={`${c.type}:${c.id}`}
                        type="button"
                        onClick={() => pickEvent(c)}
                        className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
                      >
                        {c.name}{c.djs[0] ? ` · ${c.djs[0].djName}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </>
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

          <p className="text-xs text-zinc-500">City: {city}</p>

          {!hasAnyDetail() && (
            <p className="text-xs text-zinc-500">
              No event or tags? That&apos;s fine — this will be filed as <span className="text-zinc-300">overheard</span>.
            </p>
          )}

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </div>

        <div className="px-4 py-3 border-t border-[#333] shrink-0 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={permission}
              onChange={(e) => setPermission(e.target.checked)}
              className="mt-0.5 shrink-0 accent-white w-4 h-4"
            />
            <span className="text-xs text-zinc-300 leading-snug">
              I give Channel permission to publish my recording and agree to the{' '}
              <a
                href="/field-notes-terms"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="underline hover:text-white"
              >
                Tapes Terms
              </a>
              .
            </span>
          </label>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit() || submitting}
            className="w-full rounded-none bg-white text-black font-mono text-xs uppercase tracking-wider py-3 disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
          <p className="text-[11px] text-zinc-500 text-center leading-snug">
            By submitting, you confirm this is your recording and that you have the right to share it.
          </p>
        </div>
      </div>
    </div>
  );
}
