'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { ArchiveSerialized } from '@/types/broadcast';

interface ArchivePlayerContextValue {
  currentArchive: ArchiveSerialized | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  play: (archive: ArchiveSerialized) => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
}

const ArchivePlayerContext = createContext<ArchivePlayerContextValue | null>(null);

export function useArchivePlayer() {
  const ctx = useContext(ArchivePlayerContext);
  if (!ctx) throw new Error('useArchivePlayer must be used within ArchivePlayerProvider');
  return ctx;
}

export { ArchivePlayerContext };

export function ArchivePlayerProvider({ children }: { children: ReactNode }) {
  const [currentArchive, setCurrentArchive] = useState<ArchiveSerialized | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cumulativeTimeRef = useRef(0);
  const streamCountedRef = useRef<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'none';

      audio.addEventListener('timeupdate', () => {
        setCurrentTime(audio.currentTime);
      });
      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration);
        setIsLoading(false);
      });
      audio.addEventListener('playing', () => {
        setIsPlaying(true);
        setIsLoading(false);
      });
      audio.addEventListener('pause', () => {
        setIsPlaying(false);
      });
      audio.addEventListener('waiting', () => {
        setIsLoading(true);
      });
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
      });
      audio.addEventListener('error', () => {
        setIsPlaying(false);
        setIsLoading(false);
      });

      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  // Track cumulative playback for stream count (300s threshold)
  useEffect(() => {
    if (!isPlaying || !currentArchive) return;

    const interval = setInterval(() => {
      cumulativeTimeRef.current += 1;
      if (
        cumulativeTimeRef.current >= 300 &&
        streamCountedRef.current !== currentArchive.id
      ) {
        streamCountedRef.current = currentArchive.id;
        fetch(`/api/archives/${currentArchive.slug}/stream`, { method: 'POST' }).catch(() => {});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, currentArchive]);

  const play = useCallback((archive: ArchiveSerialized) => {
    const audio = getAudio();

    if (currentArchive?.id !== archive.id) {
      // Switching to a new archive
      audio.pause();
      audio.src = archive.recordingUrl;
      audio.currentTime = 0;
      setCurrentArchive(archive);
      setCurrentTime(0);
      setDuration(archive.duration || 0);
      cumulativeTimeRef.current = 0;
      setIsLoading(true);
      audio.play().catch(() => {
        setIsLoading(false);
      });
    } else if (!isPlaying) {
      // Resume same archive
      audio.play().catch(() => {});
    }
  }, [currentArchive, isPlaying, getAudio]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (!currentArchive) return;
    if (isPlaying) {
      pause();
    } else {
      play(currentArchive);
    }
  }, [currentArchive, isPlaying, pause, play]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const value = useMemo<ArchivePlayerContextValue>(() => ({
    currentArchive,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    play,
    pause,
    toggle,
    seek,
  }), [currentArchive, isPlaying, isLoading, currentTime, duration, play, pause, toggle, seek]);

  return (
    <ArchivePlayerContext.Provider value={value}>
      {children}
    </ArchivePlayerContext.Provider>
  );
}
