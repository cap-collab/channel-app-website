'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, onSnapshot, type DocumentData } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

interface DJProfile {
  bio: string | null;
  thankYouMessage: string | null;
}

interface UserProfile {
  chatUsername: string | null;
  displayName: string | null;
  djProfile: DJProfile | null;
  showLockedInMessages: boolean;
}

interface SetUsernameResult {
  success: boolean;
  error?: string;
}

/**
 * Hook to fetch user's profile from Firestore
 * Used to get saved chatUsername for DJ profile setup and chat
 *
 * LIVE subscription, not a one-shot read. This used to be a single getDoc, so if
 * the user had no chatUsername *at the moment it ran* — a fresh signup, or the
 * username write simply landing after the read — it cached `chatUsername: null`
 * and never looked again. Every consumer then fell back to its anonymous label,
 * so hearts and chat posted as "Someone" until the user manually refreshed the
 * page. onSnapshot self-heals: the instant the username lands, every consumer
 * re-renders with it.
 */
export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<UserProfile>({ chatUsername: null, displayName: null, djProfile: null, showLockedInMessages: true });
  const [loading, setLoading] = useState(true);

  const applyDoc = useCallback((data: DocumentData | undefined) => {
    if (!data) return;
    const next: UserProfile = {
      chatUsername: data.chatUsername || null,
      displayName: data.displayName || null,
      djProfile: data.djProfile ? {
        bio: data.djProfile.bio || null,
        thankYouMessage: data.djProfile.thankYouMessage || null,
      } : null,
      showLockedInMessages: data.activityMessages?.showLockedInMessages ?? true,
    };
    // Bail out when nothing we expose actually changed. The user doc is HOT — it's
    // written on every play-start (playedArchiveIds), i.e. on every archive-radio
    // crossfade — and this hook has ~9 consumers. Without this guard each of those
    // writes would fan out into a re-render storm across the player UI. (Audio is
    // held in refs inside providers above us, so it can't be disturbed either way;
    // the churn is just waste.) Returning the SAME object keeps React bailing out.
    setProfile((prev) =>
      prev.chatUsername === next.chatUsername &&
      prev.displayName === next.displayName &&
      prev.showLockedInMessages === next.showLockedInMessages &&
      prev.djProfile?.bio === next.djProfile?.bio &&
      prev.djProfile?.thankYouMessage === next.djProfile?.thankYouMessage
        ? prev
        : next,
    );
  }, []);

  // Kept for the public API (callers use `refetch`). The live subscription below
  // makes it largely redundant, but a manual re-read stays harmless.
  const fetchProfile = useCallback(async () => {
    if (!userId || !db) {
      setLoading(false);
      return;
    }
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) applyDoc(userDoc.data());
    } catch (err) {
      // Silently ignore permission errors (e.g., anonymous users can't read user profiles)
      const firebaseErr = err as { code?: string };
      if (firebaseErr.code !== 'permission-denied') {
        console.error('Failed to fetch user profile:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [userId, applyDoc]);

  useEffect(() => {
    if (!userId || !db) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'users', userId),
      (snap) => {
        applyDoc(snap.data());
        setLoading(false);
      },
      (err: { code?: string }) => {
        // Anonymous users can't read user docs — expected, stay quiet.
        if (err?.code !== 'permission-denied') {
          console.error('Failed to fetch user profile:', err);
        }
        setLoading(false);
      },
    );

    return () => unsub();
  }, [userId, applyDoc]);

  /**
   * Register a chat username for the user
   * Uses the server API for atomic username registration
   */
  const setChatUsername = useCallback(async (username: string): Promise<SetUsernameResult> => {
    if (!auth?.currentUser) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const idToken = await auth.currentUser.getIdToken();

      const response = await fetch('/api/chat/register-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to register username' };
      }

      // Update local state with the new username
      setProfile(prev => ({ ...prev, chatUsername: data.username }));

      return { success: true };
    } catch (err) {
      console.error('Failed to set chat username:', err);
      return { success: false, error: 'Failed to register username' };
    }
  }, []);

  return { ...profile, loading, setChatUsername, refetch: fetchProfile };
}
