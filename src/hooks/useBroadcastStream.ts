'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { getFirestore, collection, query, where, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { BroadcastSlotSerialized, ROOM_NAME } from '@/types/broadcast';
import Hls from 'hls.js';

// HLS stream URL - proxied through our API to add CORS headers
const HLS_URL = '/api/hls/channel-radio/live.m3u8';

// Detect if browser is Safari (has native HLS support)
function isSafariBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  return /^((?!chrome|android).)*safari/i.test(ua);
}

// Detect if on mobile - use HLS for all mobile browsers (more reliable than WebRTC)
function isMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

// Should use HLS instead of WebRTC
function shouldUseHLS(): boolean {
  return isMobileBrowser() || isSafariBrowser();
}

// Cached token for preloading
let cachedToken: { token: string; url: string } | null = null;
let tokenFetchPromise: Promise<{ token: string; url: string }> | null = null;

// Prewarm by fetching token in advance
async function prewarmToken(): Promise<void> {
  if (cachedToken || tokenFetchPromise) return;

  console.log('🔥 Prewarming LiveKit token...');
  tokenFetchPromise = fetch(
    `/api/livekit/token?room=${ROOM_NAME}&username=web-listener-${Date.now()}&canPublish=false`
  )
    .then(res => res.json())
    .then(data => {
      if (data.token && data.url) {
        cachedToken = { token: data.token, url: data.url };
        console.log('🔥 Token prewarmed');
      }
      return data;
    })
    .catch(err => {
      console.error('🔥 Prewarm failed:', err);
      tokenFetchPromise = null;
      throw err;
    });
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

// Generate a unique session ID for presence tracking (matches iOS ListenerCountService)
function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  let sessionId = sessionStorage.getItem('channelSessionId');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('channelSessionId', sessionId);
  }
  return sessionId;
}

// Ensure user is signed in (anonymously if needed) before writing to Firebase
// Matches iOS ListenerCountService.ensureAuthAndExecute()
async function ensureAuthAndExecute(action: () => void): Promise<void> {
  const app = getFirebaseApp();
  const auth = getAuth(app);

  if (auth.currentUser) {
    action();
    return;
  }

  try {
    await signInAnonymously(auth);
    action();
  } catch (err) {
    console.error('Firebase anonymous auth failed:', err);
    // Graceful degradation - don't write presence if auth fails
  }
}

