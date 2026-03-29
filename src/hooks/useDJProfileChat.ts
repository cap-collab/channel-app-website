'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
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
  activityMessagesEnabled?: boolean; // Whether to post activity messages (love, etc.) to chat
  // Broadcast-specific options:
  broadcastToken?: string;          // For sending promos via API
  broadcastSlotId?: string;         // For tagging messages with slot ID
  currentShowStartTime?: number;    // Unix ms — filter love counts and promos to current show only
}

interface UseDJProfileChatReturn {
  messages: ChatMessageSerialized[];
  isConnected: boolean;
  error: string | null;
  loveCount: number;
  currentPromo: ChatMessageSerialized | null;
  promoUsed: boolean;
  sendMessage: (text: string) => Promise<void>;
  sendLove: () => Promise<void>;
  sendPromo: (promoText: string, promoHyperlink?: string) => Promise<void>;
}

export function useDJProfileChat({
  chatUsernameNormalized,
  djUsername,
  username,
  enabled = true,
  isOwner = false,
  activityMessagesEnabled = true,
  broadcastToken,
  broadcastSlotId,
  currentShowStartTime,
}: UseDJProfileChatOptions): UseDJProfileChatReturn {
  const [messages, setMessages] = useState<ChatMessageSerialized[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loveCount, setLoveCount] = useState(0);
  const [currentPromo, setCurrentPromo] = useState<ChatMessageSerialized | null>(null);
  const [promoUsed, setPromoUsed] = useState(false);

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
        let latestPromo: ChatMessageSerialized | null = null;

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
            djSlotId: data.djSlotId,
            messageType: data.messageType || 'chat',
            promoText: data.promoText,
            promoHyperlink: data.promoHyperlink,
          };
          newMessages.push(msg);

          // Track the most recent promo — only from current show if currentShowStartTime is set
          if (data.messageType === 'promo' && !latestPromo) {
            if (!currentShowStartTime || msgTimestamp >= currentShowStartTime) {
              latestPromo = msg;
            }
          }

          // Sum up hearts from love reactions — only from current show if currentShowStartTime is set
          if (data.messageType === 'love' || data.message?.includes(' is ❤️')) {
            const isFromCurrentShow = !currentShowStartTime || msgTimestamp >= currentShowStartTime;
            if (isFromCurrentShow) {
              loves += data.heartCount || 1;
            }
          }
        });

        // Reverse to show oldest first
        setMessages(newMessages.reverse());
        setLoveCount(loves);
        setCurrentPromo(latestPromo);
        if (latestPromo) setPromoUsed(true);
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
  }, [chatUsernameNormalized, enabled, currentShowStartTime]);

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
        ...(broadcastSlotId && { djSlotId: broadcastSlotId }),
      });

      // If the DJ is posting, trigger DJ Online notifications for followers
      if (isOwner) {
        fetch('/api/notifications/dj-online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            djUsername: username,
            chatUsernameNormalized,
          }),
        }).catch((err) => {
          // Fire and forget - don't block chat on notification errors
          console.error('Failed to trigger DJ online notification:', err);
        });
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      throw new Error('Failed to send message');
    }
  }, [username, chatUsernameNormalized, isOwner, broadcastSlotId]);

  // Send a love reaction - increment heartCount if user already has a love message
  // If activityMessagesEnabled is false, skip posting to chat (animation still plays)
  // Anyone can send love — if no username, post as "Someone" (no chat message username)
  const sendLove = useCallback(async () => {
    if (!chatUsernameNormalized) return;

    // If activity messages are disabled, skip posting to chat
    if (!activityMessagesEnabled) return;

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Ensure Firebase auth so Firestore writes succeed (sign in anonymously if needed)
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); } catch { return; }
    }

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
      const displayName = username || 'Someone';
      const message = `${displayName} is ❤️ ${djUsername}`;

      const docRef = await addDoc(messagesRef, {
        stationId: chatUsernameNormalized,
        username: displayName,
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
  }, [username, chatUsernameNormalized, djUsername, activityMessagesEnabled]);

  // Send a promo message via API (broadcast-only feature)
  const sendPromo = useCallback(async (promoText: string, promoHyperlink?: string) => {
    if (!broadcastToken) return;

    try {
      const response = await fetch('/api/broadcast/dj-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastToken,
          promoText,
          promoHyperlink,
          username: username || djUsername,
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
  }, [broadcastToken, username, djUsername]);

  return {
    messages,
    isConnected,
    error,
    loveCount,
    currentPromo,
    promoUsed,
    sendMessage,
    sendLove,
    sendPromo,
  };
}
