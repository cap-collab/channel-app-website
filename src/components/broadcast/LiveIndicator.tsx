'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { BroadcastSlotSerialized } from '@/types/broadcast';

import { DJProfileChatPanel } from '@/components/dj-profile/DJProfileChatPanel';
import { useAuthContext } from '@/contexts/AuthContext';
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

// Channel app deep link for the broadcast station
const CHANNEL_BROADCAST_URL = 'https://channel-app.com/radio';

interface LiveIndicatorProps {
  slot: BroadcastSlotSerialized | null;
  hlsUrl: string | null;
  onEndBroadcast: () => void;
  broadcastToken?: string;
  djUsername?: string;
  initialPromoSubmitted?: boolean;
  isVenue?: boolean;
  onChangeUsername?: (newUsername: string) => void;
}

// Helper to format time
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Helper to format date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function LiveIndicator({ slot, onEndBroadcast, broadcastToken, djUsername, initialPromoSubmitted, isVenue = false, onChangeUsername }: LiveIndicatorProps) {
  const { user } = useAuthContext();
  const [copied, setCopied] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [loveCount, setLoveCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);

  // Subscribe to activity counts - filter by show start time so counts reset per show
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    // Subscribe to chat messages for message count
    const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
    // Use show start time if available, otherwise fall back to 24 hours ago
    const showStartTime = slot?.startTime || (Date.now() - 24 * 60 * 60 * 1000);

    // Count messages since the show started
    const messagesQuery = query(
      messagesRef,
      where('timestamp', '>', new Date(showStartTime)),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
      let loves = 0;
      let msgs = 0;
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.messageType === 'love' || data.message?.includes(' is ❤️')) {
          loves += data.heartCount || 1;
        } else {
          msgs += 1;
        }
      });
      setLoveCount(loves);
      setMessageCount(msgs);
    });

    return () => unsubMessages();
  }, [slot?.startTime]);

  // Subscribe to listener count from Firebase Realtime Database
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
  const [duration, setDuration] = useState(0);
  const [isEnding, setIsEnding] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Duration counter and time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setDuration(prev => prev + 1);
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyChannelUrl = async () => {
    try {
      await navigator.clipboard.writeText(CHANNEL_BROADCAST_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  const handleEndBroadcast = async () => {
    setIsEnding(true);
    onEndBroadcast();
  };

  // Calculate time remaining if we have a slot
  const getTimeRemaining = () => {
    if (!slot) return null;

    const remaining = slot.endTime - now;

    if (remaining <= 0) return 'Overtime';

    const mins = Math.floor(remaining / 60000);
    if (mins < 60) return `${mins}m remaining`;

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m remaining`;
  };

  const fifteenMin = 15 * 60 * 1000;

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-4rem)]">
      {/* Left Column - Show info and controls */}
      <div className="flex-1 space-y-4 lg:overflow-y-auto">
        {/* Station Header (like iOS NowPlayingBar) */}
        <div className="bg-[#252525] rounded-xl p-4">
          <div className="flex items-center gap-3">
            {/* Station logo - square app icon */}
            <Image
              src="/apple-touch-icon.png"
              alt="Channel"
              width={48}
              height={48}
              className="rounded-lg flex-shrink-0"
            />
            {/* Station and show info */}
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-semibold text-base">Channel Radio</h2>
              {slot && (
                <p className="text-gray-400 text-sm truncate">{slot.showName || 'Live'}</p>
              )}
            </div>
            {/* Activity counts */}
            <div className="flex items-center gap-3 text-gray-400 text-sm">
              {/* Listener count */}
              <div className="flex items-center gap-1" title="Listeners">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 012.828-2.828" />
                </svg>
                <span>{listenerCount}</span>
              </div>
              {/* Love count */}
              <div className="flex items-center gap-1" title="Loves">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                <span>{loveCount}</span>
              </div>
              {/* Message count */}
              <div className="flex items-center gap-1" title="Messages">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span>{messageCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Show Schedule */}
        {slot && (slot.djSlots?.length || slot.djName) && (
          <div className="bg-[#252525] rounded-xl p-4">
            <p className="text-gray-500 text-sm mb-3">
              {formatDate(slot.startTime)} · {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
            </p>

            {slot.djSlots && slot.djSlots.length > 0 ? (
              <div className="space-y-2">
                {slot.djSlots.map((dj, i) => {
                  const isOnNow = dj.startTime <= now && dj.endTime > now;
                  const isUpSoon = !isOnNow && dj.startTime > now && (dj.startTime - now) < fifteenMin;
                  const minutesUntil = Math.ceil((dj.startTime - now) / 60000);

                  return (
                    <div key={i} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <span className="text-white">{dj.djName || 'TBD'}</span>
                        <span className="text-gray-500 text-sm">
                          {formatTime(dj.startTime)} – {formatTime(dj.endTime)}
                        </span>
                      </div>
                      {isOnNow && (
                        <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                          ON NOW
                        </span>
                      )}
                      {isUpSoon && (
                        <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded-full font-medium">
                          UP IN {minutesUntil} MIN
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : slot.djName ? (
              <div className="flex items-center justify-between py-1">
                <span className="text-white">{slot.djName}</span>
                {slot.startTime <= now && slot.endTime > now && (
                  <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                    ON NOW
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Live Status Card */}
        <div className="bg-[#252525] rounded-xl p-6">
          {/* Live badge and duration */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span className="text-white font-bold text-sm">LIVE</span>
              </div>
              <span className="text-white font-mono text-lg">{formatDuration(duration)}</span>
            </div>

            {slot && (
              <div className="text-right">
                <p className="text-gray-400 text-sm">{getTimeRemaining()}</p>
              </div>
            )}
          </div>

          {/* Channel App URL */}
          <div className="mb-6">
            <label className="block text-gray-400 text-sm mb-2">Share your Livestream</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={CHANNEL_BROADCAST_URL}
                className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm"
              />
              <button
                onClick={copyChannelUrl}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-3 rounded-lg transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-2">
              Share this link to provide access to your livestream, chat, and promo link
            </p>
          </div>

          {/* End broadcast button */}
          <button
            onClick={handleEndBroadcast}
            disabled={isEnding}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors"
          >
            {isEnding ? 'Ending broadcast...' : 'End Broadcast'}
          </button>
        </div>


      </div>

      {/* Right Column - Chat (on desktop, takes fixed width and full height) */}
      {broadcastToken && djUsername && slot && (
        <div className="lg:w-96 lg:flex-shrink-0 lg:h-full flex flex-col">
          <DJProfileChatPanel
            chatUsernameNormalized={djUsername.replace(/[\s-]+/g, '').toLowerCase()}
            djUserId={user?.uid || ''}
            djUsername={djUsername}
            djEmail=""
            isAuthenticated={!!user?.uid || !!broadcastToken}
            username={djUsername}
            userId={user?.uid}
            isOwner={true}
            broadcastToken={broadcastToken}
            broadcastSlotId={slot.id}
            isVenue={isVenue}
            initialPromoSubmitted={initialPromoSubmitted}
            onChangeUsername={onChangeUsername}
          />
        </div>
      )}
    </div>
  );
}
