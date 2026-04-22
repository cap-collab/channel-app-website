'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode, type MutableRefObject } from 'react';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { ArchiveSerialized } from '@/types/broadcast';
import { useAuthContext } from '@/contexts/AuthContext';
import { useBroadcastStreamContext } from '@/contexts/BroadcastStreamContext';
import { captureEvent } from '@/lib/posthog';
import { registerAudio, pauseOthers } from '@/lib/audio-exclusive';

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
  gateAttempt: number;
  clearGate: () => void;
  play: (archive: ArchiveSerialized) => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  /** The top/featured archive — always available for the GlobalBroadcastBar fallback */
  featuredArchive: ArchiveSerialized | null;
  setFeaturedArchive: (archive: ArchiveSerialized | null) => void;
  // Ref callback for "locked in" message — set by consuming component (GlobalBroadcastBar)
  onLockedInRef: MutableRefObject<(() => void) | null>;
  // Ref callback for 5-minute listen milestone (heart-nudge re-trigger)
  onListenMilestoneRef: MutableRefObject<(() => void) | null>;
}

const ArchivePlayerContext = createContext<ArchivePlayerContextValue | null>(null);

export function useArchivePlayer() {
  const ctx = useContext(ArchivePlayerContext);
  if (!ctx) throw new Error('useArchivePlayer must be used within ArchivePlayerProvider');
  return ctx;
}

export { ArchivePlayerContext };

const GATE_STORAGE_KEY = 'archive_cumulative_seconds';
const GATE_TRIGGER_KEY = 'archive_gate_trigger';
const GATE_THRESHOLD_SECONDS = 960;

