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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

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

    // getUserMedia requires a secure context (HTTPS or localhost). On mobile
    // Chrome over plain http://<LAN-ip> it fails with NotAllowedError — surface
    // that clearly rather than a generic "denied".
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError('Recording needs a secure (https) connection. Open this page over https and try again.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t record audio. Try uploading a file instead.');
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
      if (name === 'NotAllowedError') {
        setError('Microphone access is blocked. Tap the camera/lock icon in your browser’s address bar → allow Microphone, then try again.');
      } else if (name === 'NotFoundError') {
        setError('No microphone found on this device.');
      } else if (name === 'NotReadableError') {
        setError('Your microphone is in use by another app. Close it and try again.');
      } else {
        setError('Could not start recording. You can upload a file instead.');
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

      onCaptured({
        blob: file,
        blobUrl: url,
        mimeType: containerType(file.type || 'audio/mpeg'),
        durationSec: Math.ceil(secs),
      });
    },
    [onCaptured]
  );

  return (
    <div className="space-y-3">
      {!recording ? (
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
      )}

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="h-px flex-1 bg-gray-800" />
        or upload a file
        <span className="h-px flex-1 bg-gray-800" />
      </div>

      <label className="block">
        <span className="sr-only">Upload a file</span>
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
