'use client';

import { useEffect, useState } from 'react';
import { useAudioLevel } from '@/hooks/useAudioLevel';
import { getFirestore, collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { getDatabase, ref, onValue } from 'firebase/database';
import { getApps, initializeApp } from 'firebase/app';

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

interface LiveControlBarProps {
  stream: MediaStream | null;
  isLive: boolean;
  tipTotalCents: number;
  tipCount: number;
  showStartTime?: number; // Unix timestamp ms - love count resets per show
  isRecordingMode?: boolean; // Show "RECORDING" instead of "LIVE"
}

export function LiveControlBar({ stream, isLive, tipTotalCents, tipCount, showStartTime, isRecordingMode = false }: LiveControlBarProps) {
  const level = useAudioLevel(stream);
  const [listenerCount, setListenerCount] = useState(0);
  const [loveCount, setLoveCount] = useState(0);

  // Subscribe to activity counts - filter by show start time so counts reset per show
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
    // Use show start time if available, otherwise fall back to 24 hours ago
    const startTime = showStartTime || (Date.now() - 24 * 60 * 60 * 1000);

    const messagesQuery = query(
      messagesRef,
      where('timestamp', '>', new Date(startTime)),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
      let loves = 0;
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.messageType === 'love' || data.message?.includes(' is ❤️')) {
          loves += data.heartCount || 1;
        }
      });
      setLoveCount(loves);
    });

    return () => unsubMessages();
  }, [showStartTime]);

  // Subscribe to listener count
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getDatabase(app);
    const presenceRef = ref(db, 'presence/broadcast');

    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const count = snapshot.size || 0;
      setListenerCount(count);
    });

    return () => unsubscribe();
  }, []);

  // Convert level to percentage width
  const width = Math.min(level * 100, 100);

  // Determine color based on level
  const getGradient = () => {
    if (level > 0.8) {
      return 'from-green-500 via-yellow-500 to-red-500';
    } else if (level > 0.5) {
      return 'from-green-500 via-yellow-500 to-yellow-500';
    }
    return 'from-green-500 to-green-500';
  };

  // Format tip amount
  const formatTips = (cents: number) => {
    if (cents === 0) return '$0';
    return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  };

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-800 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center gap-4">
        {/* Status Badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full flex-shrink-0 ${
          isLive ? 'bg-red-600' : 'bg-gray-700'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            isLive ? 'bg-white animate-pulse' : 'bg-gray-400'
          }`} />
          <span className="text-white font-bold text-sm">
            {isLive ? (isRecordingMode ? 'RECORDING' : 'LIVE') : 'READY'}
          </span>
        </div>

        {/* Volume Meter - takes most space */}
        <div className="flex-1 min-w-0">
          <div className="h-6 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${getGradient()} transition-all duration-75`}
              style={{ width: `${width}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5 text-[10px] text-gray-600">
            <span>-60dB</span>
            <span>-12dB</span>
            <span>0dB</span>
          </div>
        </div>

        {/* Metrics - visible from afar */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Listeners - large with headphone icon (hidden in recording mode) */}
          {!isRecordingMode && (
            <div className="flex items-center gap-2" title="Listeners">
              <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9z" />
              </svg>
              <span className="text-white font-bold text-xl tabular-nums">{listenerCount}</span>
            </div>
          )}

          {/* Tips - large and prominent */}
          <div className="flex items-center gap-2" title={`${tipCount} ${tipCount === 1 ? 'tip' : 'tips'}`}>
            <span className="text-xl">💰</span>
            <span className={`font-bold text-xl tabular-nums ${tipTotalCents > 0 ? 'text-green-400' : 'text-gray-400'}`}>
              {formatTips(tipTotalCents)}
            </span>
            {tipCount > 0 && (
              <span className="text-gray-500 text-base">({tipCount})</span>
            )}
          </div>

          {/* Loves */}
          <div className="flex items-center gap-1.5" title="Loves">
            <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            <span className="text-white font-bold text-lg tabular-nums">{loveCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
