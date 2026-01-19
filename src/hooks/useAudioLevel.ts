'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export function useAudioLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Memoized update loop that can be restarted
  const startUpdateLoop = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const updateLevel = async () => {
      if (!isRunningRef.current) return;

      const audioContext = audioContextRef.current;
      const analyser = analyserRef.current;
      const dataArray = dataArrayRef.current;

      if (!analyser || !audioContext || !dataArray) {
        isRunningRef.current = false;
        return;
      }

      // Resume audio context if suspended (browser auto-suspends for power saving)
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch {
          // Ignore resume errors, will retry on next frame
        }
      }

      // Only read data if context is running
      if (audioContext.state === 'running') {
        // Use time-domain data (waveform) for accurate level metering
        // This gives us actual sample amplitudes, not frequency magnitudes
        analyser.getByteTimeDomainData(dataArray);

        // Calculate peak level from waveform data
        // Byte time domain data is centered at 128 (silence = 128, range 0-255)
        let peak = 0;
        for (let i = 0; i < dataArray.length; i++) {
          // Get absolute deviation from center (128)
          const amplitude = Math.abs(dataArray[i] - 128);
          if (amplitude > peak) {
            peak = amplitude;
          }
        }

        // Normalize to 0-1 range (max deviation is 128)
        const normalizedLevel = Math.min(peak / 128, 1);
        setLevel(normalizedLevel);
      }

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, []);

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }

    // Check if stream has active audio tracks
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setLevel(0);
      return;
    }

    // Create audio context and analyser
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    // Use larger FFT size for more accurate time-domain sampling
    analyser.fftSize = 2048;
    // Lower smoothing for more responsive metering
    analyser.smoothingTimeConstant = 0.3;

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    // For time-domain data, we use fftSize (not frequencyBinCount)
    dataArrayRef.current = new Uint8Array(analyser.fftSize);

    // Connect stream to analyser
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    // Handle track state changes - reconnect when tracks unmute or become live again
    const handleTrackEvent = async () => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      // Resume context if it was suspended
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // Ignore
        }
      }

      // Restart the update loop if it stopped
      if (!isRunningRef.current && analyserRef.current) {
        startUpdateLoop();
      }
    };

    // Listen for track events that indicate audio state changes
    audioTracks.forEach((track) => {
      track.addEventListener('unmute', handleTrackEvent);
      track.addEventListener('ended', handleTrackEvent);
    });

    // Also handle visibility changes - browser may suspend when tab is hidden
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleTrackEvent();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle audio context state changes
    const handleStateChange = () => {
      if (audioContext.state === 'running' && !isRunningRef.current) {
        startUpdateLoop();
      }
    };
    audioContext.addEventListener('statechange', handleStateChange);

    // Start the update loop
    startUpdateLoop();

    // Cleanup
    return () => {
      isRunningRef.current = false;

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      audioTracks.forEach((track) => {
        track.removeEventListener('unmute', handleTrackEvent);
        track.removeEventListener('ended', handleTrackEvent);
      });

      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (audioContextRef.current) {
        audioContextRef.current.removeEventListener('statechange', handleStateChange);
        audioContextRef.current.close();
      }

      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
      dataArrayRef.current = null;
    };
  }, [stream, startUpdateLoop]);

  return level;
}
