'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { getFirestore, collection, query, where, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { BroadcastSlotSerialized, ROOM_NAME } from '@/types/broadcast';
import Hls from 'hls.js';

// HLS stream URLs - direct from R2 (bypasses Vercel serverless proxy)
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';
const HLS_URL = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/channel-radio/live.m3u8` : '/api/hls/channel-radio/live.m3u8';
const HLS_URL_RESTREAM = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/channel-radio-restream/live.m3u8` : '/api/hls/channel-radio-restream/live.m3u8';

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

  // Wait for Firebase to restore the persisted session before checking currentUser.
  // Without this, currentUser is null on page load and signInAnonymously() would
  // replace an existing logged-in user's session with an anonymous one.
  await auth.authStateReady();

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

  // Grace period + auto-resume refs for show transitions
  const currentShowIdRef = useRef<string | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPlayingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const userPausedRef = useRef(false); // Track user-initiated pauses vs browser auto-pause
  const artworkPreloadRef = useRef<HTMLImageElement | null>(null);
  const artworkRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoResumePending, setAutoResumePending] = useState(false);

  // Keep playing ref in sync
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

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
          // Live slot found — cancel any grace period
          if (graceTimerRef.current) {
            clearTimeout(graceTimerRef.current);
            graceTimerRef.current = null;
          }

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
            liveDjBio: data.liveDjBio,
            liveDjTipButtonLink: data.liveDjTipButtonLink,
            liveDjGenres: data.liveDjGenres,
            liveDjDescription: data.liveDjDescription,
            showImageUrl: data.showImageUrl,
            // Restream fields
            archiveId: data.archiveId,
            archiveRecordingUrl: data.archiveRecordingUrl,
            archiveDuration: data.archiveDuration,
            restreamDjs: data.restreamDjs,
          };
          setCurrentShow(slot);

          // Detect show change (e.g. live → restream) while user is playing
          const showChanged = currentShowIdRef.current !== null && currentShowIdRef.current !== doc.id;
          currentShowIdRef.current = doc.id;

          if (showChanged && isPlayingRef.current) {
            console.log('🔄 Show changed while playing');

            // HLS needs to be recreated for the new show's egress
            if (hlsRef.current) {
              hlsRef.current.destroy();
              hlsRef.current = null;
            }

            // Only tear down audio and reset player if switching to a different room.
            // For same-room transitions (all shows on channel-radio), the new DJ's tracks
            // arrive via handleTrackSubscribed automatically — no need to pause/restart.
            if (roomRef.current && roomRef.current.name !== ROOM_NAME) {
              if (audioElementRef.current) {
                audioElementRef.current.pause();
                audioElementRef.current.removeAttribute('src');
                audioElementRef.current.load();
              }
              roomRef.current.disconnect();
              roomRef.current = null;
              setIsPlaying(false);
              wasPlayingRef.current = false;
              setAutoResumePending(true);
            }
            // Same-room live→live: keep playing, tracks arrive automatically via TrackSubscribed

            // Live→restream: need to switch from WebRTC to HLS
            if (slot.broadcastType === 'restream' && roomRef.current) {
              console.log('🔄 Switching from WebRTC to HLS for restream');
              roomRef.current.disconnect();
              roomRef.current = null;
              if (audioElementRef.current) {
                audioElementRef.current.pause();
                audioElementRef.current.removeAttribute('src');
                audioElementRef.current.load();
              }
              setIsPlaying(false);
              wasPlayingRef.current = false;
              // Don't auto-resume — let the user tap play for the restream.
              // Auto-resume can fail silently (Safari autoplay policy) leaving
              // the button in a "playing" state with no audio.
            }
          }

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
          // For restreams with multiple DJs, build a combined DJ name string
          // Priority: channel user first, pending DJ second, others after
          if (slot.restreamDjs && slot.restreamDjs.length > 1) {
            const sortedDjs = [...slot.restreamDjs].sort((a, b) => {
              // DJs with userId (channel users) come first
              if (a.userId && !b.userId) return -1;
              if (!a.userId && b.userId) return 1;
              // DJs with username (pending DJs) come second
              if (a.username && !b.username) return -1;
              if (!a.username && b.username) return 1;
              return 0;
            });
            djNameToUse = sortedDjs.map(dj => dj.name).join(', ');
          }
          setCurrentDJ(djNameToUse || slot.liveDjUsername || slot.djName || null);
          setIsLive(true);
          // Prewarm token as soon as we detect a live broadcast
          prewarmToken();

          // Auto-resume: if user was playing before the transition gap, re-trigger play
          if (wasPlayingRef.current) {
            console.log('🔄 Auto-resume pending after show transition');
            wasPlayingRef.current = false;
            // Trigger auto-resume via state → effect → play()
            setAutoResumePending(true);
          }
        } else {
          // No live slot — enter grace period if we were playing
          if (isPlayingRef.current || roomRef.current || hlsRef.current) {
            wasPlayingRef.current = true;
            // Invalidate cached token — next play() should fetch a fresh one
            cachedToken = null;
            tokenFetchPromise = null;
            if (!graceTimerRef.current) {
              console.log('🔄 Show transition: entering 60s grace period (keeping connection alive)');
              graceTimerRef.current = setTimeout(() => {
                console.log('🔄 Grace period expired, disconnecting');
                graceTimerRef.current = null;
                currentShowIdRef.current = null;
                setCurrentShow(null);
                setCurrentDJ(null);
                setIsLive(false);
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
                  audioElementRef.current.src = '';
                }
                setIsPlaying(false);
                wasPlayingRef.current = false;
              }, 60_000);
            }
          } else {
            // Not playing — tear down immediately
            setCurrentShow(null);
            setCurrentDJ(null);
            setIsLive(false);
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
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
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
        // Don't reset isPlaying during DJ transitions — keep the player
        // in its current state so handleTrackSubscribed can resume seamlessly
        // when the next DJ publishes. Only reset if user explicitly paused.
        if (userPausedRef.current) {
          setIsPlaying(false);
        }
      }
    },
    []
  );

  const play = useCallback(async () => {
    if (!isLive) {
      setError('Stream not available');
      return;
    }

    userPausedRef.current = false; // Reset — user is actively playing
    setIsLoading(true);
    setError(null);

    // Restreams use FFmpeg → HLS → R2 (no LiveKit room), so always use HLS for restreams.
    const useHLS = shouldUseHLS() || currentShow?.broadcastType === 'restream';

    // If the WebRTC room is already connected (e.g. kept alive during DJ transition
    // grace period), skip the disconnect/reconnect cycle. The next DJ's tracks will
    // arrive via handleTrackSubscribed on the existing room connection.
    if (roomRef.current && roomRef.current.name === ROOM_NAME && !useHLS) {
      console.log('🎵 Room already connected, waiting for tracks');
      // Tracks may already be available if DJ published while we were in grace
      return;
    }

    // Clean up any existing connections first (e.g. stale room from a different room name)
    if (roomRef.current) {
      console.log('🎵 Cleaning up existing WebRTC room before reconnecting');
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (hlsRef.current) {
      console.log('🎵 Cleaning up existing HLS instance before reconnecting');
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    console.log('🎵 Starting playback - useHLS:', useHLS, 'broadcastType:', currentShow?.broadcastType || 'live');

    // Create audio element if needed
    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
    }

    // Set mobile-friendly attributes
    audioElementRef.current.setAttribute('playsinline', 'true');
    audioElementRef.current.setAttribute('webkit-playsinline', 'true');
    // Restreams now use a server-side URL ingress into the LiveKit room,
    // so they flow through the same WebRTC/HLS playback path as live broadcasts.

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
      const hlsUrl = currentShow?.broadcastType === 'restream' ? HLS_URL_RESTREAM : HLS_URL;
      console.log('🎵 Using HLS stream:', hlsUrl);
      try {
        // Check if Safari with native HLS support
        if (audioElementRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('🎵 Using native HLS (Safari)');
          audioElementRef.current.src = hlsUrl;
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

          hls.loadSource(hlsUrl);
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
        // Only update state if this room is still the active one.
        // When play() cleans up an old room before reconnecting, the old
        // room's Disconnected event should not reset playback state.
        if (roomRef.current === room) {
          // During grace period, don't reset isPlaying — we may reconnect
          // when the next show goes live.
          if (!graceTimerRef.current) {
            setIsPlaying(false);
          }
          setIsLoading(false);
          roomRef.current = null;
        }
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
      // (Restreams now use HLS, so this only applies to live broadcasts)
      if (room.remoteParticipants.size === 0) {
        console.log('🎵 No participants yet, waiting for DJ...');
      }

    } catch (err) {
      console.error('🎵 LiveKit connection error:', err);
      setError('Failed to connect to stream');
      setIsLoading(false);
    }
  }, [isLive, currentShow, handleTrackSubscribed, handleTrackUnsubscribed]);

  const pause = useCallback(() => {
    // User explicitly paused — mark so we don't auto-resume on iOS
    userPausedRef.current = true;
    // Clear grace period and don't auto-resume
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    wasPlayingRef.current = false;
    setAutoResumePending(false);

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

  // Auto-resume effect: when a new show goes live after a transition,
  // automatically call play() if the user was previously playing
  useEffect(() => {
    if (autoResumePending && isLive && !isPlaying && !isLoading) {
      setAutoResumePending(false);
      // Restreams need more time for the URL ingress + egress to start writing audio segments.
      // WebRTC (desktop) gets tracks near-instantly via TrackSubscribed, so use a shorter delay.
      // HLS (mobile/Safari) needs time for segments to appear on CDN.
      const isRestream = currentShow?.archiveRecordingUrl != null;
      const isHLS = shouldUseHLS() || isRestream;
      const delay = isRestream ? 15000 : isHLS ? 1500 : 300;
      console.log(`🔄 Auto-resuming playback in ${delay}ms (${isRestream ? 'restream' : 'live'})`);
      const timer = setTimeout(() => {
        play();
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [autoResumePending, isLive, isPlaying, isLoading, play, currentShow]);

  // iOS Safari auto-pauses audio elements during silence (e.g. between DJ transitions).
  // Detect this and auto-resume so listeners don't lose the stream during handoff.
  useEffect(() => {
    const audio = audioElementRef.current;
    if (!audio || !isPlaying) return;

    const handleBrowserPause = () => {
      // Only auto-resume if this wasn't a user-initiated pause
      if (!userPausedRef.current && isPlayingRef.current) {
        console.log('🎵 Browser auto-paused audio (likely iOS silence), resuming in 2s...');
        setTimeout(() => {
          if (audioElementRef.current && isPlayingRef.current && !userPausedRef.current) {
            audioElementRef.current.play().catch(err => {
              console.warn('🎵 Auto-resume failed:', err);
            });
          }
        }, 2000);
      }
    };

    audio.addEventListener('pause', handleBrowserPause);
    return () => audio.removeEventListener('pause', handleBrowserPause);
  }, [isPlaying]);

  // Update lock screen / control center metadata via Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (currentShow) {
      // Match hero image priority: show image > DJ photo > primary restream DJ photo
      const primaryRestreamDjPhoto = (() => {
        if (!currentShow.restreamDjs || currentShow.restreamDjs.length === 0) return null;
        const primary = currentShow.restreamDjs.find(dj => dj.userId)
          || currentShow.restreamDjs.find(dj => dj.username)
          || null;
        return primary?.photoUrl || null;
      })();
      const artworkUrl = currentShow.showImageUrl || currentShow.liveDjPhotoUrl || primaryRestreamDjPhoto;

      const fallbackArtworkUrl = `${window.location.origin}/apple-touch-icon.png`;

      const setMetadata = (imgSrc: string) => {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentShow.showName || 'Live Broadcast',
          artist: currentDJ || undefined,
          album: 'channel radio',
          artwork: [{ src: imgSrc, sizes: '512x512', type: 'image/jpeg' }],
        });
      };

      // Cancel any in-flight preload/retry from a previous show
      if (artworkPreloadRef.current) {
        artworkPreloadRef.current.onload = null;
        artworkPreloadRef.current.onerror = null;
        artworkPreloadRef.current.src = '';
        artworkPreloadRef.current = null;
      }
      if (artworkRetryTimerRef.current) {
        clearTimeout(artworkRetryTimerRef.current);
        artworkRetryTimerRef.current = null;
      }

      if (artworkUrl) {
        // Show fallback immediately while new image loads
        setMetadata(fallbackArtworkUrl);

        const img = new Image();
        artworkPreloadRef.current = img;

        img.onload = () => {
          if (artworkPreloadRef.current === img) {
            setMetadata(artworkUrl);
          }
        };

        img.onerror = () => {
          if (artworkPreloadRef.current !== img) return;
          // Retry once after 3s — image may not have propagated to CDN yet
          artworkRetryTimerRef.current = setTimeout(() => {
            const retryImg = new Image();
            artworkPreloadRef.current = retryImg;
            retryImg.onload = () => {
              if (artworkPreloadRef.current === retryImg) {
                setMetadata(artworkUrl);
              }
            };
            retryImg.onerror = () => {
              if (artworkPreloadRef.current === retryImg) {
                setMetadata(fallbackArtworkUrl);
              }
            };
            retryImg.src = artworkUrl;
          }, 3000);
        };

        img.src = artworkUrl;
      } else {
        setMetadata(fallbackArtworkUrl);
      }

      // Playback-only: action handlers and position state
      if (isPlaying) {
        // Disable skip/seek buttons in mobile control center
        const disableActions: MediaSessionAction[] = ['seekforward', 'seekbackward', 'previoustrack', 'nexttrack'];
        for (const action of disableActions) {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch {
            // Browser doesn't support this action
          }
        }
        try {
          navigator.mediaSession.setActionHandler('seekto', () => {});
        } catch {
          // Browser doesn't support seekto
        }

        // Handle play/pause from Control Center / lock screen
        try {
          navigator.mediaSession.setActionHandler('pause', () => { pause(); });
          navigator.mediaSession.setActionHandler('play', () => { play(); });
        } catch {
          // Browser doesn't support these actions
        }

        // Show progress bar based on show start/end time, update every 2 min
        const duration = (currentShow.endTime - currentShow.startTime) / 1000;

        const updatePosition = () => {
          if (duration > 0) {
            const position = Math.max(0, (Date.now() - currentShow.startTime) / 1000);
            navigator.mediaSession.setPositionState({
              duration,
              position: Math.min(position, duration),
              playbackRate: 1,
            });
          }
        };

        updatePosition();
        const interval = setInterval(updatePosition, 120_000);
        return () => {
          clearInterval(interval);
          if (artworkPreloadRef.current) {
            artworkPreloadRef.current.onload = null;
            artworkPreloadRef.current.onerror = null;
            artworkPreloadRef.current.src = '';
            artworkPreloadRef.current = null;
          }
          if (artworkRetryTimerRef.current) {
            clearTimeout(artworkRetryTimerRef.current);
            artworkRetryTimerRef.current = null;
          }
        };
      }

      // Cleanup preloads even when not playing
      return () => {
        if (artworkPreloadRef.current) {
          artworkPreloadRef.current.onload = null;
          artworkPreloadRef.current.onerror = null;
          artworkPreloadRef.current.src = '';
          artworkPreloadRef.current = null;
        }
        if (artworkRetryTimerRef.current) {
          clearTimeout(artworkRetryTimerRef.current);
          artworkRetryTimerRef.current = null;
        }
      };
    }
  }, [isPlaying, currentShow, currentDJ]);

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
