'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { getDefaultCity, DEFAULT_CITY_FALLBACK } from '@/lib/city-detection';
import { FieldNoteTagPicker } from './FieldNoteTagPicker';
import { MAX_FIELD_NOTE_DURATION_SEC } from '@/lib/field-notes-config';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';
import { RecentEventCandidate } from '@/types/field-notes';

interface Props {
  onClose: () => void;
  onSubmitted: () => void;
}

// Pick a MediaRecorder mimeType this browser actually supports. Safari has no
// audio/webm (emits audio/mp4); Chrome/FF emit audio/webm;codecs=opus.
function pickMimeType(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

// Strip codecs param: "audio/webm;codecs=opus" → "audio/webm".
function containerType(mime: string): string {
  return (mime || 'audio/webm').split(';')[0].trim();
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function FieldNoteRecorder({ onClose, onSubmitted }: Props) {
  const { user } = useAuthContext();

  // Capture state
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('audio/webm');
  const [durationSec, setDurationSec] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  // Event link
  const [candidates, setCandidates] = useState<RecentEventCandidate[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventDate, setNewEventDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });

  // Tags
  const [djs, setDjs] = useState<EventDJRef[]>([]);
  const [venues, setVenues] = useState<EventVenueRef[]>([]);
  const [collectives, setCollectives] = useState<CollectiveRef[]>([]);

  const [caption, setCaption] = useState('');
  const [city, setCity] = useState(DEFAULT_CITY_FALLBACK);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Resolve city post-mount to avoid hydration mismatch.
  useEffect(() => {
    try {
      setCity(getDefaultCity());
    } catch {
      /* keep fallback */
    }
  }, []);

  // Load recent-event candidates.
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

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecording = useCallback(() => {
    stopTimer();
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setCaptureError(null);
    setSubmitError(null);
    // Reset any previous take.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl(null);
    setDurationSec(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chosen = pickMimeType();
      const mr = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const type = containerType(mr.mimeType || chosen || 'audio/webm');
        const recorded = new Blob(chunksRef.current, { type });
        const secs = Math.min(
          MAX_FIELD_NOTE_DURATION_SEC,
          Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        );
        setMimeType(type);
        setDurationSec(secs);
        setBlob(recorded);
        setBlobUrl(URL.createObjectURL(recorded));
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      startedAtRef.current = Date.now();
      mr.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - startedAtRef.current) / 1000);
        setElapsed(secs);
        if (secs >= MAX_FIELD_NOTE_DURATION_SEC) stopRecording();
      }, 250);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotAllowedError') setCaptureError('Microphone access was denied.');
      else if (name === 'NotFoundError') setCaptureError('No microphone found.');
      else setCaptureError('Could not start recording.');
    }
  }, [blobUrl, stopRecording]);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setCaptureError(null);
      setSubmitError(null);

      // Read duration via a hidden media element.
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/');
      const el = document.createElement(isVideo ? 'video' : 'audio');
      el.preload = 'metadata';
      el.src = url;

      const secs = await new Promise<number>((resolve) => {
        el.onloadedmetadata = () => resolve(el.duration || 0);
        el.onerror = () => resolve(0);
      });

      if (!secs || !isFinite(secs)) {
        URL.revokeObjectURL(url);
        setCaptureError('Could not read that file’s duration.');
        return;
      }
      if (secs > MAX_FIELD_NOTE_DURATION_SEC + 0.5) {
        URL.revokeObjectURL(url);
        setCaptureError(`Field notes must be ${MAX_FIELD_NOTE_DURATION_SEC} seconds or shorter.`);
        return;
      }

      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setMimeType(containerType(file.type || 'audio/mpeg'));
      setDurationSec(Math.ceil(secs));
      setBlob(file);
      setBlobUrl(url);
    },
    [blobUrl]
  );

  const clearTake = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl(null);
    setDurationSec(0);
    setElapsed(0);
  };

  const canSubmit = () => {
    if (!blob || durationSec <= 0) return false;
    const hasEvent = selectedEventId || (creatingNew && newEventName.trim());
    const hasTag = djs.length > 0 || venues.length > 0 || collectives.length > 0;
    return Boolean(hasEvent || hasTag);
  };

  const handleSubmit = async () => {
    if (!user || !blob) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const token = await user.getIdToken();

      // Build event link fields.
      const selected = candidates.find((c) => `${c.type}:${c.id}` === selectedEventId);
      const body: Record<string, unknown> = {
        fileType: mimeType,
        durationSec,
        djs,
        venues,
        collectives,
        city,
        caption: caption.trim() || undefined,
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

      // 1. init: get presigned URL + doc id
      const initRes = await fetch('/api/field-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Failed to submit');

      // 2. PUT the blob straight to R2
      const putRes = await fetch(initData.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: blob,
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">Record a field note</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* 1. Capture */}
          <section>
            <p className="text-sm text-gray-400 mb-3">
              A short voice note (up to {MAX_FIELD_NOTE_DURATION_SEC}s) about what you experienced. Not a review — a memory.
            </p>

            {!blob ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {!recording ? (
                    <button
                      onClick={startRecording}
                      className="flex-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium py-3"
                    >
                      ● Record
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="flex-1 rounded-lg bg-white text-black font-medium py-3"
                    >
                      ■ Stop — {fmt(elapsed)} / {fmt(MAX_FIELD_NOTE_DURATION_SEC)}
                    </button>
                  )}
                </div>
                <div className="text-center text-xs text-gray-500">or</div>
                <label className="block">
                  <span className="sr-only">Upload a file</span>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => onFileChosen(e.target.files?.[0])}
                    className="block w-full text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-white file:px-4 file:py-2"
                  />
                </label>
                {captureError && <p className="text-sm text-red-400">{captureError}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                {blobUrl && <audio controls src={blobUrl} className="w-full" />}
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>{fmt(durationSec)}</span>
                  <button onClick={clearTake} className="text-gray-400 hover:text-white underline">
                    Re-record
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 2. Event link */}
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

          {/* 3. Tags */}
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

          {/* Caption + city */}
          <section className="space-y-2">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption (optional)"
              rows={2}
              className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500">City: {city}</p>
          </section>

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
