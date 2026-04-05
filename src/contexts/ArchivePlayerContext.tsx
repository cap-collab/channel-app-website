'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { ArchiveSerialized } from '@/types/broadcast';
import { useAuthContext } from '@/contexts/AuthContext';

function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getApps()[0];
}

function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  let sessionId = sessionStorage.getItem('channelSessionId');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('channelSessionId', sessionId);
  }
  return sessionId;
}

interface ArchivePlayerContextValue {
  currentArchive: ArchiveSerialized | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  listenerCount: number;
  isGated: boolean;
  clearGate: () => void;
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

const GATE_STORAGE_KEY = 'archive_cumulative_seconds';
const GATE_THRESHOLD_SECONDS = 600;

export function ArchivePlayerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthContext();
  const [currentArchive, setCurrentArchive] = useState<ArchiveSerialized | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [isGated, setIsGated] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cumulativeTimeRef = useRef(0);
  const gateSecondsRef = useRef(0);
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

  // Initialize gate counter from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GATE_STORAGE_KEY);
      if (stored) gateSecondsRef.current = parseInt(stored, 10) || 0;
    } catch {}
  }, []);

  // Archive gate: track cumulative listening for unauthenticated users
  useEffect(() => {
    if (isAuthenticated) return;
    if (!isPlaying) return;
    if (gateSecondsRef.current >= GATE_THRESHOLD_SECONDS) {
      audioRef.current?.pause();
      setIsGated(true);
      return;
    }

    const interval = setInterval(() => {
      gateSecondsRef.current += 1;

      if (gateSecondsRef.current % 5 === 0) {
        try { localStorage.setItem(GATE_STORAGE_KEY, String(gateSecondsRef.current)); } catch {}
      }

      if (gateSecondsRef.current >= GATE_THRESHOLD_SECONDS) {
        try { localStorage.setItem(GATE_STORAGE_KEY, String(gateSecondsRef.current)); } catch {}
        audioRef.current?.pause();
        setIsGated(true);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      try { localStorage.setItem(GATE_STORAGE_KEY, String(gateSecondsRef.current)); } catch {}
    };
  }, [isPlaying, isAuthenticated]);

  const clearGate = useCallback(() => {
    setIsGated(false);
  }, []);

  // Lock screen / Media Session metadata for archive playback
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentArchive) return;

    const djNames = currentArchive.djs.map(d => d.name).join(', ');
    const artworkUrl = currentArchive.showImageUrl || currentArchive.djs[0]?.photoUrl;
    const fallbackArtworkUrl = typeof window !== 'undefined' ? `${window.location.origin}/apple-touch-icon.png` : '';

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentArchive.showName || 'Archive',
      artist: djNames || undefined,
      artwork: artworkUrl
        ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [{ src: fallbackArtworkUrl, sizes: '180x180', type: 'image/png' }],
    });

    if (isPlaying) {
      try {
        navigator.mediaSession.setActionHandler('pause', () => { audioRef.current?.pause(); });
        navigator.mediaSession.setActionHandler('play', () => { audioRef.current?.play().catch(() => {}); });
      } catch {
        // Browser doesn't support these actions
      }

      // Disable skip/seek buttons
      const disableActions: MediaSessionAction[] = ['seekforward', 'seekbackward', 'previoustrack', 'nexttrack'];
      for (const action of disableActions) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      }

      // Update position state periodically for lock screen progress bar
      const updatePosition = () => {
        if (duration > 0 && audioRef.current) {
          try {
            navigator.mediaSession.setPositionState({
              duration,
              position: Math.min(audioRef.current.currentTime, duration),
              playbackRate: 1,
            });
          } catch {}
        }
      };
      updatePosition();
      const posInterval = setInterval(updatePosition, 30_000);
      return () => clearInterval(posInterval);
    }
  }, [currentArchive, isPlaying, duration]);

  // Firebase presence for archive listeners — same .info/connected pattern as broadcast
  useEffect(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const app = getFirebaseApp();
    const rtdb = getDatabase(app);
    const presenceRef = ref(rtdb, `presence/archive/${sessionId}`);
    const connectedRef = ref(rtdb, '.info/connected');

    let authed = false;
    let unsubConnected: (() => void) | null = null;

    const setupPresence = () => {
      unsubConnected = onValue(connectedRef, (snap) => {
        if (!snap.val()) return;

        if (isPlaying) {
          onDisconnect(presenceRef).remove().then(() => {
            set(presenceRef, true);
          });
        } else {
          remove(presenceRef);
        }
      });
    };

    const auth = getAuth(app);
    auth.authStateReady().then(() => {
      if (!auth.currentUser) {
        return signInAnonymously(auth).catch((err) => {
          console.error('Firebase anonymous auth failed:', err);
        });
      }
    }).then(() => {
      authed = true;
      setupPresence();
    });

    return () => {
      if (unsubConnected) unsubConnected();
      if (authed) {
        remove(presenceRef);
      }
    };
  }, [isPlaying]);

  // Subscribe to archive listener count
  useEffect(() => {
    const app = getFirebaseApp();
    const rtdb = getDatabase(app);
    const presenceRef = ref(rtdb, 'presence/archive');

    const unsubscribe = onValue(presenceRef, (snapshot) => {
      setListenerCount(snapshot.size || 0);
    });

    return () => unsubscribe();
  }, []);

  const play = useCallback((archive: ArchiveSerialized) => {
    if (isGated && !isAuthenticated) return;
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
  }, [currentArchive, isPlaying, getAudio, isGated, isAuthenticated]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (!currentArchive) return;
    if (isGated && !isAuthenticated) return;
    if (isPlaying) {
      pause();
    } else {
      play(currentArchive);
    }
  }, [currentArchive, isPlaying, pause, play, isGated, isAuthenticated]);

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
    listenerCount,
    isGated,
    clearGate,
    play,
    pause,
    toggle,
    seek,
  }), [currentArchive, isPlaying, isLoading, currentTime, duration, listenerCount, isGated, clearGate, play, pause, toggle, seek]);

  return (
    <ArchivePlayerContext.Provider value={value}>
      {children}
    </ArchivePlayerContext.Provider>
  );
}
