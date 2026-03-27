'use client';

import { useState, useEffect } from 'react';
import { getFirestore, collection, query, where, limit, onSnapshot } from 'firebase/firestore';
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

interface UseBroadcastLiveStatusReturn {
  isLive: boolean;
  showName: string | null;
  djName: string | null;
}

export function useBroadcastLiveStatus(): UseBroadcastLiveStatusReturn {
  const [isLive, setIsLive] = useState(false);
  const [showName, setShowName] = useState<string | null>(null);
  const [djName, setDjName] = useState<string | null>(null);

  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const slotsRef = collection(db, 'broadcast-slots');
    // Simple query - just check if any live slot exists
    // No orderBy to avoid needing a composite index
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
          setIsLive(true);
          setShowName(data.showName || 'Live Broadcast');
          // Resolve current DJ name from djSlots or top-level fields
          let dj: string | null = null;
          if (data.djSlots && Array.isArray(data.djSlots) && data.djSlots.length > 0) {
            const now = Date.now();
            const slot = data.djSlots.find((s: { startTime: number; endTime: number }) => s.startTime <= now && s.endTime > now);
            if (slot) dj = slot.liveDjUsername || slot.djName || null;
          }
          // For restreams with multiple DJs, show all names (channel user first)
          if (data.restreamDjs && Array.isArray(data.restreamDjs) && data.restreamDjs.length > 1) {
            const sortedDjs = [...data.restreamDjs].sort((a: { userId?: string; username?: string }, b: { userId?: string; username?: string }) => {
              if (a.userId && !b.userId) return -1;
              if (!a.userId && b.userId) return 1;
              if (a.username && !b.username) return -1;
              if (!a.username && b.username) return 1;
              return 0;
            });
            dj = sortedDjs.map((d: { name: string }) => d.name).join(', ');
          }
          if (!dj) dj = data.liveDjUsername || data.djName || null;
          setDjName(dj);
        } else {
          setIsLive(false);
          setShowName(null);
          setDjName(null);
        }
      },
      (err) => {
        console.error('Broadcast live status subscription error:', err);
        setIsLive(false);
        setShowName(null);
        setDjName(null);
      }
    );

    return () => unsubscribe();
  }, []);

  return { isLive, showName, djName };
}
