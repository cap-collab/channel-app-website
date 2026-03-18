import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export type UserRole = 'broadcaster' | 'admin' | 'dj' | 'user' | null;

interface UserRoleData {
  role: UserRole;
  loading: boolean;
}

/**
 * Hook to check user's role from Firestore
 * Uses onSnapshot for real-time updates (e.g. after DJ role assignment)
 */
export function useUserRole(user: User | null): UserRoleData {
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !db) {
      setRole(null);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setRole(data.role || 'user');
        } else {
          setRole('user');
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching user role:', error);
        setRole('user');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  return { role, loading };
}

/**
 * Check if user has broadcaster access (admin dashboard)
 */
export function isBroadcaster(role: UserRole): boolean {
  return role === 'broadcaster' || role === 'admin';
}

/**
 * Check if user has DJ access (DJ profile, broadcast features)
 * Includes dj, broadcaster, and admin roles
 */
export function isDJ(role: UserRole): boolean {
  return role === 'dj' || role === 'broadcaster' || role === 'admin';
}
