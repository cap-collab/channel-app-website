'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Hook to get audio level from an HTMLAudioElement.
 * Uses Web Audio API to analyze the audio output.
 */
export function useAudioElementLevel(audioElement: HTMLAudioElement | null) {
  const [level, setLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const connectedElementRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioElement) {
      setLevel(0);
      return;
    }

    // Only create a new source if we haven't connected to this element before
    // MediaElementAudioSourceNode can only be created once per element
    if (connectedElementRef.current === audioElement && audioContextRef.current && analyserRef.current) {
      return;
    }

    // Clean up previous context if connecting to a different element
    if (audioContextRef.current && connectedElementRef.current !== audioElement) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      audioContextRef.current.close();
      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    }

    // Create audio context and analyser
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    connectedElementRef.current = audioElement;

    try {
      // Connect element to analyser (can only be done once per element)
      const source = audioContext.createMediaElementSource(audioElement);
      sourceRef.current = source;

      // Connect source -> analyser -> destination (speakers)
      source.connect(analyser);
      analyser.connect(audioContext.destination);
    } catch (err) {
      console.warn('Could not connect audio element to analyser:', err);
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = async () => {
      if (!analyserRef.current || !audioContextRef.current) return;

      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
        } catch {
          // Ignore
        }
      }

      analyserRef.current.getByteFrequencyData(dataArray);

      // Calculate RMS for accurate level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const normalizedLevel = Math.min(rms / 128, 1);
      setLevel(normalizedLevel);

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioElement]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return level;
}
