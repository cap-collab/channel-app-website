'use client';

import { useState, useEffect, useCallback } from 'react';
import { getFirestore, collection, query, orderBy, limit, where, onSnapshot, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';
import { ChatMessageSerialized } from '@/types/broadcast';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase if not already initialized
function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

interface UseDJChatOptions {
  broadcastToken: string;
  slotId: string;
  djUsername: string;
  userId?: string;
}

interface UseDJChatReturn {
  messages: ChatMessageSerialized[];
  isConnected: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  sendPromo: (promoText: string, promoHyperlink?: string) => Promise<void>;
  promoUsed: boolean;
}

export function useDJChat({ broadcastToken, slotId, djUsername }: UseDJChatOptions): UseDJChatReturn {
  const [messages, setMessages] = useState<ChatMessageSerialized[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoUsed, setPromoUsed] = useState(false);

  // Subscribe to chat messages - show all recent broadcast messages (same as listeners)
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
    const twentyFourHoursAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

    // Query all recent messages (not filtered by djSlotId) so DJ sees love messages from listeners
    const q = query(
      messagesRef,
      where('timestamp', '>=', twentyFourHoursAgo),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newMessages: ChatMessageSerialized[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const timestamp = data.timestamp as Timestamp | null;
          newMessages.push({
            id: doc.id,
            stationId: data.stationId || 'broadcast',
            username: data.username,
            message: data.message,
            timestamp: timestamp ? timestamp.toMillis() : Date.now(),
            heartCount: data.heartCount || 1,
            isDJ: data.isDJ || false,
            djSlotId: data.djSlotId,
            messageType: data.messageType || 'chat',
            promoText: data.promoText,
            promoHyperlink: data.promoHyperlink,
          });

          // Check if there's already a promo from this slot
          if (data.messageType === 'promo' && data.djSlotId === slotId) {
            setPromoUsed(true);
          }
        });

        // Reverse to show oldest first
        setMessages(newMessages.reverse());
        setIsConnected(true);
        setError(null);
      },
      (err) => {
        console.error('Chat subscription error:', err);
        setError('Failed to connect to chat');
        setIsConnected(false);
      }
    );

    return () => unsubscribe();
  }, [slotId]);

  // Send a regular chat message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const app = getFirebaseApp();
    const db = getFirestore(app);

    try {
      const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
      await addDoc(messagesRef, {
        stationId: 'broadcast',
        username: djUsername,
        message: text.trim(),
        timestamp: serverTimestamp(),
        isDJ: true,
        djSlotId: slotId,
        messageType: 'chat',
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      throw new Error('Failed to send message');
    }
  }, [djUsername, slotId]);

  // Send a promo message (can be called multiple times to update)
  const sendPromo = useCallback(async (promoText: string, promoHyperlink?: string) => {
    try {
      const response = await fetch('/api/broadcast/dj-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastToken,
          promoText,
          promoHyperlink,
          username: djUsername,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to post promo');
      }

      setPromoUsed(true);
    } catch (err) {
      console.error('Failed to send promo:', err);
      throw err;
    }
  }, [broadcastToken, djUsername]);

  return {
    messages,
    isConnected,
    error,
    sendMessage,
    sendPromo,
    promoUsed,
  };
}
