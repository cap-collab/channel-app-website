'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

interface DJProfile {
  bio: string | null;
  photoUrl: string | null;
  promoUrl: string | null;
  promoTitle: string | null;
}

interface UserProfile {
  chatUsername: string | null;
  displayName: string | null;
  djProfile: DJProfile | null;
}

interface SetUsernameResult {
  success: boolean;
  error?: string;
}

/**
 * Hook to fetch user's profile from Firestore
 * Used to get saved chatUsername for DJ profile setup and chat
 */
export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<UserProfile>({ chatUsername: null, displayName: null, djProfile: null });
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!userId || !db) {
      setLoading(false);
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setProfile({
          chatUsername: data.chatUsername || null,
          displayName: data.displayName || null,
          djProfile: data.djProfile ? {
            bio: data.djProfile.bio || null,
            photoUrl: data.djProfile.photoUrl || null,
            promoUrl: data.djProfile.promoUrl || null,
            promoTitle: data.djProfile.promoTitle || null,
          } : null,
        });
      }
    } catch (err) {
      console.error('Failed to fetch user profile:', err);
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
