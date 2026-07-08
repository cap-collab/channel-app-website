'use client';

import { useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { FieldNoteTagPicker } from '@/components/field-notes/FieldNoteTagPicker';
import { FieldNoteCaption, FieldNoteSerialized } from '@/types/field-notes';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

// Render caption cues as one editable line per cue: "m:ss  text". Admins fix
// whisper mistakes here; timings are preserved, only the text is editable.
function captionsToText(captions: FieldNoteCaption[] | null | undefined): string {
  if (!captions || captions.length === 0) return '';
  return captions.map((c) => c.text).join('\n');
}

interface Props {
  note: FieldNoteSerialized;
  onClose: () => void;
}

export function FieldNoteReviewModal({ note, onClose }: Props) {
  const { user } = useAuthContext();

  const [name, setName] = useState(note.name || '');
  const [djs, setDjs] = useState<EventDJRef[]>(note.djs);
  const [venues, setVenues] = useState<EventVenueRef[]>(note.venues);
  const [collectives, setCollectives] = useState<CollectiveRef[]>(note.collectives);
  const [eventName, setEventName] = useState(note.eventName || '');
  const [rejectionReason, setRejectionReason] = useState(note.rejectionReason || '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Captions: the cues (with timings) and an editable text-per-line view. The
  // textarea has one line per cue; edits map back onto the cues positionally so
  // timings are preserved. Adding/removing lines is not supported (keeps the
  // 1:1 cue↔timing mapping simple) — fix wording, not structure.
  const [captions, setCaptions] = useState<FieldNoteCaption[] | null>(note.captions ?? null);
  const [captionText, setCaptionText] = useState(captionsToText(note.captions));
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState<string | null>(null);

  const runTranscribe = async () => {
    if (!user) return;
    setTranscribing(true);
    setTranscribeMsg(null);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/field-notes/admin/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ noteId: note.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start transcription');
      // The worker runs async and POSTs captions to the callback. Poll the note
      // until captions land (or time out) so the admin sees the result inline.
      setTranscribeMsg('Transcribing…');
      const started = Date.now();
      const poll = async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 2500));
        const t = await user.getIdToken();
        const r = await fetch(`/api/field-notes/${note.id}`, { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json();
        const n = d?.note as FieldNoteSerialized | undefined;
        if (n?.transcribeStatus === 'done' && n.captions) {
          setCaptions(n.captions);
          setCaptionText(captionsToText(n.captions));
          setTranscribeMsg(`Done — ${n.captions.length} caption lines. Edit below, then Save.`);
          return;
        }
        if (n?.transcribeStatus === 'failed') {
          throw new Error(n.transcribeError || 'Transcription failed on the worker');
        }
        if (Date.now() - started > 90_000) {
          setTranscribeMsg('Still processing — reopen this tape shortly to see the result.');
          return;
        }
        return poll();
      };
      await poll();
    } catch (err) {
      setTranscribeMsg(null);
      setError(err instanceof Error ? err.message : 'Transcription error.');
    } finally {
      setTranscribing(false);
    }
  };

  // Map the edited textarea (one line per cue) back onto the cue timings.
  const editedCaptions = (): FieldNoteCaption[] | null => {
    if (!captions) return null;
    const lines = captionText.split('\n');
    return captions.map((c, i) => ({ ...c, text: (lines[i] ?? c.text).trim() }));
  };

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

  const tagBody = () => ({
    name: name.trim() || null,
    djs,
    venues,
    collectives,
    eventName: eventName.trim() || null,
    ...(captions ? { captions: editedCaptions() } : {}),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">Review tape</h2>
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

          {/* Transcription: on-demand whisper → line-by-line captions shown on
              the /tape card during playback. Edit wording to fix mistakes; the
              timings are kept. Saved with Publish or "Save tags only". */}
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-gray-300">Captions</label>
              <button
                onClick={runTranscribe}
                disabled={transcribing || busy}
                className="rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-40"
              >
                {transcribing ? 'Transcribing…' : captions ? 'Re-transcribe' : 'Transcribe'}
              </button>
            </div>
            {transcribeMsg && <p className="text-xs text-gray-400">{transcribeMsg}</p>}
            {captions ? (
              <textarea
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                rows={Math.min(12, Math.max(3, captions.length))}
                spellCheck
                className="w-full rounded-md bg-gray-900 text-white px-3 py-2 text-sm leading-relaxed font-mono"
                placeholder="One caption line per row"
              />
            ) : (
              <p className="text-xs text-gray-500">
                No captions yet. Click Transcribe to generate them from the audio.
              </p>
            )}
            {captions && (
              <p className="text-[11px] text-gray-500">
                {captions.length} lines · edit wording only (timings preserved) · line count must stay the same
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tape name (shown on the card)"
              className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
            />
          </div>

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
