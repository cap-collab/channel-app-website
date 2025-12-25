'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface UserProfile {
  chatUsername: string | null;
  displayName: string | null;
}

/**
 * Hook to fetch user's profile from Firestore
 * Used to get saved chatUsername for DJ profile setup
 */
export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<UserProfile>({ chatUsername: null, displayName: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId || !db) {
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      if (!db) {
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
          });
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [userId]);

  return { ...profile, loading };
}
