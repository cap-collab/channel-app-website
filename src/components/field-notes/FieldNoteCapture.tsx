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
  return (mime || 'audio/mp4').split(';')[0].trim();
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Detect a non-Safari browser on iOS (Chrome=CriOS, Firefox=FxiOS, Edge=EdgiOS).
// These render via WKWebView, where web-content getUserMedia is NOT wired up by
// the host app — so inline mic recording throws NotAllowedError with no prompt
// (proven on-device). There is no web workaround: a page can't open the native
// Camera app, and in-browser video capture records SILENT because it hits the
// same mic block. So on these browsers we show Upload only (attach a recording,
// e.g. a Voice Memo) and tell the user Safari records inline.
function isNonSafariIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function FieldNoteCapture({ onCaptured }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // On non-Safari iOS, inline recording can't work — show upload-only UI.
  const [uploadOnly, setUploadOnly] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const hasApis = typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined';
    if (!hasApis || isNonSafariIOS()) setUploadOnly(true);
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
    // getUserMedia must be the first call in the tap handler on iOS (any prior
    // work breaks the user-gesture chain and suppresses the prompt).
    if (!navigator.mediaDevices?.getUserMedia) {
      setUploadOnly(true);
      return;
    }
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    setError(null);

    try {
      const stream = await gumPromise;
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
      // Mic denied/unavailable (e.g. an iOS browser that slipped past detection).
      // Fall back to upload-only rather than a silent video capture.
      setUploadOnly(true);
      setError('Recording isn’t available in this browser — upload a recording, or open this page in Safari to record.');
    }
  }, [onCaptured, stopRecording]);

  const onFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

      // Resolve a real MIME type (some phone files report none).
      let mime = containerType(file.type);
      if (!file.type) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const extMime: Record<string, string> = {
          m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
          ogg: 'audio/ogg', caf: 'audio/x-caf', webm: 'audio/webm',
          mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', '3gp': 'video/3gpp',
        };
        mime = extMime[ext] || 'audio/mpeg';
      }

      // iOS camera-recorded video is HEVC in a QuickTime .mov; re-type to
      // video/mp4 so its audio plays back (bare .mov drops audio on iOS).
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
      ) : uploadOnly ? (
        <>
          <button
            onClick={() => uploadRef.current?.click()}
            className="w-full rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium py-4"
          >
            Upload a recording
          </button>
          <p className="text-xs text-gray-500">
            Recording in the browser isn’t supported here. Upload an audio or video
            clip (e.g. a Voice Memo) — or open this page in Safari to record directly.
          </p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={startAudioRecording}
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

      {/* Upload accepts audio or video; explicit types (bare audio/* greys out
          files on iOS). No `capture` attribute. */}
      <input
        ref={uploadRef}
        type="file"
        accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.caf,.mov,.mp4"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0])}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
