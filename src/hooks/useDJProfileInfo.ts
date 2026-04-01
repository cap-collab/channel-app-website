'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface DJProfileInfo {
  genres: string[];
  tipButtonLink: string | null;
  photoUrl: string | null;
  bio: string | null;
  loading: boolean;
}

/**
 * Fetch a DJ's genres and tip link by username.
 * Same Firestore query pattern as DJPublicProfileClient.tsx.
 */
export function useDJProfileInfo(username: string | undefined): DJProfileInfo {
  const [genres, setGenres] = useState<string[]>([]);
  const [tipButtonLink, setTipButtonLink] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!username || !db) {
      setGenres([]);
      setTipButtonLink(null);
      setPhotoUrl(null);
      setBio(null);
      return;
    }

    let cancelled = false;

    async function fetchProfile() {
      setLoading(true);
      try {
        const normalized = decodeURIComponent(username!).replace(/[\s-]+/g, '').toLowerCase();

        // Check users collection first (preferred, Studio writes here)
        const usersRef = collection(db!, 'users');
        const q = query(
          usersRef,
          where('chatUsernameNormalized', '==', normalized),
          where('role', 'in', ['dj', 'broadcaster', 'admin'])
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty && !cancelled) {
          const data = snapshot.docs[0].data();
          setGenres(data.djProfile?.genres || []);
          setTipButtonLink(data.djProfile?.tipButtonLink || null);
          setPhotoUrl(data.djProfile?.photoUrl || null);
          setBio(data.djProfile?.bio || null);
          setLoading(false);
          return;
        }

        // Fall back to pending-dj-profiles
        const pendingRef = collection(db!, 'pending-dj-profiles');
        const pendingQ = query(
          pendingRef,
          where('chatUsernameNormalized', '==', normalized)
        );
        const pendingSnapshot = await getDocs(pendingQ);

        if (!pendingSnapshot.empty && !cancelled) {
          const data = pendingSnapshot.docs[0].data();
          setGenres(data.djProfile?.genres || []);
          setTipButtonLink(data.djProfile?.tipButtonLink || null);
          setPhotoUrl(data.djProfile?.photoUrl || null);
          setBio(data.djProfile?.bio || null);
        }
      } catch {
        // Silently fail — genres/tip are non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfile();
    return () => { cancelled = true; };
  }, [username]);

  return { genres, tipButtonLink, photoUrl, bio, loading };
}
