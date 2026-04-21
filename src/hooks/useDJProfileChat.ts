'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp, doc, updateDoc, increment, setDoc, arrayUnion, getDoc } from 'firebase/firestore';
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
  lockedInMessagesEnabled?: boolean; // Whether to post "locked in" messages to chat
  // Broadcast-specific options:
  broadcastSlotId?: string;         // For tagging messages with slot ID
  currentShowStartTime?: number;    // Unix ms — filter love counts to current show only
  // User behavior tracking options:
  userId?: string;                  // Firebase UID — when set, love history is recorded
  djPhotoUrl?: string;              // DJ photo for love history denormalization
  isArchivePlayback?: boolean;      // Whether love is sent during archive (vs live) playback
}

interface UseDJProfileChatReturn {
  messages: ChatMessageSerialized[];
  isConnected: boolean;
  error: string | null;
  loveCount: number;
  sendMessage: (text: string) => Promise<void>;
  sendLove: () => Promise<void>;
  sendLockedIn: () => Promise<void>;
}

export function useDJProfileChat({
  chatUsernameNormalized,
  djUsername,
  username,
  enabled = true,
  isOwner = false,
  lockedInMessagesEnabled = true,
  broadcastSlotId,
  userId,
  djPhotoUrl,
  isArchivePlayback = false,
}: UseDJProfileChatOptions): UseDJProfileChatReturn {
  const [messages, setMessages] = useState<ChatMessageSerialized[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loveCount, setLoveCount] = useState(0);

  // Track current user's love message ID for incrementing heartCount
  const currentLoveMessageIdRef = useRef<string | null>(null);
  // Track the cross-posted love message ID in channelbroadcast for incrementing
  const currentLoveBroadcastMessageIdRef = useRef<string | null>(null);

  // Subscribe to chat messages
  useEffect(() => {
    // Don't subscribe if not enabled (unauthenticated)
    if (!enabled || !chatUsernameNormalized) {
      setMessages([]);
      setIsConnected(false);
      return;
    }

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    // For channelbroadcast room, reset love count daily at 7am PT
    let dailyResetCutoff: number | undefined;
    if (chatUsernameNormalized === 'channelbroadcast') {
      const now = new Date();
      const ptToUtcOffset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getTime();
      const ptNow = new Date(now.getTime() - ptToUtcOffset);
      const resetPT = new Date(ptNow);
      resetPT.setHours(7, 0, 0, 0);
      if (ptNow < resetPT) {
        resetPT.setDate(resetPT.getDate() - 1);
      }
      dailyResetCutoff = resetPT.getTime() + ptToUtcOffset;
    }

    const subscribe = () => {
      if (cancelled) return;
      // Use chatUsernameNormalized as the stationId for per-DJ chat rooms
      const messagesRef = collection(db, 'chats', chatUsernameNormalized, 'messages');
      // No time filtering - just get last 100 messages
      const q = query(
        messagesRef,
        orderBy('timestamp', 'desc'),
        limit(100)
      );

      unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newMessages: ChatMessageSerialized[] = [];
        let loves = 0;

        snapshot.forEach((docSnap) => {
          // Estimate pending serverTimestamp() writes to local time so a love
          // message getting its timestamp bumped (on new love / locked-in) shows
          // "now" immediately instead of the stale cached value.
          const data = docSnap.data({ serverTimestamps: 'estimate' });
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
          };
          newMessages.push(msg);

          // Sum up hearts from love reactions
          if (data.messageType === 'love' || data.message?.includes(' is ❤️')) {
            // For channelbroadcast: only count since 7am PT; for all others: count all
            const isAfterDailyReset = !dailyResetCutoff || msgTimestamp >= dailyResetCutoff;
            if (isAfterDailyReset) {
              loves += data.heartCount || 1;
            }
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
    };

    // Ensure Firebase auth for Firestore security rules (sign in anonymously if needed).
    // Wait for authStateReady() first so we don't replace a real user session with anonymous.
    auth.authStateReady().then(() => {
      if (cancelled) return;
      if (!auth.currentUser) {
        signInAnonymously(auth).then(() => subscribe()).catch((err) => {
          console.error('Anonymous auth failed for chat subscription:', err);
          setError('Failed to connect to chat');
        });
      } else {
        subscribe();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [chatUsernameNormalized, enabled]);

  // Send a regular chat message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !username || !chatUsernameNormalized) return;

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Ensure Firebase auth for Firestore security rules.
    // Wait for auth to restore persisted session before falling back to anonymous.
    await auth.authStateReady();
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); } catch { return; }
    }

    try {
      const messagesRef = collection(db, 'chats', chatUsernameNormalized, 'messages');
      const messageData = {
        stationId: chatUsernameNormalized,
        username,
        message: text.trim(),
        timestamp: serverTimestamp(),
        isDJ: isOwner,  // Mark as DJ message if the sender is the profile owner
        messageType: 'chat',
        ...(broadcastSlotId && { djSlotId: broadcastSlotId }),
      };
      await addDoc(messagesRef, messageData);

      // Cross-post to channelbroadcast (fire-and-forget)
      if (chatUsernameNormalized !== 'channelbroadcast') {
        const broadcastRef = collection(db, 'chats', 'channelbroadcast', 'messages');
        addDoc(broadcastRef, {
          ...messageData,
          stationId: 'channelbroadcast',
          timestamp: serverTimestamp(),
        }).catch((err) => console.error('Failed to cross-post message:', err));
      }

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
  // Anyone can send love — if no username, post as "Someone" (no chat message username)
  const sendLove = useCallback(async () => {
    if (!chatUsernameNormalized) return;
    // Don't post automated messages when the DJ is listening to their own mix
    if (username && djUsername && username.toLowerCase() === djUsername.toLowerCase()) return;

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Ensure Firebase auth so Firestore writes succeed (sign in anonymously if needed).
    // Wait for auth to restore persisted session before falling back to anonymous.
    await auth.authStateReady();
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); } catch { return; }
    }

    try {
      const shouldCrossPost = chatUsernameNormalized !== 'channelbroadcast';

      // Helper: record love in user's loveHistory (fire-and-forget)
      const recordLoveHistory = () => {
        const authUid = auth.currentUser?.uid;
        console.log('[recordLoveHistory] called', { userId, authUid, uidMatch: userId === authUid, djUsername, isArchivePlayback });
        if (!userId || !djUsername) return;
        if (authUid !== userId) {
          console.error('[recordLoveHistory] AUTH MISMATCH: userId from props =', userId, 'but auth.currentUser.uid =', authUid);
        }
        const loveHistoryRef = doc(db, 'users', userId, 'loveHistory', djUsername);
        (async () => {
          console.log('[recordLoveHistory] Reading existing doc...');
          const existing = await getDoc(loveHistoryRef);
          console.log('[recordLoveHistory] Existing doc exists:', existing.exists());
          const data: Record<string, unknown> = {
            djUsername,
            djDisplayName: djUsername,
            djPhotoUrl: djPhotoUrl || null,
            loveCount: increment(1),
            contexts: arrayUnion(isArchivePlayback ? 'archive' : 'live'),
            lastLovedAt: serverTimestamp(),
          };
          if (!existing.exists()) {
            data.firstLovedAt = serverTimestamp();
          }
          console.log('[recordLoveHistory] Writing setDoc to', loveHistoryRef.path);
          await setDoc(loveHistoryRef, data, { merge: true });
          console.log('[recordLoveHistory] SUCCESS: Wrote loveHistory for', djUsername);
        })().catch((err) => console.error('[recordLoveHistory] FAILED:', err.code, err.message));
      };

      // Check if we already have a love message - if so, increment heartCount
      if (currentLoveMessageIdRef.current) {
        const messageRef = doc(db, 'chats', chatUsernameNormalized, 'messages', currentLoveMessageIdRef.current);
        await updateDoc(messageRef, {
          heartCount: increment(1),
          timestamp: serverTimestamp(),
        });

        // Also increment in channelbroadcast (fire-and-forget)
        if (shouldCrossPost && currentLoveBroadcastMessageIdRef.current) {
          updateDoc(
            doc(db, 'chats', 'channelbroadcast', 'messages', currentLoveBroadcastMessageIdRef.current),
            { heartCount: increment(1), timestamp: serverTimestamp() }
          ).catch((err) => console.error('Failed to cross-post love increment:', err));
        }
        recordLoveHistory();
        return;
      }

      // First love - create new message
      const messagesRef = collection(db, 'chats', chatUsernameNormalized, 'messages');
      const displayName = username || 'Someone';
      const message = `${displayName} is ❤️ ${djUsername}`;

      const loveData = {
        stationId: chatUsernameNormalized,
        username: displayName,
        message,
        timestamp: serverTimestamp(),
        isDJ: false,
        messageType: 'love',
        heartCount: 1,
      };

      const docRef = await addDoc(messagesRef, loveData);

      // Store the document ID for future heart increments
      currentLoveMessageIdRef.current = docRef.id;

      // Cross-post to channelbroadcast (fire-and-forget)
      if (shouldCrossPost) {
        addDoc(collection(db, 'chats', 'channelbroadcast', 'messages'), {
          ...loveData,
          stationId: 'channelbroadcast',
          timestamp: serverTimestamp(),
        }).then((broadcastDocRef) => {
          currentLoveBroadcastMessageIdRef.current = broadcastDocRef.id;
        }).catch((err) => console.error('Failed to cross-post love:', err));
      }

      recordLoveHistory();
    } catch (err) {
      console.error('Failed to send love:', err);
      throw new Error('Failed to send love');
    }
  }, [username, chatUsernameNormalized, djUsername, userId, djPhotoUrl, isArchivePlayback]);

  // Send a "locked in" message after sustained listening
  // Posts to DJ chat + channelbroadcast, then increments love count by 1
  const sendLockedIn = useCallback(async () => {
    if (!chatUsernameNormalized) return;
    if (!lockedInMessagesEnabled) return;
    // Don't post automated messages when the DJ is listening to their own mix
    if (username && djUsername && username.toLowerCase() === djUsername.toLowerCase()) return;

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    await auth.authStateReady();
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); } catch { return; }
    }

    try {
      const shouldCrossPost = chatUsernameNormalized !== 'channelbroadcast';
      const displayName = username || 'Someone';
      const message = `${displayName} is locked in 🔐 with ${djUsername}`;

      const lockedInData = {
        stationId: chatUsernameNormalized,
        username: displayName,
        message,
        timestamp: serverTimestamp(),
        isDJ: false,
        messageType: 'lockedin',
      };

      await addDoc(collection(db, 'chats', chatUsernameNormalized, 'messages'), lockedInData);

      // Cross-post to channelbroadcast (fire-and-forget)
      if (shouldCrossPost) {
        addDoc(collection(db, 'chats', 'channelbroadcast', 'messages'), {
          ...lockedInData,
          stationId: 'channelbroadcast',
          timestamp: serverTimestamp(),
        }).catch((err) => console.error('Failed to cross-post locked in:', err));
      }

      // Increment love count by 1 if user already has a love message (no new visible message)
      if (currentLoveMessageIdRef.current) {
        await updateDoc(
          doc(db, 'chats', chatUsernameNormalized, 'messages', currentLoveMessageIdRef.current),
          { heartCount: increment(1), timestamp: serverTimestamp() }
        );
        if (shouldCrossPost && currentLoveBroadcastMessageIdRef.current) {
          updateDoc(
            doc(db, 'chats', 'channelbroadcast', 'messages', currentLoveBroadcastMessageIdRef.current),
            { heartCount: increment(1), timestamp: serverTimestamp() }
          ).catch(() => {});
        }
      }

    } catch (err) {
      console.error('Failed to send locked in:', err);
    }
  }, [username, chatUsernameNormalized, djUsername, lockedInMessagesEnabled]);

  return {
    messages,
    isConnected,
    error,
    loveCount,
    sendMessage,
    sendLove,
    sendLockedIn,
  };
}
