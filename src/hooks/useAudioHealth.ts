'use client';

import { useState, useEffect, useRef } from 'react';

type ChannelState = 'active' | 'silent' | 'weak';

export interface AudioHealth {
  leftLevel: number;      // 0-1 instantaneous RMS of L channel
  rightLevel: number;     // 0-1 instantaneous RMS of R channel
  leftPeakDb: number;     // peak dB over last 500ms (L), e.g. -12.3
  rightPeakDb: number;    // peak dB over last 500ms (R)
  leftState: ChannelState;
  rightState: ChannelState;
  mono: boolean;          // true if one channel active while the other is silent
  totalDropouts: number;  // dropouts since hook mounted
  recentDropouts: number; // dropouts in last 60s
  lastDropoutAt: number | null; // timestamp ms
}

const SILENT_DB = -50;   // below this = silent
const WEAK_DB = -20;     // below this = weak; above = proper broadcast level
const DROPOUT_MIN_MS = 300;  // silence shorter than this ignored — avoids catching
                             // natural beat/break silences and AudioContext hiccups
const DROPOUT_MAX_MS = 5000; // silence longer than this not a dropout (track ended)
const WARMUP_MS = 3000;      // ignore dropouts in the first 3s after stream starts
                             // (WebAudio buffers warming up, source negotiation)

function rmsToDb(rms: number): number {
  if (rms <= 0.00001) return -100;
  return 20 * Math.log10(rms);
}

function classify(db: number): ChannelState {
  if (db < SILENT_DB) return 'silent';
  if (db < WEAK_DB) return 'weak';
  return 'active';
}

export function useAudioHealth(stream: MediaStream | null): AudioHealth {
  const [health, setHealth] = useState<AudioHealth>({
    leftLevel: 0,
    rightLevel: 0,
    leftPeakDb: -100,
    rightPeakDb: -100,
    leftState: 'silent',
    rightState: 'silent',
    mono: false,
    totalDropouts: 0,
    recentDropouts: 0,
    lastDropoutAt: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const leftAnalyserRef = useRef<AnalyserNode | null>(null);
  const rightAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Ring buffers for peak-hold (500ms of samples)
  const leftPeakBufRef = useRef<number[]>([]);
  const rightPeakBufRef = useRef<number[]>([]);

  // Dropout tracking — both channels silent for >DROPOUT_MIN_MS
  const silenceStartRef = useRef<number | null>(null);
  const dropoutTimestampsRef = useRef<number[]>([]);
  const totalDropoutsRef = useRef<number>(0);
  // Timestamp (performance.now) when the current stream started, for warmup skip
  const streamStartRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      return;
    }
    streamStartRef.current = performance.now();
    // Reset counters when a new stream attaches
    silenceStartRef.current = null;
    dropoutTimestampsRef.current = [];
    totalDropoutsRef.current = 0;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const splitter = audioContext.createChannelSplitter(2);
    source.connect(splitter);

    const makeAnalyser = () => {
      const a = audioContext.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.3;
      return a;
    };

    const leftAnalyser = makeAnalyser();
    const rightAnalyser = makeAnalyser();
    splitter.connect(leftAnalyser, 0);
    splitter.connect(rightAnalyser, 1);

    audioContextRef.current = audioContext;
    splitterRef.current = splitter;
    leftAnalyserRef.current = leftAnalyser;
    rightAnalyserRef.current = rightAnalyser;

    const leftData = new Uint8Array(leftAnalyser.fftSize);
    const rightData = new Uint8Array(rightAnalyser.fftSize);

    let lastTick = performance.now();

    const computeRms = (bytes: Uint8Array): number => {
      let sum = 0;
      for (let i = 0; i < bytes.length; i++) {
        const sample = (bytes[i] - 128) / 128;
        sum += sample * sample;
      }
      return Math.sqrt(sum / bytes.length);
    };

    const tick = () => {
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }

      leftAnalyser.getByteTimeDomainData(leftData);
      rightAnalyser.getByteTimeDomainData(rightData);

      const leftRms = computeRms(leftData);
      const rightRms = computeRms(rightData);
      const leftDb = rmsToDb(leftRms);
      const rightDb = rmsToDb(rightRms);

      // Peak hold — 500ms ring buffer
      const now = performance.now();
      const peakWindowMs = 500;
      const maxSamples = Math.ceil(peakWindowMs / 16); // ~30 samples at 60fps
      leftPeakBufRef.current.push(leftDb);
      rightPeakBufRef.current.push(rightDb);
      if (leftPeakBufRef.current.length > maxSamples) leftPeakBufRef.current.shift();
      if (rightPeakBufRef.current.length > maxSamples) rightPeakBufRef.current.shift();
      const leftPeakDb = Math.max(...leftPeakBufRef.current);
      const rightPeakDb = Math.max(...rightPeakBufRef.current);

      const leftState = classify(leftPeakDb);
      const rightState = classify(rightPeakDb);
      const bothSilent = leftState === 'silent' && rightState === 'silent';
      const eitherSilent = leftState === 'silent' || rightState === 'silent';
      const eitherActive = leftState === 'active' || rightState === 'active';
      const mono = eitherSilent && eitherActive;

      // Dropout detection: both channels silent transition.
      // Skip during warmup window — WebAudio setup, first getUserMedia buffer
      // fills, and tab focus transitions produce sub-second silences that
      // would falsely register as dropouts otherwise.
      const elapsed = now - lastTick;
      lastTick = now;
      const inWarmup = now - streamStartRef.current < WARMUP_MS;
      if (bothSilent) {
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now;
        }
      } else {
        if (silenceStartRef.current !== null) {
          const silenceDuration = now - silenceStartRef.current;
          if (
            !inWarmup &&
            silenceDuration >= DROPOUT_MIN_MS &&
            silenceDuration <= DROPOUT_MAX_MS
          ) {
            dropoutTimestampsRef.current.push(Date.now());
            totalDropoutsRef.current += 1;
          }
          silenceStartRef.current = null;
        }
      }

      // Prune dropouts older than 60s from recent counter
      const sixtySecondsAgo = Date.now() - 60_000;
      while (
        dropoutTimestampsRef.current.length > 0 &&
        dropoutTimestampsRef.current[0] < sixtySecondsAgo
      ) {
        dropoutTimestampsRef.current.shift();
      }

      void elapsed;

      setHealth({
        leftLevel: leftRms,
        rightLevel: rightRms,
        leftPeakDb,
        rightPeakDb,
        leftState,
        rightState,
        mono,
        totalDropouts: totalDropoutsRef.current,
        recentDropouts: dropoutTimestampsRef.current.length,
        lastDropoutAt: dropoutTimestampsRef.current.length > 0
          ? dropoutTimestampsRef.current[dropoutTimestampsRef.current.length - 1]
          : null,
      });

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      try { splitter.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      try { audioContext.close(); } catch {}
      audioContextRef.current = null;
      splitterRef.current = null;
      leftAnalyserRef.current = null;
      rightAnalyserRef.current = null;
      leftPeakBufRef.current = [];
      rightPeakBufRef.current = [];
      silenceStartRef.current = null;
      dropoutTimestampsRef.current = [];
      totalDropoutsRef.current = 0;
    };
  }, [stream]);

  return health;
}
