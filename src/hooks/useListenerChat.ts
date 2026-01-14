'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFirestore, collection, query, orderBy, limit, where, onSnapshot, addDoc, serverTimestamp, Timestamp, doc, updateDoc, increment } from 'firebase/firestore';
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

function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

interface UseListenerChatOptions {
  username?: string;
}

interface UseListenerChatReturn {
  messages: ChatMessageSerialized[];
  isConnected: boolean;
  error: string | null;
  currentPromo: ChatMessageSerialized | null;
  loveCount: number;
  sendMessage: (text: string) => Promise<void>;
  sendLove: (showName?: string) => Promise<void>;
}

export function useListenerChat({ username }: UseListenerChatOptions): UseListenerChatReturn {
  const [messages, setMessages] = useState<ChatMessageSerialized[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPromo, setCurrentPromo] = useState<ChatMessageSerialized | null>(null);
  const [loveCount, setLoveCount] = useState(0);

  // Track current user's love message ID for incrementing heartCount (like iOS)
  const currentLoveMessageIdRef = useRef<string | null>(null);
  const currentLoveShowNameRef = useRef<string | null>(null);

  // Subscribe to chat messages
  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
    const twentyFourHoursAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
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
        let latestPromo: ChatMessageSerialized | null = null;
        let loves = 0;

        snapshot.forEach((doc) => {
          const data = doc.data();
          const timestamp = data.timestamp as Timestamp | null;
          const msg: ChatMessageSerialized = {
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
          };
          newMessages.push(msg);

          // Track the most recent promo from the current DJ
          if (data.messageType === 'promo' && !latestPromo) {
            latestPromo = msg;
          }

          // Count love reactions
          if (data.messageType === 'love') {
            loves++;
          }
        });

        // Reverse to show oldest first
        setMessages(newMessages.reverse());
        setCurrentPromo(latestPromo);
        setLoveCount(loves);
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
  }, []);

  // Send a regular chat message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !username) return;

    const app = getFirebaseApp();
    const db = getFirestore(app);

    try {
      const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
      await addDoc(messagesRef, {
        stationId: 'broadcast',
        username,
        message: text.trim(),
        timestamp: serverTimestamp(),
        isDJ: false,
        messageType: 'chat',
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      throw new Error('Failed to send message');
    }
  }, [username]);

  // Send a love reaction - increment heartCount if user already has a love message for this show
  const sendLove = useCallback(async (showName?: string) => {
    if (!username) return;

    const app = getFirebaseApp();
    const db = getFirestore(app);
    const currentShowName = showName || 'the broadcast';

    try {
      // Check if we already have a love message for this show - if so, increment heartCount
      if (currentLoveMessageIdRef.current && currentLoveShowNameRef.current === currentShowName) {
        // Update existing message: increment heartCount and update timestamp
        const messageRef = doc(db, 'chats', 'broadcast', 'messages', currentLoveMessageIdRef.current);
        await updateDoc(messageRef, {
          heartCount: increment(1),
          timestamp: serverTimestamp(),
        });
        return;
      }

      // First love for this show - create new message
      const messagesRef = collection(db, 'chats', 'broadcast', 'messages');
      const message = `${username} is ❤️ ${currentShowName}`;

      const docRef = await addDoc(messagesRef, {
        stationId: 'broadcast',
        username,
        message,
        timestamp: serverTimestamp(),
        isDJ: false,
        messageType: 'love',
        heartCount: 1,
      });

      // Store the document ID for future heart increments
      currentLoveMessageIdRef.current = docRef.id;
      currentLoveShowNameRef.current = currentShowName;
    } catch (err) {
      console.error('Failed to send love:', err);
      throw new Error('Failed to send love');
    }
  }, [username]);

  return {
    messages,
    isConnected,
    error,
    currentPromo,
    loveCount,
    sendMessage,
    sendLove,
  };
}
