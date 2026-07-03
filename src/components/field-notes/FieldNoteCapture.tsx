'use client';

import { useCallback, useRef, useState } from 'react';
import { MAX_FIELD_NOTE_DURATION_SEC } from '@/lib/field-notes-config';

export interface CapturedTake {
  blob: Blob;
  blobUrl: string;
  mimeType: string;
  durationSec: number;
}

interface Props {
  onCaptured: (take: CapturedTake) => void;
}

function containerType(mime: string): string {
  return (mime || 'video/mp4').split(';')[0].trim();
}

// A field note is a short video. Two paths, both reliable on iOS Safari, iOS
// Chrome, Android, and desktop:
//   • Record a video → native camera in video mode (<input accept="video/*" capture>)
//   • Upload a video → video file picker (<input accept="video/*">)
// We deliberately do NOT use getUserMedia/MediaRecorder — on mobile it's fragile
// (permission prompts, iOS Chrome quirks). The camera-capture file input just works.
export function FieldNoteCapture({ onCaptured }: Props) {
  const [error, setError] = useState<string | null>(null);
  const recordRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

      const url = URL.createObjectURL(file);
      const isVideo = (file.type || '').startsWith('video/');
      const el = document.createElement(isVideo ? 'video' : 'audio');
      el.preload = 'metadata';
      el.src = url;

      const secs = await new Promise<number>((resolve) => {
        el.onloadedmetadata = () => resolve(el.duration || 0);
        el.onerror = () => resolve(0);
      });

      if (!secs || !isFinite(secs)) {
        URL.revokeObjectURL(url);
        setError('Could not read that file. Please try another.');
        return;
      }
      if (secs > MAX_FIELD_NOTE_DURATION_SEC + 0.5) {
        URL.revokeObjectURL(url);
        setError(`Field notes must be ${MAX_FIELD_NOTE_DURATION_SEC} seconds or shorter.`);
        return;
      }

      // Infer a MIME type when the browser reports none (some phone files do).
      let mime = containerType(file.type);
      if (!file.type) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const extMime: Record<string, string> = {
          mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', '3gp': 'video/3gpp',
          webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
          aac: 'audio/aac', ogg: 'audio/ogg',
        };
        mime = extMime[ext] || 'video/mp4';
      }

      onCaptured({ blob: file, blobUrl: url, mimeType: mime, durationSec: Math.ceil(secs) });
    },
    [onCaptured]
  );

  return (
    <div className="space-y-3">
      <button
        onClick={() => recordRef.current?.click()}
        className="w-full rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium py-4"
      >
        ● Record a video
      </button>

      <button
        onClick={() => uploadRef.current?.click()}
        className="w-full rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-medium py-4"
      >
        Upload a video
      </button>

      {/* Record → native camera in video mode. */}
      <input
        ref={recordRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />
      {/* Upload → video file picker (no `capture` so existing files are pickable). */}
      <input
        ref={uploadRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />

      <p className="text-xs text-gray-500 text-center">Up to {MAX_FIELD_NOTE_DURATION_SEC} seconds.</p>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
