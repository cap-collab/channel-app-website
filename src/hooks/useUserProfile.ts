'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
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
 * Linked accounts: an ALIAS account is only a login — a doorway into a primary.
 * It carries no identity of its own (the link-time migration strips its
 * chatUsername/djProfile), so we transparently resolve to the PRIMARY's doc
 * here. That means an alias login chats, hearts, and "locks in" under the one
 * shared identity instead of appearing as a nameless second person. Resolving in
 * this hook covers every consumer at once. See src/lib/account-links.ts.
 */
export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<UserProfile>({ chatUsername: null, displayName: null, djProfile: null, showLockedInMessages: true });
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!userId || !db) {
      setLoading(false);
      return;
    }

    try {
      let userDoc = await getDoc(doc(db, 'users', userId));
      // Alias → read the primary's profile instead.
      const primaryUid = userDoc.data()?.primaryUid as string | undefined;
      if (primaryUid && primaryUid !== userId) {
        userDoc = await getDoc(doc(db, 'users', primaryUid));
      }
      if (userDoc.exists()) {
        const data = userDoc.data();
        setProfile({
          chatUsername: data.chatUsername || null,
          displayName: data.displayName || null,
          djProfile: data.djProfile ? {
            bio: data.djProfile.bio || null,
            thankYouMessage: data.djProfile.thankYouMessage || null,
          } : null,
          showLockedInMessages: data.activityMessages?.showLockedInMessages ?? true,
        });
      }
    } catch (err) {
      // Silently ignore permission errors (e.g., anonymous users can't read user profiles)
      const firebaseErr = err as { code?: string };
      if (firebaseErr.code !== 'permission-denied') {
        console.error('Failed to fetch user profile:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || !db) {
      setLoading(false);
      return;
    }
    fetchProfile();
  }, [userId, fetchProfile]);

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
