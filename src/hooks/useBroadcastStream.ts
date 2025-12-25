'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { getFirestore, collection, query, where, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { getDatabase, ref, set, remove, onValue, onDisconnect } from 'firebase/database';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { BroadcastSlotSerialized, ROOM_NAME } from '@/types/broadcast';

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
  loveCount: number;
  listenerCount: number;
  messageCount: number;
}

export function useBroadcastStream(): UseBroadcastStreamReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [currentShow, setCurrentShow] = useState<BroadcastSlotSerialized | null>(null);
  const [currentDJ, setCurrentDJ] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loveCount, setLoveCount] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

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
            djSlots: data.djSlots,
            startTime: (data.startTime as Timestamp).toMillis(),
            endTime: (data.endTime as Timestamp).toMillis(),
            broadcastToken: data.broadcastToken,
            tokenExpiresAt: (data.tokenExpiresAt as Timestamp).toMillis(),
            createdAt: (data.createdAt as Timestamp).toMillis(),
            createdBy: data.createdBy,
            status: data.status,
            broadcastType: data.broadcastType,
            venueSlug: data.venueSlug,
            liveDjUserId: data.liveDjUserId,
            liveDjUsername: data.liveDjUsername,
            showPromoUrl: data.showPromoUrl,
            showPromoTitle: data.showPromoTitle,
          };
          setCurrentShow(slot);
          setCurrentDJ(slot.liveDjUsername || slot.djName || null);
          setIsLive(true);
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
        // Create audio element if needed
        if (!audioElementRef.current) {
          audioElementRef.current = new Audio();
        }

        // Attach the track to the audio element
        track.attach(audioElementRef.current);

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

    try {
      // Get a listener token (canPublish=false)
      const res = await fetch(
        `/api/livekit/token?room=${ROOM_NAME}&username=web-listener-${Date.now()}&canPublish=false`
      );
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setIsLoading(false);
        return;
      }

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
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
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

  // Subscribe to activity counts
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    // Subscribe to chat messages for message count
    const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Count messages in the last hour
    const messagesQuery = query(
      messagesRef,
      where('timestamp', '>', new Date(oneHourAgo)),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
      let loves = 0;
      let msgs = 0;
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.messageType === 'love' || data.message?.includes(' is ❤️')) {
          loves += 1;
        } else {
          msgs += 1;
        }
      });
      setLoveCount(loves);
      setMessageCount(msgs);
    });

    return () => unsubMessages();
  }, []);

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
    loveCount,
    listenerCount,
    messageCount,
  };
}