interface UseBroadcastStreamReturn {
  isPlaying: boolean;
  isLoading: boolean;
  isLive: boolean;
  currentShow: BroadcastSlotSerialized | null;
  currentDJ: string | null;
  error: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  listenerCount: number;
  audioStream: MediaStream | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useBroadcastStream(statusIsLive?: boolean): UseBroadcastStreamReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [currentShow, setCurrentShow] = useState<BroadcastSlotSerialized | null>(null);
  const [currentDJ, setCurrentDJ] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listenerCount, setListenerCount] = useState(0);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Subscribe to current live slot from Firestore
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    // Query for live broadcast slots
    // No orderBy to avoid needing a composite index - there should only be one live slot at a time
    const slotsRef = collection(db, 'broadcast-slots');
    const q = query(
      slotsRef,
      where('status', '==', 'live'),
      limit(1)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          const slot: BroadcastSlotSerialized = {
            id: doc.id,
            stationId: data.stationId || 'broadcast',
            showName: data.showName || 'Live Broadcast',
            djName: data.djName,
            djUserId: data.djUserId,
            djEmail: data.djEmail,
            djSlots: data.djSlots,
            startTime: (data.startTime as Timestamp).toMillis(),
            endTime: (data.endTime as Timestamp).toMillis(),
            broadcastToken: data.broadcastToken,
            tokenExpiresAt: (data.tokenExpiresAt as Timestamp).toMillis(),
            createdAt: (data.createdAt as Timestamp).toMillis(),
            createdBy: data.createdBy,
            status: data.status,
            broadcastType: data.broadcastType,
            liveDjUserId: data.liveDjUserId,
            liveDjUsername: data.liveDjUsername,
            liveDjPhotoUrl: data.liveDjPhotoUrl,
            liveDjPromoText: data.liveDjPromoText,
            liveDjPromoHyperlink: data.liveDjPromoHyperlink,
            showPromoText: data.showPromoText,
            showPromoHyperlink: data.showPromoHyperlink,
          };
          setCurrentShow(slot);

          // Find current DJ name:
          // Priority: djSlot.djUsername > djSlot.liveDjUsername > djSlot.djName > slot.liveDjUsername > slot.djName
          // This ensures we use the DJ's chat username if available, not just the admin-set name
          let djNameToUse: string | null = null;
          if (slot.djSlots && slot.djSlots.length > 0) {
            const now = Date.now();
            const currentDjSlot = slot.djSlots.find(
              (djSlot) => djSlot.startTime <= now && djSlot.endTime > now
            );
            if (currentDjSlot) {
              // Priority: djUsername (chat username) > liveDjUsername > djName (admin-set)
              djNameToUse = currentDjSlot.djUsername || currentDjSlot.liveDjUsername || currentDjSlot.djName || null;
            }
          }
          setCurrentDJ(djNameToUse || slot.liveDjUsername || slot.djName || null);
          setIsLive(true);
          // Prewarm token as soon as we detect a live broadcast
          prewarmToken();
        } else {
          setCurrentShow(null);
          setCurrentDJ(null);
          setIsLive(false);
          // If we were connected to LiveKit, disconnect when broadcast ends
          if (roomRef.current) {
            roomRef.current.disconnect();
            roomRef.current = null;
            setIsPlaying(false);
          }
        }
      },
      (err) => {
        console.error('Broadcast slot subscription error:', err);
      }
    );

    return () => unsubscribe();
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.srcObject = null;
      }
      // Clean up presence on unmount
      const sessionId = getSessionId();
      if (sessionId) {
        const app = getFirebaseApp();
        const auth = getAuth(app);
        if (auth.currentUser) {
          const db = getDatabase(app);
          const presenceRef = ref(db, `presence/broadcast/${sessionId}`);
          remove(presenceRef);
        }
      }
    };
  }, []);

  // Handle track subscription - play audio when we get a remote track
  const handleTrackSubscribed = useCallback(
    (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      console.log('🎵 Track subscribed:', track.kind, 'from', participant.identity);

      if (track.kind === Track.Kind.Audio) {
        // Audio element should already exist from play() warmup
        // Create one as fallback just in case
        if (!audioElementRef.current) {
          audioElementRef.current = new Audio();
        }

        // Attach the track to the audio element
        track.attach(audioElementRef.current);

        // Get MediaStream from the track for audio level visualization
        const mediaStreamTrack = track.mediaStreamTrack;
        if (mediaStreamTrack) {
          setAudioStream(new MediaStream([mediaStreamTrack]));
        }

        // Set playsinline for iOS
        (audioElementRef.current as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
        audioElementRef.current.setAttribute('playsinline', 'true');
        audioElementRef.current.setAttribute('webkit-playsinline', 'true');

        audioElementRef.current.play()
          .then(() => {
            console.log('🎵 Audio playing');
            setIsPlaying(true);
            setIsLoading(false);
            setError(null);
          })
          .catch((err) => {
            console.error('🎵 Audio play error:', err);
            setError('Failed to play audio. Click to try again.');
            setIsLoading(false);
          });
      }
    },
    []
  );

  const handleTrackUnsubscribed = useCallback(
    (track: RemoteTrack) => {
      console.log('🎵 Track unsubscribed:', track.kind);
      if (track.kind === Track.Kind.Audio && audioElementRef.current) {
        track.detach(audioElementRef.current);
        setIsPlaying(false);
      }
    },
    []
  );

  const play = useCallback(async () => {
    if (!isLive) {
      setError('Stream not available');
      return;
    }

    setIsLoading(true);
    setError(null);

    const useHLS = shouldUseHLS();
    console.log('🎵 Starting playback - useHLS:', useHLS);

    // Create audio element if needed
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
    }

    // Set mobile-friendly attributes
    audioElementRef.current.setAttribute('playsinline', 'true');
    audioElementRef.current.setAttribute('webkit-playsinline', 'true');
    // Enable CORS for captureStream to work
    audioElementRef.current.crossOrigin = 'anonymous';

    // Helper to capture audio stream from element for visualization
    const captureAudioStream = () => {
      if (audioElementRef.current) {
        try {
          // captureStream() returns a MediaStream we can analyze
          const stream = (audioElementRef.current as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
          if (stream) {
            setAudioStream(stream);
          }
        } catch (err) {
          console.warn('Could not capture audio stream:', err);
        }
      }
    };

    // Use HLS for mobile/Safari - more reliable than WebRTC
    if (useHLS) {
      console.log('🎵 Using HLS stream:', HLS_URL);
      try {
        // Check if Safari with native HLS support
        if (audioElementRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('🎵 Using native HLS (Safari)');
          audioElementRef.current.src = HLS_URL;
          await audioElementRef.current.play();
          captureAudioStream();
          setIsPlaying(true);
          setIsLoading(false);
        } else if (Hls.isSupported()) {
          console.log('🎵 Using HLS.js');
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          hlsRef.current = hls;

          hls.loadSource(HLS_URL);
          hls.attachMedia(audioElementRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, async () => {
            console.log('🎵 HLS manifest loaded');
            try {
              await audioElementRef.current!.play();
              captureAudioStream();
              setIsPlaying(true);
              setIsLoading(false);
            } catch (err) {
              console.error('🎵 HLS play error:', err);
              setError('Tap to play');
              setIsLoading(false);
            }
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            console.error('🎵 HLS error:', data);
            if (data.fatal) {
              setError('Stream error');
              setIsLoading(false);
            }
          });
        } else {
          setError('HLS not supported');
          setIsLoading(false);
        }

        // Register presence
        const sessionId = getSessionId();
        if (sessionId) {
          ensureAuthAndExecute(() => {
            const db = getDatabase(getFirebaseApp());
            const presenceRef = ref(db, `presence/broadcast/${sessionId}`);
            onDisconnect(presenceRef).remove();
            set(presenceRef, true);
          });
        }
      } catch (err) {
        console.error('🎵 HLS error:', err);
        setError('Failed to play');
        setIsLoading(false);
      }
      return;
    }

    // Desktop: Use WebRTC via LiveKit
    try {
      // Use cached token if available, otherwise fetch fresh
      let tokenData: { token: string; url: string; error?: string };

      if (cachedToken) {
        console.log('⚡ Using prewarmed token');
        tokenData = cachedToken;
        cachedToken = null; // Clear after use
      } else if (tokenFetchPromise) {
        console.log('⏳ Waiting for prewarm to complete...');
        tokenData = await tokenFetchPromise;
        cachedToken = null;
      } else {
        console.log('📡 Fetching fresh token...');
        const res = await fetch(
          `/api/livekit/token?room=${ROOM_NAME}&username=web-listener-${Date.now()}&canPublish=false`
        );
        tokenData = await res.json();
      }

      tokenFetchPromise = null;

      if (tokenData.error) {
        setError(tokenData.error);
        setIsLoading(false);
        return;
      }

      const data = tokenData;

      // Create and connect to the room
      const room = new Room();
      roomRef.current = room;

      // Set up event handlers
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

      room.on(RoomEvent.Disconnected, () => {
        console.log('🎵 Disconnected from LiveKit room');
        setIsPlaying(false);
        setIsLoading(false);
        roomRef.current = null;
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        console.log('🎵 Participant connected:', participant.identity);
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        console.log('🎵 Participant disconnected:', participant.identity);
      });

      // Connect to the room
      await room.connect(data.url, data.token);
      console.log('🎵 Connected to LiveKit room:', ROOM_NAME);

      // Check if there are already tracks to subscribe to
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.track && publication.kind === Track.Kind.Audio) {
            handleTrackSubscribed(
              publication.track as RemoteTrack,
              publication as RemoteTrackPublication,
              participant
            );
          }
        });
      });

      // Register presence in Firebase
      const sessionId = getSessionId();
      if (sessionId) {
        ensureAuthAndExecute(() => {
          const db = getDatabase(getFirebaseApp());
          const presenceRef = ref(db, `presence/broadcast/${sessionId}`);
          onDisconnect(presenceRef).remove();
          set(presenceRef, true);
        });
      }

      // If no tracks yet, we're waiting for the DJ to start streaming
      if (room.remoteParticipants.size === 0) {
        console.log('🎵 No participants yet, waiting for DJ...');
        // Keep loading state until we get a track
      }

    } catch (err) {
      console.error('🎵 LiveKit connection error:', err);
      setError('Failed to connect to stream');
      setIsLoading(false);
    }
  }, [isLive, handleTrackSubscribed, handleTrackUnsubscribed]);

  const pause = useCallback(() => {
    // Clean up WebRTC
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    // Clean up HLS
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    // Stop audio
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
    }
    setIsPlaying(false);

    // Remove presence from Firebase
    const sessionId = getSessionId();
    if (sessionId) {
      ensureAuthAndExecute(() => {
        const db = getDatabase(getFirebaseApp());
        const presenceRef = ref(db, `presence/broadcast/${sessionId}`);
        remove(presenceRef);
      });
    }
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Subscribe to listener count from Firebase Realtime Database (matches iOS ListenerCountService)
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getDatabase(app);
    const presenceRef = ref(db, 'presence/broadcast');

    const unsubscribe = onValue(presenceRef, (snapshot) => {
      // Count children = number of active listeners (matches iOS exactly)
      const count = snapshot.size || 0;
      setListenerCount(count);
    });

    return () => unsubscribe();
  }, []);

  return {
    isPlaying,
    isLoading,
    isLive,
    currentShow,
    currentDJ,
    error,
    play,
    pause,
    toggle,
    listenerCount,
    audioStream,
  };
}
