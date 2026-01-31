'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp, doc, updateDoc, increment } from 'firebase/firestore';
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

interface UseDJProfileChatOptions {
  chatUsernameNormalized: string;  // Used as stationId
  djUsername: string;               // For love messages: "user is ❤️ {djUsername}"
  username?: string;
  enabled?: boolean;                // Only subscribe when authenticated
  isOwner?: boolean;                // True if current user is the DJ
}

interface UseDJProfileChatReturn {
  messages: ChatMessageSerialized[];
  isConnected: boolean;
  error: string | null;
  loveCount: number;
  sendMessage: (text: string) => Promise<void>;
  sendLove: () => Promise<void>;
}

export function useDJProfileChat({
  chatUsernameNormalized,
  djUsername,
  username,
  enabled = true,
  isOwner = false,
}: UseDJProfileChatOptions): UseDJProfileChatReturn {
  const [messages, setMessages] = useState<ChatMessageSerialized[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loveCount, setLoveCount] = useState(0);

  // Track current user's love message ID for incrementing heartCount
  const currentLoveMessageIdRef = useRef<string | null>(null);

  // Subscribe to chat messages
  useEffect(() => {
    // Don't subscribe if not enabled (unauthenticated)
    if (!enabled || !chatUsernameNormalized) {
      setMessages([]);
      setIsConnected(false);
      return;
    }

    const app = getFirebaseApp();
    const db = getFirestore(app);

    // Use chatUsernameNormalized as the stationId for per-DJ chat rooms
    const messagesRef = collection(db, 'chats', chatUsernameNormalized, 'messages');
    // No time filtering - just get last 100 messages
    const q = query(
      messagesRef,
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newMessages: ChatMessageSerialized[] = [];
        let loves = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const timestamp = data.timestamp as Timestamp | null;
          const msgTimestamp = timestamp ? timestamp.toMillis() : Date.now();
          const msg: ChatMessageSerialized = {
            id: docSnap.id,
            stationId: chatUsernameNormalized,
            username: data.username,
            message: data.message,
            timestamp: msgTimestamp,
            heartCount: data.heartCount || 1,
            isDJ: data.isDJ || false,
            messageType: data.messageType || 'chat',
          };
          newMessages.push(msg);

          // Sum up hearts from love reactions
          if (data.messageType === 'love' || data.message?.includes(' is ❤️')) {
            loves += data.heartCount || 1;
          }
        });

        // Reverse to show oldest first
        setMessages(newMessages.reverse());
        setLoveCount(loves);
        setIsConnected(true);
        setError(null);
      },
      (err) => {
        console.error('DJ Profile chat subscription error:', err);
        setError('Failed to connect to chat');
        setIsConnected(false);
      }
    );

    return () => unsubscribe();
  }, [chatUsernameNormalized, enabled]);

  // Send a regular chat message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !username || !chatUsernameNormalized) return;

    const app = getFirebaseApp();
    const db = getFirestore(app);

    try {
      const messagesRef = collection(db, 'chats', chatUsernameNormalized, 'messages');
      await addDoc(messagesRef, {
        stationId: chatUsernameNormalized,
        username,
        message: text.trim(),
        timestamp: serverTimestamp(),
        isDJ: isOwner,  // Mark as DJ message if the sender is the profile owner
        messageType: 'chat',
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      throw new Error('Failed to send message');
    }
  }, [username, chatUsernameNormalized, isOwner]);

  // Send a love reaction - increment heartCount if user already has a love message
  const sendLove = useCallback(async () => {
    if (!username || !chatUsernameNormalized) return;

    const app = getFirebaseApp();
    const db = getFirestore(app);

    try {
      // Check if we already have a love message - if so, increment heartCount
      if (currentLoveMessageIdRef.current) {
        const messageRef = doc(db, 'chats', chatUsernameNormalized, 'messages', currentLoveMessageIdRef.current);
        await updateDoc(messageRef, {
          heartCount: increment(1),
          timestamp: serverTimestamp(),
        });
        return;
      }

      // First love - create new message
      const messagesRef = collection(db, 'chats', chatUsernameNormalized, 'messages');
      const message = `${username} is ❤️ ${djUsername}`;

      const docRef = await addDoc(messagesRef, {
        stationId: chatUsernameNormalized,
        username,
        message,
        timestamp: serverTimestamp(),
        isDJ: false,
        messageType: 'love',
        heartCount: 1,
      });

      // Store the document ID for future heart increments
      currentLoveMessageIdRef.current = docRef.id;
    } catch (err) {
      console.error('Failed to send love:', err);
      throw new Error('Failed to send love');
    }
  }, [username, chatUsernameNormalized, djUsername]);

  return {
    messages,
    isConnected,
    error,
    loveCount,
    sendMessage,
    sendLove,
  };
}