export function ArchivePlayerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const { pause: pauseBroadcast } = useBroadcastStreamContext();
  const [currentArchive, setCurrentArchive] = useState<ArchiveSerialized | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [isGated, setIsGated] = useState(false);
  const [gateAttempt, setGateAttempt] = useState(0);
  const [featuredArchive, setFeaturedArchive] = useState<ArchiveSerialized | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cumulativeTimeRef = useRef(0);
  const gateSecondsRef = useRef(0);
  const streamCountedRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSeeking = useRef(false);
  // True while we're intentionally resetting audio.src during a retry.
  // Prevents the synthetic error event from triggering another retry cascade.
  const isRetryingRef = useRef(false);
  // True after retries are exhausted; next play() must force a fresh load.
  const needsHardReloadRef = useRef(false);
  // Playhead position to restore when recovering from a failed retry cycle.
  const resumePositionRef = useRef(0);
  const playbackStartedAtRef = useRef<number | null>(null);
  const archiveLockedInFiredRef = useRef<string | null>(null);
  const archiveMilestoneFiredRef = useRef<string | null>(null);
  const onLockedInRef = useRef<(() => void) | null>(null);
  const onListenMilestoneRef = useRef<(() => void) | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
        registerAudio('archive', null);
      }
    };
  }, []);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'metadata';

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
        retryCountRef.current = 0;
        if (!playbackStartedAtRef.current) {
          playbackStartedAtRef.current = Date.now();
          captureEvent('playback_started', { type: 'archive', protocol: 'native' });
        }
      });
      audio.addEventListener('pause', () => {
        setIsPlaying(false);
      });
      audio.addEventListener('waiting', () => {
        // Don't flip back to loading if we've errored and are awaiting user action
        if (needsHardReloadRef.current) return;
        setIsLoading(true);
      });
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (playbackStartedAtRef.current) {
          const sessionDuration = Math.round((Date.now() - playbackStartedAtRef.current) / 1000);
          captureEvent('playback_ended', { type: 'archive', session_duration: sessionDuration });
          playbackStartedAtRef.current = null;
        }
      });
      audio.addEventListener('error', () => {
        // Ignore errors caused by rapid seeking (aborted range requests)
        if (isSeeking.current) return;
        // Ignore the synthetic error that fires when we clear src during recovery
        if (isRetryingRef.current) return;
        // Stop playback and mark for hard reload on next play() click.
        // User's explicit play press is a better signal than auto-retry loops.
        console.error('🔄 Archive playback error; stopping. Click play to retry.');
        resumePositionRef.current = audio.currentTime || resumePositionRef.current;
        needsHardReloadRef.current = true;
        setIsPlaying(false);
        setIsLoading(false);
        captureEvent('playback_error', { type: 'archive', message: 'Playback error' });
        if (playbackStartedAtRef.current) {
          const sessionDuration = Math.round((Date.now() - playbackStartedAtRef.current) / 1000);
          captureEvent('playback_ended', { type: 'archive', session_duration: sessionDuration });
          playbackStartedAtRef.current = null;
        }
      });

      audioRef.current = audio;
      registerAudio('archive', audio);
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
        fetch(`/api/archives/${currentArchive.slug}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user?.uid || null }),
        }).catch(() => {});
      }
      // Fire heart-nudge milestone at 300s (5 min), once per archive
      if (
        cumulativeTimeRef.current >= 300 &&
        archiveMilestoneFiredRef.current !== currentArchive.id
      ) {
        archiveMilestoneFiredRef.current = currentArchive.id;
        onListenMilestoneRef.current?.();
      }
      // Fire "locked in" message at 900s (15 min)
      if (
        cumulativeTimeRef.current >= 900 &&
        archiveLockedInFiredRef.current !== currentArchive.id
      ) {
        archiveLockedInFiredRef.current = currentArchive.id;
        onLockedInRef.current?.();
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

  // Clear gate when user becomes authenticated; log the trigger archive to stream history
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (isGated) setIsGated(false);

    try {
      const raw = localStorage.getItem(GATE_TRIGGER_KEY);
      if (!raw) return;
      const trigger = JSON.parse(raw) as { slug?: string; archiveId?: string };
      if (trigger?.slug) {
        fetch(`/api/archives/${trigger.slug}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, gateTriggered: true }),
        }).catch(() => {});
      }
      localStorage.removeItem(GATE_TRIGGER_KEY);
    } catch {}
  }, [isAuthenticated, isGated, user]);

  // Archive gate: track cumulative listening for unauthenticated users
  useEffect(() => {
    if (isAuthenticated) return;
    if (!isPlaying) return;
    if (gateSecondsRef.current >= GATE_THRESHOLD_SECONDS) {
      if (currentArchive) {
        try {
          localStorage.setItem(GATE_TRIGGER_KEY, JSON.stringify({
            slug: currentArchive.slug,
            archiveId: currentArchive.id,
            triggeredAt: Date.now(),
          }));
        } catch {}
      }
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
        if (currentArchive) {
          try {
            localStorage.setItem(GATE_TRIGGER_KEY, JSON.stringify({
              slug: currentArchive.slug,
              archiveId: currentArchive.id,
              triggeredAt: Date.now(),
            }));
          } catch {}
        }
        audioRef.current?.pause();
        setIsGated(true);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      try { localStorage.setItem(GATE_STORAGE_KEY, String(gateSecondsRef.current)); } catch {}
    };
  }, [isPlaying, isAuthenticated, currentArchive]);

  const clearGate = useCallback(() => {
    setIsGated(false);
  }, []);

  // Lock screen / Media Session metadata for archive playback
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentArchive) return;

    const djNames = currentArchive.djs.map(d => d.name).join(', ');
    const rawArtworkUrl = currentArchive.showImageUrl || currentArchive.djs[0]?.photoUrl;
    const fallbackArtworkUrl = typeof window !== 'undefined' ? `${window.location.origin}/apple-touch-icon.png` : '';

    // iOS only uses the first artwork entry and rejects images > 128x128
    // (shows grey placeholder instead). Proxy through Next.js for same-origin.
    const artworkUrl = rawArtworkUrl
      ? `/_next/image?url=${encodeURIComponent(rawArtworkUrl)}&w=128&q=75`
      : null;

    const artwork = artworkUrl
      ? [
          { src: artworkUrl, sizes: '128x128', type: 'image/png' },
        ]
      : [{ src: fallbackArtworkUrl, sizes: '128x128', type: 'image/png' }];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentArchive.showName || 'Archive',
      artist: djNames || undefined,
      album: 'channel radio',
      artwork,
    });

    if (isPlaying) {
      navigator.mediaSession.playbackState = 'playing';
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
    } else {
      navigator.mediaSession.playbackState = 'paused';
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
    if (isGated && !isAuthenticated) {
      setGateAttempt(prev => prev + 1);
      return;
    }
    const audio = getAudio();

    // Stop live/restream playback so the sticky header flips to archive and
    // the live hook's iOS auto-resume doesn't fight us. pauseOthers() below
    // handles the DOM element; this updates broadcast context state.
    pauseBroadcast();

    // Clear any pending retry from a prior failure and reset the counter
    // so the user's explicit play click always gets a fresh attempt.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    isRetryingRef.current = false;

    if (currentArchive?.id !== archive.id) {
      // Switching to a new archive — end previous session
      if (playbackStartedAtRef.current) {
        const sessionDuration = Math.round((Date.now() - playbackStartedAtRef.current) / 1000);
        captureEvent('playback_ended', { type: 'archive', session_duration: sessionDuration });
        playbackStartedAtRef.current = null;
      }
      audio.pause();
      audio.src = archive.recordingUrl;
      audio.currentTime = 0;
      setCurrentArchive(archive);
      setCurrentTime(0);
      setDuration(archive.duration || 0);
      cumulativeTimeRef.current = 0;
      archiveLockedInFiredRef.current = null;
      archiveMilestoneFiredRef.current = null;
      resumePositionRef.current = 0;
      setIsLoading(true);
      pauseOthers('archive');
      audio.play().catch(() => {
        setIsLoading(false);
      });
    } else if (!isPlaying) {
      // Resume same archive. If retries previously exhausted (or src looks
      // stale), force a fresh load and restore the playhead position.
      if (needsHardReloadRef.current || !audio.src || audio.src === window.location.href) {
        needsHardReloadRef.current = false;
        const resumeAt = resumePositionRef.current || currentTime;
        audio.src = archive.recordingUrl;
        // Need to wait for metadata before setting currentTime on some browsers
        const setTime = () => {
          audio.currentTime = resumeAt;
          audio.removeEventListener('loadedmetadata', setTime);
        };
        audio.addEventListener('loadedmetadata', setTime);
        setIsLoading(true);
      }
      pauseOthers('archive');
      audio.play().catch(() => { setIsLoading(false); });
    }
  }, [currentArchive, isPlaying, currentTime, getAudio, isGated, isAuthenticated, pauseBroadcast]);

  const pause = useCallback(() => {
    if (playbackStartedAtRef.current) {
      const sessionDuration = Math.round((Date.now() - playbackStartedAtRef.current) / 1000);
      captureEvent('playback_ended', { type: 'archive', session_duration: sessionDuration });
      playbackStartedAtRef.current = null;
    }
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (!currentArchive) return;
    if (isGated && !isAuthenticated) {
      setGateAttempt(prev => prev + 1);
      return;
    }
    if (isPlaying) {
      pause();
    } else {
      play(currentArchive);
    }
  }, [currentArchive, isPlaying, pause, play, isGated, isAuthenticated]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Update UI immediately
    setCurrentTime(time);

    // Debounce the actual audio seek to avoid rapid range request errors
    isSeeking.current = true;
    retryCountRef.current = 0;
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null;
      audio.currentTime = time;
      isSeeking.current = false;
    }, 150);
  }, []);

  const value = useMemo<ArchivePlayerContextValue>(() => ({
    currentArchive,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    listenerCount,
    isGated,
    gateAttempt,
    clearGate,
    play,
    pause,
    toggle,
    seek,
    featuredArchive,
    setFeaturedArchive,
    onLockedInRef,
    onListenMilestoneRef,
  }), [currentArchive, isPlaying, isLoading, currentTime, duration, listenerCount, isGated, gateAttempt, clearGate, play, pause, toggle, seek, featuredArchive]);

  return (
    <ArchivePlayerContext.Provider value={value}>
      {children}
    </ArchivePlayerContext.Provider>
  );
}
