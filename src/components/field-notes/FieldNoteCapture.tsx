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

// Pick a MediaRecorder audio mimeType this browser supports. iOS/Safari only do
// audio/mp4 (AAC); Chrome/FF do audio/webm;codecs=opus.
function pickAudioMime(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function containerType(mime: string): string {
  return (mime || 'video/mp4').split(';')[0].trim();
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Record a field note. Preference order:
//   1. In-browser AUDIO recording via getUserMedia + MediaRecorder — prompts for
//      mic permission (iOS Safari, Android, desktop; also iOS Chrome when the
//      mic is allowed).
//   2. If the mic can't be used (blocked/unavailable, e.g. iOS Chrome with the
//      site's mic permission off), fall back to recording a VIDEO with the native
//      camera. The fallback is a SEPARATE button so its tap is a fresh user
//      gesture — iOS ignores a camera .click() fired after an awaited call.
// Upload always opens the video library.
export function FieldNoteCapture({ onCaptured }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [micFailed, setMicFailed] = useState(false); // mic blocked → offer camera fallback
  const [canRecordAudio, setCanRecordAudio] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const recordVideoRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Only gate on whether the APIs exist. In-browser audio recording works on
    // iOS Chrome too (iOS 14.3+), so we always TRY it — no browser-identity
    // short-circuit. Field notes are voice, so audio recording is the point.
    const hasApis = typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined';
    setCanRecordAudio(hasApis);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    setRecording(false);
  }, []);

  const startAudioRecording = useCallback(async () => {
    setError(null);
    setMicFailed(false);

    if (!canRecordAudio || (typeof window !== 'undefined' && !window.isSecureContext)) {
      // No recording APIs (or insecure) → go straight to the video fallback UI.
      setMicFailed(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chosen = pickAudioMime();
      const mr = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const type = containerType(mr.mimeType || chosen || 'audio/mp4');
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
    } catch {
      // Mic blocked/unavailable — offer the video-recording fallback (its own
      // button, so the camera opens from a fresh tap gesture on iOS).
      setError('Microphone isn’t available here — you can record a video instead.');
      setMicFailed(true);
    }
  }, [canRecordAudio, onCaptured, stopRecording]);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

      // Resolve a real MIME type (some phone files report none).
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

      // iOS camera capture returns HEVC video in a QuickTime .mov (type
      // video/quicktime). Fed to a <video> as-is, iOS (esp. Chrome/WKWebView)
      // plays the picture but SILENTLY DROPS THE AAC AUDIO. QuickTime and MP4
      // share the same underlying container, so re-wrapping the blob as
      // video/mp4 routes it into the MP4/AAC pipeline and the audio plays —
      // both in this preview and everywhere the note is later played back.
      let blob: Blob = file;
      if (mime === 'video/quicktime') {
        blob = new Blob([file], { type: 'video/mp4' });
        mime = 'video/mp4';
      }

      const url = URL.createObjectURL(blob);
      const isVideo = mime.startsWith('video/');
      const el = document.createElement(isVideo ? 'video' : 'audio');
      el.preload = 'metadata';
      el.src = url;

      const secs = await new Promise<number>((resolve) => {
        el.onloadedmetadata = () => resolve(el.duration || 0);
        el.onerror = () => resolve(0);
      });
      // Release the probe element's hold on the blob before the preview uses it.
      el.removeAttribute('src');
      el.load?.();

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

      onCaptured({ blob, blobUrl: url, mimeType: mime, durationSec: Math.ceil(secs) });
    },
    [onCaptured]
  );

  return (
    <div className="space-y-3">
      {recording ? (
        <button
          onClick={stopRecording}
          className="w-full rounded-xl bg-white text-black font-medium py-4"
        >
          ■ Stop — {fmt(elapsed)} / {fmt(MAX_FIELD_NOTE_DURATION_SEC)}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              // Always try in-browser AUDIO recording first (works on iOS
              // Chrome too). Only if the mic was already denied do we open the
              // camera as a fallback.
              if (micFailed) recordVideoRef.current?.click();
              else startAudioRecording();
            }}
            className="rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium py-4"
          >
            ● Record
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-medium py-4"
          >
            Upload
          </button>
        </div>
      )}

      {/* Record fallback → phone camera (records video with audio). */}
      <input
        ref={recordVideoRef}
        type="file"
        accept="video/*"
        capture
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />
      {/* Upload → video library (no `capture`). */}
      <input
        ref={uploadRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
