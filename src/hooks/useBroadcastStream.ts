'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { getFirestore, collection, query, where, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';
import { BroadcastSlotSerialized, ROOM_NAME, RoomStatus } from '@/types/broadcast';

const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

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

interface UseBroadcastStreamReturn {
  isPlaying: boolean;
  isLoading: boolean;
  isLive: boolean;
  currentShow: BroadcastSlotSerialized | null;
  currentDJ: string | null;
  hlsUrl: string | null;
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
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loveCount, setLoveCount] = useState(0);
  const [listenerCount, setListenerCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Check room status and get HLS URL
  // Note: This only updates HLS URL and currentDJ, NOT isLive
  // isLive is determined by Firestore broadcast-slots status (matching iOS app behavior)
  const checkRoomStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/livekit/room-status?room=${ROOM_NAME}`);
      const data: RoomStatus = await res.json();

      if (data.isLive) {
        setCurrentDJ(data.currentDJ || null);
        // Use the HLS URL from R2
        const streamUrl = `${r2PublicUrl}/${ROOM_NAME}/live.m3u8`;
        setHlsUrl(streamUrl);
      } else {
        // Don't clear currentDJ here - let Firestore be the source of truth
        setHlsUrl(null);
      }
    } catch (err) {
      console.error('Failed to check room status:', err);
    }
  }, []);

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
          setIsLive(false);
        }
      },
      (err) => {
        console.error('Broadcast slot subscription error:', err);
      }
    );

    return () => unsubscribe();
  }, []);

  // Check room status periodically
  useEffect(() => {
    checkRoomStatus();
    const interval = setInterval(checkRoomStatus, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, [checkRoomStatus]);

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('playing', () => {
        setIsPlaying(true);
        setIsLoading(false);
      });
      audioRef.current.addEventListener('pause', () => {
        setIsPlaying(false);
      });
      audioRef.current.addEventListener('waiting', () => {
        setIsLoading(true);
      });
      audioRef.current.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        setError('Failed to play stream');
        setIsLoading(false);
        setIsPlaying(false);
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  // Set up HLS when URL changes
  useEffect(() => {
    if (!hlsUrl || !audioRef.current) return;

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(audioRef.current);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setError(null);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          setError('Stream connection lost');
          setIsPlaying(false);
          setIsLoading(false);
        }
      });
    } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      audioRef.current.src = hlsUrl;
    }
  }, [hlsUrl]);

  const play = useCallback(() => {
    if (!audioRef.current || !hlsUrl) {
      setError('Stream not available');
      return;
    }

    setIsLoading(true);
    setError(null);
    audioRef.current.play().catch((err) => {
      console.error('Play error:', err);
      setError('Failed to play');
      setIsLoading(false);
    });
  }, [hlsUrl]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
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

  // Poll for listener count
  useEffect(() => {
    const fetchListenerCount = async () => {
      try {
        const res = await fetch(`/api/livekit/room-status?room=${ROOM_NAME}`);
        const data: RoomStatus = await res.json();
        setListenerCount(data.participantCount || 0);
      } catch (err) {
        console.error('Failed to fetch listener count:', err);
      }
    };

    fetchListenerCount();
    const interval = setInterval(fetchListenerCount, 15000); // Every 15 seconds
    return () => clearInterval(interval);
  }, []);

  return {
    isPlaying,
    isLoading,
    isLive,
    currentShow,
    currentDJ,
    hlsUrl,
    error,
    play,
    pause,
    toggle,
    loveCount,
    listenerCount,
    messageCount,
  };
}
