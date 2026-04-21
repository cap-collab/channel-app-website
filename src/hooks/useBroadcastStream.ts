'use client';

import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { getFirestore, collection, query, where, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { BroadcastSlotSerialized, ROOM_NAME } from '@/types/broadcast';
import { findActiveDjSlot } from '@/lib/broadcast-utils';
import Hls from 'hls.js';
import { captureEvent } from '@/lib/posthog';
import { registerAudio, pauseOthers } from '@/lib/audio-exclusive';

// HLS stream URL - direct from R2 (bypasses Vercel serverless proxy).
// Live and restream both write to the same channel-radio/ prefix so the
// listener's player doesn't have to swap .src at live↔restream transitions
// (which causes a visible pause/reload). Scheduling guarantees the two
// don't overlap, and start-restream stops any stale egress before starting
// its own, so only one egress writes at a time.
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';
const HLS_URL = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/channel-radio/live.m3u8` : '/api/hls/channel-radio/live.m3u8';

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
export function useBroadcastStream(statusIsLive?: boolean, onLockedInRef?: MutableRefObject<(() => void) | null>): UseBroadcastStreamReturn {
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
  const previousBroadcastTypeRef = useRef<string | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPlayingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const userPausedRef = useRef(false); // Track user-initiated pauses vs browser auto-pause
  const artworkPreloadRef = useRef<HTMLImageElement | null>(null);
  const artworkRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastCumulativeTimeRef = useRef(0);
  const broadcastStreamCountedRef = useRef<string | null>(null);
  const broadcastLockedInFiredRef = useRef<string | null>(null);
  const [autoResumePending, setAutoResumePending] = useState(false);
  const playbackStartedAtRef = useRef<number | null>(null); // For posthog session_duration

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
          const previousType = previousBroadcastTypeRef.current;
          currentShowIdRef.current = doc.id;
          previousBroadcastTypeRef.current = slot.broadcastType || 'live';

          if (showChanged && isPlayingRef.current) {
            console.log('🔄 Show changed while playing', {
              hasRoom: !!roomRef.current, roomName: roomRef.current?.name,
              hasHls: !!hlsRef.current, broadcastType: slot.broadcastType,
              previousType, useHLS: shouldUseHLS(),
            });

            // HLS: manifest is continuous across live ↔ live and live ↔ restream
            // (server reuses the same HLS egress writing to the same R2 prefix),
            // so the Hls instance / <audio> element just keeps playing through
            // the transition. Nothing to tear down here.
            if (hlsRef.current || (!roomRef.current && audioElementRef.current)) {
              console.log('🔄 HLS transition — keeping connection, manifest continues');
            }

            // WebRTC different room: disconnect and auto-resume. This is the
            // only real source change — same-room transitions (live→live or
            // live ↔ restream) deliver new audio through TrackSubscribed on
            // the existing Room connection.
            if (roomRef.current && roomRef.current.name !== ROOM_NAME) {
              console.log('🔄 Different room — disconnecting');
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

            // Same-room WebRTC (live → live, live ↔ restream): keep the Room
            // connection; new publisher's tracks arrive via TrackSubscribed.
            if (roomRef.current && roomRef.current.name === ROOM_NAME) {
              console.log('🔄 Same-room WebRTC — keeping connection, waiting for new publisher tracks');
            }
          }

          // Find current DJ name:
          // Priority: djSlot.djUsername > djSlot.liveDjUsername > djSlot.djName > slot.liveDjUsername > slot.djName
          // This ensures we use the DJ's chat username if available, not just the admin-set name
          let djNameToUse: string | null = null;
          if (slot.djSlots && slot.djSlots.length > 0) {
            const currentDjSlot = findActiveDjSlot(slot.djSlots);
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

          // Auto-resume for desktop WebRTC after grace period gap
          if (wasPlayingRef.current && !shouldUseHLS()) {
            console.log('🔄 Auto-resume pending after show transition (WebRTC)');
            wasPlayingRef.current = false;
            setAutoResumePending(true);
          } else {
            wasPlayingRef.current = false;
          }
        } else {
          // No live slot — enter grace period if we were playing
          console.log('🔄 No live slot', { isPlaying: isPlayingRef.current, hasRoom: !!roomRef.current, hasHls: !!hlsRef.current });
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
          registerAudio('live', audioElementRef.current);
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

        pauseOthers('live');
        audioElementRef.current.play()
          .then(() => {
            console.log('🎵 Audio playing');
            setIsPlaying(true);
            setIsLoading(false);
            setError(null);
            playbackStartedAtRef.current = Date.now();
            captureEvent('playback_started', { type: 'live', protocol: 'webrtc' });
          })
          .catch((err) => {
            console.error('🎵 Audio play error:', err);
            setError('Failed to play audio. Click to try again.');
            setIsLoading(false);
            captureEvent('playback_error', { type: 'live', protocol: 'webrtc', message: String(err) });
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
    console.log('🎵 play() called', { isLive, hasRoom: !!roomRef.current, hasHls: !!hlsRef.current, useHLS: shouldUseHLS() });
    if (!isLive) {
      console.log('🎵 play() — not live, aborting');
      setError('Stream not available');
      return;
    }

    userPausedRef.current = false; // Reset — user is actively playing
    setIsLoading(true);
    setError(null);

    // Transport decision is purely browser-based. Restreams now publish into
    // the same LiveKit room as live (via RTMP ingress), so desktop Chrome
    // listeners can subscribe via WebRTC the same way as for a live DJ.
    const useHLS = shouldUseHLS();

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
      registerAudio('live', audioElementRef.current);
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
      const hlsUrl = HLS_URL;
      console.log('🎵 Using HLS stream:', hlsUrl);
      try {
        // Check if Safari with native HLS support
        if (audioElementRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          console.log('🎵 Using native HLS (Safari)');
          const audio = audioElementRef.current;
          audio.src = hlsUrl;
          pauseOthers('live');

          // Safari's native HLS loader needs a moment to fetch and parse the
          // manifest before .play() can succeed — calling it immediately after
          // assigning .src throws NotSupportedError on the first attempt.
          // Wait for loadedmetadata (with a timeout safety net), then play.
          // If play still fails with NotSupportedError, re-assign .src once
          // and retry after a short delay.
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            const onReady = () => finish();
            audio.addEventListener('loadedmetadata', onReady, { once: true });
            setTimeout(finish, 5000);
          });

          const tryPlay = async () => {
            try {
              await audio.play();
              return true;
            } catch (err) {
              const name = (err as { name?: string })?.name;
              if (name === 'NotSupportedError' || name === 'NotAllowedError') {
                return false;
              }
              throw err;
            }
          };

          let played = await tryPlay();
          if (!played) {
            console.log('🎵 Native HLS first play failed, retrying once');
            await new Promise((r) => setTimeout(r, 400));
            audio.src = hlsUrl;
            played = await tryPlay();
          }

          if (!played) {
            console.error('🎵 Native HLS play failed after retry');
            setError('Tap to play');
            setIsLoading(false);
            captureEvent('playback_error', { type: 'live', protocol: 'native', message: 'play-failed-after-retry' });
            return;
          }

          captureAudioStream();
          setIsPlaying(true);
          setIsLoading(false);
          playbackStartedAtRef.current = Date.now();
          captureEvent('playback_started', { type: 'live', protocol: 'native' });
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
              pauseOthers('live');
              await audioElementRef.current!.play();
              captureAudioStream();
              setIsPlaying(true);
              setIsLoading(false);
              playbackStartedAtRef.current = Date.now();
              captureEvent('playback_started', { type: 'live', protocol: 'hls' });
            } catch (err) {
              console.error('🎵 HLS play error:', err);
              setError('Tap to play');
              setIsLoading(false);
              captureEvent('playback_error', { type: 'live', protocol: 'hls', message: String(err) });
            }
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            console.error('🎵 HLS error:', { type: data.type, details: data.details, fatal: data.fatal, url: data.url });
            if (data.fatal) {
              setError('Stream error');
              setIsLoading(false);
              captureEvent('playback_error', { type: 'live', protocol: 'hls', message: `${data.type}: ${data.details}` });
            }
          });
        } else {
          setError('HLS not supported');
          setIsLoading(false);
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

      room.on(RoomEvent.Disconnected, (reason) => {
        console.log('🎵 Disconnected from LiveKit room', { reason, isActiveRoom: roomRef.current === room });
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

      // If no tracks yet, we're waiting for the DJ to start streaming
      // (Restreams now use HLS, so this only applies to live broadcasts)
      if (room.remoteParticipants.size === 0) {
        console.log('🎵 No participants yet, waiting for DJ...');
      }

    } catch (err) {
      console.error('🎵 LiveKit connection error:', err);
      setError('Failed to connect to stream');
      setIsLoading(false);
      captureEvent('playback_error', { type: 'live', protocol: 'webrtc', message: String(err) });
    }
  }, [isLive, currentShow, handleTrackSubscribed, handleTrackUnsubscribed]);

  const pause = useCallback(() => {
    console.log('🎵 pause() called', { hasRoom: !!roomRef.current, hasHls: !!hlsRef.current });
    userPausedRef.current = true;

    // Track playback_ended
    if (playbackStartedAtRef.current) {
      const sessionDuration = Math.round((Date.now() - playbackStartedAtRef.current) / 1000);
      captureEvent('playback_ended', { type: 'live', session_duration: sessionDuration });
      playbackStartedAtRef.current = null;
    }

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
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Auto-resume effect: desktop WebRTC only.
  // When a new show goes live after a grace period gap, auto-reconnect.
  // Mobile HLS does NOT auto-resume (stale R2 segments cause loops).
  useEffect(() => {
    if (autoResumePending && isLive && !isPlaying && !isLoading) {
      setAutoResumePending(false);
      const delay = 300; // WebRTC only — tracks arrive near-instantly
      console.log(`🔄 Auto-resuming WebRTC playback in ${delay}ms`);
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

    if (currentShow && isPlaying) {
      // Match hero image priority: show image > DJ photo > primary restream DJ photo
      const primaryRestreamDjPhoto = (() => {
        if (!currentShow.restreamDjs || currentShow.restreamDjs.length === 0) return null;
        const primary = currentShow.restreamDjs.find(dj => dj.userId)
          || currentShow.restreamDjs.find(dj => dj.username)
          || null;
        return primary?.photoUrl || null;
      })();
      const rawArtworkUrl = currentShow.showImageUrl || currentShow.liveDjPhotoUrl || primaryRestreamDjPhoto;

      const fallbackArtworkUrl = `${window.location.origin}/apple-touch-icon.png`;

      // iOS only uses first artwork entry and rejects images > 128x128.
      // Proxy through Next.js for same-origin.
      const proxyUrl = (url: string) =>
        url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=128&q=75`;

      const setMetadata = (imgSrc: string) => {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentShow.showName || 'Live Broadcast',
          artist: currentDJ || undefined,
          album: 'channel radio',
          artwork: [
            { src: proxyUrl(imgSrc), sizes: '128x128', type: 'image/png' },
          ],
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

      if (rawArtworkUrl) {
        // Show fallback immediately while new image loads
        setMetadata(fallbackArtworkUrl);

        const img = new Image();
        artworkPreloadRef.current = img;

        img.onload = () => {
          if (artworkPreloadRef.current === img) {
            setMetadata(rawArtworkUrl);
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
                setMetadata(rawArtworkUrl);
              }
            };
            retryImg.onerror = () => {
              if (artworkPreloadRef.current === retryImg) {
                setMetadata(fallbackArtworkUrl);
              }
            };
            retryImg.src = rawArtworkUrl;
          }, 3000);
        };

        img.src = rawArtworkUrl;
      } else {
        setMetadata(fallbackArtworkUrl);
      }

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
  }, [isPlaying, currentShow, currentDJ]);

  // Firebase presence — uses .info/connected so presence survives reconnects.
  // When isPlaying is true we write presence on every (re)connect; when false we remove it.
  useEffect(() => {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const app = getFirebaseApp();
    const rtdb = getDatabase(app);
    const presenceRef = ref(rtdb, `presence/broadcast/${sessionId}`);
    const connectedRef = ref(rtdb, '.info/connected');

    let authed = false;
    let unsubConnected: (() => void) | null = null;

    const setupPresence = () => {
      // Listen for connection state — re-registers onDisconnect + presence on every reconnect
      unsubConnected = onValue(connectedRef, (snap) => {
        if (!snap.val()) return; // not connected

        if (isPlaying) {
          // Set onDisconnect FIRST, then write presence — atomic pair
          onDisconnect(presenceRef).remove().then(() => {
            set(presenceRef, true);
          });
        } else {
          // Not playing — make sure we're removed
          remove(presenceRef);
        }
      });
    };

    // Ensure auth before writing to RTDB
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
      // Synchronously remove presence on cleanup (unmount or isPlaying change)
      if (authed) {
        remove(presenceRef);
      }
    };
  }, [isPlaying]);

  // Subscribe to listener count from Firebase Realtime Database (matches iOS ListenerCountService)
  useEffect(() => {
    const app = getFirebaseApp();
    const rtdb = getDatabase(app);
    const presenceRef = ref(rtdb, 'presence/broadcast');

    const unsubscribe = onValue(presenceRef, (snapshot) => {
      // Count children = number of active listeners (matches iOS exactly)
      const count = snapshot.size || 0;
      setListenerCount(count);
    });

    return () => unsubscribe();
  }, []);

  // Track cumulative playback for broadcast stream count (300s threshold, same as archives)
  useEffect(() => {
    if (!isPlaying || !currentShow) return;

    // Reset cumulative time when show changes
    if (broadcastStreamCountedRef.current !== null && broadcastStreamCountedRef.current !== currentShow.id) {
      broadcastCumulativeTimeRef.current = 0;
      broadcastLockedInFiredRef.current = null;
    }

    const interval = setInterval(() => {
      broadcastCumulativeTimeRef.current += 1;
      if (
        broadcastCumulativeTimeRef.current >= 300 &&
        broadcastStreamCountedRef.current !== currentShow.id
      ) {
        broadcastStreamCountedRef.current = currentShow.id;
        const uid = getAuth(getFirebaseApp()).currentUser?.uid || null;
        fetch(`/api/broadcast/${currentShow.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid }),
        }).catch(() => {});
      }
      // Fire "locked in" message at 900s (15 min)
      if (
        broadcastCumulativeTimeRef.current >= 900 &&
        broadcastLockedInFiredRef.current !== currentShow.id
      ) {
        broadcastLockedInFiredRef.current = currentShow.id;
        onLockedInRef?.current?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, currentShow, onLockedInRef]);


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
