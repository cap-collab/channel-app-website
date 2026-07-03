'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

// Pick a MediaRecorder mimeType this browser supports. Safari has no audio/webm
// (emits audio/mp4); Chrome/FF emit audio/webm;codecs=opus.
function pickMimeType(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function containerType(mime: string): string {
  return (mime || 'audio/webm').split(';')[0].trim();
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function FieldNoteCapture({ onCaptured }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Whether in-browser recording is even possible. On iOS, only Safari can use
  // getUserMedia — Chrome/Firefox/Edge run on WKWebView and can't capture the
  // mic (no prompt ever appears). There we hide Record and lead with Upload.
  const [canRecord, setCanRecord] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    // Detect iOS + non-Safari (Chrome/Firefox/Edge on iOS = WKWebView, no mic
    // capture) and the absence of the recording APIs entirely.
    const ua = navigator.userAgent;
    const isIOS = /iP(hone|ad|od)/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS masquerades as Mac
    const isSafari = /^((?!chrome|crios|fxios|edgios).)*safari/i.test(ua);
    const hasApis = typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined';
    setCanRecord(hasApis && (!isIOS || isSafari));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
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
    setError(null);

    // Fire getUserMedia synchronously inside the tap gesture so mobile Chrome
    // reliably shows its permission prompt. Do the cheap guards first.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('Recording needs a secure (https) connection.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t record. Please upload a file instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chosen = pickMimeType();
      const mr = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

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
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        onCaptured({ blob: recorded, blobUrl: URL.createObjectURL(recorded), mimeType: type, durationSec: secs });
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
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        // Mobile Chrome shows no address-bar lock icon, so the desktop "click
        // the lock" advice is wrong. When the mic is blocked at the site OR OS
        // level, Chrome throws immediately without a prompt and won't re-ask.
        // Point at the real fixes and make Upload the easy way out.
        let blocked = false;
        try {
          const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
          blocked = status?.state === 'denied';
        } catch {
          /* Permissions API not available — fall through to generic copy */
        }
        setError(
          blocked
            ? 'Microphone is blocked for this site. Chrome ⋮ menu → Settings → Site settings → Microphone → allow this site, then tap Record again. Or upload a file below.'
            : 'Couldn’t access the microphone. Check that Chrome has mic permission (phone Settings → Apps → Chrome → Permissions), then try again. Or upload a file below.'
        );
      } else if (name === 'NotFoundError') {
        setError('No microphone available. Please upload a file below.');
      } else if (name === 'NotReadableError') {
        setError('Your microphone is in use by another app. Close it, or upload a file below.');
      } else {
        setError('Could not start recording. Please upload a file below.');
      }
    }
  }, [onCaptured, stopRecording]);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

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
        setError('Could not read that file’s duration.');
        return;
      }
      if (secs > MAX_FIELD_NOTE_DURATION_SEC + 0.5) {
        URL.revokeObjectURL(url);
        setError(`Field notes must be ${MAX_FIELD_NOTE_DURATION_SEC} seconds or shorter.`);
        return;
      }

      // Some phone files arrive with an empty MIME type; infer one from the
      // extension so the server accepts it and the R2 key gets the right ext.
      let mime = containerType(file.type);
      if (!file.type) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const extMime: Record<string, string> = {
          mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', '3gp': 'video/3gpp',
          m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
          ogg: 'audio/ogg', webm: isVideo ? 'video/webm' : 'audio/webm', caf: 'audio/x-caf',
        };
        mime = extMime[ext] || 'audio/mpeg';
      }

      onCaptured({
        blob: file,
        blobUrl: url,
        mimeType: mime,
        durationSec: Math.ceil(secs),
      });
    },
    [onCaptured]
  );

  return (
    <div className="space-y-3">
      {canRecord && (!recording ? (
        <button
          onClick={startRecording}
          className="w-full rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium py-4"
        >
          ● Record a field note
        </button>
      ) : (
        <button
          onClick={stopRecording}
          className="w-full rounded-xl bg-white text-black font-medium py-4"
        >
          ■ Stop — {fmt(elapsed)} / {fmt(MAX_FIELD_NOTE_DURATION_SEC)}
        </button>
      ))}

      {canRecord && (
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="h-px flex-1 bg-gray-800" />
          or upload a file
          <span className="h-px flex-1 bg-gray-800" />
        </div>
      )}

      {!canRecord && (
        <p className="text-sm text-gray-400">
          In-browser recording isn’t supported here. Record with your phone’s
          Voice Memos (or use Safari), then upload the file below — up to {MAX_FIELD_NOTE_DURATION_SEC}s.
        </p>
      )}

      <label className="block">
        <span className="sr-only">Upload an audio or video file</span>
        {/* audio/* first so the picker surfaces audio files as the primary
            option; video is still allowed. No `capture` attribute, so tapping
            opens the file picker (not the camera). */}
        <input
          type="file"
          accept="audio/*,video/*"
          onChange={(e) => onFileChosen(e.target.files?.[0])}
          className="block w-full text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-white file:px-4 file:py-2"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
